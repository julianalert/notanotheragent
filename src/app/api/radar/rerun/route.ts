import { config } from '@/lib/config'
import { recordEvent } from '@/lib/events'
import { clientKey, json, notFound, radarFromRequest, rateLimit, withErrors } from '@/lib/http'
import { getRadarView, requestRerun } from '@/lib/radars'
import { tick } from '@/lib/scheduler'
import { after } from 'next/server'

/**
 * The one free second search of a sleeping radar: after a first search that found nothing, or once the focus has
 * changed. It searches the same window again with the current focus and the angles the first search left untried.
 */
export const POST = withErrors(async function postHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  if (!(await rateLimit(`rerun:${clientKey(request)}`, config.retryRateLimitPerHour))) {
    return json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
  }

  const view = await getRadarView(radar)
  if (!view.rerun.available) {
    return json({ error: view.rerun.used ? 'Your free second search has already been used.' : 'A second search isn’t available for this radar right now.' }, { status: 409 })
  }
  const runId = await requestRerun(radar.id)
  if (!runId) return json({ error: 'A second search isn’t available for this radar right now.' }, { status: 409 })

  await recordEvent(radar.id, 'rerun_requested', { reason: view.rerun.reason ?? 'unknown', plan: radar.plan })
  after(() => tick().catch((error) => console.error('tick failed', (error as Error).message)))
  return json({ ok: true })
})
