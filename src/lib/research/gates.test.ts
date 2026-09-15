import { describe, expect, it } from 'vitest'
import { ResearchResult, type BusinessProfileT, type LeadT } from './contract'
import {
  canonicalUrl,
  freshnessFor,
  isResearchOpen,
  qualifyLeads,
  DATE_FROM_SEARCH_CAVEAT,
  matchesServices,
  normalisePublishedDate,
  sameService,
  sourceKey,
  validateProfile,
  type GateContext,
  type PriorOpportunity,
} from './gates'
import { buildResearchInput, publishedOnOrAfter, WEBSITE_LANGUAGE } from './prompt'

/*
 * Qualification fixtures (spec §1.8 and §2.2). All data is fictional. Semantic cases (expansion news, vendor
 * adverts, "not looking for an agency", vacancies, geography) are expressed as the scores an accurate model
 * assigns; the tests prove the local gates never publish them and that structural failures never reach the feed.
 */

const NOW = new Date('2026-09-14T10:00:00Z')
const WEBSITE = 'https://btp-automatisation.example-agency.fr'
const SERVICE = 'Quote automation'

const profile: BusinessProfileT = {
  name: 'BTP Automatisation',
  website_url: WEBSITE,
  summary: 'Automation for construction companies.',
  services: [
    { value: SERVICE, basis: 'stated', evidence_ids: ['p1'] },
    { value: 'Document extraction', basis: 'stated', evidence_ids: ['p1'] },
  ],
  customer_types: [{ value: 'Construction contractors', basis: 'stated', evidence_ids: ['p1'] }],
  problems_solved: [],
  markets: [{ value: 'France', basis: 'stated', evidence_ids: ['p1'] }],
  languages: [{ value: 'French', basis: 'stated', evidence_ids: ['p1'] }],
  proof_points: [],
  pricing: null,
  exclusions: [],
  search_angles: [],
  evidence: [
    {
      id: 'p1',
      url: `${WEBSITE}/services`,
      title: 'Services',
      inspected_original: true,
      excerpt: 'Nous automatisons vos devis',
      paraphrase: 'Quote and document automation for contractors.',
    },
  ],
  uncertainties: [],
}

let counter = 0
function makeLead(overrides: Partial<LeadT> = {}): LeadT {
  counter++
  const url = overrides.source_url ?? `https://forum.example.org/threads/${counter}`
  return {
    headline: `Contractor needs quote automation ${counter}`,
    person_name: null,
    company_name: null,
    public_handle: `@builder${counter}`,
    role: null,
    company_website: null,
    location: null,
    identity_evidence_ids: ['e1'],
    source_url: url,
    source_platform: 'Forum',
    published_date: '2026-09-13',
    date_evidence_ids: ['e1'],
    need_summary: `Wants someone to automate quotes from job sheets (${counter})`,
    need_evidence_ids: ['e1'],
    intent: 'explicit_request',
    matched_service: SERVICE,
    fit_explanation: 'The post asks for quote automation; the website documents quote automation.',
    fit_is_inferred: false,
    budget: null,
    deadline: null,
    terms_evidence_ids: [],
    contact_route: { url, kind: 'original_post', explanation: 'Reply on the post', evidence_ids: ['e1'] },
    outreach_angle: 'Offer a short review of their job sheet format.',
    outreach_language: 'fr',
    outreach_message: 'Bonjour, ...',
    score: { intent: 3, service_fit: 3, freshness: 2, contactability: 2 },
    evidence: [
      {
        id: 'e1',
        url,
        title: `Post by @builder${counter}`,
        inspected_original: true,
        excerpt: 'Looking for someone to automate quotes from our job sheets',
        paraphrase: 'Owner asks for quote automation help.',
      },
    ],
    caveats: [],
    ...overrides,
  }
}

function ctx(leads: LeadT[], extra: Partial<GateContext> = {}): GateContext {
  return {
    now: NOW,
    publishedOnOrAfter: '2026-08-15',
    auditUrls: leads.map((lead) => lead.source_url),
    profile,
    focus: null,
    prior: [],
    ...extra,
  }
}

