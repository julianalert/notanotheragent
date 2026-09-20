import { clientKey, json, RADAR_COOKIE, rateLimit, withErrors } from '@/lib/http'
import { findRadarByToken, reusableRadar } from '@/lib/radars'
import { probeWebsite } from '@/lib/research/pages'
import { normaliseWebsite } from '@/lib/url'
import { cookies } from 'next/headers'

/** Outgoing probes per visitor and hour; past that the address is only checked for syntax. */
const PROBES_PER_HOUR = 30

function probeWarning(host: string, probe: Awaited<ReturnType<typeof probeWebsite>>) {
  if (probe.reachable !== false) return null
  if (probe.reason === 'not_found') return `We couldn’t find ${host}. Check the spelling, or press the button again to use it anyway.`
  if (probe.reason === 'missing') return `${host} says this page doesn’t exist. Check the address, or press the button again to use it anyway.`
  return `${host} didn’t let us open it (${probe.detail}), so we may not be able to read it. Check the address, or press the button again to try anyway.`
}

/** Home step 1: validate the website without creating anything or starting research. */
export const POST = withErrors(async function postHandler(request: Request) {
  const body = await request.json().catch(() => null)
  const website = normaliseWebsite(body?.website)
  if (!website.ok) return json({ error: website.error, field: 'website' }, { status: 422 })

  // Already researching this site in this browser: go straight to it instead of asking for an email again.
  const cookieToken = (await cookies()).get(RADAR_COOKIE)?.value
  const reuse = reusableRadar(await findRadarByToken(cookieToken), website)
  if (reuse?.email && cookieToken) return json({ ok: true, host: website.host, existingToken: cookieToken })

  // A typo would spend the visitor's one free search on a site that can't be read: warn once, never block.
  // `confirmed` is the visitor pressing the button again with the same address.
  let warning: string | null = null
  if (body?.confirmed !== true && (await rateLimit(`probe:${clientKey(request)}`, PROBES_PER_HOUR))) {
    warning = probeWarning(website.host, await probeWebsite(website.url))
  }
  return json({ ok: true, host: website.host, warning })
})
