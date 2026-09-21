import 'server-only'
import { agentLive, trialEndsAt } from './billing/subscription'
import { config } from './config'
import { query, transaction, type Queryable } from './db'
import type { RadarRow, RunRow } from './radars'
import {
  AUTOMATIC_FOLLOW_UPS,
  MAX_CANDIDATES,
  RERUN_KEY,
  PROMPT_VERSION,
  ResearchResult,
  SCHEMA_VERSION,
  SUCCESSFUL_OUTCOMES,
  type BusinessProfileT,
  type CandidateT,
  type LeadT,
  type ResearchResultT,
  type RunOutcome,
} from './research/contract'
import { followUpDecision, isResearchOpen, MAX_PUBLISHED_PER_RUN, qualifyCandidates, sourceKey, validateProfile, type QualifiedLead } from './research/gates'
import { enrichLead } from './research/enrich'
import { probeMatches, type PipelineSummary } from './research/pipeline'
import { postWebhook } from './email/webhook'
import { buildResearchInput, lintQuery, publishedOnOrAfter, type ExcludedOpportunity, type Feedback, type PreviousCandidate } from './research/prompt'
import {
  getProvider,
  isRetryable,
  ResearchError,
  type ErrorCode,
  type PartialResult,
  type ResearchProvider,
  type RunContext,
  type ToolAction,
  type Usage,
} from './research/provider'
import { sendPendingEmails } from './email/deliver'
import { sendLifecycleEmails } from './email/lifecycle'
import { toJsonb } from './jsonb'
import { localDateKey, nextDailyRunAt } from './time'

const MAX_PER_TICK = 20
/** Searches proposed by the previous run that lead the next scheduled run (a third of a daily run's topics). */
const CARRIED_QUERIES = 4
/** Watched communities polled per run while none of them has produced a lead yet. */
const UNPROVEN_COMMUNITIES = 3
/** A radar this young still searches the first search's 90-day window: its first days decide whether it is kept. */
const YOUNG_RADAR_DAYS = 7

function log(event: string, details: Record<string, unknown>) {
  // Structured, token-free logging. Never log radar tokens, private URLs or raw provider output.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }))
}

/**
 * Advance all research work. Safe to call concurrently from cron, the dev scheduler and `after()` hooks:
 * every transition is guarded by a lease or a status/deadline condition in the database.
 */
export async function tick() {
  await expireResearch()
  await scheduleTrialRuns()
  await enqueueDueDailyRuns()
  await enqueueDueWatchRuns()

  for (let i = 0; i < MAX_PER_TICK; i++) {
    const run = await claim(`rr.status = 'queued' and rr.scheduled_at <= now()`)
    if (!run) break
    await startRun(run)
  }
  for (let i = 0; i < MAX_PER_TICK; i++) {
    const run = await claim(`rr.status in ('running', 'processing')`)
    if (!run) break
    await checkRun(run)
  }
  // Leads are published before their enrichment: pick up any a crashed function left without one.
  await enrichLeads(null).catch((error) => log('runs.enrich_sweep_error', { error: (error as Error).message.slice(0, 200) }))
  // Email failures must never block research.
  await sendPendingEmails().catch((error) => log('email.tick_error', { error: (error as Error).message.slice(0, 200) }))
  await sendLifecycleEmails(probeNewMatches).catch((error) => log('email.lifecycle_error', { error: (error as Error).message.slice(0, 200) }))
}

/** Queued work for expired radars is dropped; expired radars stop scheduling. */
async function expireResearch() {
  const cancelled = await query<{ id: string }>(
    `update research_runs rr
     set status = 'cancelled', error_code = 'research_expired', error = 'Research period ended before this run started',
         completed_at = now(), lease_until = null
     from radars r
     where r.id = rr.radar_id and rr.status = 'queued' and r.research_ends_at <= now()
     returning rr.id`,
  )
  if (cancelled.length) log('runs.expired', { count: cancelled.length })
  await query(`update radars set next_run_at = null where next_run_at is not null and research_ends_at <= now()`)
  // Rate-limit windows are one hour long; yesterday's are only clutter. Tolerates a database without migration 010.
  await query(`delete from rate_limits where window_start < now() - interval '1 day'`).catch(() => undefined)
}

/** Morning runs stop at the end of the paid period, or of the free trial for a radar that never paid. */
function scheduleEnd(radar: Pick<RadarRow, 'plan' | 'created_at' | 'research_ends_at'>) {
  const endsAt = new Date(radar.research_ends_at)
  if (radar.plan !== 'free') return endsAt
  return new Date(Math.min(endsAt.getTime(), trialEndsAt(new Date(radar.created_at), config.trialDays).getTime()))
}

/**
 * A radar on trial whose first search is done gets its morning runs. The first search normally sets this when it
 * ends; this covers radars whose first search ended before the trial existed, or without a schedule for any reason.
 */
async function scheduleTrialRuns() {
  if (!(config.trialDays > 0)) return
  const radars = await query<Pick<RadarRow, 'id' | 'timezone' | 'plan' | 'created_at' | 'research_ends_at'>>(
    `select r.id, r.timezone, r.plan, r.created_at, r.research_ends_at from radars r
     where r.plan = 'free' and r.next_run_at is null and r.profile is not null and r.research_ends_at > now()
       and r.created_at > now() - ($1 || ' days')::interval
       and exists (select 1 from research_runs rr where rr.radar_id = r.id and rr.kind = 'initial' and rr.status = 'completed')
       and not exists (select 1 from research_runs rr where rr.radar_id = r.id and rr.kind = 'daily')
     limit 50`,
    [String(config.trialDays)],
  )
  const now = new Date()
  for (const radar of radars) {
    const next = nextDailyRunAt(now, radar.timezone, scheduleEnd(radar), config.dailyRunHour)
    if (next) await query(`update radars set next_run_at = $2 where id = $1 and next_run_at is null`, [radar.id, next])
  }
}

