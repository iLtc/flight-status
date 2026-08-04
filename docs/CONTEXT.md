# Flight Status

A self-hosted dashboard that presents SFO's and SJC's public flight-status feeds
through one normalized table, so a volunteer can answer passenger questions at
either airport without switching mental models.

## Language

### Flights

**Flight**:
One row in the dashboard — one airline's branded service on one movement, on one
day, at one airport.
_Avoid_: Leg, service, record

**Movement**: The physical aircraft turn at the airport. One movement surfaces as
several Flights when carriers codeshare on it.
_Avoid_: Aircraft, turn, mvmt

**Operating flight**: The Flight flown by the carrier that actually operates the
movement. Exactly one per movement.
_Avoid_: Parent flight, real flight, primary

**Codeshare flight**: A Flight sold under a marketing carrier's own airline and
number, on a movement operated by someone else. Displayed as its own row,
annotated with its operating flight.
_Avoid_: Duplicate row, alias, shared flight

**Direction**: Whether a Flight is an `arrival` or a `departure` at the airport
being viewed.
_Avoid_: Type, kind, mode

**Far end**: The other airport on the Flight — origin for an arrival, destination
for a departure. What the Location filter filters on.
_Avoid_: Origin/destination (ambiguous once both directions share a table), city

### Times

All Flight times are gate times at the airport being viewed — when the aircraft
comes on or off blocks, not when it touches the runway.

**Scheduled time**: The published gate time. Never changes during the day.
_Avoid_: STD, STA, planned

**Best-known time**: The most current gate time — the actual once it exists,
otherwise the airline's current estimate. Absent for a Flight that has neither.
_Avoid_: Estimated (it can hold an actual), ETA, updated time

**Effective time**: Best-known time when there is one, Scheduled time otherwise.
Always defined. Decides whether a Flight is inside the Window and where it sorts.
_Avoid_: Sort time, display time

**Window**: The span of Effective time the dashboard shows — one hour back to
eight hours ahead.
_Avoid_: Range, horizon, time filter

**Next-day marker**: The `⁺¹` appended to any displayed time that falls on the
day after today. Applies per time shown, so one Flight can carry it on its
Best-known time but not its Scheduled time.
_Avoid_: Overnight flag, date badge

### Places

**Check-in aisle**: A numbered bank of check-in counters in SFO's International
Terminal. The only place aisles exist — a Flight leaving any other terminal has
no aisle, and inferring one from its counter numbers gives a wrong answer. See
[[adr/0001-checkin-aisles-are-international-terminal-only]].
_Avoid_: Counter, check-in area, desk

**Landed**: On the runway but not yet at the gate.
_Avoid_: Arrived, touched down

**Arrived**: At the gate, doors reachable. Distinct from Landed — a Flight is
Landed first and Arrived later, and only SFO reports the difference.
_Avoid_: Landed, in, on blocks
