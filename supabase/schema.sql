-- Lead Radar schema for Supabase (Postgres).
-- Run once in Supabase → SQL Editor. Safe to re-run: every statement is idempotent.
-- Keep in sync with SCHEMA in src/lib/db.ts (the app also runs `create ... if not exists` on boot).

create extension if not exists pgcrypto; -- gen_random_uuid()

create table if not exists public.radars (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  website text not null,
  website_host text not null,
  profile jsonb,
  focus jsonb,
  timezone text not null default 'UTC',
  timezone_inferred boolean not null default true,
  created_at timestamptz not null default now(),
  research_started_at timestamptz not null,
  research_ends_at timestamptz not null,
  next_run_at timestamptz,
  email text,
  email_added_at timestamptz,
  email_unsubscribed_at timestamptz,
  token_ciphertext text, -- AES-GCM encrypted private token, only for links in emails
  constraint research_period check (research_ends_at > research_started_at)
);

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars(id) on delete cascade,
  kind text not null check (kind in ('initial', 'daily', 'follow_up')),
  run_key text not null,
  status text not null check (status in ('queued', 'running', 'processing', 'completed', 'failed', 'cancelled')),
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  output_mode text,
  provider_response_id text,
  published_on_or_after date,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  provider_completed_at timestamptz,
  completed_at timestamptz,
  retry_count integer not null default 0,
  manual_retry_count integer not null default 0,
  error_code text,
  error text,
  outcome text check (outcome in ('qualified_results', 'candidates_unresolved', 'candidates_rejected', 'no_candidates', 'research_incomplete', 'website_unreadable', 'unsupported_business', 'matches', 'no_matches', 'insufficient_coverage', 'validation_failed')),
  parent_run_id uuid references public.research_runs(id) on delete cascade,
  diagnostics jsonb, -- internal only: brief, proposed vs executed searches, counts, access failures, follow-up
  usage jsonb,
  cost_usd numeric(10, 4),
  duration_ms integer,
  format_repair_used boolean not null default false,
  audit_urls jsonb,
  coverage jsonb,
  validation_report jsonb,
  raw_response jsonb, -- restricted: diagnosis only
  lease_until timestamptz,
  email_status text check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  email_attempts integer not null default 0,
  email_claimed_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  unique (radar_id, kind, run_key)
);

create index if not exists research_runs_status_idx on public.research_runs (status, scheduled_at);
create index if not exists research_runs_email_idx on public.research_runs (email_status) where email_status in ('pending', 'sending');

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars(id) on delete cascade,
  run_id uuid not null references public.research_runs(id) on delete cascade,
  source_url text not null,
  source_key text not null,
  identity_key text not null,
  need_text text not null,
  published_date date not null,
  intent text not null,
  score_total integer not null,
  discovered_at timestamptz not null default now(),
  data jsonb not null,
  held_reason text,
  user_status text not null default 'new' check (user_status in ('new', 'contacted', 'dismissed')),
  user_status_at timestamptz,
  created_at timestamptz not null default now(),
  unique (radar_id, source_key)
);

create index if not exists leads_radar_idx on public.leads (radar_id, discovered_at desc);

create table if not exists public.research_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  radar_id uuid not null references public.radars(id) on delete cascade,
  source_url text not null,
  source_key text,
  headline text not null,
  decision text not null check (decision in ('published', 'qualified_not_selected', 'unresolved', 'rejected')),
  model_decision text not null,
  reasons jsonb not null default '[]',
  date_status text not null,
  published_date date,
  score_total integer not null default 0,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists research_candidates_run_idx on public.research_candidates (run_id);
create index if not exists research_candidates_radar_idx on public.research_candidates (radar_id, decision);

