'use client'

import { formatTimePT } from '@/lib/time'
import type { Airport } from '@/lib/types'

interface HeaderProps {
  airport: Airport
  onAirportChange: (a: Airport) => void
  updatedAt: Date | null
  cachedAt: string | null
  flash: string | null
  refreshing: boolean
  onForceRefresh: () => void
}

const AIRPORTS: Airport[] = ['SFO', 'SJC']

export function Header({ airport, onAirportChange, updatedAt, cachedAt, flash, refreshing, onForceRefresh }: HeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-md border-2 border-indigo-950 text-sm font-bold">
        {AIRPORTS.map((a) => (
          <button
            key={a}
            onClick={() => onAirportChange(a)}
            className={`px-11 py-1.5 ${a === airport ? 'bg-indigo-950 text-white' : 'bg-white text-indigo-950'}`}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
        {flash && <span className="font-medium text-emerald-700">{flash}</span>}
        <span>
          Updated <b>{updatedAt ? formatTimePT(updatedAt.toISOString()) : '—'}</b>
          {' · '}Server data from <b>{cachedAt ? formatTimePT(cachedAt) : '—'}</b>
        </span>
        <button
          onClick={onForceRefresh}
          disabled={refreshing}
          className="rounded-md bg-amber-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {refreshing ? '⟳ Refreshing…' : '⟳ Force refresh'}
        </button>
      </div>
    </div>
  )
}
