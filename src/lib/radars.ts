import 'server-only'
import { config } from './config'
import { encryptToken, maskEmail } from './crypto'
import { query } from './db'
import { toJsonb } from './jsonb'
import { agentLive, type Plan } from './billing/subscription'
import type { BusinessProfileT, DismissReason, Focus, LeadT, RunOutcome } from './research/contract'
import { getProvider } from './research/provider'
import { isValidTimeZone, nextDailyRunAt } from './time'
import { hashToken, isWellFormedToken } from './tokens'

export type RadarRow = {
  id: string
  token_hash: string
  website: string
  website_host: string
  profile: BusinessProfileT | null
  focus: Focus | null
  timezone: string
  timezone_inferred: boolean
  created_at: Date
  research_started_at: Date
  research_ends_at: Date
  next_run_at: Date | null
  email: string | null
  email_unsubscribed_at: Date | null
  token_ciphertext: string | null
  plan: Plan
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  activated_at: Date | null
  current_period_end: Date | null
  last_watch_at: Date | null
  webhook_url: string | null
}

export type RunKind = 'initial' | 'daily' | 'follow_up' | 'watch'

export type WatchedSourceRow = {
  id: string
  radar_id: string
  kind: 'subreddit' | 'hn' | 'exa_query' | 'feed'
  key: string
  label: string
  added_by: 'agent' | 'user'
  enabled: boolean
  last_polled_at: Date | null
  last_item_at: Date | null
  hits: number
  published: number
}

export type RunRow = {
  id: string
  radar_id: string
  kind: RunKind
  run_key: string
  parent_run_id: string | null
  status: 'queued' | 'running' | 'processing' | 'completed' | 'failed' | 'cancelled'
  provider_response_id: string | null
  published_on_or_after: Date | string | null
  scheduled_at: Date
  started_at: Date | null
  completed_at: Date | null
  retry_count: number
  manual_retry_count: number
  error_code: string | null
  outcome: RunOutcome | null
  coverage: { limitations: string[] } | null
  candidates: number | null
  published_count: number | null
  unresolved_count: number | null
  created_at: Date
}

type LeadRow = {
  id: string
  run_id: string
  discovered_at: Date
  data: LeadT
  score_total: number
  user_status: 'new' | 'contacted' | 'dismissed'
  user_status_at: Date | null
  dismiss_reason: DismissReason | null
}

export type RunView = {
  id: string
  kind: RunKind
  status: RunRow['status']
  outcome: RunOutcome | null
  errorCode: string | null
  retrying: boolean
  canRetry: boolean
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  runKey: string
  limitations: string[]
  /** Candidates the research returned before the evidence checks (null for runs without a report). */
  candidates: number | null
  published: number | null
  unresolved: number | null
}

export type LeadView = {
  id: string
  runId: string
  discoveredAt: string
  status: LeadRow['user_status']
  statusAt: string | null
  dismissReason: DismissReason | null
  data: LeadT
}

export type RadarView = {
  website: string
  websiteHost: string
  timezone: string
  timezoneInferred: boolean
  createdAt: string
  researchEndsAt: string
  nextRunAt: string | null
  expired: boolean
  now: string
  businessName: string | null
  profileServices: string[]
  profileMarkets: string[]
  focus: { services: string; customerType: string; market: string } | null
  focusSelection: Focus | null
  initialRun: RunView | null
  latestDailyRun: RunView | null
  /** The single follow-up of the most recent run that had one. */
  followUpRun: RunView | null
  lastResearchAt: string | null
  leads: LeadView[]
  slowRunThresholdMs: number
  sampleData: boolean
  hasEmail: boolean
  emailMasked: string | null
  emailUnsubscribed: boolean
  webhookUrl: string | null
  plan: Plan
  /** Scheduled research (daily and watch runs) is happening for this radar. */
  agentLive: boolean
  currentPeriodEnd: string | null
  priceUsd: number
  billingConfigured: boolean
  watchedSources: Array<{ id: string; kind: WatchedSourceRow['kind']; label: string; enabled: boolean; hits: number; published: number }>
  /** The most recent watch run, when one is in progress or completed today. */
  latestWatchRun: RunView | null
}