async function enqueueDueDailyRuns() {
  const due = await query<Pick<RadarRow, 'id' | 'timezone' | 'next_run_at' | 'research_ends_at' | 'plan' | 'created_at'>>(
    `select id, timezone, next_run_at, research_ends_at, plan, created_at from radars
     where next_run_at <= now() and research_ends_at > now() and profile is not null
       and (plan in ('active', 'past_due') or (plan = 'free' and created_at > now() - ($1 || ' days')::interval))
     order by next_run_at limit 100`,
    [String(config.trialDays)],
  )
  const now = new Date()
  for (const radar of due) {
    const next = nextDailyRunAt(now, radar.timezone, scheduleEnd(radar), config.dailyRunHour)
    // Optimistic claim: only one worker advances next_run_at from this exact value.
    const claimed = await query(
      `update radars set next_run_at = $3 where id = $1 and next_run_at = $2 and research_ends_at > now() returning id`,
      [radar.id, radar.next_run_at, next],
    )
    if (!claimed.length) continue
    // One daily run per local date, enforced by the unique (radar_id, kind, run_key) constraint.
    await query(
      `insert into research_runs (radar_id, kind, run_key, status, scheduled_at)
       values ($1, 'daily', $2, 'queued', now())
       on conflict (radar_id, kind, run_key) do nothing`,
      [radar.id, localDateKey(new Date(radar.next_run_at!), radar.timezone)],
    )
  }
}

/**
 * Watch runs: every WATCH_INTERVAL_HOURS, an active radar polls the sources it watches and searches its proven
 * topics for anything new. Never while another run for the radar is queued or running (the morning run comes first).
 */
async function enqueueDueWatchRuns() {
  // One complete run per day is the product; extra polls only when WATCH_INTERVAL_HOURS is set.
  if (!(config.watchIntervalHours > 0)) return
  const due = await query<{ id: string; last_watch_at: Date | null }>(
    `select r.id, r.last_watch_at from radars r
     where r.plan in ('active', 'past_due') and r.research_ends_at > now() and r.profile is not null and r.activated_at is not null
       and (r.last_watch_at is null or r.last_watch_at < now() - ($1 || ' hours')::interval)
       and not exists (select 1 from research_runs rr where rr.radar_id = r.id and rr.status in ('queued', 'running', 'processing'))
     order by r.last_watch_at nulls first limit 50`,
    [String(config.watchIntervalHours)],
  )
  for (const radar of due) {
    const claimed = await query(
      `update radars set last_watch_at = now() where id = $1 and last_watch_at is not distinct from $2 returning id`,
      [radar.id, radar.last_watch_at],
    )
    if (!claimed.length) continue
    await query(
      `insert into research_runs (radar_id, kind, run_key, status, scheduled_at)
       values ($1, 'watch', $2, 'queued', now())
       on conflict (radar_id, kind, run_key) do nothing`,
      [radar.id, `watch:${new Date().toISOString().slice(0, 13)}`],
    )
  }
}

async function claim(condition: string): Promise<RunRow | null> {
  const rows = await query<RunRow>(
    `update research_runs set lease_until = now() + ($1 || ' milliseconds')::interval
     where id = (
       select rr.id from research_runs rr
       where ${condition} and (rr.lease_until is null or rr.lease_until < now())
       order by rr.scheduled_at
       limit 1
       for update skip locked
     ) and (lease_until is null or lease_until < now())
     returning *`,
    [String(config.leaseMs)],
  )
  return rows[0] ?? null
}

async function release(runId: string, delayMs = 0) {
  if (delayMs) {
    await query(`update research_runs set lease_until = now() + ($2 || ' milliseconds')::interval where id = $1`, [
      runId,
      String(delayMs),
    ])
  } else {
    await query(`update research_runs set lease_until = null where id = $1`, [runId])
  }
}

async function getRadar(radarId: string) {
  return (await query<RadarRow>(`select * from radars where id = $1`, [radarId]))[0]
}

async function lastSuccessfulRunAt(radarId: string) {
  const [row] = await query<{ started_at: Date }>(
    `select started_at from research_runs
     where radar_id = $1 and status = 'completed' and outcome = any($2) and started_at is not null
     order by started_at desc limit 1`,
    [radarId, SUCCESSFUL_OUTCOMES],
  )
  return row ? new Date(row.started_at) : null
}

async function withinBudget() {
  const [row] = await query<{ runs: number; spend: string | null }>(
    `select count(*)::int as runs, sum(cost_usd) as spend from research_runs where started_at >= date_trunc('day', now())`,
  )
  return row.runs < config.dailyRunCap && Number(row.spend ?? 0) < config.dailySpendCapUsd
}

/** Spend per radar this calendar month. Watch runs stop at the cap; the morning run always goes ahead. */
async function withinRadarBudget(radarId: string) {
  const [row] = await query<{ spend: string | null }>(
    `select sum(cost_usd) as spend from research_runs where radar_id = $1 and started_at >= date_trunc('month', now())`,
    [radarId],
  )
  return Number(row?.spend ?? 0) < config.monthlyRadarBudgetUsd
}

/**
 * For a sleeping radar: how many recent public posts look like buyers, from a search and triage only (see
 * probeMatches). Null when no provider can do it. Cheap connectors only, and everything the radar already knows is
 * excluded, so the count is of posts it has never seen.
 */
export async function probeNewMatches(radarId: string, since: Date) {
  const provider = getProvider()
  if (provider.name === 'mock') {
    return { count: 3, titles: ['Sample: Looking for a studio to redesign our pricing page', 'Sample: Anyone know a good CRO consultant for B2B SaaS?'], costUsd: 0 }
  }
  if (provider.name !== 'pipeline') return null
  const radar = await getRadar(radarId)
  if (!radar?.profile?.acquisition_brief) return null
  const [memory, leads] = await Promise.all([
    runMemory(radar.id, 'watch'),
    query<{ source_key: string }>(`select source_key from leads where radar_id = $1`, [radar.id]),
  ])
  const input = buildResearchInput({
    mode: 'watch',
    now: new Date(),
    websiteUrl: radar.website,
    lastSuccessfulRunAt: null,
    profile: radar.profile,
    focus: radar.focus,
    excluded: [],
    windowStart: since.toISOString().slice(0, 10),
  })
  const probe = await probeMatches(input, {
    excludeKeys: [...new Set([...leads.map((lead) => lead.source_key), ...memory.excludeKeys])],
    priorityTopics: memory.priorityTopics,
    deadTopics: memory.deadTopics,
    connectors: ['exa', 'hn'],
  })
  const { usage } = probe
  const costUsd =
    (usage.input_tokens / 1e6) * config.cost.inputPerMTok +
    (usage.output_tokens / 1e6) * config.cost.outputPerMTok +
    ((usage.small_input_tokens ?? 0) / 1e6) * config.cost.smallInputPerMTok +
    ((usage.small_output_tokens ?? 0) / 1e6) * config.cost.smallOutputPerMTok +
    usage.web_search_calls * config.cost.perWebSearch +
    (usage.extra_cost_usd ?? 0)
  log('probe.completed', { radar: radar.id, count: probe.count, cost_usd: Number(costUsd.toFixed(4)) })
  return { count: probe.count, titles: probe.titles, costUsd }
}

