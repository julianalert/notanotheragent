import { config } from '@/lib/config'
import { clientKey, json, notFound, radarFromRequest, rateLimit, withErrors } from '@/lib/http'
import { retryInitialRun } from '@/lib/radars'
import { tick } from '@/lib/scheduler'
import { after } from 'next/server'

export const POST = withErrors(async function postHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()

  if (new Date() >= new Date(radar.research_ends_at)) {
    return json({ error: 'The time to retry your first search has passed.' }, { status: 409 })
  }
  if (!(await rateLimit(`retry:${clientKey(request)}`, config.retryRateLimitPerHour))) {
    return json({ error: 'Too many retries. Please try again later.' }, { status: 429 })
  }

  // The deadline is enforced again inside the update and again before the provider is called.
  const runId = await retryInitialRun(radar.id)
  if (!runId) return json({ error: 'This search can no longer be retried.' }, { status: 409 })

  after(() => tick().catch((error) => console.error('tick failed', (error as Error).message)))
  return json({ ok: true })
})
