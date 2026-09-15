import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/*
 * Emails must contain the private link, but only a hash of the token is used for access control. The token is
 * therefore also stored encrypted (AES-256-GCM) once the visitor gives an email, and decrypted only to build the
 * email. Keys derive from APP_SECRET with separate labels so encryption and unsubscribe signing never share a key.
 */

const DEV_SECRET = 'lead-radar-development-secret-do-not-use-in-production'

function appSecret() {
  const secret = process.env.APP_SECRET
  if (secret && secret.length >= 32) return secret
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('APP_SECRET must be set (at least 32 characters) to send emails with private links.')
  }
  return DEV_SECRET
}

function key(label: string) {
  return createHmac('sha256', appSecret()).update(`lead-radar:${label}`).digest()
}

export function encryptToken(token: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key('token-encryption'), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

export function decryptToken(value: string) {
  const [version, iv, tag, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported token ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key('token-encryption'), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}

/** Unsubscribe links carry the radar id plus a signature, never the private token. */
export function unsubscribeCode(radarId: string) {
  const signature = createHmac('sha256', key('unsubscribe')).update(radarId).digest('base64url').slice(0, 32)
  return `${radarId}.${signature}`
}

export function verifyUnsubscribeCode(code: unknown): string | null {
  if (typeof code !== 'string') return null
  const [radarId, signature] = code.split('.')
  if (!radarId || !signature || !/^[0-9a-f-]{36}$/i.test(radarId)) return null
  const expected = unsubscribeCode(radarId).split('.')[1]
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b) ? radarId : null
}

export function normaliseEmail(input: unknown): { ok: true; email: string } | { ok: false; error: string } {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Enter your email address.' }
  const email = input.trim()
  if (email.length > 254 || !/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,63}$/i.test(email)) {
    return { ok: false, error: 'That doesn’t look like an email address. Try something like you@youragency.com.' }
  }
  const [local, domain] = email.split('@')
  return { ok: true, email: `${local}@${domain.toLowerCase()}` }
}

/** j•••@agency.com — shown on the private page, which anyone with the link can open. */
export function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 1)}•••@${domain}`
}
