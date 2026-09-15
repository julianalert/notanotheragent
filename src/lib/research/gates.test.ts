import { describe, expect, it } from 'vitest'
import { ResearchResult, type BusinessProfileT, type CandidateT } from './contract'
import {
  applyQuoteBudget,
  canonicalUrl,
  DATE_FROM_SEARCH_CAVEAT,
  DATE_UNKNOWN_CAVEAT,
  FROM_LISTING_CAVEAT,
  listedOnOpenedPage,
  followUpDecision,
  freshnessFor,
  isResearchOpen,
  matchesServices,
  normalisePublishedDate,
  qualifyCandidates,
  sameService,
  sourceKey,
  validateProfile,
  type GateContext,
  type PriorOpportunity,
} from './gates'
import { buildResearchInput, lintQuery, publishedOnOrAfter, SYSTEM_PROMPT, WEBSITE_LANGUAGE } from './prompt'

/*
 * Qualification fixtures. All data is fictional. Semantic judgements (is this author our buyer? is this a seller?)
 * are made by the research model and expressed here as its decision; these tests prove how the application treats
 * those decisions, and that structural problems make a candidate unresolved or rejected instead of vanishing.
 */

const NOW = new Date('2026-09-15T10:00:00Z')
const WINDOW = '2026-08-16'

/** A generic software business that sells lead research to agencies (shaped like the regression website). */
const WEBSITE = 'https://leadsoftware.example-saas.com'
const profile: BusinessProfileT = {
  name: 'Lead software',
  website_url: WEBSITE,
  summary: 'Public-web lead research for agencies.',
  services: [
    { value: 'Daily public-web lead research for agencies with evidence for each opportunity', basis: 'stated', evidence_ids: ['p1'] },
    { value: 'First-message drafting for agency owners', basis: 'stated', evidence_ids: ['p1'] },
  ],
  customer_types: [{ value: 'Agency owners', basis: 'stated', evidence_ids: ['p1'] }],
  problems_solved: [],
  markets: [{ value: 'English-speaking markets', basis: 'inferred', evidence_ids: ['p1'] }],
  languages: [{ value: 'English', basis: 'stated', evidence_ids: ['p1'] }],
  proof_points: [],
  pricing: null,
  exclusions: [],
  acquisition_brief: {
    sells: 'Lead research software that finds public buying signals for agencies.',
    buyers: ['Agency owners and service-business operators who need new clients'],
    recognise_buyer_in_posts: ['Author runs an agency, studio or freelance service business'],
    buyer_problems_in_their_words: ['referrals dried up', 'cold outreach gets no replies', 'prospecting takes all my time'],
    trigger_situations: ['Pipeline empty after a big client left'],
    explicit_requests: ['how do you find clients', 'recommend a lead source for my agency'],
    not_our_buyer: ['Businesses hiring an agency (they are the agency’s prospects, not ours)'],
    buyer_seller_confusions: ['Agencies advertising their own lead generation services'],
    geography: { value: null, basis: 'unknown' },
    languages: { value: 'English', basis: 'stated' },
  },
  evidence: [
    { id: 'p1', url: `${WEBSITE}/`, title: 'Home', inspected_original: true, excerpt: 'Leads for agencies', paraphrase: 'Lead research for agencies.' },
  ],
  uncertainties: [],
}

