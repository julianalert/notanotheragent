import 'server-only'
import { query } from './db'
import { toJsonb } from './jsonb'

/**
 * Product events, the funnel's source of truth past the marketing pages (see scripts/funnel.ts).
 * Props are short labels only: never tokens, emails, URLs or message text.
 */
export type EventName =
  // Desk (sent by the browser through /api/radar/events).
  | 'desk_viewed'
  | 'lead_opened'
  | 'draft_copied'
  | 'reply_clicked'
  | 'draft_rewritten'
  | 'source_opened'
  | 'private_link_copied'
  | 'focus_saved'
  | 'webhook_saved'
  // Server.
  | 'checkout_started'
  | 'plan_changed'
  | 'email_opened'
  | 'email_clicked'
  | 'email_bounced'
  | 'email_complained'

export const DESK_EVENTS = new Set<EventName>([
  'desk_viewed',
  'lead_opened',
  'draft_copied',
  'reply_clicked',
  'draft_rewritten',
  'source_opened',
  'private_link_copied',
  'focus_saved',
  'webhook_saved',
])

const MAX_PROPS = 6

/** Keep only short slug-like labels, so free text can never leak into the table. */
export function cleanProps(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const props: Record<string, string> = {}
  for (const [key, value] of Object.entries(input).slice(0, MAX_PROPS)) {
    if (!/^[a-z_]{1,32}$/.test(key)) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    const label = String(value).slice(0, 64)
    if (/^[\w.:-]+$/.test(label)) props[key] = label
  }
  return props
}

/** Store one event. Never throws: losing an event must not break the action it describes. */
export async function recordEvent(
  radarId: string | null,
  name: EventName,
  props: Record<string, string> = {},
  dedupeKey: string | null = null,
) {
  try {
    await query(
      `insert into events (radar_id, name, props, dedupe_key) values ($1, $2, $3::jsonb, $4) on conflict (dedupe_key) do nothing`,
      [radarId, name, toJsonb(cleanProps(props)), dedupeKey],
    )
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'events.record_failed', name, error: (error as Error).message.slice(0, 200) }))
  }
}
