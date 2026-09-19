-- Lead Radar: growth tracking (first-touch attribution + product events). Run once in Supabase → SQL Editor. Safe to re-run.

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

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
