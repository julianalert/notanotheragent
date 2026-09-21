import { MAX_HITS, RESULTS_PER_SEARCH } from '../contract'
import { sourceKey } from '../gates'
import type { SearchTopic } from '../prompt'
import { exaConfigured, searchExa } from './exa'
import { searchHackerNews } from './hn'
import { searchOpenAI } from './openai-search'
import { latestPossibleRedditDates, redditConfigured, searchReddit, subredditNew } from './reddit'
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
  now?: Date
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
 * Communities Exa indexes where buyers post in the first person. Exa has no Reddit or X content at all, and Reddit's
 * own API is closed to non-partners, so Reddit is searched through OpenAI's hosted browsing (the 'openai' connector
 * with a Reddit focus). The Reddit connector itself only runs with partner credentials.
 */
export const COMMUNITY_DOMAINS = [
  'linkedin.com/posts',
  'facebook.com/groups',
  'indiehackers.com',
  'threads.net',
  'quora.com',
  'news.ycombinator.com',
  'community.hubspot.com',
  'forum.webflow.com',
  'growthhackers.com',
  'warriorforum.com',
]

export function defaultConnectors(): Connector[] {
  const list: Connector[] = ['hn']
  if (exaConfigured()) list.unshift('exa')
  if (process.env.OPENAI_API_KEY) list.push('openai')
  if (redditConfigured()) list.push('reddit')
  return list
}

/**
 * Fan every topic out to the connectors, then merge: dedupe by source key, drop hits known to be older than the
 * window (a day of tolerance for timezone rounding; Reddit threads also by their post id), drop excluded keys,
 * keep topics evenly represented, cap.
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
          // The open web and the communities as two searches: first-person posts otherwise drown under articles.
          const [web, communities] = await Promise.all([searchExa(request), searchExa(request, { includeDomains: COMMUNITY_DOMAINS })])
          return { connector: 'exa', hits: roundRobin([communities.hits, web.hits]), costUsd: web.costUsd + communities.costUsd, error: web.error && communities.error ? web.error : null }
        }
        if (connector === 'hn') return searchHackerNews(request)
        if (connector === 'openai') {
          // With Exa doing the open web, this pass is Reddit only; without Exa it is the general fallback.
          const result = await searchOpenAI(request, exaConfigured() ? { focus: 'reddit' } : {})
          usage.input_tokens += result.usage.input_tokens
          usage.output_tokens += result.usage.output_tokens
          return result
        }
        return searchReddit(request)
      }),
    )
    for (const result of results) {
      record(result)
      searches.push({ connector: result.connector, query: topic.query, hits: result.hits.length, error: result.error })
    }
    // Every connector gets an equal say in a topic's list, so one source (LinkedIn, Reddit) cannot crowd out the rest.
    perTopic.set(topic.query, roundRobin(results.map((result) => result.hits)))
  }

  // Topics and communities at the same time: one after the other, the hosted searches could outlast the function
  // running the step, and a first search would make the visitor wait a minute longer.
  const topicSearches = parallel(topics, options.concurrency ?? 6, runTopic)
  const communityPolls = parallel(options.subreddits ?? [], 4, async (subreddit) => {
    const name = subreddit.replace(/^r\//, '')
    // Watched subreddits: Reddit's listing with partner credentials, otherwise hosted browsing restricted to the subreddit.
    const result = redditConfigured()
      ? await subredditNew(name, RESULTS_PER_SEARCH * 2)
      : process.env.OPENAI_API_KEY
        ? await (async () => {
            const polled = await searchOpenAI(
              { query: topics[0]?.query ?? 'asking for help or recommendations', domains: [`reddit.com/r/${name}`], windowStart: options.windowStart, limit: RESULTS_PER_SEARCH },
              { focus: 'reddit' },
            )
            usage.input_tokens += polled.usage.input_tokens
            usage.output_tokens += polled.usage.output_tokens
            return polled
          })()
        : { connector: 'reddit' as const, hits: [], costUsd: 0, error: 'no Reddit access configured' }
    record(result)
    searches.push({ connector: result.connector, query: `r/${name}/new`, hits: result.hits.length, error: result.error })
    perTopic.set(`subreddit:${name}`, result.hits)
  })
  await Promise.all([topicSearches, communityPolls])

  const floor = Date.parse(`${options.windowStart}T00:00:00Z`) - DAY_MS
  const seen = new Set<string>()
  const merged: SearchHit[] = []
  const lists = [...perTopic.values()]
  // Reddit hits mostly come without a date; their ids still prove when a thread is older than the window.
  const latestPossible = latestPossibleRedditDates(lists.flat().map((hit) => hit.url), options.now ?? new Date())
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let i = 0; i < longest && merged.length < (options.maxHits ?? MAX_HITS); i++) {
    for (const list of lists) {
      const hit = list[i]
      if (!hit) continue
      const key = sourceKey(hit.url)
      if (!key || seen.has(key) || options.excludeKeys?.has(key)) continue
      if (hit.publishedDate && Date.parse(`${hit.publishedDate}T00:00:00Z`) < floor) continue
      if ((latestPossible.get(hit.url) ?? Infinity) < floor) continue
      seen.add(key)
      merged.push(hit)
      if (merged.length >= (options.maxHits ?? MAX_HITS)) break
    }
  }

  const unavailable = [...failures.entries()].filter(([, stats]) => stats.calls > 0 && stats.errors === stats.calls).map(([connector]) => connector)
  return { hits: merged, searches, costUsd, usage, unavailable }
}

/** First of each list, then second of each, and so on. */
export function roundRobin<T>(lists: T[][]): T[] {
  const result: T[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) result.push(list[i])
  return result
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
