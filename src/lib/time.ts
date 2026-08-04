import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const PT = 'America/Los_Angeles'

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

/** ISO 8601 with the PT offset, e.g. "2026-08-03T16:42:00-07:00". */
export function toPtIso(d: Date): string {
  return formatInTimeZone(d, PT, "yyyy-MM-dd'T'HH:mm:ssXXX")
}

/**
 * SJC feed date+time ("Aug 03", "4:05 PM") → PT-offset ISO string.
 * The feed has no year: try the candidate years around `now` and keep the
 * instant closest to it, which handles the Dec 31 → Jan 1 boundary.
 */
export function parseSjcDateTime(date: string, time: string, now: Date): string | null {
  const dm = /^([A-Za-z]{3}) (\d{1,2})$/.exec(date.trim())
  const tm = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time.trim())
  if (!dm || !tm || !(dm[1] in MONTHS)) return null
  const clockHour = Number(tm[1])
  // The regex admits 00-99; only 1-12 is a real 12-hour-clock hour, and
  // `% 12` alone would silently reinterpret "13:05 AM" as 1:05 AM.
  if (clockHour < 1 || clockHour > 12) return null
  const hour = (clockHour % 12) + (tm[3] === 'PM' ? 12 : 0)
  const wall = (year: number) =>
    `${year}-${MONTHS[dm[1]]}-${dm[2].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${tm[2]}:00`
  const nowYear = Number(formatInTimeZone(now, PT, 'yyyy'))
  let best: Date | null = null
  for (const year of [nowYear - 1, nowYear, nowYear + 1]) {
    const candidate = fromZonedTime(wall(year), PT)
    // Skip calendar-invalid candidates (Feb 29 in a non-leap year): an
    // Invalid Date would make every later comparison NaN — always false —
    // pinning `best` to it and throwing downstream in toPtIso.
    if (Number.isNaN(+candidate)) continue
    if (!best || Math.abs(+candidate - +now) < Math.abs(+best - +now)) best = candidate
  }
  return best ? toPtIso(best) : null
}

/** "4:05 PM" in PT. */
export function formatTimePT(iso: string): string {
  return formatInTimeZone(new Date(iso), PT, 'h:mm a')
}

/** True when `iso` falls on a later PT calendar day than `now`. */
export function isNextDayPT(iso: string, now: Date): boolean {
  return (
    formatInTimeZone(new Date(iso), PT, 'yyyy-MM-dd') >
    formatInTimeZone(now, PT, 'yyyy-MM-dd')
  )
}
