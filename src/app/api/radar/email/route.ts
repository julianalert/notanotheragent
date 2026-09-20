import { config } from '@/lib/config'
import { normaliseEmail } from '@/lib/crypto'
import { clientKey, json, notFound, radarFromRequest, rateLimit, TOKEN_HEADER, withErrors } from '@/lib/http'
import { setRadarEmail } from '@/lib/radars'
import { tick } from '@/lib/scheduler'
import { after } from 'next/server'

/** Step 2 after the website: where to send results. Required before the results page. */
export const PUT = withErrors(async function putHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  if (!(await rateLimit(`email:${clientKey(request)}`, config.createRateLimitPerHour * 2))) {
    return json({ error: 'Too many attempts. Please try again later.', field: 'email' }, { status: 429 })
  }
  const body = await request.json().catch(() => null)
  const email = normaliseEmail(body?.email)
  if (!email.ok) return json({ error: email.error, field: 'email' }, { status: 422 })

  await setRadarEmail(radar.id, email.email, request.headers.get(TOKEN_HEADER)!)
  // If results finished while they were typing, send them now rather than at the next tick.
  after(() => tick().catch((error) => console.error('tick failed', (error as Error).message)))
  return json({ ok: true })
})
