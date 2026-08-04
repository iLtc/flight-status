# Unified SFO + SJC Flight Status Dashboard — Design

**Date:** 2026-08-03
**Status:** Approved design, pending implementation plan
**Revised:** 2026-08-03, after grilling the design against the sample payloads in
`docs/samples/` and the screenshots in `docs/screenshots/`. Four rules in the
original draft were contradicted by the real data; see the Decision log and
`docs/adr/`.

Companion documents:

- `docs/CONTEXT.md` — the domain glossary. Terms capitalised here (Flight, Movement,
  Effective time, Window, Check-in aisle…) are defined there.
- `docs/adr/0001-checkin-aisles-are-international-terminal-only.md`
- `docs/adr/0002-sfo-feed-is-already-codeshare-expanded.md`
- `docs/adr/0003-where-we-diverge-from-the-airports-boards.md`

## Purpose

The author volunteers at both SFO and SJC, answering passenger questions using each
airport's public flight-status site. The two sites differ in UI and features. This
project merges both into one self-hosted web app with a consistent UI: one
normalized table, the same filters everywhere, and predictable refresh behavior.

Success criteria:

- Either airport's flights visible in the same table layout with the same filters.
- A passenger question is answerable by typing the flight number into one search
  box and scanning the result, regardless of airport.
- Reloading the page never loses the current view (URL holds all state).
- Clear distinction between "when my browser last fetched" and "when the server
  last pulled from the airport".

