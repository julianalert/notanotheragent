import { safeOutgoingUrl } from '../url'
import type { BusinessProfileT, CandidateT, EvidenceT, Focus, LeadT } from './contract'

/*
 * Deterministic qualification. The model proposes a decision for every candidate; these checks enforce what can
 * be checked mechanically (URLs, references, dates, audit presence, documented services, duplicates) and sort each
 * candidate into qualified, rejected or unresolved. Missing verification makes a candidate unresolved, not
 * rejected; missing optional enrichment (name, website, budget, role, email) never blocks it. Scores only rank.
 * Nothing here is independent verification of what a source says.
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

/** Two URLs point at the same post: same canonical URL or the same platform post/comment (e.g. Reddit .json). */
export function sameSource(a: string, b: string | null) {
  if (!b) return false
  const ka = sourceKey(a.replace(/\.json(?=$|\?)/i, ''))
  return ka !== null && ka === sourceKey(b.replace(/\.json(?=$|\?)/i, ''))
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

export function identityKey(lead: Pick<CandidateT, 'company_name' | 'public_handle' | 'person_name'>) {
  const raw = lead.company_name || lead.public_handle || lead.person_name || ''
  return norm(raw.replace(/^@/, ''))
}

const blank = (value: string | null | undefined) => !value || !value.trim()

/* --------------------------------- Dates ---------------------------------- */

/**
 * The model sometimes returns full timestamps (e.g. Reddit created_utc as "2026-09-14T14:46:34Z"). Keep the calendar
 * date as written; anything that isn't an ISO date or timestamp stays invalid.
 */
export function normalisePublishedDate(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/)
  return match && parseIsoDate(match[1]) ? match[1] : null
}

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
  if (blank(profile.acquisition_brief?.sells)) reasons.push('acquisition brief does not say what the business sells')
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

/* ------------------------------- Candidates ------------------------------- */

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

export type Score = { intent: number; service_fit: number; freshness: number; contactability: number; total: number }

export type QualifiedLead = {
  lead: LeadT
  sourceUrl: string
  sourceKey: string
  identityKey: string
  needText: string
  score: Score
}

export type Decision = 'published' | 'qualified_not_selected' | 'unresolved' | 'rejected'

