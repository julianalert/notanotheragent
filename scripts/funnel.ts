/*
 * Growth funnel by weekly signup cohort (developer tooling; reads the database, writes nothing).
 *
 *   npm run funnel                    # DATABASE_URL, last 8 weeks, by week
 *   npm run funnel -- --weeks 12      # longer window
 *   npm run funnel -- --by source     # cohorts by first-touch source instead of by week
 *   npm run funnel -- --local         # the embedded dev database (stop the dev server first)
 *
 * Stages, each counted per radar: created → email → first search done → ≥1 lead → desk viewed → lead opened →
 * contacted → checkout started → activated → still paying 30 days after activation.
 * Visits before signup live in Simple Analytics (website_submitted, email_submitted events).
 * Prints aggregates only: never tokens, emails, websites or lead content.
 */
import path from 'node:path'

type Row = Record<string, unknown>
type Db = { query: (sql: string, params?: unknown[]) => Promise<Row[]>; close: () => Promise<void> }

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function connect(): Promise<Db> {
  if (process.argv.includes('--local') || !process.env.DATABASE_URL) {
    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite(path.join(process.cwd(), '.data', 'pglite'))
    await db.waitReady
    return { query: async (sql, params) => (await db.query<Row>(sql, params)).rows, close: () => db.close() }
  }
  const pg = await import('pg')
  const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
  await client.connect()
  return { query: async (sql, params) => (await client.query(sql, params)).rows, close: () => client.end() }
}

const STAGES = [
  ['radars', 'Created'],
  ['with_email', 'Email'],
  ['search_done', 'Search done'],
  ['with_leads', '≥1 lead'],
  ['viewed', 'Viewed desk'],
  ['opened', 'Opened lead'],
  ['contacted', 'Contacted'],
  ['checkout', 'Checkout'],
  ['activated', 'Activated'],
] as const

const n = (value: unknown) => Number(value ?? 0)
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : '–')

