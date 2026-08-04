import { type NextRequest, NextResponse } from 'next/server'
import { createCache } from '@/lib/cache'
import { windowed } from '@/lib/flight-view'
import { toPtIso } from '@/lib/time'
import type { Airport, FlightsResponse } from '@/lib/types'
import { fetchAirport } from '@/lib/upstream'

// Module scope: the cache lives for the lifetime of the server process.
const cache = createCache(fetchAirport)

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const airport = params.get('airport')?.toUpperCase()
  if (airport !== 'SFO' && airport !== 'SJC') {
    return NextResponse.json({ error: 'airport must be sfo or sjc' }, { status: 400 })
  }
  const force = params.get('forceRefresh') === '1'

  let result
  try {
    result = await cache.get(airport as Airport, { force })
  } catch {
    return NextResponse.json({ error: `Could not reach ${airport}` }, { status: 502 })
  }

  // The stale flag is folded into the ETag: a stale response deliberately
  // reuses the original fetchedAt (see cache.ts), so without this a client
  // holding the pre-outage ETag would get a 304 and never learn the data
  // went stale. Folding stale in means the held ETag stops matching the
  // moment the cache goes stale, so the client gets exactly one fresh 200
  // carrying stale:true, then cheap 304s again until recovery changes
  // fetchedAt and the ETag again.
  const etag = `"${airport}-${result.fetchedAt}-${result.stale ? 1 : 0}"`
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store' },
    })
  }

  const body: FlightsResponse = {
    airport: airport as Airport,
    cachedAt: toPtIso(new Date(result.fetchedAt)),
    stale: result.stale,
    flights: windowed(result.value, new Date()),
  }
  return NextResponse.json(body, {
    headers: { ETag: etag, 'Cache-Control': 'no-store' },
  })
}
