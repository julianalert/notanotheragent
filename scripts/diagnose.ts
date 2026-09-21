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
       rr.usage, rr.diagnostics, rr.validation_report, rr.coverage, rr.created_at, rr.parent_run_id, r.id as radar_id,
       rr.raw_response->'pipeline' as pipeline
     from research_runs rr join radars r on r.id = rr.radar_id
     where r.website_host = $1 order by rr.created_at desc limit 10`,
    [host],
  )
  // What each radar remembers: sources it will not look at again for 30 days, and the communities it polls.
  for (const radarId of new Set(runs.rows.map((run) => run.radar_id as string))) {
    const seen = await client.query(
      `select decision, triage_score, count(*)::int as n, count(*) filter (where url ~* 'reddit\\.com')::int as reddit,
         min(first_seen_at) as first_seen, max(last_seen_at) as last_seen
       from seen_sources where radar_id = $1 group by decision, triage_score order by n desc`,
      [radarId],
    )
    console.log(`\n### radar ${radarId} memory (seen_sources)`)
    for (const row of seen.rows) console.log(`  ${row.decision} · triage ${row.triage_score}: ${row.n} (${row.reddit} reddit) · ${row.first_seen?.toISOString().slice(0, 16)} → ${row.last_seen?.toISOString().slice(0, 16)}`)
    const zeroReddit = await client.query(
      `select url from seen_sources where radar_id = $1 and decision = 'triaged_out' and triage_score = 0 and url ~* 'reddit\\.com' order by last_seen_at desc limit 25`,
      [radarId],
    )
    console.log('  reddit posts triaged out at 0 (latest 25):')
    for (const row of zeroReddit.rows) console.log(`    ${String(row.url).replace(/^https?:\/\/(www\.)?reddit\.com/, '')}`)
    const watched = await client.query(`select label, enabled, hits, published from watched_sources where radar_id = $1 order by published desc, hits desc`, [radarId])
    console.log('  watched:', watched.rows.map((row) => `${row.label}${row.enabled ? '' : ' (off)'} ${row.hits}/${row.published}`).join(' · '))
  }

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
    console.log('problems in their words:', d.acquisition_brief?.buyer_problems_in_their_words)
    console.log('explicit requests:', d.acquisition_brief?.explicit_requests)
    console.log('trigger situations:', d.acquisition_brief?.trigger_situations)
    console.log(`proposed queries (${d.proposed_queries.length}):`, d.proposed_queries)
    console.log(`executed searches (${d.executed_searches.length}), opened pages ${d.opened_pages}:`, d.executed_searches)
    if (d.query_issues.length) console.log('query issues:', d.query_issues)
    if (d.access_failures.length) console.log('access failures:', d.access_failures)
    console.log('follow-up:', JSON.stringify(d.follow_up.decision), d.follow_up.run_id ? `→ run ${d.follow_up.run_id}` : '', '| suggested:', d.follow_up.suggested, '-', d.follow_up.reason)
    // Discovery pipeline runs: where the pool came from and what triage kept (never the source texts).
    const p = run.pipeline as
      | {
          hits: number
          searches: Array<{ connector: string; query: string; hits: number; error?: string | null }>
          triage: Array<{ url: string; score: number; reason: string }>
          sources: Array<{ url: string; connector: string; topic: string; triage: number; chars: number; fetched: boolean }>
          unavailable: string[]
          access_failures: string[]
          qualify_batches?: Array<{ sources: number; status: string; error: string | null }>
        }
      | null
    if (p) {
      const byConnector = new Map<string, { searches: number; hits: number; errors: number }>()
      for (const search of p.searches) {
        const entry = byConnector.get(search.connector) ?? { searches: 0, hits: 0, errors: 0 }
        entry.searches++
        entry.hits += search.hits
        if (search.error) entry.errors++
        byConnector.set(search.connector, entry)
      }
      console.log(`pipeline: ${p.hits} hits after dedupe · connectors`, Object.fromEntries(byConnector), p.unavailable.length ? `· unavailable: ${p.unavailable.join(', ')}` : '')
      for (const search of p.searches.filter((item) => item.error)) console.log(`  search error [${search.connector}] ${search.query}: ${search.error}`)
      const scores = [3, 2, 1, 0].map((score) => `${score}: ${p.triage.filter((hit) => hit.score === score).length}`).join(' · ')
      console.log(`triage scores → ${scores}`)
      const hostOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/').slice(0, url.includes('reddit.com') ? 3 : 1).join('/')
      const hosts = new Map<string, number>()
      for (const hit of p.triage) hosts.set(hostOf(hit.url), (hosts.get(hostOf(hit.url)) ?? 0) + 1)
      console.log('hit hosts:', [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([host, count]) => `${host} ${count}`).join(' · '))
      console.log(`read in full (${p.sources.length}):`)
      for (const source of p.sources) console.log(`  [t${source.triage} ${source.connector}${source.fetched ? '' : ' preview-only'} ${source.chars}c] ${source.url}  ← ${source.topic}`)
      const dropped = p.triage.filter((hit) => hit.score >= 2 && !p.sources.some((source) => source.url === hit.url))
      if (dropped.length) console.log(`scored 2+ but not read (${dropped.length}):`, dropped.slice(0, 15).map((hit) => `${hit.url} (${hit.score})`))
      if (p.access_failures.length) console.log('could not read:', p.access_failures)
      if (p.qualify_batches?.length) console.log('qualify batches:', JSON.stringify(p.qualify_batches))
    }
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
