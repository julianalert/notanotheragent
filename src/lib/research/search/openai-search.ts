import OpenAI from 'openai'
import { SEARCH_MODEL } from '../contract'
import { auditFromOutput, type OutputItem } from '../provider'
import { communityOf } from './exa'
import { isoDayOf, type ConnectorResult, type SearchRequest } from './types'

/*
 * Hosted web_search through a small model: one call per topic. Two uses: the general fallback when Exa is not
 * configured, and the Reddit pass, because Reddit's API is closed and Exa does not index Reddit at all, while
 * OpenAI's hosted browsing can still search and open Reddit pages. The same tool reads pages the app cannot fetch.
 */

const INSTRUCTIONS = `Run web searches to find recent public posts, questions or requests written by the people described in the
query: original first-person posts on Reddit, Indie Hackers, Hacker News, forums, Q&A sites, X, LinkedIn,
Facebook groups, marketplaces and job boards. Add community names to your searches (for example "reddit") to
surface posts. Never return articles, guides, blog posts, vendor or agency websites, directories or listing
pages. Run at most 3 searches. Reply with one line per relevant post: "URL | YYYY-MM-DD or unknown | one-line
summary". Nothing else.`

const REDDIT_INSTRUCTIONS = `Find recent Reddit posts (reddit.com) written by the people described in the query: original first-person
posts or questions in subreddits where they talk. Include the word reddit in every search, and try 2 or 3
wordings. Return only reddit.com post URLs (the post's own /comments/ page, never a subreddit listing, user
profile or search page). Never return articles or vendor pages. Run at most 3 searches. Reply with one line per
relevant post: "URL | YYYY-MM-DD or unknown | one-line summary". Nothing else.`

const READ_INSTRUCTIONS = `Open exactly the given URL with the web tool and return its content as plain text, as completely as the tool
shows it: title, author or handle, the posting date or relative time shown, the full body, and the visible
comments with each commenter's handle and, when shown, the comment permalink. Do not summarise, judge or add
anything. If the page cannot be opened, reply with exactly: UNAVAILABLE.`

/** A Reddit post's URL carries its title: /r/<subreddit>/comments/<id>/<title_in_words>/. */
export function redditTitleFromUrl(url: string) {
  const slug = url.match(/reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+\/([^/?#]+)/i)?.[1]
  if (!slug) return ''
  try {
    return decodeURIComponent(slug).replace(/_/g, ' ').trim()
  } catch {
    return slug.replace(/_/g, ' ').trim()
  }
}

/** The model writes URLs slightly differently from the tool audit (www, old., trailing slash, query): match on the post. */
function hitKey(url: string) {
  const reddit = url.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/i)
  if (reddit) return `reddit:${reddit[1].toLowerCase()}`
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()
}

let client: OpenAI | null = null
const openai = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 }))

export type OpenAISearchUsage = { input_tokens: number; output_tokens: number }

export async function searchOpenAI(request: SearchRequest, options: { focus?: 'reddit' } = {}): Promise<ConnectorResult & { usage: OpenAISearchUsage }> {
  const empty = { connector: 'openai' as const, hits: [], costUsd: 0, usage: { input_tokens: 0, output_tokens: 0 } }
  if (!process.env.OPENAI_API_KEY) return { ...empty, error: 'OPENAI_API_KEY is not set' }
  try {
    const domainNote = request.domains.length ? ` Restrict to these sites: ${request.domains.join(', ')}.` : ''
    const response = await openai().responses.create(
      {
        model: SEARCH_MODEL,
        reasoning: { effort: 'low' },
        tools: [{ type: 'web_search', external_web_access: true }],
        tool_choice: 'auto',
        ...({ max_tool_calls: 4 } as object),
        include: ['web_search_call.action.sources'],
        instructions: options.focus === 'reddit' ? REDDIT_INSTRUCTIONS : INSTRUCTIONS,
        input: `Query: ${request.query}. Published on or after ${request.windowStart}. Up to ${request.limit} results.${domainNote}`,
        max_output_tokens: 2000,
      },
      { timeout: 60_000 },
    )
    const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
    // Dates and summaries from the model's lines; URLs from the tool audit (never invented).
    const lines = new Map<string, { date: string | null; summary: string }>()
    for (const line of audit.text.split('\n')) {
      const match = line.match(/(https?:\/\/\S+)\s*\|\s*([^|]*)\|\s*(.*)$/)
      if (match) lines.set(hitKey(match[1].replace(/[),.]+$/, '')), { date: isoDayOf(match[2].trim()), summary: match[3].trim() })
    }
    const seen = new Set<string>()
    const hits = audit.urls
      .filter((url) => !seen.has(hitKey(url)) && seen.add(hitKey(url)))
      .filter((url) => options.focus !== 'reddit' || /reddit\.com\/r\/[^/]+\/comments\//i.test(url))
      // The posts the model picked out (they have a line) first: the list is cut below, and merged in order.
      .sort((a, b) => Number(lines.has(hitKey(b))) - Number(lines.has(hitKey(a))))
      .slice(0, request.limit * 2)
      .map((url) => {
        const line = lines.get(hitKey(url))
        return {
          url,
          // Most URLs the tool saw get no line from the model. A Reddit URL still says what the post is about;
          // without it triage sees an empty hit and scores it 0, whatever the post says.
          title: redditTitleFromUrl(url),
          snippet: line?.summary ?? '',
          text: null,
          publishedDate: line?.date ?? null,
          connector: 'openai' as const,
          topic: request.query,
          community: communityOf(url),
        }
      })
    return {
      ...empty,
      hits,
      error: null,
      usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
    }
  } catch (error) {
    return { ...empty, error: (error as Error).message.slice(0, 120) }
  }
}

export type OpenAIRead = { url: string; text: string; usage: OpenAISearchUsage; error: string | null }

/** Read a page the application cannot fetch itself (Reddit) through the hosted browsing tool. */
export async function readWithOpenAI(url: string, maxChars: number): Promise<OpenAIRead> {
  const usage = { input_tokens: 0, output_tokens: 0 }
  if (!process.env.OPENAI_API_KEY) return { url, text: '', usage, error: 'OPENAI_API_KEY is not set' }
  try {
    const response = await openai().responses.create(
      {
        model: SEARCH_MODEL,
        reasoning: { effort: 'low' },
        tools: [{ type: 'web_search', external_web_access: true }],
        tool_choice: 'required',
        ...({ max_tool_calls: 3 } as object),
        include: ['web_search_call.action.sources'],
        instructions: READ_INSTRUCTIONS,
        input: url,
        max_output_tokens: 4000,
      },
      { timeout: 75_000 },
    )
    usage.input_tokens = response.usage?.input_tokens ?? 0
    usage.output_tokens = response.usage?.output_tokens ?? 0
    const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
    const opened = audit.actions.some((action) => action.type === 'open_page' && action.url && sameHostAndPath(action.url, url))
    const text = audit.text.trim()
    if (!opened || !text || /^UNAVAILABLE\b/.test(text)) return { url, text: '', usage, error: opened ? 'page unavailable' : 'page not opened by the tool' }
    return { url, text: text.slice(0, maxChars), usage, error: null }
  } catch (error) {
    return { url, text: '', usage, error: (error as Error).message.slice(0, 120) }
  }
}

function sameHostAndPath(a: string, b: string) {
  try {
    const x = new URL(a)
    const y = new URL(b)
    const norm = (u: URL) => `${u.hostname.replace(/^(www|old|new)\./, '')}${u.pathname.replace(/\/+$/, '').replace(/\.json$/, '')}`
    return norm(x) === norm(y)
  } catch {
    return false
  }
}