function safeEncrypt(token: string) {
  try {
    return encryptToken(token)
  } catch {
    return null
  }
}

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null)

/** Failures a user retry cannot fix. */
const NOT_USER_RETRYABLE = new Set(['configuration', 'refusal'])

export async function findRadarByToken(token: unknown): Promise<RadarRow | null> {
  if (!isWellFormedToken(token)) return null
  const rows = await query<RadarRow>('select * from radars where token_hash = $1', [hashToken(token)])
  return rows[0] ?? null
}

export async function createRadar(input: {
  tokenHash: string
  website: string
  host: string
  timezone: string | null
  /** Carried over from this browser's previous radar so the visitor isn't asked twice. */
  email?: string | null
  token?: string
}) {
  const now = new Date()
  // Immutable: research_ends_at = created_at + 14 × 24 hours.
  const endsAt = new Date(now.getTime() + config.researchPeriodMs)
  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : 'UTC'
  const rows = await query<{ radar_id: string }>(
    `with r as (
       insert into radars (token_hash, website, website_host, timezone, timezone_inferred,
         created_at, research_started_at, research_ends_at, email, email_added_at, token_ciphertext)
       values ($1, $2, $3, $4, true, $5, $5, $6, $7, $8, $9)
       returning id
     )
     insert into research_runs (radar_id, kind, run_key, status, scheduled_at)
     select id, 'initial', 'initial', 'queued', $5 from r
     returning radar_id`,
    [
      input.tokenHash,
      input.website,
      input.host,
      timezone,
      now,
      endsAt,
      input.email ?? null,
      input.email ? now : null,
      input.email && input.token ? safeEncrypt(input.token) : null,
    ],
  )
  return rows[0].radar_id
}

function toRunView(run: RunRow | undefined, expired: boolean): RunView | null {
  if (!run) return null
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    outcome: run.outcome,
    errorCode: run.error_code,
    retrying: run.status === 'queued' && run.retry_count > 0,
    canRetry:
      run.kind === 'initial' &&
      run.status === 'failed' &&
      !expired &&
      !NOT_USER_RETRYABLE.has(run.error_code ?? '') &&
      run.manual_retry_count < config.maxManualRetries,
    createdAt: iso(run.created_at)!,
    startedAt: iso(run.started_at),
    completedAt: iso(run.completed_at),
    runKey: run.run_key,
    limitations: run.coverage?.limitations ?? [],
    candidates: run.candidates,
    published: run.published_count,
    unresolved: run.unresolved_count,
  }
}

