'use client'

import type { Direction, Flight } from '@/lib/types'
import type { ViewState } from '@/lib/url-state'

interface FilterBarProps {
  view: ViewState
  flights: Flight[] // current airport + direction, pre-filter (for options)
  onChange: (patch: Partial<ViewState>) => void
  onReset: () => void
}

function options(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort()
}

export function FilterBar({ view, flights, onChange, onReset }: FilterBarProps) {
  const airlines = options(flights.map((f) => f.airline))
  const terminals = options(flights.map((f) => f.terminal))
  const locations = [
    ...new Map(flights.map((f) => [f.cityCode ?? f.city, f.city])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const dirs: Array<{ value: Direction; label: string }> = [
    { value: 'departure', label: 'Departures' },
    { value: 'arrival', label: 'Arrivals' },
  ]
  const select = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm'
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
        value={view.q}
        onChange={(e) => onChange({ q: e.target.value })}
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
          checked={view.hideCodeshares}
          disabled={view.airport === 'SJC'}
          onChange={(e) => onChange({ hideCodeshares: e.target.checked })}
        />
        Exclude codeshares
      </label>
      <button onClick={onReset} className={`${select} hover:bg-slate-100`}>Reset</button>
    </div>
  )
}
