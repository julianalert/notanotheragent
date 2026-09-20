import { parseAttribution } from '@/lib/attribution'
import { config } from '@/lib/config'
import { normaliseEmail } from '@/lib/crypto'
import { clientKey, json, RADAR_COOKIE, rateLimit, withErrors } from '@/lib/http'
import { resendPrivateLink } from '@/lib/email/link'
import { createRadar, findClaimedFreeSearch, findRadarByToken, reusableRadar, setRadarEmail } from '@/lib/radars'
import { tick } from '@/lib/scheduler'
import { isValidTimeZone } from '@/lib/time'
import { createToken, hashToken } from '@/lib/tokens'
import { normaliseWebsite } from '@/lib/url'
import { cookies } from 'next/headers'
import { after } from 'next/server'

/**
 * Creates the radar and starts research. On the home page this is the email step: the website step only
 * validates (/api/radars/check). Without an email in the request, the email this browser already gave is used
 * (for example "Search this page" inside a radar); if there is none, the request is refused.
 */
export const POST = withErrors(async function postHandler(request: Request) {
  const body = await request.json().catch(() => null)
  const website = normaliseWebsite(body?.website)
  if (!website.ok) return json({ error: website.error, field: 'website' }, { status: 422 })

  const cookieStore = await cookies()
  const cookieToken = cookieStore.get(RADAR_COOKIE)?.value
  const existing = await findRadarByToken(cookieToken)

  let email: string | null = null
  if (body?.email !== undefined && body?.email !== null && body?.email !== '') {
    const parsed = normaliseEmail(body.email)
    if (!parsed.ok) return json({ error: parsed.error, field: 'email' }, { status: 422 })
    email = parsed.email
  } else if (existing?.email && !existing.email_unsubscribed_at) {
    email = existing.email
  }

  const reuse = reusableRadar(existing, website)
  if (reuse && cookieToken) {
    if (email && reuse.email !== email) await setRadarEmail(reuse.id, email, cookieToken)
    return json({ token: cookieToken, reused: true })
  }

  if (!email) {
    return json({ error: 'Enter the email address where we should send your leads.', field: 'email' }, { status: 422 })
  }

  if (!(await rateLimit(`create:${clientKey(request)}`, config.createRateLimitPerHour))) {
    return json({ error: 'Too many new searches from this network in the last hour. Please try again later.', field: null }, { status: 429 })
  }

  // One free search per website and per email address. The existing radar's link goes to its owner's inbox, never
  // back to this browser: whoever typed the address may not be the person who created it.
  const claimed = await findClaimedFreeSearch(website, email)
  if (claimed) {
    await resendPrivateLink(claimed.radar)
    const error =
      claimed.match === 'website'
        ? `A radar already exists for ${website.host}. Its private link goes to the email address it was created with: we’ve just sent it again (at most once an hour).`
        : 'This email address has already used its free search. We’ve just sent its private link to that inbox again (at most once an hour).'
    return json({ error, field: null, code: 'existing_radar' }, { status: 409 })
  }

  const timezone = isValidTimeZone(body?.timezone) ? body.timezone : null
  const token = createToken()
  await createRadar({
    tokenHash: hashToken(token),
    website: website.url,
    host: website.host,
    timezone,
    email,
    token,
    attribution: parseAttribution(body?.attribution),
  })

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
})
