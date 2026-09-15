import { describe, expect, it } from 'vitest'
import { agentLive, aliveUntil, applyBillingEvent, GRACE_DAYS, planForSubscriptionStatus, type PlanState } from './subscription'

const NOW = new Date('2026-09-15T10:00:00Z')
const DAY_MS = 86_400_000
const PERIOD_END = new Date('2026-10-15T10:00:00Z')

const free: PlanState = {
  plan: 'free',
  research_ends_at: new Date('2026-09-29T10:00:00Z'),
  next_run_at: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
}
const active: PlanState = { ...free, plan: 'active', research_ends_at: aliveUntil(PERIOD_END, NOW), next_run_at: new Date('2026-09-16T06:00:00Z'), stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }

describe('plan lifecycle', () => {
  it('activation schedules an immediate run and extends the deadline past the paid period', () => {
    const patch = applyBillingEvent(free, { type: 'activated', customerId: 'cus_1', subscriptionId: 'sub_1', periodEnd: PERIOD_END }, NOW)
    expect(patch.plan).toBe('active')
    expect(patch.next_run_at).toEqual(NOW)
    expect(patch.activated_at).toEqual(NOW)
    expect(patch.research_ends_at).toEqual(new Date(PERIOD_END.getTime() + GRACE_DAYS * DAY_MS))
    expect(patch.stripe_subscription_id).toBe('sub_1')
  })

  it('a redelivered activation for an already active radar does not reschedule', () => {
    const patch = applyBillingEvent(active, { type: 'activated', customerId: 'cus_1', subscriptionId: 'sub_1', periodEnd: PERIOD_END }, NOW)
    expect(patch.next_run_at).toBeUndefined()
    expect(patch.activated_at).toBeUndefined()
  })

  it('renewal only extends; a lapsed radar paying again comes back alive', () => {
    const later = new Date('2026-11-15T10:00:00Z')
    expect(applyBillingEvent(active, { type: 'renewed', subscriptionId: 'sub_1', periodEnd: later }, NOW).next_run_at).toBeUndefined()
    const cancelled: PlanState = { ...active, plan: 'cancelled', next_run_at: null }
    const patch = applyBillingEvent(cancelled, { type: 'renewed', subscriptionId: 'sub_1', periodEnd: later }, NOW)
    expect(patch.plan).toBe('active')
    expect(patch.next_run_at).toEqual(NOW)
  })

  it('failed payment keeps the agent running until the grace window ends', () => {
    const patch = applyBillingEvent(active, { type: 'payment_failed', subscriptionId: 'sub_1' }, NOW)
    expect(patch).toEqual({ plan: 'past_due' })
    expect(agentLive('past_due', active.research_ends_at, NOW)).toBe(true)
    expect(agentLive('past_due', active.research_ends_at, new Date(active.research_ends_at.getTime() + 1))).toBe(false)
  })

  it('cancellation stops scheduling; unknown statuses change nothing', () => {
    expect(applyBillingEvent(active, { type: 'status', subscriptionId: 'sub_1', status: 'canceled', periodEnd: null }, NOW)).toEqual({ plan: 'cancelled', next_run_at: null })
    expect(applyBillingEvent(active, { type: 'status', subscriptionId: 'sub_1', status: 'something_new', periodEnd: null }, NOW)).toEqual({})
    expect(planForSubscriptionStatus('trialing')).toBe('active')
    expect(planForSubscriptionStatus('unpaid')).toBe('past_due')
  })

  it('a free radar is never live, even before its first-search deadline', () => {
    expect(agentLive('free', free.research_ends_at, NOW)).toBe(false)
  })
})
