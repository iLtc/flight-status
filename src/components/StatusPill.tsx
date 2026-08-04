import type { FlightStatus } from '@/lib/types'

const COLORS: Record<FlightStatus['kind'], string> = {
  'on-time': 'bg-green-700',
  'departing': 'bg-green-700',
  'early': 'bg-blue-600',
  'delayed': 'bg-amber-600',
  'last-call': 'bg-amber-600',
  'arrived': 'bg-teal-600',
  'landed': 'bg-teal-600',
  'departed': 'bg-purple-700',
  'cancelled': 'bg-red-700',
  'diverted': 'bg-red-700',
  'other': 'bg-slate-500',
}

export function StatusPill({ status }: { status: FlightStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${COLORS[status.kind]}`}>
      {status.text}
    </span>
  )
}
