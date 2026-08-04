import { describe, expect, it } from 'vitest'
import { compareFlights, effectiveTime, matchesQuery, windowed } from '@/lib/flight-view'
import type { Flight } from '@/lib/types'

const NOW = new Date('2026-08-03T16:42:00-07:00')

function flight(over: Partial<Flight>): Flight {
  return {
    id: 'SFO/x', airport: 'SFO', direction: 'departure', airline: 'United',
    flightNumber: '100', city: 'Denver', scheduled: '2026-08-03T17:00:00-07:00',
    status: { kind: 'on-time', text: 'On Time' }, isCodeshare: false,
    ...over,
  }
}

describe('effectiveTime and windowed', () => {
  it('prefers estimated over scheduled', () => {
    const f = flight({ estimated: '2026-08-03T19:52:00-07:00', scheduled: '2026-08-03T13:10:00-07:00' })
    expect(effectiveTime(f)).toBe(Date.parse('2026-08-03T19:52:00-07:00'))
  })
  it('keeps the DL 691 shape: scheduled before the window, estimate inside', () => {
    const f = flight({ scheduled: '2026-08-03T13:10:00-07:00', estimated: '2026-08-03T19:52:00-07:00' })
    expect(windowed([f], NOW)).toHaveLength(1)
  })
  it('drops flights outside −1h/+8h', () => {
    const past = flight({ scheduled: '2026-08-03T15:41:00-07:00' })   // 61 min ago
    const future = flight({ scheduled: '2026-08-04T00:43:00-07:00' }) // 8h 1min ahead
    const edge = flight({ scheduled: '2026-08-03T15:43:00-07:00' })   // 59 min ago
    expect(windowed([past, future, edge], NOW)).toEqual([edge])
  })
  it('includes flights at exactly the −1h and +8h boundaries (inclusive both ends)', () => {
    const lowerEdge = flight({ scheduled: '2026-08-03T15:42:00-07:00' })  // exactly now − 1h
    const upperEdge = flight({ scheduled: '2026-08-04T00:42:00-07:00' })  // exactly now + 8h
    expect(windowed([lowerEdge, upperEdge], NOW)).toEqual([lowerEdge, upperEdge])
  })
  it('drops a flight with an unparseable scheduled time instead of letting it leak through', () => {
    const bad = flight({ scheduled: 'not-a-time', estimated: undefined })
    const good = flight({ scheduled: '2026-08-03T17:00:00-07:00' })
    expect(windowed([bad, good], NOW)).toEqual([good])
  })
})

describe('compareFlights', () => {
  it('sorts est by effective time so estimate-less rows interleave by scheduled', () => {
    const a = flight({ scheduled: '2026-08-03T17:00:00-07:00' }) // no estimate
    const b = flight({ scheduled: '2026-08-03T16:00:00-07:00', estimated: '2026-08-03T18:00:00-07:00' })
    expect(compareFlights(a, b, 'est')).toBeLessThan(0)
  })
  it('sorts flight numbers numerically', () => {
    const a = flight({ flightNumber: '99' })
    const b = flight({ flightNumber: '540' })
    expect(compareFlights(a, b, 'flight')).toBeLessThan(0)
  })
  it('sorts strings case-insensitively', () => {
    const a = flight({ airline: 'alaska' })
    const b = flight({ airline: 'United' })
    expect(compareFlights(a, b, 'airline')).toBeLessThan(0)
  })
  it('treats identical airline names differing only in case as equal', () => {
    const a = flight({ airline: 'united' })
    const b = flight({ airline: 'United' })
    expect(compareFlights(a, b, 'airline')).toBe(0)
  })
  it('sorts sched by scheduled time, ignoring the estimate', () => {
    const a = flight({ scheduled: '2026-08-03T16:00:00-07:00', estimated: '2026-08-03T20:00:00-07:00' })
    const b = flight({ scheduled: '2026-08-03T17:00:00-07:00' })
    expect(compareFlights(a, b, 'sched')).toBeLessThan(0)
  })
  it('sorts extra by baggage, preferring baggage over checkin when both are present, falling back to checkin otherwise', () => {
    const withBoth = flight({ baggage: 'Carousel 9', checkin: 'Aisles 1-2' })
    const baggageOnly = flight({ baggage: 'Carousel 1' })
    expect(compareFlights(withBoth, baggageOnly, 'extra')).toBeGreaterThan(0)

    const checkinOnly = flight({ checkin: 'Aisles 1-2' })
    expect(compareFlights(checkinOnly, baggageOnly, 'extra')).toBeLessThan(0)
  })
})

describe('matchesQuery', () => {
  const f = flight({ airline: 'Turkish Airlines', flightNumber: '290', city: 'Istanbul' })
  it('matches flight number by prefix, not substring', () => {
    expect(matchesQuery(f, '29')).toBe(true)
    expect(matchesQuery(f, '90')).toBe(false)
  })
  it('matches airline and city by substring, case-insensitive', () => {
    expect(matchesQuery(f, 'turkish')).toBe(true)
    expect(matchesQuery(f, 'stanbul')).toBe(true)
  })
  it('empty query matches everything', () => {
    expect(matchesQuery(f, '')).toBe(true)
    expect(matchesQuery(f, '  ')).toBe(true)
  })
  it('does not search airline codes', () => {
    const withCode = flight({ airline: 'Turkish Airlines', airlineCode: 'TK', flightNumber: '290', city: 'Istanbul' })
    expect(matchesQuery(withCode, 'tk')).toBe(false)
  })
})
