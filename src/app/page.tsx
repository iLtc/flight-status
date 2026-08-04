'use client'

import { Suspense, useState } from 'react'
import { Header } from '@/components/Header'
import { useFlights } from '@/hooks/useFlights'
import type { Airport } from '@/lib/types'

function Shell() {
  const [airport, setAirport] = useState<Airport>('SFO')
  const { data, updatedAt, fetchFailed, flash, refreshing, refresh } = useFlights(airport)
  return (
    <main className="mx-auto max-w-7xl p-4">
      <Header
        airport={airport}
        onAirportChange={setAirport}
        updatedAt={updatedAt}
        cachedAt={data?.cachedAt ?? null}
        flash={flash}
        refreshing={refreshing}
        onForceRefresh={refresh}
      />
      {fetchFailed && <p className="mt-4 text-red-700">Fetch failed.</p>}
      <p className="mt-4 text-sm">{data ? `${data.flights.length} flights loaded` : 'Loading…'}</p>
    </main>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Shell />
    </Suspense>
  )
}
