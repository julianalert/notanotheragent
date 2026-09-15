/*
 * Search connectors for the discovery pipeline. Each connector turns one topic into hits; the pipeline dedupes,
 * triages and reads them. Connectors never decide anything: they only report what a public source returned.
 */

export type Connector = 'exa' | 'reddit' | 'hn' | 'openai'

export type SearchHit = {
  url: string
  title: string
  /** Short preview from the connector (search snippet, first lines of a post). */
  snippet: string
  /** Full text when the connector already returned it; otherwise the read step fetches the page. */
  text: string | null
  /** YYYY-MM-DD from the connector's metadata; null when unknown. */
  publishedDate: string | null
  connector: Connector
  /** The topic query that produced the hit. */
  topic: string
  /** Community or section the hit belongs to (subreddit, HN), used to seed watched sources. */
  community: string | null
}

export type SearchRequest = {
  query: string
  /** Domain filters lifted from site: restrictions. Connectors without domain filtering ignore them. */
  domains: string[]
  /** YYYY-MM-DD lower bound on publication date. */
  windowStart: string
  limit: number
}

export type ConnectorResult = {
  connector: Connector
  hits: SearchHit[]
  /** Estimated connector cost in USD when reported (Exa). */
  costUsd: number
  error: string | null
}

export const isoDayOf = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'number' ? new Date(value * (value < 1e12 ? 1000 : 1)) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

export const CONNECTOR_TIMEOUT_MS = 20_000
