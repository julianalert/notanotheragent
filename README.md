# Lead Radar

A visitor enters their business website. Lead Radar reads it, researches public buying signals, and shows up to five evidenced leads, each with an outreach draft, on a private link. The first three days are a free trial with no card: that first search, then a new one every morning. After that the agent sleeps. Activating it ($99/month, Stripe, no account) keeps it alive: a search every morning, the buyers' communities watched every few hours, instant alerts for strong requests, and learning from every lead the user contacts or dismisses.

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

## The first search (activation)

- **One free search per website and per email** (`FREE_RADAR_WINDOW_DAYS`, 90; 0 turns it off for local testing). A new request for a website that already has a radar, or from an email whose free radar already ran, creates nothing: the existing private link is emailed to the address it was created with (`src/lib/email/link.ts`, at most once an hour) and is never returned to the browser that asked. Radars whose website couldn't be read don't count. Hosts shared by many businesses (`SHARED_HOSTS` in `src/lib/radars.ts`) only match on the exact address.
- **Rate limits are shared**: `rateLimit()` counts per key and clock hour in the `rate_limits` table, so every serverless instance sees the same number; it falls back to a per-instance window if the table can't be reached.
- **Reachability warning**: `/api/radars/check` opens the website once with the research's own reader (`probeWebsite`, 5 s). A domain that doesn't resolve, a 404 or a refusal produces a warning; pressing the button again goes ahead. A slow or ambiguous answer says nothing.
- **Real progress**: a provider may implement `progress()`. The pipeline reports its step, when it began, and what the finished steps produced (pages read, posts found, posts worth reading, qualification groups done), projected in SQL so source texts are never loaded. The waiting page shows these; inside a step the bar eases from the step's real start time.
- **Results before the end**: `inspect()` may return `{ state: 'pending', partial }`. The scheduler's `savePartial` stores the verified profile as soon as the website is read (the waiting page shows "Here's what we understood" and the focus editor works during the wait), then publishes each qualification batch's leads through the same gates. They count towards the run's five, and the final save keeps them selected (`publishedKeys`, `maxPublished`). All of it is idempotent.
- **Qualification in batches**: sources are judged five at a time, best triage score first, by parallel background requests; the step lasts as long as one batch. A failed batch is reported as a limitation unless every batch failed.
- **Enrichment after publication**: leads are saved first; "Who they are" is looked up afterwards (`enrichLeads`) and written into `leads.data.enrichment`. A lead without that key hasn't been tried; each tick picks up leads a crashed function left behind. Its usage and cost are added to the run.
- **One free second search**: a free radar whose first search found nothing, or whose focus changed since its last search, may run one follow-up (`POST /api/radar/rerun`, `run_key = 'rerun'`): same window, the current focus, the angles the first search left untried, and only published sources excluded. It emails only when it finds something.
- **Setup:** run `supabase/migrations/010_activation.sql`.

## Email delivery

After the website step, visitors give the email address where leads should go. Research is already running while they type. Results pages without an email ask for one first.

