'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef } from 'react'
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

  // `view` only updates once the navigation carrying it commits (Next writes
  // history and recomputes `useSearchParams()` together, in the same
  // render's commit phase). Two `setView` calls issued close together —
  // e.g. a debounced search-box write racing an interim filter click, or
  // even two ordinary clicks before the first one's navigation has
  // committed — would otherwise each merge their own patch onto the SAME
  // closed-over `view`, so the second call's `router.replace` can silently
  // discard whatever the first one just set. `pendingView` is a
  // synchronously-updated "most recently intended view" that every
  // `setView` call both reads and writes, so a second call always merges
  // onto the result of the first, regardless of whether either
  // navigation's transition has committed yet.
  const pendingView = useRef(view)
  useEffect(() => {
    pendingView.current = view
  }, [view])

  const setView = (patch: Partial<ViewState>) => {
    const base = pendingView.current
    let next = { ...base, ...patch }
    // Airport switch clears the data-derived dropdowns; dir/sort/q/codeshares survive.
    if (patch.airport && patch.airport !== base.airport) {
      next = { ...next, airline: '', terminal: '', location: '' }
    }
    pendingView.current = next
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

  // Computed against pendingView.current, not the closed-over `view`: the
  // patch-merge mechanism above only keeps concurrent patches from clobbering
  // each other, it does not make patch CONTENTS fresh. Two rapid clicks
  // built from `view` would both toggle off the same stale asc/desc value
  // (the second one a no-op); building from pendingView.current means the
  // second click always toggles the result of the first.
  const onSort = (key: ViewState['sort']['key']) => {
    const current = pendingView.current
    setView({ sort: { key, asc: current.sort.key === key ? !current.sort.asc : true } })
  }

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
            onReset={() =>
              setView({ ...DEFAULT_VIEW, airport: pendingView.current.airport, dir: pendingView.current.dir })
            }
          />
          <div className="mt-3 overflow-x-auto">
            {data ? (
              <FlightTable
                flights={visible}
                airport={view.airport}
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
