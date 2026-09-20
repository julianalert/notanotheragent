import { APIConnectionError, APIError } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  BriefResult,
  MAX_OUTPUT_TOKENS,
  MAX_SOURCES_TO_READ,
  MIN_TRIAGE_SCORE,
  PIPELINE_DEADLINE_MINUTES,
  RESEARCH_MODEL,
  RESEARCH_REASONING_EFFORT,
  ResearchResult,
  SCHEMA_NAME,
  SEARCH_MODEL,
  SOURCE_PAGE_CHARS,
  TriageResult,
  WEBSITE_PAGES,
  WEBSITE_PAGE_CHARS,
  type BusinessProfileT,
  type ResearchResultT,
} from './contract'
import { toJsonb } from '../jsonb'
import { confirmHandlesFromSources, sourceKey } from './gates'
import { fetchPage, readWebsite } from './pages'
import { BRIEF_PROMPT, deriveTopics, QUALIFY_PROMPT, TRIAGE_PROMPT, type ResearchInput, type SearchTopic } from './prompt'
import {
  auditFromOutput,
  classifyCreateError,
  isRetryable,
  openai,
  repairFormat,
  ResearchError,
  usageOf,
  type ErrorCode,
  type Inspection,
  type OutputItem,
  type PartialResult,
  type ResearchProvider,
  type RunContext,
  type RunProgress,
  type ToolAction,
  type Usage,
} from './provider'
import { discover, type Connector, type DiscoverResult, type SearchHit } from './search'
import { exaConfigured, exaContents } from './search/exa'
import { readWithOpenAI } from './search/openai-search'

/*
 * Discovery pipeline provider. The application searches (connectors), triages, reads and only then asks the
 * research model to qualify from full text, with no tools. One step advances per scheduler tick, so every
 * step stays well inside a serverless invocation and can be retried on its own. The audit the gates check is
 * exactly the set of pages the application read.
 */

export type PipelineStep = 'brief' | 'search' | 'triage' | 'read' | 'qualify' | 'qualify_poll' | 'done' | 'failed'

export type PipelineSource = {
  id: string
  url: string
  title: string
  connector: Connector
  topic: string
  community: string | null
  publishedDate: string | null
  text: string
  /** Text came from the application's own fetch (true) or from the connector's content (false). */
  fetched: boolean
  triage: number
  reason: string
}

export type PipelineState = {
  version: 1
  step: PipelineStep
  attempts: Partial<Record<PipelineStep, number>>
  startedAt: string
  input: ResearchInput
  /** Connectors for this run (watch runs restrict them). */
  connectors: Connector[] | null
  subreddits: string[]
  excludeKeys: string[]
  priorityTopics: string[]
  deadTopics: string[]
  profile: BusinessProfileT | null
  websitePages: string[]
  plannedQueries: string[]
  topics: SearchTopic[]
  hits: SearchHit[]
  searches: DiscoverResult['searches']
  unavailable: Connector[]
  triage: Array<{ id: string; url: string; score: number; reason: string }>
  sources: PipelineSource[]
  accessFailures: string[]
  usage: Usage
  /** Runs started before qualification was split into batches hold their single request here. */
  qualifyResponseId: string | null
  /** One background qualification request per batch of sources, best-looking sources first. */
  qualifyBatches?: QualifyBatch[]
  /** When the current step began, for the progress shown during the wait. */
  stepStartedAt?: string
  resultText: string | null
  auditUrls: string[]
  actions: ToolAction[]
  error: { code: ErrorCode; message: string } | null
}

export type QualifyBatch = {
  responseId: string
  sourceIds: string[]
  status: 'pending' | 'done' | 'failed'
  result: ResearchResultT | null
  error: string | null
  /** Its candidates were given to the scheduler to publish before the run ended. */
  handedOver: boolean
}

export interface PipelineStore {
  create(state: PipelineState): Promise<string>
  load(id: string): Promise<PipelineState | null>
  save(id: string, state: PipelineState): Promise<void>
  /** Step and counts only: read while a visitor waits, so it must never load the source texts. */
  progress(id: string): Promise<RunProgress | null>
}

const PROGRESS_STEPS = new Set(['brief', 'search', 'triage', 'read', 'qualify', 'qualify_poll'])

export function progressOf(state: PipelineState): RunProgress | null {
  if (!PROGRESS_STEPS.has(state.step)) return null
  const past = (step: PipelineStep) => ORDER.indexOf(state.step) > ORDER.indexOf(step)
  const batches = state.qualifyBatches
  return {
    step: state.step === 'qualify_poll' ? 'qualify' : (state.step as RunProgress['step']),
    stepStartedAt: state.stepStartedAt ?? null,
    // Two entries per page (requested and final URL).
    websitePages: past('brief') && state.websitePages.length ? Math.ceil(state.websitePages.length / 2) : null,
    hits: past('search') ? state.hits.length : null,
    sources: past('triage') ? state.sources.length : null,
    batches: batches?.length ? { done: batches.filter((batch) => batch.status !== 'pending').length, total: batches.length } : null,
  }
}

