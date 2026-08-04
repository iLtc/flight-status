import { describe, expect, it } from 'vitest'
import { normalizeSjc } from '@/lib/normalize-sjc'
import arrivals from '../../../docs/samples/sjc-arrivals.json'
import departures from '../../../docs/samples/sjc-departures.json'

const NOW = new Date('2026-08-03T16:42:00-07:00')
const flights = normalizeSjc(arrivals, departures, NOW)

describe('normalizeSjc — shape', () => {
  it('produces one Flight per record with directions from the source arrays', () => {
    expect(flights.filter((f) => f.direction === 'arrival')).toHaveLength(arrivals.length)
    expect(flights.filter((f) => f.direction === 'departure')).toHaveLength(departures.length)
  })
  it('never marks codeshares and never sets airlineCode', () => {
    expect(flights.every((f) => !f.isCodeshare && f.airlineCode === undefined)).toBe(true)
  })
  it('maps far end city, code, terminal, gate, baggage', () => {
    const sw443 = flights.find((f) => f.flightNumber === '443' && f.airline === 'Southwest')!
    expect(sw443.city).toBe('Spokane, WA')
    expect(sw443.cityCode).toBe('GEG')
    expect(sw443.terminal).toBe('B')
    expect(sw443.gate).toBe('26')
    expect(sw443.baggage).toBe('B3')
  })
})

describe('normalizeSjc — status parsing', () => {
  it('parses On Time with no embedded time', () => {
    const f = flights.find((x) => x.status.text === 'On Time')!
    expect(f.status.kind).toBe('on-time')
    expect(f.status.time).toBeUndefined()
    expect(f.estimated).toBeUndefined()
  })
  it('parses "Delayed 4:44 PM" into kind + time + estimated (SW 2350)', () => {
    const f = flights.find((x) => x.flightNumber === '2350' && x.direction === 'arrival')!
    expect(f.status.kind).toBe('delayed')
    expect(f.status.time).toBe('2026-08-03T16:44:00-07:00')
    expect(f.estimated).toBe('2026-08-03T16:44:00-07:00')
  })
  it('parses Early and Arrived and Departed', () => {
    expect(flights.some((f) => f.status.kind === 'early')).toBe(true)
    expect(flights.some((f) => f.status.kind === 'arrived')).toBe(true)
    expect(flights.some((f) => f.status.kind === 'departed')).toBe(true)
  })
  it('keeps a Delayed time earlier than scheduled as-is (DL 3822: 4:30 PM → 4:20 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '3822' && x.direction === 'departure')!
    expect(f.scheduled).toBe('2026-08-03T16:30:00-07:00')
    expect(f.status.kind).toBe('delayed')
    expect(f.estimated).toBe('2026-08-03T16:20:00-07:00')
  })
  it('treats an unknown status string as other, not a crash', () => {
    const weird = normalizeSjc(
      [{ date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: '1',
         origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
         status: 'Gate Change' }],
      [], NOW,
    )
    expect(weird[0].status).toEqual({ kind: 'other', text: 'Gate Change' })
  })
  it('rolls a status time crossing midnight forward one day', () => {
    const late = normalizeSjc(
      [{ date: 'Aug 03', time: '11:55 PM', airline: 'X', flight_number: '2',
         origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
         status: 'Delayed 12:10 AM' }],
      [], NOW,
    )
    expect(late[0].scheduled).toBe('2026-08-03T23:55:00-07:00')
    expect(late[0].estimated).toBe('2026-08-04T00:10:00-07:00')
  })
})
