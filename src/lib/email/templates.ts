import type { LeadT, RunOutcome } from '../research/contract'

/*
 * Plain, table-based HTML with inline styles so it renders across mail clients, using the Oatmeal mist palette
 * and the orange-to-rose accent. Every model- or web-derived string is escaped.
 */

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`),
  )

const INK = '#16191a'
const MUTED = '#5b6567'
const SOFT = '#f2f3f3'
const LINE = '#e3e6e7'

export type RunEmailInput = {
  /** initial: first results. daily: the morning digest. instant: a strong explicit request found by a watch run. */
  kind: 'initial' | 'daily' | 'instant'
  outcome: RunOutcome
  websiteHost: string
  businessName: string | null
  leads: Array<{ id: string; data: LeadT }>
  privateUrl: string
  unsubscribeUrl: string
  plan: 'free' | 'active' | 'past_due' | 'cancelled'
}

function subjectFor(input: RunEmailInput) {
  const count = input.leads.length
  if (input.kind === 'instant') {
    const headline = input.leads[0]?.data.headline ?? 'a new request'
    return `Someone just asked for what ${input.websiteHost} sells: ${headline.length > 70 ? `${headline.slice(0, 67).trimEnd()}…` : headline}`
  }
  if (input.kind === 'daily') return `${count} new ${count === 1 ? 'lead' : 'leads'} for ${input.websiteHost}`
  if (count > 0) return `Your first ${count} ${count === 1 ? 'lead is' : 'leads are'} ready for ${input.websiteHost}`
  if (input.outcome === 'website_unreadable' || input.outcome === 'unsupported_business') {
    return `We couldn’t research ${input.websiteHost} yet`
  }
  return `Your lead research for ${input.websiteHost} has started`
}

function introFor(input: RunEmailInput) {
  const count = input.leads.length
  if (count > 0) {
    if (input.kind === 'instant') {
      return `Your agent was watching and just found ${count === 1 ? 'a public request' : `${count} public requests`} that match what you sell. Early replies get answered.`
    }
    return input.kind === 'daily'
      ? `This morning’s search found ${count} new ${count === 1 ? 'opportunity' : 'opportunities'} that match what you sell.`
      : `We read your website and found ${count} ${count === 1 ? 'opportunity' : 'opportunities'} with public evidence that they need what you sell.`
  }
  if (input.outcome === 'website_unreadable') {
    return 'We couldn’t read enough of your website to understand what you sell. Open your page and try a services-page URL.'
  }
  if (input.outcome === 'unsupported_business') {
    return 'Your website doesn’t look like a B2B service business whose buyers post public requests, so we didn’t search.'
  }
  return 'We couldn’t verify any strong matches today. We never pad the list, and we’ll search again every morning.'
}

function leadHtml(lead: { id: string; data: LeadT }, privateUrl: string) {
  const d = lead.data
  const who = d.person_name ?? d.public_handle ?? d.company_name ?? 'Author not publicly identified'
  const quote = d.need_evidence_ids.map((id) => d.evidence.find((item) => item.id === id)).find((item) => item?.excerpt.trim())
  const label = d.intent === 'explicit_request' ? 'Explicit request' : d.intent === 'trigger_event' ? 'Trigger signal' : 'Stated problem'
  return `
  <tr><td style="padding:0 0 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border-radius:12px">
      <tr><td style="padding:20px 22px">
        <p style="margin:0 0 8px;font:600 12px/18px Inter,Arial,sans-serif;color:${MUTED}">${escapeHtml(label)} · ${escapeHtml(d.source_platform)} · ${d.date_status === 'unknown' ? 'Date not shown' : `Published ${escapeHtml(formatDate(d.published_date))}`}</p>
        <p style="margin:0 0 6px;font:500 17px/24px Inter,Arial,sans-serif;color:${INK}">${escapeHtml(d.headline)}</p>
        <p style="margin:0 0 12px;font:400 13px/20px Inter,Arial,sans-serif;color:${MUTED}">${escapeHtml(who)}</p>
        ${quote ? `<p style="margin:0 0 14px;padding-left:12px;border-left:2px solid ${LINE};font:400 14px/22px Inter,Arial,sans-serif;color:${INK}">“${escapeHtml(quote.excerpt)}”</p>` : ''}
        <a href="${escapeHtml(`${privateUrl}#lead-${lead.id}`)}" style="font:600 13px/20px Inter,Arial,sans-serif;color:${INK};text-decoration:underline">See evidence and first message →</a>
      </td></tr>
    </table>
  </td></tr>`
}

export function renderRunEmail(input: RunEmailInput) {
  const subject = subjectFor(input)
  const intro = introFor(input)
  const name = input.businessName ?? input.websiteHost
  const cta = input.leads.length ? 'Open all leads' : 'Open your private page'
  const live = input.plan === 'active' || input.plan === 'past_due'
  const footer =
    input.plan === 'past_due'
      ? `Your last payment for ${name} failed. Update your card on your private page to keep the agent searching.`
      : live
        ? `Your agent searches for ${name} every morning and watches its sources through the day. Contact or dismiss leads: it learns from both.`
        : input.plan === 'cancelled'
          ? `Your agent for ${name} is stopped. Your leads stay on your private page; reactivate it there whenever you want new ones.`
          : `This was your free first search for ${name}. Activate your agent to search every morning, watch your sources through the day and learn from what you contact.`
  const activateUrl = `${input.privateUrl}#activate`

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f6">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px">
        <tr><td style="padding:32px 32px 8px">
          <p style="margin:0 0 24px;font:400 22px/28px 'Instrument Serif',Georgia,serif;color:${INK}">Lead Radar</p>
          <p style="margin:0 0 6px;font:600 13px/20px Inter,Arial,sans-serif;color:${MUTED}">${escapeHtml(input.websiteHost)}</p>
          <h1 style="margin:0 0 12px;font:400 32px/38px 'Instrument Serif',Georgia,serif;color:${INK}">${escapeHtml(subject)}</h1>
          <p style="margin:0 0 24px;font:400 15px/24px Inter,Arial,sans-serif;color:${MUTED}">${escapeHtml(intro)}</p>
        </td></tr>
        <tr><td style="padding:0 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${input.leads.map((lead) => leadHtml(lead, input.privateUrl)).join('')}
          </table>
        </td></tr>
        <tr><td style="padding:12px 32px 32px">
          <a href="${escapeHtml(input.privateUrl)}" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#f97316;background-image:linear-gradient(90deg,#f97316,#f43f5e);font:600 14px/20px Inter,Arial,sans-serif;color:#ffffff;text-decoration:none">${escapeHtml(cta)}</a>
          <p style="margin:24px 0 0;font:400 13px/20px Inter,Arial,sans-serif;color:${MUTED}">
            ${escapeHtml(footer)}
            ${!live && input.plan !== 'cancelled' ? ` <a href="${escapeHtml(activateUrl)}" style="color:${INK};font-weight:600">Activate my agent →</a>` : ''}
            Keep this email private: its link opens your results.
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font:400 12px/18px Inter,Arial,sans-serif;color:${MUTED}">
        You’re receiving this because you asked Lead Radar to research leads for ${escapeHtml(input.websiteHost)}.
        <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${MUTED}">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body></html>`

  const text = [
    subject,
    '',
    intro,
    '',
    ...input.leads.flatMap((lead) => [
      `- ${lead.data.headline} (${lead.data.source_platform}, ${lead.data.date_status === 'unknown' ? 'date not shown' : `published ${formatDate(lead.data.published_date)}`})`,
      `  ${input.privateUrl}#lead-${lead.id}`,
    ]),
    '',
    `${cta}: ${input.privateUrl}`,
    '',
    footer,
    ...(!live && input.plan !== 'cancelled' ? [`Activate my agent: ${activateUrl}`] : []),
    'Keep this email private: its link opens your results.',
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join('\n')

  return { subject, html, text }
}