/* --------------------------------- Start ---------------------------------- */

async function startRun(run: RunRow) {
  const provider = getProvider()
  const radar = await getRadar(run.radar_id)

  if (!isResearchOpen(new Date(), new Date(radar.research_ends_at))) {
    await cancelExpired(run.id)
    return
  }
  if (!(await withinBudget())) {
    log('runs.budget_reached', { run: run.id })
    await release(run.id, 10 * 60 * 1000)
    return
  }
  if (run.kind !== 'initial' && !radar.profile) {
    await finishFailed(run.id, 'provider_failed', `Radar has no validated profile for a ${run.kind} run`)
    return
  }
  if (run.kind === 'watch' && !(await withinRadarBudget(radar.id))) {
    await query(
      `update research_runs set status = 'cancelled', error_code = 'budget_reached', error = 'Monthly research budget for this radar reached',
         completed_at = now(), lease_until = null where id = $1 and status = 'queued'`,
      [run.id],
    )
    log('runs.radar_budget_reached', { run: run.id })
    return
  }

  const now = new Date()
  const [lastSuccess, prior, memory] = await Promise.all([
    lastSuccessfulRunAt(radar.id),
    query<{ source_url: string; source_key: string; published_date: Date | string; user_status: ExcludedOpportunity['status']; dismiss_reason: string | null; user_status_at: Date | null; data: LeadT }>(
      `select source_url, source_key, published_date, user_status, dismiss_reason, user_status_at, data from leads where radar_id = $1 order by discovered_at`,
      [radar.id],
    ),
    runMemory(radar.id, run.kind, run.run_key === RERUN_KEY),
  ])
  // Feedback: the most recently contacted and dismissed leads, as examples of what the user wants and rejects.
  const judged = prior.filter((lead) => lead.user_status !== 'new').sort((a, b) => (b.user_status_at ? new Date(b.user_status_at).getTime() : 0) - (a.user_status_at ? new Date(a.user_status_at).getTime() : 0))
  const feedback: Feedback = {
    liked: judged.filter((lead) => lead.user_status === 'contacted').slice(0, 5).map((lead) => ({ headline: lead.data.headline, need_summary: lead.data.need_summary, buyer_match: lead.data.buyer_match ?? '' })),
    rejected: judged.filter((lead) => lead.user_status === 'dismissed').slice(0, 5).map((lead) => ({ headline: lead.data.headline, need_summary: lead.data.need_summary, reason: lead.dismiss_reason ?? 'other' })),
  }
  const context: RunContext = {
    excludeKeys: [...new Set([...prior.map((lead) => lead.source_key), ...memory.excludeKeys])],
    priorityTopics: memory.priorityTopics,
    deadTopics: memory.deadTopics,
    // The communities where earlier runs found candidates are polled as part of every scheduled run.
    subreddits: run.kind === 'initial' ? [] : memory.watchedSubreddits,
  }
  // A follow-up receives the previous run's candidates, queries and untried angles, and searches the same window.
  let followUp: { previousCandidates: PreviousCandidate[]; previousQueries: string[]; untriedAngles: string[]; windowStart?: string } = {
    previousCandidates: [],
    previousQueries: [],
    untriedAngles: [],
  }
  if (run.kind === 'follow_up' && run.parent_run_id) {
    const [parent] = await query<{ diagnostics: RunDiagnostics | null; published_on_or_after: Date | string | null }>(
      `select diagnostics, published_on_or_after from research_runs where id = $1`,
      [run.parent_run_id],
    )
    const candidates = await query<{ source_url: string; headline: string; decision: string; model_decision: PreviousCandidate['decision']; reasons: string[] }>(
      `select source_url, headline, decision, model_decision, reasons from research_candidates where run_id = $1`,
      [run.parent_run_id],
    )
    followUp = {
      previousCandidates: candidates.map((c) => ({
        source_url: c.source_url,
        headline: c.headline,
        decision: c.decision === 'published' || c.decision === 'qualified_not_selected' ? 'qualified' : (c.decision as PreviousCandidate['decision']),
        reasons: c.reasons,
      })),
      previousQueries: [...new Set([...(parent?.diagnostics?.proposed_queries ?? []), ...(parent?.diagnostics?.executed_searches ?? [])])],
      untriedAngles: parent?.diagnostics?.follow_up?.untried_angles ?? [],
      windowStart: parent?.published_on_or_after ? new Date(parent.published_on_or_after).toISOString().slice(0, 10) : undefined,
    }
  }

  if (run.kind === 'daily' || run.kind === 'watch') {
    // Every run ends with searches worth running next, in the words of the buyers it just read. With follow-ups
    // off they would be lost and each day would repeat the brief's fixed topics: a few lead the next run.
    const [last] = await query<{ diagnostics: RunDiagnostics | null }>(
      `select diagnostics from research_runs
       where radar_id = $1 and id <> $2 and status = 'completed' and diagnostics is not null order by created_at desc limit 1`,
      [radar.id, run.id],
    )
    followUp.untriedAngles = (last?.diagnostics?.proposed_queries ?? []).slice(0, CARRIED_QUERIES)
    // The first search covers 90 days with twelve topics, a fraction of what is out there. A young radar's morning
    // runs keep mining that window with other topics instead of the last 30 days only; memory keeps out repeats.
    if (run.kind === 'daily' && now.getTime() - new Date(radar.created_at).getTime() < YOUNG_RADAR_DAYS * 86_400_000) {
      followUp.windowStart = publishedOnOrAfter(now, null)
    }
  }

  const input = buildResearchInput({
    mode: run.kind,
    ...followUp,
    now,
    websiteUrl: radar.website,
    lastSuccessfulRunAt: lastSuccess,
    profile: radar.profile,
    focus: radar.focus,
    feedback,
    // Every stored opportunity in compact form, including held, contacted and dismissed.
    excluded: prior.map((lead) => ({
      source_url: lead.source_url,
      author_or_company: lead.data.company_name || lead.data.public_handle || lead.data.person_name || '',
      need_summary: lead.data.need_summary,
      published_date: lead.published_date ? new Date(lead.published_date).toISOString().slice(0, 10) : null,
      status: lead.user_status,
    })),
  })

  // Deadline re-check immediately before the provider call, atomically with the state transition.
  const started = await query<RunRow>(
    `update research_runs rr
     set status = 'running', started_at = now(), provider = $2, model = $3, prompt_version = $4,
         schema_version = $5, output_mode = $6, published_on_or_after = $7
     from radars r
     where rr.id = $1 and r.id = rr.radar_id and rr.status = 'queued' and r.research_ends_at > now()
     returning rr.*`,
    [run.id, provider.name, provider.model, PROMPT_VERSION, SCHEMA_VERSION, provider.outputMode, input.published_on_or_after],
  )
  if (!started.length) {
    await cancelExpired(run.id)
    return
  }

  try {
    const { responseId } = await provider.start(input, context)
    // Persist the response id on the leased run immediately.
    await query(`update research_runs set provider_response_id = $2, lease_until = null where id = $1`, [run.id, responseId])
    log('runs.started', { run: run.id, kind: run.kind, provider: provider.name, attempt: run.retry_count + 1 })
  } catch (error) {
    const code = error instanceof ResearchError ? error.code : 'provider_failed'
    await handleFailure(started[0], code, (error as Error).message)
  }
}

