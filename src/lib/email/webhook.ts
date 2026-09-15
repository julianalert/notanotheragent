import 'server-only'
import type { LeadT } from '../research/contract'

/*
 * Optional delivery to a Slack incoming webhook (or any https endpoint that accepts {"text": ...}): one compact
 * message per run with the new leads. The private link is never included; the source links are public anyway.
 */

export async function postWebhook(url: string, input: { websiteHost: string; leads: LeadT[] }) {
  const lines = input.leads.slice(0, 5).map((lead) => {
    const who = lead.person_name ?? lead.public_handle ?? lead.company_name ?? 'author not identified'
    const label = lead.intent === 'explicit_request' ? 'Explicit request' : lead.intent === 'trigger_event' ? 'Trigger signal' : 'Stated problem'
    return `• *${lead.headline}*\n  ${label} · ${who} · ${lead.source_platform}\n  ${lead.source_url}`
  })
  const text = `New ${input.leads.length === 1 ? 'lead' : 'leads'} for ${input.websiteHost}:\n${lines.join('\n')}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`webhook HTTP ${response.status}`)
}
