/** Browser-side calls shared by the marketing forms and the desk. */

export type CreateRadarResult = { ok: true; token: string; hasEmail: boolean } | { ok: false; error: string }

export async function createRadar(website: string): Promise<CreateRadarResult> {
  try {
    const response = await fetch('/api/radars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        website,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.token) return { ok: false, error: body.error ?? 'Something went wrong. Please try again.' }
    return { ok: true, token: body.token, hasEmail: Boolean(body.hasEmail) }
  } catch {
    return { ok: false, error: 'We could not reach the server. Check your connection and try again.' }
  }
}

export async function saveEmail(token: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/api/radar/email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-radar-token': token },
      body: JSON.stringify({ email }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, error: body.error ?? 'Something went wrong. Please try again.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'We could not reach the server. Check your connection and try again.' }
  }
}

/** "acme.com" from whatever the visitor typed, for display only. */
export function displayHost(input: string) {
  return input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '')
}
