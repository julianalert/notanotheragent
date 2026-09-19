/** Browser-side calls shared by the marketing forms and the desk. */

import { storedAttribution } from './attribution'

export type CheckWebsiteResult = { ok: true; host: string; existingToken: string | null } | { ok: false; error: string }

/** Home step 1: validates the website without starting research. */
export async function checkWebsite(website: string): Promise<CheckWebsiteResult> {
  try {
    const response = await fetch('/api/radars/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, error: body.error ?? 'Something went wrong. Please try again.' }
    return { ok: true, host: body.host, existingToken: body.existingToken ?? null }
  } catch {
    return { ok: false, error: 'We could not reach the server. Check your connection and try again.' }
  }
}

export type CreateRadarResult =
  | { ok: true; token: string }
  | { ok: false; error: string; field: 'website' | 'email' | null }

/** Creates the radar and starts research. `email` may be omitted when this browser already gave one. */
export async function createRadar(website: string, email?: string): Promise<CreateRadarResult> {
  try {
    const response = await fetch('/api/radars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        website,
        email,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        attribution: storedAttribution(),
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.token) {
      return { ok: false, error: body.error ?? 'Something went wrong. Please try again.', field: body.field ?? null }
    }
    return { ok: true, token: body.token }
  } catch {
    return { ok: false, error: 'We could not reach the server. Check your connection and try again.', field: null }
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
