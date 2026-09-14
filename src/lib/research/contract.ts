import { z } from 'zod'

/** Fixed baseline. Change only after rerunning the evaluation (spec §2). Never silently fall back. */
export const RESEARCH_MODEL = 'gpt-5.5-2026-04-23'
export const PROMPT_VERSION = 'research-v1'
export const SCHEMA_NAME = 'lead_research_v1'
export const SCHEMA_VERSION = '1'
export const MAX_OUTPUT_TOKENS = 24000
export const TARGET_COUNT = 5

// Exact structured result contract (spec §1.5). Every object strict, every key required, nulls for unknowns.
const S = z.string()
const NS = S.nullable()
const refs = z.array(S)

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
    search_angles: z.array(
      z
        .object({
          service: S,
          buyer_problem: S,
          explicit_request_queries: z.array(S),
          stated_problem_queries: z.array(S),
        })
        .strict(),
    ),
    evidence: z.array(Evidence),
    uncertainties: z.array(S),
  })
  .strict()

export const Lead = z
  .object({
    headline: S,
    person_name: NS,
    company_name: NS,
    public_handle: NS,
    role: NS,
    company_website: NS,
    location: NS,
    identity_evidence_ids: refs,
    source_url: S,
    source_platform: S,
    published_date: S, // YYYY-MM-DD; original date, not crawl date
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
        url: S,
        kind: z.enum(['original_post', 'public_profile', 'business_contact']),
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
  })
  .strict()

export const ResearchResult = z
  .object({
    schema_version: z.literal('1'),
    outcome: z.enum(['matches', 'no_matches', 'website_unreadable', 'unsupported_business', 'insufficient_coverage']),
    profile: BusinessProfile.nullable(),
    leads: z.array(Lead),
    coverage: z
      .object({
        angles_attempted: z.array(S),
        queries_reported: z.array(S),
        limitations: z.array(S),
        rejection_summary: z.array(S),
      })
      .strict(),
  })
  .strict()

export type FactT = z.infer<typeof Fact>
export type EvidenceT = z.infer<typeof Evidence>
export type BusinessProfileT = z.infer<typeof BusinessProfile>
export type LeadT = z.infer<typeof Lead>
export type ResearchResultT = z.infer<typeof ResearchResult>

/** Run outcomes stored by the application. `validation_failed` is application-assigned, never model output. */
export type RunOutcome = ResearchResultT['outcome'] | 'validation_failed'

/** Outcomes that count as successful research and advance the daily watermark (spec §1.2, §1.6.7). */
export const SUCCESSFUL_OUTCOMES: RunOutcome[] = ['matches', 'no_matches']

/** User correction from "Adjust focus": a subset of evidenced profile services plus a market. */
export type Focus = { services: string[]; market: string | null }
