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
  kind text not null check (kind in ('initial', 'daily')),
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
  outcome text check (outcome in ('matches', 'no_matches', 'website_unreadable', 'unsupported_business', 'insufficient_coverage', 'validation_failed')),
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

-- Security: the app connects server-side with the database connection string and scopes every query by the
-- radar's secret token. Nothing should be reachable through Supabase's public Data API (anon/authenticated keys).
-- RLS enabled with no policies = deny all for those roles. The postgres role used by the app bypasses RLS.
alter table public.radars enable row level security;
alter table public.research_runs enable row level security;
alter table public.leads enable row level security;
alter table public.evaluation_reviews enable row level security;

revoke all on public.radars, public.research_runs, public.leads, public.evaluation_reviews from anon, authenticated;

-- Useful pilot queries (spec §2.3):
--   Cost and time per run:
--     select kind, outcome, model, prompt_version, duration_ms, cost_usd, usage from research_runs order by created_at desc;
--   Why candidates were rejected:
--     select id, validation_report->'rejected' from research_runs where status = 'completed' order by created_at desc;
--   Record a human review:
--     insert into evaluation_reviews (run_id, model_version, prompt_version, source_url, human_accepted, rejection_reason)
--     select r.id, r.model, r.prompt_version, l.source_url, true, null from leads l join research_runs r on r.id = l.run_id where l.id = '<lead id>';
