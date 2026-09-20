# Flywheel Audit v2: Not Another Agent

Product-led growth audit and action plan · 19 September 2026 · follows `docs/plg-audit.md` (v1)

This audit is qualitative. It comes from a line-by-line read of the marketing site, signup, desk, emails, billing and measurement code in `lead-radar/`, and uses no production numbers. Every finding points at the code that causes it, and every action names the metric that proves it worked. Paths are relative to `lead-radar/`; `(m)` stands for `src/app/(marketing)` and `(d)` for `src/app/(desk)/r/[token]`.

v1 made the funnel measurable (its Phase 1 is shipped). Its items 5–17 are all still open (appendix A). v2 goes deeper into each stage, adds a stage v1 didn't have (promise integrity), and re-sequences the plan.

## 1. Summary

**North-star metric:** leads contacted per week by paying radars. Unchanged from v1, and still not computed anywhere (action M3).

**The flywheel:** visit → website → email → wait 4–10 min → first-leads email → open desk → open a lead → **contact a lead (aha)** → activate at $99/month → morning digests → contact more leads → keep paying → tell others → visit.

**The five biggest leaks, in the order they should be fixed**

1. **The product promises things it doesn't do.** "Watched every few hours" and "instant alerts" are sold in eight places while watch runs are off by default. The free zero-lead email says "we'll search again every morning", which is false. Free users are told their dismissals shape "the next searches" that never run. The hero shows nine unlabelled fictional leads, three from sources the engine doesn't search, next to two unsourced stats, and the site has no privacy policy, terms or contact. For a $99 product with no account and no sales call, trust is the only thing converting, and it leaks at every stage.
2. **The wait is long and handled badly.** Four to ten minutes, a simulated progress bar that sits at 46% for most of it, one instruction ("close this tab"), no way to save the link on that screen, and nothing shown until the whole run lands.
3. **The free tier is a dead end, and the paywall is timed by lead count rather than by the aha moment.** One search, one email, settings that can't do anything, no re-run after an empty result, no signal when the 14-day window closes. The in-feed offer appears only with three or more leads and ignores whether the user has contacted anyone.
4. **Paying users can't see what they're paying for.** Quiet days are silent, outcomes aren't tracked so there's no ROI, the learning is invisible, the post-purchase moment is a four-second toast, and the only dunning is a footer line that ships on days with leads.
5. **Nothing the product emits points back to it.** Emails, Slack posts and forwarded digests carry no link; nothing is safe to share; two pages are indexable.

**The ten moves that matter most** (detail in section 4)

| # | Move | Stage | Effort |
|---|---|---|---|
| 1 | Turn watch runs on for paid radars, or rewrite the eight copy sites | Trust, retention | S |
| 2 | Make every free-tier sentence true (email, toast, focus hint) | Trust | S |
| 5 | Privacy, terms and a contact address | Trust, signup | S |
| 9 | Real progress from the pipeline step, plus "copy my link" on the wait screen | Activation | S–M |
| 10 | Show the brief during the wait and let the user correct it | Activation | M |
| 12 | One free re-run on the same radar after an empty result or a focus edit | Activation | M |
| 14 | Offer the agent right after the first contacted lead | Free → paid | S |
| 16 | Free nurture sequence with a "N new matches since your search" teaser | Free → paid | M |
| 21 | Quiet-day receipt and weekly recap | Retention | M |
| 22 | Outcomes (replied, meeting, won) and an ROI panel | Retention | M |

## 2. Scorecard

| Stage | What happens today | Score (1–5) | Main leak | Metric |
|---|---|---|---|---|
| Measurement | Attribution, `events`, `npm run funnel` (v1 Phase 1) | 3.5 | No impressions, no sends, no experiments, north-star not computed | % of plan metrics the funnel can print |
| Promise integrity | Copy ahead of the product in 8+ places; weak proof; no legal pages | 2 | Paid promises that don't run | Promises with a matching default config: 100% |
| Acquisition | Two indexable pages, no loops | 2.5 | Product output never leaves the private link | Organic + referral signups per week |
| Signup | Website, then email; no account, no card | 3 | Email asked before any value; a typo burns the free search | `website_submitted` → `email_submitted` |
| Activation | 4–10 min wait, up to 5 leads, all at the end | 2.5 | Fake progress, "close this tab", zero-lead dead end | Signup → ≥1 lead → contacted within 7 days |
| Free → paid | $99/month, no trial, one email ever | 2 | Offer timed by lead count; no reason to return | Contacted → checkout → activated |
| Retention | 8:00 digest on days with leads | 2 | Silent quiet days, no ROI, no dunning | Paying at 30/60/90 days |
| Expansion | One radar = one token = one Stripe customer | 1.5 | No recovery, no multi-site, no seats | Radars per paying email |
| Referral | None | 1 | Nothing shareable, nothing links back | % signups from shared or referred visits |

Signup drops from 3.5 (v1) to 3 because of the mobile CTA gap, the missing reachability check and the absent legal pages.

