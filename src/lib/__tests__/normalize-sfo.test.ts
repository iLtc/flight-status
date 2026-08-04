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
    expect(tk!.direction).toBe('departure')
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
    expect(ua2017.direction).toBe('arrival')
    expect(ua2017.gate).toBe('E11')
    expect(ua2017.scheduled).toBe('2026-08-03T12:44:00-07:00')
    expect(ua2017.estimated).toBe('2026-08-03T12:35:00-07:00') // actual_in_off_block_time
  })
  it('Landed rows have no gate actual — estimated falls back to the estimate', () => {
    const oz = flights.find((f) => f.id.startsWith('SFO/OZ/212/A/') && !f.isCodeshare)!
    expect(oz.status.kind).toBe('landed')
    // estimated_in_off_block_time (16:20), NOT actual_aod_time (16:31) — the
    // runway actual exists on this row and toBeDefined() would wrongly accept it.
    expect(oz.estimated).toBe('2026-08-03T16:20:00-07:00')
  })
  it('Cancelled rows can have no estimated at all', () => {
    const b6 = flights.find((f) => f.id.startsWith('SFO/B6/215/A/') && !f.isCodeshare)!
    expect(b6.status.kind).toBe('cancelled')
    expect(b6.estimated).toBeUndefined()
  })
  it('maps both remark casings to on-time and unknown remarks to other', () => {
    const upper = flights.find((f) => f.id.startsWith('SFO/AC/744/D/') && !f.isCodeshare)!
    const lower = flights.find((f) => f.id.startsWith('SFO/UA/1243/A/') && !f.isCodeshare)!
    expect(upper.status.kind).toBe('on-time') // remark: "On Time"
    expect(lower.status.kind).toBe('on-time') // remark: "On time"
    const kinds = new Set(flights.map((f) => f.status.kind))
    expect(kinds.has('other')).toBe(false) // curated fixture contains only known remarks
  })
})

describe('normalizeSfo — malformed feed rows', () => {
  it('normalizes an INTL departure missing the checkins key instead of throwing', () => {
    const raw = {
      flight_id: 'XX/1/D',
      flight_kind: 'Departure',
      airline: { iata_code: 'XX', airline_name: 'Test Air' },
      flight_number: '1',
      airport: { iata_code: 'ZZZ', airport_city: 'Nowhere' },
      scheduled_in_off_block_time: '2026-08-03T12:00:00-07:00',
      estimated_in_off_block_time: null,
      actual_in_off_block_time: null,
      first_bag_time: null,
      last_bag_time: null,
      remark: 'On Time',
      terminal: { terminal_code: 'ITM' },
      gate: null,
      baggage_carousel: null,
      // checkins intentionally omitted — real-world feed drift, not a test artifact.
    }
    expect(() => normalizeSfo({ data: [raw] }, {})).not.toThrow()
    const result = normalizeSfo({ data: [raw] }, {})
    expect(result).toHaveLength(1)
    expect(result[0].terminal).toBe('INTL')
    expect(result[0].checkin).toBeUndefined()
  })
  it('normalizes a record missing airline and airport, and with a malformed checkins element, instead of throwing', () => {
    const raw = {
      flight_id: 'YY/2/D',
      flight_kind: 'Departure',
      // airline intentionally omitted — real-world feed drift, not a test artifact.
      flight_number: '2',
      // airport intentionally omitted.
      scheduled_in_off_block_time: '2026-08-03T12:00:00-07:00',
      estimated_in_off_block_time: null,
      actual_in_off_block_time: null,
      first_bag_time: null,
      last_bag_time: null,
      remark: 'On Time',
      terminal: { terminal_code: 'ITM' },
      gate: null,
      baggage_carousel: null,
      checkins: [{}], // malformed element — missing the `checkin` key entirely.
    }
    expect(() => normalizeSfo({ data: [raw] }, {})).not.toThrow()
    const result = normalizeSfo({ data: [raw] }, {})
    expect(result).toHaveLength(1)
    expect(result[0].airline).toBe('—')
    expect(result[0].airlineCode).toBeUndefined()
    expect(result[0].city).toBe('—')
    expect(result[0].cityCode).toBeUndefined()
    expect(result[0].terminal).toBe('INTL')
    expect(result[0].checkin).toBeUndefined()
  })
})

describe('normalizeSfo — field fallbacks', () => {
  it('falls back to airport_name when airport_city is missing (UA 5599 → Carlsbad)', () => {
    const ua = flights.find((f) => f.id.startsWith('SFO/UA/5599/A/') && !f.isCodeshare)!
    expect(ua.city).toBe('Carlsbad')
  })
  it('shows the immediate stop for multi-leg flights (UA 1482 → Seattle)', () => {
    const ua = flights.find((f) => f.id.startsWith('SFO/UA/1482/A/') && !f.isCodeshare)!
    expect(ua.city).toBe('Seattle')
    expect(ua.cityCode).toBe('SEA')
    expect(ua.bagTimes).toEqual({
      first: '2026-08-03T13:41:00-07:00',
      last: '2026-08-03T13:57:00-07:00',
    })
  })
  it('prefers airline_display_name over airline_name when they diverge (DL 667 → "Delta")', () => {
    // airline_name is "DELTA"; a reversed fallback order would pass this
    // through unchanged instead of preferring the display name.
    const dl = flights.find((f) => f.id.startsWith('SFO/DL/667/A/') && !f.isCodeshare)!
    expect(dl.airline).toBe('Delta')
  })
  it('prefers airline_display_name for post-merger carriers (Alaska → Hawaiian Airlines)', () => {
    const ha = flights.find((f) => f.id.startsWith('SFO/AS/978/A/') && !f.isCodeshare)!
    expect(ha.airline).toBe('Hawaiian Airlines')
  })
  it('maps ITM to INTL and null terminal to undefined', () => {
    expect(flights.some((f) => f.terminal === 'INTL')).toBe(true)
    expect(flights.every((f) => f.terminal !== 'ITM')).toBe(true)
    expect(flights.some((f) => f.terminal === undefined)).toBe(true)
  })
  it('derives Carousel N from all three carousel_name formats', () => {
    const dashLetter = flights.find((f) => f.id.startsWith('SFO/UA/2017/A/') && !f.isCodeshare)!
    expect(dashLetter.baggage).toBe('Carousel 5') // "CL-F5" — discards the boarding-area letter
    const dashless = flights.find((f) => f.id.startsWith('SFO/AV/562/A/') && !f.isCodeshare)!
    expect(dashless.baggage).toBe('Carousel 10') // "CL10"
    const labels = flights.filter((f) => f.baggage).map((f) => f.baggage!)
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(labels.every((b) => /^Carousel \d+$/.test(b))).toBe(true)
  })
})
