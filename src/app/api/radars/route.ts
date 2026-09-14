import { config } from '@/lib/config'
import { clientKey, json, RADAR_COOKIE, rateLimit } from '@/lib/http'
import { createRadar, findRadarByToken } from '@/lib/radars'
import { tick } from '@/lib/scheduler'
import { isValidTimeZone } from '@/lib/time'
import { createToken, hashToken } from '@/lib/tokens'
import { normaliseWebsite } from '@/lib/url'
import { cookies } from 'next/headers'
import { after } from 'next/server'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const website = normaliseWebsite(body?.website)
  if (!website.ok) return json({ error: website.error, field: 'website' }, { status: 422 })

  const cookieStore = await cookies()

  // Same-session resubmission of the same website reuses the existing radar; its deadline is never reset.
  // A different URL on the same domain is allowed only as a correction when the first page couldn't be read.
  const existing = await findRadarByToken(cookieStore.get(RADAR_COOKIE)?.value)
  if (existing && (existing.website === website.url || (existing.website_host === website.host && existing.profile))) {
    return json({ token: cookieStore.get(RADAR_COOKIE)!.value, reused: true })
  }

  if (!rateLimit(`create:${clientKey(request)}`, config.createRateLimitPerHour)) {
    return json(
      { error: 'Too many new searches from this browser. Please try again later.', field: 'website' },
      { status: 429 },
    )
  }

  const timezone = isValidTimeZone(body?.timezone) ? body.timezone : null
  const token = createToken()
  const language = typeof body?.language === 'string' ? body.language.slice(0, 35) : null
  await createRadar({ tokenHash: hashToken(token), website: website.url, host: website.host, timezone, language })

  cookieStore.set(RADAR_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 60,
  })

  // Start the research job right away; the scheduled task picks it up if this is interrupted.
  after(() => tick().catch((error) => console.error('tick failed', (error as Error).message)))

  return json({ token }, { status: 201 })
}
