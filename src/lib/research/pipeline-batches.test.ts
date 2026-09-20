import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// The qualification requests are background jobs at the provider: a fake client lets each one finish on cue.
const created: Array<{ id: string; sourceIds: string[] }> = []
const finished = new Map<string, unknown>()
vi.mock('./provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provider')>()),
  openai: () => ({
    responses: {
      create: async (request: { input: string }) => {
        const id = `resp_${created.length + 1}`
        created.push({ id, sourceIds: (JSON.parse(request.input) as { sources: Array<{ id: string }> }).sources.map((source) => source.id) })
        return { id }
      },
      retrieve: async (id: string) =>
        finished.has(id)
          ? { status: 'completed', usage: { input_tokens: 10, output_tokens: 5 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(finished.get(id)) }] }] }
          : { status: 'in_progress' },
      cancel: async () => undefined,
    },
  }),
}))

import type { CandidateT, ResearchResultT } from './contract'
import { createPipelineProvider, memoryPipelineStore, progressOf, type PipelineSource, type PipelineState } from './pipeline'

function candidate(n: number): CandidateT {
  const url = `https://forum.example.org/threads/${n}`
  return {
    headline: `Agency owner needs new clients ${n}`,
    person_name: null,
    company_name: null,
    public_handle: `u/agency_owner_${n}`,
    role: null,
    company_website: null,
    location: null,
    identity_evidence_ids: ['e1'],
    buyer_match: 'The author says they run a small marketing agency.',
    source_url: url,
    source_platform: 'Forum',
    published_date: '2026-09-13',
    date_status: 'exact',
    date_note: null,
    date_evidence_ids: ['e1'],
    need_summary: `Referrals slowed down (${n})`,
    need_evidence_ids: ['e1'],
    intent: 'stated_problem',
    matched_service: 'Lead research',
    fit_explanation: 'They describe an empty pipeline.',
    fit_is_inferred: true,
    budget: null,
    deadline: null,
    terms_evidence_ids: [],
    contact_route: { url, kind: 'original_post', explanation: 'Reply on the post', evidence_ids: ['e1'] },
    outreach_angle: 'Offer to share where their buyers ask publicly.',
    outreach_language: 'en',
    outreach_message: 'Hi, saw your post about referrals slowing down.',
    score: { intent: 2, service_fit: 3, freshness: 2, contactability: 2 },
    evidence: [{ id: 'e1', url, title: 'Post', inspected_original: true, excerpt: 'Referrals used to keep us busy', paraphrase: 'Referrals dried up.' }],
    caveats: [],
    decision: 'qualified',
    decision_reasons: [],
    missing_info: [],
    access_limitations: [],
  }
}

const result = (candidates: CandidateT[], angle: string): ResearchResultT => ({
  schema_version: '3',
  research_status: 'complete',
  profile: null,
  search_plan: { angles: [angle], proposed_queries: [`${angle} query`] },
  candidates,
  follow_up: { worthwhile: false, reason: 'Enough found.', untried_angles: [angle], candidates_to_verify: [] },
  coverage: { limitations: [], access_failures: [], rejection_summary: [] },
})

const source = (n: number, triage: number): PipelineSource => ({
  id: `S${n}`,
  url: `https://forum.example.org/threads/${n}`,
  title: `Thread ${n}`,
  connector: 'exa',
  topic: 'agencies losing referrals',
  community: null,
  publishedDate: '2026-09-13',
  text: 'Referrals used to keep us busy but the last three months have been dead. '.repeat(3),
  fetched: true,
  triage,
  reason: 'buyer',
})

describe('qualification in batches', () => {
  beforeEach(() => {
    created.length = 0
    finished.clear()
    process.env.OPENAI_API_KEY ??= 'test'
  })

  it('judges the best sources first, hands each finished batch over once, and merges them at the end', async () => {
    const store = memoryPipelineStore()
    const provider = createPipelineProvider(store)
    const { responseId } = await provider.start({ mode: 'daily', now_utc: '2026-09-17T07:00:00Z', untried_angles: [] } as never)
    const state = (await store.load(responseId)) as PipelineState
    state.step = 'qualify'
    state.profile = { acquisition_brief: {} } as never
    // Seven sources: the two weakest must end up alone in the second batch.
    state.sources = [source(1, 1), source(2, 3), source(3, 3), source(4, 1), source(5, 2), source(6, 3), source(7, 2)]
    await store.save(responseId, state)

    expect(await provider.inspect(responseId)).toEqual({ state: 'pending' })
    expect(created.map((batch) => batch.sourceIds)).toEqual([['S2', 'S3', 'S6', 'S5', 'S7'], ['S1', 'S4']])
    expect((await provider.progress!(responseId))?.batches).toEqual({ done: 0, total: 2 })

    // Nothing finished yet: still pending, nothing to show.
    expect(await provider.inspect(responseId)).toEqual({ state: 'pending' })

    finished.set('resp_1', result([candidate(2), candidate(3)], 'first'))
    const early = await provider.inspect(responseId)
    expect(early.state).toBe('pending')
    expect(early.state === 'pending' && early.partial?.candidates.map((item) => item.source_url)).toEqual([candidate(2).source_url, candidate(3).source_url])
    expect((await provider.progress!(responseId))?.batches).toEqual({ done: 1, total: 2 })

    // The same batch is never handed over twice.
    expect(await provider.inspect(responseId)).toEqual({ state: 'pending' })

    finished.set('resp_2', result([candidate(1)], 'second'))
    const final = await provider.inspect(responseId)
    expect(final.state).toBe('completed')
    const merged = JSON.parse((final as { text: string }).text) as ResearchResultT
    expect(merged.candidates.map((item) => item.source_url)).toEqual([2, 3, 1].map((n) => candidate(n).source_url))
    expect(merged.search_plan.angles).toEqual(['first', 'second'])
    expect(merged.research_status).toBe('complete')
    expect((final as { usage: { input_tokens: number } }).usage.input_tokens).toBe(20)
  })

  it('reports counts only for steps that have finished', () => {
    const base = { step: 'search', websitePages: ['a', 'a', 'b', 'b'], hits: [], sources: [], stepStartedAt: '2026-09-17T07:00:30Z' } as unknown as PipelineState
    expect(progressOf(base)).toEqual({ step: 'search', stepStartedAt: '2026-09-17T07:00:30Z', websitePages: 2, hits: null, sources: null, batches: null })
    expect(progressOf({ ...base, step: 'done' } as PipelineState)).toBeNull()
  })
})
