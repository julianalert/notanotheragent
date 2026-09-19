/**
 * First-touch attribution: which campaign, site or page brought a visitor who later created a radar.
 * Shared by the browser (capture) and the API (validation). Holds no personal data: the referrer is kept as a host
 * only, the landing page as a path without its query string.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

export type Attribution = {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  referrer: string | null
  landing_path: string | null
}

const MAX_LENGTH = 120

function clean(value: unknown) {
  if (typeof value !== 'string') return null
  // Printable text only; anything else in a campaign tag is noise or an injection attempt.
  const text = value.replace(/[^\p{L}\p{N} ._~:/+@()'&-]/gu, '').trim().slice(0, MAX_LENGTH)
  return text || null
}

function cleanHost(value: unknown) {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase().replace(/^www\./, '')
  return /^[a-z0-9.-]{1,253}$/.test(host) && host.includes('.') ? host : null
}

function cleanPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null
  const path = value.split(/[?#]/)[0].slice(0, MAX_LENGTH)
  // Private links carry secrets in the path: never keep one.
  if (/^\/(r|api|unsubscribe)(\/|$)/.test(path)) return null
  return /^[\w\-./~%]*$/.test(path) ? path : null
}

/** Validates untrusted input (a request body). Returns null when nothing usable is left. */
export function parseAttribution(input: unknown): Attribution | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Record<string, unknown>
  const result: Attribution = {
    utm_source: clean(source.utm_source),
    utm_medium: clean(source.utm_medium),
    utm_campaign: clean(source.utm_campaign),
    utm_term: clean(source.utm_term),
    utm_content: clean(source.utm_content),
    referrer: cleanHost(source.referrer),
    landing_path: cleanPath(source.landing_path),
  }
  return Object.values(result).some(Boolean) ? result : null
}

/** True when the touch names a campaign or an outside site, as opposed to a direct visit. */
export function hasSource(attribution: Attribution | null) {
  return Boolean(attribution && (attribution.referrer || UTM_KEYS.some((key) => attribution[key])))
}