function run(leads: LeadT[], extra: Partial<GateContext> = {}) {
  return qualifyLeads(leads, ctx(leads, extra))
}

describe('§1.8 worked examples', () => {
  it('accepts an explicit, recent, contactable request with direct service fit', () => {
    const result = run([makeLead()])
    expect(result.published).toHaveLength(1)
    expect(result.published[0].score.total).toBe(10)
  })

  it('accepts a first-person stated problem, labelled as such', () => {
    const lead = makeLead({
      intent: 'stated_problem',
      matched_service: 'Document extraction',
      score: { intent: 2, service_fit: 3, freshness: 2, contactability: 2 },
    })
    const result = run([lead])
    expect(result.published).toHaveLength(1)
    expect(result.published[0].lead.intent).toBe('stated_problem')
  })

  it('rejects an expansion announcement with no expressed need', () => {
    const result = run([makeLead({ score: { intent: 0, service_fit: 3, freshness: 2, contactability: 2 } })])
    expect(result.published).toHaveLength(0)
    expect(result.rejected[0].reasons).toContain('intent below threshold')
  })

  it('rejects an agency advertising its own services (seller, not buyer)', () => {
    const result = run([makeLead({ score: { intent: 0, service_fit: 0, freshness: 2, contactability: 2 } })])
    expect(result.published).toHaveLength(0)
  })

  it('rejects a two-year-old forum question', () => {
    const result = run([makeLead({ published_date: '2024-09-01' })])
    expect(result.rejected[0].reasons).toEqual(
      expect.arrayContaining(['published before the allowed window', 'freshness below threshold']),
    )
  })

  it('rejects a perfect snippet whose original page was not inspected', () => {
    const lead = makeLead()
    lead.evidence[0].inspected_original = false
    const result = run([lead])
    expect(result.rejected[0].reasons).toContain('original source was not reported inspected')
  })

  it('rejects a post that is absent from the search tool audit', () => {
    const lead = makeLead()
    const result = qualifyLeads([lead], ctx([lead], { auditUrls: [] }))
    expect(result.rejected[0].reasons).toContain('source URL does not appear in the search tool audit')
  })

  it('rejects "not looking for an agency" even when keywords match', () => {
    const result = run([makeLead({ score: { intent: 0, service_fit: 3, freshness: 2, contactability: 2 } })])
    expect(result.published).toHaveLength(0)
  })

  it('rejects a full-time vacancy that does not accept contractors', () => {
    const result = run([makeLead({ score: { intent: 1, service_fit: 3, freshness: 2, contactability: 2 } })])
    expect(result.published).toHaveLength(0)
  })

  it('rejects a request whose deadline has passed', () => {
    const lead = makeLead({ deadline: 'Proposals due 2026-09-01', terms_evidence_ids: ['e1'] })
    expect(run([lead]).rejected[0].reasons).toContain('deadline has passed')
  })

  it('accepts an anonymous handle without fabricating a name or company', () => {
    const result = run([makeLead({ person_name: null, company_name: null })])
    expect(result.published).toHaveLength(1)
    expect(result.published[0].lead.company_name).toBeNull()
  })

  it('does not republish the same request reposted on another platform', () => {
    const first = makeLead({ public_handle: '@maconpro', need_summary: 'Automate quotes from job sheets for masonry company' })
    first.evidence[0].title = 'Post by @maconpro'
    const repost = makeLead({
      source_url: 'https://other-platform.example.net/p/991',
      public_handle: '@maconpro',
      headline: first.headline,
      need_summary: 'Automate quotes from job sheets for masonry company',
    })
    repost.evidence[0].title = 'Post by @maconpro'
    const prior: PriorOpportunity[] = [
      { sourceKey: sourceKey(first.source_url)!, identityKey: 'maconpro', needText: `${first.headline} ${first.need_summary}` },
    ]
    const result = run([repost], { prior })
    expect(result.published).toHaveLength(0)
  })

  it('rejects a buyer outside the documented service scope', () => {
    const result = run([makeLead({ score: { intent: 3, service_fit: 0, freshness: 2, contactability: 2 } })])
    expect(result.rejected[0].reasons).toContain('service fit below threshold')
  })
})

