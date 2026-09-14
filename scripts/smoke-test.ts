/*
 * Compatibility smoke test (spec §2.1). Proves integration, not lead quality.
 *
 *   npm run smoke -- https://your-own-or-authorised-site.com
 *
 * Submits the exact initial request (model + background + web search + structured output), persists nothing,
 * polls to a terminal state, parses, runs every local gate and prints versions, usage and elapsed time.
 * Only use a developer-owned or explicitly authorised public business website.
 */
import { MAX_OUTPUT_TOKENS, PROMPT_VERSION, RESEARCH_MODEL, ResearchResult, SCHEMA_VERSION } from '../src/lib/research/contract'
import { qualifyLeads, validateProfile } from '../src/lib/research/gates'
import { buildResearchInput } from '../src/lib/research/prompt'
import { getProvider } from '../src/lib/research/provider'
import { normaliseWebsite } from '../src/lib/url'

const POLL_MS = 10_000
const DEADLINE_MS = 10 * 60_000

async function main() {
  const website = normaliseWebsite(process.argv[2])
  if (!website.ok) throw new Error(`Usage: npm run smoke -- https://example-agency.com (${website.error})`)
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the smoke test')
  process.env.RESEARCH_PROVIDER = 'openai'

  const provider = getProvider()
  const now = new Date()
  const input = buildResearchInput({
    mode: 'initial',
    now,
    websiteUrl: website.url,
    outputLanguage: 'en',
    lastSuccessfulRunAt: null,
    profile: null,
    excluded: [],
    focus: null,
  })

  console.log({ model: RESEARCH_MODEL, prompt: PROMPT_VERSION, schema: SCHEMA_VERSION, outputMode: provider.outputMode, maxOutputTokens: MAX_OUTPUT_TOKENS })
  const started = Date.now()
  const { responseId } = await provider.start(input)
  console.log(`✓ accepted configuration, background response id ${responseId}`)

  let inspection = await provider.inspect(responseId)
  while (inspection.state === 'pending') {
    if (Date.now() - started > DEADLINE_MS) {
      await provider.cancel(responseId)
      throw new Error('✗ exceeded the 10-minute wall deadline; cancellation requested')
    }
    process.stdout.write(`  … ${Math.round((Date.now() - started) / 1000)}s\r`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    inspection = await provider.inspect(responseId)
  }
  const elapsed = Math.round((Date.now() - started) / 1000)

  if (inspection.state === 'failed') {
    console.error(`✗ terminal failure after ${elapsed}s`, { code: inspection.code, message: inspection.message, usage: inspection.usage })
    process.exit(1)
  }
  console.log(`✓ completed in ${elapsed}s`, inspection.usage)
  console.log(`✓ search audit: ${inspection.auditUrls.length} consulted URLs`)

  let text = inspection.text
  let parsed = ResearchResult.safeParse(safeJson(text))
  if (!parsed.success) {
    console.warn('! structured output did not parse; trying the single formatting repair')
    text = (await provider.format(text)).text
    parsed = ResearchResult.safeParse(safeJson(text))
  }
  if (!parsed.success) {
    console.error('✗ output does not match the schema', parsed.error.issues.slice(0, 5))
    process.exit(1)
  }
  const result = parsed.data
  console.log(`✓ parseable schema, model outcome: ${result.outcome}, returned leads: ${result.leads.length}`)

  const profileCheck = validateProfile(result.profile, website.url, inspection.auditUrls)
  console.log(profileCheck.ok ? '✓ profile passes gates' : '✗ profile gates', profileCheck.reasons)
  if (!profileCheck.ok || !result.profile) return

  const qualified = qualifyLeads(result.leads, {
    now,
    publishedOnOrAfter: input.published_on_or_after,
    auditUrls: inspection.auditUrls,
    profile: result.profile,
    focus: null,
    prior: [],
  })
  console.log(`✓ published ${qualified.published.length}, held ${qualified.held.length}, rejected ${qualified.rejected.length}`)
  for (const lead of qualified.published) {
    console.log(`  • [${lead.score.total}] ${lead.lead.headline}\n    ${lead.sourceUrl} (${lead.lead.published_date})`)
  }
  for (const lead of qualified.rejected) console.log(`  ✗ ${lead.headline}: ${lead.reasons.join('; ')}`)
  console.log('Coverage limitations:', result.coverage.limitations)
  console.log('Open every source link above to confirm it is usable before trusting the integration.')
}

function safeJson(text: string) {
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
