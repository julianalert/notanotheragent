import type { EvidenceT, LeadT, ResearchResultT } from './contract'
import type { Inspection, ResearchProvider } from './provider'
import type { ResearchInput } from './prompt'

/*
 * Development-only provider. Produces clearly labelled sample output that exercises the real gates:
 * it includes candidates that must be rejected (stale, not in the tool audit) alongside passing ones.
 */

const DURATION_MS = 15_000
const DAY_MS = 86_400_000

type Payload = { mode: 'initial' | 'daily'; website: string; after: string; excluded: number; focus: string[] }

export const mockProvider: ResearchProvider = {
  name: 'mock',
  model: 'mock-sample-data',
  outputMode: 'structured',

  async start(input: ResearchInput) {
    const focusLine = input.run_instructions.match(/services from the supplied profile: (.*)\./)?.[1]
    const payload: Payload = {
      mode: input.mode,
      website: input.website_url,
      after: input.published_on_or_after,
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

  const lead = (index: number, publishedOffset: number, options: { inAudit?: boolean } = {}): LeadT => {
    const [need, intent] = NEEDS[index % NEEDS.length]
    const handle = `@sample_${seed.toString(36)}_${index}`
    const source = `https://example.com/sample/${seed.toString(36)}/${index}`
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
      location: index % 2 ? 'Remote (EU)' : null,
      identity_evidence_ids: ['e1'],
      source_url: source,
      source_platform: index % 2 ? 'Reddit' : 'Indie Hackers',
      published_date: day(publishedOffset),
      date_evidence_ids: ['e1'],
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
    }
  }

  const leads =
    payload.mode === 'initial'
      ? [lead(0, 1), lead(1, 4), lead(2, 12), lead(3, 90), lead(4, 2, { inAudit: false })]
      : [lead(payload.excluded + 2, 0)]

  return {
    auditUrls,
    result: {
      schema_version: '1',
      outcome: 'matches',
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
        search_angles: services.map((service) => ({
          service,
          buyer_problem: 'Website underperforms',
          explicit_request_queries: [`"looking for" ${service.toLowerCase()} agency`],
          stated_problem_queries: ['"our website" conversions dropped'],
        })),
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
      leads,
      coverage: {
        angles_attempted: services,
        queries_reported: ['sample query 1', 'sample query 2'],
        limitations: ['Development mode sample data. Set OPENAI_API_KEY to run real research.'],
        rejection_summary: [],
      },
    },
  }
}
