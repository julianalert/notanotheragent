import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createPipelineProvider, memoryPipelineStore, type PipelineState } from './pipeline'

/*
 * A step result the database rejects (the production case: web text holding half an emoji in a jsonb column) must be
 * counted and end the run, never silently repeat the step. The first step of a run with a saved profile makes no
 * network call, which makes it a safe stand-in for the expensive ones.
 */
describe('a step result that cannot be stored', () => {
  const brief = {
    sells: 'Lead research for agencies.',
    buyers: ['Agency owners'],
    recognise_buyer_in_posts: [],
    buyer_problems_in_their_words: ['referrals dried up and the pipeline is empty'],
    trigger_situations: [],
    explicit_requests: ['recommend a lead source for my agency'],
    not_our_buyer: [],
    buyer_seller_confusions: [],
    geography: { value: null, basis: 'unknown' },
    languages: { value: 'English', basis: 'stated' },
  }
  const input = { mode: 'daily', now_utc: '2026-09-17T07:00:00Z', profile: { acquisition_brief: brief }, untried_angles: [] }

  it('is recorded as an attempt on the last storable state, and fails the run after three', async () => {
    process.env.OPENAI_API_KEY ??= 'test'
    const memory = memoryPipelineStore()
    const rejected: PipelineState[] = []
    const store = {
      ...memory,
      async save(id: string, state: PipelineState) {
        if (state.step === 'search') {
          rejected.push(state)
          throw new Error('invalid input syntax for type json')
        }
        return memory.save(id, state)
      },
    }
    const provider = createPipelineProvider(store)
    const { responseId } = await provider.start(input as never)

    expect(await provider.inspect(responseId)).toEqual({ state: 'pending' })
    expect((await memory.load(responseId))?.attempts).toEqual({ brief: 1 })
    expect(await provider.inspect(responseId)).toEqual({ state: 'pending' })
    const last = await provider.inspect(responseId)
    expect(last).toMatchObject({ state: 'failed', code: 'provider_failed' })
    expect(rejected).toHaveLength(3)
    expect((await memory.load(responseId))?.step).toBe('failed')
    // A failed run stays failed: nothing runs again.
    expect(await provider.inspect(responseId)).toMatchObject({ state: 'failed' })
    expect(rejected).toHaveLength(3)
  })
})
