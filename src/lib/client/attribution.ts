import { hasSource, parseAttribution, UTM_KEYS, type Attribution } from '../attribution'

/*
 * Browser side of first-touch attribution. The marketing pages record where the visitor came from; the radar
 * creation request carries it to the server. Stored in localStorage (no cookie), kept for 30 days.
 */

const STORAGE_KEY = 'nna_first_touch'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

type Stored = Attribution & { at: number }

function read(): Stored | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Stored | null
    if (!stored || typeof stored.at !== 'number' || Date.now() - stored.at > MAX_AGE_MS) return null
    return stored
  } catch {
    return null
  }
}

/** Record this visit unless an earlier one already explains where the visitor came from. */
export function captureAttribution() {
  try {
    const url = new URL(window.location.href)
    let referrer: string | null = null
    if (document.referrer) {
      const host = new URL(document.referrer).host
      if (host && host !== url.host) referrer = host
    }
    const touch = parseAttribution({
      ...Object.fromEntries(UTM_KEYS.map((key) => [key, url.searchParams.get(key)])),
      // Ads and newsletters often tag only `ref` or `source`.
      utm_source: url.searchParams.get('utm_source') ?? url.searchParams.get('ref') ?? url.searchParams.get('source'),
      referrer,
      landing_path: url.pathname,
    })
    if (!touch) return
    const existing = read()
    // First touch wins, except that a campaign or referral replaces an earlier direct visit.
    if (existing && (hasSource(existing) || !hasSource(touch))) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...touch, at: Date.now() }))
  } catch {
    // Storage blocked (private mode, disabled site data): attribution is best effort.
  }
}

/** The stored first touch, sent along when a radar is created. */
export function storedAttribution(): Attribution | null {
  const stored = read()
  if (!stored) return null
  const { at: _at, ...attribution } = stored // eslint-disable-line @typescript-eslint/no-unused-vars
  return parseAttribution(attribution)
}
