import { json, notFound, radarFromRequest, withErrors } from '@/lib/http'
import { updateFocus } from '@/lib/radars'

export const PATCH = withErrors(async function patchHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  if (!radar.profile) return json({ error: 'Focus is available once your business profile is ready.' }, { status: 409 })
  const body = await request.json().catch(() => null)

  if (body?.reset === true) {
    await updateFocus(radar, null)
    return json({ ok: true })
  }

  const services: string[] = Array.isArray(body?.services)
    ? body.services.filter((service: unknown): service is string => typeof service === 'string').slice(0, 20)
    : []
  const market = typeof body?.market === 'string' ? body.market.trim() : ''
  if (!services.length) {
    return json({ error: 'Choose at least one service from your website.', field: 'services' }, { status: 422 })
  }
  if (market.length > 200) {
    return json({ error: 'Keep the market under 200 characters.', field: 'market' }, { status: 422 })
  }
  const wanted = typeof body?.wanted === 'string' ? body.wanted.trim() : ''
  const avoid = typeof body?.avoid === 'string' ? body.avoid.trim() : ''
  if (wanted.length > 300 || avoid.length > 300) {
    return json({ error: 'Keep each guidance note under 300 characters.', field: wanted.length > 300 ? 'wanted' : 'avoid' }, { status: 422 })
  }
  // Applies to future scheduled runs only: no extra search, no deadline change, no services outside the profile.
  await updateFocus(radar, { services, market: market || null, wanted: wanted || null, avoid: avoid || null })
  return json({ ok: true })
})
