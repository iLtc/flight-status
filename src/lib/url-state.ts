import type { SortKey } from '@/lib/flight-view'
import type { Airport, Direction } from '@/lib/types'

export interface ViewState {
  airport: Airport
  dir: Direction
  q: string
  airline: string
  terminal: string
  location: string
  hideCodeshares: boolean
  sort: { key: SortKey; asc: boolean }
}

export const DEFAULT_VIEW: ViewState = {
  airport: 'SFO',
  dir: 'departure',
  q: '',
  airline: '',
  terminal: '',
  location: '',
  hideCodeshares: false,
  sort: { key: 'est', asc: true },
}

const SORT_KEYS: SortKey[] = [
  'airline', 'city', 'flight', 'sched', 'est', 'status', 'terminal', 'gate', 'extra',
]

export function parseView(params: URLSearchParams): ViewState {
  const airport = params.get('airport')?.toUpperCase()
  const dir = params.get('dir')
  const [sortKey, sortDir] = (params.get('sort') ?? '').split('.')
  return {
    airport: airport === 'SJC' ? 'SJC' : 'SFO',
    dir: dir === 'arrivals' ? 'arrival' : 'departure',
    q: params.get('q') ?? '',
    airline: params.get('airline') ?? '',
    terminal: params.get('terminal') ?? '',
    location: params.get('location') ?? '',
    hideCodeshares: params.get('hideCodeshares') === '1',
    sort: SORT_KEYS.includes(sortKey as SortKey)
      ? { key: sortKey as SortKey, asc: sortDir !== 'desc' }
      : { ...DEFAULT_VIEW.sort },
  }
}

export function serializeView(v: ViewState): string {
  const params = new URLSearchParams()
  if (v.airport !== DEFAULT_VIEW.airport) params.set('airport', v.airport)
  if (v.dir !== DEFAULT_VIEW.dir) params.set('dir', 'arrivals')
  if (v.q) params.set('q', v.q)
  if (v.airline) params.set('airline', v.airline)
  if (v.terminal) params.set('terminal', v.terminal)
  if (v.location) params.set('location', v.location)
  if (v.hideCodeshares) params.set('hideCodeshares', '1')
  if (v.sort.key !== DEFAULT_VIEW.sort.key || v.sort.asc !== DEFAULT_VIEW.sort.asc) {
    params.set('sort', `${v.sort.key}.${v.sort.asc ? 'asc' : 'desc'}`)
  }
  return params.toString()
}