/**
 * What the radar already knows: sources seen in the last 30 days (an unresolved one may be checked once more),
 * candidates already judged (a follow-up re-examines them, so it gets none), topics that produced leads, and
 * topics that never produced a candidate after three runs.
 */
async function runMemory(radarId: string, kind: RunRow['kind'], fresh = false) {
  const [seen, candidates, stats, watched] = await Promise.all([
    // The free second search runs because the first found nothing or the user corrected the focus: what the first one
    // set aside was judged against the old focus, so only published sources stay excluded.
    // A source set aside at triage (judged from a preview, sometimes from a title alone) or left unresolved gets a
    // second look on a later run before it is ignored; one that was read in full and judged is final. A radar whose
    // early runs triaged badly therefore heals by itself instead of staying blind to those posts for a month.
    query<{ source_key: string }>(
      `select source_key from seen_sources
       where radar_id = $1 and last_seen_at > now() - interval '30 days'
         and not (decision in ('unresolved', 'triaged_out') and times_seen < 2)
         and ($2::boolean is not true or decision = 'published')`,
      [radarId, fresh],
    ),
    kind === 'follow_up'
      ? Promise.resolve([] as Array<{ source_key: string }>)
      : query<{ source_key: string }>(
          `select distinct source_key from research_candidates where radar_id = $1 and source_key is not null and decision <> 'unresolved'`,
          [radarId],
        ),
    query<{ topic: string; runs: number; candidates: number; published: number; contacted: number }>(
      `select topic, runs, candidates, published, contacted from search_stats where radar_id = $1`,
      [radarId],
    ),
    // Communities that produced leads are all polled; until one has, only the few with the most promising posts:
    // each poll adds a full list of hits to the pool, and a community found by a weak search crowds out the rest.
    query<{ key: string }>(
      `select key from watched_sources w where radar_id = $1 and kind = 'subreddit' and enabled
         and (published > 0 or (select count(*) from watched_sources p where p.radar_id = w.radar_id and p.published > 0) = 0)
       order by published desc, hits desc
       limit (case when exists (select 1 from watched_sources p where p.radar_id = $1 and p.published > 0) then 8 else ${UNPROVEN_COMMUNITIES} end)`,
      [radarId],
    ),
  ])
  return {
    watchedSubreddits: watched.map((row) => row.key),
    excludeKeys: [...seen.map((row) => row.source_key), ...candidates.map((row) => row.source_key)],
    priorityTopics: stats
      .filter((row) => row.published > 0 || row.contacted > 0)
      .sort((a, b) => b.contacted - a.contacted || b.published - a.published || b.candidates - a.candidates)
      .map((row) => row.topic),
    deadTopics: stats.filter((row) => row.runs >= 3 && row.candidates === 0).map((row) => row.topic),
  }
}

async function cancelExpired(runId: string) {
  await query(
    `update research_runs set status = 'cancelled', error_code = 'research_expired',
       error = 'Research period ended before this run started', completed_at = now(), lease_until = null
     where id = $1 and status = 'queued'`,
    [runId],
  )
  log('runs.blocked_by_deadline', { run: runId })
}

/* --------------------------------- Check ---------------------------------- */

async function checkRun(run: RunRow) {
  const provider = getProvider()

  if (!run.provider_response_id) {
    // Crashed between marking running and persisting the id: the provider may have accepted the job.
    await handleFailure(run, 'uncertain_creation', 'Run has no persisted provider response id')
    return
  }

  const overDeadline = run.started_at && Date.now() - new Date(run.started_at).getTime() > (provider.deadlineMs ?? config.runDeadlineMs)
  if (overDeadline) {
    // Cancel, then resolve the terminal state exactly once; it may have completed just before cancellation.
    await provider.cancel(run.provider_response_id)
  }

  let inspection
  try {
    inspection = await provider.inspect(run.provider_response_id)
  } catch (error) {
    log('runs.poll_error', { run: run.id, error: (error as Error).message.slice(0, 200) })
    await release(run.id, 15_000)
    return
  }

  if (inspection.state === 'pending') {
    if (overDeadline) await handleFailure(run, 'timed_out', 'Attempt exceeded the wall deadline')
    else {
      // Publishing early is a bonus: if it fails, the final result still carries everything.
      if (inspection.partial) await savePartial(run, inspection.partial).catch((error) => log('runs.partial_failed', { run: run.id, error: (error as Error).message.slice(0, 200) }))
      await release(run.id)
    }
    return
  }
  if (inspection.state === 'failed') {
    const code = overDeadline && inspection.code === 'timed_out' ? 'timed_out' : inspection.code
    await handleFailure(run, code, inspection.message, inspection.usage, inspection.raw)
    return
  }

  await query(
    `update research_runs set status = 'processing', provider_completed_at = coalesce(provider_completed_at, now())
     where id = $1 and status in ('running', 'processing')`,
    [run.id],
  )

  let usage = inspection.usage
  let repairUsed = false
  let result: ResearchResultT
  try {
    const radar = await getRadar(run.radar_id)
    const parsed = await parseResult(inspection.text, provider, isResearchOpen(new Date(), new Date(radar.research_ends_at)))
    result = parsed.result
    repairUsed = parsed.repairUsed
    if (parsed.formatUsage) usage = addUsage(usage, parsed.formatUsage)
  } catch (error) {
    const code: ErrorCode = error instanceof ResearchError ? error.code : 'invalid_output'
    await handleFailure(run, code, (error as Error).message, usage, inspection.raw)
    return
  }

  await saveResults(run, result, inspection.auditUrls, inspection.actions, usage, inspection.raw, repairUsed)
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
    web_search_calls: a.web_search_calls + b.web_search_calls,
    ...(a.extra_cost_usd !== undefined || b.extra_cost_usd !== undefined
      ? { extra_cost_usd: (a.extra_cost_usd ?? 0) + (b.extra_cost_usd ?? 0) }
      : {}),
  }
}