const ORDER: PipelineStep[] = ['brief', 'search', 'triage', 'read', 'qualify', 'qualify_poll', 'done']

/** Postgres-backed store (pipeline_runs). The database module is loaded lazily so scripts can use the memory store. */
export const dbPipelineStore: PipelineStore = {
  async create(state) {
    const { query } = await import('../db')
    const [row] = await query<{ id: string }>(`insert into pipeline_runs (state) values ($1) returning id`, [toJsonb(state)])
    return row.id
  },
  async load(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const { query } = await import('../db')
    const [row] = await query<{ state: PipelineState }>(`select state from pipeline_runs where id = $1`, [id])
    return row?.state ?? null
  },
  async save(id, state) {
    const { query } = await import('../db')
    await query(`update pipeline_runs set state = $2, updated_at = now() where id = $1`, [id, toJsonb(state)])
  },
  async progress(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const { query } = await import('../db')
    // Projected in SQL: the state holds every source text, far too much to load on each poll of the waiting page.
    const [row] = await query<{ step: PipelineStep; step_started_at: string | null; pages: number; hits: number; sources: number; batches: Array<{ status: string }> | null }>(
      `select state->>'step' as step, state->>'stepStartedAt' as step_started_at,
         jsonb_array_length(coalesce(state->'websitePages', '[]'::jsonb)) as pages,
         jsonb_array_length(coalesce(state->'hits', '[]'::jsonb)) as hits,
         jsonb_array_length(coalesce(state->'sources', '[]'::jsonb)) as sources,
         (select jsonb_agg(jsonb_build_object('status', batch->>'status')) from jsonb_array_elements(coalesce(state->'qualifyBatches', '[]'::jsonb)) batch) as batches
       from pipeline_runs where id = $1`,
      [id],
    )
    if (!row) return null
    return progressOf({
      step: row.step,
      stepStartedAt: row.step_started_at ?? undefined,
      websitePages: Array.from({ length: row.pages }, () => ''),
      hits: Array.from({ length: row.hits }) as PipelineState['hits'],
      sources: Array.from({ length: row.sources }) as PipelineState['sources'],
      qualifyBatches: (row.batches ?? []) as QualifyBatch[],
    } as PipelineState)
  },
}

/** In-process store for the evaluation script and tests. */
export function memoryPipelineStore(): PipelineStore & { states: Map<string, PipelineState> } {
  const states = new Map<string, PipelineState>()
  let counter = 0
  return {
    states,
    async create(state) {
      const id = `mem_${++counter}`
      states.set(id, structuredClone(state))
      return id
    },
    async load(id) {
      const state = states.get(id)
      return state ? structuredClone(state) : null
    },
    async save(id, state) {
      states.set(id, structuredClone(state))
    },
    async progress(id) {
      const state = states.get(id)
      return state ? progressOf(state) : null
    },
  }
}

const DAY_MS = 86_400_000
const MAX_STEP_ATTEMPTS = 3
/**
 * A step runs inside one scheduled function call (5 minutes at most). A step killed with the function saves nothing
 * and counts no attempt, so it would start again, and spend again, on every lease until the run deadline. Past this
 * budget the step is abandoned as a counted, retryable attempt instead.
 */
const STEP_BUDGET_MS = 240_000
const TRIAGE_BATCH = 40
/** A failed triage batch is retried alone, after 15 s and then 30 s (rate limits are per minute). */
const TRIAGE_BATCH_RETRIES = 2
const TRIAGE_RETRY_PAUSE_MS = 15_000
/**
 * Sources per qualification request. The requests run side by side, best-looking sources first, so the first leads
 * are confirmed (and shown) while the rest are still being judged, and the whole step takes as long as one batch.
 */
const QUALIFY_BATCH_SIZE = 5
/** Pages read through hosted browsing per run (each is a small model call). */
const MAX_BROWSER_READS = 8

function log(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }))
}

const addUsage = (state: PipelineState, usage: Partial<Usage>) => {
  state.usage.input_tokens += usage.input_tokens ?? 0
  state.usage.output_tokens += usage.output_tokens ?? 0
  state.usage.reasoning_tokens += usage.reasoning_tokens ?? 0
  state.usage.web_search_calls += usage.web_search_calls ?? 0
  state.usage.small_input_tokens = (state.usage.small_input_tokens ?? 0) + (usage.small_input_tokens ?? 0)
  state.usage.small_output_tokens = (state.usage.small_output_tokens ?? 0) + (usage.small_output_tokens ?? 0)
  state.usage.extra_cost_usd = (state.usage.extra_cost_usd ?? 0) + (usage.extra_cost_usd ?? 0)
}

