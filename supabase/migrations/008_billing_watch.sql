-- Lead Radar: paid activation (Stripe) and continuous watching. Run once in Supabase → SQL Editor. Safe to re-run.

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

alter table public.stripe_events enable row level security;
alter table public.watched_sources enable row level security;
revoke all on public.stripe_events, public.watched_sources from anon, authenticated;
