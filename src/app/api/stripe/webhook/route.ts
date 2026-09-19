import { billingConfigured, billingEventFrom, constructEvent } from '@/lib/billing/stripe'
import { applyPlanPatch, findRadarForBilling } from '@/lib/billing/radar-plan'
import { applyBillingEvent } from '@/lib/billing/subscription'
import { query } from '@/lib/db'
import { recordEvent } from '@/lib/events'
import { json } from '@/lib/http'
import { tick } from '@/lib/scheduler'
import { after } from 'next/server'

function log(event: string, details: Record<string, unknown>) {
  // Never log customer emails or private links.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }))
}

/**
 * Stripe webhook. The raw body is verified against STRIPE_WEBHOOK_SECRET; each event id is recorded first so a
 * redelivered event is a no-op. Unhandled event types are acknowledged and ignored.
 */
export async function POST(request: Request) {
  if (!billingConfigured()) return json({ error: 'Billing not configured' }, { status: 503 })
  const payload = await request.text()
  const signature = request.headers.get('stripe-signature') ?? ''
  let event
  try {
    event = constructEvent(payload, signature)
  } catch (error) {
    log('billing.bad_signature', { error: (error as Error).message.slice(0, 120) })
    return json({ error: 'Invalid signature' }, { status: 400 })
  }

  const recorded = await query<{ id: string }>(
    `insert into stripe_events (id, type) values ($1, $2) on conflict (id) do nothing returning id`,
    [event.id, event.type],
  )
  if (!recorded.length) return json({ received: true, duplicate: true })

  try {
    const translated = await billingEventFrom(event)
    if (!translated) return json({ received: true, ignored: event.type })
    const radar = await findRadarForBilling(translated.radarId, translated.subscriptionId)
    if (!radar) {
      log('billing.radar_not_found', { type: event.type })
      return json({ received: true, unmatched: true })
    }
    const patch = applyBillingEvent(radar, translated.billing, new Date())
    await applyPlanPatch(radar.id, patch)
    if (patch.plan && patch.plan !== radar.plan) {
      await recordEvent(radar.id, 'plan_changed', { from: radar.plan, to: patch.plan }, `stripe:${event.id}`)
    }
    log('billing.applied', { type: event.type, plan: patch.plan ?? radar.plan })
    if (patch.next_run_at) after(() => tick().catch((error) => console.error('tick failed', (error as Error).message)))
    return json({ received: true })
  } catch (error) {
    // Let Stripe retry: forget the event id so the redelivery is processed.
    await query(`delete from stripe_events where id = $1`, [event.id]).catch(() => undefined)
    log('billing.error', { type: event.type, error: (error as Error).message.slice(0, 200) })
    return json({ error: 'Processing failed' }, { status: 500 })
  }
}
