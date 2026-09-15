export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV === 'production') return
  const seconds = Number(process.env.DEV_SCHEDULER_INTERVAL_SECONDS ?? 5)
  if (!seconds) return
  // A dev server keeps its first-loaded scheduler code across edits and pulls, so against a shared database it
  // would finish runs with stale code, racing the deployed cron. Only the embedded database runs it by default.
  if (process.env.DATABASE_URL && process.env.DEV_SCHEDULER_SHARED_DB !== '1') {
    console.log('dev scheduler off: DATABASE_URL is set (the deployed cron processes runs; DEV_SCHEDULER_SHARED_DB=1 to override)')
    return
  }

  const globalForScheduler = globalThis as unknown as { __leadRadarScheduler?: boolean }
  if (globalForScheduler.__leadRadarScheduler) return
  globalForScheduler.__leadRadarScheduler = true

  const { tick } = await import('./lib/scheduler')
  let running = false
  setInterval(async () => {
    if (running) return
    running = true
    try {
      await tick()
    } catch (error) {
      console.error('dev scheduler tick failed:', (error as Error).message)
    } finally {
      running = false
    }
  }, seconds * 1000)
}
