'use client'

import { StatusPill } from '@/components/StatusPill'
import type { SortKey } from '@/lib/flight-view'
import { formatTimePT, isNextDayPT } from '@/lib/time'
import type { Direction, Flight } from '@/lib/types'

interface FlightTableProps {
  flights: Flight[]
  direction: Direction
  sort: { key: SortKey; asc: boolean }
  onSort: (key: SortKey) => void
  emptyMessage: string
}

const DASH = '—'

function Time({ iso, now }: { iso: string | undefined; now: Date }) {
  if (!iso) return <>{DASH}</>
  return (
    <>
      {formatTimePT(iso)}
      {isNextDayPT(iso, now) && <sup className="text-[0.65em] font-bold text-indigo-700">+1</sup>}
    </>
  )
}

export function FlightTable({ flights, direction, sort, onSort, emptyMessage }: FlightTableProps) {
  const now = new Date()
  const columns: Array<{ key: SortKey; label: string }> = [
    { key: 'airline', label: 'Airline' },
    { key: 'city', label: direction === 'departure' ? 'To' : 'From' },
    { key: 'flight', label: 'Flight' },
    { key: 'sched', label: 'Sched' },
    { key: 'est', label: 'Est' },
    { key: 'status', label: 'Status' },
    { key: 'terminal', label: 'Term' },
    { key: 'gate', label: 'Gate' },
    { key: 'extra', label: direction === 'departure' ? 'Check-in' : 'Baggage' },
  ]
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="bg-indigo-950 text-left text-white">
          {columns.map((c) => (
            <th key={c.key} className="whitespace-nowrap px-2.5 py-2 font-semibold">
              <button onClick={() => onSort(c.key)} className="inline-flex items-center gap-1">
                {c.label}
                <span className="text-[0.6em] opacity-80">
                  {sort.key === c.key ? (sort.asc ? '▲' : '▼') : '⇅'}
                </span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {flights.length === 0 && (
          <tr>
            <td colSpan={9} className="px-2.5 py-8 text-center text-slate-500">
              {emptyMessage}
            </td>
          </tr>
        )}
        {flights.map((f) => (
          <tr key={f.id} className="border-b border-slate-200 align-top odd:bg-white even:bg-slate-100">
            <td className="px-2.5 py-2">
              {f.airline}
              {f.operatedBy && (
                <div className="text-xs text-slate-500">
                  Operated by {f.operatedBy.airline} #{f.operatedBy.flightNumber}
                </div>
              )}
            </td>
            <td className="px-2.5 py-2">
              {f.city}
              {f.cityCode ? ` (${f.cityCode})` : ''}
            </td>
            <td className="px-2.5 py-2">{f.flightNumber}</td>
            <td className="whitespace-nowrap px-2.5 py-2"><Time iso={f.scheduled} now={now} /></td>
            <td className="whitespace-nowrap px-2.5 py-2"><Time iso={f.estimated} now={now} /></td>
            <td className="px-2.5 py-2"><StatusPill status={f.status} /></td>
            <td className="px-2.5 py-2">{f.terminal ?? DASH}</td>
            <td className="px-2.5 py-2">{f.gate ?? DASH}</td>
            <td className="px-2.5 py-2">
              {direction === 'departure' ? (
                f.checkin ?? DASH
              ) : (
                <>
                  {f.baggage ?? DASH}
                  {f.bagTimes && (
                    <div className="text-xs text-slate-500">
                      {f.bagTimes.first ? `1st bag ${formatTimePT(f.bagTimes.first)}` : ''}
                      {f.bagTimes.first && f.bagTimes.last ? ' · ' : ''}
                      {f.bagTimes.last ? `last ${formatTimePT(f.bagTimes.last)}` : ''}
                    </div>
                  )}
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
