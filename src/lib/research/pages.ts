import { safeOutgoingUrl } from '../url'
import { redditConfigured, redditJson } from './search/reddit'

/*
 * Page reading for the research pipeline. The application fetches pages itself so the expensive model reads each
 * source once, as plain text, instead of paying for a hosted browsing loop. Every hop is checked as a public
 * http(s) URL. Pages that can't be fetched here fall back to the search tool's reader (see pipeline.ts).
 */

const FETCH_TIMEOUT_MS = 8_000
const MAX_BODY_BYTES = 2_000_000
const MAX_REDIRECTS = 4
const USER_AGENT = 'LeadRadar/1.0 (public page reader)'

export type FetchedPage = {
  url: string
  finalUrl: string
  ok: boolean
  title: string
  text: string
  /** Publication dates found in page metadata, most specific first (YYYY-MM-DD). */
  dateHints: string[]
  error: string | null
}

async function fetchPublic(input: string, accept: string) {
  let url = safeOutgoingUrl(input)
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = safeOutgoingUrl(new URL(response.headers.get('location')!, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
    return { finalUrl: url, body: Buffer.concat(chunks).toString('utf8'), contentType: response.headers.get('content-type') ?? '' }
  }
  throw new Error(url ? 'too many redirects' : 'not a public URL')
}

/* ------------------------------- HTML → text ------------------------------- */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match
    }
    return ENTITIES[name.toLowerCase()] ?? match
  })
}

const isoDay = (value: string | null | undefined) => {
  const match = value?.match(/(\d{4}-\d{2}-\d{2})/)
  return match && !Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)) ? match[1] : null
}

export function htmlToText(html: string, maxChars: number) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const description = decodeEntities(
    html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? '',
  ).trim()
  const dateHints = [
    ...html.matchAll(/<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|datePublished|date|pubdate)["'][^>]*content=["']([^"']+)["']/gi),
    ...html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/g),
    ...html.matchAll(/<time[^>]+datetime=["']([^"']+)["']/gi),
  ]
    .map((match) => isoDay(match[1]))
    .filter((day): day is string => Boolean(day))

  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|br|tr|td|th|blockquote|pre|header|main)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  const full = [description && !text.includes(description) ? description : '', text].filter(Boolean).join('\n')
  return { title, text: full.slice(0, maxChars), dateHints: [...new Set(dateHints)] }
}

/* --------------------------------- Reddit --------------------------------- */

type RedditThing = { kind: string; data: Record<string, unknown> }
const redditDay = (utc: unknown) => (typeof utc === 'number' ? new Date(utc * 1000).toISOString().slice(0, 10) : null)

/** Reddit serves JSON for any post or comment permalink; far cleaner than its HTML. Returns the path with query. */
export function redditJsonUrl(input: string) {
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase()
    if (!/(^|\.)reddit\.com$/.test(host) || !/\/comments\/[a-z0-9]+/i.test(url.pathname)) return null
    return `${url.pathname.replace(/\/+$/, '').replace(/\.json$/i, '')}.json?limit=12&depth=2&raw_json=1`
  } catch {
    return null
  }
}

export function redditToText(json: unknown, maxChars: number) {
  const listings = Array.isArray(json) ? (json as Array<{ data?: { children?: RedditThing[] } }>) : []
  const post = listings[0]?.data?.children?.[0]?.data
  if (!post) return null
  const lines = [
    `r/${post.subreddit} · u/${post.author} · posted ${redditDay(post.created_utc) ?? 'unknown date'}`,
    String(post.title ?? ''),
    String(post.selftext ?? ''),
  ]
  const comments = (listings[1]?.data?.children ?? []).filter((child) => child.kind === 't1').slice(0, 10)
  if (comments.length) lines.push('', 'Comments:')
  for (const { data } of comments) {
    lines.push(`- u/${data.author} (${redditDay(data.created_utc) ?? 'unknown date'}, https://www.reddit.com${data.permalink}): ${String(data.body ?? '').replace(/\s+/g, ' ')}`)
  }
  const day = redditDay(post.created_utc)
  return { title: String(post.title ?? ''), text: lines.join('\n').slice(0, maxChars), dateHints: day ? [day] : [] }
}

