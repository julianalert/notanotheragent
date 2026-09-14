import { json, notFound, radarFromRequest, withErrors } from '@/lib/http'
import { getRadarView } from '@/lib/radars'

/** Read-only: returns saved radar and run state. Polling never advances research. */
export const GET = withErrors(async function getHandler(request: Request) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  return json(await getRadarView(radar))
})
