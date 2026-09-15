import { safeOutgoingUrl } from '../url'
import type { BusinessProfileT, EvidenceT, Focus, LeadT } from './contract'

/*
 * Deterministic qualification gates (spec §1.6). These check structure, references, dates, audit
 * corroboration and thresholds. They cannot verify semantics: that remains the research model's source
 * inspection plus human sampling. Nothing here should be presented to users as independent verification.
 */

const DAY_MS = 86_400_000
const MAX_EXCERPT_WORDS_PER_SOURCE = 25
export const MAX_PUBLISHED_PER_RUN = 5

/** No new research may start at or after the deadline. */
export function isResearchOpen(now: Date, researchEndsAt: Date) {
  return now.getTime() < researchEndsAt.getTime()
}

/* ------------------------------ URL handling ------------------------------ */

const TRACKING_PARAM = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|igshid|si|ref_src|ref_url|trk|trackingId|share_id|rdt|_ga|_gl)$/i

/**
 * Conservative canonical form: lowercase host (without www), drop scheme, fragment and known tracking
 * parameters, keep case-sensitive path and content-identifying query parameters.
 */
export function canonicalUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : ''
  return `${host}${path}${query}`
}

/**
 * Platform identifiers. `thread` is the post a page belongs to; `item` also includes a comment ID when the URL
 * is a permalink to one comment. Returns null for sites without a recognised structure.
 */
function platformIds(input: string): { thread: string; item: string } | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www|old|new|m|mobile|np)\./, '')
  const path = url.pathname
  let match: RegExpMatchArray | null
  if (host.endsWith('reddit.com') && (match = path.match(/\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i))) {
    const thread = `reddit:${match[1].toLowerCase()}`
    return { thread, item: match[2] && !/\.json$/i.test(match[2]) ? `${thread}:${match[2].toLowerCase()}` : thread }
  }
  if (host === 'redd.it' && (match = path.match(/^\/([a-z0-9]+)/i))) return { thread: `reddit:${match[1].toLowerCase()}`, item: `reddit:${match[1].toLowerCase()}` }
  if ((host === 'x.com' || host === 'twitter.com') && (match = path.match(/\/status\/(\d+)/))) return { thread: `x:${match[1]}`, item: `x:${match[1]}` }
  if (host.endsWith('linkedin.com') && (match = path.match(/activity[-:](\d{10,})/))) return { thread: `linkedin:${match[1]}`, item: `linkedin:${match[1]}` }
  if (host === 'news.ycombinator.com' && url.searchParams.get('id')) {
    return { thread: `hn:${url.searchParams.get('id')}`, item: `hn:${url.searchParams.get('id')}` }
  }
  if (host.endsWith('upwork.com') && (match = path.match(/~([0-9a-f]{10,})/i))) {
    return { thread: `upwork:${match[1].toLowerCase()}`, item: `upwork:${match[1].toLowerCase()}` }
  }
  return null
}

/** Prefer a source-specific post (and comment) ID so the same item under different URLs dedupes. */
export function sourceKey(input: string): string | null {
  const canonical = canonicalUrl(input)
  if (!canonical) return null
  return platformIds(input)?.item ?? canonical
}

/**
 * Keys under which a consulted page proves a source was inspected: its canonical URL, plus the platform thread
 * it belongs to. Opening a Reddit thread shows the comments inside it, so a comment permalink is corroborated by
 * the thread page. This matches a specific post, never a whole domain.
 */
export function auditKeysFor(input: string): string[] {
  const canonical = canonicalUrl(input.replace(/\.json(?=$|\?)/i, ''))
  const ids = platformIds(input)
  return [canonical, ids?.thread].filter((key): key is string => Boolean(key))
}

function hostOf(input: string) {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function onDomain(url: string, domain: string) {
  const host = hostOf(url)
  return Boolean(host && (host === domain || host.endsWith(`.${domain}`)))
}

/* ------------------------------ Text helpers ------------------------------ */

const norm = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length

const STOPWORDS = new Set(
  'the and for with our that this from are need needs looking help want who can have has how any into your their about agency service services'.split(' '),
)

function needTokens(text: string) {
  return new Set(norm(text).split(' ').filter((word) => word.length >= 3 && !STOPWORDS.has(word)))
}

export function similarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / (a.size + b.size - shared)
}

