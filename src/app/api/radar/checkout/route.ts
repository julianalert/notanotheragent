import { billingConfigured, createCheckoutSession } from '@/lib/billing/stripe'
import { config } from '@/lib/config'
import { clientKey, json, notFound, radarFromRequest, rateLimit, TOKEN_HEADER, withErrors } from '@/lib/http'

/** Start Stripe Checkout for this radar's $99/month agent. Returns the hosted checkout URL. */
export const POST = withErrors(async function postHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  if (!billingConfigured()) return json({ error: 'Payments are not configured yet. Please try again later.' }, { status: 503 })
  if (!radar.profile) return json({ error: 'Your first search has to finish before the agent can be activated.' }, { status: 409 })
  if (radar.plan === 'active') return json({ error: 'Your agent is already active.' }, { status: 409 })
  if (!rateLimit(`checkout:${clientKey(request)}`, config.createRateLimitPerHour * 2)) {
    return json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
  }
  const url = await createCheckoutSession({
    radarId: radar.id,
    token: request.headers.get(TOKEN_HEADER)!,
    email: radar.email,
    customerId: radar.stripe_customer_id,
  })
  if (!url) return json({ error: 'Checkout could not be started. Please try again.' }, { status: 502 })
  return json({ url })
})
