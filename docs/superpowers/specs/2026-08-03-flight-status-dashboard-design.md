# Unified SFO + SJC Flight Status Dashboard — Design

**Date:** 2026-08-03
**Status:** Approved design, pending implementation plan

## Purpose

The author volunteers at both SFO and SJC, answering passenger questions using each
airport's public flight-status site. The two sites differ in UI and features. This
project merges both into one self-hosted web app with a consistent UI and feature
set: one normalized table, the same filters everywhere, and predictable refresh
behavior.

Success criteria:

- Either airport's flights visible in the same table layout with the same filters.
- A passenger question ("where does EK 6489 land?", "which aisle for Turkish 290?")
  answerable via one search box regardless of airport.
- Reloading the page never loses the current view (URL holds all state).
- Clear distinction between "when my browser last fetched" and "when the server
  last pulled from the airport".

## Architecture

One Next.js app (App Router, TypeScript, Tailwind CSS). The backend is a single
Route Handler (`GET /api/flights`); the frontend is a single page (`/`). Deployed
as one Docker container. No database, no external cache — flight data is ephemeral
(5-minute TTL), so an in-memory cache is sufficient; a container restart merely
costs one extra upstream fetch.

Alternatives considered and rejected:

- Separate API service + frontend (two containers): more moving parts for a
  single-user tool, no benefit.
- Redis-backed cache: persistence is worthless for 5-minute-TTL data at this scale.

## Data sources

| Source | URL | Shape |
|---|---|---|
| SFO flights | `https://www.flysfo.com/flysfo/api/flight-status` | `{ data: FlightRecord[], last_update }` — full day, arrivals + departures mixed (`flight_kind`), ~2,600 records incl. rich detail: scheduled/estimated/actual in-off-block times, terminal (`T1/T2/T3/ITM/null`), gate (`E11`), baggage carousel, first/last bag times, check-in counters, codeshare list, remarks |
| SFO check-in aisles | `https://www.flysfo.com/flysfo/api/checkins` | `{ "<counterNumber>": "Aisle N", ... }` |
| SJC arrivals | `https://www.flysanjose.com/api/flightstatus/arrivals` | flat array: `date` ("Aug 03"), `time` ("4:05 PM"), `airline`, `flight_number`, `origin`+`origin_code`, `terminal` (A/B), `gate`, `baggage`, `status` |
| SJC departures | `https://www.flysanjose.com/api/flightstatus/departures` | same minus `baggage`, with `destination`+`destination_code` |

Sample responses live in the repo root (`sfo-flight-status.json`, `sfo-checkins.json`,
`sjc-arrivals.json`, `sjc-departures.json`) and double as test fixtures.

Notes:

- SJC's feed is already limited to −1h/+8h; SFO's covers whole days and must be
  windowed by us.
- SFO's `last_update` arrives locale-mangled ("八月 03 at 04:42 下午") — ignored;
  we timestamp fetches ourselves.

## Backend

### Endpoint

`GET /api/flights?airport=sfo|sjc[&forceRefresh=1]`

Response:

```json
{
  "airport": "SFO",
  "cachedAt": "2026-08-03T17:00:12-07:00",
  "stale": false,
  "flights": [ Flight, ... ]
}
```

Both directions are included; direction filtering, search, filters, and sorting are
all client-side (the windowed payload is a few hundred rows).

### Caching

In-memory map, one entry per airport: `{ normalizedFullFeed, fetchedAt }`.

- Normal request: cache younger than **5 minutes** → serve cached; else fetch
  upstream, normalize, store, serve.
- `forceRefresh=1`: same, but acceptable age is **1 minute**.
- SFO fetch = flight-status + checkins in parallel; SJC fetch = arrivals +
  departures in parallel.
- The cache stores the **full normalized feed**; the −1h/+8h window is applied
  per-request so the window slides correctly between refreshes.
- `cachedAt` is the server's fetch time and feeds the UI's "Server data from".

### Time window