/** Short display label for a profile fact, which the model may write as a full sentence. */
function label(value: string) {
  const head = value.split(/[:;(]| including | such as /)[0].trim().replace(/[\s,.\-–]+$/, '')
  return head.length > 60 ? `${head.slice(0, 57).trimEnd()}…` : head
}

const values = (facts: { value: string }[] | undefined, max = 3) =>
  (facts ?? []).slice(0, max).map((fact) => label(fact.value))

export async function getRadarView(radar: RadarRow): Promise<RadarView> {
  const [runs, leads, watched] = await Promise.all([
    query<RunRow>(
      `select id, radar_id, kind, run_key, parent_run_id, status, provider_response_id, published_on_or_after, scheduled_at,
         started_at, completed_at, retry_count, manual_retry_count, error_code, outcome, coverage, created_at,
         coalesce((diagnostics->'counts'->>'discovered')::int, (validation_report->>'returned_leads')::int) as candidates,
         (diagnostics->'counts'->>'published')::int as published_count,
         (diagnostics->'counts'->>'unresolved')::int as unresolved_count
       from research_runs where radar_id = $1 order by created_at desc`,
      [radar.id],
    ),
    // Held (probable duplicate) leads are stored for review but never displayed.
    query<LeadRow>(
      `select id, run_id, discovered_at, data, score_total, user_status, user_status_at, dismiss_reason
       from leads where radar_id = $1 and held_reason is null
       order by discovered_at desc, score_total desc, published_date desc`,
      [radar.id],
    ),
    query<WatchedSourceRow>(`select * from watched_sources where radar_id = $1 order by published desc, hits desc, created_at limit 12`, [radar.id]),
  ])
  const now = new Date()
  const endsAt = new Date(radar.research_ends_at)
  const live = agentLive(radar.plan, endsAt, now)
  // A free radar is never "expired" while its first search can still run; a paid one expires when the plan lapses.
  const expired = now.getTime() >= endsAt.getTime()
  const profile = radar.profile
  const lastCompleted = runs.find((run) => run.status === 'completed')

  const services = radar.focus?.services.length ? radar.focus.services.slice(0, 2).map(label) : values(profile?.services, 2)
  const markets = radar.focus?.market ? [radar.focus.market] : values(profile?.markets, 2)

  return {
    website: radar.website,
    websiteHost: radar.website_host,
    timezone: radar.timezone,
    timezoneInferred: radar.timezone_inferred,
    createdAt: iso(radar.created_at)!,
    researchEndsAt: iso(radar.research_ends_at)!,
    nextRunAt: expired || !live ? null : iso(radar.next_run_at),
    expired,
    now: now.toISOString(),
    businessName: profile?.name ?? null,
    profileServices: (profile?.services ?? []).map((fact) => fact.value),
    profileMarkets: (profile?.markets ?? []).map((fact) => fact.value),
    focus: profile
      ? {
          services: services.join(' · ') || 'Services not identified',
          customerType: values(profile.customer_types, 1).join(', ') || 'Customer type not identified',
          market: markets.join(', ') || 'Market not identified',
        }
      : null,
    focusSelection: radar.focus,
    initialRun: toRunView(
      runs.find((run) => run.kind === 'initial'),
      expired,
    ),
    latestDailyRun: toRunView(
      runs.find((run) => run.kind === 'daily'),
      expired,
    ),
    followUpRun: toRunView(
      runs.find((run) => run.kind === 'follow_up'),
      expired,
    ),
    latestWatchRun: toRunView(
      runs.find((run) => run.kind === 'watch'),
      expired,
    ),
    lastResearchAt: iso(lastCompleted?.completed_at),
    leads: leads.map((lead) => ({
      id: lead.id,
      runId: lead.run_id,
      discoveredAt: iso(lead.discovered_at)!,
      status: lead.user_status,
      statusAt: iso(lead.user_status_at),
      dismissReason: lead.dismiss_reason,
      data: lead.data,
    })),
    slowRunThresholdMs: config.slowRunThresholdMs,
    sampleData: getProvider().name === 'mock',
    hasEmail: Boolean(radar.email),
    emailMasked: radar.email ? maskEmail(radar.email) : null,
    emailUnsubscribed: Boolean(radar.email_unsubscribed_at),
    webhookUrl: radar.webhook_url,
    plan: radar.plan,
    agentLive: live,
    currentPeriodEnd: iso(radar.current_period_end),
    priceUsd: config.planPriceUsd,
    billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID),
    watchedSources: watched.map((source) => ({ id: source.id, kind: source.kind, label: source.label, enabled: source.enabled, hits: source.hits, published: source.published })),
  }
}

export async function setWebhookUrl(radarId: string, url: string | null) {
  await query(`update radars set webhook_url = $2 where id = $1`, [radarId, url])
}

export async function setWatchedSourceEnabled(radarId: string, sourceId: string, enabled: boolean) {
  const rows = await query(`update watched_sources set enabled = $3 where id = $2 and radar_id = $1 returning id`, [radarId, sourceId, enabled])
  return rows.length > 0
}

/**
 * Lead status is the user's feedback: contacted leads become examples of what they want, dismissed ones (with a
 * reason) of what to avoid. Per-topic contacted counts steer which searches run first.
 */
