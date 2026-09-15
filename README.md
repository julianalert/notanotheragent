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

## Email delivery

After the website step, visitors give the email address where leads should go. Research is already running while they type. Results pages without an email ask for one first.

- **What gets sent:** one email when the first research finishes (whatever the outcome), then one on each morning with new leads, for 14 days. Nothing on empty days.
- **How:** completed runs are marked `email_status = 'pending'`. The scheduler claims each one with a lease and sends through Resend, using the run id as the idempotency key. Transient failures get up to 3 attempts. Code: `src/lib/email/`.
- **Private link:** emails contain the results link, so the token is also stored encrypted with `APP_SECRET` (AES-256-GCM). Access control still uses only the token hash.
- **Unsubscribe:** every email has a signed one-click link (`List-Unsubscribe` plus a confirmation page). Opening the link only shows the page; unsubscribing needs a POST, so link scanners can't trigger it.
- **Setup:** set `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend) and `APP_SECRET`. For an existing Supabase database, run `supabase/migrations/002_email_delivery.sql`.

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
