import { MAX_HITS, RESULTS_PER_SEARCH } from '../contract'
import { sourceKey } from '../gates'
import type { SearchTopic } from '../prompt'
import { exaConfigured, searchExa } from './exa'
import { searchHackerNews } from './hn'
import { searchOpenAI } from './openai-search'
import { redditConfigured, searchReddit, subredditNew } from './reddit'
import type { Connector, ConnectorResult, SearchHit } from './types'

export type { Connector, SearchHit } from './types'

export type DiscoverOptions = {
  windowStart: string
  /** Connectors to run per topic. Defaults to every configured one. */
  connectors?: Connector[]
  /** Source keys (see gates.sourceKey) already known for this radar: leads, candidates, seen sources. */
  excludeKeys?: Set<string>
  /** Watched subreddits polled directly (watch mode). */
  subreddits?: string[]
  /** Parallel topics. */
  concurrency?: number
  maxHits?: number
}

export type DiscoverResult = {
  hits: SearchHit[]
  /** One record per executed search, for diagnostics. */
  searches: Array<{ connector: Connector; query: string; hits: number; error: string | null }>
  costUsd: number
  usage: { input_tokens: number; output_tokens: number }
  /** Connectors that failed on every call this run. */
  unavailable: Connector[]
}

const DAY_MS = 86_400_000

/**
 * Reddit closed its API to all but approved partners (May 2026) and answers servers with 403, so Reddit posts come
 * through Exa: a general search plus one restricted to reddit.com per topic. The Reddit connector itself only runs
 * with partner credentials.
 */
export function defaultConnectors(): Connector[] {
  const list: Connector[] = ['hn']
  if (exaConfigured()) list.unshift('exa')
  else if (process.env.OPENAI_API_KEY) list.unshift('openai')
  if (redditConfigured()) list.push('reddit')
  return list
}

/**
 * Fan every topic out to the connectors, then merge: dedupe by source key, drop hits known to be older than the
 * window (a day of tolerance for timezone rounding), drop excluded keys, keep topics evenly represented, cap.
 */
export async function discover(topics: SearchTopic[], options: DiscoverOptions): Promise<DiscoverResult> {
  const connectors = options.connectors ?? defaultConnectors()
  const searches: DiscoverResult['searches'] = []
  const usage = { input_tokens: 0, output_tokens: 0 }
  let costUsd = 0
  const failures = new Map<Connector, { calls: number; errors: number }>()
  const perTopic = new Map<string, SearchHit[]>()

  const record = (result: ConnectorResult) => {
    const stats = failures.get(result.connector) ?? { calls: 0, errors: 0 }
    stats.calls++
    if (result.error) stats.errors++
    failures.set(result.connector, stats)
    costUsd += result.costUsd
  }

  const runTopic = async (topic: SearchTopic) => {
    const request = { query: topic.query, domains: topic.domains, windowStart: options.windowStart, limit: RESULTS_PER_SEARCH }
    const results = await Promise.all(
      connectors.map(async (connector): Promise<ConnectorResult> => {
        if (connector === 'exa') {
          // The open web and Reddit as two searches: Reddit posts otherwise drown under articles.
          const [web, reddit] = await Promise.all([searchExa(request), searchExa(request, { includeDomains: ['reddit.com'] })])
          return { connector: 'exa', hits: [...reddit.hits, ...web.hits], costUsd: web.costUsd + reddit.costUsd, error: web.error && reddit.error ? web.error : null }
        }
        if (connector === 'hn') return searchHackerNews(request)
        if (connector === 'openai') {
          const result = await searchOpenAI(request)
          usage.input_tokens += result.usage.input_tokens
          usage.output_tokens += result.usage.output_tokens
          return result
        }
        return searchReddit(request)
      }),
    )
    const hits: SearchHit[] = []
    for (const result of results) {
      record(result)
      searches.push({ connector: result.connector, query: topic.query, hits: result.hits.length, error: result.error })
      hits.push(...result.hits)
    }
    perTopic.set(topic.query, hits)
  }

  await parallel(topics, options.concurrency ?? 4, runTopic)

  for (const subreddit of options.subreddits ?? []) {
    const name = subreddit.replace(/^r\//, '')
    // Watched subreddits: Reddit's listing with partner credentials, otherwise Exa restricted to the subreddit's path.
    const result = redditConfigured()
      ? await subredditNew(name, RESULTS_PER_SEARCH * 2)
      : exaConfigured()
        ? await searchExa(
            { query: topics[0]?.query ?? 'new posts asking for help or recommendations', domains: [], windowStart: options.windowStart, limit: RESULTS_PER_SEARCH * 2 },
            { includeDomains: [`reddit.com/r/${name}`] },
          )
        : { connector: 'reddit' as const, hits: [], costUsd: 0, error: 'no Reddit access configured' }
    record(result)
    searches.push({ connector: result.connector, query: `r/${name}/new`, hits: result.hits.length, error: result.error })
    perTopic.set(`subreddit:${name}`, result.hits)
  }

  const floor = Date.parse(`${options.windowStart}T00:00:00Z`) - DAY_MS
  const seen = new Set<string>()
  const merged: SearchHit[] = []
  const lists = [...perTopic.values()]
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let i = 0; i < longest && merged.length < (options.maxHits ?? MAX_HITS); i++) {
    for (const list of lists) {
      const hit = list[i]
      if (!hit) continue
      const key = sourceKey(hit.url)
      if (!key || seen.has(key) || options.excludeKeys?.has(key)) continue
      if (hit.publishedDate && Date.parse(`${hit.publishedDate}T00:00:00Z`) < floor) continue
      seen.add(key)
      merged.push(hit)
      if (merged.length >= (options.maxHits ?? MAX_HITS)) break
    }
  }

  const unavailable = [...failures.entries()].filter(([, stats]) => stats.calls > 0 && stats.errors === stats.calls).map(([connector]) => connector)
  return { hits: merged, searches, costUsd, usage, unavailable }
}

async function parallel<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}
