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
  created_at timestamptz not null default now(),
  unique (radar_id, kind, run_key)
);

create index if not exists research_runs_status_idx on research_runs (status, scheduled_at);

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

async function createDatabase(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
      throw new Error(
        'DATABASE_URL must be a Postgres connection string (postgresql://…). For Supabase, use Project Settings → Database → Connection string, not the https project URL.',
      )
    }
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10_000 })
    await pool.query(SCHEMA)
    return {
      async query<T extends Row>(sql: string, params: unknown[] = []) {
        return (await pool.query(sql, params)).rows as T[]
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
