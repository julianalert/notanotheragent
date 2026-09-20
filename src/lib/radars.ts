import 'server-only'
import type { Attribution } from './attribution'
import { config } from './config'
import { encryptToken, maskEmail } from './crypto'
import { query } from './db'
import { toJsonb } from './jsonb'
import { agentLive, onTrial, trialEndsAt, type Plan } from './billing/subscription'
import { RERUN_KEY, type BusinessProfileT, type DismissReason, type Focus, type LeadT, type RunOutcome } from './research/contract'
import { getProvider, type RunProgress } from './research/provider'
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
  focus_updated_at: Date | null
  link_sent_at: Date | null
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
  /** Where a running attempt really is (step and counts). Null when the provider can't tell or nothing is running. */
  progress: RunProgress | null
}

export type LeadView = {
  id: string
  runId: string
  discoveredAt: string
  status: LeadRow['user_status']
  statusAt: string | null
  dismissReason: DismissReason | null
  /** Published moments ago: “who they are” is still being looked up. */
  enriching: boolean
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
  /** Scheduled research (daily and watch runs) is happening for this radar: a paid plan, or the free trial. */
  agentLive: boolean
  /** The free trial of a radar that never paid: running until `endsAt`, over afterwards. Null on any other plan. */
  trial: { active: boolean; endsAt: string; days: number } | null
  currentPeriodEnd: string | null
  priceUsd: number
  billingConfigured: boolean
  watchedSources: Array<{ id: string; kind: WatchedSourceRow['kind']; label: string; enabled: boolean; hits: number; published: number }>
  /** The most recent watch run, when one is in progress or completed today. */
  latestWatchRun: RunView | null
  /** What the first search understood about the business, as soon as the website has been read. */
  brief: { sells: string; buyers: string[] } | null
  /**
   * The one free second search: offered to a sleeping radar whose first search found nothing, or whose focus changed
   * since its last search. `used` once it has run, so the page can stop promising "the next search".
   */
  rerun: { available: boolean; used: boolean; reason: 'no_leads' | 'focus_changed' | null }
}

function safeEncrypt(token: string) {
  try {
    return encryptToken(token)
  } catch {
    return null
  }
}

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null)

/** Postgres: the column doesn't exist (a migration hasn't been applied yet). */
const UNDEFINED_COLUMN = '42703'

