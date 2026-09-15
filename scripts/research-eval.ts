/*
 * Run the real research workflow for one website without touching the database, and report what happened.
 * Billed: one OpenAI research request, plus at most one follow-up when the follow-up rule says so.
 *
 *   npm run research:eval -- https://example-agency.com
 *
 * Prints the acquisition brief, proposed vs executed searches, every candidate with its decision and reasons,
 * and writes a full JSON report to .data/evals/. Only use websites you own or are authorised to research.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { AUTOMATIC_FOLLOW_UPS, ResearchResult, type ResearchResultT } from '../src/lib/research/contract'
import { followUpDecision, qualifyCandidates, validateProfile, type PriorOpportunity } from '../src/lib/research/gates'
import { buildResearchInput, lintQuery } from '../src/lib/research/prompt'
import { getProvider } from '../src/lib/research/provider'
import { normaliseWebsite } from '../src/lib/url'

const POLL_MS = 10_000
const DEADLINE_MS = 15 * 60_000

type Attempt = Awaited<ReturnType<typeof research>>

async function research(input: ReturnType<typeof buildResearchInput>) {
  const provider = getProvider()
  const started = Date.now()
  const { responseId } = await provider.start(input)
  let inspection = await provider.inspect(responseId)
  while (inspection.state === 'pending') {
    if (Date.now() - started > DEADLINE_MS) {
      await provider.cancel(responseId)
      throw new Error('exceeded the wall deadline; cancellation requested')
    }
    process.stdout.write(`  … ${Math.round((Date.now() - started) / 1000)}s\r`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    inspection = await provider.inspect(responseId)
  }
  const seconds = Math.round((Date.now() - started) / 1000)
  if (inspection.state === 'failed') throw new Error(`terminal failure after ${seconds}s: ${inspection.code} ${inspection.message}`)
  let text = inspection.text
  let parsed = ResearchResult.safeParse(safeJson(text))
  let repaired = false
  if (!parsed.success) {
    text = (await provider.format(text)).text
    parsed = ResearchResult.safeParse(safeJson(text))
    repaired = true
  }
  if (!parsed.success) throw new Error(`output does not match the schema: ${parsed.error.message.slice(0, 400)}`)
  return { result: parsed.data, auditUrls: inspection.auditUrls, actions: inspection.actions, usage: inspection.usage, seconds, repaired }
}

function report(label: string, attempt: Attempt, q: ReturnType<typeof qualifyCandidates> | null) {
  const { result, actions, usage, seconds } = attempt
  const executed = actions.filter((a) => a.query).map((a) => a.query!)
  console.log(`\n=== ${label}: ${result.research_status} in ${seconds}s, ${usage.web_search_calls} tool calls, ${usage.input_tokens} in / ${usage.output_tokens} out tokens${attempt.repaired ? ', format repair' : ''}`)
  console.log(`proposed queries (${result.search_plan.proposed_queries.length}):`)
  for (const query of result.search_plan.proposed_queries) console.log(`  - ${query}`)
  console.log(`executed searches (${executed.length}), opened pages: ${actions.filter((a) => a.type === 'open_page').length}`)
  for (const query of executed) {
    const issues = lintQuery(query)
    console.log(`  - ${query}${issues.length ? `   [${issues.join(', ')}]` : ''}`)
  }
  if (q) {
    console.log(`candidates: ${JSON.stringify(q.counts)}`)
    for (const c of q.outcomes) {
      const d = c.candidate
      console.log(`  [${c.decision}] ${c.headline}`)
      console.log(`      ${d.public_handle ?? d.person_name ?? d.company_name ?? 'no identity'} · ${d.source_platform} · ${d.published_date ?? 'no date'} (${d.date_status}) · ${d.intent} · score ${c.score.total}`)
      console.log(`      ${c.source_url}`)
      if (c.reasons.length) console.log(`      reasons: ${c.reasons.join('; ')}`)
    }
  }
  if (result.coverage.access_failures.length) console.log(`access failures: ${result.coverage.access_failures.join(' | ')}`)
  console.log(`follow-up suggested: ${result.follow_up.worthwhile} — ${result.follow_up.reason}`)
}

async function main() {
  const website = normaliseWebsite(process.argv[2])
  if (!website.ok) throw new Error(`Usage: npm run research:eval -- https://example.com (${website.error})`)
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required')
  process.env.RESEARCH_PROVIDER = 'openai'

  const now = new Date()
  const initialInput = buildResearchInput({ mode: 'initial', now, websiteUrl: website.url, lastSuccessfulRunAt: null, profile: null, excluded: [], focus: null })
  console.log(`Researching ${website.url} (window from ${initialInput.published_on_or_after})`)
  const initial = await research(initialInput)
  const profileCheck = validateProfile(initial.result.profile, website.url, initial.auditUrls)
  const brief = initial.result.profile?.acquisition_brief
  console.log('\nacquisition brief:', JSON.stringify(brief, null, 2))
  console.log('profile check:', profileCheck)

  const evaluation: Record<string, unknown> = { website: website.url, at: now.toISOString(), initial: { ...initial, profileCheck } }
  let q1: ReturnType<typeof qualifyCandidates> | null = null
  if (profileCheck.ok && initial.result.profile) {
    q1 = qualifyCandidates(initial.result.candidates, {
      now: new Date(),
      publishedOnOrAfter: initialInput.published_on_or_after,
      auditUrls: initial.auditUrls,
      profile: initial.result.profile,
      focus: null,
      prior: [],
    })
    evaluation.initialQualified = q1
  }
  report('initial', initial, q1)

  const decision = followUpDecision({
    enabled: AUTOMATIC_FOLLOW_UPS,
    kind: 'initial',
    researchStatus: initial.result.research_status,
    published: q1?.counts.published ?? 0,
    unresolved: q1?.counts.unresolved ?? 0,
    untriedAngles: initial.result.follow_up.untried_angles,
    worthwhile: initial.result.follow_up.worthwhile,
    researchOpen: Boolean(q1),
  })
  console.log(`\nfollow-up decision: ${decision.run ? 'run' : 'skip'} — ${decision.reason}`)
  evaluation.followUpDecision = decision

  if (decision.run && q1 && initial.result.profile) {
    const prior: PriorOpportunity[] = q1.published.map((p) => ({ sourceKey: p.sourceKey, identityKey: p.identityKey, needText: p.needText }))
    const followInput = buildResearchInput({
      mode: 'follow_up',
      now: new Date(),
      websiteUrl: website.url,
      lastSuccessfulRunAt: now,
      profile: initial.result.profile,
      excluded: q1.published.map((p) => ({ source_url: p.sourceUrl, author_or_company: p.identityKey, need_summary: p.lead.need_summary, published_date: p.lead.published_date, status: 'new' })),
      focus: null,
      previousCandidates: q1.outcomes.map((o) => ({ source_url: o.source_url, headline: o.headline, decision: o.decision === 'published' || o.decision === 'qualified_not_selected' ? 'qualified' : o.decision, reasons: o.reasons })),
      previousQueries: [...initial.result.search_plan.proposed_queries, ...initial.actions.filter((a) => a.query).map((a) => a.query!)],
      untriedAngles: initial.result.follow_up.untried_angles,
      windowStart: initialInput.published_on_or_after,
    })
    const follow = await research(followInput)
    const q2 = qualifyCandidates(follow.result.candidates, {
      now: new Date(),
      publishedOnOrAfter: initialInput.published_on_or_after,
      auditUrls: follow.auditUrls,
      profile: initial.result.profile,
      focus: null,
      prior,
    })
    report('follow-up', follow, q2)
    evaluation.followUp = follow
    evaluation.followUpQualified = q2
  }

  const dir = path.join(process.cwd(), '.data', 'evals')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${website.host}-${now.toISOString().replace(/[:.]/g, '-')}.json`)
  await fs.writeFile(file, JSON.stringify(evaluation, null, 2))
  console.log(`\nfull report: ${file}`)
}

function safeJson(text: string): ResearchResultT | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
