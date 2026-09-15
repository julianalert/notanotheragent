-- Lead Radar: when a lead was marked contacted or dismissed (shown as "Contacted Sep 13"). Safe to re-run.
alter table public.leads add column if not exists user_status_at timestamptz;