## 3. Findings by stage

### 3.1 Promise integrity (new, cuts across every stage): 2/5

**Paid promises that don't run by default.** `WATCH_INTERVAL_HOURS` defaults to 0 (`src/lib/config.ts:17`) and `enqueueDueWatchRuns` returns immediately (`src/lib/scheduler.ts:114`). Instant emails only come from watch runs (`scheduler.ts:642-656`), so they never fire. Yet the claim is made in:

- `(m)/site-faq.tsx:24` "polls the communities where it found your buyers every few hours, emails you the moment a strong request appears"
- `(m)/site-faq.tsx:43` "an instant note when someone posts a strong explicit request"
- `(m)/pricing.tsx:19-20` "Your buyers' communities watched through the day", "Instant email when a strong request appears"
- `(d)/screens.tsx:214` (shown to **paying** users on an empty day), `(d)/desk-app.tsx:612,613,647`, the rail bullet "Watches where buyers post" (`(d)/rail.tsx`), and `README.md:3` (contradicted by `README.md:51`).

A customer who pays for "through the day" and gets one run at 8:00 has a legitimate refund reason. v1 flagged this as item 5; it's unchanged and now in more places.

**Free-tier sentences that are false.**

- The zero-lead first email says "we'll search again every morning" (`src/lib/email/templates.ts:88`). Free radars are never re-run (`scheduler.ts:86` requires `plan in ('active','past_due')`). Its subject, "Your research for {host} has started" (`templates.ts:57`), describes a run that has finished.
- Dismiss toast: "Noted. The next searches will avoid leads like this." (`(d)/desk-app.tsx:270`). Focus editor: "Changes apply to the next search." (`(d)/screens.tsx:360`). Neither can happen on a free radar.

**Proof that doesn't hold up.**

- Nine fictional lead cards in the hero with real platform logos, handles and "5 hours ago" timestamps, and no visible "Example" label (`(m)/lead-carousel.tsx:16-114`; the only label is an `aria-label` at `:185`). The feature demos two sections later do carry one (`(m)/home-demos.tsx:44`).
- Three of those cards (X, Upwork, Product Hunt; `lead-carousel.tsx:62,73,84`) are sources the engine doesn't search: see `COMMUNITY_DOMAINS` and the comment "Exa has no Reddit or X content at all" (`src/lib/research/search/index.ts:37-53`).
- "$100k lead pipeline built in the first month" and "x10 new conversations" (`(m)/page.tsx:156-157`) have no source or qualifier, and the graph beside them is a decorative path. Nothing in the product measures pipeline.
- One of three testimonials is the founder quoting his own product (`(m)/customers.tsx`).

**No legal surface.** A grep of `src` for privacy, terms or legal returns nothing. The footer has four internal anchors and an X link (`(m)/site-chrome.tsx:36-47`). The site collects emails, sends marketing email and takes card payments; this is a GDPR and Stripe requirement as well as a conversion one (B2B buyers look for it before typing a work email).

**The free offer is never sized.** Nothing on `/` or `/pricing` says "up to 5 leads" (`TARGET_COUNT = 5`, `src/lib/research/contract.ts:55`). "Your first leads usually arrive within minutes" (`(m)/page.tsx:167`, `(m)/pricing/page.tsx:73`) sits against a typical 4–10 minutes and a 25-minute pipeline deadline (`contract.ts:48`). The hero headline ("Wake up to…", `page.tsx:73`) describes the paid product while the form under it sells the free one.

**Metric:** count of user-facing promises with no matching default behaviour (today ≥ 12; target 0), refund and chargeback count, cancel reasons once captured (action 23).

### 3.2 Acquisition: 2.5/5

- Two indexable URLs (`src/app/sitemap.ts`). No blog, use-case, vertical, comparison or programmatic pages.
- No structured data. The seven-item FAQ (`(m)/site-faq.tsx`) is a ready-made `FAQPage`.
- The homepage calls `cookies()` (`(m)/page.tsx:27`), so it's rendered dynamically for every visitor and crawler instead of being served static.
- No loop on any output: the email header renders the brand as plain text and every link goes to the private page, the activate anchor or unsubscribe (`templates.ts:142,157,163`); the Slack payload has no product name or URL (`src/lib/email/webhook.ts:9-15`). A digest forwarded to a co-founder, or a lead posted in a team channel, is anonymous.
- Nothing is safe to share: the private link gives full access, including billing (`(d)/desk-app.tsx:511`), and the FAQ tells users to keep emails private.
- `?website=` prefills the hero field (`page.tsx:80`) but doesn't advance, so an outreach link that already knows the prospect's domain still costs two clicks. Click ids (`gclid`, `fbclid`) aren't captured as attribution.
- **Metric:** signups per week by source (`npm run funnel -- --by source`), indexed pages, % of signups with a referral or shared-page first touch.

### 3.3 Signup: 3/5