/** Every candidate with the application's final decision, for diagnostics. */
export type CandidateOutcome = {
  headline: string
  source_url: string
  source_key: string | null
  decision: Decision
  model_decision: CandidateT['decision']
  reasons: string[]
  date_status: CandidateT['date_status']
  published_date: string | null
  score: Score
  candidate: CandidateT
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

/**
 * Match against one documented service, or against the documented services together when the model describes a
 * combination of them (e.g. "lead research with checked evidence and a drafted message"). Nothing outside the
 * documented services can match.
 */
export function matchesServices(services: string[], matched: string) {
  return serviceMatch(services, matched) === 'match'
}

/**
 * match: one documented service, or a combination of them (at least 3 shared terms and 40% of the claim).
 * unrelated: little or nothing in common with the documented services (reject).
 * unclear: partly documented wording; a verification issue, not proof the service was invented.
 */
export function serviceMatch(services: string[], matched: string): 'match' | 'unclear' | 'unrelated' {
  if (services.some((service) => sameService(service, matched))) return 'match'
  const claimed = serviceStems(matched)
  if (!claimed.size) return 'unrelated'
  const documented = new Set(services.flatMap((service) => [...serviceStems(service)]))
  let shared = 0
  for (const stem of claimed) if (documented.has(stem)) shared++
  const ratio = shared / claimed.size
  if (shared >= 3 && ratio >= 0.4) return 'match'
  return ratio >= 0.25 && shared >= 1 ? 'unclear' : 'unrelated'
}

export const DATE_FROM_SEARCH_CAVEAT = 'The publication date comes from search results for this post, not from the page itself.'
export const RELATIVE_DATE_CAVEAT = 'The page shows a relative date; the publication date is approximate.'
export const DATE_UNKNOWN_CAVEAT = 'The page does not show when this was posted; check it is still current before reaching out.'
export const FROM_LISTING_CAVEAT = 'Read from the community’s list of posts; the post page itself was not opened.'
export const MODEL_DOUBT_CAVEAT = 'Worth checking before reaching out:'

const LISTING_SUFFIX = /\/(new|hot|top|rising|latest|search|recent|popular)(\/.*)?$/i

/**
 * Whether a community listing opened in this run (a subreddit or forum section, possibly its "new" or search
 * view) contains the source's path, so the post was plausibly read from that list. Same host, and the listing
 * path must be a real section (never a site's home page).
 */
export function listedOnOpenedPage(sourceUrl: string, auditUrls: string[]) {
  let source: URL
  try {
    source = new URL(sourceUrl)
  } catch {
    return false
  }
  const host = (value: URL) => value.hostname.toLowerCase().replace(/^(www|old|new|m|np)\./, '')
  const community = (path: string) => {
    const reddit = path.match(/^\/r\/([^/]+)/i)
    return reddit ? `/r/${reddit[1].toLowerCase()}` : path.replace(LISTING_SUFFIX, '').replace(/\/+$/, '').toLowerCase()
  }
  const sourcePath = source.pathname.toLowerCase()
  return auditUrls.some((audited) => {
    let page: URL
    try {
      page = new URL(audited)
    } catch {
      return false
    }
    if (host(page) !== host(source) || /\/comments\//i.test(page.pathname)) return false
    const section = community(page.pathname)
    return section.length > 1 && sourcePath.startsWith(`${section}/`)
  })
}

/**
 * Quote budget: at most 25 quoted words per original source. Need quotes are kept first; later quotes that would
 * exceed the budget lose their excerpt but keep their paraphrase and link. A single need quote longer than the
 * budget is cut at a word boundary with an ellipsis.
 */
export function applyQuoteBudget<T extends Pick<CandidateT, 'evidence' | 'need_evidence_ids'>>(lead: T): T {
  const needIds = new Set(lead.need_evidence_ids)
  const ordered = [...lead.evidence.filter((item) => needIds.has(item.id)), ...lead.evidence.filter((item) => !needIds.has(item.id))]
  const used = new Map<string, number>()
  const changed = new Map<string, EvidenceT>()
  for (const item of ordered) {
    const key = sourceKey(item.url.replace(/\.json(?=$|\?)/i, '')) ?? item.url
    const words = wordCount(item.excerpt)
    if (!words) continue
    const already = used.get(key) ?? 0
    if (already + words <= MAX_EXCERPT_WORDS_PER_SOURCE) {
      used.set(key, already + words)
    } else if (already === 0 && needIds.has(item.id)) {
      const cut = item.excerpt.trim().split(/\s+/).slice(0, MAX_EXCERPT_WORDS_PER_SOURCE).join(' ')
      changed.set(item.id, { ...item, excerpt: `${cut}…` })
      used.set(key, MAX_EXCERPT_WORDS_PER_SOURCE)
    } else {
      changed.set(item.id, { ...item, excerpt: '' })
    }
  }
  if (!changed.size) return lead
  return { ...lead, evidence: lead.evidence.map((item) => changed.get(item.id) ?? item) }
}

type Check = { rejected: string[]; unresolved: string[]; caveats: string[]; clean: CandidateT; sourceUrl: string | null; score: Score; foundOn: string }

/**
 * Checks one candidate. Hard failures reject (invalid source, undocumented service, outside the window, closed,
 * or a model rejection); verification gaps leave it unresolved (identity, evidence, audit, contact route). An
 * unknown date, a post read from a community listing, or the model's own doubts are published with caveats.
 */
export function checkCandidate(original: CandidateT, ctx: GateContext, auditKeys: Set<string | null>): Check {
  const rejected: string[] = []
  const unresolved: string[] = []
  const caveats: string[] = []

  const normalisedDate = normalisePublishedDate(original.published_date)
  let candidate: CandidateT = applyQuoteBudget({ ...original, published_date: normalisedDate })

  const evidence = new Map<string, EvidenceT>()
  for (const item of candidate.evidence) {
    evidence.set(item.id, item)
    if (!safeOutgoingUrl(item.url)) unresolved.push(`evidence ${item.id} has an invalid URL`)
  }
  const resolves = (ids: string[]) => ids.length > 0 && ids.every((id) => evidence.has(id))

  // Model decision first: its rejections stand. Its doubts don't block on their own: when every check below
  // passes, the candidate is published with the doubts shown, ranked after candidates the model qualified.
  if (candidate.decision === 'rejected') rejected.push(...(candidate.decision_reasons.length ? candidate.decision_reasons : ['rejected by research']))
  if (candidate.decision === 'unresolved') {
    const doubts = candidate.missing_info.length ? candidate.missing_info : candidate.decision_reasons
    caveats.push(doubts.length ? `${MODEL_DOUBT_CAVEAT} ${doubts.join('; ')}` : MODEL_DOUBT_CAVEAT)
  }

  // Source: opened in this run, or listed on a community page opened in this run (e.g. a subreddit's new posts).
  const sourceUrl = safeOutgoingUrl(candidate.source_url)
  if (!sourceUrl) rejected.push('source URL is not a public http(s) URL')
  else if (!auditKeysFor(sourceUrl).some((key) => auditKeys.has(key))) {
    if (listedOnOpenedPage(sourceUrl, ctx.auditUrls)) caveats.push(FROM_LISTING_CAVEAT)
    else unresolved.push('source not found in the search tool audit — needs verification')
  }

  // Identity: a public handle is enough; unsupported company or person names are removed, not fatal.
  if (blank(candidate.person_name) && blank(candidate.company_name) && blank(candidate.public_handle)) {
    unresolved.push('author identity not public')
  }
  const identityItems = candidate.identity_evidence_ids.map((id) => evidence.get(id)).filter(Boolean) as EvidenceT[]
  const identityFromOriginal = identityItems.some((item) => item.inspected_original && sameSource(item.url, sourceUrl))
  if (!blank(candidate.company_name) && !mentionedIn(candidate.company_name!, identityItems, candidate.company_website ? [hostOf(candidate.company_website) ?? ''] : [])) {
    caveats.push(`Company "${candidate.company_name}" was removed: not supported by the source.`)
    candidate = { ...candidate, company_name: null, company_website: null }
  }
  if (!blank(candidate.person_name) && !mentionedIn(candidate.person_name!, identityItems)) {
    caveats.push('Name was removed: not supported by the source.')
    candidate = { ...candidate, person_name: null }
  }
  if (!blank(candidate.public_handle) && !identityFromOriginal && !mentionedIn(candidate.public_handle!, identityItems)) {
    unresolved.push('author handle not confirmed on the original page')
  }
  if (blank(candidate.buyer_match)) unresolved.push('no explanation of why the author is a buyer')

  // Need evidence: inspectable, from the original source.
  if (blank(candidate.need_summary)) unresolved.push('need not described')
  if (!resolves(candidate.need_evidence_ids)) unresolved.push('need evidence references do not resolve')
  const needItems = candidate.need_evidence_ids.map((id) => evidence.get(id)).filter(Boolean) as EvidenceT[]
  if (!needItems.some((item) => !blank(item.excerpt) || !blank(item.paraphrase))) unresolved.push('no inspectable need evidence')
  if (sourceUrl && !needItems.some((item) => item.inspected_original && sameSource(item.url, sourceUrl))) {
    unresolved.push('original source not reported inspected')
  }

  // Publication date.
  const today = parseIsoDate(ctx.now.toISOString().slice(0, 10))!
  const published = parseIsoDate(normalisedDate)
  if (candidate.date_status === 'unknown' || !published) {
    // The research rejects pages that look old or closed; an undated page is published with the gap shown.
    candidate = { ...candidate, date_status: 'unknown', published_date: null }
    caveats.push(DATE_UNKNOWN_CAVEAT)
  } else {
    if (published.getTime() > today.getTime() + DAY_MS) rejected.push('publication date is in the future')
    if (published.getTime() < parseIsoDate(ctx.publishedOnOrAfter)!.getTime()) rejected.push('published before the date window')
    const dateItems = candidate.date_evidence_ids.map((id) => evidence.get(id)).filter(Boolean) as EvidenceT[]
    if (candidate.date_evidence_ids.length && dateItems.length && !dateItems.some((item) => sameSource(item.url, sourceUrl))) {
      unresolved.push('publication date evidence is from a different page')
    }
    if (candidate.date_status === 'search_result') caveats.push(DATE_FROM_SEARCH_CAVEAT)
    if (candidate.date_status === 'relative') caveats.push(candidate.date_note ? `${RELATIVE_DATE_CAVEAT} ${candidate.date_note}` : RELATIVE_DATE_CAVEAT)
  }

  // Terms: an explicit past deadline means the request is closed.
  const deadlineDate = candidate.deadline?.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
  if (deadlineDate && parseIsoDate(deadlineDate) && parseIsoDate(deadlineDate)!.getTime() < today.getTime()) {
    rejected.push('deadline has passed')
  }
  if (!blank(candidate.budget) && !resolves(candidate.terms_evidence_ids)) {
    caveats.push('Budget was removed: not supported by the source.')
    candidate = { ...candidate, budget: null }
  }

  // Contact route.
  if (candidate.contact_route.kind === 'none' || !safeOutgoingUrl(candidate.contact_route.url)) {
    unresolved.push('no usable public contact route')
  }

  // Documented service or documented problem solved (and focus). A trigger signal such as hiring for the role the
  // offer replaces is matched through the problem the offer solves, never through the job title.
  const profileServices = ctx.profile.services.map((service) => service.value)
  const documented = [...profileServices, ...ctx.profile.problems_solved.map((problem) => problem.value)]
  const serviceFit = serviceMatch(documented, candidate.matched_service)
  if (serviceFit === 'unrelated') rejected.push('need is not addressed by a documented service')
  else if (serviceFit === 'unclear') unresolved.push('matched service only partly matches the documented services')
  else if (ctx.focus?.services.length && !matchesServices(ctx.focus.services, candidate.matched_service)) {
    rejected.push('outside the selected focus')
  }
  if (blank(candidate.fit_explanation)) unresolved.push('fit not explained')

  // Scores rank; they never gate. Clamp to the rubric and recompute freshness from the date.
  const clamp = (value: number, max: number) => (Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0)
  const score = {
    intent: clamp(candidate.score.intent, 3),
    service_fit: clamp(candidate.score.service_fit, 3),
    freshness: candidate.published_date ? freshnessFor(candidate.published_date, ctx.now) : 0,
    contactability: clamp(candidate.score.contactability, 2),
    total: 0,
  }
  score.total = score.intent + score.service_fit + score.freshness + score.contactability

  return { rejected, unresolved, caveats, clean: candidate, sourceUrl, score, foundOn: ctx.now.toISOString().slice(0, 10) }
}

/**
 * Sort every candidate into published (best qualified, up to five), qualified_not_selected, unresolved or
 * rejected, deduplicating against earlier opportunities and within the batch.
 */
export function qualifyCandidates(candidates: CandidateT[], ctx: GateContext) {
  const auditKeys = new Set<string | null>(ctx.auditUrls.flatMap(auditKeysFor))
  const outcomes: CandidateOutcome[] = []
  const passing: Array<{ check: Check; key: string; identity: string; needText: string }> = []

  for (const candidate of candidates) {
    const check = checkCandidate(candidate, ctx, auditKeys)
    const key = check.sourceUrl ? sourceKey(check.sourceUrl) : null
    const base = {
      headline: candidate.headline,
      source_url: candidate.source_url,
      source_key: key,
      model_decision: candidate.decision,
      date_status: check.clean.date_status,
      published_date: check.clean.published_date,
      score: check.score,
      candidate: check.clean,
    }
    if (check.rejected.length) {
      outcomes.push({ ...base, decision: 'rejected', reasons: [...check.rejected, ...check.unresolved] })
      continue
    }
    if (check.unresolved.length || !key) {
      outcomes.push({ ...base, decision: 'unresolved', reasons: check.unresolved.length ? check.unresolved : ['source could not be identified'] })
      continue
    }
    passing.push({ check, key, identity: identityKey(check.clean), needText: `${check.clean.headline} ${check.clean.need_summary}` })
  }

  // Unresolved candidates also claim their source, so a later duplicate isn't published from another URL.
  const history: PriorOpportunity[] = [...ctx.prior]
  const seenUnresolved = new Set(outcomes.filter((o) => o.decision === 'unresolved' && o.source_key).map((o) => o.source_key!))

  passing.sort(
    (a, b) =>
      Number(b.check.clean.decision === 'qualified') - Number(a.check.clean.decision === 'qualified') ||
      b.check.score.total - a.check.score.total ||
      Number(b.check.clean.intent === 'explicit_request') - Number(a.check.clean.intent === 'explicit_request') ||
      (b.check.clean.published_date ?? '').localeCompare(a.check.clean.published_date ?? ''),
  )

  const published: QualifiedLead[] = []
  for (const item of passing) {
    const { check, key, identity, needText } = item
    const base = {
      headline: check.clean.headline,
      source_url: check.clean.source_url,
      source_key: key,
      model_decision: check.clean.decision,
      date_status: check.clean.date_status,
      published_date: check.clean.published_date,
      score: check.score,
      candidate: check.clean,
    }
    const tokens = needTokens(needText)
    const duplicate = history.find((prior) => {
      const needOverlap = similarity(tokens, needTokens(prior.needText))
      const sameAuthor = !identity || !prior.identityKey || prior.identityKey === identity
      // Same page: a duplicate unless a different author states a different need (e.g. a reply under the thread).
      if (prior.sourceKey === key) return sameAuthor || needOverlap >= 0.3
      return Boolean(identity) && prior.identityKey === identity && needOverlap >= 0.5
    })
    if (duplicate || seenUnresolved.has(key)) {
      outcomes.push({ ...base, decision: 'rejected', reasons: ['duplicate of an existing opportunity'] })
      continue
    }
    history.push({ sourceKey: key, identityKey: identity, needText })
    if (published.length >= MAX_PUBLISHED_PER_RUN) {
      outcomes.push({ ...base, decision: 'qualified_not_selected', reasons: ['qualified but outside the top five'] })
      continue
    }
    const lead = toLead(check)
    published.push({ lead, sourceUrl: check.sourceUrl!, sourceKey: key, identityKey: identity, needText, score: check.score })
    outcomes.push({ ...base, decision: 'published', reasons: [] })
  }

  const count = (decision: Decision) => outcomes.filter((o) => o.decision === decision).length
  return {
    published,
    outcomes,
    counts: {
      discovered: candidates.length,
      published: published.length,
      qualified_not_selected: count('qualified_not_selected'),
      unresolved: count('unresolved'),
      rejected: count('rejected'),
    },
  }
}

function toLead(check: Check): LeadT {
  const c = check.clean
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { decision, decision_reasons, missing_info, access_limitations, ...rest } = c
  const caveats = [...c.caveats, ...check.caveats.filter((caveat) => !c.caveats.includes(caveat))]
  return {
    ...rest,
    source_url: check.sourceUrl!,
    // Undated pages (date_status "unknown") carry the day they were found, which the page shows as "date not shown".
    published_date: c.published_date ?? check.foundOn,
    company_website: c.company_website ? safeOutgoingUrl(c.company_website) : null,
    contact_route: {
      url: safeOutgoingUrl(c.contact_route.url)!,
      kind: c.contact_route.kind as 'original_post' | 'public_profile' | 'business_contact',
      explanation: c.contact_route.explanation,
      evidence_ids: c.contact_route.evidence_ids,
    },
    score: { intent: check.score.intent, service_fit: check.score.service_fit, freshness: check.score.freshness, contactability: check.score.contactability },
    caveats,
  }
}

/* ------------------------------- Follow-up -------------------------------- */

/**
 * At most one follow-up per run, only after a completed initial or daily run with at most one published lead,
 * when the research itself calls a follow-up worthwhile and names a concrete next step, and only while research
 * is open. A follow-up is a full research request, so it is reserved for runs that came up nearly empty.
 */
export function followUpDecision(args: {
  /** AUTOMATIC_FOLLOW_UPS */
  enabled: boolean
  kind: 'initial' | 'daily' | 'follow_up' | 'watch'
  researchStatus: string
  published: number
  unresolved: number
  untriedAngles: string[]
  worthwhile: boolean
  researchOpen: boolean
}): { run: boolean; reason: string } {
  if (!args.enabled) return { run: false, reason: 'automatic follow-ups are disabled' }
  if (args.kind === 'follow_up') return { run: false, reason: 'follow-ups never chain' }
  if (!args.researchOpen) return { run: false, reason: 'research period ended' }
  if (args.researchStatus === 'website_unreadable' || args.researchStatus === 'unsupported_business') {
    return { run: false, reason: `research status ${args.researchStatus}` }
  }
  if (args.published >= 2) return { run: false, reason: 'two or more leads already published' }
  if (!args.untriedAngles.length && !args.unresolved) return { run: false, reason: 'no untried angles or unresolved candidates' }
  if (!args.worthwhile) return { run: false, reason: 'research reported no plausible next step' }
  return {
    run: true,
    reason: `${args.published} published; ${args.unresolved} unresolved candidate(s) and ${args.untriedAngles.length} untried angle(s)`,
  }
}
