export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Offset (ms) between the wall-clock time in `timeZone` and UTC at `date`. */
function offsetMs(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour)
  let result = guess - offsetMs(new Date(guess), timeZone)
  // Second pass handles DST transitions between the guess and the result.
  result = guess - offsetMs(new Date(result), timeZone)
  return new Date(result)
}

/** Local calendar date (YYYY-MM-DD) of `date` in `timeZone`. */
export function localDateKey(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * The next scheduled daily run: `hour`:00 local time on the calendar day after `after`'s local date,
 * or later if that has already passed. Returns null when it would fall at or after the research deadline.
 */
export function nextDailyRunAt(after: Date, timeZone: string, endsAt: Date, hour: number) {
  const p = zonedParts(after, timeZone)
  for (let offset = 1; offset <= 3; offset++) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + offset))
    const candidate = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, timeZone)
    if (candidate.getTime() > after.getTime()) {
      return candidate.getTime() < endsAt.getTime() ? candidate : null
    }
  }
  return null
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}