function tryParse(text: string) {
  try {
    const parsed = ResearchResult.safeParse(JSON.parse(text))
    return parsed.success ? { ok: true as const, result: parsed.data } : { ok: false as const, problem: parsed.error.message }
  } catch (error) {
    return { ok: false as const, problem: (error as Error).message }
  }
}

/**
 * Structured mode: parse; on formatting defects, one tool-free schema repair (before expiry only).
 * Two-step mode: the formatting request is the normal path. Gates always rerun on the result.
 */
async function parseResult(text: string, provider: ResearchProvider, researchOpen: boolean) {
  if (provider.outputMode === 'structured') {
    const first = tryParse(text)
    if (first.ok) return { result: first.result, repairUsed: false, formatUsage: null }
    if (!researchOpen) throw new ResearchError('invalid_output', `Unparseable output after expiry: ${first.problem.slice(0, 300)}`)
    log('runs.format_repair', { problem: first.problem.slice(0, 200) })
  }
  const formatted = await provider.format(text)
  const second = tryParse(formatted.text)
  if (!second.ok) throw new ResearchError('invalid_output', `Unparseable after formatting: ${second.problem.slice(0, 300)}`)
  return { result: second.result, repairUsed: provider.outputMode === 'structured', formatUsage: formatted.usage }
}

/* ---------------------------------- Save ---------------------------------- */

/** Internal per-run diagnostics (research_runs.diagnostics). Never returned by public routes. */
export type RunDiagnostics = {
  model: string
  prompt_version: string
  schema_version: string
  research_status: ResearchResultT['research_status']
  acquisition_brief: BusinessProfileT['acquisition_brief'] | null
  angles: string[]
  proposed_queries: string[]
  executed_searches: string[]
  executed_actions: ToolAction[]
  opened_pages: number
  query_issues: Array<{ query: string; issues: string[] }>
  counts: { discovered: number; published: number; qualified_not_selected: number; unresolved: number; rejected: number }
  candidates_truncated: number
  profile_reasons: string[]
  access_failures: string[]
  limitations: string[]
  rejection_summary: string[]
  follow_up: {
    suggested: boolean
    reason: string
    untried_angles: string[]
    candidates_to_verify: string[]
    decision: { run: boolean; reason: string }
    run_id: string | null
  }
  format_repair_used: boolean
}

