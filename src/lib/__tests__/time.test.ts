import { describe, expect, it } from 'vitest'
import { formatTimePT, isNextDayPT, parseSjcDateTime, toPtIso } from '@/lib/time'

// The instant the samples were captured — pin for all time-dependent tests.
const NOW = new Date('2026-08-03T16:42:00-07:00')

describe('parseSjcDateTime', () => {
  it('parses an SJC date+time into a PT-offset ISO string', () => {
    expect(parseSjcDateTime('Aug 03', '4:05 PM', NOW)).toBe('2026-08-03T16:05:00-07:00')
  })

  it('parses a morning time', () => {
    expect(parseSjcDateTime('Aug 03', '12:10 AM', NOW)).toBe('2026-08-03T00:10:00-07:00')
  })

  it('handles winter dates with the PST offset', () => {
    const winterNow = new Date('2026-01-15T12:00:00-08:00')
    expect(parseSjcDateTime('Jan 15', '4:05 PM', winterNow)).toBe('2026-01-15T16:05:00-08:00')
  })

  it('infers the year across the Dec 31 → Jan 1 boundary', () => {
    const nye = new Date('2026-12-31T23:00:00-08:00')
    expect(parseSjcDateTime('Jan 01', '1:00 AM', nye)).toBe('2027-01-01T01:00:00-08:00')
    const nyd = new Date('2027-01-01T01:00:00-08:00')
    expect(parseSjcDateTime('Dec 31', '11:00 PM', nyd)).toBe('2026-12-31T23:00:00-08:00')
  })

  it('returns null for garbage', () => {
    expect(parseSjcDateTime('Aug 03', 'soon', NOW)).toBeNull()
    expect(parseSjcDateTime('', '4:05 PM', NOW)).toBeNull()
  })
})

describe('toPtIso', () => {
  it('formats an instant with the PT offset', () => {
    expect(toPtIso(new Date('2026-08-03T23:42:00Z'))).toBe('2026-08-03T16:42:00-07:00')
  })
})

describe('formatTimePT', () => {
  it('renders h:mm AM/PM in PT regardless of server TZ', () => {
    expect(formatTimePT('2026-08-03T23:42:00Z')).toBe('4:42 PM')
    expect(formatTimePT('2026-08-04T00:12:00-07:00')).toBe('12:12 AM')
  })
})

describe('isNextDayPT', () => {
  it('is false for a time today (PT)', () => {
    expect(isNextDayPT('2026-08-03T22:33:00-07:00', NOW)).toBe(false)
  })
  it('is true for a time tomorrow (PT)', () => {
    expect(isNextDayPT('2026-08-04T00:12:00-07:00', NOW)).toBe(true)
  })
})