/** How long a fresh lead is shown as “looking up who they are” before the page stops waiting for it. */
const ENRICHING_WINDOW_MS = 3 * 60 * 1000

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
  /** First touch that brought the visitor (UTM, referring host, landing page). */
  attribution?: Attribution | null
}) {
  const now = new Date()
  const source = input.attribution ?? null
  // Immutable: research_ends_at = created_at + 14 × 24 hours.
  const endsAt = new Date(now.getTime() + config.researchPeriodMs)
  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : 'UTC'
  const rows = await query<{ radar_id: string }>(
    `with r as (
       insert into radars (token_hash, website, website_host, timezone, timezone_inferred,
         created_at, research_started_at, research_ends_at, email, email_added_at, token_ciphertext,
         source_utm_source, source_utm_medium, source_utm_campaign, source_utm_term, source_utm_content,
         source_referrer, source_landing_path)
       values ($1, $2, $3, $4, true, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
      source?.utm_source ?? null,
      source?.utm_medium ?? null,
      source?.utm_campaign ?? null,
      source?.utm_term ?? null,
      source?.utm_content ?? null,
      source?.referrer ?? null,
      source?.landing_path ?? null,
    ],
  )
  return rows[0].radar_id
}

function toRunView(run: RunRow | undefined, expired: boolean, progress: RunProgress | null = null): RunView | null {
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
    progress,
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
  const createdAt = new Date(radar.created_at)
  const live = agentLive(radar.plan, endsAt, now, { createdAt, trialDays: config.trialDays })
  const trialActive = onTrial(radar.plan, createdAt, config.trialDays, now)
  // A free radar is never "expired" while its first search can still run; a paid one expires when the plan lapses.
  const expired = now.getTime() >= endsAt.getTime()
  const profile = radar.profile
  const lastCompleted = runs.find((run) => run.status === 'completed')
  const provider = getProvider()

  // Real progress of the attempt in flight, read from the provider's own state (step and counts, never texts).
  const active = runs.find((run) => (run.status === 'running' || run.status === 'processing') && run.provider_response_id)
  const progress = active && provider.progress ? await provider.progress(active.provider_response_id!).catch(() => null) : null
  const runView = (run: RunRow | undefined) => toRunView(run, expired, run && run.id === active?.id ? progress : null)

  // One free second search for a sleeping radar: after an empty first search, or once the focus has changed since
  // the last search. A failed one may be asked for again.
  const rerunRun = runs.find((run) => run.kind === 'follow_up' && run.run_key === RERUN_KEY)
  const rerunUsed = Boolean(rerunRun) && rerunRun!.status !== 'failed' && rerunRun!.status !== 'cancelled'
  const inProgress = runs.some((run) => run.status === 'queued' || run.status === 'running' || run.status === 'processing')
  const focusChanged = Boolean(
    radar.focus_updated_at && lastCompleted?.started_at && new Date(radar.focus_updated_at) > new Date(lastCompleted.started_at),
  )
  const rerunReason = leads.length === 0 ? ('no_leads' as const) : focusChanged ? ('focus_changed' as const) : null
  const initialDone = runs.some((run) => run.kind === 'initial' && run.status === 'completed')
  // With a trial, the second search belongs to it: afterwards the agent sleeps until it is activated.
  const rerunAvailable = radar.plan === 'free' && (trialActive || !(config.trialDays > 0)) && !expired && Boolean(profile) && initialDone && !inProgress && !rerunUsed && rerunReason !== null

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
    initialRun: runView(runs.find((run) => run.kind === 'initial')),
    latestDailyRun: runView(runs.find((run) => run.kind === 'daily')),
    followUpRun: runView(runs.find((run) => run.kind === 'follow_up')),
    latestWatchRun: runView(runs.find((run) => run.kind === 'watch')),
    lastResearchAt: iso(lastCompleted?.completed_at),
    leads: leads.map((lead) => ({
      id: lead.id,
      runId: lead.run_id,
      discoveredAt: iso(lead.discovered_at)!,
      status: lead.user_status,
      statusAt: iso(lead.user_status_at),
      dismissReason: lead.dismiss_reason,
      enriching: provider.name !== 'mock' && !('enrichment' in lead.data) && now.getTime() - new Date(lead.discovered_at).getTime() < ENRICHING_WINDOW_MS,
      data: lead.data,
    })),
    slowRunThresholdMs: config.slowRunThresholdMs,
    sampleData: provider.name === 'mock',
    hasEmail: Boolean(radar.email),
    emailMasked: radar.email ? maskEmail(radar.email) : null,
    emailUnsubscribed: Boolean(radar.email_unsubscribed_at),
    webhookUrl: radar.webhook_url,
    plan: radar.plan,
    agentLive: live,
    trial: radar.plan === 'free' && config.trialDays > 0 ? { active: trialActive, endsAt: trialEndsAt(createdAt, config.trialDays).toISOString(), days: config.trialDays } : null,
    currentPeriodEnd: iso(radar.current_period_end),
    priceUsd: config.planPriceUsd,
    billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID),
    watchedSources: watched.map((source) => ({ id: source.id, kind: source.kind, label: source.label, enabled: source.enabled, hits: source.hits, published: source.published })),
    brief: profile?.acquisition_brief ? { sells: profile.acquisition_brief.sells, buyers: profile.acquisition_brief.buyers.slice(0, 4) } : null,
    rerun: { available: rerunAvailable, used: rerunUsed, reason: rerunAvailable ? rerunReason : null },
  }
}

/** Queue the one free second search (see RadarView.rerun). Eligibility beyond these guards is the caller's job. */
export async function requestRerun(radarId: string) {
  const rows = await query<{ id: string }>(
    `insert into research_runs (radar_id, kind, run_key, status, scheduled_at, parent_run_id)
     select rr.radar_id, 'follow_up', $2, 'queued', now(), rr.id
     from research_runs rr join radars r on r.id = rr.radar_id
     where rr.radar_id = $1 and rr.kind = 'initial' and rr.status = 'completed'
       and r.plan = 'free' and r.profile is not null and r.research_ends_at > now()
       and not exists (select 1 from research_runs busy where busy.radar_id = $1 and busy.status in ('queued', 'running', 'processing'))
     on conflict (radar_id, kind, run_key) do update
       set status = 'queued', scheduled_at = now(), error = null, error_code = null, provider_response_id = null,
           started_at = null, completed_at = null, retry_count = 0, lease_until = null
       where research_runs.status in ('failed', 'cancelled')
     returning id`,
    [radarId, RERUN_KEY],
  )
  return rows[0]?.id ?? null
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
 * Focus narrows future runs to evidenced profile services and a market. It never triggers a search by itself, adds
 * services outside the profile, or touches the deadline. The change is dated: on a sleeping radar it earns the one
 * free second search (RadarView.rerun).
 */
export async function updateFocus(radar: RadarRow, focus: Focus | null) {
  if (focus) {
    const allowed = new Set((radar.profile?.services ?? []).map((fact) => fact.value))
    const text = (value: string | null | undefined) => (value?.trim() ? value.trim().slice(0, 300) : null)
    focus = { services: focus.services.filter((service) => allowed.has(service)), market: focus.market, wanted: text(focus.wanted), avoid: text(focus.avoid) }
    if (!focus.services.length && !focus.market && !focus.wanted && !focus.avoid) focus = null
  }
  const value = focus ? toJsonb(focus) : null
  try {
    await query(`update radars set focus = $2, focus_updated_at = now() where id = $1`, [radar.id, value])
  } catch (error) {
    // Deployed before migration 010: the focus still saves; only the free second search after an edit waits for it.
    if ((error as { code?: string }).code !== UNDEFINED_COLUMN) throw error
    await query(`update radars set focus = $2 where id = $1`, [radar.id, value])
  }
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
 * Hosts shared by many businesses (a profile or a page on someone else's domain): only the exact address counts as
 * "the same website" there.
 */
const SHARED_HOSTS = new Set([
  'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'youtube.com', 'tiktok.com', 'github.com',
  'medium.com', 'linktr.ee', 'bento.me', 'behance.net', 'dribbble.com', 'upwork.com', 'fiverr.com', 'malt.fr', 'malt.com',
  'notion.site', 'sites.google.com', 'about.me',
])

/**
 * The free search is one per website and one per email address (FREE_RADAR_WINDOW_DAYS). Returns the radar that
 * already used it: a radar for the same website on any plan, else a free radar created with the same email.
 * Radars whose website could not be read don't count (they cost next to nothing, and the correction flow needs a
 * second one); a first search still running does, so parallel requests can't slip through.
 */
export async function findClaimedFreeSearch(website: { url: string; host: string }, email: string) {
  if (!(config.freeRadarWindowDays > 0)) return null
  const shared = SHARED_HOSTS.has(website.host.replace(/^www\./, ''))
  const [row] = await query<RadarRow & { same_website: boolean }>(
    `select r.*, (r.website = $1 or (r.website_host = $2 and not $3::boolean)) as same_website
     from radars r
     where r.created_at > now() - ($5 || ' days')::interval
       and (r.website = $1 or (r.website_host = $2 and not $3::boolean) or (r.email = $4 and r.plan = 'free'))
       and (r.profile is not null or exists (
         select 1 from research_runs rr
         where rr.radar_id = r.id and rr.kind = 'initial' and rr.status in ('queued', 'running', 'processing')))
     order by same_website desc, r.created_at desc
     limit 1`,
    [website.url, website.host, shared, email, String(config.freeRadarWindowDays)],
  )
  return row ? { radar: row as RadarRow, match: row.same_website ? ('website' as const) : ('email' as const) } : null
}

/** At most one link email per radar and hour: true when this call may send it. */
export async function claimLinkEmail(radarId: string) {
  try {
    const rows = await query(
      `update radars set link_sent_at = now()
       where id = $1 and (link_sent_at is null or link_sent_at < now() - interval '1 hour') returning id`,
      [radarId],
    )
    return rows.length > 0
  } catch (error) {
    // Deployed before migration 010: without the hourly guard, nothing is sent.
    if ((error as { code?: string }).code !== UNDEFINED_COLUMN) throw error
    return false
  }
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
