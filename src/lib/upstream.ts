import { normalizeSfo } from '@/lib/normalize-sfo'
import { normalizeSjc } from '@/lib/normalize-sjc'
import type { Airport, Flight } from '@/lib/types'

const SFO_FLIGHTS_URL = 'https://www.flysfo.com/flysfo/api/flight-status'
const SFO_CHECKINS_URL = 'https://www.flysfo.com/flysfo/api/checkins'
const SJC_ARRIVALS_URL = 'https://www.flysanjose.com/api/flightstatus/arrivals'
const SJC_DEPARTURES_URL = 'https://www.flysanjose.com/api/flightstatus/departures'

const TIMEOUT_MS = 10_000

async function getJson(url: string): Promise<unknown> {
  // Timeout is load-bearing: a stalled upstream body would otherwise hang the
  // route handler forever and the serve-stale path would never fire.
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} responded ${res.status}`)
  return res.json()
}

export async function fetchAirport(airport: Airport): Promise<Flight[]> {
  if (airport === 'SFO') {
    const [feed, checkins] = await Promise.all([
      getJson(SFO_FLIGHTS_URL),
      getJson(SFO_CHECKINS_URL),
    ])
    return normalizeSfo(feed as { data: unknown[] }, checkins as Record<string, string>)
  }
  const [arrivals, departures] = await Promise.all([
    getJson(SJC_ARRIVALS_URL),
    getJson(SJC_DEPARTURES_URL),
  ])
  return normalizeSjc(arrivals as unknown[], departures as unknown[], new Date())
}
