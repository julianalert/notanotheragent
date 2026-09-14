import { json, notFound, radarFromRequest } from '@/lib/http'
import { updateTimezone } from '@/lib/radars'
import { isValidTimeZone } from '@/lib/time'

export async function PATCH(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  const body = await request.json().catch(() => null)
  if (!isValidTimeZone(body?.timezone)) return json({ error: 'Unknown timezone' }, { status: 422 })
  await updateTimezone(radar, body.timezone)
  return json({ ok: true })
}
