import { SOURCE_PAGE_CHARS } from '../contract'
import { CONNECTOR_TIMEOUT_MS, isoDayOf, type ConnectorResult, type SearchRequest } from './types'

/*
 * Exa search: semantic search over the web with publication-date filtering, and the page text in the same
 * response, so most hits need no separate fetch. https://exa.ai/docs/reference/search
 */

const ENDPOINT = 'https://api.exa.ai/search'

type ExaResult = { id?: string; url: string; title: string | null; publishedDate?: string | null; author?: string | null; text?: string }
type ExaResponse = { results?: ExaResult[]; costDollars?: { total?: number } }

export const exaConfigured = () => Boolean(process.env.EXA_API_KEY)

export async function searchExa(request: SearchRequest, options: { includeDomains?: string[] } = {}): Promise<ConnectorResult> {
  const failed = (error: string): ConnectorResult => ({ connector: 'exa', hits: [], costUsd: 0, error })
  const key = process.env.EXA_API_KEY
  if (!key) return failed('EXA_API_KEY is not set')
  const includeDomains = [...(options.includeDomains ?? []), ...request.domains].filter(Boolean)
  const body = {
    query: request.query,
    type: 'auto',
    numResults: request.limit,
    startPublishedDate: `${request.windowStart}T00:00:00.000Z`,
    contents: { text: { maxCharacters: SOURCE_PAGE_CHARS } },
    ...(includeDomains.length ? { includeDomains } : {}),
  }
  let response: Response
  try {
    const send = () =>
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
      })
    response = await send()
    // Topics run side by side and Exa limits requests per second: a rate-limited search waits and tries once more
    // instead of silently returning nothing for its topic.
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1500))
      response = await send()
    }
  } catch (error) {
    return failed(`network: ${(error as Error).message.slice(0, 120)}`)
  }
  if (!response.ok) return failed(`HTTP ${response.status}`)
  const data = (await response.json().catch(() => ({}))) as ExaResponse
  const hits = (data.results ?? [])
    .filter((result) => typeof result.url === 'string')
    .map((result) => {
      const text = (result.text ?? '').trim()
      return {
        url: result.url,
        title: (result.title ?? '').trim(),
        snippet: text.slice(0, 400),
        text: text.length >= 200 ? text : null,
        publishedDate: isoDayOf(result.publishedDate ?? null),
        connector: 'exa' as const,
        topic: request.query,
        community: communityOf(result.url),
      }
    })
  return { connector: 'exa', hits, costUsd: Number(data.costDollars?.total ?? 0) || 0, error: null }
}

export type ExaContent = { url: string; title: string; text: string; publishedDate: string | null; error: string | null }

/**
 * Page text for URLs the application cannot fetch itself (Reddit, X, LinkedIn and other sites that block servers).
 * Cached by Exa when recent enough, live-crawled otherwise. https://exa.ai/docs/reference/get-contents
 */
export async function exaContents(urls: string[], maxChars: number = SOURCE_PAGE_CHARS): Promise<{ results: ExaContent[]; costUsd: number }> {
  const key = process.env.EXA_API_KEY
  if (!key || !urls.length) return { results: [], costUsd: 0 }
  let response: Response
  try {
    response = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ urls: urls.slice(0, 100), text: { maxCharacters: maxChars }, maxAgeHours: 24 }),
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS * 2),
    })
  } catch (error) {
    return { results: urls.map((url) => ({ url, title: '', text: '', publishedDate: null, error: `network: ${(error as Error).message.slice(0, 80)}` })), costUsd: 0 }
  }
  if (!response.ok) return { results: urls.map((url) => ({ url, title: '', text: '', publishedDate: null, error: `HTTP ${response.status}` })), costUsd: 0 }
  const data = (await response.json().catch(() => ({}))) as {
    results?: ExaResult[]
    statuses?: Array<{ id: string; status: string; error?: { tag?: string; httpStatusCode?: number } }>
    costDollars?: { total?: number }
  }
  const byUrl = new Map((data.results ?? []).map((result) => [result.url, result]))
  const failures = new Map((data.statuses ?? []).filter((status) => status.status !== 'success').map((status) => [status.id, status.error?.tag ?? 'error']))
  const results = urls.map((url) => {
    const result = byUrl.get(url)
    const text = (result?.text ?? '').trim()
    return {
      url,
      title: (result?.title ?? '').trim(),
      text,
      publishedDate: isoDayOf(result?.publishedDate ?? null),
      error: text ? null : (failures.get(url) ?? 'no text returned'),
    }
  })
  return { results, costUsd: Number(data.costDollars?.total ?? 0) || 0 }
}

/** Subreddit for Reddit URLs; otherwise null (other communities are learned from the URL host). */
export function communityOf(input: string) {
  try {
    const url = new URL(input)
    const sub = url.hostname.endsWith('reddit.com') ? url.pathname.match(/^\/r\/([^/]+)/i)?.[1] : null
    return sub ? `r/${sub.toLowerCase()}` : null
  } catch {
    return null
  }
}
