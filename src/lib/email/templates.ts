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
  /** The free trial of a radar that never paid: still running, or over. Absent when trials are off. */
  trial?: { active: boolean; endsAt: Date; timezone: string } | null
}

/** "Thursday, Sep 24" in the radar's timezone. */
const trialDay = (trial: { endsAt: Date; timezone: string }) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: trial.timezone }).format(trial.endsAt)

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
  const again = input.plan !== 'free' || input.trial?.active
  return `We couldn’t verify any strong matches today. We never pad the list${again ? ', and we’ll search again every morning' : ''}.${
    input.trial?.active ? ` Your free trial runs until ${trialDay(input.trial)}.` : ''
  }`
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
      if (input.trial?.active) {
        return `Your agent is on a free trial for ${host}: it searches every morning until ${trialDay(input.trial)}, no card needed. Activate it to keep it running after that.`
      }
      if (input.trial) return `Your free trial for ${host} has ended and your agent is asleep. Activate it to search every morning again.`
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

/* ------------------------------- Lifecycle -------------------------------- */

/*
 * Emails sent on the trial's clock rather than after a run: a day before it ends, when it ends, a look at what
 * appeared since, and one last note. Same shell and rules as the run emails. They stop as soon as the radar is
 * activated or the address unsubscribes.
 */

export type LifecycleKind = 'trial_ending' | 'trial_ended' | 'missed_matches' | 'last_call'

export type LifecycleEmailInput = {
  kind: LifecycleKind
  websiteHost: string
  privateUrl: string
  unsubscribeUrl: string
  priceUsd: number
  trialDays: number
  /** What the trial produced. */
  found: number
  contacted: number
  /** Leads not yet contacted or dismissed, best first (trial_ending shows two). */
  open: Array<{ id: string; data: LeadT }>
  /** missed_matches: recent posts that look like buyers, from previews only. Titles are shown as text, never linked. */
  missed?: { count: number; titles: string[] }
}

function lifecycleCopy(input: LifecycleEmailInput): { subject: string; headline: string; paragraphs: string[]; cta: string } {
  const host = input.websiteHost
  const leads = `${input.found} ${plural(input.found, 'lead', 'leads')}`
  const recap =
    input.found === 0
      ? `Your agent has searched for ${host} every morning and hasn’t found a verified match yet. That happens: most buyer posts appear over weeks, not days.`
      : `So far your agent has found ${leads} for ${host}${input.contacted ? `, and you contacted ${input.contacted}` : ''}.`
  const price = `$${input.priceUsd} a month, cancel any time`
  switch (input.kind) {
    case 'trial_ending':
      return {
        subject: `Your free trial for ${host} ends tomorrow`,
        headline: 'One day left on your free trial',
        paragraphs: [
          recap,
          `Tomorrow it goes to sleep. Activate it and it keeps searching every morning and learning from every lead you contact or dismiss: ${price}.`,
          ...(input.found > 0 && input.contacted === 0
            ? ['Two things get replies: answer within a day of the post, and open with their words rather than your pitch. A first message is already written on each lead.']
            : []),
        ],
        cta: 'Keep my agent running',
      }
    case 'trial_ended':
      return {
        subject: `Your agent for ${host} is asleep`,
        headline: 'Your free trial has ended',
        paragraphs: [
          input.found === 0
            ? `Over ${input.trialDays} days your agent searched for ${host} every morning without finding a verified match. It never pads the list.`
            : `Over ${input.trialDays} days your agent found ${leads} for ${host}${input.contacted ? ` and you contacted ${input.contacted}` : ''}. Your leads, sources and first messages stay on your private page.`,
          `Nothing new is being searched now. Activate your agent and it picks up tomorrow morning with everything it learned from your choices: ${price}.`,
        ],
        cta: `Activate my agent · $${input.priceUsd}/month`,
      }
    case 'missed_matches': {
      const count = input.missed?.count ?? 0
      return {
        subject: `${count} new ${plural(count, 'post looks', 'posts look')} like ${plural(count, 'a buyer', 'buyers')} for ${host}`,
        headline: `${count} ${plural(count, 'post', 'posts')} since your agent went to sleep`,
        paragraphs: [
          `We took a quick look at the public web for ${host}: ${count} recent ${plural(count, 'post looks', 'posts look')} like someone who needs what you sell.`,
          'We only read their previews. Opening each one, checking the date and the author, and writing a first message is what your agent does when it’s active.',
        ],
        cta: 'Wake my agent to check them',
      }
    }
    case 'last_call':
      return {
        subject: `Your radar for ${host} is still here`,
        headline: '“Every day I start at least one conversation”',
        paragraphs: [
          '“Every day I start at least one conversation with a company that’s actively looking for what we build. These are serious buyers with real budgets, and some of them have become our biggest contracts.” Clément Bernard, founder of VisionBDS.',
          `Your radar for ${host} keeps everything it learned${input.found ? ` and the ${leads} it found` : ''}. This is our last email about it: activate your agent whenever you’re ready, ${price}.`,
        ],
        cta: 'Activate my agent',
      }
  }
}