let counter = 0
function makeCandidate(overrides: Partial<CandidateT> = {}): CandidateT {
  counter++
  const url = overrides.source_url ?? `https://forum.example.org/threads/${counter}`
  return {
    headline: `Agency owner needs new clients ${counter}`,
    person_name: null,
    company_name: null,
    public_handle: `u/agency_owner_${counter}`,
    role: null,
    company_website: null,
    location: null,
    identity_evidence_ids: ['e1'],
    buyer_match: 'The author says they run a small marketing agency.',
    source_url: url,
    source_platform: 'Forum',
    published_date: '2026-09-13',
    date_status: 'exact',
    date_note: null,
    date_evidence_ids: ['e1'],
    need_summary: `Referrals slowed down and they don't know how to find new clients (${counter})`,
    need_evidence_ids: ['e1'],
    intent: 'stated_problem',
    matched_service: 'Daily public-web lead research for agencies',
    fit_explanation: 'They describe an empty pipeline; the product finds public buying signals for agencies.',
    fit_is_inferred: true,
    budget: null,
    deadline: null,
    terms_evidence_ids: [],
    contact_route: { url, kind: 'original_post', explanation: 'Reply on the post', evidence_ids: ['e1'] },
    outreach_angle: 'Offer to share where their buyers are asking publicly.',
    outreach_language: 'en',
    outreach_message: 'Hi — saw your post about referrals slowing down…',
    score: { intent: 2, service_fit: 3, freshness: 2, contactability: 2 },
    evidence: [
      {
        id: 'e1',
        url,
        title: `Post by u/agency_owner_${counter}`,
        inspected_original: true,
        excerpt: 'Referrals used to keep us busy but the last three months have been dead',
        paraphrase: 'Their agency relied on referrals, which have dried up.',
      },
    ],
    caveats: [],
    decision: 'qualified',
    decision_reasons: [],
    missing_info: [],
    access_limitations: [],
    ...overrides,
  }
}

function ctx(candidates: CandidateT[], extra: Partial<GateContext> = {}): GateContext {
  return { now: NOW, publishedOnOrAfter: WINDOW, auditUrls: candidates.map((c) => c.source_url), profile, focus: null, prior: [], ...extra }
}
const run = (candidates: CandidateT[], extra: Partial<GateContext> = {}) => qualifyCandidates(candidates, ctx(candidates, extra))
const decisionOf = (candidates: CandidateT[], extra: Partial<GateContext> = {}) => run(candidates, extra).outcomes[0]