describe('§2.2 additional fixtures', () => {
  it('drops a lead with a missing source reference', () => {
    const result = run([makeLead({ need_evidence_ids: ['e9'] })])
    expect(result.rejected[0].reasons).toContain('need: reference e9 does not resolve')
  })

  it('rejects a publication date after now', () => {
    expect(run([makeLead({ published_date: '2026-09-20' })]).rejected[0].reasons).toContain(
      'publication date is in the future',
    )
  })

  it('rejects an invalid public URL', () => {
    const lead = makeLead({ source_url: 'http://localhost:3000/post/1' })
    lead.evidence[0].url = lead.source_url
    expect(run([lead]).rejected[0].reasons).toContain('source URL is not a public http(s) URL')
  })

  it('rejects an invented company affiliation', () => {
    const result = run([makeLead({ company_name: 'Bouygues Construction' })])
    expect(result.rejected[0].reasons).toContain('company affiliation is not supported by identity evidence')
  })

  it('treats a repeated source with tracking parameters as a duplicate', () => {
    const original = makeLead({ source_url: 'https://forum.example.org/t/Quote-Help?id=42' })
    const tracked = { ...original, source_url: 'https://www.forum.example.org/t/Quote-Help/?id=42&utm_source=x#reply' }
    expect(canonicalUrl(tracked.source_url)).toBe(canonicalUrl(original.source_url))
    const prior: PriorOpportunity[] = [{ sourceKey: sourceKey(original.source_url)!, identityKey: 'other', needText: 'unrelated' }]
    const result = qualifyLeads([tracked], ctx([tracked], { prior, auditUrls: [original.source_url] }))
    expect(result.published).toHaveLength(0)
    expect(result.rejected[0].reasons).toContain('same source as an existing opportunity')
  })

  it('preserves case-sensitive paths and content-identifying query parameters', () => {
    expect(canonicalUrl('https://Example.org/Post/AbC?id=7&utm_medium=x')).toBe('example.org/Post/AbC?id=7')
    expect(canonicalUrl('https://example.org/post/abc?id=8')).not.toBe(canonicalUrl('https://example.org/post/abc?id=7'))
  })

  it('blocks research exactly at the expiry boundary', () => {
    const endsAt = new Date('2026-09-28T10:00:00Z')
    expect(isResearchOpen(new Date(endsAt.getTime() - 1), endsAt)).toBe(true)
    expect(isResearchOpen(endsAt, endsAt)).toBe(false)
    expect(isResearchOpen(new Date(endsAt.getTime() + 1), endsAt)).toBe(false)
  })

  it('renders the actual count on a partial result', () => {
    const result = run([makeLead(), makeLead({ published_date: '2020-01-01' }), makeLead({ need_evidence_ids: [] })])
    expect(result.published).toHaveLength(1)
    expect(result.rejected).toHaveLength(2)
  })

  it('never publishes more than five leads', () => {
    const leads = Array.from({ length: 7 }, (_, index) =>
      makeLead({ need_summary: `Distinct need number ${index} about ${['roofing', 'plumbing', 'paint', 'tiles', 'glass', 'steel', 'wood'][index]}` }),
    )
    expect(run(leads).published).toHaveLength(5)
  })

  it('cannot let a formatting repair manufacture evidence', () => {
    // A repaired result that introduces a URL the research never consulted fails the audit gate.
    const repaired = makeLead({ source_url: 'https://invented.example.com/post' })
    repaired.evidence[0].url = repaired.source_url
    const result = qualifyLeads([repaired], ctx([], { auditUrls: ['https://forum.example.org/threads/real'] }))
    expect(result.published).toHaveLength(0)
  })

  it('requires references for budget claims', () => {
    expect(run([makeLead({ budget: '€5,000' })]).rejected[0].reasons).toContain('terms: no evidence reference')
  })

  it('enforces the 25-word quote budget per source', () => {
    const lead = makeLead()
    lead.evidence[0].excerpt = Array.from({ length: 30 }, () => 'word').join(' ')
    expect(run([lead]).rejected[0].reasons).toContain('excerpts exceed 25 words for one source')
  })

  it('recomputes freshness server-side instead of trusting the model', () => {
    const lead = makeLead({ published_date: '2026-08-20', score: { intent: 3, service_fit: 3, freshness: 2, contactability: 2 } })
    const result = run([lead])
    expect(result.published[0].score.freshness).toBe(1)
    expect(freshnessFor('2026-09-07', NOW)).toBe(2)
    expect(freshnessFor('2026-08-15', NOW)).toBe(1)
  })

  it('requires the matched service to exist in the profile and focus', () => {
    expect(run([makeLead({ matched_service: 'SEO' })]).rejected[0].reasons).toContain(
      'matched service is not in the extracted profile',
    )
    const focused = run([makeLead()], { focus: { services: ['Document extraction'], market: null } })
    expect(focused.rejected[0].reasons).toContain('matched service is outside the selected focus')
  })
})

