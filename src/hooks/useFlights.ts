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
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flashRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const loadRef = useRef<(force?: boolean) => void>(() => {})

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    clearTimeout(flashRef.current)
    flashRef.current = setTimeout(() => setFlash(null), FLASH_MS)
  }, [])

  const load = useCallback(async (force = false) => {
    clearTimeout(pollRef.current)
    if (force) setRefreshing(true)
    try {
      const headers: HeadersInit = etagRef.current
        ? { 'If-None-Match': etagRef.current }
        : {}
      const res = await fetch(
        `/api/flights?airport=${airport.toLowerCase()}${force ? '&forceRefresh=1' : ''}`,
        { headers, cache: 'no-store' },
      )
      if (res.status === 304) {
        setUpdatedAt(new Date())
        setFetchFailed(false)
        if (force) showFlash('Already up to date')
      } else if (res.ok) {
        const body: FlightsResponse = await res.json()
        if (force && cachedAtRef.current === body.cachedAt) showFlash('Already up to date')
        etagRef.current = res.headers.get('etag')
        cachedAtRef.current = body.cachedAt
        setData(body)
        setUpdatedAt(new Date())
        setFetchFailed(false)
      } else {
        setFetchFailed(true)
      }
    } catch {
      setFetchFailed(true)
    } finally {
      setRefreshing(false)
      // Restart the countdown AFTER the load completes, so a manual refresh
      // resets the timer. Hidden tabs skip the fetch and re-arm the timer.
      schedule()
    }
  }, [airport, showFlash])

  function schedule() {
    clearTimeout(pollRef.current)
    pollRef.current = setTimeout(() => {
      if (document.visibilityState === 'hidden') schedule()
      else loadRef.current()
    }, POLL_MS)
  }

  loadRef.current = load

  useEffect(() => {
    setData(null)
    setUpdatedAt(null)
    setFetchFailed(false)
    etagRef.current = null
    cachedAtRef.current = null
    load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(pollRef.current)
      clearTimeout(flashRef.current)
    }
  }, [load])

  return { data, updatedAt, fetchFailed, flash, refreshing, refresh: () => loadRef.current(true) }
}
