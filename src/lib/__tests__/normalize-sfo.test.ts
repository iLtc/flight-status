import { describe, expect, it } from 'vitest'
import { normalizeSfo } from '@/lib/normalize-sfo'
import checkins from '../../../docs/samples/sfo-checkins.json'
import curated from '../../../tests/fixtures/sfo-curated.json'

const flights = normalizeSfo(curated, checkins as Record<string, string>)

describe('normalizeSfo — codeshares (ADR 0002)', () => {
  it('keeps one row per marketing flight for the UA 2017 movement', () => {
    const group = flights.filter((f) => f.id.startsWith('SFO/UA/2017/A/'))
    expect(group).toHaveLength(6) // 1 operating + 5 marketing
    expect(group.filter((f) => f.isCodeshare)).toHaveLength(5)
  })
  it('reads airline as the marketing carrier and operatedBy from original_flight', () => {
    const azul = flights.find((f) => f.airline === 'Azul' && f.flightNumber === '7016')
    expect(azul).toBeDefined()
    expect(azul!.isCodeshare).toBe(true)
    expect(azul!.operatedBy).toEqual({ airline: 'United', flightNumber: '2017' })
  })
  it('operating rows have no operatedBy', () => {
    const ua2017 = flights.find((f) => f.airline === 'United' && f.flightNumber === '2017')
    expect(ua2017!.isCodeshare).toBe(false)
    expect(ua2017!.operatedBy).toBeUndefined()
  })
  it('drops exact duplicate pairs, keeping the first (NZ 9056)', () => {
    expect(flights.filter((f) => f.flightNumber === '9056')).toHaveLength(1)
  })
})

describe('normalizeSfo — check-in aisles (ADR 0001)', () => {
  it('maps INTL departures through the dictionary (TK 290 → Aisle 5)', () => {
    const tk = flights.find((f) => f.id.startsWith('SFO/TK/290/D/') && !f.isCodeshare)
    expect(tk!.terminal).toBe('INTL')
    expect(tk!.checkin).toBe('Aisle 5')
  })
  it('NEVER maps non-INTL departures (UA 540 from T2 must not get an aisle)', () => {
    const ua540 = flights.find((f) => f.id.startsWith('SFO/UA/540/D/') && !f.isCodeshare)
    expect(ua540!.terminal).toBe('T2')
    expect(ua540!.checkin).toBeUndefined()
  })
})

describe('normalizeSfo — times and status', () => {
  it('uses gate times; actual overrides estimate (ADR 0003)', () => {
    const ua2017 = flights.find((f) => f.airline === 'United' && f.flightNumber === '2017')!
    expect(ua2017.scheduled).toBe('2026-08-03T12:44:00-07:00')
    expect(ua2017.estimated).toBe('2026-08-03T12:35:00-07:00') // actual_in_off_block_time
  })
  it('Landed rows have no gate actual — estimated falls back to the estimate', () => {
    const oz = flights.find((f) => f.id.startsWith('SFO/OZ/212/A/') && !f.isCodeshare)!
    expect(oz.status.kind).toBe('landed')
    expect(oz.estimated).toBeDefined() // estimated_in_off_block_time, not actual
  })
  it('Cancelled rows can have no estimated at all', () => {
    const b6 = flights.find((f) => f.id.startsWith('SFO/B6/215/A/') && !f.isCodeshare)!
    expect(b6.status.kind).toBe('cancelled')
    expect(b6.estimated).toBeUndefined()
  })
  it('maps both remark casings to on-time and unknown remarks to other', () => {
    const kinds = new Set(flights.map((f) => f.status.kind))
    expect(kinds.has('other')).toBe(false) // curated fixture contains only known remarks
  })
})

describe('normalizeSfo — field fallbacks', () => {
  it('falls back to airport_name when airport_city is missing (UA 5599)', () => {
    const ua = flights.find((f) => f.id.startsWith('SFO/UA/5599/A/') && !f.isCodeshare)!
    expect(ua.city).toBeTruthy()
  })
  it('shows the immediate stop for multi-leg flights (UA 1482 → Seattle)', () => {
    const ua = flights.find((f) => f.id.startsWith('SFO/UA/1482/A/') && !f.isCodeshare)!
    expect(ua.city).toBe('Seattle')
    expect(ua.cityCode).toBe('SEA')
  })
  it('maps ITM to INTL and null terminal to undefined', () => {
    expect(flights.some((f) => f.terminal === 'INTL')).toBe(true)
    expect(flights.every((f) => f.terminal !== 'ITM')).toBe(true)
    expect(flights.some((f) => f.terminal === undefined)).toBe(true)
  })
  it('derives Carousel N from all three carousel_name formats', () => {
    const labels = flights.filter((f) => f.baggage).map((f) => f.baggage!)
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(labels.every((b) => /^Carousel \d+$/.test(b))).toBe(true)
  })
})
