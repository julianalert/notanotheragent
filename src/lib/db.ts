import 'server-only'
import { cleanText } from './jsonb'

type Row = Record<string, unknown>

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>
}

interface Database extends Queryable {
  /** Run statements atomically. Everything inside must use the supplied `tx`. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
}

const SCHEMA = /* sql */ `
create table if not exists radars (
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
  -- AES-GCM encrypted private token, only so emails can include the private link.
  token_ciphertext text,
  constraint research_period check (research_ends_at > research_started_at)
);

create table if not exists research_runs (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references radars(id) on delete cascade,
  kind text not null check (kind in ('initial', 'daily', 'follow_up')),
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
  outcome text check (outcome in ('qualified_results', 'candidates_unresolved', 'candidates_rejected', 'no_candidates', 'research_incomplete', 'website_unreadable', 'unsupported_business', 'matches', 'no_matches', 'insufficient_coverage', 'validation_failed')),
  parent_run_id uuid references research_runs(id) on delete cascade,
  diagnostics jsonb,
  usage jsonb,
  cost_usd numeric(10, 4),
  duration_ms integer,
  format_repair_used boolean not null default false,
  audit_urls jsonb,
  coverage jsonb,
  validation_report jsonb,
  -- Raw provider response for diagnosis. Restricted: never exposed through any API route.
  raw_response jsonb,
  lease_until timestamptz,
  email_status text check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  email_attempts integer not null default 0,
  email_claimed_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  unique (radar_id, kind, run_key)
);

create index if not exists research_runs_status_idx on research_runs (status, scheduled_at);

-- Email delivery (added after the first release): idempotent upgrades for existing databases.
alter table radars add column if not exists email text;
alter table radars add column if not exists email_added_at timestamptz;
alter table radars add column if not exists email_unsubscribed_at timestamptz;
alter table radars add column if not exists token_ciphertext text;
alter table research_runs add column if not exists email_status text check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed'));
alter table research_runs add column if not exists email_attempts integer not null default 0;
alter table research_runs add column if not exists email_claimed_at timestamptz;
alter table research_runs add column if not exists email_sent_at timestamptz;
alter table research_runs add column if not exists email_error text;
create index if not exists research_runs_email_idx on research_runs (email_status) where email_status in ('pending', 'sending');

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references radars(id) on delete cascade,
  run_id uuid not null references research_runs(id) on delete cascade,
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

create index if not exists leads_radar_idx on leads (radar_id, discovered_at desc);
alter table leads add column if not exists user_status_at timestamptz;

-- research-v2: follow-up runs, v2 outcomes, diagnostics and the candidate pool.
alter table research_runs drop constraint if exists research_runs_kind_check;
alter table research_runs add constraint research_runs_kind_check check (kind in ('initial', 'daily', 'follow_up', 'watch'));
alter table research_runs drop constraint if exists research_runs_outcome_check;
alter table research_runs add constraint research_runs_outcome_check check (outcome in (
  'qualified_results', 'candidates_unresolved', 'candidates_rejected', 'no_candidates', 'research_incomplete',
  'website_unreadable', 'unsupported_business', 'matches', 'no_matches', 'insufficient_coverage', 'validation_failed'));
alter table research_runs add column if not exists parent_run_id uuid references research_runs(id) on delete cascade;
alter table research_runs add column if not exists diagnostics jsonb;

create table if not exists research_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references research_runs(id) on delete cascade,
  radar_id uuid not null references radars(id) on delete cascade,
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
create index if not exists research_candidates_run_idx on research_candidates (run_id);
create index if not exists research_candidates_radar_idx on research_candidates (radar_id, decision);

-- research-v3: discovery pipeline state, one row per pipeline run (its id is the run's provider_response_id).
create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- research-v3 memory: every source the pipeline saw (never re-read within 30 days), per-topic yields, feedback.
create table if not exists seen_sources (
  radar_id uuid not null references radars(id) on delete cascade,
  source_key text not null,
  url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  times_seen integer not null default 1,
  triage_score integer,
  decision text,
  primary key (radar_id, source_key)
);
create index if not exists seen_sources_radar_idx on seen_sources (radar_id, last_seen_at desc);

create table if not exists search_stats (
  radar_id uuid not null references radars(id) on delete cascade,
  topic text not null,
  runs integer not null default 0,
  hits integer not null default 0,
  candidates integer not null default 0,
  published integer not null default 0,
  contacted integer not null default 0,
  last_used_at timestamptz not null default now(),
  primary key (radar_id, topic)
);

alter table leads add column if not exists topic text;
alter table leads add column if not exists dismiss_reason text
  check (dismiss_reason in ('not_a_buyer', 'wrong_need', 'too_old', 'already_known', 'other'));


-- Paid activation and continuous watching (research-v3).
alter table radars add column if not exists plan text not null default 'free'
  check (plan in ('free', 'active', 'past_due', 'cancelled'));
alter table radars add column if not exists stripe_customer_id text;
alter table radars add column if not exists stripe_subscription_id text;
alter table radars add column if not exists activated_at timestamptz;
alter table radars add column if not exists current_period_end timestamptz;
alter table radars add column if not exists last_watch_at timestamptz;
alter table radars add column if not exists webhook_url text;
create index if not exists radars_subscription_idx on radars (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table research_runs drop constraint if exists research_runs_kind_check;
alter table research_runs add constraint research_runs_kind_check check (kind in ('initial', 'daily', 'follow_up', 'watch'));

-- Leads wait for the morning digest unless an instant alert sent them; leads stored before this column were emailed by their run.
alter table leads add column if not exists emailed_at timestamptz;
update leads set emailed_at = created_at where emailed_at is null and created_at < now() - interval '1 hour';

create table if not exists watched_sources (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references radars(id) on delete cascade,
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

-- Human review during the pilot (spec §2.3). One row per reviewed candidate.
create table if not exists evaluation_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references research_runs(id) on delete cascade,
  model_version text not null,
  prompt_version text not null,
  source_url text not null,
  human_accepted boolean not null,
  rejection_reason text,
  duplicate boolean not null default false,
  review_date date not null default current_date,
  created_at timestamptz not null default now()
);
`

/** Transient connection-level failures (not auth or SQL errors) get one quick retry. */
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '08006', '08001', '08003', '53300'])

