import type { Airport } from './types'

/**
 * Per-airport accent color. Drives the airport selector, the
 * departures/arrivals selector, and the flight-table header so it's obvious
 * at a glance which airport is being viewed.
 */
export const AIRPORT_THEME: Record<Airport, string> = {
  SFO: '#009ade',
  SJC: 'rgb(237, 116, 47)',
}

export function airportColor(airport: Airport): string {
  return AIRPORT_THEME[airport]
}
