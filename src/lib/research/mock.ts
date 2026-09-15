import type { CandidateT, EvidenceT, ResearchResultT } from './contract'
import type { Inspection, ResearchProvider } from './provider'
import type { ResearchInput } from './prompt'

/*
 * Development-only provider. Produces clearly labelled sample output that exercises the real gates: a mixed pool
 * of qualified, unresolved (undated, not in audit) and rejected (seller, stale) candidates, and a follow-up.
 */

const DURATION_MS = 15_000
const DAY_MS = 86_400_000

type Payload = { mode: ResearchInput['mode']; website: string; excluded: number; focus: string[] }

export const mockProvider: ResearchProvider = {
  name: 'mock',
  model: 'mock-sample-data',
  outputMode: 'structured',

  async start(input: ResearchInput) {
    const focusLine = input.run_instructions.match(/services from the supplied profile: (.*)\./)?.[1]
    const payload: Payload = {
      mode: input.mode,
      website: input.website_url,
      excluded: input.excluded_opportunities.length,
      focus: focusLine ? focusLine.split('; ') : [],
    }
    return { responseId: `mock_${Date.now()}_${Buffer.from(JSON.stringify(payload)).toString('base64url')}` }
  },

  async inspect(responseId): Promise<Inspection> {
    const [, startedAt, encoded] = responseId.split('_')
    if (Date.now() - Number(startedAt) < DURATION_MS) return { state: 'pending' }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Payload
    const { result, auditUrls } = sample(payload, Number(startedAt))
    return {
      state: 'completed',
      text: JSON.stringify(result),
      auditUrls,
      actions: result.search_plan.proposed_queries.map((query) => ({ type: 'search', query, url: null, status: 'completed' })),
      usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, web_search_calls: 8 },
      raw: { mock: true },
    }
  },

  async format(text) {
    return { text, usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, web_search_calls: 0 } }
  },

  async cancel() {},
}

const NEEDS = [
  ['Looking for an agency to rebuild our B2B marketing website before our Series A', 'explicit_request'],
  ['Our demo request form converts terribly since we relaunched the pricing page', 'stated_problem'],
  ['Need a freelance designer or studio for a Webflow migration this quarter', 'explicit_request'],
  ['Checkout abandonment on our wholesale portal doubled after a redesign', 'stated_problem'],
  ['Seeking a CRO consultant to audit our trial signup flow', 'explicit_request'],
  ['Inbound leads dropped after moving our site to a new CMS', 'stated_problem'],
] as const

