import { parseSjcDateTime, toPtIso } from '@/lib/time'
import type { Direction, Flight, FlightStatus } from '@/lib/types'

interface SjcRecord {
  // Typed unknown, not string: the feed's shape is not guaranteed, and
  // toFlight() below must check these before ever passing them to
  // parseSjcDateTime (which calls .trim() and throws on a non-string).
  date: unknown
  time: unknown
  airline: string
  flight_number: string
  origin?: string
  origin_code?: string
  destination?: string
  destination_code?: string
  terminal?: string
  gate?: string
  baggage?: string
  status?: string
}

const WORD_STATUSES: Record<string, FlightStatus> = {
  'on time': { kind: 'on-time', text: 'On Time' },
  'cancelled': { kind: 'cancelled', text: 'Cancelled' },
}

const TIMED_STATUS = /^(Delayed|Early|Arrived|Departed)\s+(\d{1,2}:\d{2} [AP]M)$/

function parseStatus(
  raw: string | undefined,
  date: string,
  scheduled: string,
  now: Date,
): FlightStatus {
  const text = raw?.trim() ?? '—'
  const word = WORD_STATUSES[text.toLowerCase()]
  if (word) return { ...word }
  const timed = TIMED_STATUS.exec(text)
  if (!timed) return { kind: 'other', text }
  let time = parseSjcDateTime(date, timed[2], now) ?? undefined
  // The status time shares the row's date field; a time more than 12 h before
  // the scheduled time crossed midnight ("11:55 PM" → "Delayed 12:10 AM").
  if (time && Date.parse(time) < Date.parse(scheduled) - 12 * 3_600_000) {
    time = toPtIso(new Date(Date.parse(time) + 24 * 3_600_000))
  }
  return { kind: timed[1].toLowerCase() as FlightStatus['kind'], text: timed[1], time }
}

function toFlight(r: SjcRecord, direction: Direction, now: Date): Flight | null {
  // A missing or non-string date/time would otherwise reach date.trim() in
  // parseSjcDateTime and throw, aborting normalization for the whole feed
  // instead of just dropping this one malformed row (same skip-the-row
  // precedent as the "unparseable time" case below).
  if (typeof r.date !== 'string' || typeof r.time !== 'string') return null
  const scheduled = parseSjcDateTime(r.date, r.time, now)
  if (!scheduled) return null
  const status = parseStatus(r.status, r.date, scheduled, now)
  return {
    id: `SJC/${direction}/${r.airline}/${r.flight_number}/${r.date}`,
    airport: 'SJC',
    direction,
    airline: r.airline,
    flightNumber: r.flight_number,
    city: (direction === 'arrival' ? r.origin : r.destination) ?? '—',
    cityCode: direction === 'arrival' ? r.origin_code : r.destination_code,
    scheduled,
    estimated: status.time,
    status,
    isCodeshare: false,
    terminal: r.terminal,
    gate: r.gate,
    baggage: direction === 'arrival' ? r.baggage : undefined,
  }
}

export function normalizeSjc(arrivals: unknown[], departures: unknown[], now: Date): Flight[] {
  return [
    ...(arrivals as SjcRecord[]).map((r) => toFlight(r, 'arrival', now)),
    ...(departures as SjcRecord[]).map((r) => toFlight(r, 'departure', now)),
  ].filter((f): f is Flight => f !== null)
}
