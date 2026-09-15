import { json, notFound, radarFromRequest, withErrors } from '@/lib/http'
import { updateLeadStatus } from '@/lib/radars'
import { DISMISS_REASONS, type DismissReason } from '@/lib/research/contract'

const STATUSES = new Set(['new', 'contacted', 'dismissed'])
const REASONS = new Set<string>(DISMISS_REASONS)

export const PATCH = withErrors(async function patchHandler(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  const { leadId } = await params
  const body = await request.json().catch(() => null)
  if (!STATUSES.has(body?.status) || !/^[0-9a-f-]{36}$/i.test(leadId)) {
    return json({ error: 'Invalid status' }, { status: 422 })
  }
  const reason = typeof body.reason === 'string' && REASONS.has(body.reason) ? (body.reason as DismissReason) : null
  // Lead status stays editable after the research period ends.
  const updated = await updateLeadStatus(radar.id, leadId, body.status, reason)
  return updated ? json({ ok: true }) : notFound()
})
