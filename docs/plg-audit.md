# Flywheel Audit: Not Another Agent

Product-led growth audit and action plan · 19 September 2026

This is a qualitative audit. It comes from the code, copy and flows in `lead-radar/` and uses no production numbers yet. Each recommendation names the metric that proves it worked. Run `npm run funnel` (after migration 009) to put real numbers against every stage below.

## Summary

**North-star metric:** leads contacted per week by paying radars. It only moves when the product finds real buyers, users act on them, and they keep paying.

**The three biggest leaks**

1. **We couldn't see the funnel.** Nothing was tracked between the website form and payment. *Fixed in Phase 1:* attribution, events and a cohort funnel now exist.
2. **Free users get one search and one email, then silence.** There's no nurture, no trial and no reason to come back. The paywall shows before the user has contacted a single lead.
3. **Nothing brings the next customer in.** There are two indexable pages, no referral program and nothing shareable. Every lead the product finds is also SEO content that isn't being used.

## The flywheel today

| Stage | What happens | Score (1–5) |
|---|---|---|
| Measurement | Before Phase 1: pageviews only on `/` and `/pricing` | 1 → **3.5** after Phase 1 |
| Acquisition | Two indexable pages, no loops | 2 → 2.5 after SEO basics |
| Signup | Website, then email. No account, no card | 3.5 |
| Activation | A 5–7+ minute wait for up to 5 leads | 2.5 |
| Free → paid | $99/month single tier, no trial, one email | 2 |
| Retention and expansion | A daily 8am digest on days with leads | 2 |
| Referral | None | 1 |

Visit → website → email (signup) → first search (5–7+ min) → "first matches" email → review ≤5 leads → **contact a lead (aha)** → activate at $99/month → daily digest → keep paying → tell others → visit.

## Findings by stage

### 0. Measurement: 1/5 at audit, 3.5/5 after Phase 1

- Simple Analytics recorded pageviews only (`src/app/(marketing)/analytics.tsx`). There were no events for website submit, email submit, checkout or activation.
- UTMs and the referrer were never stored. `radars` had no source columns (`supabase/schema.sql`).
- No desk activity was recorded: lead opens, copies and replies. There were no email opens or clicks either, because no Resend webhook was set up.
- Funnel metrics could be rebuilt from `radars`, `research_runs`, `leads` and `stripe_events`, but no script did it. `scripts/diagnose.ts` covers one host.
- **Metric to watch:** % of new radars with a known source, and % of stages with data.

### 1. Acquisition: 2/5

- There are only two indexable pages (`/`, `/pricing`). There was no sitemap, robots file, social card or favicon (all shipped in Phase 1), and there's no blog and no comparison or programmatic pages.
- The product's output is ready-made SEO content ("companies asking for a Webflow agency this week"), but none of it is public.
- Slack posts, emails and outreach drafts carry no link back to the product.
- **Metric to watch:** organic and referral signups per week (`npm run funnel -- --by source`).

### 2. Signup: 3.5/5

- Strong: two fields, no account and no card. The research starts the moment the email is in.
- The email is asked for before any value is visible, which is a trust tax. A "here's what we understood about your business" preview could come first.
- Nothing de-duplicates free searches by email; only the per-IP rate limit (5/hour) protects the free search.
- **Metric to watch:** `website_submitted` → `email_submitted` in Simple Analytics.

### 3. Activation: 2.5/5

- Time to first value is about 5–7 minutes (eval logs show 285–392 s per initial run), and longer in production: the pipeline advances one step per minute-long cron tick, and a follow-up run delays the email further.
- The progress sub-steps are faked (they advance every 5 s), and the copy tells users to close the tab.
- The business profile and buyer brief are never confirmed before the search. The focus editor appears only after results.
- An empty first search leads straight to an upsell (`screens.tsx`), which asks for money right after the product failed.
- **Metrics to watch:** median minutes to first lead, "≥1 lead → viewed desk" and "viewed desk → opened lead".

### 4. Free → paid: 2/5

- A free radar gets one email ever. There's no nurture, no trial, no annual plan and a single $99 tier.
- The in-feed promo appears as the third card (`desk-app.tsx`), before most users have contacted anyone.
- Nothing shows what the user is missing. Free radars never run again, so there's no "12 new matches since your search" pull.
- **Metrics to watch:** contacted → checkout (by placement), checkout → activated.

### 5. Retention and expansion: 2/5

- The daily email is sent only on days with leads. There's no weekly summary, so quiet weeks look like a dead product.
- Outcomes (replied, meeting, won) aren't tracked, so the product can't show that it's worth $99.
- There are no payment-failed, cancellation or win-back emails, and no cancellation reason is captured.
- There are no seats or teams, although agencies are teams. The token-only identity rules out cross-device use and "my radars".
- **Promise vs delivery:** the FAQ and pricing say communities are watched "every few hours" with instant alerts, but `WATCH_INTERVAL_HOURS` defaults to 0 (off).
- **Metrics to watch:** still paying 30 days after activation, and email opens and clicks by kind.

### 6. Referral: 1/5

