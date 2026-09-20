import OpenAI, { APIConnectionError, APIError } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  FORMAT_MODEL,
  MAX_OUTPUT_TOKENS,
  MAX_TOOL_CALLS,
  RESEARCH_MODEL,
  RESEARCH_REASONING_EFFORT,
  ResearchResult,
  SCHEMA_NAME,
  type BusinessProfileT,
  type CandidateT,
} from './contract'
import { mockProvider } from './mock'
import { createPipelineProvider, dbPipelineStore } from './pipeline'
import { SYSTEM_PROMPT, type ResearchInput } from './prompt'

export type ErrorCode =
  | 'provider_transient' // 429 / 5xx / server_error: one retry
  | 'uncertain_creation' // create timed out; provider may have accepted it: never blindly recreate
  | 'configuration' // model access, invalid parameter or schema: fix in development
  | 'no_search_activity' // invalid research run: eligible for the single retry
  | 'refusal' // terminal
  | 'incomplete' // truncated / missing text: never parse, one retry
  | 'timed_out' // wall deadline reached and cancelled: one retry
  | 'provider_failed' // other terminal provider failure
  | 'invalid_output' // unparseable even after the one formatting repair
  | 'profile_unverified' // research ran but the offer could not be verified on the website; user may retry

const RETRYABLE: ErrorCode[] = ['provider_transient', 'no_search_activity', 'incomplete', 'timed_out']
export const isRetryable = (code: ErrorCode) => RETRYABLE.includes(code)

export class ResearchError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  web_search_calls: number
  /** Tokens spent by the small model (searches, triage, reads, enrichment), priced separately. */
  small_input_tokens?: number
  small_output_tokens?: number
  /** Non-token costs already priced by the provider (Exa searches), added to the run cost. */
  extra_cost_usd?: number
}

/** Tool activity as exposed by the Responses API: what was actually searched and opened. */
export type ToolAction = { type: string; query: string | null; url: string | null; status: string | null }

/** Results a run can hand over before it ends, so the page has something to show during the wait. */
export type PartialResult = {
  /** The business profile, as soon as the website has been read. */
  profile: BusinessProfileT | null
  /** Candidates judged so far (one qualification batch). Gates run on them exactly as they do at the end. */
  candidates: CandidateT[]
  auditUrls: string[]
  /** Which search topic surfaced each source, for leads.topic. */
  sources: Array<{ url: string; topic: string }>
}

/** Where a running attempt is, from what it has actually done. Counts are null until the step that produces them ends. */
export type RunProgress = {
  step: 'brief' | 'search' | 'triage' | 'read' | 'qualify'
  stepStartedAt: string | null
  websitePages: number | null
  hits: number | null
  /** Hits worth reading after triage, then the ones that could be read. */
  sources: number | null
  batches: { done: number; total: number } | null
}

export type Inspection =
  | { state: 'pending'; partial?: PartialResult }
  | { state: 'completed'; text: string; auditUrls: string[]; actions: ToolAction[]; usage: Usage; raw: unknown }
  | { state: 'failed'; code: ErrorCode; message: string; usage?: Usage; raw?: unknown }

/** Application memory handed to a run alongside the model input. Never sent to the model as-is. */
export type RunContext = {
  /** Source keys already known for this radar (leads, candidates, seen sources): never re-read. */
  excludeKeys?: string[]
  /** Topics that produced leads before, searched first. */
  priorityTopics?: string[]
  /** Topics tried repeatedly without a single candidate. */
  deadTopics?: string[]
  /** Watch runs: connectors to use and subreddits to poll directly. */
  connectors?: Array<'exa' | 'reddit' | 'hn' | 'openai'>
  subreddits?: string[]
}

