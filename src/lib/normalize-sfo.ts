import { aisleLabel } from '@/lib/checkins'
import type { Flight, FlightStatus, StatusKind } from '@/lib/types'

export interface SfoFeed {
  data: unknown[]
}

interface SfoAirline {
  iata_code?: string
  airline_name?: string
  airline_display_name?: string
}

interface SfoRecord {
  flight_id: string
  flight_kind: 'Arrival' | 'Departure'
  airline: SfoAirline
  flight_number: string
  is_code_share?: boolean
  original_flight?: { airline: SfoAirline; flight_number: string } | null
  airport: {
    iata_code?: string
    airport_name?: string
    airport_city?: string
  }
  scheduled_in_off_block_time: string | null
  estimated_in_off_block_time: string | null
  actual_in_off_block_time: string | null
  first_bag_time: string | null
  last_bag_time: string | null
  remark: string | null
  terminal: { terminal_code?: string } | null
  gate: { gate_number?: string } | null
  baggage_carousel: { carousel_name?: string } | null
  checkins: Array<{ checkin: { checkin_name: string } }>
}

const REMARK_KINDS: Record<string, { kind: StatusKind; text: string }> = {
  'on time': { kind: 'on-time', text: 'On Time' },
  'delayed': { kind: 'delayed', text: 'Delayed' },
  'departing': { kind: 'departing', text: 'Departing' },
  'last call': { kind: 'last-call', text: 'Last Call' },
  'departed': { kind: 'departed', text: 'Departed' },
  'arrived': { kind: 'arrived', text: 'Arrived' },
  'landed': { kind: 'landed', text: 'Landed' },
  'cancelled': { kind: 'cancelled', text: 'Cancelled' },
  'diverted': { kind: 'diverted', text: 'Diverted' },
}

function statusFromRemark(remark: string | null): FlightStatus {
  const known = remark ? REMARK_KINDS[remark.trim().toLowerCase()] : undefined
  if (known) return { ...known }
  return { kind: 'other', text: remark ?? '—' }
}

function airlineName(a: SfoAirline | undefined): string {
  return a?.airline_display_name ?? a?.airline_name ?? '—'
}

function carouselLabel(name: string | undefined): string | undefined {
  const digits = /(\d+)\s*$/.exec(name ?? '')
  return digits ? `Carousel ${Number(digits[1])}` : undefined
}

export function normalizeSfo(feed: SfoFeed, checkins: Record<string, string>): Flight[] {
  const seen = new Set<string>()
  const out: Flight[] = []
  for (const raw of feed.data as SfoRecord[]) {
    if (!raw.scheduled_in_off_block_time) continue
    const dedupeKey = `${raw.flight_id}|${raw.flight_number}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const direction = raw.flight_kind === 'Arrival' ? 'arrival' : 'departure'
    const terminal =
      raw.terminal?.terminal_code === 'ITM' ? 'INTL' : raw.terminal?.terminal_code ?? undefined
    const estimated =
      raw.actual_in_off_block_time ?? raw.estimated_in_off_block_time ?? undefined

    const flight: Flight = {
      id: `SFO/${raw.flight_id}/${raw.flight_number}`,
      airport: 'SFO',
      direction,
      airline: airlineName(raw.airline),
      airlineCode: raw.airline.iata_code,
      flightNumber: raw.flight_number,
      city: raw.airport.airport_city ?? raw.airport.airport_name ?? '—',
      cityCode: raw.airport.iata_code,
      scheduled: raw.scheduled_in_off_block_time,
      estimated,
      status: statusFromRemark(raw.remark),
      isCodeshare: raw.is_code_share === true,
      terminal,
      gate: raw.gate?.gate_number,
    }
    if (raw.is_code_share && raw.original_flight) {
      flight.operatedBy = {
        airline: airlineName(raw.original_flight.airline),
        flightNumber: raw.original_flight.flight_number,
      }
    }
    if (direction === 'arrival') {
      flight.baggage = carouselLabel(raw.baggage_carousel?.carousel_name)
      if (raw.first_bag_time || raw.last_bag_time) {
        flight.bagTimes = {
          first: raw.first_bag_time ?? undefined,
          last: raw.last_bag_time ?? undefined,
        }
      }
    } else if (terminal === 'INTL') {
      // ADR 0001: aisles exist only in the International Terminal. T1/T2
      // counters share the 1–168 numeric range and would map to WRONG aisles.
      flight.checkin = aisleLabel(
        raw.checkins.map((c) => c.checkin.checkin_name),
        checkins,
      )
    }
    out.push(flight)
  }
  return out
}
