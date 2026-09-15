-- Lead Radar research-v3 memory: seen sources, per-topic search yields, dismiss reasons. Safe to re-run.

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

alter table public.seen_sources enable row level security;
alter table public.search_stats enable row level security;
revoke all on public.seen_sources, public.search_stats from anon, authenticated;