export interface ResearchProvider {
  name: 'openai' | 'mock' | 'pipeline'
  model: string
  /** structured: schema on the research request. two_step: research first, then a tool-free formatting request. */
  outputMode: 'structured' | 'two_step'
  /** Wall deadline per attempt when the provider needs more than the default (multi-step pipeline). */
  deadlineMs?: number
  start(input: ResearchInput, context?: RunContext): Promise<{ responseId: string }>
  inspect(responseId: string): Promise<Inspection>
  /** Tool-free, schema-constrained formatting. Never adds facts; gates rerun on its output. */
  format(text: string): Promise<{ text: string; usage: Usage }>
  cancel(responseId: string): Promise<void>
  /** Read-only and cheap: called while the visitor waits. Providers that can't tell return null. */
  progress?(responseId: string): Promise<RunProgress | null>
}

/**
 * RESEARCH_PROVIDER forces one. Otherwise: the discovery pipeline when Exa is configured, the hosted-search
 * provider when only OpenAI is, sample data in development without keys. Production never falls back to mock.
 */
export function getProvider(): ResearchProvider {
  const forced = process.env.RESEARCH_PROVIDER
  if (forced === 'mock') return mockProvider
  if (forced === 'pipeline') return pipelineProvider()
  if (forced === 'openai') return openAIProvider()
  if (process.env.EXA_API_KEY && process.env.OPENAI_API_KEY) return pipelineProvider()
  if (process.env.OPENAI_API_KEY) return openAIProvider()
  if (process.env.NODE_ENV !== 'production') return mockProvider
  return pipelineProvider()
}

let pipeline: ResearchProvider | null = null
function pipelineProvider() {
  return (pipeline ??= createPipelineProvider(dbPipelineStore))
}

/* -------------------------------------------------------------------------- */

const FORMAT_INSTRUCTION =
  'Convert the supplied research output into the required schema using only facts already present. Do not add or infer facts, dates, URLs or identities. Use null/empty values where permitted; discard leads missing required fields. This is formatting only.'

let client: OpenAI | null = null
export function openai() {
  // Application controls retries and the expiry check.
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 })
  return client
}

const textFormat = () => zodTextFormat(ResearchResult, SCHEMA_NAME)

export function classifyCreateError(error: unknown): ResearchError {
  if (error instanceof APIConnectionError) {
    // Includes timeouts: the request may have been accepted and billed. Do not recreate automatically.
    return new ResearchError('uncertain_creation', `Provider acceptance unknown: ${error.message}`)
  }
  if (error instanceof APIError) {
    const code = (error.code ?? '') as string
    if (error.status === 429 && code !== 'insufficient_quota') return new ResearchError('provider_transient', error.message)
    if (error.status && error.status >= 500) return new ResearchError('provider_transient', error.message)
    return new ResearchError('configuration', `${error.status ?? ''} ${code} ${error.message}`.trim())
  }
  return new ResearchError('provider_failed', (error as Error)?.message ?? 'Unknown provider error')
}

export type OutputItem = {
  type: string
  status?: string
  action?: { type?: string; url?: string; query?: string; queries?: string[]; sources?: Array<{ url?: string }> }
  content?: Array<{ type: string; text?: string; refusal?: string; annotations?: Array<{ type: string; url?: string }> }>
}

/** Collect consulted URLs: search sources, opened pages and final citations (spec §1.6.2). */
export function auditFromOutput(output: OutputItem[]) {
  const urls = new Set<string>()
  const actions: ToolAction[] = []
  let searchCalls = 0
  let refusal: string | null = null
  let text = ''
  for (const item of output) {
    if (item.type === 'web_search_call') {
      if (item.status === 'completed') searchCalls++
      actions.push({
        type: item.action?.type ?? 'unknown',
        query: item.action?.query ?? item.action?.queries?.join(' | ') ?? null,
        url: item.action?.url ?? null,
        status: item.status ?? null,
      })
      if (item.action?.url) urls.add(item.action.url)
      for (const source of item.action?.sources ?? []) if (source.url) urls.add(source.url)
    }
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'refusal') refusal = part.refusal ?? 'Refused'
        if (part.type === 'output_text') {
          text += part.text ?? ''
          for (const annotation of part.annotations ?? []) if (annotation.type === 'url_citation' && annotation.url) urls.add(annotation.url)
        }
      }
    }
  }
  return { urls: [...urls], actions, searchCalls, refusal, text }
}

