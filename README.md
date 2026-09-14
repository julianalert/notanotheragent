# Lead Radar

A visitor enters their business website. Lead Radar reads it, researches public buying signals with OpenAI's hosted web search, and shows up to five evidenced leads, each with an outreach draft, on a private link. Research runs every morning for 14 days from creation.

Built with Next.js 16 and a small subset of the Oatmeal (Tailwind Plus) design system in `src/components`. Those components are used under the [Tailwind Plus license](https://tailwindcss.com/plus/license) as part of this application and are not licensed for reuse on their own.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

- **No `OPENAI_API_KEY`** (or `RESEARCH_PROVIDER=mock`): development mode uses labelled sample output. It still goes through the real gates, and it's never used in production.
- **No `DATABASE_URL`**: an embedded Postgres (PGlite) is stored in `.data/`.
- **Supabase**: run `supabase/schema.sql` in the SQL Editor, then set `DATABASE_URL` to the Postgres connection string (Project Settings → Database). Don't use the `https://…supabase.co` project URL.
- **Scheduler**: in dev, `src/instrumentation.ts` calls it every 5 s. In production, call `GET /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.

## Research engine

Implements the research engine spec (`research-v1`, schema `lead_research_v1`).

| Piece | File |
| --- | --- |
| Pinned model, Zod result contract, versions | `src/lib/research/contract.ts` |
| System prompt, run instructions, input contract, date windows | `src/lib/research/prompt.ts` |
| Exact Responses API call, search audit, error classification, formatting repair | `src/lib/research/provider.ts` |
| Deterministic gates: references, dates, audit corroboration, scores, canonicalisation, dedupe | `src/lib/research/gates.ts` |
| Qualification fixtures (§1.8, §2.2) | `src/lib/research/gates.test.ts` |
| Run lifecycle, retries, deadlines, atomic persistence | `src/lib/scheduler.ts` |

**Normal path:** one background research request (`gpt-5.5-2026-04-23`, high reasoning, `web_search` with live access, strict schema). Then local parsing and gates. If the output has formatting defects, one tool-free repair is allowed before expiry. The gates then run again against the original search audit, so a repair can't add evidence.

**Outcomes:**
- `matches` and `no_matches` count as successful research and advance the daily watermark.
- `insufficient_coverage` and `validation_failed` publish only passing leads and don't advance the watermark.
- `website_unreadable` and `unsupported_business` show a URL-correction state.
- Provider failures record an `error_code`. Transient errors, missing search activity, incomplete output and timeouts get one automatic retry. Configuration errors, refusals and uncertain creation don't.

**Windows:** the initial run searches back 30 days. Daily runs use `max(today − 30 days, last successful run − 72 h)`.

**Deadline:** no research call, retry or repair starts at or after `research_ends_at`. This is checked in the same `UPDATE` that marks a run running.

## Verify

```bash
npm test                                   # gate fixtures
npm run smoke -- https://your-own-site.com # real compatibility check (billed; authorised sites only)
```

To test scheduling and expiry with controlled timestamps, stop the dev server and run:

```bash
node scripts/sql.mjs "update radars set next_run_at = now()"
node scripts/sql.mjs "update radars set research_ends_at = now()"
```

## Before launch (spec §2.3)

Run the seven-day pilot across three real profiles. Review every published source by hand and record each review in `evaluation_reviews`. Launch thresholds: at least 90% of candidates pass human review, zero fabricated URLs, identities or quotes, and zero duplicates. Set `COST_*` from current pricing so `cost_usd` per run is meaningful. The UI never claims facts were independently verified.
