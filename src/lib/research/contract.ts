import { z } from 'zod'

/** Fixed baseline. Change only after rerunning the evaluation (spec §2). Never silently fall back. */
export const RESEARCH_MODEL = 'gpt-5.5-2026-04-23'
// v1.1: output_language follows the business website instead of the visitor's browser.
// v2: acquisition brief, buyer-language search rules, candidate pool with decisions, follow-up angles.
export const PROMPT_VERSION = 'research-v2'
export const SCHEMA_NAME = 'lead_research_v2'
export const SCHEMA_VERSION = '2'
// Room for the acquisition brief and a pool of up to 15 candidates on top of high reasoning.
export const MAX_OUTPUT_TOKENS = 40000
/** Leads shown to the user per run. */
export const TARGET_COUNT = 5
/** Candidates the model may return per run (qualified, rejected and unresolved together). */
export const MAX_CANDIDATES = 15

// Structured result contract. Every object strict, every key required, nulls for unknowns.
const S = z.string()
const NS = S.nullable()
const refs = z.array(S)

/** A fact read on the website, with evidence. */
export const Fact = z
  .object({
    value: S,
    basis: z.enum(['stated', 'inferred']),
    evidence_ids: refs,
  })
  .strict()

export const Evidence = z
  .object({
    id: S,
    url: S,
    title: S,
    inspected_original: z.boolean(),
    excerpt: S, // <=25 words per original source in aggregate
    paraphrase: S,
  })
  .strict()

/** Geography or language: stated on the site, inferred, or unknown. */
const Scope = z
  .object({
    value: NS,
    basis: z.enum(['stated', 'inferred', 'unknown']),
  })
  .strict()

/**
 * Prospecting instructions derived from the website facts. These are search hypotheses, not website facts:
 * they translate what the business sells into who buys it and how that buyer talks in public.
 */
export const AcquisitionBrief = z
  .object({
    sells: S,
    buyers: z.array(S),
    recognise_buyer_in_posts: z.array(S),
    buyer_problems_in_their_words: z.array(S),
    trigger_situations: z.array(S),
    explicit_requests: z.array(S),
    not_our_buyer: z.array(S),
    buyer_seller_confusions: z.array(S),
    geography: Scope,
    languages: Scope,
  })
  .strict()

export const BusinessProfile = z
  .object({
    name: S,
    website_url: S,
    summary: S,
    services: z.array(Fact),
    customer_types: z.array(Fact),
    problems_solved: z.array(Fact),
    markets: z.array(Fact),
    languages: z.array(Fact),
    proof_points: z.array(Fact),
    pricing: Fact.nullable(),
    exclusions: z.array(S),
    acquisition_brief: AcquisitionBrief,
    evidence: z.array(Evidence),
    uncertainties: z.array(S),
  })
  .strict()

/** Fields shared by every candidate and by published leads. */
const leadFields = {
  headline: S,
  person_name: NS,
  company_name: NS,
  public_handle: NS,
  role: NS,
  company_website: NS,
  location: NS,
  identity_evidence_ids: refs,
  /** Why this author appears to be the business's buyer (not the buyer's customer, not a seller). */
  buyer_match: S,
  source_url: S,
  source_platform: S,
  date_status: z.enum(['exact', 'relative', 'search_result', 'unknown']),
  /** How the date was established, e.g. "Page shows 'Posted 2 days ago' on 2026-09-15". */
  date_note: NS,
  date_evidence_ids: refs,
  need_summary: S,
  need_evidence_ids: refs,
  intent: z.enum(['explicit_request', 'stated_problem']),
  matched_service: S,
  fit_explanation: S,
  fit_is_inferred: z.boolean(),
  budget: NS,
  deadline: NS,
  terms_evidence_ids: refs,
  contact_route: z
    .object({
      url: NS,
      kind: z.enum(['original_post', 'public_profile', 'business_contact', 'none']),
      explanation: S,
      evidence_ids: refs,
    })
    .strict(),
  outreach_angle: S,
  outreach_language: S,
  outreach_message: S,
  score: z
    .object({
      intent: z.number().int(),
      service_fit: z.number().int(),
      freshness: z.number().int(),
      contactability: z.number().int(),
    })
    .strict(),
  evidence: z.array(Evidence),
  caveats: z.array(S),
}

