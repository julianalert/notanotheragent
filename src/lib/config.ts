function num(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && process.env[name] !== '' && process.env[name] !== undefined ? value : fallback
}

export const config = {
  researchPeriodMs: num('RESEARCH_PERIOD_DAYS', 14) * 24 * 60 * 60 * 1000,
  dailyRunCap: num('DAILY_RUN_CAP', 200),
  // Wall deadline per research attempt (spec §1.7).
  runDeadlineMs: num('RUN_DEADLINE_MINUTES', 10) * 60 * 1000,
  retryBackoffMs: num('RETRY_BACKOFF_SECONDS', 60) * 1000,
  dailySpendCapUsd: num('DAILY_SPEND_CAP_USD', 50),
  slowRunThresholdMs: num('SLOW_RUN_THRESHOLD_SECONDS', 240) * 1000,
  createRateLimitPerHour: num('CREATE_RATE_LIMIT_PER_HOUR', 5),
  retryRateLimitPerHour: num('RETRY_RATE_LIMIT_PER_HOUR', 5),
  // Paid agent: watch runs poll watched sources every N hours; spend per radar per calendar month is capped.
  watchIntervalHours: num('WATCH_INTERVAL_HOURS', 3),
  monthlyRadarBudgetUsd: num('MONTHLY_RADAR_BUDGET_USD', 25),
  // A watch-run lead with an explicit request and at least this score (of 10) is emailed at once.
  instantAlertMinScore: num('INSTANT_ALERT_MIN_SCORE', 8),
  planPriceUsd: num('PLAN_PRICE_USD', 99),
  maxAutomaticRetries: 1,
  maxManualRetries: 3,
  dailyRunHour: 8,
  // Longer than the slowest single step (formatting repair: 3 min).
  leaseMs: 5 * 60 * 1000,
  cost: {
    inputPerMTok: num('COST_INPUT_PER_MTOK', 1.25),
    outputPerMTok: num('COST_OUTPUT_PER_MTOK', 10),
    perWebSearch: num('COST_PER_WEB_SEARCH', 0.01),
  },
}