export function identityKey(lead: Pick<LeadT, 'company_name' | 'public_handle' | 'person_name'>) {
  const raw = lead.company_name || lead.public_handle || lead.person_name || ''
  return norm(raw.replace(/^@/, ''))
}

const blank = (value: string | null | undefined) => !value || !value.trim()

/* --------------------------------- Dates ---------------------------------- */

export function parseIsoDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

/** Freshness is recomputed from the stored publication date, never taken from the model. */
export function freshnessFor(publishedDate: string, now: Date) {
  const published = parseIsoDate(publishedDate)
  if (!published) return 0
  const today = parseIsoDate(now.toISOString().slice(0, 10))!
  const age = Math.round((today.getTime() - published.getTime()) / DAY_MS)
  if (age < 0) return 0
  if (age <= 7) return 2
  if (age <= 30) return 1
  return 0
}

/* -------------------------------- Profile --------------------------------- */

export function validateProfile(profile: BusinessProfileT | null, websiteUrl: string, auditUrls: string[]) {
  const reasons: string[] = []
  if (!profile) return { ok: false, reasons: ['no profile returned'] }
  const domain = hostOf(websiteUrl)
  const evidence = new Map(profile.evidence.map((item) => [item.id, item]))

  if (!profile.services.length) reasons.push('profile has no services (empty offer)')
  for (const service of profile.services) {
    if (blank(service.value)) reasons.push('blank service')
    if (!service.evidence_ids.length) reasons.push(`service "${service.value}" has no evidence`)
    for (const id of service.evidence_ids) if (!evidence.has(id)) reasons.push(`service "${service.value}" references missing evidence ${id}`)
  }
  for (const item of profile.evidence) {
    if (!safeOutgoingUrl(item.url)) reasons.push(`profile evidence ${item.id} has an invalid URL`)
  }
  // A corroborated source on the submitted business domain, present in the tool audit.
  const auditOnDomain = domain ? auditUrls.filter((url) => onDomain(url, domain)) : []
  const corroborated = Boolean(domain) && profile.evidence.some((item) => onDomain(item.url, domain!))
  if (!auditOnDomain.length) reasons.push('no consulted source on the submitted business domain')
  else if (!corroborated) reasons.push('profile evidence does not cite the business domain')

  return { ok: reasons.length === 0, reasons }
}

/* --------------------------------- Leads ---------------------------------- */

export type PriorOpportunity = {
  sourceKey: string
  identityKey: string
  needText: string
}

export type GateContext = {
  now: Date
  publishedOnOrAfter: string
  auditUrls: string[]
  profile: BusinessProfileT
  focus: Focus | null
  prior: PriorOpportunity[]
}

export type QualifiedLead = {
  lead: LeadT
  sourceUrl: string
  sourceKey: string
  identityKey: string
  needText: string
  score: { intent: number; service_fit: number; freshness: number; contactability: number; total: number }
  heldReason: string | null
}

export type RejectedLead = { headline: string; source_url: string; reasons: string[] }

function checkRefs(label: string, ids: string[], evidence: Map<string, EvidenceT>, reasons: string[], required = true) {
  if (required && !ids.length) reasons.push(`${label}: no evidence reference`)
  for (const id of ids) if (!evidence.has(id)) reasons.push(`${label}: reference ${id} does not resolve`)
}

function mentionedIn(name: string, items: EvidenceT[], extra: string[] = []) {
  const target = norm(name.replace(/^@/, ''))
  if (!target) return false
  const haystack = norm([...items.flatMap((item) => [item.title, item.excerpt, item.paraphrase, item.url]), ...extra].join(' '))
  return haystack.includes(target)
}

const SERVICE_STOPWORDS = new Set(
  (
    'and for with from into our your their the of to in on by via without based using including existing ' +
    'des les une pour avec sans dans par sur aux leur leurs vos nos votre notre entre partir depuis existants existantes'
  ).split(' '),
)