- **What gets sent:** one email when the first research finishes (whatever the outcome), one after the free second search if it found something, and the private link again when someone starts a new search for a website or email that already has a radar. With the agent active: a morning digest on days with new leads, and an instant email when a watch run finds a strong explicit request. Nothing on empty days.
- **How:** completed runs are marked `email_status = 'pending'`. The scheduler claims each one with a lease and sends every lead not yet emailed (`leads.emailed_at`) through Resend, using the run id as the idempotency key. Transient failures get up to 3 attempts. Code: `src/lib/email/`.
- **Trial emails** (`src/lib/email/lifecycle.ts`), for radars that never paid, on the trial's clock and only between 8:00 and 20:00 in the radar's timezone: `trial_ending` the day before it ends (what was found, two leads still to review, reply tips if nothing was contacted), `trial_ended` when it ends, `missed_matches` two days later with the number of new posts that look like buyers (`probeNewMatches`: a search and triage only, Exa and Hacker News, a few cents, recorded in `lifecycle_emails.cost_usd`; not sent when it finds nothing, and the copy says the posts are unverified), and `last_call` a week after the end. Each kind has a window and later ones require the earlier ones, so radars created before this shipped get nothing. One row per radar and kind in `lifecycle_emails` is the claim; failures retry up to three times. They stop on activation or unsubscribe. Run emails say when the trial ends, or that it has.
- **Private link:** emails contain the results link, so the token is also stored encrypted with `APP_SECRET` (AES-256-GCM). Access control still uses only the token hash.
- **Unsubscribe:** every email has a signed one-click link (`List-Unsubscribe` plus a confirmation page). Opening the link only shows the page; unsubscribing needs a POST, so link scanners can't trigger it.
- **Setup:** set `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend) and `APP_SECRET`. For an existing Supabase database, run `supabase/migrations/002_email_delivery.sql`, and `011_trial_emails.sql` for the trial emails (until it is run the trial works and its emails wait).

## Billing and the agent lifecycle

- **Free trial:** a radar starts on `plan = 'free'` and its agent is live for `TRIAL_DAYS` (3) from creation, with no card: the initial run, then a morning run each day, the second search and Slack delivery included. The trial is derived from `radars.created_at` (`onTrial`, `trialEndsAt` in `src/lib/billing/subscription.ts`), so nothing is stored and no migration is needed for it. When it ends, nothing more is scheduled: the agent sleeps, the leads stay, and the desk shows the activation offer. `TRIAL_DAYS=0` turns the trial and its emails off (the old "one free search"). The marketing pages state the length from `src/lib/trial.ts`: change both together. A trial costs up to four research runs per signup instead of one; the one-per-website-and-email rule above is what bounds it.
- **Activation:** `POST /api/radar/checkout` opens Stripe Checkout (subscription, `client_reference_id` = radar id, the private link as return URL). `POST /api/stripe/webhook` verifies the signature, records the event id in `stripe_events` (redeliveries are no-ops) and applies `applyBillingEvent` (`src/lib/billing/subscription.ts`): `plan = 'active'`, `research_ends_at` = end of the paid period + 3 days grace, `next_run_at = now()` so the first paid run starts at once. `POST /api/radar/billing-portal` opens the Customer Portal for cancellation and cards.
- **Lifecycle:** `invoice.paid` extends the deadline; `invoice.payment_failed` sets `past_due` (runs continue until the grace window ends); `customer.subscription.deleted` sets `cancelled` and clears `next_run_at`. `research_ends_at` therefore still means "no research after this", so every deadline check is unchanged.
- **Setup:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`; run `supabase/migrations/008_billing_watch.sql`. Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Growth tracking