export async function updateLeadStatus(radarId: string, leadId: string, status: LeadRow['user_status'], reason: DismissReason | null = null) {
  const rows = await query(
    `update leads set user_status = $3, user_status_at = case when $3 = 'new' then null else now() end,
       dismiss_reason = case when $3 = 'dismissed' then coalesce($4, dismiss_reason, 'other') else null end
     where id = $2 and radar_id = $1 returning id`,
    [radarId, leadId, status, reason],
  )
  if (!rows.length) return false
  await query(
    `update search_stats s set contacted = (
       select count(*)::int from leads l where l.radar_id = s.radar_id and l.topic = s.topic and l.user_status = 'contacted'
     ) where s.radar_id = $1`,
    [radarId],
  )
  return true
}

/**
 * Focus narrows future daily runs to evidenced profile services and a market. It never triggers a search,
 * adds services outside the profile, or touches the deadline.
 */
export async function updateFocus(radar: RadarRow, focus: Focus | null) {
  if (focus) {
    const allowed = new Set((radar.profile?.services ?? []).map((fact) => fact.value))
    const text = (value: string | null | undefined) => (value?.trim() ? value.trim().slice(0, 300) : null)
    focus = { services: focus.services.filter((service) => allowed.has(service)), market: focus.market, wanted: text(focus.wanted), avoid: text(focus.avoid) }
    if (!focus.services.length && !focus.market && !focus.wanted && !focus.avoid) focus = null
  }
  await query(`update radars set focus = $2 where id = $1`, [radar.id, focus ? toJsonb(focus) : null])
}

/** Changing timezone only moves the next morning run. The research deadline is immutable. */
export async function updateTimezone(radar: RadarRow, timezone: string) {
  const now = new Date()
  const endsAt = new Date(radar.research_ends_at)
  const nextRun = radar.next_run_at && now < endsAt ? nextDailyRunAt(now, timezone, endsAt, config.dailyRunHour) : null
  await query(
    `update radars set timezone = $2, timezone_inferred = false, next_run_at = $3
     where id = $1 and research_ends_at > now()`,
    [radar.id, timezone, nextRun],
  )
}

/** Manual retry of a failed initial run. Refused server-side once the research period has ended. */
export async function retryInitialRun(radarId: string) {
  const rows = await query<{ id: string }>(
    `update research_runs rr
     set status = 'queued', error = null, error_code = null, provider_response_id = null, lease_until = null,
         manual_retry_count = rr.manual_retry_count + 1, retry_count = 0,
         scheduled_at = now(), started_at = null, completed_at = null
     from radars r
     where r.id = rr.radar_id and rr.radar_id = $1 and rr.kind = 'initial' and rr.status = 'failed'
       and coalesce(rr.error_code, '') not in ('configuration', 'refusal')
       and rr.manual_retry_count < $2 and r.research_ends_at > now()
     returning rr.id`,
    [radarId, config.maxManualRetries],
  )
  return rows[0]?.id ?? null
}

/**
 * Store where to email results. The private token is kept encrypted so emails can link to the page;
 * access control still uses only the token hash. Giving an email again re-subscribes.
 */
export async function setRadarEmail(radarId: string, email: string, token: string) {
  let ciphertext: string | null = null
  try {
    ciphertext = encryptToken(token)
  } catch (error) {
    // Missing APP_SECRET must not block visitors at the email step; emails wait until it is configured.
    console.error(JSON.stringify({ event: 'email.config_error', error: (error as Error).message }))
  }
  await query(
    `update radars set email = $2, email_added_at = now(), email_unsubscribed_at = null,
       token_ciphertext = coalesce($3, token_ciphertext)
     where id = $1`,
    [radarId, email, ciphertext],
  )
}

export async function unsubscribeRadar(radarId: string) {
  const rows = await query<{ website_host: string }>(
    `update radars set email_unsubscribed_at = coalesce(email_unsubscribed_at, now()) where id = $1 returning website_host`,
    [radarId],
  )
  return rows[0] ?? null
}

/**
 * Same-session resubmission of the same website reuses the existing radar; its deadline is never reset.
 * A different URL on the same domain is allowed only as a correction when the first page couldn't be read.
 */
export function reusableRadar(existing: RadarRow | null, website: { url: string; host: string }) {
  return existing && (existing.website === website.url || (existing.website_host === website.host && existing.profile))
    ? existing
    : null
}