/** Usage of a small-model call, kept in its own buckets. */
const smallUsage = (usage: { input_tokens?: number; output_tokens?: number }) => ({
  small_input_tokens: usage.input_tokens ?? 0,
  small_output_tokens: usage.output_tokens ?? 0,
})

/** Errors inside a step: model transport problems and 429/5xx retry the step; everything else fails the run. */
function classifyStepError(error: unknown): ResearchError {
  if (error instanceof ResearchError) return error
  if (error instanceof APIConnectionError) return new ResearchError('provider_transient', `Provider connection: ${error.message}`)
  if (error instanceof APIError) return classifyCreateError(error)
  return new ResearchError('provider_failed', (error as Error)?.message ?? 'Unknown pipeline error')
}

export function createPipelineProvider(store: PipelineStore): ResearchProvider {
  return {
    name: 'pipeline',
    model: RESEARCH_MODEL,
    outputMode: 'structured',
    deadlineMs: PIPELINE_DEADLINE_MINUTES * 60_000,

    async start(input, context = {}) {
      if (!process.env.OPENAI_API_KEY) throw new ResearchError('configuration', 'OPENAI_API_KEY is required for the research pipeline')
      const state = newState(input, context)
      const id = await store.create(state)
      return { responseId: id }
    },

    async inspect(id): Promise<Inspection> {
      const state = await store.load(id)
      if (!state) return { state: 'failed', code: 'provider_failed', message: 'Pipeline state not found' }
      if (state.step === 'done') return completed(state)
      if (state.step === 'failed') return { state: 'failed', code: state.error?.code ?? 'provider_failed', message: state.error?.message ?? 'Pipeline failed', usage: state.usage, raw: summary(state) }

      const step = state.step
      // The state as loaded is known to be storable; the state after a step holds new web text and may not be.
      const before = structuredClone(state)
      try {
        let timer: ReturnType<typeof setTimeout> | undefined
        const advanced = await Promise.race([
          STEPS[step](state),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ResearchError('timed_out', `Step ${step} exceeded ${STEP_BUDGET_MS / 1000}s`)), STEP_BUDGET_MS)
          }),
        ]).finally(() => clearTimeout(timer))
        // A step that did not advance (background qualification still running) keeps the run pending.
        if (advanced) log('pipeline.step', { step, next: state.step, sources: state.sources.length, hits: state.hits.length })
        if (state.step !== step) state.stepStartedAt = new Date().toISOString()
      } catch (error) {
        const failure = classifyStepError(error)
        const attempts = (state.attempts[step] ?? 0) + 1
        state.attempts[step] = attempts
        if (isRetryable(failure.code) && attempts < MAX_STEP_ATTEMPTS) {
          log('pipeline.step_retry', { step, attempt: attempts, code: failure.code })
          await store.save(id, state)
          return { state: 'pending' }
        }
        state.step = 'failed'
        state.error = { code: failure.code, message: failure.message.slice(0, 1000) }
        log('pipeline.failed', { step, code: failure.code })
      }
      try {
        await store.save(id, state)
      } catch (error) {
        // A result that cannot be stored used to be lost silently, and the step (searches and model calls included)
        // ran again on every tick. Count it as a failed attempt on the last storable state instead.
        const message = (error as Error).message.slice(0, 300)
        const attempts = (before.attempts[step] ?? 0) + 1
        before.attempts[step] = attempts
        before.usage = state.usage
        log('pipeline.save_failed', { step, attempt: attempts, error: message })
        if (attempts >= MAX_STEP_ATTEMPTS) {
          before.step = 'failed'
          before.error = { code: 'provider_failed', message: `Step ${step} result could not be stored: ${message}` }
        }
        await store.save(id, before)
        if (before.step === 'failed') return { state: 'failed', code: 'provider_failed', message: before.error!.message, usage: before.usage, raw: summary(before) }
        return { state: 'pending' }
      }
      const next = stepOf(state)
      if (next === 'done') return completed(state)
      if (next === 'failed') return { state: 'failed', code: state.error!.code, message: state.error!.message, usage: state.usage, raw: summary(state) }
      // Saved, so what is handed over can't be lost to a retry: the profile once the website is read, then each
      // finished qualification batch. The final result still carries everything; this only makes it visible sooner.
      const partial = partialOf(state, step)
      if (partial) {
        for (const batch of state.qualifyBatches ?? []) if (batch.status === 'done') batch.handedOver = true
        await store.save(id, state).catch(() => undefined)
        return { state: 'pending', partial }
      }
      return { state: 'pending' }
    },

    progress: (id) => store.progress(id),

    format: repairFormat,

    async cancel(id) {
      const state = await store.load(id)
      if (!state || state.step === 'done' || state.step === 'failed') return
      const pendingIds = [state.qualifyResponseId, ...(state.qualifyBatches ?? []).filter((batch) => batch.status === 'pending').map((batch) => batch.responseId)]
      for (const responseId of pendingIds) if (responseId) await openai().responses.cancel(responseId).catch(() => undefined)
      state.step = 'failed'
      state.error = { code: 'timed_out', message: 'Cancelled at the deadline' }
      await store.save(id, state)
    },
  }
}