What is *not* promised: a unified status vocabulary. Each airport publishes a
different set of statuses and we render what each one says — see
[Status](#status). The unified things are layout, filters, sorting, search and
URL behavior.

## Architecture

One Next.js app (App Router, TypeScript, Tailwind CSS). The backend is a single
Route Handler (`GET /api/flights`) plus a trivial `GET /api/health`; the frontend
is a single page (`/`). Deployed as one Docker container. No database, no external
cache — flight data is ephemeral (5-minute TTL), so an in-memory cache is
sufficient; a container restart merely costs one extra upstream fetch.

Alternatives considered and rejected:

- Separate API service + frontend (two containers): more moving parts for a
  single-user tool, no benefit.
- Redis-backed cache: persistence is worthless for 5-minute-TTL data at this scale.

## Data sources

| Source | URL | Shape |
|---|---|---|
| SFO flights | `https://www.flysfo.com/flysfo/api/flight-status` | `{ data: FlightRecord[], last_update }` — arrivals + departures mixed (`flight_kind`). **14.3 MB / 2,650 records covering 751 Movements**, already expanded one record per marketing flight number. Rich detail: scheduled/estimated/actual in-off-block and aod times, terminal (`T1/T2/T3/ITM/null`), gate (`E11`), baggage carousel, first/last bag times, check-in counters, remarks |
| SFO check-in aisles | `https://www.flysfo.com/flysfo/api/checkins` | `{ "<counterNumber>": "Aisle N", ... }` — exactly 168 counters → 12 aisles, 14 each, contiguous. **International Terminal only** |
| SJC arrivals | `https://www.flysanjose.com/api/flightstatus/arrivals` | flat array: `date` ("Aug 03"), `time` ("4:05 PM"), `airline`, `flight_number`, `origin`+`origin_code`, `terminal` (A/B), `gate`, `baggage`, `status` |
| SJC departures | `https://www.flysanjose.com/api/flightstatus/departures` | same minus `baggage`, with `destination`+`destination_code` |

Sample responses live in `docs/samples/` and are the source for both the curated
test fixture and the contract test. Screenshots of the two airports' current UIs
live in `docs/screenshots/` and are the reference for what each site actually
renders.

Notes:

- **Neither feed is a full day.** SJC states its own bounds on-page ("flights 8
  hours ahead and 1 hour back, in PT"). SFO is also already rolling — the sample,
  captured at 16:42, spans 12:43 the same day to 01:40 the next, roughly −4h/+9h.
  Our Window is narrower than both, so we always trim rather than pad.
- SFO's `last_update` arrives locale-mangled ("八月 03 at 04:42 下午") — ignored;
  we timestamp fetches ourselves.
- The SFO payload is large because `original_flight` embeds the entire operating
  record inside each of the 1,899 codeshare rows. Nothing to do about it upstream;
  it is the reason for the fetch timeout and the health endpoint below.

## Backend

### Endpoints

`GET /api/flights?airport=sfo|sjc[&forceRefresh=1]`

```json
{
  "airport": "SFO",
  "cachedAt": "2026-08-03T17:00:12-07:00",
  "stale": false,
  "flights": [ Flight, ... ]
}
```

Responses carry an `ETag` derived from `airport` + `cachedAt` and honour
`If-None-Match`, so the client's 60-second poll is a bodiless `304` whenever the
server cache has not turned over.

Both directions are included; direction filtering, search, filters, and sorting
are all client-side. The windowed SFO payload is ~2,040 rows (~500 KB raw, well
under 100 KB gzipped).

`GET /api/health` returns `200 {"ok":true}` and touches nothing upstream. The
Docker healthcheck and any uptime monitor point here — a healthcheck against
`/api/flights` would pull 14.3 MB from flysfo on every probe.

### Caching

In-memory map, one entry per airport: `{ normalizedFullFeed, fetchedAt, inFlight }`.

- Normal request: cache younger than **5 minutes** → serve cached; else fetch
  upstream, normalize, store, serve.
- `forceRefresh=1`: same, but acceptable age is **1 minute** — a floor that
  protects the airports from a stuck key. When it results in a no-op the response
  is unchanged, and the UI says so rather than staying silent.
- SFO fetch = flight-status + checkins in parallel; SJC fetch = arrivals +
  departures in parallel.
- Every upstream fetch carries `AbortSignal.timeout(10_000)`. A timeout counts as
  a failure and takes the serve-stale path. Without this a stalled upstream body
  hangs the route handler forever and the serve-stale path never fires.
- Concurrent misses are single-flighted: the in-flight promise lives in the cache
  slot, so a cold start under two simultaneous requests pulls 14.3 MB once.
- The cache stores the **full normalized feed**; the Window is applied per-request
  so it slides correctly between refreshes.
- `cachedAt` is the server's fetch time and feeds the UI's "Server data from".

### Window

Keep Flights whose **Effective time** (Best-known if present, else Scheduled)
falls in `[now − 1h, now + 8h]`. Estimate-based windowing keeps delayed flights
visible past their scheduled slot. Rows with no parseable time are dropped.

### Normalized flight model

```ts
type Flight = {
  id: string                       // SFO: `SFO/${flight_id}/${flight_number}`
                                   // SJC: `SJC/${dir}/${airline}/${flightNumber}/${date}`
  airport: 'SFO' | 'SJC'
  direction: 'departure' | 'arrival'
  airline: string                  // marketing carrier; display name
  airlineCode?: string             // IATA; SFO only. Not used by search
  flightNumber: string
  operatedBy?: { airline: string; flightNumber: string }   // codeshare Flights only
  city: string                     // Far end
  cityCode?: string                // IATA airport code
  scheduled: string                // ISO 8601 with PT offset — Scheduled time
  estimated?: string               // ISO — Best-known time: actual when available,
                                   // else estimate; SJC: parsed from status text
  status: {
    kind: 'on-time' | 'early' | 'delayed' | 'departing' | 'last-call' | 'departed'
        | 'arrived' | 'landed' | 'cancelled' | 'diverted' | 'other'
    text: string                   // display label; raw upstream text when kind = 'other'
    time?: string                  // ISO; the time embedded in the status, where present
  }
  isCodeshare: boolean             // SFO `is_code_share`; always false at SJC
  terminal?: string                // SFO: T1/T2/T3/INTL (ITM → INTL); SJC: A/B
  gate?: string
  baggage?: string                 // arrivals: SJC "B3"; SFO carousel display label
  bagTimes?: { first?: string; last?: string }             // SFO arrivals
  checkin?: string                 // SFO INTL departures only, e.g. "Aisles 3–4"
}
```

`Effective time` is derived, not stored: `estimated ?? scheduled`.

### Normalization rules

**Codeshares (SFO) — one feed record to one Flight.** The feed is already
expanded: 2,650 records for 751 Movements, one per marketing flight number, with
`airline` already holding the *marketing* carrier. `is_code_share` marks the 1,899
codeshare records and `original_flight` embeds the operating record, giving
`operatedBy` directly. **`code_shares[]` is ignored entirely** — expanding it
yields 12,104 rows. See ADR 0002.

**Identity and dedupe.** `flight_id` is the *operating* flight's identity and is
shared across a Movement's siblings (613 collisions in the sample), so it cannot
be the id alone. `flight_id` + `flight_number` is the key; the 24 exact duplicate
pairs remaining in the feed are dropped, keeping first occurrence. flysfo renders
those twice (Air New Zealand 9056 appears back-to-back on its own board); we do
not. SJC has no codeshare concept at all — `isCodeshare` is always false.

**Times.** All times are **gate** times: `*_in_off_block_time`, never
`*_aod_time` (which is runway — touchdown or wheels-up). Scheduled and estimated
are identical across the two axes in the sample; only the actuals differ, and the
gate one is what a passenger needs. Best-known time is
`actual_in_off_block_time ?? estimated_in_off_block_time`; the actual wins even
though flysfo shows the estimate (ADR 0003). 32 rows have neither — Est renders
`—` and Effective time falls back to Scheduled. All parsing is
`America/Los_Angeles`-aware regardless of server TZ. SJC's `"Aug 03" + "4:05 PM"`
gets the year inferred from request time with a Dec 31 → Jan 1 boundary guard.

**Status.** SFO remarks (`On Time`/`On time` — both casings occur — `Delayed`,
`Departing`, `Last call`, `Departed`, `Arrived`, `Landed`, `Cancelled`,
`Diverted`) and SJC status strings (`On Time`, `Delayed 4:44 PM`, `Early 4:53 PM`,
`Arrived 4:01 PM`, `Departed 4:27 PM`) map to the shared enum. SJC's embedded time
is parsed into `status.time` and `estimated`. Unrecognized strings become
`kind: 'other'` with the raw text — never a crash.

`Landed` and `Arrived` are genuinely different states, not synonyms: in the
sample all 26 Landed rows have an `actual_aod_time` and **no**
`actual_in_off_block_time`, while all 354 Arrived rows have both. A Landed flight
is on the runway with its gate time still an estimate, which the Best-known rule
handles correctly without special-casing.

Four kinds are SFO-only (`departing`, `last-call`, `landed`, `diverted`) and
`early` is SJC-only — SFO never emits it. We do **not** derive `early` at SFO from
the times; status stays source-faithful. SJC occasionally labels a Flight
`Delayed` with a time earlier than its scheduled time (2 of 126 rows); we render
that as-is rather than second-guess the source.

**Check-in aisles (SFO departures) — International Terminal only.** The checkins
dictionary maps the International Terminal's counters, and only those. T1 and T2
flights carry their own counter numbers in the same 1–168 range, so they map
cleanly and produce a *wrong* aisle: United 540 from T2 resolves to "Aisles 3–4"
while flysfo correctly shows "T2". Produce `checkin` only when
`terminal === 'INTL'`; leave it unset everywhere else, rendered `—`. Within INTL,
map counters through the dictionary, dedupe, and collapse contiguous runs
(`{3} → "Aisle 3"`, `{3,4} → "Aisles 3–4"`, `{1,2,3} → "Aisles 1–3"`,
`{1,3} → "Aisles 1, 3"`). Counters missing from the dictionary (CURBSIDE, SELF
SERVICE BAG DROP, CHECK-IN POSITION) are skipped. See ADR 0001.

**Baggage (SFO arrivals).** `carousel_name` arrives in three formats — `CL-F5`,
`CL10`, and bare `1` — and flysfo renders all of them as "Carousel N". Take the
**trailing run of digits**. This discards the boarding-area letter, so `CL-F5`
(T3), `CL-B5` (T1) and `CL5` (INTL) all read "Carousel 5"; flysfo does the same
and the Terminal column disambiguates. 30 arrivals have no carousel → `—`.

**Field fallbacks.** These are not hypothetical; each occurs in the sample:

| Field | Missing on | Fallback |
|---|---|---|
| `airline.airline_display_name` | 249 rows (all codeshares) | `airline.airline_name` |
| `airport.airport_city` | 24 rows | `airport.airport_name` |
| `terminal` | 16 rows | `—` |
| `gate` | 133 rows | `—` |

Always prefer `airline_display_name` over `airline_name`: they diverge on all 80
carriers, and not cosmetically — `airline_name: "Alaska"` maps to
`airline_display_name: "Hawaiian Airlines"` on post-merger rows.

**Far end.** Use the `airport` object, not `routes[]`. For multi-leg flights
(189 with one stop, 25 with two) `airport` already holds the immediate previous
or next stop, which is what flysfo shows — UA 1482 routed DEN→SEA→SFO displays
"Seattle".

**Airline names are not canonicalised across airports.** SFO says "Alaska
Airlines", SJC says "Alaska"; every other shared carrier matches verbatim. Since
dropdown filters do not survive an airport switch (below), this never surfaces.

## Frontend

### URL state (source of truth)

`?airport=SJC&dir=arrivals&q=1260&airline=Delta&terminal=A&location=SLC&hideCodeshares=1&sort=sched.asc`

- Every control writes via `router.replace`; reload/bookmark/share reproduces the
  exact view.
- Defaults omitted from the URL: `airport=SFO`, `dir=departures`, `sort=est.asc`,
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
  - Missing data renders as `—`. The Check-in column is always `—` at SJC and for
    all non-INTL SFO departures; it stays in place so the layout is identical
    across airports.
  - Times that fall on the day after today carry a **Next-day marker** (`12:12 AM⁺¹`),
    applied per cell — a Flight scheduled 10:33 PM and estimated 12:12 AM marks
    only its Est. 29 rows in the sample straddle midnight this way.
  - Every column header sorts on click, second click reverses. **Default sort is
    `Est` ascending, ordering by Effective time** so rows with no Est fall into
    place by their Scheduled time rather than clumping as nulls. Sort state lives
    in the URL.
  - Status pills show the **kind only** (`Delayed`), never the embedded time —
    the Est column carries that, and it keeps SFO and SJC pills identical.
  - Pill colors: green on-time/departing, blue early, orange delayed/last-call,
    teal arrived/landed, purple departed, red cancelled/diverted, gray other.

### Filters

- **Search** is one query string: substring match on airline name and Far end
  city, **prefix** match on flight number. Prefix rather than substring keeps the
  scan short (`126` → 1 row rather than 5). No tokenizing and no airline-code
  matching — the workflow is "type the number, scan the result". Codeshare
  Flights are independent rows, so marketing numbers are findable.
- **Airline / Terminal / Location** dropdowns are populated from the currently
  loaded airport + direction's data. Each dropdown offers only values present in
  that data; combinations of two filters may still yield no rows. Cascading
  facets were considered and deferred as a later refinement.
- **Airport switch** clears the three dropdown filters and repopulates them from
  the new airport's data. `dir`, `sort`, `q` and `hideCodeshares` survive.
- **Exclude codeshares** is disabled and greyed out on SJC, which has no
  codeshare data.
- Filter/direction/sort changes are pure client-side — instant, no refetch.

### Refresh behavior

- Auto-refetch every **60 seconds** and on airport switch; any manual refresh
  resets the timer. Polling pauses while `document.visibilityState === 'hidden'`
  and fires once on re-show, so a forgotten tab does not pull from the airports
  indefinitely.
- The 60-second poll against a 5-minute server TTL caps displayed staleness at
  ~6 minutes. A 5-minute poll against the same TTL would allow ~10. Most polls
  return `304`.
- **Updated** = the browser's last successful fetch (moves on every fetch, even
  cache hits). **Server data from** = `cachedAt` from the response. Several
  refreshes within 5 minutes move the former but not the latter, by design.
- **Force refresh** button → `forceRefresh=1` + spinner. If the returned
  `cachedAt` is unchanged, flash **"Already up to date"** beside the button so the
  no-op is visible rather than looking broken.

## Error handling

- Upstream failure or timeout with any cache present: serve stale (`stale: true`);
  UI shows amber banner "Couldn't reach {airport} — showing data from {time}".
- Upstream failure with no cache (fresh container): API returns 502; UI shows an
  error state with Retry.
- Client fetch failure: keep last data, banner notes the failed refresh, next
  60-second tick retries.
- When `stale` is true and the Window has emptied the table, the empty state says
  so explicitly — otherwise "empty because the airport is unreachable" is
  indistinguishable from "empty because you filtered everything out".
- Defensive normalizers: unknown status → gray raw-text pill; unparseable times →
  row dropped from Window; missing optional fields → `—`.

## Testing (Vitest)

**Curated fixture** — ~20 records lifted verbatim from the real payloads, one per
rule that this design turns on:

| Case | Record |
|---|---|
| Codeshare group: 1 operating + 5 marketing | `UA/2017/A` |
| Wrong-aisle trap: T2, counters 33–40, must **not** map | `UA/540/D` |
| Aisle mapping that must work: INTL, counters 64–70 → Aisle 5 | `TK/290/D` |
| Exact duplicate pair → deduped | `UA/540/D` + `9056` (×2) |
| Landed: `actual_aod` set, `actual_in_off_block` null | `OZ/212/A` |
| Cancelled: no estimate, no actual, Est renders `—` | `B6/215/A` |
| Missing `airport_city` → `airport_name` | `UA/5599/A` (Carlsbad) |
| Missing `airline_display_name` → `airline_name` | `AD/7016` (Azul) |
| Multi-leg `n_stop=1` DEN→SEA→SFO shows Seattle | `UA/1482/A` |
| Next-day marker: Sched Aug 3, Best-known Aug 4 | `DL/667/A` |
| Window-vs-sort: sched 1:10 PM, est 7:52 PM | `DL/691/D` |
| `ITM → INTL`, and `terminal: null` | one of each |
| Carousel formats `CL-F5`, `CL10`, bare `1` | one of each |
| SJC status parsing incl. `Delayed` earlier than scheduled | `DL 3822`, `DL 1260` |

**Contract test** — loads the full 14.3 MB payload once and asserts invariants,
not values. These are the assumptions normalization rests on:

- every `remark` is in the known set of ten
- `is_code_share` is present iff `original_flight` is present
- the checkins dictionary is exactly 168 counters → 12 contiguous aisles of 14
- no record is missing `scheduled_in_off_block_time`
- `scheduled_aod_time` equals `scheduled_in_off_block_time` everywhere, and the
  same for the estimated pair — the whole "gate vs runway only matters for
  actuals" simplification depends on it

**Cache** — 5-min TTL, 1-min forced TTL, stale-on-failure, fetch timeout,
single-flight on concurrent miss — mocked fetch + fake timers.

**One end-to-end API route test** against fixtures.

All time-dependent tests pin `now` to **`2026-08-03T16:42:00-07:00`**, the instant
the samples were captured. Without it, Window and sort tests pass today and fail
tomorrow.

## Deployment

- `next.config`: `output: 'standalone'`.
- Multi-stage Dockerfile on `node:24-alpine` with `apk add --no-cache tzdata` in
  the runtime stage; final image contains only the standalone server; port 3000.
- `HEALTHCHECK` hits `/api/health`, never `/api/flights`.
- GitHub Actions on push to `main`: typecheck + tests, then build and push
  **`ghcr.io/iltc/flight-status`** (username lowercased — GHCR rejects the
  uppercase `L` in `iLtc`) tagged `latest` + commit SHA, via the built-in
  `GITHUB_TOKEN` with explicit `permissions: { contents: read, packages: write }`.
- Multi-arch linux/amd64 + linux/arm64, built on **native runners**
  (`ubuntu-latest` and `ubuntu-24.04-arm`), each pushing a digest, with a final
  job merging them into one manifest. QEMU emulation is avoided — it turns a
  two-minute Next.js build into a twenty-minute one.
- CI asserts the built image formats `America/Los_Angeles` correctly (a known
  instant such as `2026-08-03T23:42:00Z` must render `4:42 PM`). Every time in
  this app is derived server-side; if the container's timezone handling breaks,
  the board is silently wrong by seven hours rather than visibly broken.
- Run on the server with `docker pull` + `docker run -p 3000:3000
  --restart unless-stopped`.

## Out of scope

- Authentication (deployed on a private server).
- A combined both-airports view (explicitly decided: one airport at a time).
- Persisting cache across restarts.
- Mobile-first layout work beyond the table degrading gracefully.
- Cascading filter dropdowns.
- Deriving `early` status at SFO.
- Airline-code search and cross-airport airline-name canonicalisation.

## Decision log

| Decision | Choice |
|---|---|
| Codeshares | Feed is pre-expanded — 1 record → 1 Flight; `code_shares[]` ignored; `operatedBy` from `original_flight`; exclude toggle greyed out at SJC (ADR 0002) |
| Flight identity | `flight_id` + `flight_number`; 24 exact duplicate pairs deduped |
| Which clock | Gate times (`in_off_block`) throughout, never runway (`aod`) |
| Best-known time | Actual overrides estimate, diverging from flysfo (ADR 0003) |
| Time window | −1h/+8h on Effective time, applied server-side per request |
| Sorting | Default `Est` ascending, ordering by Effective time; all columns clickable; in URL (ADR 0003) |
| Midnight rollover | Per-cell `⁺¹` marker; no Date column, no divider row |
| Status | Source-faithful; no derived `early`; pills show kind only |
| Check-in aisles | International Terminal only; `—` elsewhere (ADR 0001) |
| Baggage carousel | Trailing digits of `carousel_name`; boarding-area letter dropped |
| Search | Single query; prefix on flight number, substring on airline and city; no codes |
| Filters | Fixed dropdowns; cleared on airport switch; cascading deferred |
| Refresh | 60-second client poll, 5-minute server TTL, ETag/304, pause when hidden |
| Fetch timeout | 10 s, counts as failure and takes the serve-stale path |
| Location filter | Far end (origin/destination), both airports |
| Airport selector | One airport at a time (no "Both" view) |
| Table layout | Detailed: separate Sched + Est columns, bag-time sub-lines |
| Header | Two rows; wide default-height airport tabs; update info + force refresh on one line |
| Architecture | Single Next.js app, in-memory cache, `/api/health` for probes |
| Testing | Curated ~20-record fixture + one contract test over the full payload |
| Base image / registry | node:24-alpine / ghcr.io/iltc/flight-status |
| Multi-arch | amd64 + arm64 on native runners, manifest merged; no QEMU |
