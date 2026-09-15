/*
 * Plan lifecycle, as pure functions so the webhook handler stays thin and testable.
 *
 * A radar starts `free`: its initial run (and retries, for 14 days) is the only research. Paying activates the
 * agent: daily runs, watch runs and learning, for as long as the subscription is in good standing.
 * `research_ends_at` becomes "agent alive until": the end of the paid period plus a grace window, so every
 * existing deadline check keeps working unchanged.
 */

export type Plan = 'free' | 'active' | 'past_due' | 'cancelled'

export const GRACE_DAYS = 3
const DAY_MS = 86_400_000

/** Stripe subscription statuses mapped to plans. Unknown statuses keep the current plan. */
export function planForSubscriptionStatus(status: string): Plan | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due'
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return 'cancelled'
    default:
      return null
  }
}

export type BillingEvent =
  | { type: 'activated'; customerId: string; subscriptionId: string; periodEnd: Date | null }
  | { type: 'renewed'; subscriptionId: string; periodEnd: Date | null }
  | { type: 'payment_failed'; subscriptionId: string }
  | { type: 'status'; subscriptionId: string; status: string; periodEnd: Date | null }

export type PlanState = {
  plan: Plan
  research_ends_at: Date
  next_run_at: Date | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export type PlanPatch = Partial<PlanState> & { activated_at?: Date; current_period_end?: Date | null }

/** Agent alive until the end of the paid period plus grace; never earlier than the current deadline while paid. */
export function aliveUntil(periodEnd: Date | null, now: Date) {
  const base = periodEnd ?? new Date(now.getTime() + 31 * DAY_MS)
  return new Date(base.getTime() + GRACE_DAYS * DAY_MS)
}

/**
 * The patch to apply for one billing event. Activation (first payment, or a lapsed radar paying again) schedules
 * an immediate run so the user sees the agent come alive. Renewals only extend the deadline. A failed payment
 * marks the plan but keeps runs going until the grace window ends. Cancellation stops scheduling.
 */
export function applyBillingEvent(state: PlanState, event: BillingEvent, now: Date): PlanPatch {
  switch (event.type) {
    case 'activated': {
      const becoming = state.plan !== 'active'
      return {
        plan: 'active',
        stripe_customer_id: event.customerId,
        stripe_subscription_id: event.subscriptionId,
        research_ends_at: aliveUntil(event.periodEnd, now),
        current_period_end: event.periodEnd,
        ...(becoming ? { activated_at: now, next_run_at: now } : {}),
      }
    }
    case 'renewed':
      return {
        plan: 'active',
        research_ends_at: aliveUntil(event.periodEnd, now),
        current_period_end: event.periodEnd,
        ...(state.plan !== 'active' && state.plan !== 'past_due' ? { activated_at: now, next_run_at: now } : {}),
        ...(state.next_run_at === null ? { next_run_at: now } : {}),
      }
    case 'payment_failed':
      return { plan: 'past_due' }
    case 'status': {
      const plan = planForSubscriptionStatus(event.status)
      if (!plan) return {}
      if (plan === 'cancelled') return { plan, next_run_at: null }
      if (plan === 'active') {
        return {
          plan,
          research_ends_at: aliveUntil(event.periodEnd, now),
          current_period_end: event.periodEnd,
          ...(state.plan !== 'active' ? { next_run_at: state.next_run_at ?? now } : {}),
        }
      }
      return { plan }
    }
  }
}

/** Whether the agent is doing scheduled research for this radar right now. */
export function agentLive(plan: Plan, researchEndsAt: Date, now: Date) {
  return (plan === 'active' || plan === 'past_due') && now.getTime() < researchEndsAt.getTime()
}