async function withConnectionRetry<T>(fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (error) {
    const code = (error as { code?: string }).code ?? ''
    const transient = TRANSIENT_CODES.has(code) || /Connection terminated|timeout exceeded when trying to connect/i.test((error as Error).message)
    if (!transient) throw error
    await new Promise((resolve) => setTimeout(resolve, 250))
    return fn()
  }
}

/** Postgres rejects NUL characters and half surrogate pairs in text; web text and sliced messages can hold both. */
const cleanParams = (params: unknown[]) => params.map((param) => (typeof param === 'string' ? cleanText(param) : param))

async function createDatabase(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
      throw new Error(
        'DATABASE_URL must be a Postgres connection string (postgresql://…). For Supabase, use Project Settings → Database → Connection string, not the https project URL.',
      )
    }
    const { Pool } = await import('pg')
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Serverless: keep few connections per instance; use Supabase's transaction pooler (port 6543).
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    })
    // A broken idle connection must not crash the function.
    pool.on('error', (error) => console.error(JSON.stringify({ event: 'db.pool_error', error: error.message })))
    // In production the schema is applied once from supabase/schema.sql; don't run DDL on every cold start.
    if (process.env.NODE_ENV !== 'production' || process.env.DB_AUTO_MIGRATE === '1') await pool.query(SCHEMA)
    return {
      async query<T extends Row>(sql: string, params: unknown[] = []) {
        return (await withConnectionRetry(() => pool.query(sql, cleanParams(params)))).rows as T[]
      },
      async transaction(fn) {
        const connection = await pool.connect()
        try {
          await connection.query('begin')
          const result = await fn({
            async query<T extends Row>(sql: string, params: unknown[] = []) {
              return (await connection.query(sql, cleanParams(params))).rows as T[]
            },
          })
          await connection.query('commit')
          return result
        } catch (error) {
          await connection.query('rollback')
          throw error
        } finally {
          connection.release()
        }
      },
    }
  }

  // The embedded database writes to local disk: development only. Serverless filesystems are read-only.
  // ALLOW_EMBEDDED_DB=1 lets a local `next start` use PGlite for testing; it is never honoured on Vercel.
  if (process.env.VERCEL || (process.env.NODE_ENV === 'production' && process.env.ALLOW_EMBEDDED_DB !== '1')) {
    throw new Error(
      'DATABASE_URL is not set. Production needs a Postgres connection string (e.g. Supabase → Project Settings → Database → Connection string).',
    )
  }

  const { PGlite } = await import('@electric-sql/pglite')
  const path = await import('node:path')
  const fs = await import('node:fs/promises')
  const dataDir = path.join(process.cwd(), '.data', 'pglite')
  await fs.mkdir(dataDir, { recursive: true })
  const db = new PGlite(dataDir)
  await db.waitReady
  await db.exec(SCHEMA)
  // PGlite is a single connection; serialise work so concurrent requests never interleave with a transaction.
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(job: () => Promise<T>) => {
    const next = queue.then(job)
    queue = next.catch(() => undefined)
    return next
  }
  return {
    query<T extends Row>(sql: string, params: unknown[] = []) {
      return enqueue(async () => (await db.query<T>(sql, cleanParams(params))).rows)
    },
    transaction(fn) {
      return enqueue(() =>
        db.transaction((tx) =>
          fn({
            async query<T extends Row>(sql: string, params: unknown[] = []) {
              return (await tx.query<T>(sql, cleanParams(params))).rows
            },
          }),
        ),
      )
    },
  }
}

// One instance per process, shared by route handlers, pages and the dev scheduler (separate module graphs).
const globalForDb = globalThis as unknown as { __leadRadarDb?: Promise<Database> }

export function db(): Promise<Database> {
  globalForDb.__leadRadarDb ??= createDatabase().catch((error) => {
    globalForDb.__leadRadarDb = undefined
    throw error
  })
  return globalForDb.__leadRadarDb
}

export async function query<T extends Row = Row>(sql: string, params?: unknown[]) {
  return (await db()).query<T>(sql, params)
}

export async function transaction<T>(fn: (tx: Queryable) => Promise<T>) {
  return (await db()).transaction(fn)
}