export function renderLifecycleEmail(input: LifecycleEmailInput) {
  const copy = lifecycleCopy(input)
  const activateUrl = `${input.privateUrl}#activate`
  const shown = input.kind === 'trial_ending' ? input.open.slice(0, 2) : []
  const titles = input.kind === 'missed_matches' ? (input.missed?.titles ?? []).slice(0, 3) : []

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f6;color:${INK}">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f6f6">${escapeHtml(copy.paragraphs[0])}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f6">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px">
        <tr><td style="padding:32px 32px 8px">
          <p style="margin:0 0 28px;font:600 13px/18px ${SANS};letter-spacing:0.02em;color:${INK}">
            <span style="display:inline-block;width:9px;height:9px;border-radius:999px;background:#f97316;background-image:linear-gradient(90deg,#f97316,#f43f5e);vertical-align:1px;margin-right:8px"></span>${escapeHtml(BRAND)}
          </p>
          <p style="margin:0 0 6px;font:600 12px/18px ${SANS};letter-spacing:0.04em;text-transform:uppercase;color:${MUTED}">Your radar &middot; ${plainDomain(input.websiteHost)}</p>
          <h1 style="margin:0 0 12px;font:400 32px/38px ${SERIF};color:${INK}">${escapeHtml(copy.headline)}</h1>
          ${copy.paragraphs.map((text) => `<p style="margin:0 0 16px;font:400 15px/24px ${SANS};color:${MUTED}">${escapeHtml(text).replace(escapeHtml(input.websiteHost), plainDomain(input.websiteHost))}</p>`).join('\n          ')}
        </td></tr>
        ${
          shown.length
            ? `<tr><td style="padding:0 32px">
          <p style="margin:0 0 10px;font:600 12px/18px ${SANS};letter-spacing:0.04em;text-transform:uppercase;color:${MUTED}">Still to review</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${shown.map((lead) => leadHtml(lead, input.privateUrl)).join('')}</table>
        </td></tr>`
            : ''
        }
        ${
          titles.length
            ? `<tr><td style="padding:0 32px 8px">
          ${titles.map((title) => `<p style="margin:0 0 8px;padding:12px 16px;background:${SOFT};border-radius:10px;font:500 14px/21px ${SANS};color:${INK}">${escapeHtml(title)}</p>`).join('')}
        </td></tr>`
            : ''
        }
        <tr><td style="padding:12px 32px 32px">
          <a href="${escapeHtml(activateUrl)}" style="display:inline-block;padding:11px 22px;border-radius:999px;background:#f97316;background-image:linear-gradient(90deg,#f97316,#f43f5e);font:600 14px/20px ${SANS};color:#ffffff;text-decoration:none">${escapeHtml(copy.cta)}</a>
          <p style="margin:24px 0 0;font:400 13px/20px ${SANS};color:${MUTED}"><a href="${escapeHtml(input.privateUrl)}" style="color:${INK};font-weight:600;text-decoration:none">Open my private page &rarr;</a></p>
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

  const text = [
    copy.headline,
    '',
    ...copy.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...shown.flatMap((lead) => [`- ${lead.data.headline}`, `  ${input.privateUrl}#lead-${lead.id}`]),
    ...titles.map((title) => `- ${title}`),
    ...(shown.length || titles.length ? [''] : []),
    `${copy.cta}: ${activateUrl}`,
    `Open my private page: ${input.privateUrl}`,
    '',
    'Keep this email private: its link opens your results.',
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join('\n')

  return { subject: copy.subject, html, text }
}