function newState(input: ResearchInput, context: RunContext): PipelineState {
  return {
    version: 1,
    step: 'brief',
    attempts: {},
    startedAt: new Date().toISOString(),
    stepStartedAt: new Date().toISOString(),
    input,
    connectors: context.connectors ?? null,
    subreddits: context.subreddits ?? [],
    excludeKeys: context.excludeKeys ?? [],
    priorityTopics: context.priorityTopics ?? [],
    deadTopics: context.deadTopics ?? [],
    profile: null,
    websitePages: [],
    plannedQueries: [],
    topics: [],
    hits: [],
    searches: [],
    unavailable: [],
    triage: [],
    sources: [],
    accessFailures: [],
    usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, web_search_calls: 0, small_input_tokens: 0, small_output_tokens: 0, extra_cost_usd: 0 },
    qualifyResponseId: null,
    resultText: null,
    auditUrls: [],
    actions: [],
    error: null,
  }
}

/** Triage score from which a search hit "looks like a buyer" in a probe (hits are read in full from 1). */
const PROBE_MIN_SCORE = 2

/**
 * A look without a run: search and triage only, for a radar that already has its brief. Nothing is read in full,
 * qualified or stored, so it costs a few cents. It answers "is anything new out there?" for a sleeping radar, and
 * its count is of posts that look like buyers from their previews, never of verified leads.
 */
export async function probeMatches(input: ResearchInput, context: RunContext = {}) {
  if (!input.profile?.acquisition_brief) throw new ResearchError('configuration', 'A probe needs a saved profile with its brief')
  const state = newState(input, context)
  await stepBrief(state)
  if (stepOf(state) === 'search') await stepSearch(state)
  if (stepOf(state) === 'triage') await stepTriage(state)
  const titleByUrl = new Map(state.hits.map((hit) => [hit.url, hit.title]))
  const likely = state.triage.filter((hit) => hit.score >= PROBE_MIN_SCORE).sort((a, b) => b.score - a.score)
  return {
    count: likely.length,
    titles: likely.map((hit) => (titleByUrl.get(hit.url) ?? '').trim()).filter((title) => title.length > 8).slice(0, 5),
    usage: state.usage,
  }
}

/* --------------------------------- Steps ---------------------------------- */

type Step = (state: PipelineState) => Promise<boolean>

const STEPS: Record<PipelineStep, Step> = {
  brief: stepBrief,
  search: stepSearch,
  triage: stepTriage,
  read: stepRead,
  qualify: stepQualify,
  qualify_poll: stepQualifyPoll,
  done: async () => false,
  failed: async () => false,
}

const briefFormat = () => zodTextFormat(BriefResult, 'business_brief_v3')
const triageFormat = () => zodTextFormat(TriageResult, 'search_triage_v3')
const resultFormat = () => zodTextFormat(ResearchResult, SCHEMA_NAME)

async function stepBrief(state: PipelineState) {
  const { input } = state
  let profile = input.profile
  let planned: string[] = []

  if (!profile || !profile.acquisition_brief) {
    const pages = await readWebsite(input.website_url, WEBSITE_PAGES, WEBSITE_PAGE_CHARS)
    const readable = pages.filter((page) => page.ok)
    state.websitePages = pages.flatMap((page) => [page.url, page.finalUrl])
    state.auditUrls.push(...state.websitePages)
    state.actions.push(...pages.map((page) => ({ type: 'open_page', query: null, url: page.url, status: page.ok ? 'completed' : 'failed' })))
    if (!pages[0]?.ok || !readable.length) {
      finish(state, emptyResult('website_unreadable', null, [`The website could not be read: ${pages[0]?.error ?? 'no readable text'}`]))
      return true
    }
    const response = await openai().responses.create(
      {
        model: RESEARCH_MODEL,
        reasoning: { effort: RESEARCH_REASONING_EFFORT },
        tools: [],
        max_output_tokens: 16000,
        instructions: BRIEF_PROMPT,
        input: JSON.stringify({
          website_url: input.website_url,
          now_utc: input.now_utc,
          pages: readable.map((page) => ({ url: page.finalUrl, title: page.title, text: page.text })),
        }),
        text: { format: briefFormat() },
      },
      { timeout: 170_000 },
    )
    addUsage(state, usageOf(response))
    const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
    if (audit.refusal) throw new ResearchError('refusal', audit.refusal)
    if (response.status !== 'completed' || !audit.text.trim()) throw new ResearchError('incomplete', `Brief request ${response.status}`)
    const parsed = BriefResult.safeParse(JSON.parse(audit.text))
    if (!parsed.success) throw new ResearchError('invalid_output', `Brief does not match the schema: ${parsed.error.message.slice(0, 300)}`)
    const brief = parsed.data
    if (brief.research_status !== 'complete' || !brief.profile) {
      finish(state, emptyResult(brief.research_status === 'unsupported_business' ? 'unsupported_business' : 'website_unreadable', brief.profile, []))
      return true
    }
    // Profiles saved before research-v2 keep their website facts and gain the brief.
    profile = profile ? { ...profile, acquisition_brief: brief.profile.acquisition_brief } : brief.profile
    planned = brief.search_plan.proposed_queries
  }

  state.profile = profile
  state.plannedQueries = planned
  state.topics = deriveTopics({
    brief: profile.acquisition_brief,
    mode: input.mode,
    seed: Math.floor(Date.parse(input.now_utc) / DAY_MS),
    plannedQueries: planned,
    untriedAngles: input.untried_angles,
    priorityTopics: state.priorityTopics,
    deadTopics: state.deadTopics,
  })
  state.step = 'search'
  return true
}