-- research-v3: discovery pipeline state, one row per pipeline run (its id is the run's provider_response_id).
create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- research-v3 memory: every source the pipeline saw (never re-read within 30 days), per-topic yields, feedback.
create table if not exists public.seen_sources (
  radar_id uuid not null references public.radars(id) on delete cascade,
  source_key text not null,
  url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  times_seen integer not null default 1,
  triage_score integer,
  decision text,
  primary key (radar_id, source_key)
);
create index if not exists seen_sources_radar_idx on public.seen_sources (radar_id, last_seen_at desc);

create table if not exists public.search_stats (
  radar_id uuid not null references public.radars(id) on delete cascade,
  topic text not null,
  runs integer not null default 0,
  hits integer not null default 0,
  candidates integer not null default 0,
  published integer not null default 0,
  contacted integer not null default 0,
  last_used_at timestamptz not null default now(),
  primary key (radar_id, topic)
);

alter table public.leads add column if not exists topic text;
alter table public.leads add column if not exists dismiss_reason text
  check (dismiss_reason in ('not_a_buyer', 'wrong_need', 'too_old', 'already_known', 'other'));


-- Paid activation and continuous watching (research-v3).
alter table public.radars add column if not exists plan text not null default 'free'
  check (plan in ('free', 'active', 'past_due', 'cancelled'));
alter table public.radars add column if not exists stripe_customer_id text;
alter table public.radars add column if not exists stripe_subscription_id text;
alter table public.radars add column if not exists activated_at timestamptz;
alter table public.radars add column if not exists current_period_end timestamptz;
alter table public.radars add column if not exists last_watch_at timestamptz;
alter table public.radars add column if not exists webhook_url text;
create index if not exists radars_subscription_idx on public.radars (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.research_runs drop constraint if exists research_runs_kind_check;
alter table public.research_runs add constraint research_runs_kind_check check (kind in ('initial', 'daily', 'follow_up', 'watch'));

-- Leads wait for the morning digest unless an instant alert sent them; leads stored before this column were emailed by their run.
alter table public.leads add column if not exists emailed_at timestamptz;
update public.leads set emailed_at = created_at where emailed_at is null and created_at < now() - interval '1 hour';

create table if not exists public.watched_sources (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars(id) on delete cascade,
  kind text not null check (kind in ('subreddit', 'hn', 'exa_query', 'feed')),
  key text not null,
  label text not null,
  added_by text not null default 'agent' check (added_by in ('agent', 'user')),
  enabled boolean not null default true,
  last_polled_at timestamptz,
  last_item_at timestamptz,
  hits integer not null default 0,
  published integer not null default 0,
  created_at timestamptz not null default now(),
  unique (radar_id, kind, key)
);

create table if not exists public.evaluation_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  model_version text not null,
  prompt_version text not null,
  source_url text not null,
  human_accepted boolean not null,
  rejection_reason text,
  duplicate boolean not null default false,
  review_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- First touch that led to the radar: UTM parameters, the referring host (never the full URL) and the landing path.
alter table public.radars add column if not exists source_utm_source text;
alter table public.radars add column if not exists source_utm_medium text;
alter table public.radars add column if not exists source_utm_campaign text;
alter table public.radars add column if not exists source_utm_term text;
alter table public.radars add column if not exists source_utm_content text;
alter table public.radars add column if not exists source_referrer text;
alter table public.radars add column if not exists source_landing_path text;

-- Product events: desk actions, checkout, plan changes, email opens and clicks. Never holds tokens, emails or URLs.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid references public.radars(id) on delete cascade,
  name text not null,
  props jsonb not null default '{}',
  -- Webhook deliveries are retried: the provider's message id makes a redelivery a no-op.
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists events_radar_idx on public.events (radar_id, name, created_at desc);
create index if not exists events_name_idx on public.events (name, created_at desc);

-- Security: the app connects server-side with the database connection string and scopes every query by the
-- radar's secret token. Nothing should be reachable through Supabase's public Data API (anon/authenticated keys).
-- RLS enabled with no policies = deny all for those roles. The postgres role used by the app bypasses RLS.
alter table public.radars enable row level security;
alter table public.research_runs enable row level security;
alter table public.leads enable row level security;
alter table public.evaluation_reviews enable row level security;
alter table public.research_candidates enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.seen_sources enable row level security;
alter table public.search_stats enable row level security;
alter table public.stripe_events enable row level security;
alter table public.watched_sources enable row level security;
alter table public.events enable row level security;

revoke all on public.radars, public.research_runs, public.leads, public.evaluation_reviews, public.research_candidates, public.pipeline_runs, public.seen_sources, public.search_stats, public.stripe_events, public.watched_sources, public.events from anon, authenticated;

-- Useful pilot queries (spec §2.3):
--   Cost and time per run:
--     select kind, outcome, model, prompt_version, duration_ms, cost_usd, usage from research_runs order by created_at desc;
--   Why candidates were rejected:
--     select id, validation_report->'rejected' from research_runs where status = 'completed' order by created_at desc;
--   Record a human review:
--     insert into evaluation_reviews (run_id, model_version, prompt_version, source_url, human_accepted, rejection_reason)
--     select r.id, r.model, r.prompt_version, l.source_url, true, null from leads l join research_runs r on r.id = l.run_id where l.id = '<lead id>';