- Strong: two fields, no account, no card; research starts within a second of the email (`src/app/api/radars/route.ts:71`).
- The email is asked for with nothing shown in between. The only justification is "💌 Where should we send your leads?" (`(m)/website-form.tsx:49`).
- Validation is syntactic only (`src/lib/url.ts:32-68`). `youragnecy.com` passes both steps and spends the visitor's one free search; they find out from the unreadable-website screen and email.
- Step 2 has no back link and step 1 isn't persisted, so a refresh restarts the form (`website-form.tsx`, local state only).
- No nav CTA under 640 px for new visitors: the button is `max-sm:hidden` (`page.tsx:53`) and the mobile dialog renders only `links` (`src/components/sections/navbar-with-logo-actions-and-left-aligned-links.tsx:96`).
- `/pricing` never reads the radar cookie, so a returning user sees "Get my first leads" there; its navbar also drops the "Questions" link although the FAQ renders on the page.
- The 429 says "Too many new searches from this browser" for an IP-keyed limit and is attached to the email field (`api/radars/route.ts:46-48`).
- The limiter is a per-instance in-memory map (`src/lib/http.ts:19-23`) and `createRadar` has no host or email dedupe, so on serverless the free search (about $0.40–0.50 each) has no real ceiling. Not a growth problem today; it becomes one the day acquisition works.
- FAQ gaps: how long it takes, how many leads, what happens if nothing is found, who it works for.
- **Metric:** `website_submitted` → `email_submitted`; share of initial runs ending `website_unreadable`; mobile vs desktop signup rate.

### 3.4 Activation: 2.5/5

- **Simulated progress with a dead zone.** The file says so (`(d)/screens.tsx:10-15`). Sub-steps advance every 5 s (`:61-71`) through a fixed map `{1:10, 2:28, 3:46, 4:75, 6:100}` (`:26`). The backend only reports `running` → `processing` → `completed` (`:29-40`), and `processing` begins when the pipeline is already done. So the bar reaches 46% in 10 seconds and stays there for minutes. The real step (`brief`, `search`, `triage`, `read`, `qualify`) and its counts live in `PipelineState` (`src/lib/research/pipeline.ts:70,246`) and are never shown.
- **The only instruction is to leave**: "You can close this tab" (`screens.tsx:17,80`) and the 💌 footer. The focus layout has no topbar, so "Copy private link" (`(d)/desk-app.tsx:511`) isn't available while waiting. A user who closes the tab depends on the cookie or on the email arriving.
- **Nothing is shown until everything is done.** Leads are written in one transaction at the end (`scheduler.ts:671-827`), after enrichment of every lead with a 45 s budget each (`scheduler.ts:570-573`). The brief (what we understood about the business) exists 30–90 seconds in and is the cheapest early value available.
- The profile is never confirmed before the search; the focus editor only appears after results.
- **A completed zero-lead run has no retry.** Retry covers failed runs only. The empty screen offers a different URL, which creates a new radar with a new token and orphans the old one (`(d)/forms.tsx`, `createRadar`).
- `AUTOMATIC_FOLLOW_UPS = false` (`contract.ts:32`) leaves the "Checking more angles" branch (`screens.tsx:202-208`) unreachable. The email-required screen is unreachable too, since creation requires an email.
- Strong: the lead itself. Evidence, fit, enrichment, editable draft, AI rewrites and a one-click Reply that marks the lead contacted. Nothing is blurred or gated. Once a user gets to a lead, the aha moment is one click away.
- **Metric:** median minutes to first lead; share of radars whose desk is never viewed after the wait; ≥1 lead → opened → contacted within 7 days; share of first searches with zero leads.

### 3.5 Free → paid: 2/5

- **Offer timing ignores the aha moment.** `showPromo` needs `rows.length > 2` and puts the card after the second lead (`(d)/desk-app.tsx:426,642`). A user with one or two leads never sees it; a user with five sees it before contacting anyone. There's no prompt after `reply_clicked`, the highest-intent moment in the product.
- "You have worked through your list" (`desk-app.tsx:604-613`) tells a free user the agent is asleep and offers no button.
- On an empty first search, the $99 button sits above the re-run form (`(d)/screens.tsx:218-232`): the product asks for money right after failing (v1 item 11, unchanged).
- On unreadable and unsupported sites the rail shows the $99 pitch with "Available once your first search is done." (`(d)/rail.tsx:147`): a price with nothing to buy.
- **No reason to come back.** One email ever. The 14-day window (`config.ts:7`) closes with no banner, countdown or email. "New search" with the same site returns the same radar.
- **No risk reversal.** No trial, guarantee or annual price. `createCheckoutSession` sets no `trial_period_days` (`src/lib/billing/stripe.ts:19-33`), although `trialing → active` is already mapped (`src/lib/billing/subscription.ts:19-21`). Promotion codes are allowed and unused.
- **Thin post-purchase moment.** A four-second toast, "Your agent is live. Its first search starts now." (`desk-app.tsx:206-216`). No confirmation email, no setup of what just unlocked (Slack, timezone), no progress for the first paid run, and the rail reads "0 leads found today" for the 5–10 minutes it takes. Returning from a cancelled checkout is silent.
- Email clicks on "Activate my agent →" land on `#activate` and are recorded as placement `rail` (`templates.ts:130`, `api/radar/checkout/route.ts:24`).
- **Metric:** contacted → checkout by placement; checkout → activated; activation rate of zero-lead radars; share of free radars returning after day 1.