async function stepSearch(state: PipelineState) {
  const excludeKeys = new Set<string>(state.excludeKeys)
  for (const item of state.input.excluded_opportunities) {
    const key = sourceKey(item.source_url)
    if (key) excludeKeys.add(key)
  }
  const result = await discover(state.topics, {
    windowStart: state.input.published_on_or_after,
    excludeKeys,
    connectors: state.connectors ?? undefined,
    subreddits: state.subreddits,
  })
  state.hits = result.hits
  state.searches = result.searches
  state.unavailable = result.unavailable
  // Only hosted OpenAI searches are priced per call; Exa reports its own cost and Hacker News is free.
  addUsage(state, {
    ...smallUsage(result.usage),
    web_search_calls: result.searches.filter((search) => search.connector === 'openai').length,
    extra_cost_usd: result.costUsd,
  })
  state.actions.push(
    ...result.searches.map((search) => ({ type: 'search', query: `${search.connector}: ${search.query}`, url: null, status: search.error ? 'failed' : 'completed' })),
  )
  if (!state.hits.length) {
    finish(state, emptyResult('complete', state.profile, [
      'No search results inside the date window for the brief’s buyer situations.',
      ...state.unavailable.map((connector) => `Search connector unavailable this run: ${connector}.`),
    ]))
    return true
  }
  state.step = 'triage'
  return true
}

async function stepTriage(state: PipelineState) {
  const brief = state.profile!.acquisition_brief
  const hits = state.hits.map((hit, index) => ({ id: `H${index + 1}`, hit }))
  const batches: Array<typeof hits> = []
  for (let i = 0; i < hits.length; i += TRIAGE_BATCH) batches.push(hits.slice(i, i + TRIAGE_BATCH))

  const scores = new Map<string, { score: number; reason: string }>()
  const scoreBatch = async (batch: typeof hits) => {
    const response = await openai().responses.create(
      {
        model: SEARCH_MODEL,
        reasoning: { effort: 'low' },
        tools: [],
        max_output_tokens: 8000,
        instructions: TRIAGE_PROMPT,
        input: JSON.stringify({
          brief: {
            sells: brief.sells,
            buyers: brief.buyers,
            recognise_buyer_in_posts: brief.recognise_buyer_in_posts,
            buyer_problems_in_their_words: brief.buyer_problems_in_their_words,
            trigger_situations: brief.trigger_situations,
            not_our_buyer: brief.not_our_buyer,
            buyer_seller_confusions: brief.buyer_seller_confusions,
          },
          focus_guidance: state.input.run_instructions.includes('USER FOCUS CORRECTION')
            ? state.input.run_instructions.slice(state.input.run_instructions.indexOf('USER FOCUS CORRECTION'))
            : null,
          feedback: state.input.feedback,
          hits: batch.map(({ id, hit }) => ({
            id,
            url: hit.url,
            title: hit.title,
            date: hit.publishedDate,
            preview: (hit.text ?? hit.snippet).slice(0, 800),
          })),
        }),
        text: { format: triageFormat() },
      },
      { timeout: 90_000 },
    )
    addUsage(state, smallUsage(usageOf(response)))
    const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
    if (response.status !== 'completed' || !audit.text.trim()) throw new ResearchError('incomplete', `Triage request ${response.status}`)
    const parsed = TriageResult.safeParse(JSON.parse(audit.text))
    if (!parsed.success) throw new ResearchError('invalid_output', `Triage does not match the schema: ${parsed.error.message.slice(0, 200)}`)
    for (const item of parsed.data.scores) scores.set(item.id, { score: Math.max(0, Math.min(3, Math.round(item.score))), reason: item.reason })
  }
  // A rate-limited or timed-out batch is retried on its own after a pause. The step only fails when no batch could
  // be scored: repeating the batches that succeeded would spend again and hit the same limit.
  const failures: ResearchError[] = []
  await Promise.all(
    batches.map(async (batch, index) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await scoreBatch(batch)
        } catch (error) {
          const failure = classifyStepError(error)
          const transient = failure.code === 'provider_transient' || failure.code === 'uncertain_creation' || failure.code === 'incomplete'
          if (!transient || attempt >= TRIAGE_BATCH_RETRIES) {
            log('pipeline.triage_batch_failed', { batch: index, attempts: attempt + 1, code: failure.code, message: failure.message.slice(0, 200) })
            failures.push(failure)
            return
          }
          await new Promise((resolve) => setTimeout(resolve, TRIAGE_RETRY_PAUSE_MS * (attempt + 1)))
        }
      }
    }),
  )
  if (failures.length === batches.length) throw failures[0]

  state.triage = hits.map(({ id, hit }) => ({ id, url: hit.url, score: scores.get(id)?.score ?? 0, reason: scores.get(id)?.reason ?? 'not scored' }))
  const selected = hits
    .map(({ id, hit }) => ({ id, hit, ...(scores.get(id) ?? { score: 0, reason: 'not scored' }) }))
    .filter((item) => item.score >= MIN_TRIAGE_SCORE)
    .sort((a, b) => b.score - a.score || (b.hit.publishedDate ?? '').localeCompare(a.hit.publishedDate ?? ''))
    .slice(0, MAX_SOURCES_TO_READ[state.input.mode])

  state.sources = selected.map((item, index) => ({
    id: `S${index + 1}`,
    url: item.hit.url,
    title: item.hit.title,
    connector: item.hit.connector,
    topic: item.hit.topic,
    community: item.hit.community,
    publishedDate: item.hit.publishedDate,
    text: item.hit.text ?? '',
    fetched: false,
    triage: item.score,
    reason: item.reason,
  }))
  // Unselected hits no longer need their text; keep them small for diagnostics.
  state.hits = state.hits.map((hit) => ({ ...hit, text: null }))
  state.step = state.sources.length ? 'read' : 'qualify'
  return true
}

