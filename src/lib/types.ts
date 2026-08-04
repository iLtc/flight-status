export type Airport = 'SFO' | 'SJC'
export type Direction = 'departure' | 'arrival'

export type StatusKind =
  | 'on-time' | 'early' | 'delayed' | 'departing' | 'last-call'
  | 'departed' | 'arrived' | 'landed' | 'cancelled' | 'diverted' | 'other'

export interface FlightStatus {
  kind: StatusKind
  /** Display label; raw upstream text when kind = 'other'. */
  text: string
  /** ISO; the time embedded in the status, where present (SJC only). */
  time?: string
}

export interface Flight {
  id: string
  airport: Airport
  direction: Direction
  /** Marketing carrier display name. */
  airline: string
  /** IATA; SFO only. Not used by search. */
  airlineCode?: string
  flightNumber: string
  /** Set on codeshare Flights only. */
  operatedBy?: { airline: string; flightNumber: string }
  /** Far end city (origin for arrivals, destination for departures). */
  city: string
  cityCode?: string
  /** ISO 8601 with PT offset — Scheduled gate time. */
  scheduled: string
  /** ISO — Best-known gate time: actual when available, else estimate. */
  estimated?: string
  status: FlightStatus
  isCodeshare: boolean
  terminal?: string
  gate?: string
  baggage?: string
  bagTimes?: { first?: string; last?: string }
  /** SFO INTL departures only, e.g. "Aisles 3–4". */
  checkin?: string
}

export interface FlightsResponse {
  airport: Airport
  cachedAt: string
  stale: boolean
  flights: Flight[]
}