- **Marketing pages:** Simple Analytics pageviews plus the events `website_submitted`, `email_submitted` (the signup) and `existing_radar_opened` (`src/lib/client/track.ts`). The same pages store the visitor's first touch (UTM tags, referring host, landing path) in localStorage for 30 days; radar creation saves it in `radars.source_*` (`src/lib/attribution.ts`). Private pages are never reported to Simple Analytics.
- **Product events:** the `events` table holds desk actions sent by the browser to `POST /api/radar/events` (`desk_viewed`, `lead_opened`, `draft_copied`, `reply_clicked`, `draft_rewritten`, `source_opened`, `private_link_copied`, `focus_saved`, `webhook_saved`), plus `rerun_requested` (with the reason), `checkout_started` (with the button's placement), `plan_changed` (Stripe webhook) and `email_opened`, `email_clicked`, `email_bounced`, `email_complained` (`POST /api/resend/webhook`, signed with `RESEND_WEBHOOK_SECRET`). Props are short labels only: never tokens, emails, URLs or message text.
- **Funnel:** `npm run funnel` prints weekly signup cohorts through every stage, from created to paying 30 days after activation, with step conversion, time to first lead and research cost per activation. `-- --by source` groups by first touch, `-- --weeks 12` widens the window, `-- --local` reads the embedded database (stop the dev server first).
- **Setup:** run `supabase/migrations/009_growth_tracking.sql`. In Resend, add a webhook to `<APP_URL>/api/resend/webhook` for `email.opened`, `email.clicked`, `email.bounced` and `email.complained`, set `RESEND_WEBHOOK_SECRET`, and turn on open and click tracking for the sending domain.

## Watching and learning

- **One complete run per day.** An active radar runs at 8:00 local: 12 buyer situations across every connector, plus a poll of its `watched_sources` (the communities where earlier runs found posts that scored 2+ at triage; every one that produced a lead, or the three most promising until one has), then one digest email. `WATCH_INTERVAL_HOURS` (off by default) adds extra polls between morning runs (`kind = 'watch'`, smaller budgets, instant email only for an explicit request scoring at least `INSTANT_ALERT_MIN_SCORE`); they pause at `MONTHLY_RADAR_BUDGET_USD`.
- **Memory:** `seen_sources` (never re-read within 30 days once read in full and judged; a source only set aside at triage, or left unresolved, gets one more look on a later run, so a run that triaged badly doesn't blind the radar for a month), `search_stats` (per-topic hits, candidates, published, contacted: proven topics run first, dead topics are dropped), `leads.dismiss_reason` (asked with one tap when a lead is dismissed) and the contacted/dismissed leads themselves, which reach the triage and qualification prompts as `feedback`.
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

**Pipeline (default with `EXA_API_KEY`):** the application owns discovery. *Brief:* the website's offer pages are fetched and `gpt-5.5` writes the profile and acquisition brief (no tools). *Search:* 6–12 buyer situations from the brief (the head of each of the brief's lists, its headline situation, in every run; a first search takes the lists in order, daily runs rotate through the rest), sanitised (no `site:`, stacked quotes, month names or years), fan out to Exa (semantic, date-filtered, returns page text: one open-web search and one restricted to the communities Exa indexes, LinkedIn posts, Facebook groups, Indie Hackers, Threads, Quora, forums), Hacker News, and a Reddit-focused pass through OpenAI's hosted browsing (Reddit's API is closed to non-partners, servers get 403 and Exa has no Reddit content); results are deduplicated by source key and known opportunities, seen sources and judged candidates are dropped. *Triage:* `gpt-5-mini` scores each hit 0–3 from its preview; Reddit hits often have none, so they carry the title from their URL and are judged on title and subreddit. *Read:* the top hits are fetched as text; pages that block servers get their text from Exa's contents endpoint (LinkedIn, Facebook) or, for Reddit, from OpenAI's hosted browsing (at most 16 per run). *Qualify:* `gpt-5.5` (medium reasoning, background mode, no tools, strict schema) judges only the supplied sources, five per request, the requests side by side. The audit the gates check is exactly the set of pages the application read, so nothing is lost to an unverifiable tool audit. State lives in `pipeline_runs`; a failing step retries on its own.

**Hosted search (`RESEARCH_PROVIDER=openai`):** one background research request (`gpt-5.5-2026-04-23`, medium reasoning, `web_search` with live access and a per-mode tool-call cap, strict schema). Then local parsing and gates. If the output has formatting defects, one tool-free repair (`gpt-5-mini`) is allowed before expiry. The gates then run again against the original search audit, so a repair can't add evidence.

**Intents:** `explicit_request` (asks for help or a provider), `stated_problem` (describes the problem), `trigger_event` (a public event that creates the need now: hiring for the role the offer replaces, a launch, funding, expansion). Needs may match a documented service or a documented problem solved; job titles never match.

**Outcomes:**
- `matches` and `no_matches` count as successful research and advance the daily watermark.
- `insufficient_coverage` and `validation_failed` publish only passing leads and don't advance the watermark.
- `website_unreadable` and `unsupported_business` show a URL-correction state.
- Provider failures record an `error_code`. Transient errors, missing search activity, incomplete output and timeouts get one automatic retry. Configuration errors, refusals and uncertain creation don't.

**Windows:** the initial run searches back 90 days, and so do the morning runs of a radar's first 7 days (the first search covers a fraction of that window; memory keeps out repeats). Daily runs search back 30 days (or to the last successful run − 72 h after a longer gap, at most 90 days); the radar's memory of seen sources, judged candidates and leads keeps out repeats.

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
