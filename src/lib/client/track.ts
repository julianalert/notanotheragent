/*
 * Marketing-page events for Simple Analytics (loaded only on public pages, see (marketing)/analytics.tsx).
 * Events on private pages go to our own `events` table instead (trackDesk), because the page path holds a secret.
 */

declare global {
  interface Window {
    sa_event?: (name: string, callback?: () => void) => void
  }
}

export type MarketingEvent = 'website_submitted' | 'email_submitted' | 'existing_radar_opened'

/** Fire an event and resolve once it is sent, or after a short wait so a navigation right after is never blocked. */
export function track(name: MarketingEvent): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 400)
    try {
      if (typeof window.sa_event !== 'function') throw new Error('not loaded')
      window.sa_event(name, () => {
        clearTimeout(timer)
        resolve()
      })
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

export type DeskEvent =
  | 'desk_viewed'
  | 'lead_opened'
  | 'draft_copied'
  | 'reply_clicked'
  | 'draft_rewritten'
  | 'source_opened'
  | 'private_link_copied'
  | 'focus_saved'
  | 'webhook_saved'

/** Record a product event for this radar. Fire and forget: tracking never gets in the user's way. */
export function trackDesk(token: string, name: DeskEvent, props?: Record<string, string>) {
  try {
    void fetch('/api/radar/events', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'x-radar-token': token },
      body: JSON.stringify({ name, props }),
    }).catch(() => undefined)
  } catch {
    // Ignore: best effort.
  }
}