describe('required regression cases', () => {
  it('1. agency owner with slow referrals: publishable stated problem, no product category named', () => {
    const outcome = decisionOf([makeCandidate()])
    expect(outcome.decision).toBe('published')
    expect(outcome.candidate.intent).toBe('stated_problem')
  })

  it('2. a non-agency business hiring an agency is not automatically our customer', () => {
    const hiring = makeCandidate({
      headline: 'Dental clinic looking for a marketing agency',
      intent: 'explicit_request',
      buyer_match: '',
      decision: 'rejected',
      decision_reasons: ["wrong customer type: a business hiring an agency is the agency's prospect, not ours"],
    })
    const outcome = decisionOf([hiring])
    expect(outcome.decision).toBe('rejected')
    expect(outcome.reasons.join(' ')).toMatch(/wrong customer type/)
    // Even if the model marked it qualified, a missing buyer match can't be published.
    expect(decisionOf([{ ...hiring, decision: 'qualified', decision_reasons: [] }]).decision).toBe('unresolved')
    expect(SYSTEM_PROMPT).toMatch(/customer from that customer's customer/)
  })

  it('3. a recent relevant post without literal month or year words qualifies, and queries must not add them', () => {
    expect(decisionOf([makeCandidate({ headline: 'How do you guys find clients for a small web studio?', published_date: '2026-09-12' })]).decision).toBe('published')
    expect(lintQuery('"struggling to get clients" "agency" "September" "2026"')).toEqual(
      expect.arrayContaining(['month name', 'literal year', '4 stacked exact phrases']),
    )
    expect(lintQuery('agency owner struggling to get clients')).toEqual([])
    expect(SYSTEM_PROMPT).toMatch(/Do not add literal month names, years/)
  })

  it('4. an agency promoting its own services is rejected', () => {
    const outcome = decisionOf([makeCandidate({ decision: 'rejected', decision_reasons: ['seller promoting their own lead generation services'] })])
    expect(outcome.decision).toBe('rejected')
  })

  it('5. a public handle with no email, name, company, website, budget or role is enough', () => {
    const outcome = decisionOf([makeCandidate({ person_name: null, company_name: null, company_website: null, role: null, budget: null })])
    expect(outcome.decision).toBe('published')
  })

  it('6. a closed request is rejected', () => {
    expect(decisionOf([makeCandidate({ decision: 'rejected', decision_reasons: ['request marked filled'] })]).decision).toBe('rejected')
    expect(decisionOf([makeCandidate({ intent: 'explicit_request', deadline: 'Proposals due 2026-09-01', terms_evidence_ids: ['e1'] })]).reasons).toContain('deadline has passed')
  })

  it('7. the same post with different tracking parameters is deduplicated', () => {
    const original = makeCandidate({ source_url: 'https://forum.example.org/t/Need-Clients?id=42&utm_source=a' })
    const tracked = makeCandidate({ source_url: 'https://forum.example.org/t/Need-Clients?utm_medium=b&id=42&fbclid=x' })
    expect(sourceKey(tracked.source_url)).toBe(sourceKey(original.source_url))
    const result = run([original, tracked], { auditUrls: [original.source_url, tracked.source_url] })
    expect(result.counts.published).toBe(1)
    expect(result.outcomes.find((o) => o.decision === 'rejected')!.reasons).toContain('duplicate of an existing opportunity')
  })

  it('8. an undated candidate is kept, never presented as fresh (published with the missing date shown)', () => {
    const result = run([makeCandidate({ published_date: null, date_status: 'unknown', date_evidence_ids: [] })])
    expect(result.outcomes[0].decision).toBe('published')
    const lead = result.published[0].lead
    expect(lead.date_status).toBe('unknown')
    expect(lead.caveats).toContain(DATE_UNKNOWN_CAVEAT)
    expect(result.published[0].score.freshness).toBe(0)
  })

  it('9. a search started at or after the 14-day deadline is blocked, including follow-ups', () => {
    const endsAt = new Date('2026-09-28T10:00:00Z')
    expect(isResearchOpen(new Date(endsAt.getTime() - 1), endsAt)).toBe(true)
    expect(isResearchOpen(endsAt, endsAt)).toBe(false)
    expect(isResearchOpen(new Date(endsAt.getTime() + 1), endsAt)).toBe(false)
    const decision = followUpDecision({
      enabled: true,
      kind: 'initial',
      researchStatus: 'complete',
      published: 0,
      unresolved: 2,
      untriedAngles: ['x'],
      worthwhile: true,
      researchOpen: isResearchOpen(endsAt, endsAt),
    })
    expect(decision).toEqual({ run: false, reason: 'research period ended' })
  })
})

describe('qualification rules', () => {
  it('keeps every candidate with a decision and reasons', () => {
    const result = run([
      makeCandidate(),
      makeCandidate({ published_date: '2024-01-01' }),
      makeCandidate({ published_date: null, date_status: 'unknown' }),
      makeCandidate({ decision: 'rejected', decision_reasons: ['seller'] }),
    ])
    expect(result.counts).toMatchObject({ discovered: 4, published: 2, unresolved: 0, rejected: 2 })
    expect(result.outcomes.every((o) => o.decision === 'published' || o.reasons.length > 0)).toBe(true)
  })

  it('scores rank but never gate', () => {
    const lowScore = makeCandidate({ score: { intent: 1, service_fit: 1, freshness: 0, contactability: 0 } })
    expect(decisionOf([lowScore]).decision).toBe('published')
    const strong = makeCandidate({ intent: 'explicit_request', score: { intent: 3, service_fit: 3, freshness: 2, contactability: 2 } })
    expect(run([lowScore, strong]).published[0].lead.headline).toBe(strong.headline)
  })

  it('publishes a model "unresolved" whose doubts are only missing details, after qualified ones, with the doubts shown', () => {
    const doubtful = makeCandidate({ decision: 'unresolved', decision_reasons: ['fit unclear'], missing_info: ['follower count not stated'], score: { intent: 3, service_fit: 3, freshness: 2, contactability: 2 } })
    const qualified = makeCandidate({ score: { intent: 1, service_fit: 1, freshness: 2, contactability: 1 } })
    const result = run([doubtful, qualified])
    expect(result.counts.published).toBe(2)
    expect(result.published[0].lead.headline).toBe(qualified.headline)
    expect(result.published[1].lead.caveats.join(' ')).toContain('follower count not stated')
  })

  it('a post read from a community listing opened in the run is published with a caveat', () => {
    const url = 'https://www.reddit.com/r/InstagramMarketing/comments/1wflrx8/would_love_to_know_more_info_about_the_carousel/'
    const listing = 'https://www.reddit.com/r/InstagramMarketing/new/?after=abc&sort=new'
    const outcome = decisionOf([makeCandidate({ source_url: url })], { auditUrls: [listing] })
    expect(outcome.decision).toBe('published')
    expect(run([makeCandidate({ source_url: url })], { auditUrls: [listing] }).published[0].lead.caveats).toContain(FROM_LISTING_CAVEAT)
    expect(listedOnOpenedPage(url, ['https://www.reddit.com/r/Entrepreneur/new/'])).toBe(false)
    expect(listedOnOpenedPage(url, ['https://www.reddit.com/'])).toBe(false)
    expect(listedOnOpenedPage(url, ['https://www.reddit.com/r/InstagramMarketing/comments/1other/x/'])).toBe(false)
    expect(listedOnOpenedPage('https://forum.example.org/c/general/t/123', ['https://forum.example.org/c/general/latest'])).toBe(true)
  })

  it('a missing audit match is a verification issue, not proof of fabrication', () => {
    const outcome = decisionOf([makeCandidate()], { auditUrls: [] })
    expect(outcome.decision).toBe('unresolved')
    expect(outcome.reasons.join(' ')).toMatch(/needs verification/)
  })

  it('removes unsupported company names instead of rejecting a handle-only lead', () => {
    const result = run([makeCandidate({ company_name: 'Bouygues Construction' })])
    expect(result.outcomes[0].decision).toBe('published')
    expect(result.published[0].lead.company_name).toBeNull()
    expect(result.published[0].lead.caveats.join(' ')).toMatch(/removed/)
  })

  it('rejects a need that no documented service addresses', () => {
    expect(decisionOf([makeCandidate({ matched_service: 'Paid ads management for ecommerce brands' })]).reasons).toContain(
      'need is not addressed by a documented service',
    )
  })

  it('rejects posts older than the window and future dates', () => {
    expect(decisionOf([makeCandidate({ published_date: '2026-06-01' })]).reasons).toContain('published before the date window')
    expect(decisionOf([makeCandidate({ published_date: '2026-09-30' })]).reasons).toContain('publication date is in the future')
  })

  it('accepts relative and search-result dates for the same post, with caveats', () => {
    const relative = run([makeCandidate({ date_status: 'relative', date_note: 'Page shows "Posted 2 days ago".' })]).published[0]
    expect(relative.lead.caveats.join(' ')).toMatch(/approximate/)
    expect(run([makeCandidate({ date_status: 'search_result' })]).published[0].lead.caveats).toContain(DATE_FROM_SEARCH_CAVEAT)
  })

  it('a candidate without a usable contact route stays unresolved', () => {
    const outcome = decisionOf([makeCandidate({ contact_route: { url: null, kind: 'none', explanation: '', evidence_ids: [] } })])
    expect(outcome.decision).toBe('unresolved')
    expect(outcome.reasons).toContain('no usable public contact route')
  })

  it('publishes at most five and keeps the rest as qualified_not_selected', () => {
    const result = run(Array.from({ length: 7 }, () => makeCandidate()))
    expect(result.counts.published).toBe(5)
    expect(result.counts.qualified_not_selected).toBe(2)
  })

  it('does not republish an existing opportunity', () => {
    const candidate = makeCandidate()
    const prior: PriorOpportunity[] = [
      { sourceKey: sourceKey(candidate.source_url)!, identityKey: 'someone else', needText: `${candidate.headline} ${candidate.need_summary}` },
    ]
    expect(decisionOf([candidate], { prior }).reasons).toContain('duplicate of an existing opportunity')
  })

  it('a different author with a different need under the same thread URL is a separate opportunity', () => {
    const url = 'https://www.reddit.com/r/agencynewbies/comments/1waokqa/agency_owners_how_hard_was_it_to_land_your_first/'
    const post = makeCandidate({ source_url: url, headline: 'Agency owners, how hard was it to land your first client?' })
    const reply = makeCandidate({
      source_url: url,
      headline: 'Looking for the first client for an email marketing agency',
      need_summary: 'Started an email marketing agency and still has no paying customer',
    })
    expect(run([post, reply]).counts.published).toBe(2)
  })
})

describe('regressions from production runs', () => {
  it('Reddit post read via .json, full timestamp and combined service name (notanotheragent.com)', () => {
    const url = 'https://www.reddit.com/r/agencynewbies/comments/1w6xmv1/how_to_get_clients/'
    const candidate = makeCandidate({
      source_url: url,
      published_date: '2026-09-04T07:39:24Z',
      matched_service: 'Public-web lead research for agencies with evidence and a drafted first message',
      evidence: [
        {
          id: 'e1',
          url: `${url}.json`,
          title: 'How to get clients?',
          inspected_original: true,
          excerpt: 'tried cold mailing them but it takes lot of time',
          paraphrase: 'Cold email takes a lot of time.',
        },
      ],
    })
    const outcome = decisionOf([candidate])
    expect(outcome.decision).toBe('published')
    expect(outcome.published_date).toBe('2026-09-04')
  })

  it('comment permalink corroborated by its opened thread', () => {
    const thread = 'https://www.reddit.com/r/EntreprendreenFrance/comments/1vzmgp9/comment_aller_parler/'
    const comment = `${thread}p68z68b/`
    expect(decisionOf([makeCandidate({ source_url: comment })], { auditUrls: [thread] }).decision).toBe('published')
    expect(sourceKey(comment)).toBe('reddit:1vzmgp9:p68z68b')
  })

  it('Upwork post with "Posted last week" and a handle (yuzuu.co) is publishable with an approximate date', () => {
    const url = 'https://www.upwork.com/freelance-jobs/apply/Digital-Product-Creator-and-Website-Designer_~022094130572130231659/'
    const candidate = makeCandidate({
      source_url: url,
      public_handle: '@ThatFlippingAgent',
      intent: 'explicit_request',
      published_date: '2026-09-08',
      date_status: 'relative',
      date_note: 'Page shows "Posted last week" on 2026-09-15.',
      evidence: [
        {
          id: 'e1',
          url,
          title: 'Digital Product Creator and Website Designer',
          inspected_original: true,
          excerpt:
            'content creator (@ThatFlippingAgent) seeking help launching a polished digital course /product and website for my personal brand. I already have a strong social media audience',
          paraphrase: 'Creator with an audience wants a digital product built.',
        },
      ],
    })
    const outcome = decisionOf([candidate])
    expect(outcome.decision).toBe('published')
    const words = outcome.candidate.evidence.reduce((sum, item) => sum + item.excerpt.split(/\s+/).filter(Boolean).length, 0)
    expect(words).toBeLessThanOrEqual(25)
  })

  it('an anonymous marketplace client stays unresolved, not silently dropped', () => {
    const outcome = decisionOf([makeCandidate({ public_handle: null, person_name: null, company_name: null })])
    expect(outcome.decision).toBe('unresolved')
    expect(outcome.reasons).toContain('author identity not public')
  })
})

describe('helpers', () => {
  it('canonical URLs keep case-sensitive paths and content query parameters', () => {
    expect(canonicalUrl('https://Example.org/Post/AbC?id=7&utm_medium=x')).toBe('example.org/Post/AbC?id=7')
    expect(canonicalUrl('https://example.org/post/abc?id=8')).not.toBe(canonicalUrl('https://example.org/post/abc?id=7'))
  })

  it('normalises timestamps but not free text', () => {
    expect(normalisePublishedDate('2026-09-14T14:46:34Z')).toBe('2026-09-14')
    expect(normalisePublishedDate('5 days ago')).toBeNull()
  })

  it('freshness is recomputed server-side', () => {
    expect(freshnessFor('2026-09-08', NOW)).toBe(2)
    expect(freshnessFor('2026-08-20', NOW)).toBe(1)
  })

  it('matches paraphrased and combined documented services only', () => {
    expect(sameService('Automatisation des devis et base de prix à partir des factures', 'Automatisation IA des devis à partir des factures existantes')).toBe(true)
    expect(sameService('Website design', 'Conversion rate optimisation')).toBe(false)
    const services = profile.services.map((s) => s.value)
    expect(matchesServices(services, 'Public-web lead research for agencies with a drafted first message')).toBe(true)
    expect(matchesServices(services, 'Bookkeeping for restaurants')).toBe(false)
  })

  it('quote budget keeps need quotes first and trims the rest', () => {
    const budgeted = applyQuoteBudget({
      need_evidence_ids: ['e2'],
      evidence: [
        { id: 'e1', url: 'https://x.example.org/p', title: 't', inspected_original: true, excerpt: Array(20).fill('id').join(' '), paraphrase: 'identity' },
        { id: 'e2', url: 'https://x.example.org/p', title: 't', inspected_original: true, excerpt: Array(15).fill('need').join(' '), paraphrase: 'need' },
      ],
    })
    expect(budgeted.evidence.find((e) => e.id === 'e2')!.excerpt).not.toBe('')
    expect(budgeted.evidence.find((e) => e.id === 'e1')!.excerpt).toBe('')
  })

  it('profile needs a verified offer and an acquisition brief', () => {
    expect(validateProfile(profile, WEBSITE, [`${WEBSITE}/`]).ok).toBe(true)
    expect(validateProfile({ ...profile, services: [] }, WEBSITE, [WEBSITE]).reasons).toContain('profile has no services (empty offer)')
    expect(validateProfile({ ...profile, acquisition_brief: { ...profile.acquisition_brief, sells: '' } }, WEBSITE, [WEBSITE]).reasons).toContain(
      'acquisition brief does not say what the business sells',
    )
    expect(validateProfile(profile, WEBSITE, ['https://unrelated.example.com']).reasons).toContain('no consulted source on the submitted business domain')
  })

  it('eligibility does not exclude software products', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/B2B services only/i)
    expect(SYSTEM_PROMPT).toMatch(/unsupported_business/)
  })

  it('initial window is 90 days; daily is max(today − 90 days, last success − 72 h)', () => {
    expect(publishedOnOrAfter(NOW, null)).toBe('2026-06-17')
    expect(publishedOnOrAfter(NOW, new Date('2026-09-14T08:00:00Z'))).toBe('2026-09-11')
    expect(publishedOnOrAfter(NOW, new Date('2026-05-01T08:00:00Z'))).toBe('2026-06-17')
  })

  it('follow-up runs at most once, only with at most one lead and a concrete next step', () => {
    const base = {
      enabled: true,
      kind: 'initial' as const,
      researchStatus: 'complete',
      published: 1,
      unresolved: 0,
      untriedAngles: ['agency owners on LinkedIn'],
      worthwhile: true,
      researchOpen: true,
    }
    expect(followUpDecision(base).run).toBe(true)
    expect(followUpDecision({ ...base, enabled: false })).toEqual({ run: false, reason: 'automatic follow-ups are disabled' })
    expect(followUpDecision({ ...base, published: 0 }).run).toBe(true)
    expect(followUpDecision({ ...base, published: 2 }).run).toBe(false)
    expect(followUpDecision({ ...base, worthwhile: false, unresolved: 2 }).run).toBe(false)
    expect(followUpDecision({ ...base, kind: 'follow_up' }).run).toBe(false)
    expect(followUpDecision({ ...base, untriedAngles: [] }).run).toBe(false)
    expect(followUpDecision({ ...base, worthwhile: false }).run).toBe(false)
    expect(followUpDecision({ ...base, researchStatus: 'website_unreadable' }).run).toBe(false)
  })

  it('lintQuery flags site restrictions and "posted" terms', () => {
    expect(lintQuery('site:reddit.com agency clients')).toContain('site-restricted')
    expect(lintQuery('posted looking for agency')).toContain('"posted" term')
    expect(lintQuery('"referrals dried up" agency')).toEqual([])
  })

  it('research input caps exclusions to the window and the most recent entries', () => {
    const item = (i: number, published_date: string | null) => ({
      source_url: `https://x.example.org/${i}`,
      author_or_company: `a${i}`,
      need_summary: 'n',
      published_date,
      status: 'new' as const,
    })
    const excluded = [item(0, '2026-01-01'), item(1, null), ...Array.from({ length: 50 }, (_, i) => item(i + 2, '2026-09-01'))]
    const input = buildResearchInput({ mode: 'daily', now: NOW, websiteUrl: WEBSITE, lastSuccessfulRunAt: null, profile, excluded, focus: null })
    expect(input.excluded_opportunities).toHaveLength(40)
    expect(input.excluded_opportunities.at(-1)?.source_url).toBe('https://x.example.org/51')
    expect(input.excluded_opportunities.some((e) => e.published_date === '2026-01-01')).toBe(false)
    expect(input.max_tool_calls).toBe(24)
  })

  it('research input follows the website language and carries follow-up context', () => {
    const input = buildResearchInput({
      mode: 'follow_up',
      now: NOW,
      websiteUrl: WEBSITE,
      lastSuccessfulRunAt: NOW,
      profile,
      excluded: [],
      focus: null,
      previousCandidates: [{ source_url: 'https://x.example.org', headline: 'h', decision: 'unresolved', reasons: ['date unknown'] }],
      previousQueries: ['agency owner struggling to get clients'],
      untriedAngles: ['web studios on Indie Hackers'],
      windowStart: WINDOW,
    })
    expect(input.output_language).toBe(WEBSITE_LANGUAGE)
    expect(input.published_on_or_after).toBe(WINDOW)
    expect(input.profile).not.toBeNull()
    expect(input.untried_angles).toHaveLength(1)
    expect(input.previous_candidates).toHaveLength(1)
  })

  it('accepts the v2 structured result shape', () => {
    const parsed = ResearchResult.safeParse({
      schema_version: '2',
      research_status: 'complete',
      profile,
      search_plan: { angles: [], proposed_queries: [] },
      candidates: [makeCandidate()],
      follow_up: { worthwhile: false, reason: '', untried_angles: [], candidates_to_verify: [] },
      coverage: { limitations: [], access_failures: [], rejection_summary: [] },
    })
    expect(parsed.success).toBe(true)
  })
})