describe('profile and windows', () => {
  it('requires a corroborated source on the submitted business domain', () => {
    expect(validateProfile(profile, WEBSITE, [`${WEBSITE}/services`]).ok).toBe(true)
    expect(validateProfile(profile, WEBSITE, ['https://unrelated.example.com']).reasons).toContain(
      'no consulted source on the submitted business domain',
    )
  })

  it('rejects an empty offer', () => {
    expect(validateProfile({ ...profile, services: [] }, WEBSITE, [WEBSITE]).reasons).toContain(
      'profile has no services (empty offer)',
    )
  })

  it('computes the daily window as max(today − 30 days, last success − 72 h)', () => {
    expect(publishedOnOrAfter(NOW, null)).toBe('2026-08-15')
    expect(publishedOnOrAfter(NOW, new Date('2026-09-13T08:00:00Z'))).toBe('2026-09-10')
    expect(publishedOnOrAfter(NOW, new Date('2026-07-01T08:00:00Z'))).toBe('2026-08-15')
  })

  it('accepts the documented structured result shape', () => {
    const parsed = ResearchResult.safeParse({
      schema_version: '1',
      outcome: 'matches',
      profile,
      leads: [makeLead()],
      coverage: { angles_attempted: [], queries_reported: [], limitations: [], rejection_summary: [] },
    })
    expect(parsed.success).toBe(true)
    expect(ResearchResult.safeParse({ schema_version: '1', outcome: 'matches', profile, leads: [], coverage: {} }).success).toBe(false)
  })
})

describe('regressions from production runs', () => {
  const thread =
    'https://www.reddit.com/r/EntreprendreenFrance/comments/1vzmgp9/comment_aller_parler_%C3%A0_des_artisans_du_b%C3%A2timent/'
  const comment = `${thread}p68z68b/`

  it('accepts a Reddit comment permalink when its thread page was opened', () => {
    const lead = makeLead({ source_url: comment, public_handle: 'u/dizzyme_' })
    lead.evidence[0].url = comment
    lead.evidence[0].title = 'Comment by u/dizzyme_'
    lead.contact_route.url = comment
    const result = qualifyLeads([lead], ctx([lead], { auditUrls: [thread, `${thread}.json`] }))
    expect(result.rejected).toEqual([])
    expect(result.published).toHaveLength(1)
  })

  it('still rejects a comment from a thread that was never opened', () => {
    const lead = makeLead({ source_url: comment })
    lead.evidence[0].url = comment
    const other = 'https://www.reddit.com/r/EntreprendreenFrance/comments/1ux0cie/les_pires_excuses/'
    expect(qualifyLeads([lead], ctx([lead], { auditUrls: [other] })).rejected[0].reasons).toContain(
      'source URL does not appear in the search tool audit',
    )
  })

  it('keeps different comments in the same thread as separate sources', () => {
    expect(sourceKey(comment)).toBe('reddit:1vzmgp9:p68z68b')
    expect(sourceKey(`${thread}zz11aa/`)).not.toBe(sourceKey(comment))
    expect(sourceKey(thread)).toBe('reddit:1vzmgp9')
  })

  it('matches a paraphrased service name to the profile service', () => {
    expect(
      sameService(
        'Automatisation des devis et constitution d’une base de prix à partir des factures et données existantes.',
        'Automatisation IA des devis et du chiffrage BTP à partir des données et processus existants',
      ),
    ).toBe(true)
    expect(sameService('Automatisation des devis et base de prix', 'Référencement SEO et création de contenu')).toBe(false)
    expect(sameService('Website design', 'Conversion rate optimisation')).toBe(false)
  })
})

