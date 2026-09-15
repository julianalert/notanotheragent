-- Lead Radar: email delivery (Resend). Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.radars add column if not exists email text;
alter table public.radars add column if not exists email_added_at timestamptz;
alter table public.radars add column if not exists email_unsubscribed_at timestamptz;
-- AES-GCM encrypted private token (key derived from APP_SECRET), only so emails can include the private link.
alter table public.radars add column if not exists token_ciphertext text;

alter table public.research_runs add column if not exists email_status text
  check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed'));
alter table public.research_runs add column if not exists email_attempts integer not null default 0;
alter table public.research_runs add column if not exists email_claimed_at timestamptz;
alter table public.research_runs add column if not exists email_sent_at timestamptz;
alter table public.research_runs add column if not exists email_error text;

create index if not exists research_runs_email_idx on public.research_runs (email_status)
  where email_status in ('pending', 'sending');
