// Development helper: run SQL against the local embedded database while the dev server is stopped.
// Usage: node scripts/sql.mjs "select * from research_runs"
// Useful for verifying expiry and scheduling with controlled timestamps.
import { PGlite } from '@electric-sql/pglite'
import path from 'node:path'

const db = new PGlite(path.join(process.cwd(), '.data', 'pglite'))
await db.waitReady
for (const statement of process.argv.slice(2)) {
  const result = await db.query(statement)
  console.log(statement.split('\n')[0].slice(0, 80))
  console.table(result.rows)
}
await db.close()
