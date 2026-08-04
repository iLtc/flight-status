'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { FilterBar } from '@/components/FilterBar'
import { FlightTable } from '@/components/FlightTable'
import { Header } from '@/components/Header'
import { useFlights } from '@/hooks/useFlights'
import { compareFlights, matchesQuery } from '@/lib/flight-view'
import { formatTimePT } from '@/lib/time'
import { DEFAULT_VIEW, parseView, serializeView, type ViewState } from '@/lib/url-state'

function Dashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = useMemo(() => parseView(new URLSearchParams(searchParams)), [searchParams])
  const { data, updatedAt, fetchFailed, flash, refreshing, refresh } = useFlights(view.airport)

  const setView = (patch: Partial<ViewState>) => {
    let next = { ...view, ...patch }
    // Airport switch clears the data-derived dropdowns; dir/sort/q/codeshares survive.
    if (patch.airport && patch.airport !== view.airport) {
      next = { ...next, airline: '', terminal: '', location: '' }
    }
    const qs = serializeView(next)
    router.replace(qs ? `?${qs}` : '/', { scroll: false })
  }

  const directional = useMemo(
    () => (data?.flights ?? []).filter((f) => f.direction === view.dir),
    [data, view.dir],
  )
  const visible = useMemo(() => {
    const filtered = directional.filter((f) =>
      (!view.hideCodeshares || !f.isCodeshare) &&
      (!view.airline || f.airline === view.airline) &&
      (!view.terminal || f.terminal === view.terminal) &&
      (!view.location || (f.cityCode ?? f.city) === view.location) &&
      matchesQuery(f, view.q),
    )
    const sorted = [...filtered].sort((a, b) => compareFlights(a, b, view.sort.key))
    return view.sort.asc ? sorted : sorted.reverse()
  }, [directional, view])

  const onSort = (key: ViewState['sort']['key']) =>
    setView({ sort: { key, asc: view.sort.key === key ? !view.sort.asc : true } })

  const emptyMessage = data?.stale
    ? `${view.airport} is unreachable and the cached data has aged out of the window — this may not mean there are no flights.`
    : 'No flights match the current filters and time window.'

  return (
    <main className="mx-auto max-w-7xl p-4">
      <Header
        airport={view.airport}
        onAirportChange={(airport) => setView({ airport })}
        updatedAt={updatedAt}
        cachedAt={data?.cachedAt ?? null}
        flash={flash}
        refreshing={refreshing}
        onForceRefresh={refresh}
      />
      {data?.stale && (
        <p className="mt-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Couldn&apos;t reach {view.airport} — showing data from {formatTimePT(data.cachedAt)}.
        </p>
      )}
      {fetchFailed && data && (
        <p className="mt-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Last refresh failed — retrying every minute.
        </p>
      )}
      {fetchFailed && !data ? (
        <div className="mt-16 text-center">
          <p className="text-slate-600">Couldn&apos;t load flight data.</p>
          <button
            onClick={() => refresh()}
            className="mt-3 rounded-md bg-indigo-950 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <FilterBar
            view={view}
            flights={directional}
            onChange={setView}
            onReset={() => setView({ ...DEFAULT_VIEW, airport: view.airport, dir: view.dir })}
          />
          <div className="mt-3 overflow-x-auto">
            {data ? (
              <FlightTable
                flights={visible}
                direction={view.dir}
                sort={view.sort}
                onSort={onSort}
                emptyMessage={emptyMessage}
              />
            ) : (
              <p className="py-16 text-center text-slate-500">Loading…</p>
            )}
          </div>
        </>
      )}
    </main>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  )
}
