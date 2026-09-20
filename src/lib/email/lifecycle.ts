import 'server-only'
import { trialEndsAt } from '../billing/subscription'
import { config } from '../config'
import { decryptToken, unsubscribeCode } from '../crypto'
import { query } from '../db'
import type { LeadT } from '../research/contract'
import { appUrl } from '../site'
import { emailConfigured, sendEmail } from './resend'
import { renderLifecycleEmail, type LifecycleKind } from './templates'

/*
 * The free trial's emails. Run emails follow research; these follow the trial's clock, for radars that never paid:
 *
 *   trial_ending     the day before the trial ends: what it found, what happens tomorrow
 *   trial_ended      when it ends: the agent is asleep, how to wake it
 *   missed_matches   two days later: how many new posts look like buyers (a search-and-triage probe, a few cents);
 *                    not sent when the probe finds nothing
 *   last_call        a week after the end: a customer's words, and the promise that this is the last one
 *
 * Each kind has a window; outside it the email is never sent, so radars older than the trial get nothing when this
 * ships. Later emails need the earlier ones, so a radar that never had a trial never hears that it ended. Everything
 * stops the moment the radar is activated or the address unsubscribes. One row per radar and kind in
 * lifecycle_emails is the claim: concurrent ticks never send twice.
 */

const MAX_PER_TICK = 10
const MAX_ATTEMPTS = 3
/** Sent in the radar's daytime only. */
const SEND_HOURS = { from: 8, until: 20 }

type Probe = (radarId: string, since: Date) => Promise<{ count: number; titles: string[]; costUsd: number } | null>

type Step = { kind: LifecycleKind; fromHours: number; untilHours: number; requires: { kind: LifecycleKind; sent: boolean } | null }

/** Windows in hours since the radar was created, for a trial of `days`. */
export function lifecycleSteps(days: number): Step[] {
  const end = days * 24
  return [
    { kind: 'trial_ending', fromHours: Math.max(1, end - 24), untilHours: end - 2, requires: null },
    { kind: 'trial_ended', fromHours: end, untilHours: end + 24, requires: { kind: 'trial_ending', sent: false } },
    { kind: 'missed_matches', fromHours: end + 48, untilHours: end + 96, requires: { kind: 'trial_ended', sent: true } },
    { kind: 'last_call', fromHours: end + 7 * 24, untilHours: end + 9 * 24, requires: { kind: 'trial_ended', sent: true } },
  ]
}

export function localHour(now: Date, timeZone: string) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now))
  } catch {
    return now.getUTCHours()
  }
}

function log(event: string, details: Record<string, unknown>) {
  // Never log email addresses, tokens or private URLs.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }))
}

type DueRadar = { id: string; email: string; token_ciphertext: string; website_host: string; timezone: string; created_at: Date }

let tableMissingLogged = false