async function stepRead(state: PipelineState) {
  const queue = state.sources.filter((source) => !source.text || source.connector === 'openai')
  const unreadable: PipelineSource[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(5, queue.length) }, async () => {
      while (next < queue.length) {
        const source = queue[next++]
        const page = await fetchPage(source.url, SOURCE_PAGE_CHARS)
        if (page.ok) {
          source.text = page.text
          source.title = source.title || page.title
          source.publishedDate = source.publishedDate ?? page.dateHints[0] ?? null
          source.fetched = true
          if (page.finalUrl !== source.url) state.auditUrls.push(page.finalUrl)
        } else if (!source.text) {
          unreadable.push(source)
          state.accessFailures.push(`${source.url} (${page.error})`)
        }
      }
    }),
  )
  // Sites that block servers (LinkedIn, Facebook...): Exa's cached or live-crawled text.
  const stillUnreadable = (source: PipelineSource) => !source.text
  if (unreadable.some(stillUnreadable) && exaConfigured()) {
    const batch = unreadable.filter(stillUnreadable).filter((source) => !/reddit\.com/i.test(source.url))
    const contents = await exaContents(batch.map((source) => source.url))
    addUsage(state, { extra_cost_usd: contents.costUsd })
    for (const source of batch) {
      const content = contents.results.find((result) => result.url === source.url)
      if (!content || !content.text) continue
      source.text = content.text
      source.title = source.title || content.title
      source.publishedDate = source.publishedDate ?? content.publishedDate
      source.fetched = true
    }
  }
  // Reddit (and anything Exa could not crawl): OpenAI's hosted browsing reads the page, a few at a time.
  const forBrowser = unreadable.filter(stillUnreadable).slice(0, MAX_BROWSER_READS)
  if (forBrowser.length && process.env.OPENAI_API_KEY) {
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(4, forBrowser.length) }, async () => {
        while (cursor < forBrowser.length) {
          const source = forBrowser[cursor++]
          const read = await readWithOpenAI(source.url, SOURCE_PAGE_CHARS)
          addUsage(state, { ...smallUsage(read.usage), web_search_calls: 1 })
          if (!read.text) continue
          source.text = read.text
          source.fetched = true
        }
      }),
    )
  }
  state.accessFailures = state.accessFailures.filter((failure) => !unreadable.some((source) => source.text && failure.startsWith(source.url)))
  const readable = state.sources.filter((source) => source.text.length >= 100)
  state.auditUrls.push(...readable.map((source) => source.url))
  state.actions.push(...readable.map((source) => ({ type: 'open_page', query: null, url: source.url, status: 'completed' })))
  state.sources = readable.map((source, index) => ({ ...source, id: `S${index + 1}` }))
  state.step = 'qualify'
  return true
}

