-- Lead Radar: activation sprint (free re-run, link re-send, shared rate limiter). Run once in Supabase → SQL Editor. Safe to re-run.

-- When the focus last changed (a change after the first search earns one free re-run) and when the private link was
-- last re-sent by email (at most once an hour).
alter table public.radars add column if not exists focus_updated_at timestamptz;
alter table public.radars add column if not exists link_sent_at timestamptz;
create index if not exists radars_host_idx on public.radars (website_host);
create index if not exists radars_email_idx on public.radars (email);

-- Shared rate limiter: one row per key and hour. Serverless instances share nothing else.
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
