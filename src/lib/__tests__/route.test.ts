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
    const res = await GET(request('airport=sjc'))
    expect(res.status).toBe(200)
    const body = await res.json()
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
    expect(await second.text()).toBe('')
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

  it('serves a fresh 200 with stale:true — not a 304 — to a client holding the pre-outage ETag', async () => {
    // Regression: the ETag used to be derived from airport+fetchedAt only,
    // so a stale response (which deliberately preserves the original
    // fetchedAt) carried the SAME ETag as the fresh response it mirrors.
    // A client polling every 60s and already holding that ETag would get a
    // 304 during an outage and never learn stale:true — the amber banner
    // never renders and Force Refresh falsely flashes "Already up to date".
    stubUpstream()
    const { GET } = await importRoute()
    const first = await GET(request('airport=sfo'))
    const etag = first.headers.get('etag')!
    vi.setSystemTime(new Date('2026-08-03T16:48:00-07:00')) // TTL expired
    stubUpstream(true)
    const res = await GET(request('airport=sfo', { 'if-none-match': etag }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale).toBe(true)
    expect(res.headers.get('etag')).not.toBe(etag)
  })

  it('forceRefresh bypasses the 5-minute TTL early, via the 1-minute force floor', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const first = await GET(request('airport=sfo'))
    const etag = first.headers.get('etag')!

    // +90s: fresh under the 5-minute normal TTL, stale under the 1-minute force TTL.
    vi.setSystemTime(new Date('2026-08-03T16:43:30-07:00'))

    const plain = await GET(request('airport=sfo'))
    expect(plain.headers.get('etag')).toBe(etag)

    const forced = await GET(request('airport=sfo&forceRefresh=1'))
    expect(forced.headers.get('etag')).not.toBe(etag)
  })

  it('sends a timeout signal with every upstream fetch', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    await GET(request('airport=sfo'))
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
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
