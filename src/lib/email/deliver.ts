import 'server-only'
import { decryptToken, unsubscribeCode } from '../crypto'
import { query } from '../db'
import type { LeadT, RunOutcome } from '../research/contract'
import { emailConfigured, sendEmail } from './resend'
import { renderRunEmail } from './templates'

const MAX_ATTEMPTS = 3
const MAX_PER_TICK = 20

export function appUrl() {
  const explicit = process.env.APP_URL?.replace(/\/+$/, '')
  if (explicit) return explicit
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return `http://localhost:${process.env.PORT ?? 3000}`
}

function log(event: string, details: Record<string, unknown>) {
  // Never log email addresses, tokens or private URLs.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }))
}

type ClaimedRun = {
  id: string
  radar_id: string
  kind: 'initial' | 'daily' | 'follow_up'
  parent_kind: 'initial' | 'daily' | null
  outcome: RunOutcome
  email_attempts: number
  email: string
  token_ciphertext: string
  website_host: string
  business_name: string | null
  research_ends_at: Date
}

/**
 * Send emails for completed runs marked `pending`. A run is claimed atomically before sending and Resend's
 * idempotency key is the run id, so concurrent ticks or a crash between send and save never double-send.
 * Runs wait while the visitor hasn't given an email yet (up to 3 days), and are skipped after unsubscribing.
 */
export async function sendPendingEmails() {
  // A non-Vercel server sharing a real database (e.g. localhost on production Supabase) leaves emails to production:
  // without Resend it would mark previews as sent, and without an explicit APP_URL its links would point at localhost.
  if (process.env.DATABASE_URL && !process.env.VERCEL && (!emailConfigured() || !process.env.APP_URL)) return

  await query(
    `update research_runs rr set email_status = 'skipped', email_error = 'unsubscribed or no email within 3 days'
     from radars r
     where r.id = rr.radar_id and rr.email_status = 'pending'
       and (r.email_unsubscribed_at is not null or (r.email is null and rr.completed_at < now() - interval '3 days'))`,
  )

  for (let i = 0; i < MAX_PER_TICK; i++) {
    const [run] = await query<ClaimedRun>(
      `update research_runs rr
       set email_status = 'sending', email_claimed_at = now(), email_attempts = rr.email_attempts + 1
       from radars r
       where rr.id = (
         select rr2.id from research_runs rr2 join radars r2 on r2.id = rr2.radar_id
         where r2.email is not null and r2.token_ciphertext is not null and r2.email_unsubscribed_at is null
           and (rr2.email_status = 'pending'
             or (rr2.email_status = 'sending' and rr2.email_claimed_at < now() - interval '10 minutes'))
         order by rr2.completed_at
         limit 1
         for update of rr2 skip locked
       ) and r.id = rr.radar_id
       returning rr.id, rr.radar_id, rr.kind, rr.outcome, rr.email_attempts, r.email, r.token_ciphertext,
         (select p.kind from research_runs p where p.id = rr.parent_run_id) as parent_kind,
         r.website_host, r.profile->>'name' as business_name, r.research_ends_at`,
    )
    if (!run) break
    await deliver(run)
  }
}

async function deliver(run: ClaimedRun) {
  const leads = await query<{ id: string; data: LeadT }>(
    `select id, data from leads where run_id = $1 and held_reason is null order by score_total desc, published_date desc`,
    [run.id],
  )

  let privateUrl: string
  try {
    privateUrl = `${appUrl()}/r/${decryptToken(run.token_ciphertext)}`
  } catch (error) {
    await finish(run.id, 'failed', `Cannot build private link: ${(error as Error).message}`)
    return
  }
  const unsubscribeUrl = `${appUrl()}/api/unsubscribe/${unsubscribeCode(run.radar_id)}`
  const daysLeft = Math.max(0, Math.ceil((new Date(run.research_ends_at).getTime() - Date.now()) / 86_400_000))

  // A follow-up after the initial run sends the "first results" email that the initial run deferred.
  const emailKind = run.kind === 'follow_up' ? (run.parent_kind ?? 'daily') : run.kind
  if (run.kind === 'follow_up' && emailKind === 'initial') {
    const all = await query<{ id: string; data: LeadT }>(
      `select id, data from leads where radar_id = $1 and held_reason is null order by score_total desc, published_date desc limit 10`,
      [run.radar_id],
    )
    leads.splice(0, leads.length, ...all)
  }

  const email = renderRunEmail({
    kind: emailKind,
    outcome: run.outcome,
    websiteHost: run.website_host,
    businessName: run.business_name,
    leads,
    privateUrl,
    unsubscribeUrl,
    daysLeft,
  })

  const result = await sendEmail({
    to: run.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `run-${run.id}`,
    unsubscribeUrl,
  })

  if (result.ok) {
    await finish(run.id, 'sent', null)
    log('email.sent', { run: run.id, kind: run.kind, leads: leads.length, preview: result.preview ? 'written to .data/emails' : undefined })
  } else if (result.retryable && run.email_attempts < MAX_ATTEMPTS) {
    await finish(run.id, 'pending', result.error)
    log('email.retry', { run: run.id, attempt: run.email_attempts })
  } else {
    await finish(run.id, 'failed', result.error)
    log('email.failed', { run: run.id, error: result.error.slice(0, 200) })
  }
}

async function finish(runId: string, status: 'sent' | 'pending' | 'failed', error: string | null) {
  await query(
    `update research_runs set email_status = $2, email_error = $3, email_claimed_at = null,
       email_sent_at = case when $2 = 'sent' then now() else email_sent_at end
     where id = $1`,
    [runId, status, error?.slice(0, 500) ?? null],
  )
}
