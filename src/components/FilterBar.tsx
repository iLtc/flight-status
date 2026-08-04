'use client'

import { useEffect, useRef, useState } from 'react'
import type { Direction, Flight } from '@/lib/types'
import type { ViewState } from '@/lib/url-state'

interface FilterBarProps {
  view: ViewState
  flights: Flight[] // current airport + direction, pre-filter (for options)
  onChange: (patch: Partial<ViewState>) => void
  onReset: () => void
}

// The URL round-trip (router.replace → new searchParams → new view) is
// asynchronous, so a search box wired straight to `view.q` can drop or
// revert keystrokes typed faster than that commit. Debouncing the URL write
// keeps the DOM input authoritative for display while typing.
const SEARCH_DEBOUNCE_MS = 275

function options(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort()
}

/**
 * A filter value can survive a direction switch (e.g. an airline that only
 * ever departs, a terminal used one-way) even though the options derived
 * from the new direction's flights no longer include it. A controlled
 * <select value="X"> with no matching <option> renders as a blank control
 * (selectedIndex -1), not "All" — so the active value is always kept in its
 * own option list rather than auto-cleared.
 */
function withActive(values: string[], active: string): string[] {
  if (!active || values.includes(active)) return values
  return [...values, active].sort()
}

export function FilterBar({ view, flights, onChange, onReset }: FilterBarProps) {
  const airlines = withActive(options(flights.map((f) => f.airline)), view.airline)
  const terminals = withActive(options(flights.map((f) => f.terminal)), view.terminal)
  const locationPairs = new Map(flights.map((f) => [f.cityCode ?? f.city, f.city]))
  if (view.location && !locationPairs.has(view.location)) {
    // No flight in the current direction names this location anymore; fall
    // back to the raw value itself so the select still shows *something*
    // rather than going blank.
    locationPairs.set(view.location, view.location)
  }
  const locations = [...locationPairs.entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const dirs: Array<{ value: Direction; label: string }> = [
    { value: 'departure', label: 'Departures' },
    { value: 'arrival', label: 'Arrivals' },
  ]
  const select = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm'

  // Local echo of the search box so keystrokes render immediately; mirrored
  // to the URL on a debounce instead of on every keystroke. `lastSent` is
  // set the moment a write is *scheduled* (not when it lands) so it always
  // reflects "the value the URL should end up holding" — that's what makes
  // it possible to tell an external change to `view.q` (Reset, browser
  // back/forward, a pasted URL) apart from our own debounced write landing.
  // Updating it only when the timeout fires would miss the case where an
  // external reset happens to land on the same value the box started with
  // (e.g. both ''), which would otherwise leave the stale timeout armed to
  // fire later and clobber the reset.
  const [q, setQ] = useState(view.q)
  const lastSent = useRef(view.q)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (view.q !== lastSent.current) {
      // The change came from outside our own debounce (notably Reset) —
      // cancel any pending write so it can't fire later and clobber it.
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      lastSent.current = view.q
      setQ(view.q)
    }
  }, [view.q])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  function handleQueryChange(next: string) {
    setQ(next)
    lastSent.current = next
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      // `onChange` (page.tsx's `setView`) merges against a synchronously
      // maintained `pendingView` ref rather than the closed-over `view`, so
      // calling whatever closure was captured at schedule time — even one
      // several renders stale — is safe: it reads the current intended
      // state at call time, not whatever `view` looked like when this
      // timer was scheduled.
      onChange({ q: next })
    }, SEARCH_DEBOUNCE_MS)
  }

  function handleReset() {
    // Reset can land on a URL that's identical to the current one (e.g. the
    // debounced write for the current keystroke hasn't committed yet, so
    // `view.q` is still '' — same as DEFAULT_VIEW.q). When that happens
    // `router.replace` is a no-op and `view.q` never changes, so the effect
    // above — which only reacts to a `view.q` prop change — would never see
    // it and the stale timeout would survive to fire later and clobber the
    // reset. Cancelling it here, synchronously, doesn't depend on the URL
    // actually changing.
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    lastSent.current = ''
    setQ('')
    onReset()
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5">
      <div className="inline-flex overflow-hidden rounded-md border-2 border-indigo-950 text-sm font-bold">
        {dirs.map((d) => (
          <button
            key={d.value}
            onClick={() => onChange({ dir: d.value })}
            className={`px-4 py-1.5 ${view.dir === d.value ? 'bg-indigo-950 text-white' : 'bg-white text-indigo-950'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Flight #, airline, or city…"
        className={`${select} min-w-44 flex-1`}
      />
      <select value={view.airline} onChange={(e) => onChange({ airline: e.target.value })} className={select}>
        <option value="">Airline: All</option>
        {airlines.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={view.terminal} onChange={(e) => onChange({ terminal: e.target.value })} className={select}>
        <option value="">Terminal: All</option>
        {terminals.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={view.location} onChange={(e) => onChange({ location: e.target.value })} className={select}>
        <option value="">Location: All</option>
        {locations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className={`flex items-center gap-1.5 text-sm ${view.airport === 'SJC' ? 'text-slate-400' : 'text-slate-700'}`}>
        <input
          type="checkbox"
          checked={view.hideCodeshares && view.airport !== 'SJC'}
          disabled={view.airport === 'SJC'}
          onChange={(e) => onChange({ hideCodeshares: e.target.checked })}
        />
        Exclude codeshares
      </label>
      <button onClick={handleReset} className={`${select} hover:bg-slate-100`}>Reset</button>
    </div>
  )
}
