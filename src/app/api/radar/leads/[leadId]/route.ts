import { json, notFound, radarFromRequest } from '@/lib/http'
import { updateLeadStatus } from '@/lib/radars'

const STATUSES = new Set(['new', 'contacted', 'dismissed'])

export async function PATCH(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const radar = await radarFromRequest(request)
  if (!radar) return notFound()
  const { leadId } = await params
  const body = await request.json().catch(() => null)
  if (!STATUSES.has(body?.status) || !/^[0-9a-f-]{36}$/i.test(leadId)) {
    return json({ error: 'Invalid status' }, { status: 422 })
  }
  // Lead status stays editable after the research period ends.
  const updated = await updateLeadStatus(radar.id, leadId, body.status)
  return updated ? json({ ok: true }) : notFound()
}
