import { appUrl } from '@/lib/site'
import { linkKind, tagsFrom, verifyResendSignature } from '@/lib/email/resend-webhook'
import { recordEvent, type EventName } from '@/lib/events'
import { json } from '@/lib/http'

const EVENTS: Record<string, EventName> = {
  'email.opened': 'email_opened',
  'email.clicked': 'email_clicked',
  'email.bounced': 'email_bounced',
  'email.complained': 'email_complained',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resend webhook: email engagement for the funnel. Configure in Resend → Webhooks with the events above, pointing to
 * /api/resend/webhook, and set RESEND_WEBHOOK_SECRET. Opens and clicks also need tracking enabled on the domain.
 * Only the event, the email kind and the kind of link are kept: never addresses or URLs.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return json({ error: 'Webhook not configured' }, { status: 503 })
  const payload = await request.text()
  const headers = {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }
  if (!verifyResendSignature(secret, headers, payload)) return json({ error: 'Invalid signature' }, { status: 400 })

  const event = JSON.parse(payload) as { type?: string; data?: { click?: { link?: string } } }
  const name = event.type ? EVENTS[event.type] : undefined
  if (!name) return json({ received: true, ignored: event.type ?? null })

  const tags = tagsFrom(event.data)
  const radarId = tags.radar_id && UUID.test(tags.radar_id) ? tags.radar_id : null
  const props: Record<string, string> = { kind: tags.kind ?? 'unknown' }
  if (tags.plan) props.plan = tags.plan
  if (name === 'email_clicked') props.link = linkKind(event.data?.click?.link, appUrl())

  // The Svix message id makes a redelivered webhook a no-op.
  await recordEvent(radarId, name, props, `resend:${headers.id}`)
  return json({ received: true })
}