function sample(payload: Payload, seed: number): { result: ResearchResultT; auditUrls: string[] } {
  const now = new Date(seed)
  const day = (offset: number) => new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10)
  const website = new URL(payload.website)
  const services = ['Website design', 'Conversion rate optimisation']
  const auditUrls = [payload.website, `${website.origin}/services`]

  const candidate = (
    index: number,
    options: { published: string | null; decision?: CandidateT['decision']; reasons?: string[]; inAudit?: boolean },
  ): CandidateT => {
    const [need, intent] = NEEDS[index % NEEDS.length]
    const handle = `@sample_${seed.toString(36)}_${index}`
    const source = `https://example.com/sample/${seed.toString(36)}/${index}?utm_source=mock`
    if (options.inAudit !== false) auditUrls.push(source)
    const evidence: EvidenceT[] = [
      {
        id: 'e1',
        url: source,
        title: `Sample post by ${handle}`,
        inspected_original: true,
        excerpt: `Development sample: ${need.split(' ').slice(0, 12).join(' ')}`,
        paraphrase: `Sample paraphrase. ${handle} describes this need: ${need.toLowerCase()}.`,
      },
    ]
    return {
      headline: `Sample: ${need}`,
      person_name: null,
      company_name: null,
      public_handle: handle,
      role: null,
      company_website: null,
      location: null,
      identity_evidence_ids: ['e1'],
      buyer_match: 'Sample data: the author runs a B2B SaaS team, which is the buyer described in the brief.',
      source_url: source,
      source_platform: index % 2 ? 'Reddit' : 'Indie Hackers',
      published_date: options.published,
      date_status: options.published ? 'exact' : 'unknown',
      date_note: options.published ? null : 'The page does not show a publication date.',
      date_evidence_ids: options.published ? ['e1'] : [],
      need_summary: `Sample data. ${need}.`,
      need_evidence_ids: ['e1'],
      intent,
      matched_service: payload.focus[0] ?? services[index % 2],
      fit_explanation: `Sample data. The post describes "${need.toLowerCase()}". The website documents ${services[index % 2].toLowerCase()}, which addresses it directly.`,
      fit_is_inferred: intent === 'stated_problem',
      budget: null,
      deadline: null,
      terms_evidence_ids: [],
      contact_route: { url: source, kind: 'original_post', explanation: 'Reply publicly on the original post.', evidence_ids: ['e1'] },
      outreach_angle: 'Reference the specific problem and offer one concrete diagnostic.',
      outreach_language: 'en',
      outreach_message:
        'Hi — this is a development-mode sample message. A real draft references the public post, suggests one useful next step and asks one low-pressure question, using only capabilities documented on your website. Would a short review of the pages involved be useful?',
      score: { intent: intent === 'explicit_request' ? 3 : 2, service_fit: 3, freshness: 2, contactability: 2 },
      evidence,
      caveats: intent === 'stated_problem' ? ['Stated problem, not confirmed buying intent.'] : [],
      decision: options.decision ?? 'qualified',
      decision_reasons: options.reasons ?? [],
      missing_info: options.published ? [] : ['publication date'],
      access_limitations: [],
    }
  }

  let candidates: CandidateT[]
  if (payload.mode === 'initial') {
    candidates = [
      candidate(0, { published: day(1) }),
      candidate(1, { published: day(4) }),
      candidate(2, { published: null, decision: 'unresolved', reasons: ['publication date not shown'] }),
      candidate(3, { published: day(90) }),
      candidate(4, { published: day(2), inAudit: false }),
      candidate(5, { published: day(3), decision: 'rejected', reasons: ['seller promoting their own services'] }),
    ]
  } else if (payload.mode === 'follow_up') {
    candidates = [candidate(payload.excluded + 3, { published: day(2) })]
  } else {
    candidates = [candidate(payload.excluded + 2, { published: day(0) })]
  }

  const proposed =
    payload.mode === 'follow_up'
      ? ['sample follow-up: redesign agency recommendation', 'sample follow-up: demo form conversions dropped']
      : ['sample: looking for a web design agency', 'sample: demo requests dropped after redesign', 'sample: webflow migration help']

  return {
    auditUrls,
    result: {
      schema_version: '3',
      research_status: 'complete',
      profile: {
        name: `${website.hostname.replace(/^www\./, '')} (sample profile)`,
        website_url: payload.website,
        summary: 'Development mode sample profile. No research provider is configured.',
        services: services.map((value) => ({ value, basis: 'stated' as const, evidence_ids: ['p1'] })),
        customer_types: [{ value: 'B2B SaaS companies', basis: 'inferred', evidence_ids: ['p1'] }],
        problems_solved: [{ value: 'Low website conversion', basis: 'stated', evidence_ids: ['p1'] }],
        markets: [{ value: 'Europe', basis: 'inferred', evidence_ids: ['p1'] }],
        languages: [{ value: 'English', basis: 'stated', evidence_ids: ['p1'] }],
        proof_points: [],
        pricing: null,
        exclusions: ['Other agencies', 'Full-time hiring posts'],
        acquisition_brief: {
          sells: 'Sample: website design and conversion optimisation for B2B SaaS teams.',
          buyers: ['Heads of marketing and founders at B2B SaaS companies'],
          recognise_buyer_in_posts: ['Mentions their SaaS product, trial, demo form or pricing page'],
          buyer_problems_in_their_words: ['our demo form stopped converting', 'site redesign killed signups'],
          trigger_situations: ['Recent relaunch or CMS migration', 'Upcoming funding round'],
          explicit_requests: ['looking for a web design agency', 'recommend a CRO consultant'],
          not_our_buyer: ['Other agencies selling design services', "The SaaS companies' own customers"],
          buyer_seller_confusions: ['Agencies advertising redesigns look like requests but are sellers'],
          geography: { value: 'Europe', basis: 'inferred' },
          languages: { value: 'English', basis: 'stated' },
        },
        evidence: [
          {
            id: 'p1',
            url: `${website.origin}/services`,
            title: 'Services (sample)',
            inspected_original: true,
            excerpt: 'Sample excerpt',
            paraphrase: 'Sample paraphrase of the services page.',
          },
        ],
        uncertainties: ['Sample data only'],
      },
      search_plan: { angles: services, proposed_queries: proposed },
      candidates,
      follow_up:
        payload.mode === 'initial'
          ? { worthwhile: true, reason: 'Sample: one undated candidate to verify and an untried angle.', untried_angles: ['sample: founders asking for CRO audits'], candidates_to_verify: [candidates[2].source_url] }
          : { worthwhile: false, reason: 'Sample: nothing further to try.', untried_angles: [], candidates_to_verify: [] },
      coverage: {
        limitations: ['Development mode sample data. Set OPENAI_API_KEY to run real research.'],
        access_failures: payload.mode === 'initial' ? ['https://example.com/sample/blocked (sample: login required)'] : [],
        rejection_summary: ['Sample: rejected a seller promotion.'],
      },
    },
  }
}