/** Tool-free, schema-constrained formatting of research text. Never adds facts; the gates rerun on its output. */
export async function repairFormat(text: string): Promise<{ text: string; usage: Usage }> {
  try {
    const response = await openai().responses.create(
      {
        model: FORMAT_MODEL,
        reasoning: { effort: 'low' },
        tools: [],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: FORMAT_INSTRUCTION,
        input: JSON.stringify({ untrusted_research_output: text }),
        text: { format: textFormat() },
      },
      { timeout: 180_000 },
    )
    const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
    if (audit.refusal) throw new ResearchError('refusal', audit.refusal)
    if (response.status !== 'completed' || !audit.text.trim()) {
      throw new ResearchError('invalid_output', `Formatting request ${response.status}`)
    }
    return { text: audit.text, usage: usageOf(response) }
  } catch (error) {
    if (error instanceof ResearchError) throw error
    throw new ResearchError('invalid_output', `Formatting request failed: ${(error as Error).message}`)
  }
}

/** Token usage of a Responses API response (search calls are counted from the output separately). */
export function usageOf(response: { usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } } | null }): Usage {
  return {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
    reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    web_search_calls: 0,
  }
}

function openAIProvider(): ResearchProvider {
  const outputMode = process.env.RESEARCH_OUTPUT_MODE === 'two_step' ? 'two_step' : 'structured'

  return {
    name: 'openai',
    model: RESEARCH_MODEL,
    outputMode,

    async start(input) {
      try {
        // Exact call shape (spec §1.1). Call only after obtaining the run lease and checking expiry.
        const response = await openai().responses.create({
          model: RESEARCH_MODEL,
          reasoning: { effort: RESEARCH_REASONING_EFFORT },
          background: true,
          store: true,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          // Supported by the Responses API but missing from this SDK version's create params type.
          ...({ max_tool_calls: MAX_TOOL_CALLS[input.mode] } as object),
          tools: [{ type: 'web_search', external_web_access: true }],
          tool_choice: 'auto',
          include: ['web_search_call.action.sources'],
          instructions: SYSTEM_PROMPT,
          input: JSON.stringify(input),
          ...(outputMode === 'structured' ? { text: { format: textFormat() } } : {}),
        })
        return { responseId: response.id }
      } catch (error) {
        throw classifyCreateError(error)
      }
    },

    async inspect(responseId) {
      // Retrieval errors propagate to the scheduler, which polls again later. Retrieval never launches research.
      const response = await openai().responses.retrieve(responseId, { include: ['web_search_call.action.sources'] })
      if (response.status === 'queued' || response.status === 'in_progress') return { state: 'pending' }

      const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
      const usage: Usage = {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        web_search_calls: audit.searchCalls,
      }
      const raw = response

      if (response.status === 'completed') {
        if (audit.refusal) return { state: 'failed', code: 'refusal', message: audit.refusal, usage, raw }
        if (!audit.text.trim()) return { state: 'failed', code: 'incomplete', message: 'Completed without output text', usage, raw }
        if (audit.searchCalls === 0) {
          return { state: 'failed', code: 'no_search_activity', message: 'No successful web search activity', usage, raw }
        }
        return { state: 'completed', text: audit.text, auditUrls: audit.urls, actions: audit.actions, usage, raw }
      }
      if (response.status === 'incomplete') {
        return {
          state: 'failed',
          code: 'incomplete',
          message: `Incomplete: ${response.incomplete_details?.reason ?? 'unknown'}`,
          usage,
          raw,
        }
      }
      if (response.status === 'cancelled') return { state: 'failed', code: 'timed_out', message: 'Cancelled', usage, raw }
      const code = response.error?.code ?? ''
      return {
        state: 'failed',
        code: code === 'server_error' || code === 'rate_limit_exceeded' ? 'provider_transient' : 'provider_failed',
        message: response.error?.message ?? `Provider status ${response.status}`,
        usage,
        raw,
      }
    },

    format: repairFormat,

    async cancel(responseId) {
      await openai()
        .responses.cancel(responseId)
        .catch(() => undefined)
    },
  }
}
