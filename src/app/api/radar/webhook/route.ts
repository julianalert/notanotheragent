import { json, notFound, radarFromRequest, withErrors } from '@/lib/http'
import { setWebhookUrl } from '@/lib/radars'
import { safeOutgoingUrl } from '@/lib/url'

/** Where new leads are also posted (Slack incoming webhook or any https endpoint accepting {"text": ...}). */
export const PATCH = withErrors(async function patchHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  const body = await request.json().catch(() => null)
  const raw = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!raw) {
    await setWebhookUrl(radar.id, null)
    return json({ ok: true })
  }
  const url = safeOutgoingUrl(raw)
  if (!url || !url.startsWith('https://') || url.length > 500) {
    return json({ error: 'Enter an https:// webhook URL, for example a Slack incoming webhook.', field: 'url' }, { status: 422 })
  }
  await setWebhookUrl(radar.id, url)
  return json({ ok: true })
})
