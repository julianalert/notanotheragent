import type { LeadT, RunOutcome } from '../research/contract'

/*
 * Plain, table-based HTML with inline styles so it renders across mail clients, using the Oatmeal mist palette
 * and the orange-to-rose accent. Every model- or web-derived string is escaped. Every link carries its own colour
 * and decoration, and bare domains are broken with a zero-width space so Gmail does not turn them into blue links.
 */

export const BRAND = 'Not Another Agent'

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

/** A domain shown as text, not as an auto-detected link: a zero-width space after each dot defeats the linkifier. */
const plainDomain = (host: string) => escapeHtml(host).replace(/\./g, '.&#8203;')

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`),
  )

const INK = '#16191a'
const MUTED = '#5b6567'
const SOFT = '#f2f3f3'
const LINE = '#e3e6e7'
const SANS = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif"

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

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** Inbox subject: names the website so several radars stay apart. */
function subjectFor(input: RunEmailInput) {
  const count = input.leads.length
  if (input.kind === 'instant') {
    const headline = input.leads[0]?.data.headline ?? 'a new request'
    return `Someone just asked for what you sell: ${headline.length > 70 ? `${headline.slice(0, 67).trimEnd()}…` : headline}`
  }
  if (input.kind === 'daily') return `${count} new ${plural(count, 'lead', 'leads')} for ${input.websiteHost}`
  if (count > 0) return `Your first ${count} ${plural(count, 'lead is', 'leads are')} ready for ${input.websiteHost}`
  if (input.outcome === 'website_unreadable' || input.outcome === 'unsupported_business') {
    return `We couldn’t research ${input.websiteHost} yet`
  }
  return `Your lead research for ${input.websiteHost} has started`
}

/** Headline inside the email: short, no domain (the website is named above it). */
function headlineFor(input: RunEmailInput) {
  const count = input.leads.length
  if (input.kind === 'instant') return count === 1 ? 'Someone just asked for what you sell' : `${count} people just asked for what you sell`
  if (input.kind === 'daily') return `${count} new ${plural(count, 'lead', 'leads')} this morning`
  if (count > 0) return `Your first ${count} ${plural(count, 'lead is', 'leads are')} ready`
  if (input.outcome === 'website_unreadable' || input.outcome === 'unsupported_business') return 'We couldn’t research your website yet'
  return 'Your lead research has started'
}

function introFor(input: RunEmailInput) {
  const count = input.leads.length
  if (count > 0) {
    if (input.kind === 'instant') {
      return count === 1
        ? 'Your agent was watching and just found a public request that matches what you sell. Early replies get answered.'
        : `Your agent was watching and just found ${count} public requests that match what you sell. Early replies get answered.`
    }
    return input.kind === 'daily'
      ? `This morning’s search found ${count} new ${plural(count, 'opportunity', 'opportunities')} that ${plural(count, 'matches', 'match')} what you sell.`
      : `We read your website and found ${count} ${plural(count, 'opportunity', 'opportunities')} with public evidence that they need what you sell.`
  }
  if (input.outcome === 'website_unreadable') {
    return 'We couldn’t read enough of your website to understand what you sell. Open your page and try a services-page URL.'
  }
  if (input.outcome === 'unsupported_business') {
    return 'Your website doesn’t look like a business whose buyers post public requests, so we didn’t search.'
  }
  return 'We couldn’t verify any strong matches today. We never pad the list, and we’ll search again every morning.'
}

function footerFor(input: RunEmailInput) {
  const host = plainDomain(input.websiteHost)
  switch (input.plan) {
    case 'past_due':
      return `Your last payment failed. Update your card on your private page to keep the agent searching for ${host}.`
    case 'active':
      return `Your agent searches for ${host} every morning. Contact or dismiss leads: it learns from both.`
    case 'cancelled':
      return `Your agent for ${host} is stopped. Your leads stay on your private page; reactivate it there whenever you want new ones.`
    default:
      return `This was your free first search for ${host}. Activate your agent to search every morning and learn from what you contact.`
  }
}

function leadHtml(lead: { id: string; data: LeadT }, privateUrl: string) {
  const d = lead.data
  const who = d.person_name ?? d.public_handle ?? d.company_name ?? 'Author not publicly identified'
  const quote = d.need_evidence_ids.map((id) => d.evidence.find((item) => item.id === id)).find((item) => item?.excerpt.trim())
  const label = d.intent === 'explicit_request' ? 'Explicit request' : d.intent === 'trigger_event' ? 'Trigger signal' : 'Stated problem'
  const when = d.date_status === 'unknown' ? 'Date not shown' : `Published ${escapeHtml(formatDate(d.published_date))}`
  return `
  <tr><td style="padding:0 0 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border-radius:12px">
      <tr><td style="padding:20px 22px">
        <p style="margin:0 0 8px;font:600 12px/18px ${SANS};color:${MUTED}">${escapeHtml(label)} &middot; ${escapeHtml(d.source_platform)} &middot; ${when}</p>
        <p style="margin:0 0 6px;font:500 17px/24px ${SANS};color:${INK}">${escapeHtml(d.headline)}</p>
        <p style="margin:0 0 12px;font:400 13px/20px ${SANS};color:${MUTED}">${escapeHtml(who)}</p>
        ${quote ? `<p style="margin:0 0 14px;padding-left:12px;border-left:2px solid ${LINE};font:400 14px/22px ${SANS};color:${INK}">“${escapeHtml(quote.excerpt)}”</p>` : ''}
        <a href="${escapeHtml(`${privateUrl}#lead-${lead.id}`)}" style="display:inline-block;padding:7px 14px;border:1px solid ${INK};border-radius:999px;font:600 13px/18px ${SANS};color:${INK};text-decoration:none">See evidence and first message &rarr;</a>
      </td></tr>
    </table>
  </td></tr>`
}

export function renderRunEmail(input: RunEmailInput) {
  const subject = subjectFor(input)
  const headline = headlineFor(input)
  const intro = introFor(input)
  const cta = input.leads.length ? 'Open all leads' : 'Open your private page'
  const live = input.plan === 'active' || input.plan === 'past_due'
  const footer = footerFor(input)
  const activateUrl = `${input.privateUrl}#activate`
  const preheader = input.leads[0]?.data.headline ?? intro

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f6;color:${INK}">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f6f6">${escapeHtml(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f6">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px">
        <tr><td style="padding:32px 32px 8px">
          <p style="margin:0 0 28px;font:600 13px/18px ${SANS};letter-spacing:0.02em;color:${INK}">
            <span style="display:inline-block;width:9px;height:9px;border-radius:999px;background:#f97316;background-image:linear-gradient(90deg,#f97316,#f43f5e);vertical-align:1px;margin-right:8px"></span>${escapeHtml(BRAND)}
          </p>
          <p style="margin:0 0 6px;font:600 12px/18px ${SANS};letter-spacing:0.04em;text-transform:uppercase;color:${MUTED}">Your radar &middot; ${plainDomain(input.websiteHost)}</p>
          <h1 style="margin:0 0 12px;font:400 32px/38px ${SERIF};color:${INK}">${escapeHtml(headline)}</h1>
          <p style="margin:0 0 24px;font:400 15px/24px ${SANS};color:${MUTED}">${escapeHtml(intro)}</p>
        </td></tr>
        <tr><td style="padding:0 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${input.leads.map((lead) => leadHtml(lead, input.privateUrl)).join('')}
          </table>
        </td></tr>
        <tr><td style="padding:12px 32px 32px">
          <a href="${escapeHtml(input.privateUrl)}" style="display:inline-block;padding:11px 22px;border-radius:999px;background:#f97316;background-image:linear-gradient(90deg,#f97316,#f43f5e);font:600 14px/20px ${SANS};color:#ffffff;text-decoration:none">${escapeHtml(cta)}</a>
          <p style="margin:24px 0 0;font:400 13px/20px ${SANS};color:${MUTED}">
            ${footer}
            ${!live && input.plan !== 'cancelled' ? ` <a href="${escapeHtml(activateUrl)}" style="color:${INK};font-weight:600;text-decoration:none">Activate my agent &rarr;</a>` : ''}
          </p>
          <p style="margin:12px 0 0;font:400 13px/20px ${SANS};color:${MUTED}">Keep this email private: its link opens your results.</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font:400 12px/18px ${SANS};color:${MUTED}">
        You’re receiving this because you asked ${escapeHtml(BRAND)} to research leads for ${plainDomain(input.websiteHost)}.
        <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body></html>`

  const textFooter = footer.replace(/&#8203;/g, '').replace(/&amp;/g, '&')
  const text = [
    headline,
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
    textFooter,
    ...(!live && input.plan !== 'cancelled' ? [`Activate my agent: ${activateUrl}`] : []),
    'Keep this email private: its link opens your results.',
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join('\n')

  return { subject, html, text }
}