- There's no referral program and no shareable artifact.
- The private link gives full access, so users can't safely share their results.
- **Metric to watch:** % of signups from referral or shared pages.

## Action plan

ICE = Impact, Confidence, Ease, each out of 10; the score is their average. Effort: S ≤ 2 days, M ≤ 1 week, L > 1 week.

### Phase 1, weeks 0–2: instrument and fix the leaks

| # | Initiative | ICE | Effort | Metric | Status |
|---|---|---|---|---|---|
| 1 | Signup events in Simple Analytics, plus first-touch attribution on radars | 7·9·9 = 8.3 | S | % radars with known source | **Done** |
| 2 | `npm run funnel`: weekly cohort funnel | 7·9·8 = 8.0 | S | All stages measurable | **Done** |
| 3 | `events` table for desk actions, checkout and plan changes, plus the Resend engagement webhook | 8·9·7 = 8.0 | M | Opened lead, contacted, email clicks | **Done** (needs go-live steps) |
| 4 | SEO basics: sitemap, robots, social card, icons, canonicals | 4·8·10 = 7.3 | S | Pages indexed, share previews | **Done** |
| 5 | Resolve the watch/instant-alert promise: enable it for paid radars or change the copy | 6·8·8 = 7.3 | S | Cancel reasons, trust | Next |

### Phase 2, weeks 2–6: activation and conversion

| # | Initiative | ICE | Effort | Metric | Status |
|---|---|---|---|---|---|
| 6 | Profile confirmation during the wait ("here's what we understood") | 8·7·6 = 7.0 | M | ≥1 lead rate, dismiss rate | Planned |
| 7 | Stream leads as they qualify and show real progress; first lead in under 2 min | 8·6·4 = 6.0 | L | Median time to first lead | Planned |
| 8 | Paywall after the aha moment: after the first contacted lead or a finished list | 7·6·8 = 7.0 | S | Contacted → checkout | Planned |
| 9 | Free nurture sequence: day 1 tips, day 3 "N new matches" teaser, day 7 case study, day 14 last call | 9·7·5 = 7.0 | M | Email → checkout | Planned |
| 10 | 7-day trial of daily runs, plus an annual plan (2 months free), A/B tested | 8·6·6 = 6.7 | M | Checkout → activated, 30-day retention | Planned |
| 11 | Empty-result recovery: focus editor and a free re-run before any upsell | 6·7·7 = 6.7 | S | Search done → ≥1 lead | Planned |

### Phase 3, weeks 6–12: retention, expansion and loops

| # | Initiative | ICE | Effort | Metric | Status |
|---|---|---|---|---|---|
| 12 | Outcome tracking (replied, meeting, won with a value), ROI panel, weekly pipeline email | 9·7·5 = 7.0 | M | Paying 30 days after activation | Planned |
| 13 | Billing lifecycle emails (payment failed, cancelled, win-back) and a cancellation reason | 6·8·7 = 7.0 | S | Recovered involuntary churn | Planned |
| 14 | Magic-link accounts: "my radars", invite teammates, then a seat or agency tier | 7·6·3 = 5.3 | L | Radars per account, seats | Planned |
| 15 | Referral program (give a month, get a month) and a Slack post footer link | 6·5·6 = 5.7 | M | % signups via referral | Planned |
| 16 | Programmatic SEO: public, anonymized "who's asking for [service] this week" pages | 9·5·3 = 5.7 | L | Organic signups | Planned |
| 17 | Ask for a testimonial after the first "won" outcome | 5·7·8 = 6.7 | S | Testimonials per month | Planned |

## Targets

These are directional targets for a self-serve B2B tool with a free first search. Replace them with your own baseline once `npm run funnel` has four weeks of data.

| Step | Target |
|---|---|
| Visitor → signup (email given) | 3–8% |
| Signup → ≥1 lead | ≥ 85% |
| ≥1 lead → contacted within 7 days | ≥ 40% |
| Signup → paid within 30 days | 3–8% |
| Paid, still paying after 30 days | ≥ 85% |
| Median time to first lead | < 3 min (today 5–7+) |

## Experiment template

Use one per initiative: **Hypothesis** (because X, changing Y will move Z) · **Metric and baseline** (from `npm run funnel`) · **Minimum effect worth shipping** · **Audience and duration** · **Guardrail** (e.g. dismiss rate, research cost per radar) · **Decision** (ship, iterate or kill).

## Phase 1 go-live checklist

1. Run `supabase/migrations/009_growth_tracking.sql` in the Supabase SQL editor.
2. In Resend, add a webhook to `<APP_URL>/api/resend/webhook` for `email.opened`, `email.clicked`, `email.bounced` and `email.complained`. Set `RESEND_WEBHOOK_SECRET` in Vercel.
3. Turn on open tracking in Resend. Click tracking sends email links, which contain the private token, through Resend's redirect; decide whether that's acceptable before turning it on.
4. Deploy, then check `/robots.txt`, `/sitemap.xml` and a share preview of the home page.
5. After a week, run `npm run funnel` and `npm run funnel -- --by source`.
