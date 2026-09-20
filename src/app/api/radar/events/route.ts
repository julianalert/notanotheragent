import { cleanProps, DESK_EVENTS, recordEvent, type EventName } from '@/lib/events'
import { json, notFound, radarFromRequest, rateLimit, withErrors } from '@/lib/http'
import { query } from '@/lib/db'

const EVENTS_PER_HOUR = 600
// One page view per sitting: polling, tab switches and reloads within this window count once.
const VIEW_WINDOW_MINUTES = 30

/** Desk actions reported by the browser. Unknown names are ignored rather than rejected. */
export const POST = withErrors(async function postHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  const body = await request.json().catch(() => null)
  const name = body?.name as EventName
  if (!DESK_EVENTS.has(name)) return json({ ok: true, ignored: true })
  if (!(await rateLimit(`events:${radar.id}`, EVENTS_PER_HOUR))) return json({ ok: true, ignored: true })

  if (name === 'desk_viewed') {
    const recent = await query(
      `select 1 from events where radar_id = $1 and name = 'desk_viewed' and created_at > now() - make_interval(mins => $2) limit 1`,
      [radar.id, VIEW_WINDOW_MINUTES],
    )
    if (recent.length) return json({ ok: true })
  }

  await recordEvent(radar.id, name, { plan: radar.plan, ...cleanProps(body?.props) })
  return json({ ok: true })
})
