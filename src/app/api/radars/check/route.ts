import { json, RADAR_COOKIE, withErrors } from '@/lib/http'
import { findRadarByToken, reusableRadar } from '@/lib/radars'
import { normaliseWebsite } from '@/lib/url'
import { cookies } from 'next/headers'

/** Home step 1: validate the website without creating anything or starting research. */
export const POST = withErrors(async function postHandler(request: Request) {
  const body = await request.json().catch(() => null)
  const website = normaliseWebsite(body?.website)
  if (!website.ok) return json({ error: website.error, field: 'website' }, { status: 422 })

  // Already researching this site in this browser: go straight to it instead of asking for an email again.
  const cookieToken = (await cookies()).get(RADAR_COOKIE)?.value
  const reuse = reusableRadar(await findRadarByToken(cookieToken), website)
  if (reuse?.email && cookieToken) return json({ ok: true, host: website.host, existingToken: cookieToken })

  return json({ ok: true, host: website.host })
})