describe('research input language', () => {
  it('follows the business website, never the visitor browser language', () => {
    const input = buildResearchInput({
      mode: 'initial',
      now: NOW,
      websiteUrl: 'https://cyberleads.com',
      lastSuccessfulRunAt: null,
      profile: null,
      excluded: [],
      focus: null,
    })
    expect(input.output_language).toBe(WEBSITE_LANGUAGE)
    expect(input.output_language).not.toMatch(/fr|en-US/)
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
    expect(normaliseEmail('a@b').ok).toBe(false)
    expect(maskEmail('jane@agency.com')).toBe('j•••@agency.com')
  })

  it('escapes web-derived lead text in emails', async () => {
    const { renderRunEmail } = await import('../email/templates')
    const lead = makeLead({ headline: '<script>alert(1)</script> Need help', public_handle: '"><img src=x onerror=alert(1)>' })
    const email = renderRunEmail({
      kind: 'daily',
      outcome: 'matches',
      websiteHost: 'cyberleads.com',
      businessName: 'CyberLeads',
      leads: [{ id: 'l1', data: lead }],
      privateUrl: 'https://app.example/r/token',
      unsubscribeUrl: 'https://app.example/api/unsubscribe/code',
      daysLeft: 10,
    })
    expect(email.subject).toBe('1 new lead for cyberleads.com')
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img src=x')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('https://app.example/api/unsubscribe/code')
  })
})

describe('regressions from the notanotheragent.com run', () => {
  // Shape copied from the production output: handle only, four quotes from one Reddit post, date from search results.
  function redditLead() {
    const url = 'https://www.reddit.com/r/marketingagency/comments/1wbb6sk/agency_growth_is_stalled/'
    return makeLead({
      public_handle: 'u/Winter_Milk6072',
      source_url: url,
      identity_evidence_ids: ['E1'],
      need_evidence_ids: ['E2', 'E3'],
      date_evidence_ids: ['E4'],
      contact_route: { url, kind: 'original_post', explanation: 'Reply on the post', evidence_ids: ['E1'] },
      evidence: [
        { id: 'E1', url, title: 'Agency growth is stalled', inspected_original: true, excerpt: 'I’ve been running my agency on the side with a team of 4 for around three years.', paraphrase: 'Runs a small agency.' },
        { id: 'E2', url, title: 'Agency growth is stalled', inspected_original: true, excerpt: 'the sole bottleneck right now is me building the pipeline.', paraphrase: 'Pipeline is the bottleneck.' },
        { id: 'E3', url, title: 'Agency growth is stalled', inspected_original: true, excerpt: 'cold outreach has hit a brick wall.', paraphrase: 'Cold outreach stopped working.' },
        { id: 'E4', url, title: 'Search result: Agency growth is stalled', inspected_original: false, excerpt: '[Wednesday September 09 2026]', paraphrase: 'Search result date for this post.' },
      ],
    })
  }

  it('publishes it, trimming extra quotes to the 25-word budget and flagging the search-result date', () => {
    const lead = redditLead()
    const result = run([lead])
    expect(result.rejected).toEqual([])
    const published = result.published[0].lead
    const quotedWords = published.evidence.reduce((sum, item) => sum + item.excerpt.split(/\s+/).filter(Boolean).length, 0)
    expect(quotedWords).toBeLessThanOrEqual(25)
    expect(published.evidence.find((item) => item.id === 'E2')!.excerpt).not.toBe('')
    expect(published.evidence.find((item) => item.id === 'E1')!.paraphrase).toBe('Runs a small agency.')
    expect(published.caveats).toContain(DATE_FROM_SEARCH_CAVEAT)
  })

  it('still rejects a handle when the original page was never inspected', () => {
    const lead = redditLead()
    lead.evidence = lead.evidence.map((item) => ({ ...item, inspected_original: false }))
    expect(run([lead]).rejected[0].reasons).toContain('public handle is not supported by identity evidence')
  })

  it('still rejects a date taken from a different page', () => {
    const lead = redditLead()
    lead.evidence[3] = { ...lead.evidence[3], url: 'https://www.reddit.com/r/marketingagency/comments/9zzzzzz/other_post/' }
    expect(run([lead]).rejected[0].reasons).toContain('publication date evidence is not from the original source')
  })
})

