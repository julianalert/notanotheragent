import type { LeadT, RunOutcome } from '../research/contract'

/*
 * Plain, table-based HTML with inline styles so it renders across mail clients, using the Oatmeal mist palette
 * and the orange-to-rose accent. Every model- or web-derived string is escaped. Every link carries its own colour
 * and decoration. Bare domains are split with an inline tag so Gmail does not turn them into blue links; no hidden
 * characters are used, since spam filters treat them as obfuscation.
 */

export const BRAND = 'Not Another Agent'

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

/** A domain shown as text, not as an auto-detected link: wrapping each dot in a span defeats the linkifier. */
const plainDomain = (host: string) => escapeHtml(host).replace(/\./g, '<span>.</span>')

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
  /**
   * initial: first results. daily: the morning digest. instant: a strong explicit request found by a watch run.
   * rerun: the one free second search. link: the private link again, for someone who started a new search for a
   * website or an email that already has a radar (no leads listed).
   */
  kind: 'initial' | 'daily' | 'instant' | 'rerun' | 'link'
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
    return `New request: ${headline.length > 70 ? `${headline.slice(0, 67).trimEnd()}…` : headline}`
  }
  if (input.kind === 'link') return `Your private link for ${input.websiteHost}`
  if (input.kind === 'daily' || input.kind === 'rerun') return `${count} new ${plural(count, 'match', 'matches')} for ${input.websiteHost}`
  if (count > 0) return `Your first ${count} ${plural(count, 'match is', 'matches are')} ready for ${input.websiteHost}`
  if (input.outcome === 'website_unreadable' || input.outcome === 'unsupported_business') {
    return `We couldn’t research ${input.websiteHost} yet`
  }
  return `Your research for ${input.websiteHost} has started`
}

/** Headline inside the email: short, no domain (the website is named above it). */
function headlineFor(input: RunEmailInput) {
  const count = input.leads.length
  if (input.kind === 'instant') return count === 1 ? 'A new request matches your work' : `${count} new requests match your work`
  if (input.kind === 'link') return 'Here is your private link'
  if (input.kind === 'rerun') return `${count} new ${plural(count, 'match', 'matches')} from your second search`
  if (input.kind === 'daily') return `${count} new ${plural(count, 'match', 'matches')} this morning`
  if (count > 0) return `Your first ${count} ${plural(count, 'match is', 'matches are')} ready`
  if (input.outcome === 'website_unreadable' || input.outcome === 'unsupported_business') return 'We couldn’t research your website yet'
  return 'Your research has started'
}

function introFor(input: RunEmailInput) {
  const count = input.leads.length
  if (input.kind === 'link') {
    return `Someone just started a new search for ${input.websiteHost} or with this email address. Your radar already exists, so here is its link again: your leads, sources and first messages are all there. If this wasn’t you, you can ignore this email.`
  }
  if (count > 0 && input.kind === 'rerun') {
    return `Your second search, with your corrections, found ${count} more public ${plural(count, 'post', 'posts')} from people who need what you offer.`
  }
  if (count > 0) {
    if (input.kind === 'instant') {
      return count === 1
        ? 'Your agent just spotted a public post that matches what you offer. People tend to answer the first replies.'
        : `Your agent just spotted ${count} public posts that match what you offer. People tend to answer the first replies.`
    }
    return input.kind === 'daily'
      ? `This morning’s search found ${count} new public ${plural(count, 'post', 'posts')} from people who may need what you offer.`
      : `We read your website and found ${count} public ${plural(count, 'post', 'posts')} from people who need what you offer.`
  }
  if (input.outcome === 'website_unreadable') {
    return 'We couldn’t read enough of your website to understand what you sell. Open your page and try a services-page URL.'
  }
  if (input.outcome === 'unsupported_business') {
    return 'Your website doesn’t look like a business whose buyers post public requests, so we didn’t search.'
  }
  return 'We couldn’t verify any strong matches today. We never pad the list, and we’ll search again every morning.'
}

function footerFor(input: RunEmailInput, host: string) {
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
        <p style="margin:0 0 6px;font:500 17px/24px ${SANS};color:${INK}"><a href="${escapeHtml(`${privateUrl}#lead-${lead.id}`)}" style="color:${INK};text-decoration:none">${escapeHtml(d.headline)} <span style="color:${MUTED}">&rarr;</span></a></p>
        <p style="margin:0 0 12px;font:400 13px/20px ${SANS};color:${MUTED}">${escapeHtml(who)}</p>
        ${quote ? `<p style="margin:0;padding-left:12px;border-left:2px solid ${LINE};font:400 14px/22px ${SANS};color:${INK}">“${escapeHtml(quote.excerpt)}”</p>` : ''}
      </td></tr>
    </table>
  </td></tr>`
}

export function renderRunEmail(input: RunEmailInput) {
  const subject = subjectFor(input)
  const headline = headlineFor(input)
  const intro = introFor(input)
  const cta = input.leads.length && input.kind !== 'link' ? 'See all matches and first messages' : 'Open your private page'
  const live = input.plan === 'active' || input.plan === 'past_due'
  const footer = footerFor(input, plainDomain(input.websiteHost))
  const activateUrl = `${input.privateUrl}#activate`
  const leads = input.kind === 'link' ? [] : input.leads
  const preheader = leads[0]?.data.headline ?? intro

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f6;color:${INK}">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f6f6">${escapeHtml(preheader)}</div>
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
            ${leads.map((lead) => leadHtml(lead, input.privateUrl)).join('')}
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

  const textFooter = footerFor(input, input.websiteHost)
  const text = [
    headline,
    '',
    intro,
    '',
    ...leads.flatMap((lead) => [
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
