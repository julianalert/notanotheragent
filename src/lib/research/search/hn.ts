import { htmlToText } from '../pages'
import { CONNECTOR_TIMEOUT_MS, isoDayOf, type ConnectorResult, type SearchHit, type SearchRequest } from './types'

/*
 * Hacker News through Algolia's public search API (stories and comments, newest first, free).
 * https://hn.algolia.com/api
 */

type Hit = {
  objectID: string
  title?: string | null
  story_title?: string | null
  story_text?: string | null
  comment_text?: string | null
  url?: string | null
  author?: string
  created_at?: string
  created_at_i?: number
  story_id?: number
  _tags?: string[]
}

export async function searchHackerNews(request: SearchRequest): Promise<ConnectorResult> {
  const since = Math.floor(Date.parse(`${request.windowStart}T00:00:00Z`) / 1000)
  const params = new URLSearchParams({
    query: request.query,
    tags: '(story,comment)',
    numericFilters: `created_at_i>${since}`,
    hitsPerPage: String(request.limit),
  })
  try {
    const response = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { hits?: Hit[] }
    const hits = (data.hits ?? []).map((hit) => toHit(hit, request.query)).filter((hit): hit is SearchHit => Boolean(hit))
    return { connector: 'hn', hits, costUsd: 0, error: null }
  } catch (error) {
    return { connector: 'hn', hits: [], costUsd: 0, error: (error as Error).message.slice(0, 120) }
  }
}

function toHit(hit: Hit, topic: string): SearchHit | null {
  const isComment = hit._tags?.includes('comment')
  const raw = isComment ? (hit.comment_text ?? '') : (hit.story_text ?? '')
  const body = raw ? htmlToText(`<p>${raw}</p>`, 6000).text : ''
  const title = (isComment ? hit.story_title : hit.title) ?? ''
  if (!body && !title) return null
  const day = isoDayOf(hit.created_at_i ?? hit.created_at ?? null)
  const header = `Hacker News · ${hit.author ?? 'unknown'} · posted ${day ?? 'unknown date'}${isComment ? ` · comment on "${title}"` : ''}`
  const text = `${header}\n${isComment ? '' : `${title}\n`}${body}`.trim()
  return {
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    title: isComment ? `Comment on: ${title}` : title,
    snippet: body.slice(0, 400) || title,
    text: text.length >= 200 ? text : null,
    publishedDate: day,
    connector: 'hn',
    topic,
    community: 'hackernews',
  }
}
