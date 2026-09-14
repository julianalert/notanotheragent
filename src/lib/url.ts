import { isIP } from 'node:net'

export type UrlResult = { ok: true; url: string; host: string } | { ok: false; error: string }

const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.test', '.invalid', '.example']

function isPrivateIPv4(ip: string) {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isPublicHostname(host: string) {
  if (host === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  const bare = host.replace(/^\[|\]$/g, '')
  const version = isIP(bare)
  if (version === 4) return !isPrivateIPv4(bare)
  if (version === 6) return false
  // Require a real-looking public domain with a TLD.
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
}

/** Normalise user input like "youragency.com" into a canonical public https URL. */
export function normaliseWebsite(input: unknown): UrlResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'Enter your business website, for example youragency.com.' }
  }
  let raw = input.trim()
  if (raw.length > 2048) return { ok: false, error: 'That URL is too long.' }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: "That doesn't look like a website address. Try something like youragency.com." }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Use a website address that starts with http or https.' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Remove the username or password from the URL.' }
  }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { ok: false, error: 'Use your public website address without a custom port.' }
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!isPublicHostname(host)) {
    return { ok: false, error: 'Enter a public business website, for example youragency.com.' }
  }

  parsed.hash = ''
  parsed.hostname = host
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|gclid|fbclid|ref$|mc_)/i.test(key)) parsed.searchParams.delete(key)
  }
  let url = parsed.toString()
  if (parsed.pathname === '/' && !parsed.search) url = url.replace(/\/$/, '')
  return { ok: true, url, host: host.replace(/^www\./, '') }
}

/** Validate a URL returned by the model before it is stored or rendered as a link. */
export function safeOutgoingUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  try {
    const parsed = new URL(input.trim())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.username || parsed.password) return null
    if (!isPublicHostname(parsed.hostname.toLowerCase())) return null
    return parsed.toString()
  } catch {
    return null
  }
}
