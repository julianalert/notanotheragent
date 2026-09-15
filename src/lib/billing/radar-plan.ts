import 'server-only'
import { query } from '../db'
import type { RadarRow } from '../radars'
import type { PlanPatch, PlanState } from './subscription'

/** The radar a billing event concerns: by id from Checkout, otherwise by subscription id. */
export async function findRadarForBilling(radarId: string | null, subscriptionId: string | null): Promise<(PlanState & { id: string }) | null> {
  const rows = radarId && /^[0-9a-f-]{36}$/i.test(radarId)
    ? await query<RadarRow>(`select * from radars where id = $1`, [radarId])
    : subscriptionId
      ? await query<RadarRow>(`select * from radars where stripe_subscription_id = $1`, [subscriptionId])
      : []
  const radar = rows[0]
  if (!radar) return null
  return {
    id: radar.id,
    plan: radar.plan,
    research_ends_at: new Date(radar.research_ends_at),
    next_run_at: radar.next_run_at ? new Date(radar.next_run_at) : null,
    stripe_customer_id: radar.stripe_customer_id,
    stripe_subscription_id: radar.stripe_subscription_id,
  }
}

export async function applyPlanPatch(radarId: string, patch: PlanPatch) {
  const sets: string[] = []
  const params: unknown[] = [radarId]
  const set = (column: string, value: unknown) => {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }
  if (patch.plan !== undefined) set('plan', patch.plan)
  if (patch.stripe_customer_id !== undefined) set('stripe_customer_id', patch.stripe_customer_id)
  if (patch.stripe_subscription_id !== undefined) set('stripe_subscription_id', patch.stripe_subscription_id)
  if (patch.research_ends_at !== undefined) set('research_ends_at', patch.research_ends_at)
  if (patch.current_period_end !== undefined) set('current_period_end', patch.current_period_end)
  if (patch.activated_at !== undefined) set('activated_at', patch.activated_at)
  if (patch.next_run_at !== undefined) set('next_run_at', patch.next_run_at)
  if (!sets.length) return
  await query(`update radars set ${sets.join(', ')} where id = $1`, params)
}