async function saveResults(
  run: RunRow,
  result: ResearchResultT,
  auditUrls: string[],
  actions: ToolAction[],
  usageIn: Usage,
  raw: unknown,
  repairUsed: boolean,
) {
  const radar = await getRadar(run.radar_id)
  const now = new Date()
  const provider = getProvider()
  const usage = usageIn

  let outcome: RunOutcome | null = null
  let profile: BusinessProfileT | null = run.kind === 'initial' ? null : radar.profile
  let profileToSave: BusinessProfileT | null = null
  const profileReasons: string[] = []

  if (run.kind === 'initial') {
    if (result.research_status === 'website_unreadable') outcome = 'website_unreadable'
    else if (result.research_status === 'unsupported_business') outcome = 'unsupported_business'
    else {
      const check = validateProfile(result.profile, radar.website, auditUrls)
      profileReasons.push(...check.reasons)
      if (check.ok) profile = profileToSave = result.profile
    }
    if (!outcome && !profile) {
      // The research ran but the offer could not be verified from the website: a failed run the user can retry.
      await finishFailed(run.id, 'profile_unverified', `Profile failed verification: ${profileReasons.join('; ')}`, usage, raw)
      return
    }
  } else if (profile && !profile.acquisition_brief && result.profile?.acquisition_brief) {
    // Profiles saved before research-v2 gain the brief once; website facts stay as they were.
    profile = profileToSave = { ...profile, acquisition_brief: result.profile.acquisition_brief }
  }

  let qualified: ReturnType<typeof qualifyCandidates> | null = null
  if (profile && !outcome) {
    const prior = await query<{ source_key: string; identity_key: string; need_text: string; run_id: string }>(
      `select source_key, identity_key, need_text, run_id from leads where radar_id = $1`,
      [radar.id],
    )
    // Leads this run published while it was still going keep their place among its five. After a retried attempt
    // they may not be among the candidates any more: they still count.
    const ownKeys = new Set(prior.filter((lead) => lead.run_id === run.id).map((lead) => lead.source_key))
    const candidateKeys = new Set(result.candidates.map((candidate) => sourceKey(candidate.source_url)))
    // Leads that qualified on an earlier run but lost its top-five cut were judged, never shown, and are excluded
    // from every later search. They compete with today's finds on score, so the best five are shown either way.
    // They passed these gates against the pages their own run read: those pages vouch for them here too.
    const backlog = (
      await query<{ data: CandidateT }>(
        `select distinct on (c.source_key) c.data from research_candidates c
         where c.radar_id = $1 and c.run_id <> $2 and c.decision = 'qualified_not_selected' and c.source_key is not null
           and not exists (select 1 from leads l where l.radar_id = c.radar_id and l.source_key = c.source_key)
         order by c.source_key, c.score_total desc`,
        [radar.id, run.id],
      )
    )
      .map((row) => row.data)
      .filter((candidate) => !candidateKeys.has(sourceKey(candidate.source_url)))
    const backlogKeys = new Set(backlog.map((candidate) => sourceKey(candidate.source_url)))
    auditUrls = [...auditUrls, ...backlog.flatMap((candidate) => [candidate.source_url, ...candidate.evidence.map((item) => item.url)])]
    qualified = qualifyCandidates([...result.candidates.slice(0, MAX_CANDIDATES), ...backlog], {
      publishedKeys: ownKeys,
      maxPublished: MAX_PUBLISHED_PER_RUN - [...ownKeys].filter((key) => !candidateKeys.has(key)).length,
      now,
      publishedOnOrAfter: run.published_on_or_after
        ? new Date(run.published_on_or_after).toISOString().slice(0, 10)
        : now.toISOString().slice(0, 10),
      auditUrls,
      profile,
      focus: radar.focus,
      // Leads already saved by this run (re-processing after a crash) are not duplicates of themselves.
      prior: prior
        .filter((lead) => lead.run_id !== run.id)
        .map((lead) => ({ sourceKey: lead.source_key, identityKey: lead.identity_key, needText: lead.need_text })),
    })
    const promoted = qualified.published.filter((lead) => backlogKeys.has(lead.sourceKey)).map((lead) => lead.sourceKey)
    if (promoted.length) {
      await query(`update research_candidates set decision = 'published' where radar_id = $1 and decision = 'qualified_not_selected' and source_key = any($2::text[])`, [radar.id, promoted])
      log('runs.backlog_published', { run: run.id, published: promoted.length })
    }
    const { counts } = qualified
    if (counts.published > 0) outcome = 'qualified_results'
    else if (result.research_status === 'incomplete') outcome = 'research_incomplete'
    else if (counts.unresolved > 0) outcome = 'candidates_unresolved'
    else if (counts.discovered > 0) outcome = 'candidates_rejected'
    else outcome = 'no_candidates'
  }

  const published = qualified?.published ?? []
  const followUp = followUpDecision({
    enabled: AUTOMATIC_FOLLOW_UPS,
    kind: run.kind,
    researchStatus: result.research_status,
    published: published.length,
    unresolved: qualified?.counts.unresolved ?? 0,
    untriedAngles: result.follow_up.untried_angles,
    worthwhile: result.follow_up.worthwhile,
    researchOpen: isResearchOpen(now, new Date(radar.research_ends_at)) && Boolean(profile),
  })

  const executedSearches = actions.filter((action) => action.query).map((action) => action.query!)
  const pipeline = (raw as { pipeline?: PipelineSummary } | null)?.pipeline ?? null
  // Which search topic surfaced each source (pipeline runs only), for per-topic yields and lead feedback.
  const topicBySource = new Map<string, string>()
  for (const source of pipeline?.sources ?? []) {
    const key = sourceKey(source.url)
    if (key) topicBySource.set(key, source.topic)
  }
  const diagnostics: RunDiagnostics = {
    model: provider.model,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    research_status: result.research_status,
    acquisition_brief: profile?.acquisition_brief ?? result.profile?.acquisition_brief ?? null,
    angles: result.search_plan.angles,
    proposed_queries: result.search_plan.proposed_queries,
    executed_searches: executedSearches,
    executed_actions: actions,
    opened_pages: actions.filter((action) => action.type === 'open_page').length,
    query_issues: executedSearches.map((q) => ({ query: q, issues: lintQuery(q) })).filter((q) => q.issues.length),
    counts: qualified?.counts ?? { discovered: result.candidates.length, published: 0, qualified_not_selected: 0, unresolved: 0, rejected: 0 },
    candidates_truncated: Math.max(0, result.candidates.length - MAX_CANDIDATES),
    profile_reasons: profileReasons,
    access_failures: result.coverage.access_failures,
    limitations: result.coverage.limitations,
    rejection_summary: result.coverage.rejection_summary,
    follow_up: {
      suggested: result.follow_up.worthwhile,
      reason: result.follow_up.reason,
      untried_angles: result.follow_up.untried_angles,
      candidates_to_verify: result.follow_up.candidates_to_verify,
      decision: followUp,
      run_id: null,
    },
    format_repair_used: repairUsed,
  }

  // Emails: an initial run whose follow-up will run defers its email to the follow-up, so the user gets one
  // "first results" email with everything. Daily runs and other follow-ups email only when there is news.
  let parentKind: string | null = null
  if (run.kind === 'follow_up' && run.parent_run_id) {
    parentKind = (await query<{ kind: string }>(`select kind from research_runs where id = $1`, [run.parent_run_id]))[0]?.kind ?? null
  }
  // Watch runs email at once only for a strong explicit request; everything else waits for the morning digest,
  // which sends every lead not yet emailed (leads.emailed_at), so nothing is lost or sent twice.
  const instant = published.some((lead) => lead.lead.intent === 'explicit_request' && lead.score.total >= config.instantAlertMinScore)
  const [unemailedRow] = await query<{ count: number }>(
    `select count(*)::int as count from leads where radar_id = $1 and emailed_at is null and held_reason is null and run_id <> $2`,
    [radar.id, run.id],
  )
  const unemailed = unemailedRow.count + published.length
  const emailStatus =
    // The free second search emails only when it found something: the first search already sent its report.
    run.run_key === RERUN_KEY
      ? published.length
        ? 'pending'
        : 'skipped'
      : run.kind === 'initial'
      ? followUp.run
        ? 'skipped'
        : 'pending'
      : run.kind === 'watch'
        ? instant
          ? 'pending'
          : 'skipped'
        : unemailed > 0 || parentKind === 'initial'
          ? 'pending'
          : 'skipped'

  // Main-model and small-model tokens at their own rates; hosted searches per call; Exa costs as reported.
  const cost =
    (usage.input_tokens / 1e6) * config.cost.inputPerMTok +
    (usage.output_tokens / 1e6) * config.cost.outputPerMTok +
    ((usage.small_input_tokens ?? 0) / 1e6) * config.cost.smallInputPerMTok +
    ((usage.small_output_tokens ?? 0) / 1e6) * config.cost.smallOutputPerMTok +
    usage.web_search_calls * config.cost.perWebSearch +
    (usage.extra_cost_usd ?? 0)

  // Profile, leads, candidates, follow-up and run outcome persist atomically.
  await transaction(async (tx) => {
    if (run.kind === 'initial') {
      // A radar on trial or on a paid plan gets its morning runs; a sleeping one schedules nothing.
      const live = agentLive(radar.plan, new Date(radar.research_ends_at), now, { createdAt: new Date(radar.created_at), trialDays: config.trialDays })
      const nextRun = profile && live ? nextDailyRunAt(now, radar.timezone, scheduleEnd(radar), config.dailyRunHour) : null
      await tx.query(`update radars set profile = $2, next_run_at = coalesce(next_run_at, $3) where id = $1`, [
        radar.id,
        profileToSave ? toJsonb(profileToSave) : null,
        nextRun,
      ])
    } else if (profileToSave) {
      await tx.query(`update radars set profile = $2 where id = $1`, [radar.id, toJsonb(profileToSave)])
    }

    for (const lead of published) await insertLead(tx, radar.id, run.id, lead, now, topicBySource.get(lead.sourceKey) ?? null)

    // Watched sources: the communities where candidates were found, polled by watch runs once the agent is active.
    if (pipeline) {
      const communities = new Map<string, { hits: number; published: number }>()
      for (const source of pipeline.sources) {
        // A post merely worth a look (triage 1) says little about where the buyers are.
        if (!source.community?.startsWith('r/') || source.triage < 2) continue
        const key = sourceKey(source.url)
        const decision = key ? (qualified?.outcomes ?? []).find((outcome) => outcome.source_key === key)?.decision : undefined
        const entry = communities.get(source.community) ?? { hits: 0, published: 0 }
        entry.hits++
        if (decision === 'published') entry.published++
        communities.set(source.community, entry)
      }
      for (const [community, entry] of communities) {
        await tx.query(
          `insert into watched_sources (radar_id, kind, key, label, hits, published, last_item_at)
           values ($1, 'subreddit', $2, $3, $4, $5, now())
           on conflict (radar_id, kind, key) do update set hits = watched_sources.hits + excluded.hits,
             published = watched_sources.published + excluded.published, last_item_at = now()`,
          [radar.id, community.slice(2), community, entry.hits, entry.published],
        )
      }
      if (run.kind === 'watch') {
        await tx.query(`update watched_sources set last_polled_at = now() where radar_id = $1 and enabled`, [radar.id])
      }
    }

    // Memory: every hit the pipeline triaged, with what became of it, and each topic's yield this run.
    if (pipeline) {
      const decisionByKey = new Map<string, string>()
      for (const outcome of qualified?.outcomes ?? []) if (outcome.source_key) decisionByKey.set(outcome.source_key, outcome.decision)
      for (const hit of pipeline.triage) {
        const key = sourceKey(hit.url)
        if (!key) continue
        await tx.query(
          `insert into seen_sources (radar_id, source_key, url, triage_score, decision)
           values ($1, $2, $3, $4, $5)
           on conflict (radar_id, source_key) do update set last_seen_at = now(), times_seen = seen_sources.times_seen + 1,
             triage_score = excluded.triage_score, decision = excluded.decision`,
          [radar.id, key, hit.url, hit.score, decisionByKey.get(key) ?? 'triaged_out'],
        )
      }
      for (const topic of pipeline.topics) {
        const hits = pipeline.searches.filter((search) => search.query === topic.query).reduce((sum, search) => sum + search.hits, 0)
        const outcomesForTopic = (qualified?.outcomes ?? []).filter((outcome) => outcome.source_key && topicBySource.get(outcome.source_key) === topic.query)
        await tx.query(
          `insert into search_stats (radar_id, topic, runs, hits, candidates, published, last_used_at)
           values ($1, $2, 1, $3, $4, $5, now())
           on conflict (radar_id, topic) do update set runs = search_stats.runs + 1, hits = search_stats.hits + excluded.hits,
             candidates = search_stats.candidates + excluded.candidates, published = search_stats.published + excluded.published,
             last_used_at = now()`,
          [radar.id, topic.query, hits, outcomesForTopic.length, outcomesForTopic.filter((outcome) => outcome.decision === 'published').length],
        )
      }
    }

    await tx.query(`delete from research_candidates where run_id = $1`, [run.id])
    for (const candidate of qualified?.outcomes ?? []) {
      await tx.query(
        `insert into research_candidates (run_id, radar_id, source_url, source_key, headline, decision, model_decision,
           reasons, date_status, published_date, score_total, data)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          run.id,
          radar.id,
          candidate.source_url,
          candidate.source_key,
          candidate.headline.slice(0, 500),
          candidate.decision,
          candidate.model_decision,
          toJsonb(candidate.reasons),
          candidate.date_status,
          candidate.published_date,
          candidate.score.total,
          toJsonb(candidate.candidate),
        ],
      )
    }

    if (followUp.run) {
      // One follow-up per run (unique run_key), only while research is open.
      const [created] = await tx.query<{ id: string }>(
        `insert into research_runs (radar_id, kind, run_key, status, scheduled_at, parent_run_id)
         select $1, 'follow_up', $2, 'queued', now(), $3
         where exists (select 1 from radars where id = $1 and research_ends_at > now())
         on conflict (radar_id, kind, run_key) do nothing
         returning id`,
        [radar.id, `follow_up:${run.id}`, run.id],
      )
      diagnostics.follow_up.run_id = created?.id ?? null
    }

    await tx.query(
      // Enrichment of leads published during the run has already added its own usage and cost.
      `update research_runs set status = 'completed', outcome = $2, usage = coalesce(usage, '{}'::jsonb) || $3::jsonb,
         cost_usd = coalesce(cost_usd, 0) + $4, coverage = $5,
         audit_urls = $6, validation_report = $7, raw_response = $8, format_repair_used = $9, email_status = $10,
         diagnostics = $11, error_code = null, error = null, completed_at = now(), lease_until = null,
         duration_ms = (extract(epoch from (now() - started_at)) * 1000)::int
       where id = $1`,
      [
        run.id,
        outcome,
        toJsonb(usage),
        cost.toFixed(4),
        toJsonb({ ...result.coverage, queries_reported: result.search_plan.proposed_queries }),
        toJsonb(auditUrls),
        toJsonb({
          model_outcome: result.research_status,
          returned_leads: result.candidates.length,
          rejected: (qualified?.outcomes ?? [])
            .filter((c) => c.decision !== 'published')
            .map((c) => ({ headline: c.headline, source_url: c.source_url, decision: c.decision, reasons: c.reasons })),
          held: [],
          profile_reasons: profileReasons,
        }),
        toJsonb(raw ?? null),
        repairUsed,
        emailStatus,
        toJsonb(diagnostics),
      ],
    )
  })

  // Leads are visible from here on. Who is behind each one comes next, and must never hold them back.
  if (published.length) await enrichLeads(run.id).catch((error) => log('runs.enrich_failed', { run: run.id, error: (error as Error).message.slice(0, 120) }))

  if (published.length && radar.webhook_url) {
    await postWebhook(radar.webhook_url, { websiteHost: radar.website_host, leads: published.map((item) => item.lead) }).catch((error) =>
      log('runs.webhook_failed', { run: run.id, error: (error as Error).message.slice(0, 120) }),
    )
  }

  log('runs.completed', {
    run: run.id,
    kind: run.kind,
    outcome,
    ...diagnostics.counts,
    executed_searches: executedSearches.length,
    opened_pages: diagnostics.opened_pages,
    follow_up: followUp.run ? 'scheduled' : followUp.reason,
    cost_usd: Number(cost.toFixed(4)),
    format_repair: repairUsed,
  })
}

async function insertLead(tx: Queryable, radarId: string, runId: string, lead: QualifiedLead, now: Date, topic: string | null) {
  await tx.query(
    `insert into leads (radar_id, run_id, source_url, source_key, identity_key, need_text, published_date, intent,
       score_total, discovered_at, data, topic)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (radar_id, source_key) do nothing`,
    [
      radarId,
      runId,
      lead.sourceUrl,
      lead.sourceKey,
      lead.identityKey,
      lead.needText,
      lead.lead.published_date,
      lead.lead.intent,
      lead.score.total,
      now,
      toJsonb(lead.lead satisfies LeadT),
      topic,
    ],
  )
}

/* -------------------------------- Partial --------------------------------- */

/**
 * Results handed over while the run is still going: the profile once the website is read, then the candidates of
 * each qualification batch. They pass the same gates as at the end and count towards the run's five leads; the final
 * save then finds them already stored. Everything here is idempotent, so a partial delivered twice changes nothing.
 */
async function savePartial(run: RunRow, partial: PartialResult) {
  const radar = await getRadar(run.radar_id)
  const now = new Date()
  let profile = radar.profile
  if (run.kind === 'initial') {
    // The same verification as the final save, on the same website pages: an unverified profile shows nothing.
    if (!partial.profile || !validateProfile(partial.profile, radar.website, partial.auditUrls).ok) return
    profile = partial.profile
    if (!radar.profile) await query(`update radars set profile = $2 where id = $1 and profile is null`, [radar.id, toJsonb(profile)])
  }
  if (!profile || !partial.candidates.length) return

  const prior = await query<{ source_key: string; identity_key: string; need_text: string; run_id: string }>(
    `select source_key, identity_key, need_text, run_id from leads where radar_id = $1`,
    [radar.id],
  )
  const qualified = qualifyCandidates(partial.candidates.slice(0, MAX_CANDIDATES), {
    now,
    publishedOnOrAfter: run.published_on_or_after ? new Date(run.published_on_or_after).toISOString().slice(0, 10) : now.toISOString().slice(0, 10),
    auditUrls: partial.auditUrls,
    profile,
    focus: radar.focus,
    // Batches hold different sources, so this run's earlier leads are real duplicates to check against.
    prior: prior.map((lead) => ({ sourceKey: lead.source_key, identityKey: lead.identity_key, needText: lead.need_text })),
    maxPublished: MAX_PUBLISHED_PER_RUN - prior.filter((lead) => lead.run_id === run.id).length,
  })
  if (!qualified.published.length) return

  const topicBySource = new Map<string, string>()
  for (const source of partial.sources) {
    const key = sourceKey(source.url)
    if (key) topicBySource.set(key, source.topic)
  }
  await transaction(async (tx) => {
    for (const lead of qualified.published) await insertLead(tx, radar.id, run.id, lead, now, topicBySource.get(lead.sourceKey) ?? null)
  })
  log('runs.partial_published', { run: run.id, kind: run.kind, published: qualified.published.length })
  await enrichLeads(run.id)
}

/* ------------------------------- Enrichment ------------------------------- */

/**
 * The public business footprint behind each lead ("Who they are"), looked up after the lead is visible. A lead
 * without the `enrichment` key has not been tried yet; after one try the key holds the finding or null, so nothing
 * is looked up twice. With a run id: that run's leads, now. Without: leads a crashed function left behind.
 */
async function enrichLeads(runId: string | null) {
  if (getProvider().name === 'mock') return
  const rows = await query<{ id: string; run_id: string; data: LeadT; profile: BusinessProfileT }>(
    `select l.id, l.run_id, l.data, r.profile from leads l join radars r on r.id = l.radar_id
     where not jsonb_exists(l.data, 'enrichment') and r.profile is not null and l.held_reason is null
       and ${runId ? 'l.run_id = $1' : `l.discovered_at between now() - interval '1 day' and now() - interval '3 minutes' and $1::text is null`}
     order by l.discovered_at limit 10`,
    [runId],
  )
  if (!rows.length) return
  const outcomes = await Promise.allSettled(rows.map((row) => enrichLead(row.data, row.profile, 45_000)))
  for (const [index, outcome] of outcomes.entries()) {
    const row = rows[index]
    const found = outcome.status === 'fulfilled' ? outcome.value : null
    if (!found) log('runs.enrich_failed', { run: row.run_id, error: String((outcome as PromiseRejectedResult).reason?.message ?? 'unknown').slice(0, 120) })
    await query(`update leads set data = jsonb_set(data, '{enrichment}', $2::jsonb) where id = $1`, [row.id, toJsonb(found?.enrichment ?? null)])
    if (!found) continue
    const { usage } = found
    const cost =
      (usage.input_tokens / 1e6) * config.cost.smallInputPerMTok +
      (usage.output_tokens / 1e6) * config.cost.smallOutputPerMTok +
      usage.web_search_calls * config.cost.perWebSearch
    await query(
      `update research_runs set cost_usd = coalesce(cost_usd, 0) + $2,
         usage = coalesce(usage, '{}'::jsonb) || jsonb_build_object(
           'enrich_input_tokens', coalesce((usage->>'enrich_input_tokens')::int, 0) + $3::int,
           'enrich_output_tokens', coalesce((usage->>'enrich_output_tokens')::int, 0) + $4::int,
           'enrich_web_search_calls', coalesce((usage->>'enrich_web_search_calls')::int, 0) + $5::int)
       where id = $1`,
      [row.run_id, cost.toFixed(4), usage.input_tokens, usage.output_tokens, usage.web_search_calls],
    )
  }
}

/* -------------------------------- Failures -------------------------------- */

async function handleFailure(run: RunRow, code: ErrorCode, message: string, usage?: Usage, raw?: unknown) {
  if (isRetryable(code) && run.retry_count < config.maxAutomaticRetries) {
    // At most one automatic research retry per run, only before expiry; the deadline is checked again at start.
    const rows = await query(
      `update research_runs rr
       set status = 'queued', retry_count = rr.retry_count + 1, error_code = $2, error = $3,
           provider_response_id = null, started_at = null, provider_completed_at = null, lease_until = null,
           scheduled_at = now() + ($4 || ' milliseconds')::interval
       from radars r
       where rr.id = $1 and r.id = rr.radar_id and r.research_ends_at > now() and rr.status <> 'completed'
       returning rr.id`,
      [run.id, code, message.slice(0, 1000), String(config.retryBackoffMs)],
    )
    if (rows.length) {
      log('runs.retry_scheduled', { run: run.id, code })
      return
    }
  }
  await finishFailed(run.id, code, message, usage, raw)
}

async function finishFailed(runId: string, code: ErrorCode, message: string, usage?: Usage, raw?: unknown) {
  await query(
    `update research_runs set status = 'failed', error_code = $2, error = $3, usage = coalesce($4, usage),
       raw_response = coalesce($5, raw_response), completed_at = now(), lease_until = null
     where id = $1 and status <> 'completed'`,
    [runId, code, message.slice(0, 1000), usage ? toJsonb(usage) : null, raw ? toJsonb(raw) : null],
  )
  log('runs.failed', { run: runId, code })
}