/** Content-word stems (5-letter prefixes) so light paraphrases and plurals still compare. */
function serviceStems(value: string) {
  return new Set(
    norm(value)
      .split(' ')
      .filter((word) => word.length >= 4 && !SERVICE_STOPWORDS.has(word))
      .map((word) => word.slice(0, 5)),
  )
}

/**
 * The model names the matched service in its own words. Accept it when it is the same service: exact or
 * contained text, or at least half of its content words appear in the profile service.
 */
export function sameService(profileService: string, matched: string) {
  const x = norm(profileService)
  const y = norm(matched)
  if (!x || !y) return false
  if (x === y || x.includes(y) || y.includes(x)) return true
  const service = serviceStems(profileService)
  const claimed = serviceStems(matched)
  if (claimed.size < 2) return false
  let shared = 0
  for (const stem of claimed) if (service.has(stem)) shared++
  return shared / claimed.size >= 0.5
}

export const DATE_FROM_SEARCH_CAVEAT = 'The publication date comes from search results for this post, not from the page itself.'

/**
 * Quote budget (spec §1.3): at most 25 quoted words per original source. Quotes proving the need are kept first;
 * other quotes that would exceed the budget lose their excerpt but keep their paraphrase and link. If the need
 * quotes alone exceed the budget, nothing is removed and the gate rejects the lead.
 */
export function applyQuoteBudget(lead: LeadT): LeadT {
  const needIds = new Set(lead.need_evidence_ids)
  const ordered = [...lead.evidence.filter((item) => needIds.has(item.id)), ...lead.evidence.filter((item) => !needIds.has(item.id))]
  const used = new Map<string, number>()
  const trimmed = new Map<string, EvidenceT>()
  for (const item of ordered) {
    const key = canonicalUrl(item.url) ?? item.url
    const words = wordCount(item.excerpt)
    const total = (used.get(key) ?? 0) + words
    if (words > 0 && total > MAX_EXCERPT_WORDS_PER_SOURCE && !needIds.has(item.id)) {
      trimmed.set(item.id, { ...item, excerpt: '' })
      continue
    }
    used.set(key, total)
  }
  if (!trimmed.size) return lead
  return { ...lead, evidence: lead.evidence.map((item) => trimmed.get(item.id) ?? item) }
}

