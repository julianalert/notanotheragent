import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * Resend webhooks (email opened, clicked, bounced, complained) are signed the Svix way:
 * base64(HMAC-SHA256(secret, `${svix-id}.${svix-timestamp}.${body}`)), the secret being the base64 part of `whsec_…`.
 */

const TOLERANCE_SECONDS = 5 * 60

export function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  payload: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt) || Math.abs(nowSeconds - sentAt) > TOLERANCE_SECONDS) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest()
  // The header may list several signatures ("v1,abc v1,def") while secrets rotate.
  return signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',')
    if (version !== 'v1' || !value) return false
    const given = Buffer.from(value, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

/** Tags come back as an object in current payloads and as a list of {name, value} in older ones. */
export function tagsFrom(data: unknown): Record<string, string> {
  const tags = (data as { tags?: unknown } | null)?.tags
  if (Array.isArray(tags)) {
    return Object.fromEntries(
      tags
        .filter((tag): tag is { name: string; value: string } => typeof tag?.name === 'string' && typeof tag?.value === 'string')
        .map((tag) => [tag.name, tag.value]),
    )
  }
  if (tags && typeof tags === 'object') {
    return Object.fromEntries(Object.entries(tags).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  }
  return {}
}

/**
 * What kind of link was clicked, without keeping the link: email links to the desk carry the private token.
 */
export function linkKind(link: unknown, appOrigin: string): 'activate' | 'lead' | 'desk' | 'unsubscribe' | 'source' | 'other' {
  if (typeof link !== 'string') return 'other'
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return 'other'
  }
  let appHost = ''
  try {
    appHost = new URL(appOrigin).host
  } catch {
    // Unknown app origin: every link counts as outside.
  }
  if (url.host !== appHost) return 'source'
  if (url.pathname.startsWith('/api/unsubscribe/') || url.pathname.startsWith('/unsubscribe/')) return 'unsubscribe'
  if (url.pathname.startsWith('/r/')) {
    if (url.hash === '#activate') return 'activate'
    if (url.hash.startsWith('#lead-')) return 'lead'
    return 'desk'
  }
  return 'other'
}