async function main() {
  const weeks = Math.max(1, Math.min(104, Number(argument('weeks') ?? 8)))
  const bySource = argument('by') === 'source'
  const db = await connect()
  try {
    // Growth tracking (migration 009) may not be applied yet: count what exists and say what is missing.
    const [schema] = await db.query(
      `select
         exists (select 1 from information_schema.tables where table_name = 'events') as has_events,
         exists (select 1 from information_schema.columns where table_name = 'radars' and column_name = 'source_utm_source') as has_source`,
    )
    const hasEvents = Boolean(schema.has_events)
    const hasSource = Boolean(schema.has_source)
    if (!hasEvents || !hasSource) {
      console.log('⚠ supabase/migrations/009_growth_tracking.sql is not applied: desk, checkout and source columns read as empty.\n')
    }
    const event = (name: string) =>
      hasEvents ? `exists (select 1 from events e where e.radar_id = r.id and e.name = '${name}')` : 'false'
    const source = hasSource
      ? `coalesce(r.source_utm_source, r.source_referrer, case when r.source_landing_path is not null then 'direct' end, 'unknown')`
      : `'unknown'`

    const rows = await db.query(
      `with base as (
         select r.id, r.created_at, r.activated_at, r.plan,
           to_char(date_trunc('week', r.created_at), 'YYYY-MM-DD') as week,
           ${source} as source,
           r.email is not null as has_email,
           exists (select 1 from research_runs rr where rr.radar_id = r.id and rr.kind in ('initial', 'follow_up')
             and rr.status = 'completed') as search_done,
           (select min(l.created_at) from leads l where l.radar_id = r.id and l.held_reason is null) as first_lead_at,
           ${event('desk_viewed')} as viewed,
           ${event('lead_opened')} as opened,
           exists (select 1 from leads l where l.radar_id = r.id and l.user_status = 'contacted') as contacted,
           ${event('checkout_started')} as checkout,
           (select coalesce(sum(rr.cost_usd), 0) from research_runs rr where rr.radar_id = r.id) as cost
         from radars r
         where r.created_at >= date_trunc('week', now()) - make_interval(weeks => $1)
       )
       -- Strict funnel: each stage requires the previous one. A later action implies the earlier ones (contacting a
       -- lead means it was opened; paying means checkout was started), which also covers radars from before tracking.
       , stages as (
         select base.*,
           has_email as s_email,
           has_email and search_done as s_done,
           has_email and search_done and first_lead_at is not null as s_leads,
           has_email and search_done and first_lead_at is not null and (viewed or opened or contacted) as s_viewed,
           has_email and search_done and first_lead_at is not null and (opened or contacted) as s_opened,
           has_email and search_done and first_lead_at is not null and contacted as s_contacted,
           has_email and search_done and first_lead_at is not null and contacted and (checkout or activated_at is not null) as s_checkout,
           has_email and search_done and first_lead_at is not null and contacted and activated_at is not null as s_activated
         from base
       )
       select coalesce(${bySource ? 'source' : 'week'}, 'TOTAL') as cohort, grouping(${bySource ? 'source' : 'week'}) as is_total,
         count(*) as radars,
         count(*) filter (where s_email) as with_email,
         count(*) filter (where s_done) as search_done,
         count(*) filter (where s_leads) as with_leads,
         count(*) filter (where s_viewed) as viewed,
         count(*) filter (where s_opened) as opened,
         count(*) filter (where s_contacted) as contacted,
         count(*) filter (where s_checkout) as checkout,
         count(*) filter (where s_activated) as activated,
         count(*) filter (where activated_at is not null) as activated_any,
         count(*) filter (where activated_at <= now() - interval '30 days') as activated_30d_ago,
         count(*) filter (where activated_at <= now() - interval '30 days' and plan in ('active', 'past_due')) as paying_30d,
         percentile_cont(0.5) within group (order by extract(epoch from first_lead_at - created_at)) as median_ttfl_s,
         sum(cost) as cost
       from stages group by grouping sets ((${bySource ? 'source' : 'week'}), ())
       order by is_total, 1 ${bySource ? '' : 'desc'}`,
      [weeks - 1],
    )

    if (!rows.length) {
      console.log(`No radars in the last ${weeks} weeks.`)
      return
    }

    const total = rows.find((row) => row.is_total)!

    console.log(`Funnel by ${bySource ? 'first-touch source' : 'signup week (Monday)'}, last ${weeks} weeks. % = share of radars created.\n`)
    console.table(
      rows.map((row) => {
        const radars = n(row.radars)
        const line: Record<string, string | number> = { cohort: String(row.cohort), Created: radars }
        for (const [key, label] of STAGES.slice(1)) line[label] = `${n(row[key])} (${pct(n(row[key]), radars)})`
        line['Paying 30d'] = n(row.activated_30d_ago) ? `${n(row.paying_30d)}/${n(row.activated_30d_ago)}` : '–'
        line['1st lead (min)'] = row.median_ttfl_s == null ? '–' : Math.round(n(row.median_ttfl_s) / 60)
        line['Cost $'] = n(row.cost).toFixed(2)
        return line
      }),
    )

    // Step conversion on the whole window: where the funnel leaks most.
    console.log('\nStep conversion (whole window):')
    for (let index = 1; index < STAGES.length; index++) {
      const [key, label] = STAGES[index]
      const [previousKey, previousLabel] = STAGES[index - 1]
      const rate = pct(n(total[key]), n(total[previousKey]))
      console.log(`  ${previousLabel.padEnd(12)} → ${label.padEnd(12)} ${rate.padStart(5)}   (${n(total[key])}/${n(total[previousKey])})`)
    }
    const offFunnel = n(total.activated_any) - n(total.activated)
    if (offFunnel > 0) console.log(`\n${offFunnel} activation(s) skipped a stage above (e.g. paid without contacting a lead).`)
    const activated = n(total.activated_any)
    console.log(`\nResearch cost per activation: ${activated ? `$${(n(total.cost) / activated).toFixed(2)}` : '–'}`)
    if (hasEvents) {
      const [engagement] = await db.query(
        `select
           count(distinct radar_id) filter (where name = 'email_opened') as opened,
           count(distinct radar_id) filter (where name = 'email_clicked') as clicked,
           count(*) filter (where name = 'email_clicked' and props->>'link' = 'activate') as activate_clicks,
           count(*) filter (where name in ('email_bounced', 'email_complained')) as bounced_or_complained,
           count(*) filter (where name = 'checkout_started' and props->>'placement' = 'rail') as checkout_rail,
           count(*) filter (where name = 'checkout_started' and props->>'placement' = 'promo') as checkout_promo,
           count(*) filter (where name = 'checkout_started' and props->>'placement' = 'empty') as checkout_empty
         from events where created_at >= date_trunc('week', now()) - make_interval(weeks => $1)`,
        [weeks - 1],
      )
      console.log(
        `Email: ${n(engagement.opened)} radars opened, ${n(engagement.clicked)} clicked (${n(engagement.activate_clicks)} activate clicks), ${n(engagement.bounced_or_complained)} bounces/complaints.`,
      )
      console.log(
        `Checkout starts by placement: rail ${n(engagement.checkout_rail)} · in-feed promo ${n(engagement.checkout_promo)} · empty results ${n(engagement.checkout_empty)}.`,
      )
    }
  } finally {
    await db.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
