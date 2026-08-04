import type { Airport } from '@/lib/types'

const TTL_MS = 5 * 60_000
const FORCE_TTL_MS = 60_000

interface Entry<T> {
  value?: T
  fetchedAt?: number
  inFlight?: Promise<void>
}

/**
 * Per-airport in-memory cache. 5-minute TTL, 1-minute floor under force.
 * Concurrent misses share one upstream fetch. Failures serve the previous
 * value with stale: true, or rethrow when nothing has ever been cached.
 */
export function createCache<T>(fetcher: (airport: Airport) => Promise<T>) {
  const entries = new Map<Airport, Entry<T>>()

  async function get(
    airport: Airport,
    opts: { force?: boolean } = {},
  ): Promise<{ value: T; fetchedAt: number; stale: boolean }> {
    let entry = entries.get(airport)
    if (!entry) {
      entry = {}
      entries.set(airport, entry)
    }
    const ttl = opts.force ? FORCE_TTL_MS : TTL_MS
    if (entry.value !== undefined && Date.now() - entry.fetchedAt! < ttl) {
      return { value: entry.value, fetchedAt: entry.fetchedAt!, stale: false }
    }
    if (!entry.inFlight) {
      entry.inFlight = fetcher(airport)
        .then((value) => {
          entry.value = value
          entry.fetchedAt = Date.now()
        })
        .finally(() => {
          entry.inFlight = undefined
        })
    }
    try {
      await entry.inFlight
      return { value: entry.value!, fetchedAt: entry.fetchedAt!, stale: false }
    } catch (err) {
      if (entry.value !== undefined) {
        return { value: entry.value, fetchedAt: entry.fetchedAt!, stale: true }
      }
      throw err
    }
  }

  return { get }
}
