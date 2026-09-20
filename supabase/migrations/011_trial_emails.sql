-- Lead Radar: free-trial emails. Run once in Supabase → SQL Editor. Safe to re-run.
-- The trial itself needs no schema: it is derived from radars.created_at (TRIAL_DAYS).

-- Emails sent on the trial's clock (a day before it ends, when it ends, a look at what appeared since, a last note).
-- One row per radar and kind: the row is the claim, so concurrent ticks never send twice.
create table if not exists public.lifecycle_emails (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars(id) on delete cascade,
  kind text not null,
  status text not null check (status in ('sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 1,
  detail text,
  -- What the look at new posts cost (missed_matches only).
  cost_usd numeric(10, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (radar_id, kind)
);

alter table public.lifecycle_emails enable row level security;
revoke all on public.lifecycle_emails from anon, authenticated;
