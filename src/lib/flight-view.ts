import type { Flight } from '@/lib/types'

export type SortKey =
  | 'airline' | 'city' | 'flight' | 'sched' | 'est'
  | 'status' | 'terminal' | 'gate' | 'extra'

/** Epoch ms of the Effective time: Best-known when present, else Scheduled. */
export function effectiveTime(f: Flight): number {
  return Date.parse(f.estimated ?? f.scheduled)
}

const HOUR = 3_600_000

/** The Window: Effective time within [now − 1h, now + 8h]. */
export function windowed(flights: Flight[], now: Date): Flight[] {
  const lo = +now - HOUR
  const hi = +now + 8 * HOUR
  return flights.filter((f) => {
    const t = effectiveTime(f)
    return !Number.isNaN(t) && t >= lo && t <= hi
  })
}

function str(a: string | undefined, b: string | undefined): number {
  return (a ?? '').localeCompare(b ?? '', 'en', { sensitivity: 'base' })
}

function primaryCompare(a: Flight, b: Flight, key: SortKey): number {
  switch (key) {
    case 'airline': return str(a.airline, b.airline)
    case 'city': return str(a.city, b.city)
    case 'flight': return Number(a.flightNumber) - Number(b.flightNumber) || str(a.flightNumber, b.flightNumber)
    case 'sched': return Date.parse(a.scheduled) - Date.parse(b.scheduled)
    case 'est': return effectiveTime(a) - effectiveTime(b)
    case 'status': return str(a.status.text, b.status.text)
    case 'terminal': return str(a.terminal, b.terminal)
    case 'gate': return str(a.gate, b.gate)
    case 'extra': return str(a.baggage ?? a.checkin, b.baggage ?? b.checkin)
  }
}

/**
 * Ascending comparator; the caller reverses for descending. Low-cardinality
 * keys (terminal, gate, status) tie constantly — without a tiebreak, ties
 * fall back to whatever order the array happened to be in, which looks
 * arbitrary and reshuffles on every click. Falling back to Effective time
 * keeps a tied group internally time-ordered and stable across re-sorts.
 */
export function compareFlights(a: Flight, b: Flight, key: SortKey): number {
  return primaryCompare(a, b, key) || effectiveTime(a) - effectiveTime(b)
}

/** Prefix match on flight number; substring on airline and Far-end city. */
export function matchesQuery(f: Flight, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    f.flightNumber.toLowerCase().startsWith(needle) ||
    f.airline.toLowerCase().includes(needle) ||
    f.city.toLowerCase().includes(needle)
  )
}
