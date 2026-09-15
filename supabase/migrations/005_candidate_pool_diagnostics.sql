-- Lead Radar research-v2: candidate pool, run diagnostics and one bounded follow-up per run. Safe to re-run.

-- Follow-up runs and v2 outcomes (legacy v1 outcomes stay valid for old rows).
alter table public.research_runs drop constraint if exists research_runs_kind_check;
alter table public.research_runs add constraint research_runs_kind_check check (kind in ('initial', 'daily', 'follow_up'));
alter table public.research_runs drop constraint if exists research_runs_outcome_check;
alter table public.research_runs add constraint research_runs_outcome_check check (outcome in (
  'qualified_results', 'candidates_unresolved', 'candidates_rejected', 'no_candidates', 'research_incomplete',
  'website_unreadable', 'unsupported_business',
  'matches', 'no_matches', 'insufficient_coverage', 'validation_failed'));

alter table public.research_runs add column if not exists parent_run_id uuid references public.research_runs(id) on delete cascade;
-- Per-run diagnostics: acquisition brief, proposed vs executed searches, candidate counts, access failures,
-- follow-up decision. Internal only: never returned by public API routes.
alter table public.research_runs add column if not exists diagnostics jsonb;

-- Every candidate the research returned, with the application's decision and reasons (diagnostics only).
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
alter table public.research_candidates enable row level security;
revoke all on public.research_candidates from anon, authenticated;
