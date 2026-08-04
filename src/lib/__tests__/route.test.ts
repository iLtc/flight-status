import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'

const sfoFeed = readFileSync('docs/samples/sfo-flight-status.json', 'utf8')
const sfoCheckins = readFileSync('docs/samples/sfo-checkins.json', 'utf8')
const sjcArrivals = readFileSync('docs/samples/sjc-arrivals.json', 'utf8')
const sjcDepartures = readFileSync('docs/samples/sjc-departures.json', 'utf8')

function stubUpstream(fail = false) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (fail) throw new Error('upstream down')
    const url = String(input)
    const body =
      url.includes('flysfo') && url.includes('flight-status') ? sfoFeed :
      url.includes('flysfo') ? sfoCheckins :
      url.includes('arrivals') ? sjcArrivals : sjcDepartures
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

async function importRoute() {
  vi.resetModules()
  return await import('@/app/api/flights/route')
}

const request = (qs: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/flights?${qs}`, { headers })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-03T16:42:00-07:00'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GET /api/flights', () => {
  it('rejects a bad airport', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    expect((await GET(request('airport=oak'))).status).toBe(400)
  })

  it('returns a windowed normalized SFO payload with cache metadata', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const res = await GET(request('airport=sfo'))
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeTruthy()
    const body = await res.json()
    expect(body.airport).toBe('SFO')
    expect(body.stale).toBe(false)
    expect(body.cachedAt).toBe('2026-08-03T16:42:00-07:00')
    expect(body.flights.length).toBeGreaterThan(1500) // windowed subset of 2,626
    expect(body.flights.length).toBeLessThan(2626)
  })

  it('serves SJC and includes both directions', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const body = await (await GET(request('airport=sjc'))).json()
    const dirs = new Set(body.flights.map((f: { direction: string }) => f.direction))
    expect(dirs).toEqual(new Set(['arrival', 'departure']))
  })

  it('answers 304 to a matching If-None-Match', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const first = await GET(request('airport=sfo'))
    const etag = first.headers.get('etag')!
    const second = await GET(request('airport=sfo', { 'if-none-match': etag }))
    expect(second.status).toBe(304)
  })

  it('502s when upstream fails with nothing cached', async () => {
    stubUpstream(true)
    const { GET } = await importRoute()
    expect((await GET(request('airport=sfo'))).status).toBe(502)
  })

  it('serves stale with stale:true when upstream fails after a success', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    await GET(request('airport=sfo'))
    vi.setSystemTime(new Date('2026-08-03T16:48:00-07:00')) // TTL expired
    stubUpstream(true)
    const res = await GET(request('airport=sfo'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale).toBe(true)
    expect(body.cachedAt).toBe('2026-08-03T16:42:00-07:00')
  })
})

describe('GET /api/health', () => {
  it('returns ok without touching upstream', async () => {
    stubUpstream(true) // even a dead upstream must not matter
    vi.resetModules()
    const { GET } = await import('@/app/api/health/route')
    const res = GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
