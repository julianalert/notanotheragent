/*
 * Print stored research diagnostics for a website's radars (developer tooling; reads DATABASE_URL, writes nothing).
 *
 *   npm run diagnose -- yuzuu.co
 *
 * Shows, per run: model and prompt version, outcome, counts, proposed vs executed searches, query issues, every
 * candidate with its decision and reasons, access failures, follow-up decision, duration and usage.
 * Never prints private tokens or email addresses.
 */
import pg from 'pg'

async function main() {
  const host = process.argv[2]?.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  if (!host) throw new Error('Usage: npm run diagnose -- example.com')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
  await client.connect()
  const runs = await client.query(
    `select rr.id, rr.kind, rr.status, rr.outcome, rr.error_code, rr.model, rr.prompt_version, rr.duration_ms, rr.cost_usd,
       rr.usage, rr.diagnostics, rr.validation_report, rr.coverage, rr.created_at, rr.parent_run_id, r.id as radar_id
     from research_runs rr join radars r on r.id = rr.radar_id
     where r.website_host = $1 order by rr.created_at desc limit 10`,
    [host],
  )
  for (const run of runs.rows) {
    const d = run.diagnostics
    console.log(`\n=== ${run.kind} run ${run.id} (radar ${run.radar_id}) — ${run.created_at.toISOString()}`)
    console.log(`status ${run.status} · outcome ${run.outcome ?? '-'} · ${run.error_code ?? ''} · ${run.model} ${run.prompt_version} · ${Math.round((run.duration_ms ?? 0) / 1000)}s · $${run.cost_usd ?? '?'} · ${JSON.stringify(run.usage)}`)
    if (!d) {
      console.log('(no v2 diagnostics; legacy report)')
      console.log('queries reported:', run.coverage?.queries_reported)
      for (const r of run.validation_report?.rejected ?? []) console.log(`  ✗ ${r.headline}: ${(r.reasons ?? []).join('; ')}`)
      continue
    }
    console.log('counts:', JSON.stringify(d.counts), d.candidates_truncated ? `(+${d.candidates_truncated} truncated)` : '')
    console.log('brief sells:', d.acquisition_brief?.sells)
    console.log('buyers:', d.acquisition_brief?.buyers)
    console.log(`proposed queries (${d.proposed_queries.length}):`, d.proposed_queries)
    console.log(`executed searches (${d.executed_searches.length}), opened pages ${d.opened_pages}:`, d.executed_searches)
    if (d.query_issues.length) console.log('query issues:', d.query_issues)
    if (d.access_failures.length) console.log('access failures:', d.access_failures)
    console.log('follow-up:', JSON.stringify(d.follow_up.decision), d.follow_up.run_id ? `→ run ${d.follow_up.run_id}` : '', '| suggested:', d.follow_up.suggested, '-', d.follow_up.reason)
    const candidates = await client.query(
      `select decision, model_decision, headline, source_url, reasons, date_status, published_date, score_total from research_candidates where run_id = $1 order by decision, score_total desc`,
      [run.id],
    )
    for (const c of candidates.rows) {
      console.log(`  [${c.decision}${c.model_decision !== 'qualified' ? ` / model: ${c.model_decision}` : ''}] ${c.headline}`)
      console.log(`      ${c.source_url} · ${c.published_date ? c.published_date.toISOString().slice(0, 10) : 'no date'} (${c.date_status}) · score ${c.score_total}`)
      if (c.reasons.length) console.log(`      ${c.reasons.join('; ')}`)
    }
  }
  await client.end()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