async function stepQualify(state: PipelineState) {
  if (!state.sources.length) {
    finish(state, emptyResult('complete', state.profile, ['Search results were found but none could be read or looked like a buyer post.']))
    return true
  }
  const { input } = state
  // Best triage score first, so the first batch to come back is the one most likely to hold leads.
  const ordered = [...state.sources].sort((a, b) => b.triage - a.triage)
  const groups: PipelineSource[][] = []
  for (let i = 0; i < ordered.length; i += QUALIFY_BATCH_SIZE) groups.push(ordered.slice(i, i + QUALIFY_BATCH_SIZE))

  const created = await Promise.allSettled(
    groups.map((sources) =>
      openai().responses.create({
        model: RESEARCH_MODEL,
        reasoning: { effort: RESEARCH_REASONING_EFFORT },
        background: true,
        store: true,
        tools: [],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: QUALIFY_PROMPT,
        input: JSON.stringify({
          mode: input.mode,
          now_utc: input.now_utc,
          published_on_or_after: input.published_on_or_after,
          last_successful_run_at: input.last_successful_run_at,
          target_count: input.target_count,
          max_candidates: input.max_candidates,
          output_language: input.output_language,
          profile: state.profile,
          excluded_opportunities: input.excluded_opportunities,
          previous_candidates: input.previous_candidates,
          previous_queries: input.previous_queries,
          untried_angles: input.untried_angles,
          feedback: input.feedback,
          run_instructions: input.run_instructions,
          sources: sources.map((source) => ({
            id: source.id,
            url: source.url,
            title: source.title,
            connector: source.connector,
            community: source.community,
            date_hint: source.publishedDate,
            text: source.text,
          })),
        }),
        text: { format: resultFormat() },
      }),
    ),
  )
  const batches: QualifyBatch[] = []
  created.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      batches.push({ responseId: outcome.value.id, sourceIds: groups[index].map((source) => source.id), status: 'pending', result: null, error: null, handedOver: false })
    }
  })
  if (!batches.length) {
    // Nothing was accepted: cancel nothing, retry the step as a whole.
    throw classifyCreateError((created[0] as PromiseRejectedResult).reason)
  }
  const refused = created.length - batches.length
  if (refused) {
    log('pipeline.qualify_batches_refused', { refused, accepted: batches.length })
    state.accessFailures.push(`${refused} of ${created.length} qualification requests could not be started; their sources were not judged.`)
  }
  state.qualifyBatches = batches
  state.step = 'qualify_poll'
  return true
}

async function stepQualifyPoll(state: PipelineState) {
  // A run started before batching has one request: poll it as a single batch.
  state.qualifyBatches ??= [
    { responseId: state.qualifyResponseId!, sourceIds: state.sources.map((source) => source.id), status: 'pending', result: null, error: null, handedOver: false },
  ]
  const batches = state.qualifyBatches
  let progressed = false
  const fatal: ResearchError[] = []

  await Promise.all(
    batches
      .filter((batch) => batch.status === 'pending')
      .map(async (batch) => {
        const response = await openai().responses.retrieve(batch.responseId)
        if (response.status === 'queued' || response.status === 'in_progress') return
        progressed = true
        addUsage(state, usageOf(response))
        const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
        const fail = (error: ResearchError) => {
          batch.status = 'failed'
          batch.error = error.message.slice(0, 300)
          fatal.push(error)
        }
        if (response.status !== 'completed') {
          if (response.status === 'incomplete') return fail(new ResearchError('incomplete', `Incomplete: ${response.incomplete_details?.reason ?? 'unknown'}`))
          if (response.status === 'cancelled') return fail(new ResearchError('timed_out', 'Cancelled'))
          const code = response.error?.code ?? ''
          return fail(new ResearchError(code === 'server_error' || code === 'rate_limit_exceeded' ? 'provider_transient' : 'provider_failed', response.error?.message ?? `Provider status ${response.status}`))
        }
        if (audit.refusal) return fail(new ResearchError('refusal', audit.refusal))
        if (!audit.text.trim()) return fail(new ResearchError('incomplete', 'Qualification completed without output text'))
        let parsed = ResearchResult.safeParse(safeJson(audit.text))
        if (!parsed.success) {
          log('pipeline.format_repair', { problem: parsed.error.message.slice(0, 200) })
          const repaired = await repairFormat(audit.text)
          addUsage(state, repaired.usage)
          parsed = ResearchResult.safeParse(safeJson(repaired.text))
          if (!parsed.success) return fail(new ResearchError('invalid_output', `Unparseable after formatting: ${parsed.error.message.slice(0, 300)}`))
        }
        batch.status = 'done'
        batch.result = {
          ...parsed.data,
          // The source texts are only available here: confirm the handles the model named without identity evidence.
          candidates: confirmHandlesFromSources(parsed.data.candidates, state.sources),
        }
      }),
  )

  if (batches.some((batch) => batch.status === 'pending')) return progressed
  const done = batches.filter((batch) => batch.status === 'done')
  // Every batch failed: the run fails (or retries) exactly as a single request did. Some failed: the leads the
  // others found are kept, and the run says what it could not judge.
  if (!done.length) throw fatal[0] ?? new ResearchError('provider_failed', 'Qualification produced no result')
  finish(state, mergeBatches(state, batches))
  return true
}

