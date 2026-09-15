import { json, notFound, radarFromRequest, withErrors } from '@/lib/http'
import { setWatchedSourceEnabled } from '@/lib/radars'

/** Turn a watched source on or off. Watch runs poll only enabled sources. */
export const PATCH = withErrors(async function patchHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  const body = await request.json().catch(() => null)
  if (typeof body?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body?.enabled !== 'boolean') {
    return json({ error: 'Invalid source' }, { status: 422 })
  }
  const updated = await setWatchedSourceEnabled(radar.id, body.id, body.enabled)
  return updated ? json({ ok: true }) : notFound()
})
