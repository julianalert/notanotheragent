import { billingConfigured, createPortalSession } from '@/lib/billing/stripe'
import { json, notFound, radarFromRequest, TOKEN_HEADER, withErrors } from '@/lib/http'

/** Stripe Customer Portal: cancel, change card, see invoices. */
export const POST = withErrors(async function postHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  if (!billingConfigured()) return json({ error: 'Payments are not configured yet.' }, { status: 503 })
  if (!radar.stripe_customer_id) return json({ error: 'No subscription found for this radar.' }, { status: 409 })
  const url = await createPortalSession({ customerId: radar.stripe_customer_id, token: request.headers.get(TOKEN_HEADER)! })
  return json({ url })
})