### 3.6 Retention: 2/5

- **Quiet days are silent.** A daily run with no new leads sets `email_status = 'skipped'` (`scheduler.ts:657-659`); the desk shows "0 leads found today". Nothing says "we searched 12 situations, read 40 pages and rejected 9". A quiet week looks like a broken product.
- **No outcomes, so no ROI.** Statuses stop at `new | contacted | dismissed` (`supabase/schema.sql:86`). The product can't show that a $99 month produced a conversation, and the "$100k" claim can't be backed.
- **Learning is real and invisible.** Contacted and dismissed leads, dismiss reasons and topic stats feed the next prompts (`scheduler.ts:233-238`, `src/lib/radars.ts:361-380`). Nothing tells the user "your agent has learned from 14 decisions".
- **Dunning is a footer line** (`templates.ts:94`) that only goes out on days with leads, plus a rail warning the user has to open the desk to see. The three-day grace (`subscription.ts:12`) is invisible. The cancelled footer has no link (`templates.ts:157`). No cancellation reason is captured; no cancel confirmation or win-back email exists.
- Watched-sources toggles are implemented server-side (`src/app/api/radar/sources/route.ts`, `radars.ts:150,348`) with no UI.
- **Metric:** paying at 30/60/90 days; churn in weeks with zero emails vs weeks with at least one; recovered failed payments; leads contacted per paying radar per week.

### 3.7 Expansion and referral: 1.5/5 and 1/5

- Identity is one token plus a 60-day cookie. On a new device the only recovery is an old email. No "email me my links", no list of radars.
- A second website means a second token, a second Stripe customer and a second $99, with no shared view or volume price. No seats, although agencies are teams.
- No referral primitive, no share-safe artifact, no link-back (see 3.2).
- **Metric:** radars per paying email; % of signups from referral or shared pages.

### 3.8 Measurement after Phase 1: 3.5/5

- **No impressions.** `checkout_started` carries a placement, but nothing records that an offer was shown, so placement conversion can't be computed. The funnel prints raw starts only (`scripts/funnel.ts:164-174`).
- **Sends aren't events.** Opens and clicks carry `kind` and `plan`, but without a sent count there's no rate, and the funnel doesn't group by kind.
- The funnel never reads `user_status_at` (time to contact), counts `past_due` as retained (`funnel.ts:117`), stops at 30 days, ignores unsubscribes and doesn't compute the north-star. `activated_at` is overwritten on reactivation (`subscription.ts:71,79`), which resets win-backs into a new cohort.
- Marketing events are three names with no props (`src/lib/client/track.ts:12`): no form position, no form errors, no "email step viewed". Simple Analytics and the `events` table share no id, so they only compare in aggregate.
- No experiment or variant field anywhere, so none of the tests below can be read cleanly.
- Unknown from the code: whether v1's go-live checklist (migration 009, Resend webhook, open tracking) has been run in production.

## 4. Action plan

ICE = Impact · Confidence · Ease, each out of 10; the score is their average. Effort: S ≤ 2 days, M ≤ 1 week, L > 1 week. "v1 #n" marks an item carried over from v1. The order follows one rule: stop promising what isn't delivered, then shorten the path to the first contacted lead, then ask for money at that moment, then give paying users proof, then build loops. Loops come last on purpose (section 7).

### Sprint 0, this week: integrity and hygiene

