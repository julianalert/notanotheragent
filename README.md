# Lead Radar

A visitor enters their business website. Lead Radar reads it, researches public buying signals, and shows up to five evidenced leads, each with an outreach draft, on a private link. That first search is free. Activating the agent ($99/month, Stripe, no account) keeps it alive: a search every morning, the buyers' communities watched every few hours, instant alerts for strong requests, and learning from every lead the user contacts or dismisses.

Two design systems:

- **Marketing** (`src/app/(marketing)`): the Oatmeal kit (Tailwind Plus).
- **Desk** (`src/app/(desk)`): the private radar app (searching, no results, leads), styled by `src/app/(desk)/desk.css`. Keyboard: `j`/`k` move, `Enter` opens, `c` contacted, `x` dismiss, `Esc` closes.

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

- **What gets sent:** one email when the first research finishes (whatever the outcome). With the agent active: a morning digest on days with new leads, and an instant email when a watch run finds a strong explicit request. Nothing on empty days.
- **How:** completed runs are marked `email_status = 'pending'`. The scheduler claims each one with a lease and sends every lead not yet emailed (`leads.emailed_at`) through Resend, using the run id as the idempotency key. Transient failures get up to 3 attempts. Code: `src/lib/email/`.
- **Private link:** emails contain the results link, so the token is also stored encrypted with `APP_SECRET` (AES-256-GCM). Access control still uses only the token hash.
- **Unsubscribe:** every email has a signed one-click link (`List-Unsubscribe` plus a confirmation page). Opening the link only shows the page; unsubscribing needs a POST, so link scanners can't trigger it.
- **Setup:** set `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend) and `APP_SECRET`. For an existing Supabase database, run `supabase/migrations/002_email_delivery.sql`.

## Billing and the agent lifecycle

- **Free:** a radar starts on `plan = 'free'`. Its initial run (and manual retries, for `RESEARCH_PERIOD_DAYS`) is the only research. Nothing is scheduled afterwards.
- **Activation:** `POST /api/radar/checkout` opens Stripe Checkout (subscription, `client_reference_id` = radar id, the private link as return URL). `POST /api/stripe/webhook` verifies the signature, records the event id in `stripe_events` (redeliveries are no-ops) and applies `applyBillingEvent` (`src/lib/billing/subscription.ts`): `plan = 'active'`, `research_ends_at` = end of the paid period + 3 days grace, `next_run_at = now()` so the first paid run starts at once. `POST /api/radar/billing-portal` opens the Customer Portal for cancellation and cards.
- **Lifecycle:** `invoice.paid` extends the deadline; `invoice.payment_failed` sets `past_due` (runs continue until the grace window ends); `customer.subscription.deleted` sets `cancelled` and clears `next_run_at`. `research_ends_at` therefore still means "no research after this", so every deadline check is unchanged.
- **Setup:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`; run `supabase/migrations/008_billing_watch.sql`. Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Watching and learning

- **One complete run per day.** An active radar runs at 8:00 local: 12 buyer situations across every connector, plus a poll of its `watched_sources` (the communities where earlier runs found candidates, toggleable on the page), then one digest email. `WATCH_INTERVAL_HOURS` (off by default) adds extra polls between morning runs (`kind = 'watch'`, smaller budgets, instant email only for an explicit request scoring at least `INSTANT_ALERT_MIN_SCORE`); they pause at `MONTHLY_RADAR_BUDGET_USD`.
- **Memory:** `seen_sources` (never re-read within 30 days; an unresolved one may be checked once more), `search_stats` (per-topic hits, candidates, published, contacted: proven topics run first, dead topics are dropped), `leads.dismiss_reason` (asked with one tap when a lead is dismissed) and the contacted/dismissed leads themselves, which reach the triage and qualification prompts as `feedback`.
- **Focus:** besides the service subset and market, the user can write who they want and who to skip; both steer search and qualification without adding undocumented services.

## Actionable leads

- **Enrichment** (`src/lib/research/enrich.ts`): after the gates, each published lead gets its public business footprint (company site, one public profile or company page, role, location, a one-line company description) from a small model with a few hosted searches. Every finding must be backed by a page the search consulted that mentions the author's handle, name or company; personal contact details are never sought. Shown in the drawer as "Who they are" with a confidence label.
- **Reply**: the drawer's primary action. Reddit authors get a prefilled direct message; a `mailto:` contact route gets subject and body; otherwise the contact route opens with the message on the clipboard. The lead is marked contacted (undo in the toast). Nothing is ever sent by the app.
- **Rewrite**: shorter, more direct or friendlier variants of the first message (`POST /api/radar/leads/[id]/draft`), kept beside the original.
- **Slack / webhook**: an https webhook per radar (`PATCH /api/radar/webhook`) receives a compact message with each run's new leads.

## Research engine

Two providers produce the same `lead_research_v3` result; the gates, scheduler, page and emails don't care which ran.

