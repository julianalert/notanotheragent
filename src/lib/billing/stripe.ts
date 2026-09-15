import 'server-only'
import Stripe from 'stripe'
import { appUrl } from '../email/deliver'
import type { BillingEvent } from './subscription'

/*
 * Stripe Checkout (hosted) activates a radar; the Customer Portal handles cancellation and card changes; webhooks
 * drive the plan. No accounts: the radar id travels as client_reference_id and the private link is the return URL.
 */

let client: Stripe | null = null
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured')
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY))
}

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET)

export async function createCheckoutSession(args: { radarId: string; token: string; email: string | null; customerId: string | null }) {
  const base = appUrl()
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    client_reference_id: args.radarId,
    ...(args.customerId ? { customer: args.customerId } : args.email ? { customer_email: args.email } : {}),
    allow_promotion_codes: true,
    success_url: `${base}/r/${args.token}?activated=1`,
    cancel_url: `${base}/r/${args.token}`,
    subscription_data: { metadata: { radar_id: args.radarId } },
    metadata: { radar_id: args.radarId },
  })
  return session.url
}

export async function createPortalSession(args: { customerId: string; token: string }) {
  const session = await stripe().billingPortal.sessions.create({
    customer: args.customerId,
    return_url: `${appUrl()}/r/${args.token}`,
  })
  return session.url
}

export function constructEvent(payload: string, signature: string) {
  return stripe().webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET!)
}

const id = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : (value?.id ?? null))

/** Period end lives on the subscription items in current API versions. */
export function periodEndOf(subscription: Stripe.Subscription): Date | null {
  const ends = subscription.items.data.map((item) => item.current_period_end).filter((value): value is number => typeof value === 'number')
  if (!ends.length) return null
  return new Date(Math.max(...ends) * 1000)
}

/**
 * Translate a Stripe event into a billing event and the radar it concerns (by id from checkout, or by
 * subscription id). Returns null for events the app does not act on.
 */
export async function billingEventFrom(event: Stripe.Event): Promise<{ radarId: string | null; subscriptionId: string | null; billing: BillingEvent } | null> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const subscriptionId = id(session.subscription)
      const customerId = id(session.customer)
      if (!subscriptionId || !customerId || session.mode !== 'subscription') return null
      const subscription = await stripe().subscriptions.retrieve(subscriptionId)
      return {
        radarId: session.client_reference_id ?? session.metadata?.radar_id ?? null,
        subscriptionId,
        billing: { type: 'activated', customerId, subscriptionId, periodEnd: periodEndOf(subscription) },
      }
    }
    case 'invoice.paid': {
      const invoice = event.data.object
      const subscriptionId = id(invoice.parent?.subscription_details?.subscription)
      if (!subscriptionId) return null
      const subscription = await stripe().subscriptions.retrieve(subscriptionId)
      return { radarId: subscription.metadata?.radar_id ?? null, subscriptionId, billing: { type: 'renewed', subscriptionId, periodEnd: periodEndOf(subscription) } }
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object
      const subscriptionId = id(invoice.parent?.subscription_details?.subscription)
      if (!subscriptionId) return null
      return { radarId: null, subscriptionId, billing: { type: 'payment_failed', subscriptionId } }
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object
      return {
        radarId: subscription.metadata?.radar_id ?? null,
        subscriptionId: subscription.id,
        billing: { type: 'status', subscriptionId: subscription.id, status: subscription.status, periodEnd: periodEndOf(subscription) },
      }
    }
    default:
      return null
  }
}
