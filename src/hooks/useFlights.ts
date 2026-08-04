'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Airport, FlightsResponse } from '@/lib/types'

const POLL_MS = 60_000
const FLASH_MS = 3_000

export function useFlights(airport: Airport) {
  const [data, setData] = useState<FlightsResponse | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const etagRef = useRef<string | null>(null)
  const cachedAtRef = useRef<string | null>(null)
  const staleRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flashRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const loadRef = useRef<(force?: boolean) => void>(() => {})
  // Bumped at the start of every load() and on every airport switch. A load
  // only applies its result if its captured generation still matches when it
  // resolves — otherwise it mutates nothing. This is what stops a slow
  // response for an airport the user has since switched away from (or a slow
  // poll overtaken by a faster forced refresh) from clobbering newer state.
  // Do not delete this as ceremony: without it, a fetch in flight during an
  // airport switch can land later and silently overwrite the screen with the
  // wrong airport's flights.
  const generationRef = useRef(0)

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    clearTimeout(flashRef.current)
    flashRef.current = setTimeout(() => setFlash(null), FLASH_MS)
  }, [])

  const load = useCallback(async (force = false) => {
    const gen = ++generationRef.current
    clearTimeout(pollRef.current)
    if (force) setRefreshing(true)
    try {
      const headers: HeadersInit = etagRef.current
        ? { 'If-None-Match': etagRef.current }
        : {}
      const res = await fetch(
        `/api/flights?airport=${airport.toLowerCase()}${force ? '&forceRefresh=1' : ''}`,
        { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) },
      )
      if (gen !== generationRef.current) return
      if (res.status === 304) {
        setUpdatedAt(new Date())
        setFetchFailed(false)
        // Guarded on !staleRef.current: the ETag now folds in the stale
        // flag (see route.ts), so a 304 during an outage only happens once
        // the client already holds the stale ETag — i.e. every force press
        // after the first one in that outage. Without this guard, that
        // second-and-later press would flash "Already up to date" while
        // gates and times are still drifting.
        if (force && !staleRef.current) showFlash('Already up to date')
      } else if (res.ok) {
        const body: FlightsResponse = await res.json()
        if (gen !== generationRef.current) return
        // Guarded on !body.stale: cachedAt is unchanged both when the data
        // is genuinely fresh (nothing new upstream) AND when it's stale
        // (cache.ts pins fetchedAt on failure) — only the former is real
        // reassurance. Without this guard a force refresh during an outage
        // would flash "Already up to date" while gates and times drift.
        if (force && !body.stale && cachedAtRef.current === body.cachedAt) showFlash('Already up to date')
        etagRef.current = res.headers.get('etag')
        cachedAtRef.current = body.cachedAt
        staleRef.current = body.stale
        setData(body)
        setUpdatedAt(new Date())
        setFetchFailed(false)
      } else {
        setFetchFailed(true)
      }
    } catch {
      if (gen !== generationRef.current) return
      setFetchFailed(true)
    } finally {
      if (gen === generationRef.current) {
        setRefreshing(false)
        // Restart the countdown AFTER the load completes, so a manual refresh
        // resets the timer. Hidden tabs skip the fetch and re-arm the timer.
        schedule()
      }
    }
  }, [airport, showFlash])

  function schedule() {
    clearTimeout(pollRef.current)
    pollRef.current = setTimeout(() => {
      if (document.visibilityState === 'hidden') schedule()
      else loadRef.current()
    }, POLL_MS)
  }

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    generationRef.current++
    setData(null)
    setUpdatedAt(null)
    setFetchFailed(false)
    setFlash(null)
    etagRef.current = null
    cachedAtRef.current = null
    staleRef.current = false
    load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      // Bump first: invalidates any load still in flight so its `finally`
      // cannot call schedule() after we've just cleared the timer below,
      // which would otherwise arm an orphan poller with no live component
      // (or, on airport switch, for the airport we're leaving).
      generationRef.current++
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(pollRef.current)
      clearTimeout(flashRef.current)
    }
  }, [load])

  return { data, updatedAt, fetchFailed, flash, refreshing, refresh: () => loadRef.current(true) }
}