/** One result from the batches, in batch order (best sources first), as if a single request had judged them all. */
function mergeBatches(state: PipelineState, batches: QualifyBatch[]): ResearchResultT {
  const results = batches.flatMap((batch) => (batch.result ? [batch.result] : []))
  const failed = batches.filter((batch) => batch.status === 'failed')
  const unique = (values: string[]) => [...new Set(values)]
  const worthwhile = results.filter((result) => result.follow_up.worthwhile)
  return {
    schema_version: '3',
    research_status: results.every((result) => result.research_status === 'complete') && !failed.length ? 'complete' : 'incomplete',
    profile: state.profile,
    search_plan: {
      angles: unique(results.flatMap((result) => result.search_plan.angles)),
      proposed_queries: unique(results.flatMap((result) => result.search_plan.proposed_queries)),
    },
    candidates: results.flatMap((result) => result.candidates),
    follow_up: {
      worthwhile: worthwhile.length > 0,
      reason: (worthwhile[0] ?? results[0]).follow_up.reason,
      untried_angles: unique(results.flatMap((result) => result.follow_up.untried_angles)),
      candidates_to_verify: unique(results.flatMap((result) => result.follow_up.candidates_to_verify)),
    },
    coverage: {
      access_failures: unique([...results.flatMap((result) => result.coverage.access_failures), ...state.accessFailures]),
      limitations: unique([
        ...results.flatMap((result) => result.coverage.limitations),
        ...state.unavailable.map((connector) => `Search connector unavailable this run: ${connector}.`),
        ...(failed.length ? [`${failed.length} of ${batches.length} qualification batches failed; their sources were not judged.`] : []),
      ]),
      rejection_summary: unique(results.flatMap((result) => result.coverage.rejection_summary)),
    },
  }
}

/**
 * What can be shown before the run ends: the profile right after the website was read (first runs only), then the
 * candidates of each qualification batch as it finishes. Nothing once the run is over: the final result has it all.
 */
function partialOf(state: PipelineState, ranStep: PipelineStep): PartialResult | null {
  const sources = state.sources.map((source) => ({ url: source.url, topic: source.topic }))
  if (ranStep === 'brief' && state.step === 'search' && state.input.mode === 'initial' && state.profile) {
    return { profile: state.profile, candidates: [], auditUrls: [...new Set(state.auditUrls)], sources }
  }
  const fresh = (state.qualifyBatches ?? []).filter((batch) => batch.status === 'done' && !batch.handedOver)
  if (ranStep !== 'qualify_poll' || !fresh.length) return null
  return {
    profile: state.profile,
    candidates: fresh.flatMap((batch) => batch.result?.candidates ?? []),
    auditUrls: [...new Set(state.auditUrls)],
    sources,
  }
}

/* -------------------------------- Helpers --------------------------------- */

function finish(state: PipelineState, result: ResearchResultT) {
  state.resultText = JSON.stringify(result)
  state.auditUrls = [...new Set(state.auditUrls)]
  state.step = 'done'
}

function emptyResult(status: ResearchResultT['research_status'], profile: BusinessProfileT | null, limitations: string[]): ResearchResultT {
  return {
    schema_version: '3',
    research_status: status,
    profile,
    search_plan: { angles: [], proposed_queries: [] },
    candidates: [],
    follow_up: { worthwhile: false, reason: 'No sources to qualify.', untried_angles: [], candidates_to_verify: [] },
    coverage: { limitations, access_failures: [], rejection_summary: [] },
  }
}

function completed(state: PipelineState): Inspection {
  return {
    state: 'completed',
    text: state.resultText!,
    auditUrls: state.auditUrls,
    actions: state.actions,
    usage: state.usage,
    raw: summary(state),
  }
}

export type PipelineSummary = ReturnType<typeof summary>['pipeline']

/** Diagnostics stored on the run: never the source texts. */
function summary(state: PipelineState) {
  return {
    pipeline: {
      step: state.step,
      attempts: state.attempts,
      topics: state.topics,
      searches: state.searches,
      unavailable: state.unavailable,
      hits: state.hits.length,
      triage: state.triage,
      sources: state.sources.map(({ text, ...rest }) => ({ ...rest, chars: text.length })),
      access_failures: state.accessFailures,
      qualify_batches: (state.qualifyBatches ?? []).map((batch) => ({ sources: batch.sourceIds.length, status: batch.status, error: batch.error })),
      error: state.error,
    },
  }
}

/** Read after a step ran; keeps TypeScript from narrowing the step away. */
const stepOf = (state: PipelineState): PipelineStep => state.step

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
