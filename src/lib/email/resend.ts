export type OutgoingEmail = {
  to: string
  subject: string
  html: string
  text: string
  /** Resend de-duplicates repeated sends with the same key (24 h), so a retried tick never double-sends. */
  idempotencyKey: string
  unsubscribeUrl: string
}

export type SendResult = { ok: true; id: string | null; preview?: string } | { ok: false; retryable: boolean; error: string }

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      return { ok: false, retryable: false, error: 'RESEND_API_KEY and EMAIL_FROM are not configured' }
    }
    // Development: write the email to disk so it can be opened and checked instead of sending it.
    const path = await import('node:path')
    const fs = await import('node:fs/promises')
    const dir = path.join(process.cwd(), '.data', 'emails')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${email.idempotencyKey}.html`)
    await fs.writeFile(file, email.html)
    return { ok: true, id: null, preview: file }
  }

  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: {
          'List-Unsubscribe': `<${email.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    return { ok: false, retryable: true, error: `Network error: ${(error as Error).message}` }
  }

  const body = await response.json().catch(() => ({}))
  if (response.ok) return { ok: true, id: body?.id ?? null }
  const message = body?.message ?? `Resend HTTP ${response.status}`
  // 429 and 5xx are transient; 4xx (invalid recipient, unverified domain, bad key) will not fix themselves.
  return { ok: false, retryable: response.status === 429 || response.status >= 500, error: message }
}