export const Candidate = z
  .object({
    ...leadFields,
    /** YYYY-MM-DD when determinable (exact, relative or search result); null when unknown. */
    published_date: NS,
    decision: z.enum(['qualified', 'rejected', 'unresolved']),
    decision_reasons: z.array(S),
    missing_info: z.array(S),
    access_limitations: z.array(S),
  })
  .strict()

export const ResearchResult = z
  .object({
    schema_version: z.literal('2'),
    research_status: z.enum(['complete', 'incomplete', 'website_unreadable', 'unsupported_business']),
    profile: BusinessProfile.nullable(),
    search_plan: z
      .object({
        angles: z.array(S),
        proposed_queries: z.array(S),
      })
      .strict(),
    candidates: z.array(Candidate),
    follow_up: z
      .object({
        worthwhile: z.boolean(),
        reason: S,
        untried_angles: z.array(S),
        candidates_to_verify: z.array(S),
      })
      .strict(),
    coverage: z
      .object({
        limitations: z.array(S),
        access_failures: z.array(S),
        rejection_summary: z.array(S),
      })
      .strict(),
  })
  .strict()

export type FactT = z.infer<typeof Fact>
export type EvidenceT = z.infer<typeof Evidence>
export type AcquisitionBriefT = z.infer<typeof AcquisitionBrief>
export type BusinessProfileT = z.infer<typeof BusinessProfile>
export type CandidateT = z.infer<typeof Candidate>
export type ResearchResultT = z.infer<typeof ResearchResult>

/**
 * A published lead as stored in leads.data and rendered on the page and in emails. Always carries a
 * calendar publication date. Leads stored before v2 lack buyer_match and date fields, hence optional.
 */
export type LeadT = Omit<CandidateT, 'published_date' | 'decision' | 'decision_reasons' | 'missing_info' | 'access_limitations' | 'buyer_match' | 'date_status' | 'date_note' | 'contact_route'> & {
  published_date: string
  buyer_match?: string
  date_status?: CandidateT['date_status']
  date_note?: string | null
  contact_route: { url: string; kind: 'original_post' | 'public_profile' | 'business_contact'; explanation: string; evidence_ids: string[] }
}

/**
 * Run outcomes stored by the application, derived from candidate decisions (never taken from the model).
 * Legacy v1 values remain readable for old runs.
 */
export type RunOutcome =
  | 'qualified_results'
  | 'candidates_unresolved'
  | 'candidates_rejected'
  | 'no_candidates'
  | 'research_incomplete'
  | 'website_unreadable'
  | 'unsupported_business'
  // legacy (research-v1)
  | 'matches'
  | 'no_matches'
  | 'insufficient_coverage'
  | 'validation_failed'

export const RUN_OUTCOMES: RunOutcome[] = [
  'qualified_results',
  'candidates_unresolved',
  'candidates_rejected',
  'no_candidates',
  'research_incomplete',
  'website_unreadable',
  'unsupported_business',
  'matches',
  'no_matches',
  'insufficient_coverage',
  'validation_failed',
]

/** Completed searches that advance the daily watermark. Incomplete research does not. */
export const SUCCESSFUL_OUTCOMES: RunOutcome[] = [
  'qualified_results',
  'candidates_unresolved',
  'candidates_rejected',
  'no_candidates',
  'matches',
  'no_matches',
]

/** User correction from "Adjust focus": a subset of evidenced profile services plus a market. */
export type Focus = { services: string[]; market: string | null }