Keep flights whose **effective time** (estimated if present, else scheduled) falls
in `[now − 1h, now + 8h]`. Estimated-based windowing keeps delayed flights visible
past their scheduled slot. Rows with no parseable time are dropped from output.

### Normalized flight model

```ts
type Flight = {
  id: string                       // stable per row, e.g. "SFO/D/UA540/2026-08-03" (+ codeshare suffix)
  airport: 'SFO' | 'SJC'
  direction: 'departure' | 'arrival'
  airline: string                  // marketing carrier on codeshare rows
  airlineCode?: string             // IATA; SFO only
  flightNumber: string
  operatedBy?: { airline: string; flightNumber: string }   // codeshare rows only
  city: string                     // far-end city (origin for arrivals, destination for departures)
  cityCode?: string                // IATA airport code
  scheduled: string                // ISO 8601 with PT offset
  estimated?: string               // ISO; best-known updated time: actual when available,
                                   // else estimate; SJC: parsed from status text
  status: {
    kind: 'on-time' | 'early' | 'delayed' | 'departing' | 'last-call' | 'departed'
        | 'arrived' | 'landed' | 'cancelled' | 'diverted' | 'other'
    text: string                   // display label; raw upstream text when kind = 'other'
    time?: string                  // ISO; the time shown beside the status where present
  }
  terminal?: string                // SFO: T1/T2/T3/INTL (ITM → INTL); SJC: A/B
  gate?: string
  baggage?: string                 // arrivals: SJC "B3"; SFO carousel display label
  bagTimes?: { first?: string; last?: string }             // SFO arrivals
  checkin?: string                 // SFO departures: deduped aisle labels, "Aisles 3–4"
}
```

Normalization rules:

- **Codeshares (SFO):** each `code_shares[]` entry expands into its own row
  (matching the SFO site), carrying the marketing airline/number plus
  `operatedBy` = the operating flight. Operating rows have no `operatedBy`.
- **Status:** SFO remarks (`On Time`/`On time`, `Delayed`, `Departing`,
  `Last call`, `Departed`, `Arrived`, `Landed`, `Cancelled`, `Diverted`) and SJC
  status strings (`On Time`, `Delayed 4:44 PM`, `Early 4:53 PM`,
  `Arrived 4:01 PM`, `Departed 4:27 PM`) map to the shared enum; SJC's embedded
  time is parsed into `status.time` and `estimated`. Unrecognized strings become
  `kind: 'other'` with the raw text — never a crash.
- **Times:** all parsing is `America/Los_Angeles`-aware regardless of server TZ.
  SJC's `"Aug 03" + "4:05 PM"` gets the year inferred from request time with a
  Dec 31 → Jan 1 boundary guard.
- **Check-in aisles (SFO departures):** each flight's counter names map through
  the checkins dictionary; the resulting aisle set is deduped and collapsed
  ("Aisle 3", "Aisles 3–4"). Counters missing from the dictionary (e.g.
  CURBSIDE) are skipped; no mapped counters → no `checkin` value.