/* --------------------------------- Public --------------------------------- */

export async function fetchPage(url: string, maxChars: number): Promise<FetchedPage> {
  const failed = (error: string): FetchedPage => ({ url, finalUrl: url, ok: false, title: '', text: '', dateHints: [], error })
  try {
    const reddit = redditJsonUrl(url)
    if (reddit) {
      // Reddit answers servers with 403 unless partner credentials are configured; the pipeline uses Exa's text instead.
      if (!redditConfigured()) return failed('reddit blocks server requests (no partner credentials)')
      const parsed = redditToText(await redditJson<unknown>(reddit), maxChars)
      if (!parsed) return failed('reddit returned no post')
      return { url, finalUrl: url, ok: true, ...parsed, error: null }
    }
    const { finalUrl, body, contentType } = await fetchPublic(url, 'text/html,application/xhtml+xml,text/plain;q=0.8')
    if (!/html|text\/plain|xml/i.test(contentType)) return failed(`unsupported content type ${contentType}`)
    const parsed = /html|xml/i.test(contentType) ? htmlToText(body, maxChars) : { title: '', text: body.slice(0, maxChars), dateHints: [] }
    // Script-rendered pages come back nearly empty: treat as unreadable so the reader fallback can try.
    if (parsed.text.length < 200) return failed('page has almost no readable text')
    return { url, finalUrl, ok: true, ...parsed, error: null }
  } catch (error) {
    return failed((error as Error).message.slice(0, 200))
  }
}

const OFFER_LINK = /(service|pricing|price|plans|product|feature|solution|offer|how-it-works|about|case|work|clients|tarif|prestation|offre|produit|a-propos|fonctionnement)/i

/** Internal links worth reading to understand the offer, best first. */
export function offerLinks(html: string, baseUrl: string, limit: number) {
  const base = new URL(baseUrl)
  const host = base.hostname.replace(/^www\./, '')
  const seen = new Set<string>([base.pathname.replace(/\/+$/, '') || '/'])
  const links: Array<{ url: string; score: number }> = []
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let url: URL
    try {
      url = new URL(decodeEntities(match[1]), base)
    } catch {
      continue
    }
    if (url.hostname.replace(/^www\./, '') !== host || /\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|css|js)$/i.test(url.pathname)) continue
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (seen.has(path) || /(login|signin|signup|register|cart|checkout|privacy|terms|legal|cookie|blog\/.+)/i.test(path)) continue
    seen.add(path)
    links.push({ url: `${url.origin}${path}`, score: (OFFER_LINK.test(path) ? 10 : 0) - path.split('/').length })
  }
  return links.sort((a, b) => b.score - a.score).slice(0, limit).map((link) => link.url)
}

/** The homepage plus the most offer-relevant internal pages. */
export async function readWebsite(websiteUrl: string, maxPages: number, maxChars: number) {
  let homeHtml = ''
  let home: FetchedPage
  try {
    const fetched = await fetchPublic(websiteUrl, 'text/html')
    homeHtml = fetched.body
    const parsed = htmlToText(homeHtml, maxChars)
    home = { url: websiteUrl, finalUrl: fetched.finalUrl, ok: parsed.text.length >= 200, ...parsed, error: parsed.text.length >= 200 ? null : 'homepage has almost no readable text' }
  } catch (error) {
    return [{ url: websiteUrl, finalUrl: websiteUrl, ok: false, title: '', text: '', dateHints: [], error: (error as Error).message }]
  }
  const others = await Promise.all(offerLinks(homeHtml, home.finalUrl, maxPages - 1).map((url) => fetchPage(url, maxChars)))
  return [home, ...others]
}
