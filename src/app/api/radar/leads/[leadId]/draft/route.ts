import { config } from '@/lib/config'
import { query } from '@/lib/db'
import { clientKey, json, notFound, radarFromRequest, rateLimit, withErrors } from '@/lib/http'
import { SEARCH_MODEL, type LeadT, type OutreachDraft } from '@/lib/research/contract'
import { openai } from '@/lib/research/provider'

const STYLES = new Set(['shorter', 'direct', 'friendlier'])

const INSTRUCTIONS = `Rewrite a first outreach message to someone who published a public post. Keep every fact: reference only what the
post says and what the sender's website documents; add no claims, offers, numbers or names. Keep the same
language unless a language is requested. Styles: "shorter" (at most 45 words), "direct" (lead with the point, one
concrete next step, one question, no pleasantries), "friendlier" (warm, human, still under 90 words, no
exclamation marks). Return the message text only.`

/** Rewrite the first message in a given style. Variants are kept beside the original; nothing is sent. */
export const POST = withErrors(async function postHandler(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  const { leadId } = await params
  const body = await request.json().catch(() => null)
  const style = body?.style
  if (!STYLES.has(style) || !/^[0-9a-f-]{36}$/i.test(leadId)) return json({ error: 'Invalid request' }, { status: 422 })
  if (!process.env.OPENAI_API_KEY) return json({ error: 'Rewriting is not available right now.' }, { status: 503 })
  if (!rateLimit(`draft:${clientKey(request)}`, config.retryRateLimitPerHour * 6)) {
    return json({ error: 'Too many rewrites. Please try again later.' }, { status: 429 })
  }
  const [row] = await query<{ data: LeadT }>(`select data from leads where id = $2 and radar_id = $1`, [radar.id, leadId])
  if (!row) return notFound()
  const lead = row.data
  const language = typeof body?.language === 'string' && body.language.length <= 40 ? body.language : lead.outreach_language

  const response = await openai().responses.create(
    {
      model: SEARCH_MODEL,
      reasoning: { effort: 'low' },
      tools: [],
      max_output_tokens: 600,
      instructions: INSTRUCTIONS,
      input: JSON.stringify({
        style,
        language,
        original_message: lead.outreach_message,
        their_post: { headline: lead.headline, need_summary: lead.need_summary, outreach_angle: lead.outreach_angle },
        sender_offers: lead.matched_service,
      }),
    },
    { timeout: 45_000 },
  )
  const message = response.output_text?.trim()
  if (response.status !== 'completed' || !message) return json({ error: 'The rewrite did not complete. Try again.' }, { status: 502 })

  const draft: OutreachDraft = { style, language, message: message.slice(0, 1200), created_at: new Date().toISOString() }
  const drafts = [...(lead.outreach_drafts ?? []).filter((item) => item.style !== style), draft].slice(-6)
  await query(`update leads set data = jsonb_set(data, '{outreach_drafts}', $3::jsonb, true) where id = $2 and radar_id = $1`, [
    radar.id,
    leadId,
    JSON.stringify(drafts),
  ])
  return json({ draft })
})