describe('regressions from the second notanotheragent.com run', () => {
  const lrProfile: BusinessProfileT = {
    ...profile,
    services: [
      { value: 'Daily/public-web lead research for agencies: scans for companies publicly signaling that they need the agency’s services and sends the best matches by email.', basis: 'stated', evidence_ids: ['p1'] },
      { value: 'Lead verification: opens sources, checks dates, and includes evidence so users can verify each opportunity.', basis: 'stated', evidence_ids: ['p1'] },
      { value: 'First-message drafting for the user to send; the service does not contact prospects on the user’s behalf.', basis: 'stated', evidence_ids: ['p1'] },
    ],
  }
  const matched = 'Public buying-signal lead research for agencies, with checked source evidence and a drafted first message'

  function jsonLead() {
    const url = 'https://www.reddit.com/r/agencynewbies/comments/1w6xmv1/how_to_get_clients/'
    return makeLead({
      public_handle: 'u/Firm-Alarm-7464',
      source_url: url,
      published_date: '2026-09-04T07:39:24Z',
      matched_service: matched,
      intent: 'stated_problem',
      identity_evidence_ids: ['L2'],
      date_evidence_ids: ['L2'],
      need_evidence_ids: ['L2'],
      score: { intent: 2, service_fit: 3, freshness: 1, contactability: 2 },
      contact_route: { url, kind: 'original_post', explanation: 'Reply on the post', evidence_ids: ['L2'] },
      evidence: [
        { id: 'L2', url: `${url}.json`, title: 'How to get clients?', inspected_original: true, excerpt: 'tried cold mailing them but it takes lot of time', paraphrase: 'Cold email takes them a lot of time.' },
      ],
    })
  }

  it('publishes a lead read via Reddit .json with a full timestamp and a combined service name', () => {
    const lead = jsonLead()
    const result = qualifyLeads([lead], ctx([lead], { profile: lrProfile }))
    expect(result.rejected).toEqual([])
    expect(result.published[0].lead.published_date).toBe('2026-09-04')
    expect(result.published[0].score.freshness).toBe(1)
  })

  it('normalises timestamps but still rejects non-dates', () => {
    expect(normalisePublishedDate('2026-09-14T14:46:34Z')).toBe('2026-09-14')
    expect(normalisePublishedDate('2026-09-14')).toBe('2026-09-14')
    expect(normalisePublishedDate('5 days ago')).toBeNull()
    expect(normalisePublishedDate('2026-13-40T00:00:00Z')).toBeNull()
  })

  it('still rejects a service the website does not document', () => {
    expect(matchesServices(lrProfile.services.map((s) => s.value), matched)).toBe(true)
    expect(matchesServices(lrProfile.services.map((s) => s.value), 'Paid ads management and creative production for ecommerce brands')).toBe(false)
  })
})
