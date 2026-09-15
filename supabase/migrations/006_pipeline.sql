-- Lead Radar research-v3: app-controlled discovery pipeline. Run once in Supabase → SQL Editor. Safe to re-run.

-- Pipeline state, one row per pipeline run; its id is stored as research_runs.provider_response_id.
create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pipeline_runs enable row level security;
revoke all on public.pipeline_runs from anon, authenticated;

-- Finished pipeline state is diagnostics only; keep the table small.
-- delete from public.pipeline_runs where updated_at < now() - interval '30 days';
