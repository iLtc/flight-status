import { describe, expect, it } from 'vitest'
import { normalizeSfo } from '@/lib/normalize-sfo'
import checkins from '../../../docs/samples/sfo-checkins.json'
import feed from '../../../docs/samples/sfo-flight-status.json'

interface RawRecord {
  remark: string | null
  is_code_share?: boolean
  original_flight?: unknown
  scheduled_in_off_block_time: string | null
  scheduled_aod_time: string | null
  estimated_in_off_block_time: string | null
  estimated_aod_time: string | null
}

const data = (feed as { data: RawRecord[] }).data

const KNOWN_REMARKS = new Set([
  'Arrived', 'Cancelled', 'Delayed', 'Departed', 'Departing',
  'Diverted', 'Landed', 'Last call', 'On Time', 'On time',
])

describe('SFO feed contract', () => {
  it('every remark is in the known set of ten', () => {
    const unknown = data.filter((r) => r.remark !== null && !KNOWN_REMARKS.has(r.remark))
    expect(unknown).toEqual([])
  })

  it('is_code_share is present iff original_flight is present', () => {
    const violations = data.filter(
      (r) => (r.is_code_share != null) !== (r.original_flight != null),
    )
    expect(violations).toEqual([])
  })

  it('no record is missing scheduled_in_off_block_time', () => {
    expect(data.filter((r) => !r.scheduled_in_off_block_time)).toEqual([])
  })

  it('scheduled and estimated agree across the gate/runway axes', () => {
    // The whole "gate vs runway only matters for actuals" simplification
    // rests on this invariant.
    expect(data.filter((r) => r.scheduled_aod_time !== r.scheduled_in_off_block_time)).toEqual([])
    expect(data.filter((r) => r.estimated_aod_time !== r.estimated_in_off_block_time)).toEqual([])
  })
})

describe('SFO checkins contract', () => {
  it('is exactly 168 counters mapping to 12 contiguous aisles of 14', () => {
    const dict = checkins as Record<string, string>
    const entries = Object.entries(dict)
    expect(entries).toHaveLength(168)
    const aisles = new Map<string, number>()
    for (const [, aisle] of entries) aisles.set(aisle, (aisles.get(aisle) ?? 0) + 1)
    expect(aisles.size).toBe(12)
    expect([...aisles.values()].every((n) => n === 14)).toBe(true)
  })
})

describe('full-feed normalization smoke', () => {
  it('normalizes the entire 2,650-record feed without throwing', () => {
    const flights = normalizeSfo(feed as { data: unknown[] }, checkins as Record<string, string>)
    expect(flights.length).toBe(2650 - 24) // dedupe drops the 24 exact duplicate pairs
    expect(flights.every((f) => f.status.kind !== 'other')).toBe(true)
  })
})