| Piece | File |
| --- | --- |
| Pinned model, Zod contracts (result, brief, triage), versions, pipeline budgets | `src/lib/research/contract.ts` |
| Prompts (hosted-search system prompt; pipeline brief, triage and qualify prompts), query rules, topics | `src/lib/research/prompt.ts` |
| Hosted-search provider: exact Responses API call, search audit, error classification, formatting repair | `src/lib/research/provider.ts` |
| Discovery pipeline provider: brief → search → triage → read → qualify, one step per tick | `src/lib/research/pipeline.ts` |
| Search connectors: Exa, Reddit, Hacker News, OpenAI web_search fallback; fan-out and merge | `src/lib/research/search/` |
| Page reader (HTML to text, Reddit JSON, website offer pages) | `src/lib/research/pages.ts` |
| Deterministic gates: references, dates, audit corroboration, scores, canonicalisation, dedupe | `src/lib/research/gates.ts` |
| Qualification fixtures (§1.8, §2.2) and pipeline rules | `src/lib/research/gates.test.ts` |
| Run lifecycle, retries, deadlines, atomic persistence | `src/lib/scheduler.ts` |

**Pipeline (default with `EXA_API_KEY`):** the application owns discovery. *Brief:* the website's offer pages are fetched and `gpt-5.5` writes the profile and acquisition brief (no tools). *Search:* 6–12 buyer situations from the brief, sanitised (no `site:`, stacked quotes, month names or years), fan out to Exa (semantic, date-filtered, returns page text: one open-web search and one restricted to the communities Exa indexes, LinkedIn posts, Facebook groups, Indie Hackers, Threads, Quora, forums), Hacker News, and a Reddit-focused pass through OpenAI's hosted browsing (Reddit's API is closed to non-partners, servers get 403 and Exa has no Reddit content); results are deduplicated by source key and known opportunities, seen sources and judged candidates are dropped. *Triage:* `gpt-5-mini` scores each hit 0–3 from its preview. *Read:* the top hits are fetched as text; pages that block servers get their text from Exa's contents endpoint (LinkedIn, Facebook) or, for Reddit, from OpenAI's hosted browsing (at most 8 per run). *Qualify:* `gpt-5.5` (medium reasoning, background mode, no tools, strict schema) judges only the supplied sources. The audit the gates check is exactly the set of pages the application read, so nothing is lost to an unverifiable tool audit. State lives in `pipeline_runs`; a failing step retries on its own.

**Hosted search (`RESEARCH_PROVIDER=openai`):** one background research request (`gpt-5.5-2026-04-23`, medium reasoning, `web_search` with live access and a per-mode tool-call cap, strict schema). Then local parsing and gates. If the output has formatting defects, one tool-free repair (`gpt-5-mini`) is allowed before expiry. The gates then run again against the original search audit, so a repair can't add evidence.

**Intents:** `explicit_request` (asks for help or a provider), `stated_problem` (describes the problem), `trigger_event` (a public event that creates the need now: hiring for the role the offer replaces, a launch, funding, expansion). Needs may match a documented service or a documented problem solved; job titles never match.

**Outcomes:**
- `matches` and `no_matches` count as successful research and advance the daily watermark.
- `insufficient_coverage` and `validation_failed` publish only passing leads and don't advance the watermark.
- `website_unreadable` and `unsupported_business` show a URL-correction state.
- Provider failures record an `error_code`. Transient errors, missing search activity, incomplete output and timeouts get one automatic retry. Configuration errors, refusals and uncertain creation don't.

**Windows:** the initial run searches back 30 days. Daily runs use `max(today − 30 days, last successful run − 72 h)`.

**Deadline:** no research call, retry or repair starts at or after `research_ends_at`. This is checked in the same `UPDATE` that marks a run running.

## Verify

```bash
npm test                                                      # gate fixtures and pipeline rules
npm run research:eval -- --provider pipeline https://your-own-site.com   # real run, no database (billed; authorised sites only)
npm run research:eval -- --provider openai https://your-own-site.com     # same site through the hosted-search provider, to compare
```

The eval prints the brief, every executed search, every candidate with its decision, cost, and, when `evals/golden/<host>.json` lists accepted source URLs, precision and recall.

To test scheduling and expiry with controlled timestamps, stop the dev server and run:

```bash
node scripts/sql.mjs "update radars set next_run_at = now()"
node scripts/sql.mjs "update radars set research_ends_at = now()"
```

## Verify billing and watching locally

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook   # STRIPE_WEBHOOK_SECRET = the printed whsec_…
node scripts/sql.mjs "select id, plan, next_run_at, research_ends_at from radars"
node scripts/sql.mjs "update radars set last_watch_at = null"   # make a watch run due on the next tick
```

## Before launch (spec §2.3)

Run the seven-day pilot across three real profiles. Review every published source by hand and record each review in `evaluation_reviews`. Launch thresholds: at least 90% of candidates pass human review, zero fabricated URLs, identities or quotes, and zero duplicates. Set `COST_*` from current pricing so `cost_usd` per run is meaningful. The UI never claims facts were independently verified.