/** Per-lead hard gates. Returns reasons; empty means the lead passes. */
export function leadGateReasons(lead: LeadT, ctx: GateContext, auditKeys: Set<string | null>) {
  const reasons: string[] = []
  const evidence = new Map<string, EvidenceT>()
  for (const item of lead.evidence) {
    if (evidence.has(item.id)) reasons.push(`duplicate evidence id ${item.id}`)
    evidence.set(item.id, item)
    if (!safeOutgoingUrl(item.url)) reasons.push(`evidence ${item.id} has an invalid URL`)
  }

  // Source URL: public, and actually consulted according to the tool audit.
  const sourceUrl = safeOutgoingUrl(lead.source_url)
  const sourceCanonical = sourceUrl ? canonicalUrl(sourceUrl) : null
  if (!sourceUrl) reasons.push('source URL is not a public http(s) URL')
  else if (!auditKeysFor(sourceUrl).some((key) => auditKeys.has(key))) {
    reasons.push('source URL does not appear in the search tool audit')
  }

  // Identity.
  if (blank(lead.person_name) && blank(lead.company_name) && blank(lead.public_handle)) {
    reasons.push('no identifiable person, company or handle')
  }
  checkRefs('identity', lead.identity_evidence_ids, evidence, reasons)
  const identityItems = lead.identity_evidence_ids.map((id) => evidence.get(id)).filter(Boolean) as EvidenceT[]
  const websiteHost = lead.company_website ? hostOf(lead.company_website) : null
  if (!blank(lead.company_name) && !mentionedIn(lead.company_name!, identityItems, websiteHost ? [websiteHost] : [])) {
    reasons.push('company affiliation is not supported by identity evidence')
  }
  if (!blank(lead.person_name) && !mentionedIn(lead.person_name!, identityItems)) {
    reasons.push('person name is not supported by identity evidence')
  }
  // A handle is the author shown on the original post: inspecting that page is the evidence (Reddit quotes and
  // URLs don't contain usernames). Company and person names still need explicit support.
  const identityFromOriginal = identityItems.some(
    (item) => item.inspected_original && sourceCanonical !== null && canonicalUrl(item.url) === sourceCanonical,
  )
  if (!blank(lead.public_handle) && !identityFromOriginal && !mentionedIn(lead.public_handle!, identityItems)) {
    reasons.push('public handle is not supported by identity evidence')
  }

  // Need: referenced, excerpted, and inspected on the original source.
  if (blank(lead.need_summary)) reasons.push('empty need summary')
  checkRefs('need', lead.need_evidence_ids, evidence, reasons)
  const needItems = lead.need_evidence_ids.map((id) => evidence.get(id)).filter(Boolean) as EvidenceT[]
  for (const item of needItems) {
    if (blank(item.excerpt)) reasons.push(`need evidence ${item.id} has no excerpt`)
    if (blank(item.paraphrase)) reasons.push(`need evidence ${item.id} has no paraphrase`)
  }
  if (
    sourceCanonical &&
    !needItems.some((item) => item.inspected_original && canonicalUrl(item.url) === sourceCanonical)
  ) {
    reasons.push('original source was not reported inspected')
  }

  // Quote budget: at most 25 words per original source in aggregate.
  const wordsBySource = new Map<string, number>()
  for (const item of lead.evidence) {
    const key = canonicalUrl(item.url) ?? item.url
    wordsBySource.set(key, (wordsBySource.get(key) ?? 0) + wordCount(item.excerpt))
  }
  for (const [, words] of wordsBySource) {
    if (words > MAX_EXCERPT_WORDS_PER_SOURCE) reasons.push(`excerpts exceed ${MAX_EXCERPT_WORDS_PER_SOURCE} words for one source`)
  }

  // Publication date: required, original, inside the window, not in the future.
  // The date may come from search-result metadata for this exact post (Reddit pages show "5d ago"), never from
  // another page. Such leads carry a caveat so the user checks the date before relying on it.
  checkRefs('date', lead.date_evidence_ids, evidence, reasons)
  let dateFromSearchResult = false
  for (const id of lead.date_evidence_ids) {
    const item = evidence.get(id)
    if (!item || item.inspected_original) continue
    if (sourceCanonical !== null && canonicalUrl(item.url) === sourceCanonical) dateFromSearchResult = true
    else reasons.push('publication date evidence is not from the original source')
  }
  const published = parseIsoDate(lead.published_date)
  const today = parseIsoDate(ctx.now.toISOString().slice(0, 10))!
  if (!published) reasons.push('publication date is missing or not YYYY-MM-DD')
  else {
    if (published.getTime() > today.getTime()) reasons.push('publication date is in the future')
    if (published.getTime() < parseIsoDate(ctx.publishedOnOrAfter)!.getTime()) reasons.push('published before the allowed window')
  }

  // Terms: budget/deadline claims need references; explicit past deadlines are expired.
  checkRefs('terms', lead.terms_evidence_ids, evidence, reasons, !blank(lead.budget) || !blank(lead.deadline))
  const deadlineDate = lead.deadline?.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
  if (deadlineDate && parseIsoDate(deadlineDate) && parseIsoDate(deadlineDate)!.getTime() < today.getTime()) {
    reasons.push('deadline has passed')
  }

  // Contact route.
  if (!safeOutgoingUrl(lead.contact_route.url)) reasons.push('contact route is not a public http(s) URL')
  checkRefs('contact', lead.contact_route.evidence_ids, evidence, reasons)

  // Service fit against the extracted profile (and user focus, when set).
  if (blank(lead.fit_explanation)) reasons.push('empty fit explanation')
  const profileServices = ctx.profile.services.map((service) => service.value)
  if (!profileServices.some((service) => sameService(service, lead.matched_service))) {
    reasons.push('matched service is not in the extracted profile')
  } else if (ctx.focus?.services.length && !ctx.focus.services.some((service) => sameService(service, lead.matched_service))) {
    reasons.push('matched service is outside the selected focus')
  }

  if (blank(lead.outreach_message)) reasons.push('empty outreach message')

  // Score bounds and thresholds, with freshness recomputed server-side.
  const { intent, service_fit, contactability } = lead.score
  const inBounds = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max
  if (!inBounds(intent, 3) || !inBounds(service_fit, 3) || !inBounds(contactability, 2) || !inBounds(lead.score.freshness, 2)) {
    reasons.push('score out of bounds')
  }
  const freshness = freshnessFor(lead.published_date, ctx.now)
  const total = intent + service_fit + freshness + contactability
  if (intent < 2) reasons.push('intent below threshold')
  if (service_fit !== 3) reasons.push('service fit below threshold')
  if (freshness < 1) reasons.push('freshness below threshold')
  if (contactability !== 2) reasons.push('contactability below threshold')
  if (total < 8) reasons.push('total score below threshold')

  return { reasons, sourceUrl, dateFromSearchResult, score: { intent, service_fit, freshness, contactability, total } }
}

