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
  it('maps far end city and code for departures too (SW 3266 → Phoenix, AZ / PHX)', () => {
    const sw3266 = flights.find((f) => f.flightNumber === '3266' && f.direction === 'departure')!
    expect(sw3266.city).toBe('Phoenix, AZ')
    expect(sw3266.cityCode).toBe('PHX')
  })
  it('never carries baggage on departures, even if the raw record has one', () => {
    const withSpuriousBaggage = normalizeSjc(
      [],
      [{ date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: '9',
         destination: 'Y', destination_code: 'YYY', terminal: 'A', gate: '1',
         baggage: 'Z9', status: 'On Time' }],
      NOW,
    )
    expect(withSpuriousBaggage[0].baggage).toBeUndefined()
  })
  it('skips a row with an unparseable scheduled time, keeping the good row', () => {
    const mixed = normalizeSjc(
      [
        { date: 'Xyz 99', time: '4:05 PM', airline: 'X', flight_number: 'BAD',
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
        { date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: 'GOOD',
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
      ],
      [], NOW,
    )
    expect(mixed).toHaveLength(1)
    expect(mixed[0].flightNumber).toBe('GOOD')
  })
  it('skips a row whose date field is not a string (malformed feed), keeping the good row', () => {
    const mixed = normalizeSjc(
      [
        { date: 20260803, time: '4:05 PM', airline: 'X', flight_number: 'BAD',
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
        { date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: 'GOOD',
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
      ],
      [], NOW,
    )
    expect(mixed).toHaveLength(1)
    expect(mixed[0].flightNumber).toBe('GOOD')
  })
  it('skips a row whose flight_number is not a string (malformed feed), keeping the good row', () => {
    const mixed = normalizeSjc(
      [
        { date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: 9999,
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
        { date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: 'GOOD',
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
      ],
      [], NOW,
    )
    expect(mixed).toHaveLength(1)
    expect(mixed[0].flightNumber).toBe('GOOD')
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
  it('parses Early into kind + estimated (DL 3897 arrival: Early 4:53 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '3897' && x.direction === 'arrival')!
    expect(f.status.kind).toBe('early')
    expect(f.estimated).toBe('2026-08-03T16:53:00-07:00')
  })
  it('parses Arrived into kind + estimated (SW 443 arrival: Arrived 4:01 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '443' && x.direction === 'arrival')!
    expect(f.status.kind).toBe('arrived')
    expect(f.estimated).toBe('2026-08-03T16:01:00-07:00')
  })
  it('parses Departed into kind + estimated (SW 3266 departure: Departed 4:27 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '3266' && x.direction === 'departure')!
    expect(f.status.kind).toBe('departed')
    expect(f.estimated).toBe('2026-08-03T16:27:00-07:00')
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