| # | Initiative | ICE | Effort | Where | Metric |
|---|---|---|---|---|---|
| 1 | **Reconcile the watch promise (v1 #5).** Recommended: set `WATCH_INTERVAL_HOURS=6` in production for paid radars (already capped by `MONTHLY_RADAR_BUDGET_USD=25` against $99 revenue), check two weeks of watch-run yield, then keep or drop. Otherwise rewrite the eight copy sites to "every morning". | 8·9·9 = 8.7 | S | Vercel env, or `site-faq.tsx`, `pricing.tsx`, `screens.tsx:214`, `desk-app.tsx:612-647`, `rail.tsx`, `README.md:3` | Promises without matching behaviour → 0; instant emails sent per paid radar |
| 2 | **Plan-aware copy.** Free zero-lead email: new subject ("We searched for {host}: no verified match yet") and an honest intro; dismiss toast and focus hint say what happens on free (or become true with #12). | 6·9·9 = 8.0 | S | `templates.ts:57,67,88`, `desk-app.tsx:270`, `screens.tsx:360` | Opens and clicks on zero-lead emails |
| 3 | Label the hero cards "Example", and replace X, Upwork and Product Hunt with sources that are searched (Facebook groups, Quora, Threads, forums). | 5·8·10 = 7.7 | S | `lead-carousel.tsx` | Visitor → `website_submitted` |
| 4 | Replace the two stats with attributable ones (a named customer's number, or product facts such as "every lead links to its source"); swap the founder quote for a third customer. | 5·7·9 = 7.0 | S | `page.tsx:145-158`, `customers.tsx` | Same |
| 5 | Privacy policy, terms, a contact address in the footer and in emails. | 6·8·8 = 7.3 | S | new `(m)/privacy`, `(m)/terms`, `site-chrome.tsx`, `sitemap.ts`, `templates.ts` footer | `website_submitted` → `email_submitted` |
| 6 | Size the free offer everywhere: "up to 5 evidenced leads, by email in about 5–10 minutes". Add three FAQ entries (how long, how many, what if nothing). Drop "within minutes". | 6·7·10 = 7.7 | S | `page.tsx:167`, `pricing/page.tsx:73`, `site-faq.tsx`, `website-form.tsx:95` | Signup rate; desk viewed after the wait |
| 7 | Signup papercuts: mobile nav CTA, cookie-aware `/pricing` with its "Questions" link, step-2 back link and persisted step, correct 429 copy on the right field. | 4·8·9 = 7.0 | S | navbar component, `pricing/page.tsx`, `website-form.tsx`, `email-form.tsx`, `api/radars/route.ts:47` | Mobile signup rate |
| 8 | `FAQPage`, `Organization` and `SoftwareApplication` JSON-LD; move the cookie read into a client component so `/` is static. | 4·7·8 = 6.3 | S | `site-faq.tsx`, `page.tsx:27`, `(m)/layout.tsx` | Rich results, LCP |

### Sprint 1, weeks 1–3: shorten the path to the first contacted lead

**Status, 20 September 2026: all seven shipped on branch `sprint-1-activation`** (see "The first search (activation)" in `README.md`). Go-live: run `supabase/migrations/010_activation.sql`, deploy, then watch median time to first lead, zero-lead recovery and research cost per activation in `npm run funnel`. Not yet measured in production. Two things differ from the plan below: corrections made during the wait filter this search's results by service and otherwise feed the free second search (the search step has usually started by the time the brief is visible); and #32 emails the existing link to its owner instead of returning it, because the person typing a website isn't necessarily the person who created its radar.

| # | Initiative | ICE | Effort | Where / reuse | Metric |
|---|---|---|---|---|---|
| 9 | **Real progress.** Expose the pipeline step and counts on the run view ("Read 6 pages of your site · 143 posts found · 38 worth reading · checking 12"); drop the timer. Add "Copy my private link" and "we'll email {address}" to the wait screen. | 8·8·7 = 7.7 | S–M | `pipeline.ts` state → `radars.ts` run view → `screens.tsx` `Searching`; reuse the topbar copy-link handler | Desk viewed after wait; `private_link_copied` during wait |
| 10 | **Show the brief during the wait (v1 #6).** Once `brief` is done (30–90 s), show "Here's what we understood: you sell…, to…" with the existing `FocusEditor` to correct it; corrections apply to this run if `search` hasn't started, otherwise to the re-run (#12). | 8·7·6 = 7.0 | M | `pipeline.ts` brief output, `FocusEditor` (`screens.tsx`), `api/radar/focus` | ≥1 lead rate; dismiss rate; wait abandonment |
| 11 | Reachability probe at step 1: fetch the site once with a short timeout and warn ("We couldn't open youragnecy.com. Is the address right?") without blocking. | 6·8·8 = 7.3 | S | `api/radars/check/route.ts`, fetcher in `src/lib/research/pages.ts` | Share of `website_unreadable` first runs |
| 12 | **One free re-run on the same radar** after a zero-lead result, or after the first focus edit. Makes "changes apply to the next search" true, removes the orphan-radar flow, and gives free users one reason to return. Costs about $0.45; cap at one. | 8·7·7 = 7.3 | M | `radars.ts` (next to `retryInitialRun`), `api/radar/retry`, `screens.tsx` `NoResults` | Zero-lead radars recovered to ≥1 lead; research cost per activation (guardrail) |
| 13a | Publish first, enrich after: save leads when qualification ends and fill "Who they are" as each enrichment returns. Saves up to 45 s. | 5·7·6 = 6.0 | S–M | `scheduler.ts:570-585`, drawer placeholder in `leads.tsx` | Median time to first lead |
| 13b | Stream leads as they qualify (v1 #7): qualify in batches and publish each batch. | 8·6·3 = 5.7 | L | `pipeline.ts` `qualify`, `scheduler.ts` `saveResults` | Same; target under 3 min |
| 32 | Abuse ceiling before acquisition scales: one free radar per host and per email (return the existing one by email instead), limiter in Postgres. | 4·8·7 = 6.3 | S–M | `radars.ts` `createRadar`, `http.ts` `rateLimit` | Research cost per signup |

### Sprint 2, weeks 2–5: ask at the right moment, and give free users a reason to return

**Status, 20 September 2026: #16 and the trial half of #18 shipped together on branch `trial-nurture`**, in a different shape from the rows below. The trial is 3 days with no card (the agent simply works, then sleeps), not a 7-day Stripe trial; it is on for everyone, so compare cohorts before and after rather than reading it as a split test. The nurture sequence follows the trial: the morning digests are the day-1 and day-2 touch, then `trial_ending`, `trial_ended`, `missed_matches` (the probe teaser) and `last_call`. Guardrail to watch: research cost per activation, since a trial costs up to four runs per signup. #14, #15, #17 and the annual price are not done.

| # | Initiative | ICE | Effort | Where / reuse | Metric |
|---|---|---|---|---|---|
| 14 | **Paywall after the aha (v1 #8).** After the first `reply_clicked` or contacted: an inline card, "That's one conversation started. Your agent can bring you new ones every morning." Gate the in-feed card on contacted ≥ 1 or list finished, not on `rows.length > 2`. Add the button to "You have worked through your list". | 8·7·8 = 7.7 | S | `desk-app.tsx:280-329,426,600-662`; placements `after_contact`, `list_done` | Contacted → checkout, by placement |
| 15 | Empty first search: re-run and focus first (#12), different URL second, offer last and smaller (v1 #11). Hide the price block on unreadable and unsupported sites. | 6·7·9 = 7.3 | S | `screens.tsx:195-236`, `rail.tsx:138-147` | Zero-lead recovery; checkout from `empty` |
| 16 | **Free nurture sequence (v1 #9).** Day 1: "Did you reply? Two tips for the first message." Day 3: "N new posts match {host} since your search", from a search-and-triage-only probe (cents, no qualification), titles only. Day 7: a customer story. Day 13: "Your free window closes tomorrow". Stop on activation or unsubscribe. | 9·7·5 = 7.0 | M | New kinds in `templates.ts`; a `lifecycle_emails` table using the lease and idempotency pattern of `email/deliver.ts`; probe reuses `search/index.ts` + triage | Email → desk return → checkout; unsubscribe rate (guardrail) |
| 17 | **Post-purchase moment.** A confirmation state in the desk (first paid run's real progress from #9, Slack setup, timezone check) and an activation email with what happens tomorrow at 8:00. Acknowledge a cancelled checkout ("No problem. Your leads stay here.") and record `checkout_cancelled`. | 6·8·7 = 7.0 | S–M | `desk-app.tsx:206-216`, `rail.tsx`, `templates.ts`, `stripe.ts:28` | Paying at 30 days; `webhook_saved` within 24 h |
| 18 | **Offer experiments (v1 #10).** A: 7-day trial (`subscription_data.trial_period_days`; `trialing` already maps to active). B: "first month refunded if no lead was worth contacting". Then an annual price ($990). Run one at a time. | 8·6·6 = 6.7 | M | `stripe.ts:19-33`, `pricing.tsx`, rail and promo copy | Checkout → activated; paying at 30 and 60 days |

### Sprint 3, weeks 5–9: make the value visible to paying users

| # | Initiative | ICE | Effort | Where / reuse | Metric |
|---|---|---|---|---|---|
| 21 | **Quiet-day receipt and weekly recap.** In the desk: "This morning: 12 situations searched, 41 pages read, 0 passed; 3 came close (why)". A Monday email for paying radars with the week's searches, leads, contacted count and what the agent learned. Data is already in `research_runs` and `research_candidates`. | 8·7·6 = 7.0 | M | `radars.ts` view, `rail.tsx` live card, `templates.ts`, `scripts/diagnose.ts` queries as a starting point | Churn in zero-email weeks; weekly email clicks |
| 22 | **Outcomes and ROI (v1 #12).** Statuses `replied`, `meeting`, `won` (+ value). Three days after "contacted", ask "Did they reply?" in the desk and the digest. ROI panel: "This month: 9 contacted · 3 replied · 1 meeting". Feed `replied` into `search_stats` as a stronger signal than contacted. | 9·7·5 = 7.0 | M | migration on `leads.user_status`, `api/radar/leads/[leadId]/route.ts:5`, `leads.tsx`, `rail.tsx` | Paying at 60/90 days; replies per paying radar |
| 23 | **Billing lifecycle (v1 #13).** Payment-failed email on the webhook (day 0 and day 2 of grace, with the date the agent stops), cancel confirmation with a reactivation link, win-back at day 30 with a promotion code. Turn on cancellation reasons in the Stripe portal and store `cancellation_details` from the subscription webhook. | 6·8·7 = 7.0 | S–M | `api/stripe/webhook/route.ts`, `subscription.ts`, `templates.ts:91-102,157` | Recovered failed payments; reasons captured; win-back rate |
| 24 | Show "what your agent has learned" (decisions used, proven topics, watched communities) and ship the watched-sources toggles; the API exists. | 5·7·7 = 6.3 | S–M | `radars.ts:150,348`, `api/radar/sources`, `rail.tsx` | `sources` toggles used; retention |
| 25 | Ask for a testimonial after the first "won" (v1 #17). | 5·7·8 = 6.7 | S | after #22 | Testimonials per month |

### Sprint 4, weeks 8–12 and beyond: loops and expansion

| # | Initiative | ICE | Effort | Where / reuse | Metric |
|---|---|---|---|---|---|
| 26 | Link back from every output: brand link in the email header, a "Found by Not Another Agent" footer in Slack payloads with `?utm_source=slack`, a "forward this to a colleague" line in digests. | 4·6·10 = 6.7 | S | `templates.ts:142`, `email/webhook.ts` | Signups with `utm_source` slack or email |
| 27 | "Email me my radars": enter an email, receive the private links for it. First step towards accounts, and the fix for lost links. | 5·7·7 = 6.3 | S–M | new route beside `api/radars/check`, `crypto.ts` token decryption as in `deliver.ts` | Recovery requests; support load |
| 28 | Share-safe snapshot: a public, redacted page ("5 companies asked for a Webflow agency this week", no names or contact routes) the user chooses to publish, with a CTA. Doubles as the unit for #31. | 6·5·5 = 5.3 | M | new `(m)/s/[id]`, redaction of `LeadT` | Shared-page visits → signups |
| 29 | Referral (v1 #15): give a month, get a month, built on Stripe promotion codes. | 6·5·6 = 5.7 | M | `stripe.ts` (`allow_promotion_codes` is on), `attribution.ts` `ref` | % signups referred |
| 30 | Magic-link accounts, "my radars", multi-site view, then an agency tier with seats (v1 #14). | 7·6·3 = 5.3 | L | after #27 | Radars per paying email |
| 31 | Programmatic SEO (v1 #16): "who's asking for [service] this week" pages built from anonymised, aggregated leads. | 9·5·3 = 5.7 | L | after #28 | Organic signups |

### Measurement track, in parallel (all S unless noted)

| # | Initiative | Why |
|---|---|---|
| M1 | `cta_viewed` with placement (once per radar per placement, IntersectionObserver), and an `email` placement via `?from=email` on the activate link | Placement conversion; separates email-driven checkouts from rail clicks |
| M2 | `email_sent` event with `kind` and `plan` in `deliver.ts`; funnel groups opens and clicks by kind | Open and click rates per email, needed for #16, #21 and #23 |
| M3 | Funnel additions (M): time to contact from `user_status_at`; placement → activated; 60 and 90-day retention with `past_due` shown separately; unsubscribes; the north-star line | Every metric named in this plan becomes printable |
| M4 | `first_activated_at`, never overwritten | Win-backs stop resetting cohorts |
| M5 | Marketing events with props (form position, page), plus `form_error` and `email_step_viewed`; pass an anonymous first-party id into radar creation | Finds the drop between pageview and signup; joins the two datasets |
| M6 | `radars.experiments jsonb`, deterministic bucketing on the radar id, `npm run funnel -- --by variant` (S–M) | Every test in section 6 |
| M7 | Confirm v1's go-live checklist ran in production (migration 009, Resend webhook and secret, open tracking) | Without it the event stages are empty |

## 5. Targets and leading indicators

Directional, for a self-serve B2B tool with a free first result. Replace with your own baseline after four weeks of `npm run funnel`.

| Step | Target | Moved by |
|---|---|---|
| Visitor → `website_submitted` | 8–15% | 3, 4, 6, 7 |
| `website_submitted` → `email_submitted` | ≥ 60% | 5, 6, 10 |
| Visitor → signup | 3–8% | all of Sprint 0 |
| First runs ending `website_unreadable` | < 3% | 11 |
| Signup → ≥1 lead (after re-run) | ≥ 85% | 10, 12 |
| Median time to first lead | < 3 min (today 4–10) | 13a, 13b |
| Signup → desk viewed | ≥ 80% | 9, 6 |
| ≥1 lead → contacted within 7 days | ≥ 40% | 9, 10, 16 |
| Contacted → checkout started | ≥ 25% | 14, 18 |
| Checkout started → activated | ≥ 60% | 18, 5 |
| Signup → paid within 30 days | 3–8% | Sprints 1–2 |
| Paying at 30 / 90 days | ≥ 85% / ≥ 65% | 1, 21, 22, 23 |
| Failed payments recovered | ≥ 50% | 23 |
| Leads contacted per paying radar per week | ≥ 3 | 1, 21, 22 |

## 6. Experiment backlog

Template (from v1): hypothesis · metric and baseline · minimum effect worth shipping · audience and duration · guardrail · decision.

Volume is low, so an A/B split will rarely reach significance below the top of the funnel. Rule: split-test only on marketing pages; inside the product, ship to everyone, compare four-week cohorts before and after, and keep one change per stage per period.

| # | Hypothesis | Metric | Guardrail |
|---|---|---|---|
| E1 | Because users see the offer before they've felt the value, showing it right after the first contacted lead raises contacted → checkout (action 14). | Checkout starts per contacted radar, by placement | Contact rate doesn't fall |
| E2 | Because $99 with no account feels risky, a 7-day trial raises checkout → activated more than it lowers 30-day retention (18A). | Paid at day 30 per checkout started | Research cost per paying radar |
| E3 | A first-month guarantee gets most of the trial's lift without free research cost (18B vs 18A). | Same | Refund rate < 15% |
| E4 | Because the brief is the first proof we understood the business, showing it during the wait raises desk views and lowers dismissals (10). | Desk viewed after wait; dismiss rate | Time to first lead unchanged |
| E5 | Because free users have no reason to return, a day-3 "N new matches" teaser produces more activations than any in-desk placement (16). | Activations within 48 h of the email | Unsubscribe rate < 2% per send |
| E6 | Because an empty first search reads as "doesn't work for me", one free re-run with a corrected focus recovers a third of zero-lead radars (12). | Zero-lead radars reaching ≥1 lead | Research cost per activation |
| E7 | Because the hero describes the paid product, a headline about the free result ("See 5 companies asking for what you sell, free") raises visitor → website submitted. Split test. | `website_submitted` per visitor | Signup → contacted unchanged |
| E8 | Labelled examples and sourced numbers convert at least as well as unlabelled ones (3, 4). Split test. | Visitor → signup | None |
| E9 | Because quiet weeks look like a dead product, a weekly recap lowers churn in low-yield months (21). | Paying at 60 days among radars with under 5 leads a month | Unsubscribes |
| E10 | An annual price at two months free is taken by at least 15% of activations (18). | Annual share; cash collected per activation | Refund requests |

## 7. What not to do yet

- **Accounts, seats and an agency tier (30).** Expansion multiplies a paying base that doesn't exist yet, and it's the largest build on the list. "Email me my radars" (27) covers the real pain for a fraction of the cost.
- **Programmatic SEO (31) and referral (29).** Both send more visitors into a funnel that currently loses them at the wait, at the dead-end free tier and at a mistimed paywall. Fix sprints 0–2, confirm the numbers with the funnel, then buy volume. The link-backs in 26 are the exception: they cost a day.
- **Lead streaming (13b) before 9, 10 and 13a.** Real progress and the brief make the wait tolerable for a few days' work; streaming is weeks.
- **More tiers or price changes beyond 18.** One price is fine until outcomes (22) show what a radar is worth to different customers.

## Appendix A: status of v1's items

| v1 # | Item | Status in code | v2 # |
|---|---|---|---|
| 1–4 | Attribution, funnel, events, SEO basics | Done (go-live unverified, M7) | – |
| 5 | Resolve the watch promise | Not done; copy now in 8 places | 1 |
| 6 | Profile confirmation during the wait | Not done | 10 |
| 7 | Stream leads, real progress | Not done | 9, 13a, 13b |
| 8 | Paywall after the aha | Not done (`desk-app.tsx:426`) | 14 |
| 9 | Free nurture sequence | Not done; one template only | 16 |
| 10 | Trial and annual plan | Not done | 18 |
| 11 | Empty-result recovery before upsell | Partial: different-URL form exists, offer still above it | 12, 15 |
| 12 | Outcomes, ROI, weekly email | Not done | 21, 22 |
| 13 | Billing lifecycle emails, cancel reason | Not done | 23 |
| 14 | Magic-link accounts, seats | Not done | 27, 30 |
| 15 | Referral, Slack footer link | Not done | 26, 29 |
| 16 | Programmatic SEO | Not done | 28, 31 |
| 17 | Testimonial ask | Not done | 25 |

## Appendix B: built but unreachable

- Watched-sources toggles: API and view data, no UI (`api/radar/sources`, `radars.ts:150,348`).
- "Checking more angles" follow-up state (`screens.tsx:202-208`) while `AUTOMATIC_FOLLOW_UPS = false`.
- Email-required desk screen: creation already requires an email (`api/radars/route.ts:42-44`).
- Instant-alert email variant and `INSTANT_ALERT_MIN_SCORE`: only reachable from watch runs.

## Appendix C: event catalogue today

- **Simple Analytics (marketing):** `website_submitted`, `email_submitted`, `existing_radar_opened`. No props.
- **`events` table, from the desk:** `desk_viewed` (screen, via), `lead_opened` (status), `draft_copied`, `reply_clicked` (channel), `draft_rewritten` (style), `source_opened`, `private_link_copied`, `focus_saved` (action), `webhook_saved` (action). `plan` is attached to all.
- **`events` table, from the server:** `checkout_started` (placement: rail, empty, promo), `plan_changed` (from, to), `email_opened`, `email_clicked` (link), `email_bounced`, `email_complained` (kind, plan).
- **Proposed in this plan:** `cta_viewed`, `email_sent`, `checkout_cancelled`, `form_error`, `email_step_viewed`, placements `after_contact`, `list_done`, `email`.