- **Baggage (SFO arrivals):** display label derived from `carousel_name`
  (e.g. `CL-F5` → "Carousel 5", matching the SFO site's rendering).

## Frontend

### URL state (source of truth)

`?airport=SJC&dir=arrivals&q=1260&airline=Delta&terminal=A&location=SLC&hideCodeshares=1&sort=est.desc`

- Every control writes via `router.replace`; reload/bookmark/share reproduces the
  exact view.
- Defaults omitted from the URL: `airport=SFO`, `dir=departures`, `sort=sched.asc`,
  everything else empty.

### Layout (validated via mockups, saved under `.superpowers/brainstorm/`)

- **Header row 1:** wide SFO / SJC segmented tabs (default control height); right
  side, one line: `Updated 5:04 PM · Server data from 5:00 PM` + orange
  **⟳ Force refresh** button.
- **Header row 2:** Departures/Arrivals toggle · search box (`Flight #, airline,
  or city…`) · Airline dropdown · Terminal dropdown · Location dropdown ·
  "Exclude codeshares" checkbox · Reset.
- **Table** (approved "Option B", detailed):
  - Departures: Airline · To · Flight · Sched · Est · Status · Term · Gate · Check-in
  - Arrivals: Airline · From · Flight · Sched · Est · Status · Term · Gate · Baggage
    (baggage cell includes 1st/last bag sub-line when SFO provides it)
  - Codeshare rows show "Operated by X #N" under the airline name.
  - Missing data renders as "—" (e.g. SJC check-in).
  - Every column header sorts on click, second click reverses; default sort is
    Sched ascending. Sort state lives in the URL.
  - Status pills: green on-time/departing, blue early, orange delayed/last-call,
    teal arrived/landed, purple departed, red cancelled/diverted, gray other.

### Filters

- **Search** matches flight number, airline name, and city, case-insensitive.
  Codeshare rows are independent rows, so marketing numbers are findable.
- **Airline / Terminal / Location** dropdowns are populated from the currently
  loaded airport + direction's data (never offer zero-result values). Location =
  far-end city.
- Filter/direction/sort changes are pure client-side — instant, no refetch.

### Refresh behavior

- Auto-refetch every 5 minutes and on airport switch; any manual refresh resets
  the timer.
- **Updated** = the browser's last successful fetch (moves on every fetch, even
  cache hits). **Server data from** = `cachedAt` from the response. Two refreshes
  within 5 minutes move the former but not the latter, by design.
- **Force refresh** button → `forceRefresh=1` + spinner on the button.

## Error handling

- Upstream failure with any cache present: serve stale (`stale: true`); UI shows
  amber banner "Couldn't reach {airport} — showing data from {time}".
- Upstream failure with no cache (fresh container): API returns 502; UI shows an
  error state with Retry.
- Client fetch failure: keep last data, banner notes the failed refresh, next
  5-minute tick retries.
- Defensive normalizers: unknown status → gray raw-text pill; unparseable times →
  row dropped from window; missing optional fields → "—".

## Testing (Vitest)

- Normalizer units, fixtures = the real sample JSONs:
  - SFO record → Flight: codeshare expansion, aisle mapping/collapsing, carousel
    label, ITM → INTL, status mapping.
  - SJC record → Flight: status-text parsing (kind + time), PT date parsing incl.
    past-midnight and year boundary.
  - Window filtering on effective time.
- Cache: 5-min TTL, 1-min forced TTL, stale-on-failure — mocked fetch + fake
  timers.
- One end-to-end API route test against fixtures.

## Deployment

- `next.config`: `output: 'standalone'`.
- Multi-stage Dockerfile on `node:24-alpine`; final image contains only the
  standalone server; port 3000.
- GitHub Actions on push to `main`: typecheck + tests, then build and push
  **`ghcr.io/iltc/flight-status`** (username lowercased — GHCR rejects the
  uppercase `L` in `iLtc`) tagged `latest` + commit SHA, via the built-in
  `GITHUB_TOKEN`. Multi-arch: linux/amd64 + linux/arm64.
- Run on the server with `docker pull` + `docker run -p 3000:3000`.

## Out of scope

- Authentication (deployed on a private server).
- A combined both-airports view (explicitly decided: one airport at a time).
- Persisting cache across restarts.
- Mobile-first layout work beyond the table degrading gracefully.

## Decision log

| Decision | Choice |
|---|---|
| Codeshares | SFO-style duplicate rows + "Operated by" note + exclude toggle |
| Location filter | Far-end city (origin/destination), both airports |
| Airport selector | One airport at a time (no "Both" view) |
| Table layout | Detailed: separate Sched + Est columns, bag-time sub-lines |
| Header | Two rows; wide default-height airport tabs; update info + force refresh on one line |
| Sorting | All columns clickable; default Sched ascending; in URL |
| Architecture | Single Next.js app, in-memory cache |
| Base image / registry | node:24-alpine / ghcr.io/iltc/flight-status |