describe('email delivery helpers', () => {
  it('round-trips the encrypted private token and rejects tampering', async () => {
    const { encryptToken, decryptToken } = await import('../crypto')
    const token = 'aiG66U_ne5CrH2EHe4kELK0VlLj9anY_rK2VgbJfNpE'
    const sealed = encryptToken(token)
    expect(sealed).not.toContain(token)
    expect(decryptToken(sealed)).toBe(token)
    const parts = sealed.split('.')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA')
    expect(() => decryptToken(parts.join('.'))).toThrow()
  })

  it('only accepts correctly signed unsubscribe codes', async () => {
    const { unsubscribeCode, verifyUnsubscribeCode } = await import('../crypto')
    const radarId = '8aab2618-22c4-4f2d-9a35-a6e1e94f0a61'
    const code = unsubscribeCode(radarId)
    expect(verifyUnsubscribeCode(code)).toBe(radarId)
    expect(verifyUnsubscribeCode(code.replace(radarId, '8aab2618-22c4-4f2d-9a35-a6e1e94f0a62'))).toBeNull()
    expect(verifyUnsubscribeCode(`${radarId}.forged`)).toBeNull()
  })

  it('validates and normalises email addresses', async () => {
    const { normaliseEmail, maskEmail } = await import('../crypto')
    expect(normaliseEmail(' Jane.Doe@Agency.COM ')).toEqual({ ok: true, email: 'Jane.Doe@agency.com' })
    expect(normaliseEmail('not-an-email').ok).toBe(false)
    expect(maskEmail('jane@agency.com')).toBe('j•••@agency.com')
  })

  it('escapes web-derived lead text in emails', async () => {
    const { renderRunEmail } = await import('../email/templates')
    const lead = run([makeCandidate({ headline: '<script>alert(1)</script> Need help' })]).published[0].lead
    const email = renderRunEmail({
      kind: 'daily',
      outcome: 'qualified_results',
      websiteHost: 'example.com',
      businessName: 'Example',
      leads: [{ id: 'l1', data: lead }],
      privateUrl: 'https://app.example/r/token',
      unsubscribeUrl: 'https://app.example/api/unsubscribe/code',
      daysLeft: 10,
    })
    expect(email.subject).toBe('1 new lead for example.com')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })
})
