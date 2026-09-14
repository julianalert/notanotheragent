import { json, withErrors } from '@/lib/http'
import { tick } from '@/lib/scheduler'
import { safeEqual } from '@/lib/tokens'

export const maxDuration = 300

/** The single scheduled backend task. Call every minute with `Authorization: Bearer $CRON_SECRET`. */
export const GET = withErrors(async function getHandler(request: Request) {
  const secret = process.env.CRON_SECRET
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!secret || !safeEqual(provided, secret)) return json({ error: 'Unauthorized' }, { status: 401 })
  await tick()
  return json({ ok: true })
})

export const POST = GET
