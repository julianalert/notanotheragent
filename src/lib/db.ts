import 'server-only'

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
  output_language text not null default 'en',
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
  kind text not null check (kind in ('initial', 'daily')),
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
  outcome text check (outcome in ('matches', 'no_matches', 'website_unreadable', 'unsupported_business', 'insufficient_coverage', 'validation_failed')),
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
  created_at timestamptz not null default now(),
  unique (radar_id, source_key)
);

create index if not exists leads_radar_idx on leads (radar_id, discovered_at desc);

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
        return (await withConnectionRetry(() => pool.query(sql, params))).rows as T[]
      },
      async transaction(fn) {
        const connection = await pool.connect()
        try {
          await connection.query('begin')
          const result = await fn({
            async query<T extends Row>(sql: string, params: unknown[] = []) {
              return (await connection.query(sql, params)).rows as T[]
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
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
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
      return enqueue(async () => (await db.query<T>(sql, params)).rows)
    },
    transaction(fn) {
      return enqueue(() =>
        db.transaction((tx) =>
          fn({
            async query<T extends Row>(sql: string, params: unknown[] = []) {
              return (await tx.query<T>(sql, params)).rows
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
