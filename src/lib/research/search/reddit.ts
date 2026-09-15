import { CONNECTOR_TIMEOUT_MS, isoDayOf, type ConnectorResult, type SearchHit, type SearchRequest } from './types'

/*
 * Reddit: post search sorted by newest and a subreddit's newest posts (for watching).
 *
 * Since May 2026 Reddit grants API access only to approved partners and answers every other server request with
 * HTTP 403, including the public .json endpoints. This connector therefore runs only when partner credentials
 * (REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET) are configured. By default Reddit posts reach the pipeline through
 * Exa (search restricted to reddit.com, and /contents for page text).
 */

const USER_AGENT = process.env.REDDIT_USER_AGENT || 'web:lead-radar:1.0 (public post search)'

type RedditPost = {
  id: string
  title?: string
  selftext?: string
  subreddit?: string
  author?: string
  permalink?: string
  created_utc?: number
  num_comments?: number
  over_18?: boolean
  is_self?: boolean
  removed_by_category?: string | null
}
type Listing = { data?: { children?: Array<{ kind: string; data: RedditPost }> } }

export const redditConfigured = () => Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET)

let token: { value: string; expiresAt: number } | null = null

/** Application-only OAuth token (client_credentials), cached until shortly before it expires. */
async function accessToken() {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value
  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64')
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'user-agent': USER_AGENT, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Reddit token HTTP ${response.status}`)
  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('Reddit token missing')
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return token.value
}

/**
 * Fetch a Reddit JSON resource by its www.reddit.com path (search, listing, or a post's .json). Uses the OAuth API
 * when configured, the public endpoint otherwise.
 */
export async function redditJson<T>(pathWithQuery: string): Promise<T> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/json' }
  let url = `https://www.reddit.com${pathWithQuery}`
  if (redditConfigured()) {
    headers.authorization = `Bearer ${await accessToken()}`
    url = `https://oauth.reddit.com${pathWithQuery.replace(/\.json(?=\?|$)/, '')}`
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (!/json/i.test(type)) throw new Error('non-JSON response (blocked)')
  return (await response.json()) as T
}

function toHit(post: RedditPost, topic: string): SearchHit | null {
  if (!post.permalink || post.over_18 || post.removed_by_category) return null
  const day = isoDayOf(post.created_utc ?? null)
  const body = (post.selftext ?? '').replace(/\s+/g, ' ').trim()
  const header = `r/${post.subreddit} · u/${post.author} · posted ${day ?? 'unknown date'}`
  const text = body ? `${header}\n${post.title ?? ''}\n${body}` : null
  return {
    url: `https://www.reddit.com${post.permalink}`,
    title: (post.title ?? '').trim(),
    snippet: body.slice(0, 400) || (post.title ?? ''),
    text: text && text.length >= 200 ? text : null,
    publishedDate: day,
    connector: 'reddit',
    topic,
    community: post.subreddit ? `r/${post.subreddit.toLowerCase()}` : null,
  }
}

/** Newest posts matching the query; `t=year` covers every window the pipeline uses, dates are filtered later. */
export async function searchReddit(request: SearchRequest): Promise<ConnectorResult> {
  const params = new URLSearchParams({ q: request.query, sort: 'new', t: 'year', limit: String(request.limit), raw_json: '1', type: 'link' })
  const sub = request.domains.find((domain) => /^reddit\.com\/r\//i.test(domain))?.replace(/^reddit\.com\/r\//i, '')
  const path = sub ? `/r/${encodeURIComponent(sub)}/search.json?restrict_sr=1&${params}` : `/search.json?${params}`
  try {
    const data = await redditJson<Listing>(path)
    const hits = (data.data?.children ?? []).map((child) => toHit(child.data, request.query)).filter((hit): hit is SearchHit => Boolean(hit))
    return { connector: 'reddit', hits, costUsd: 0, error: null }
  } catch (error) {
    return { connector: 'reddit', hits: [], costUsd: 0, error: (error as Error).message.slice(0, 120) }
  }
}

/** A subreddit's newest posts, for watched sources. */
export async function subredditNew(subreddit: string, limit: number): Promise<ConnectorResult> {
  const name = subreddit.replace(/^r\//i, '')
  try {
    const data = await redditJson<Listing>(`/r/${encodeURIComponent(name)}/new.json?limit=${limit}&raw_json=1`)
    const hits = (data.data?.children ?? []).map((child) => toHit(child.data, `r/${name} new posts`)).filter((hit): hit is SearchHit => Boolean(hit))
    return { connector: 'reddit', hits, costUsd: 0, error: null }
  } catch (error) {
    return { connector: 'reddit', hits: [], costUsd: 0, error: (error as Error).message.slice(0, 120) }
  }
}