/**
 * Apply all gates, deduplicate against history and within the batch, sort and cap.
 * Ambiguous probable duplicates are held for review rather than displayed.
 */
export function qualifyLeads(leads: LeadT[], ctx: GateContext) {
  const auditKeys = new Set<string | null>(ctx.auditUrls.flatMap(auditKeysFor))
  const passing: QualifiedLead[] = []
  const rejected: RejectedLead[] = []

  for (const original of leads) {
    const lead = applyQuoteBudget(original)
    const { reasons, sourceUrl, dateFromSearchResult, score } = leadGateReasons(lead, ctx, auditKeys)
    if (reasons.length || !sourceUrl) {
      rejected.push({ headline: lead.headline, source_url: lead.source_url, reasons })
      continue
    }
    passing.push({
      lead: {
        ...lead,
        source_url: sourceUrl,
        company_website: lead.company_website ? safeOutgoingUrl(lead.company_website) : null,
        contact_route: { ...lead.contact_route, url: safeOutgoingUrl(lead.contact_route.url)! },
        score: { ...lead.score, freshness: score.freshness },
        caveats: dateFromSearchResult && !lead.caveats.includes(DATE_FROM_SEARCH_CAVEAT) ? [...lead.caveats, DATE_FROM_SEARCH_CAVEAT] : lead.caveats,
      },
      sourceUrl,
      sourceKey: sourceKey(sourceUrl)!,
      identityKey: identityKey(lead),
      needText: `${lead.headline} ${lead.need_summary}`,
      score,
      heldReason: null,
    })
  }

  passing.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      Number(b.lead.intent === 'explicit_request') - Number(a.lead.intent === 'explicit_request') ||
      b.lead.published_date.localeCompare(a.lead.published_date),
  )

  const published: QualifiedLead[] = []
  const held: QualifiedLead[] = []
  const history: PriorOpportunity[] = [...ctx.prior]

  for (const candidate of passing) {
    const tokens = needTokens(candidate.needText)
    let duplicate: string | null = null
    let hold: string | null = null
    for (const prior of history) {
      if (prior.sourceKey === candidate.sourceKey) {
        duplicate = 'same source as an existing opportunity'
        break
      }
      const sim = similarity(tokens, needTokens(prior.needText))
      const sameIdentity = Boolean(candidate.identityKey) && prior.identityKey === candidate.identityKey
      if (sameIdentity && sim >= 0.5) {
        duplicate = 'same author/company and need as an existing opportunity'
        break
      }
      // Different buyers with similar needs are separate opportunities; cross-posts share an author/company.
      if (sameIdentity && sim >= 0.2) hold ??= 'same author/company with a possibly related need'
    }
    if (duplicate) {
      rejected.push({ headline: candidate.lead.headline, source_url: candidate.sourceUrl, reasons: [duplicate] })
      continue
    }
    history.push({ sourceKey: candidate.sourceKey, identityKey: candidate.identityKey, needText: candidate.needText })
    if (hold) {
      held.push({ ...candidate, heldReason: hold })
      continue
    }
    if (published.length >= MAX_PUBLISHED_PER_RUN) {
      rejected.push({ headline: candidate.lead.headline, source_url: candidate.sourceUrl, reasons: ['over the five-lead limit'] })
      continue
    }
    published.push(candidate)
  }

  return { published, held, rejected }
}
