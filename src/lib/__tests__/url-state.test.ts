import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, parseView, serializeView } from '@/lib/url-state'

describe('parseView', () => {
  it('returns defaults for an empty query', () => {
    expect(parseView(new URLSearchParams(''))).toEqual(DEFAULT_VIEW)
  })
  it('parses a fully specified query', () => {
    const v = parseView(new URLSearchParams(
      'airport=SJC&dir=arrivals&q=1260&airline=Delta&terminal=A&location=SLC&hideCodeshares=1&sort=sched.desc',
    ))
    expect(v).toEqual({
      airport: 'SJC', dir: 'arrival', q: '1260', airline: 'Delta',
      terminal: 'A', location: 'SLC', hideCodeshares: true,
      sort: { key: 'sched', asc: false },
    })
  })
  it('falls back to defaults on garbage values', () => {
    const v = parseView(new URLSearchParams('airport=LAX&dir=sideways&sort=nope.upward'))
    expect(v).toEqual(DEFAULT_VIEW)
  })
})

describe('serializeView', () => {
  it('serializes all-defaults to an empty string', () => {
    expect(serializeView(DEFAULT_VIEW)).toBe('')
  })
  it('omits defaults and writes the rest', () => {
    const qs = serializeView({
      ...DEFAULT_VIEW, airport: 'SJC', q: '29', sort: { key: 'sched', asc: false },
    })
    expect(qs).toBe('airport=SJC&q=29&sort=sched.desc')
  })
  it('round-trips', () => {
    const v = {
      ...DEFAULT_VIEW, dir: 'arrival' as const, airline: 'Alaska Airlines',
      hideCodeshares: true,
    }
    expect(parseView(new URLSearchParams(serializeView(v)))).toEqual(v)
  })
  it('round-trips every field at once', () => {
    const v = {
      airport: 'SJC' as const, dir: 'arrival' as const, q: '1260',
      airline: 'Delta', terminal: 'A', location: 'SLC', hideCodeshares: true,
      sort: { key: 'gate' as const, asc: false },
    }
    expect(parseView(new URLSearchParams(serializeView(v)))).toEqual(v)
  })
  it('round-trips a non-default asc on the default sort key', () => {
    const v = { ...DEFAULT_VIEW, sort: { key: 'est' as const, asc: false } }
    expect(parseView(new URLSearchParams(serializeView(v)))).toEqual(v)
  })
})