export async function sendLifecycleEmails(probe: Probe) {
  if (!(config.trialDays > 0)) return
  // Same rule as run emails: a local server on a shared database leaves sending to production.
  if (process.env.DATABASE_URL && !process.env.VERCEL && (!emailConfigured() || !process.env.APP_URL)) return

  const now = new Date()
  let sent = 0
  for (const step of lifecycleSteps(config.trialDays)) {
    let due: DueRadar[]
    try {
      due = await query<DueRadar>(
        `select r.id, r.email, r.token_ciphertext, r.website_host, r.timezone, r.created_at from radars r
         where r.plan = 'free' and r.email is not null and r.token_ciphertext is not null and r.email_unsubscribed_at is null
           and r.profile is not null
           and r.created_at <= now() - ($2 || ' hours')::interval and r.created_at > now() - ($3 || ' hours')::interval
           and not exists (
             select 1 from lifecycle_emails le where le.radar_id = r.id and le.kind = $1
               and not (le.status = 'failed' and le.attempts < $4 and le.updated_at < now() - interval '10 minutes'))
           and ($5::text is null or exists (
             select 1 from lifecycle_emails le where le.radar_id = r.id and le.kind = $5 and ($6::boolean is not true or le.status = 'sent')))
         order by r.created_at limit $7`,
        [step.kind, String(step.fromHours), String(step.untilHours), MAX_ATTEMPTS, step.requires?.kind ?? null, step.requires?.sent ?? false, MAX_PER_TICK],
      )
    } catch (error) {
      // Deployed before migration 011: the trial works, its emails wait for the table.
      if ((error as { code?: string }).code === '42P01') {
        if (!tableMissingLogged) log('email.lifecycle_table_missing', {})
        tableMissingLogged = true
        return
      }
      throw error
    }

    for (const radar of due) {
      if (sent >= MAX_PER_TICK) return
      const hour = localHour(now, radar.timezone)
      if (hour < SEND_HOURS.from || hour >= SEND_HOURS.until) continue
      const [claim] = await query<{ id: string }>(
        `insert into lifecycle_emails (radar_id, kind, status) values ($1, $2, 'sending')
         on conflict (radar_id, kind) do update set status = 'sending', attempts = lifecycle_emails.attempts + 1, updated_at = now()
           where lifecycle_emails.status = 'failed' and lifecycle_emails.attempts < $3
         returning id`,
        [radar.id, step.kind, MAX_ATTEMPTS],
      )
      if (!claim) continue
      const outcome = await deliver(radar, step.kind, probe).catch((error) => ({ status: 'failed' as const, detail: (error as Error).message.slice(0, 300), costUsd: null }))
      await query(`update lifecycle_emails set status = $2, detail = $3, cost_usd = coalesce($4, cost_usd), updated_at = now() where id = $1`, [
        claim.id,
        outcome.status,
        outcome.detail,
        outcome.costUsd === null ? null : outcome.costUsd.toFixed(4),
      ])
      log('email.lifecycle', { radar: radar.id, kind: step.kind, status: outcome.status })
      if (outcome.status === 'sent') sent++
    }
  }
}

type Outcome = { status: 'sent' | 'skipped' | 'failed'; detail: string | null; costUsd: number | null }

async function deliver(radar: DueRadar, kind: LifecycleKind, probe: Probe): Promise<Outcome> {
  let missed: { count: number; titles: string[] } | undefined
  let costUsd: number | null = null
  if (kind === 'missed_matches') {
    const result = await probe(radar.id, trialEndsAt(new Date(radar.created_at), config.trialDays))
    if (!result) return { status: 'skipped', detail: 'no provider can look for new posts', costUsd }
    costUsd = result.costUsd
    if (result.count === 0) return { status: 'skipped', detail: 'nothing new to show', costUsd }
    missed = { count: result.count, titles: result.titles }
  }

  const [stats] = await query<{ found: number; contacted: number }>(
    `select count(*)::int as found, count(*) filter (where user_status = 'contacted')::int as contacted
     from leads where radar_id = $1 and held_reason is null`,
    [radar.id],
  )
  const open = await query<{ id: string; data: LeadT }>(
    `select id, data from leads where radar_id = $1 and held_reason is null and user_status = 'new'
     order by score_total desc, published_date desc limit 2`,
    [radar.id],
  )

  const unsubscribeUrl = `${appUrl()}/api/unsubscribe/${unsubscribeCode(radar.id)}`
  const email = renderLifecycleEmail({
    kind,
    websiteHost: radar.website_host,
    privateUrl: `${appUrl()}/r/${decryptToken(radar.token_ciphertext)}`,
    unsubscribeUrl,
    priceUsd: config.planPriceUsd,
    trialDays: config.trialDays,
    found: stats.found,
    contacted: stats.contacted,
    open,
    missed,
  })
  const result = await sendEmail({
    to: radar.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `lifecycle-${radar.id}-${kind}`,
    unsubscribeUrl,
    tags: { radar_id: radar.id, kind, plan: 'free' },
  })
  if (result.ok) return { status: 'sent', detail: null, costUsd }
  // Not retryable: three attempts would change nothing, so the row is closed.
  return { status: result.retryable ? 'failed' : 'skipped', detail: result.error.slice(0, 300), costUsd }
}
