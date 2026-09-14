import 'server-only'
import { config } from './config'
import { query, transaction } from './db'
import type { RadarRow, RunRow } from './radars'
import {
  PROMPT_VERSION,
  ResearchResult,
  SCHEMA_VERSION,
  SUCCESSFUL_OUTCOMES,
  type BusinessProfileT,
  type LeadT,
  type ResearchResultT,
  type RunOutcome,
} from './research/contract'
import { isResearchOpen, qualifyLeads, validateProfile, type QualifiedLead } from './research/gates'
import { buildResearchInput, type ExcludedOpportunity } from './research/prompt'
import { getProvider, isRetryable, ResearchError, type ErrorCode, type ResearchProvider, type Usage } from './research/provider'
import { localDateKey, nextDailyRunAt } from './time'

const MAX_PER_TICK = 20

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
  await enqueueDueDailyRuns()

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
}

async function enqueueDueDailyRuns() {
  const due = await query<Pick<RadarRow, 'id' | 'timezone' | 'next_run_at' | 'research_ends_at'>>(
    `select id, timezone, next_run_at, research_ends_at from radars
     where next_run_at <= now() and research_ends_at > now() and profile is not null
     order by next_run_at limit 100`,
  )
  const now = new Date()
  for (const radar of due) {
    const next = nextDailyRunAt(now, radar.timezone, new Date(radar.research_ends_at), config.dailyRunHour)
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
  if (run.kind === 'daily' && !radar.profile) {
    await finishFailed(run.id, 'provider_failed', 'Radar has no validated profile for a daily run')
    return
  }

  const now = new Date()
  const [lastSuccess, prior] = await Promise.all([
    lastSuccessfulRunAt(radar.id),
    query<{ source_url: string; published_date: Date | string; user_status: ExcludedOpportunity['status']; data: LeadT }>(
      `select source_url, published_date, user_status, data from leads where radar_id = $1 order by discovered_at`,
      [radar.id],
    ),
  ])
  const input = buildResearchInput({
    mode: run.kind,
    now,
    websiteUrl: radar.website,
    outputLanguage: radar.output_language,
    lastSuccessfulRunAt: lastSuccess,
    profile: radar.profile,
    focus: radar.focus,
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
    const { responseId } = await provider.start(input)
    // Persist the response id on the leased run immediately.
    await query(`update research_runs set provider_response_id = $2, lease_until = null where id = $1`, [run.id, responseId])
    log('runs.started', { run: run.id, kind: run.kind, provider: provider.name, attempt: run.retry_count + 1 })
  } catch (error) {
    const code = error instanceof ResearchError ? error.code : 'provider_failed'
    await handleFailure(started[0], code, (error as Error).message)
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

  const overDeadline = run.started_at && Date.now() - new Date(run.started_at).getTime() > config.runDeadlineMs
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
    else await release(run.id)
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

  await saveResults(run, result, inspection.auditUrls, usage, inspection.raw, repairUsed)
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
    web_search_calls: a.web_search_calls + b.web_search_calls,
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

async function saveResults(
  run: RunRow,
  result: ResearchResultT,
  auditUrls: string[],
  usage: Usage,
  raw: unknown,
  repairUsed: boolean,
) {
  const radar = await getRadar(run.radar_id)
  const now = new Date()
  const report: Record<string, unknown> = { model_outcome: result.outcome, returned_leads: result.leads.length }

  let outcome: RunOutcome | null = null
  let profile: BusinessProfileT | null = run.kind === 'initial' ? null : radar.profile

  if (run.kind === 'initial') {
    if (result.outcome === 'website_unreadable') outcome = 'website_unreadable'
    else if (result.outcome === 'unsupported_business') outcome = 'unsupported_business'
    else {
      const check = validateProfile(result.profile, radar.website, auditUrls)
      report.profile_reasons = check.reasons
      if (check.ok) profile = result.profile
      else outcome = 'validation_failed'
    }
  }

  let published: QualifiedLead[] = []
  let held: QualifiedLead[] = []
  if (profile && !outcome) {
    const prior = await query<{ source_key: string; identity_key: string; need_text: string; run_id: string }>(
      `select source_key, identity_key, need_text, run_id from leads where radar_id = $1`,
      [radar.id],
    )
    const qualified = qualifyLeads(result.leads, {
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
    published = qualified.published
    held = qualified.held
    report.rejected = qualified.rejected
    report.held = held.map((lead) => ({ source_url: lead.sourceUrl, reason: lead.heldReason }))

    if (result.outcome === 'insufficient_coverage') outcome = 'insufficient_coverage'
    else if (result.leads.length > 0 && published.length + held.length === 0) outcome = 'validation_failed'
    else if (published.length > 0) outcome = 'matches'
    else outcome = 'no_matches'
  }

  const cost =
    (usage.input_tokens / 1e6) * config.cost.inputPerMTok +
    (usage.output_tokens / 1e6) * config.cost.outputPerMTok +
    usage.web_search_calls * config.cost.perWebSearch

  // Profile, leads and run outcome persist atomically. The page counts inserted records, not model claims.
  await transaction(async (tx) => {
    if (run.kind === 'initial') {
      const nextRun = profile ? nextDailyRunAt(now, radar.timezone, new Date(radar.research_ends_at), config.dailyRunHour) : null
      await tx.query(`update radars set profile = $2, next_run_at = coalesce(next_run_at, $3) where id = $1`, [
        radar.id,
        profile ? JSON.stringify(profile) : null,
        nextRun,
      ])
    }
    for (const lead of [...published, ...held]) {
      await tx.query(
        `insert into leads (radar_id, run_id, source_url, source_key, identity_key, need_text, published_date, intent,
           score_total, discovered_at, data, held_reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (radar_id, source_key) do nothing`,
        [
          radar.id,
          run.id,
          lead.sourceUrl,
          lead.sourceKey,
          lead.identityKey,
          lead.needText,
          lead.lead.published_date,
          lead.lead.intent,
          lead.score.total,
          now,
          JSON.stringify(lead.lead),
          lead.heldReason,
        ],
      )
    }
    await tx.query(
      `update research_runs set status = 'completed', outcome = $2, usage = $3, cost_usd = $4, coverage = $5,
         audit_urls = $6, validation_report = $7, raw_response = $8, format_repair_used = $9,
         error_code = null, error = null, completed_at = now(), lease_until = null,
         duration_ms = (extract(epoch from (now() - started_at)) * 1000)::int
       where id = $1`,
      [
        run.id,
        outcome,
        JSON.stringify(usage),
        cost.toFixed(4),
        JSON.stringify(result.coverage),
        JSON.stringify(auditUrls),
        JSON.stringify(report),
        JSON.stringify(raw ?? null),
        repairUsed,
      ],
    )
  })

  log('runs.completed', {
    run: run.id,
    kind: run.kind,
    outcome,
    published: published.length,
    held: held.length,
    rejected: Array.isArray(report.rejected) ? report.rejected.length : 0,
    cost_usd: Number(cost.toFixed(4)),
    web_searches: usage.web_search_calls,
    format_repair: repairUsed,
  })
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
    [runId, code, message.slice(0, 1000), usage ? JSON.stringify(usage) : null, raw ? JSON.stringify(raw) : null],
  )
  log('runs.failed', { run: runId, code })
}
