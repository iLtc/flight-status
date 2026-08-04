# Unified SFO + SJC Flight Status Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One self-hosted Next.js app that serves SFO's and SJC's public flight-status feeds through a single normalized, filterable, URL-addressable table.

**Architecture:** Single Next.js app (App Router). `GET /api/flights` fetches + normalizes both airports' feeds behind an in-memory 5-minute cache (1-minute floor on force-refresh) and applies the −1h/+8h Window per request. The page at `/` is a client component whose entire view state lives in the URL query. One Docker container; GitHub Actions builds multi-arch images to GHCR.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · date-fns-tz · Vitest · Docker (node:24-alpine) · GitHub Actions → ghcr.io

**Authoritative documents** (read before implementing a task; they win over this plan on conflict):
- Spec: `docs/superpowers/specs/2026-08-03-flight-status-dashboard-design.md`
- Glossary: `docs/CONTEXT.md` (capitalised terms — Flight, Movement, Window, Effective time — are defined there)
- ADRs: `docs/adr/0001…0003` (aisles are INTL-only; feed is codeshare-pre-expanded; deliberate divergences from the airports' boards)
- Sample payloads (test-fixture source): `docs/samples/`
- UI reference screenshots: `docs/screenshots/`

## Global Constraints

- Base image `node:24-alpine`; registry `ghcr.io/iltc/flight-status` (username **lowercased** — GHCR rejects the uppercase `L` in `iLtc`).
- All times are PT: parsing and formatting use `America/Los_Angeles` explicitly, never the server's local zone.
- All Flight times are **gate** times (`*_in_off_block_time`), never runway (`*_aod_time`).
- SFO `code_shares[]` is **ignored**; the feed is already one record per marketing flight (ADR 0002).
- Check-in aisles are produced **only** for SFO INTL departures (ADR 0001).
- Server cache TTL 5 min; `forceRefresh=1` TTL 1 min; upstream fetch timeout 10 s; stale-on-failure.
- Client polls every 60 s with `If-None-Match`; pauses while the tab is hidden.
- Time-dependent tests pin now to `2026-08-03T16:42:00-07:00` (sample capture instant).
- URL defaults omitted from the query string: `airport=SFO`, `dir=departures`, `sort=est.asc`.
- Missing data renders as `—` everywhere in the UI.

## File Structure

```
src/lib/types.ts             Flight, FlightsResponse, Airport, Direction, StatusKind
src/lib/time.ts              PT parsing/formatting: parseSjcDateTime, toPtIso, formatTimePT, isNextDayPT
src/lib/checkins.ts          aisleLabel(counters, dict) — dedupe + collapse contiguous runs
src/lib/normalize-sfo.ts     normalizeSfo(feed, checkinsDict) → Flight[]  (dedupe, fallbacks, status map)
src/lib/normalize-sjc.ts     normalizeSjc(arrivals, departures, now) → Flight[]  (status-text parsing)
src/lib/flight-view.ts       effectiveTime, windowed, compareFlights, matchesQuery, applyView
src/lib/cache.ts             createCache(fetcher) — TTLs, single-flight, stale-on-error
src/lib/upstream.ts          fetchAirport(airport) — real URLs, 10 s timeout, wires normalizers
src/lib/url-state.ts         ViewState, DEFAULT_VIEW, parseView, serializeView
src/app/api/flights/route.ts GET handler: cache → window → ETag/304
src/app/api/health/route.ts  GET → 200 {"ok":true}
src/hooks/useFlights.ts      60 s poll, ETag, visibility pause, force refresh, updated/cachedAt
src/components/StatusPill.tsx / FlightTable.tsx / FilterBar.tsx / Header.tsx
src/app/page.tsx             Dashboard assembly (client component)
scripts/extract-fixtures.mjs curated-fixture extractor (run once, fixture committed)
tests under src/lib/__tests__/ + tests/fixtures/sfo-curated.json
Dockerfile · .dockerignore · .github/workflows/ci.yml · README.md
```

---

### Task 1: Scaffold Next.js app with Tailwind and Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev|build|test|typecheck` all work; `@/*` alias resolves to `src/*` in both Next and Vitest; JSON imports enabled.

- [ ] **Step 1: Write the config files**

`package.json`:

```json
{
  "name": "flight-status",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "date-fns": "^4.1.0",
    "date-fns-tz": "^3.2.0",
    "next": "^15.4.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
}

export default nextConfig
```

`postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`vitest.config.ts`:

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

`src/app/globals.css`:

```css
@import "tailwindcss";
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Flight Status — SFO + SJC',
  description: 'Unified flight status board for SFO and SJC volunteers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  )
}
```

`src/app/page.tsx` (placeholder, replaced in Task 11):

```tsx
export default function Page() {
  return <main className="p-8">Flight status dashboard — under construction</main>
}
```

Append to `.gitignore`:

```
node_modules/
.next/
next-env.d.ts
*.tsbuildinfo
```

- [ ] **Step 2: Install and verify the toolchain**

Run: `npm install && npm run build && npx vitest run --passWithNoTests && npm run typecheck`
Expected: build succeeds (standalone output mentioned in build log), vitest exits 0 with no tests, typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 app with Tailwind v4 and Vitest"
```

---

### Task 2: Domain types and PT time helpers

**Files:**
- Create: `src/lib/types.ts`, `src/lib/time.ts`
- Test: `src/lib/__tests__/time.test.ts`

**Interfaces:**
- Consumes: `date-fns-tz` (`fromZonedTime`, `formatInTimeZone`).
- Produces (used by every later task):
  - `types.ts`: `Airport = 'SFO' | 'SJC'`, `Direction = 'departure' | 'arrival'`, `StatusKind`, `FlightStatus { kind; text; time? }`, `Flight` (all fields per spec), `FlightsResponse { airport; cachedAt; stale; flights }`
  - `time.ts`: `PT: string`, `parseSjcDateTime(date: string, time: string, now: Date): string | null`, `toPtIso(d: Date): string`, `formatTimePT(iso: string): string`, `isNextDayPT(iso: string, now: Date): boolean`

- [ ] **Step 1: Write `src/lib/types.ts`** (types only — no test needed)

```ts
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
```

- [ ] **Step 2: Write the failing tests** — `src/lib/__tests__/time.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { formatTimePT, isNextDayPT, parseSjcDateTime, toPtIso } from '@/lib/time'

// The instant the samples were captured — pin for all time-dependent tests.
const NOW = new Date('2026-08-03T16:42:00-07:00')

describe('parseSjcDateTime', () => {
  it('parses an SJC date+time into a PT-offset ISO string', () => {
    expect(parseSjcDateTime('Aug 03', '4:05 PM', NOW)).toBe('2026-08-03T16:05:00-07:00')
  })

  it('parses a morning time', () => {
    expect(parseSjcDateTime('Aug 03', '12:10 AM', NOW)).toBe('2026-08-03T00:10:00-07:00')
  })

  it('handles winter dates with the PST offset', () => {
    const winterNow = new Date('2026-01-15T12:00:00-08:00')
    expect(parseSjcDateTime('Jan 15', '4:05 PM', winterNow)).toBe('2026-01-15T16:05:00-08:00')
  })

  it('infers the year across the Dec 31 → Jan 1 boundary', () => {
    const nye = new Date('2026-12-31T23:00:00-08:00')
    expect(parseSjcDateTime('Jan 01', '1:00 AM', nye)).toBe('2027-01-01T01:00:00-08:00')
    const nyd = new Date('2027-01-01T01:00:00-08:00')
    expect(parseSjcDateTime('Dec 31', '11:00 PM', nyd)).toBe('2026-12-31T23:00:00-08:00')
  })

  it('returns null for garbage', () => {
    expect(parseSjcDateTime('Aug 03', 'soon', NOW)).toBeNull()
    expect(parseSjcDateTime('', '4:05 PM', NOW)).toBeNull()
  })

  it('returns null for an hour outside the 12-hour clock', () => {
    // The regex accepts 1-2 digits; without a range check `% 12` would
    // silently reinterpret "13:05 AM" as 1:05 AM.
    expect(parseSjcDateTime('Aug 03', '13:05 AM', NOW)).toBeNull()
    expect(parseSjcDateTime('Aug 03', '00:05 AM', NOW)).toBeNull()
    expect(parseSjcDateTime('Aug 03', '99:05 PM', NOW)).toBeNull()
  })

  it('returns null rather than throwing on a calendar-invalid date', () => {
    // Feb 29 near a leap year: the non-leap candidate years are invalid
    // dates, which must not poison the closest-candidate comparison.
    expect(parseSjcDateTime('Feb 30', '4:05 PM', NOW)).toBeNull()
    expect(
      parseSjcDateTime('Feb 29', '4:05 PM', new Date('2028-02-20T12:00:00-08:00')),
    ).toBe('2028-02-29T16:05:00-08:00')
  })
})

describe('toPtIso', () => {
  it('formats an instant with the PT offset', () => {
    expect(toPtIso(new Date('2026-08-03T23:42:00Z'))).toBe('2026-08-03T16:42:00-07:00')
  })
})

describe('formatTimePT', () => {
  it('renders h:mm AM/PM in PT regardless of server TZ', () => {
    expect(formatTimePT('2026-08-03T23:42:00Z')).toBe('4:42 PM')
    expect(formatTimePT('2026-08-04T00:12:00-07:00')).toBe('12:12 AM')
  })
})

describe('isNextDayPT', () => {
  it('is false for a time today (PT)', () => {
    expect(isNextDayPT('2026-08-03T22:33:00-07:00', NOW)).toBe(false)
  })
  it('is true for a time tomorrow (PT)', () => {
    expect(isNextDayPT('2026-08-04T00:12:00-07:00', NOW)).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/time.test.ts`
Expected: FAIL — cannot resolve `@/lib/time`.

- [ ] **Step 4: Write `src/lib/time.ts`**

```ts
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const PT = 'America/Los_Angeles'

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

/** ISO 8601 with the PT offset, e.g. "2026-08-03T16:42:00-07:00". */
export function toPtIso(d: Date): string {
  return formatInTimeZone(d, PT, "yyyy-MM-dd'T'HH:mm:ssXXX")
}

/**
 * SJC feed date+time ("Aug 03", "4:05 PM") → PT-offset ISO string.
 * The feed has no year: try the candidate years around `now` and keep the
 * instant closest to it, which handles the Dec 31 → Jan 1 boundary.
 */
export function parseSjcDateTime(date: string, time: string, now: Date): string | null {
  const dm = /^([A-Za-z]{3}) (\d{1,2})$/.exec(date.trim())
  const tm = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time.trim())
  if (!dm || !tm || !(dm[1] in MONTHS)) return null
  const clockHour = Number(tm[1])
  // The regex admits 00-99; only 1-12 is a real 12-hour-clock hour, and
  // `% 12` alone would silently reinterpret "13:05 AM" as 1:05 AM.
  if (clockHour < 1 || clockHour > 12) return null
  const hour = (clockHour % 12) + (tm[3] === 'PM' ? 12 : 0)
  const wall = (year: number) =>
    `${year}-${MONTHS[dm[1]]}-${dm[2].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${tm[2]}:00`
  const nowYear = Number(formatInTimeZone(now, PT, 'yyyy'))
  let best: Date | null = null
  for (const year of [nowYear - 1, nowYear, nowYear + 1]) {
    const candidate = fromZonedTime(wall(year), PT)
    // Skip calendar-invalid candidates (Feb 29 in a non-leap year): an
    // Invalid Date would make every later comparison NaN — always false —
    // pinning `best` to it and throwing downstream in toPtIso.
    if (Number.isNaN(+candidate)) continue
    if (!best || Math.abs(+candidate - +now) < Math.abs(+best - +now)) best = candidate
  }
  return best ? toPtIso(best) : null
}

/** "4:05 PM" in PT. */
export function formatTimePT(iso: string): string {
  return formatInTimeZone(new Date(iso), PT, 'h:mm a')
}

/** True when `iso` falls on a later PT calendar day than `now`. */
export function isNextDayPT(iso: string, now: Date): boolean {
  return (
    formatInTimeZone(new Date(iso), PT, 'yyyy-MM-dd') >
    formatInTimeZone(now, PT, 'yyyy-MM-dd')
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/time.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/time.ts src/lib/__tests__/time.test.ts
git commit -m "feat: domain types and PT-aware time helpers"
```

---

### Task 3: Check-in aisle collapsing

**Files:**
- Create: `src/lib/checkins.ts`
- Test: `src/lib/__tests__/checkins.test.ts`

**Interfaces:**
- Consumes: nothing (pure function; the dict is passed in).
- Produces: `aisleLabel(counters: string[], dict: Record<string, string>): string | undefined` — used by `normalizeSfo` (Task 4). Rules per spec: map counters through the dict, skip unmapped names (CURBSIDE…, SELF SERVICE…), dedupe aisle numbers, collapse contiguous runs with an en dash: `{3} → "Aisle 3"`, `{3,4} → "Aisles 3–4"`, `{1,2,3} → "Aisles 1–3"`, `{1,3} → "Aisles 1, 3"`. `undefined` when nothing maps. The INTL-only rule (ADR 0001) lives in the *caller*, not here.

- [ ] **Step 1: Write the failing tests** — `src/lib/__tests__/checkins.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { aisleLabel } from '@/lib/checkins'

const DICT: Record<string, string> = {
  '1': 'Aisle 1', '2': 'Aisle 1',
  '15': 'Aisle 2', '29': 'Aisle 3', '30': 'Aisle 3',
  '43': 'Aisle 4', '57': 'Aisle 5', '58': 'Aisle 5',
}

describe('aisleLabel', () => {
  it('renders a single aisle', () => {
    expect(aisleLabel(['29', '30'], DICT)).toBe('Aisle 3')
  })
  it('collapses a contiguous pair with an en dash', () => {
    expect(aisleLabel(['29', '43'], DICT)).toBe('Aisles 3–4')
  })
  it('collapses a longer run', () => {
    expect(aisleLabel(['15', '29', '43'], DICT)).toBe('Aisles 2–4')
  })
  it('separates non-contiguous aisles with commas', () => {
    expect(aisleLabel(['1', '29'], DICT)).toBe('Aisles 1, 3')
  })
  it('skips counters missing from the dict', () => {
    expect(aisleLabel(['CURBSIDE 5', '57'], DICT)).toBe('Aisle 5')
  })
  it('returns undefined when nothing maps', () => {
    expect(aisleLabel(['CURBSIDE 5', 'SELF SERVICE BAG DROP 12'], DICT)).toBeUndefined()
    expect(aisleLabel([], DICT)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/checkins.test.ts`
Expected: FAIL — cannot resolve `@/lib/checkins`.

- [ ] **Step 3: Write `src/lib/checkins.ts`**

```ts
/**
 * Map check-in counter names through SFO's counter→aisle dictionary and
 * collapse the result: "Aisle 3", "Aisles 3–4", "Aisles 1, 3".
 * Counters absent from the dictionary are skipped. Undefined when none map.
 * Callers must apply this ONLY to INTL departures — see ADR 0001.
 */
export function aisleLabel(
  counters: string[],
  dict: Record<string, string>,
): string | undefined {
  const nums = [...new Set(
    counters
      .map((c) => dict[c])
      .filter((label): label is string => Boolean(label))
      .map((label) => Number(label.replace(/\D+/g, ''))),
  )].sort((a, b) => a - b)
  if (nums.length === 0) return undefined
  const runs: Array<[number, number]> = []
  for (const n of nums) {
    const last = runs[runs.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  const parts = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
  return `${nums.length === 1 ? 'Aisle' : 'Aisles'} ${parts.join(', ')}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/checkins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/checkins.ts src/lib/__tests__/checkins.test.ts
git commit -m "feat: check-in aisle mapping with contiguous-run collapsing"
```

---

### Task 4: SFO normalizer (with curated fixture extraction)

**Files:**
- Create: `scripts/extract-fixtures.mjs`, `tests/fixtures/sfo-curated.json` (generated), `src/lib/normalize-sfo.ts`
- Test: `src/lib/__tests__/normalize-sfo.test.ts`

**Interfaces:**
- Consumes: `Flight`, `Direction` from `@/lib/types`; `aisleLabel` from `@/lib/checkins`.
- Produces: `normalizeSfo(feed: SfoFeed, checkins: Record<string, string>): Flight[]` where `SfoFeed = { data: unknown[] }` (records typed loosely inside the module). Used by `upstream.ts` (Task 9) and the contract test (Task 7).

Normalization rules (spec §Normalization rules — the ADRs explain why):
1. One feed record → one Flight. `code_shares[]` ignored entirely.
2. Dedupe on `flight_id + '|' + flight_number`, keep first occurrence.
3. `airline` = `airline_display_name ?? airline_name`; same for `operatedBy` from `original_flight`.
4. `city` = `airport_city ?? airport_name`; `cityCode` = `airport.iata_code`.
5. `scheduled` = `scheduled_in_off_block_time` (skip record if missing); `estimated` = `actual_in_off_block_time ?? estimated_in_off_block_time ?? undefined`.
6. Status: remark → kind, case-insensitive (`On time` and `On Time` both occur); unknown remark → `kind: 'other'`, `text` = raw remark.
7. `terminal`: `ITM` → `INTL`; null → undefined.
8. Arrivals: `baggage` = `Carousel N` where N = trailing digits of `carousel_name` (`CL-F5`, `CL10`, `1` all → their trailing number); `bagTimes` from `first_bag_time`/`last_bag_time`.
9. Departures: `checkin` = `aisleLabel(...)` **only when terminal is INTL** (ADR 0001 — T1/T2 counters share the 1–168 range and map to WRONG aisles).
10. `id` = `` `SFO/${flight_id}/${flight_number}` ``.

- [ ] **Step 1: Write the fixture extractor** — `scripts/extract-fixtures.mjs`

```js
// Extracts the curated SFO fixture (49 records) from docs/samples/ (spec §Testing).
// Run once: node scripts/extract-fixtures.mjs   (fixture is committed, not rebuilt in CI)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const feed = JSON.parse(readFileSync('docs/samples/sfo-flight-status.json', 'utf8'))
const { data } = feed

// flight_id prefixes from the spec's curated-fixture table.
const PREFIXES = [
  'UA/2017/A', // codeshare group: 1 operating + 5 marketing
  'UA/540/D',  // wrong-aisle trap (T2, numeric counters) + one of the dup pairs
  'TK/290/D',  // INTL aisle mapping that must work → Aisle 5
  'OZ/212/A',  // Landed: actual_aod set, actual_in_off_block null
  'B6/215/A',  // Cancelled: no estimate, no actual
  'UA/5599/A', // missing airport_city → airport_name (Carlsbad)
  'UA/1482/A', // multi-leg n_stop=1 DEN→SEA→SFO, shows Seattle
  'DL/667/A',  // next-day marker: sched Aug 3, best-known Aug 4
  'DL/691/D',  // window-vs-sort: sched 1:10 PM, est 7:52 PM
]
const byPrefix = data.filter((r) => PREFIXES.some((p) => r.flight_id.startsWith(p + '/')))

// Dynamic picks: first record exhibiting each remaining rule.
const extra = []
const pick = (label, pred) => {
  const hit = data.find((r) => pred(r) && !byPrefix.includes(r) && !extra.includes(r))
  if (!hit) throw new Error(`no record found for: ${label}`)
  extra.push(hit)
}
pick('ITM terminal', (r) => r.terminal?.terminal_code === 'ITM')
pick('null terminal', (r) => r.terminal === null)
pick('carousel CL-F5 style', (r) => /^CL-[A-Z]\d+$/.test(r.baggage_carousel?.carousel_name ?? ''))
pick('carousel CL10 style', (r) => /^CL\d+$/.test(r.baggage_carousel?.carousel_name ?? ''))
pick('carousel bare-number style', (r) => /^\d+$/.test(r.baggage_carousel?.carousel_name ?? ''))
// display name diverges from name AND matches the post-merger carrier the spec
// calls out by name (Alaska → Hawaiian Airlines) — pins the fallback ORDER,
// unlike Azul (7016) above where airline_display_name is simply null.
pick(
  'post-merger airline name (Alaska → Hawaiian Airlines)',
  (r) => r.airline.airline_display_name !== r.airline.airline_name && /Hawaiian/.test(r.airline.airline_display_name ?? ''),
)
pick('remark "On Time" casing', (r) => r.remark === 'On Time')
pick('remark "On time" casing', (r) => r.remark === 'On time')

const records = [...byPrefix, ...extra]

// Sanity: every prefix matched, and the NZ 9056 duplicate pair is intact.
for (const p of PREFIXES) {
  if (!records.some((r) => r.flight_id.startsWith(p + '/'))) throw new Error(`missing: ${p}`)
}
const dup9056 = records.filter((r) => r.flight_id.startsWith('UA/540/D/') && r.flight_number === '9056')
if (dup9056.length !== 2) throw new Error(`expected NZ 9056 duplicate pair, got ${dup9056.length}`)

mkdirSync('tests/fixtures', { recursive: true })
writeFileSync('tests/fixtures/sfo-curated.json', JSON.stringify({ data: records }, null, 1))
console.log(`wrote tests/fixtures/sfo-curated.json with ${records.length} records`)
```

- [ ] **Step 2: Run the extractor**

Run: `node scripts/extract-fixtures.mjs`
Expected: `wrote tests/fixtures/sfo-curated.json with 49 records` (the script throws if any curated case is missing). If a `pick()` throws, inspect the sample with `jq` and adjust the predicate — the spec's fixture table is the source of truth for *what* must be covered.

- [ ] **Step 3: Write the failing tests** — `src/lib/__tests__/normalize-sfo.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { normalizeSfo } from '@/lib/normalize-sfo'
import checkins from '../../../docs/samples/sfo-checkins.json'
import curated from '../../../tests/fixtures/sfo-curated.json'

const flights = normalizeSfo(curated, checkins as Record<string, string>)

describe('normalizeSfo — codeshares (ADR 0002)', () => {
  it('keeps one row per marketing flight for the UA 2017 movement', () => {
    const group = flights.filter((f) => f.id.startsWith('SFO/UA/2017/A/'))
    expect(group).toHaveLength(6) // 1 operating + 5 marketing
    expect(group.filter((f) => f.isCodeshare)).toHaveLength(5)
  })
  it('reads airline as the marketing carrier and operatedBy from original_flight', () => {
    const azul = flights.find((f) => f.airline === 'Azul' && f.flightNumber === '7016')
    expect(azul).toBeDefined()
    expect(azul!.isCodeshare).toBe(true)
    expect(azul!.operatedBy).toEqual({ airline: 'United', flightNumber: '2017' })
  })
  it('operating rows have no operatedBy', () => {
    const ua2017 = flights.find((f) => f.airline === 'United' && f.flightNumber === '2017')
    expect(ua2017!.isCodeshare).toBe(false)
    expect(ua2017!.operatedBy).toBeUndefined()
  })
  it('drops exact duplicate pairs, keeping the first (NZ 9056)', () => {
    expect(flights.filter((f) => f.flightNumber === '9056')).toHaveLength(1)
  })
})

describe('normalizeSfo — check-in aisles (ADR 0001)', () => {
  it('maps INTL departures through the dictionary (TK 290 → Aisle 5)', () => {
    const tk = flights.find((f) => f.id.startsWith('SFO/TK/290/D/') && !f.isCodeshare)
    expect(tk!.direction).toBe('departure')
    expect(tk!.terminal).toBe('INTL')
    expect(tk!.checkin).toBe('Aisle 5')
  })
  it('NEVER maps non-INTL departures (UA 540 from T2 must not get an aisle)', () => {
    const ua540 = flights.find((f) => f.id.startsWith('SFO/UA/540/D/') && !f.isCodeshare)
    expect(ua540!.terminal).toBe('T2')
    expect(ua540!.checkin).toBeUndefined()
  })
})

describe('normalizeSfo — times and status', () => {
  it('uses gate times; actual overrides estimate (ADR 0003)', () => {
    const ua2017 = flights.find((f) => f.airline === 'United' && f.flightNumber === '2017')!
    expect(ua2017.direction).toBe('arrival')
    expect(ua2017.gate).toBe('E11')
    expect(ua2017.scheduled).toBe('2026-08-03T12:44:00-07:00')
    expect(ua2017.estimated).toBe('2026-08-03T12:35:00-07:00') // actual_in_off_block_time
  })
  it('Landed rows have no gate actual — estimated falls back to the estimate', () => {
    const oz = flights.find((f) => f.id.startsWith('SFO/OZ/212/A/') && !f.isCodeshare)!
    expect(oz.status.kind).toBe('landed')
    // estimated_in_off_block_time (16:20), NOT actual_aod_time (16:31) — the
    // runway actual exists on this row and toBeDefined() would wrongly accept it.
    expect(oz.estimated).toBe('2026-08-03T16:20:00-07:00')
  })
  it('Cancelled rows can have no estimated at all', () => {
    const b6 = flights.find((f) => f.id.startsWith('SFO/B6/215/A/') && !f.isCodeshare)!
    expect(b6.status.kind).toBe('cancelled')
    expect(b6.estimated).toBeUndefined()
  })
  it('maps both remark casings to on-time and unknown remarks to other', () => {
    const upper = flights.find((f) => f.id.startsWith('SFO/AC/744/D/') && !f.isCodeshare)!
    const lower = flights.find((f) => f.id.startsWith('SFO/UA/1243/A/') && !f.isCodeshare)!
    expect(upper.status.kind).toBe('on-time') // remark: "On Time"
    expect(lower.status.kind).toBe('on-time') // remark: "On time"
    const kinds = new Set(flights.map((f) => f.status.kind))
    expect(kinds.has('other')).toBe(false) // curated fixture contains only known remarks
  })
})

describe('normalizeSfo — field fallbacks', () => {
  it('falls back to airport_name when airport_city is missing (UA 5599 → Carlsbad)', () => {
    const ua = flights.find((f) => f.id.startsWith('SFO/UA/5599/A/') && !f.isCodeshare)!
    expect(ua.city).toBe('Carlsbad')
  })
  it('shows the immediate stop for multi-leg flights (UA 1482 → Seattle)', () => {
    const ua = flights.find((f) => f.id.startsWith('SFO/UA/1482/A/') && !f.isCodeshare)!
    expect(ua.city).toBe('Seattle')
    expect(ua.cityCode).toBe('SEA')
    expect(ua.bagTimes).toEqual({
      first: '2026-08-03T13:41:00-07:00',
      last: '2026-08-03T13:57:00-07:00',
    })
  })
  it('prefers airline_display_name over airline_name when they diverge (DL 667 → "Delta")', () => {
    // airline_name is "DELTA"; a reversed fallback order would pass this
    // through unchanged instead of preferring the display name.
    const dl = flights.find((f) => f.id.startsWith('SFO/DL/667/A/') && !f.isCodeshare)!
    expect(dl.airline).toBe('Delta')
  })
  it('prefers airline_display_name for post-merger carriers (Alaska → Hawaiian Airlines)', () => {
    const ha = flights.find((f) => f.id.startsWith('SFO/AS/978/A/') && !f.isCodeshare)!
    expect(ha.airline).toBe('Hawaiian Airlines')
  })
  it('maps ITM to INTL and null terminal to undefined', () => {
    expect(flights.some((f) => f.terminal === 'INTL')).toBe(true)
    expect(flights.every((f) => f.terminal !== 'ITM')).toBe(true)
    expect(flights.some((f) => f.terminal === undefined)).toBe(true)
  })
  it('derives Carousel N from all three carousel_name formats', () => {
    const dashLetter = flights.find((f) => f.id.startsWith('SFO/UA/2017/A/') && !f.isCodeshare)!
    expect(dashLetter.baggage).toBe('Carousel 5') // "CL-F5" — discards the boarding-area letter
    const dashless = flights.find((f) => f.id.startsWith('SFO/AV/562/A/') && !f.isCodeshare)!
    expect(dashless.baggage).toBe('Carousel 10') // "CL10"
    const labels = flights.filter((f) => f.baggage).map((f) => f.baggage!)
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(labels.every((b) => /^Carousel \d+$/.test(b))).toBe(true)
  })
})
```

The assertions use `startsWith` because curated `flight_id`s carry the date
suffix (`UA/2017/A/2026-08-03`).

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/normalize-sfo.test.ts`
Expected: FAIL — cannot resolve `@/lib/normalize-sfo`.

- [ ] **Step 5: Write `src/lib/normalize-sfo.ts`**

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/normalize-sfo.test.ts`
Expected: PASS. If a curated-record assertion fails (e.g. TK 290's aisle), check the fixture record with `jq` before touching the normalizer — the spec's fixture table states the expected outcome for each record.

- [ ] **Step 7: Commit**

```bash
git add scripts/extract-fixtures.mjs tests/fixtures/sfo-curated.json src/lib/normalize-sfo.ts src/lib/__tests__/normalize-sfo.test.ts
git commit -m "feat: SFO normalizer with curated fixture (codeshare-pre-expanded feed)"
```

---

### Task 5: SJC normalizer

**Files:**
- Create: `src/lib/normalize-sjc.ts`
- Test: `src/lib/__tests__/normalize-sjc.test.ts`

**Interfaces:**
- Consumes: `parseSjcDateTime` from `@/lib/time`; `Flight`, `FlightStatus` from `@/lib/types`.
- Produces: `normalizeSjc(arrivals: unknown[], departures: unknown[], now: Date): Flight[]` — used by `upstream.ts` (Task 9).

Rules: `status` strings are `On Time`, `Delayed h:mm PM`, `Early h:mm PM`, `Arrived h:mm PM`, `Departed h:mm PM`; the embedded time becomes `status.time` AND `estimated`. A status time more than 12 h before the scheduled time is assumed to have crossed midnight (+1 day). SJC renders `Delayed` times *earlier* than scheduled as-is (2 real rows do this) — do not "fix" them. `isCodeshare` is always false. Rows with unparseable scheduled time are skipped.

- [ ] **Step 1: Write the failing tests** — `src/lib/__tests__/normalize-sjc.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { normalizeSjc } from '@/lib/normalize-sjc'
import arrivals from '../../../docs/samples/sjc-arrivals.json'
import departures from '../../../docs/samples/sjc-departures.json'

const NOW = new Date('2026-08-03T16:42:00-07:00')
const flights = normalizeSjc(arrivals, departures, NOW)

describe('normalizeSjc — shape', () => {
  it('produces one Flight per record with directions from the source arrays', () => {
    expect(flights.filter((f) => f.direction === 'arrival')).toHaveLength(arrivals.length)
    expect(flights.filter((f) => f.direction === 'departure')).toHaveLength(departures.length)
  })
  it('never marks codeshares and never sets airlineCode', () => {
    expect(flights.every((f) => !f.isCodeshare && f.airlineCode === undefined)).toBe(true)
  })
  it('maps far end city, code, terminal, gate, baggage', () => {
    const sw443 = flights.find((f) => f.flightNumber === '443' && f.airline === 'Southwest')!
    expect(sw443.city).toBe('Spokane, WA')
    expect(sw443.cityCode).toBe('GEG')
    expect(sw443.terminal).toBe('B')
    expect(sw443.gate).toBe('26')
    expect(sw443.baggage).toBe('B3')
  })
  it('maps far end city and code for departures too (SW 3266 → Phoenix, AZ / PHX)', () => {
    const sw3266 = flights.find((f) => f.flightNumber === '3266' && f.direction === 'departure')!
    expect(sw3266.city).toBe('Phoenix, AZ')
    expect(sw3266.cityCode).toBe('PHX')
  })
  it('never carries baggage on departures, even if the raw record has one', () => {
    const withSpuriousBaggage = normalizeSjc(
      [],
      [{ date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: '9',
         destination: 'Y', destination_code: 'YYY', terminal: 'A', gate: '1',
         baggage: 'Z9', status: 'On Time' }],
      NOW,
    )
    expect(withSpuriousBaggage[0].baggage).toBeUndefined()
  })
  it('skips a row with an unparseable scheduled time, keeping the good row', () => {
    const mixed = normalizeSjc(
      [
        { date: 'Xyz 99', time: '4:05 PM', airline: 'X', flight_number: 'BAD',
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
        { date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: 'GOOD',
          origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
          status: 'On Time' },
      ],
      [], NOW,
    )
    expect(mixed).toHaveLength(1)
    expect(mixed[0].flightNumber).toBe('GOOD')
  })
})

describe('normalizeSjc — status parsing', () => {
  it('parses On Time with no embedded time', () => {
    const f = flights.find((x) => x.status.text === 'On Time')!
    expect(f.status.kind).toBe('on-time')
    expect(f.status.time).toBeUndefined()
    expect(f.estimated).toBeUndefined()
  })
  it('parses "Delayed 4:44 PM" into kind + time + estimated (SW 2350)', () => {
    const f = flights.find((x) => x.flightNumber === '2350' && x.direction === 'arrival')!
    expect(f.status.kind).toBe('delayed')
    expect(f.status.time).toBe('2026-08-03T16:44:00-07:00')
    expect(f.estimated).toBe('2026-08-03T16:44:00-07:00')
  })
  it('parses Early into kind + estimated (DL 3897 arrival: Early 4:53 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '3897' && x.direction === 'arrival')!
    expect(f.status.kind).toBe('early')
    expect(f.estimated).toBe('2026-08-03T16:53:00-07:00')
  })
  it('parses Arrived into kind + estimated (SW 443 arrival: Arrived 4:01 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '443' && x.direction === 'arrival')!
    expect(f.status.kind).toBe('arrived')
    expect(f.estimated).toBe('2026-08-03T16:01:00-07:00')
  })
  it('parses Departed into kind + estimated (SW 3266 departure: Departed 4:27 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '3266' && x.direction === 'departure')!
    expect(f.status.kind).toBe('departed')
    expect(f.estimated).toBe('2026-08-03T16:27:00-07:00')
  })
  it('keeps a Delayed time earlier than scheduled as-is (DL 3822: 4:30 PM → 4:20 PM)', () => {
    const f = flights.find((x) => x.flightNumber === '3822' && x.direction === 'departure')!
    expect(f.scheduled).toBe('2026-08-03T16:30:00-07:00')
    expect(f.status.kind).toBe('delayed')
    expect(f.estimated).toBe('2026-08-03T16:20:00-07:00')
  })
  it('treats an unknown status string as other, not a crash', () => {
    const weird = normalizeSjc(
      [{ date: 'Aug 03', time: '4:05 PM', airline: 'X', flight_number: '1',
         origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
         status: 'Gate Change' }],
      [], NOW,
    )
    expect(weird[0].status).toEqual({ kind: 'other', text: 'Gate Change' })
  })
  it('rolls a status time crossing midnight forward one day', () => {
    const late = normalizeSjc(
      [{ date: 'Aug 03', time: '11:55 PM', airline: 'X', flight_number: '2',
         origin: 'Y', origin_code: 'YYY', terminal: 'A', gate: '1', baggage: 'A1',
         status: 'Delayed 12:10 AM' }],
      [], NOW,
    )
    expect(late[0].scheduled).toBe('2026-08-03T23:55:00-07:00')
    expect(late[0].estimated).toBe('2026-08-04T00:10:00-07:00')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/normalize-sjc.test.ts`
Expected: FAIL — cannot resolve `@/lib/normalize-sjc`.

- [ ] **Step 3: Write `src/lib/normalize-sjc.ts`**

```ts
import { parseSjcDateTime, toPtIso } from '@/lib/time'
import type { Direction, Flight, FlightStatus } from '@/lib/types'

interface SjcRecord {
  date: string
  time: string
  airline: string
  flight_number: string
  origin?: string
  origin_code?: string
  destination?: string
  destination_code?: string
  terminal?: string
  gate?: string
  baggage?: string
  status?: string
}

const WORD_STATUSES: Record<string, FlightStatus> = {
  'on time': { kind: 'on-time', text: 'On Time' },
  'cancelled': { kind: 'cancelled', text: 'Cancelled' },
}

const TIMED_STATUS = /^(Delayed|Early|Arrived|Departed)\s+(\d{1,2}:\d{2} [AP]M)$/

function parseStatus(
  raw: string | undefined,
  date: string,
  scheduled: string,
  now: Date,
): FlightStatus {
  const text = raw?.trim() ?? '—'
  const word = WORD_STATUSES[text.toLowerCase()]
  if (word) return { ...word }
  const timed = TIMED_STATUS.exec(text)
  if (!timed) return { kind: 'other', text }
  let time = parseSjcDateTime(date, timed[2], now) ?? undefined
  // The status time shares the row's date field; a time more than 12 h before
  // the scheduled time crossed midnight ("11:55 PM" → "Delayed 12:10 AM").
  if (time && Date.parse(time) < Date.parse(scheduled) - 12 * 3_600_000) {
    time = toPtIso(new Date(Date.parse(time) + 24 * 3_600_000))
  }
  return { kind: timed[1].toLowerCase() as FlightStatus['kind'], text: timed[1], time }
}

function toFlight(r: SjcRecord, direction: Direction, now: Date): Flight | null {
  const scheduled = parseSjcDateTime(r.date, r.time, now)
  if (!scheduled) return null
  const status = parseStatus(r.status, r.date, scheduled, now)
  return {
    id: `SJC/${direction}/${r.airline}/${r.flight_number}/${r.date}`,
    airport: 'SJC',
    direction,
    airline: r.airline,
    flightNumber: r.flight_number,
    city: (direction === 'arrival' ? r.origin : r.destination) ?? '—',
    cityCode: direction === 'arrival' ? r.origin_code : r.destination_code,
    scheduled,
    estimated: status.time,
    status,
    isCodeshare: false,
    terminal: r.terminal,
    gate: r.gate,
    baggage: direction === 'arrival' ? r.baggage : undefined,
  }
}

export function normalizeSjc(arrivals: unknown[], departures: unknown[], now: Date): Flight[] {
  return [
    ...(arrivals as SjcRecord[]).map((r) => toFlight(r, 'arrival', now)),
    ...(departures as SjcRecord[]).map((r) => toFlight(r, 'departure', now)),
  ].filter((f): f is Flight => f !== null)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/normalize-sjc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize-sjc.ts src/lib/__tests__/normalize-sjc.test.ts
git commit -m "feat: SJC normalizer with status-text time parsing"
```

---

### Task 6: Window, effective time, sorting, and search predicates

**Files:**
- Create: `src/lib/flight-view.ts`
- Test: `src/lib/__tests__/flight-view.test.ts`

**Interfaces:**
- Consumes: `Flight` from `@/lib/types`.
- Produces (used by the API route in Task 9 and the page in Tasks 11–12):
  - `effectiveTime(f: Flight): number` — epoch ms of `estimated ?? scheduled`
  - `windowed(flights: Flight[], now: Date): Flight[]` — keeps `[now − 1h, now + 8h]`
  - `SortKey = 'airline' | 'city' | 'flight' | 'sched' | 'est' | 'status' | 'terminal' | 'gate' | 'extra'`
  - `compareFlights(a: Flight, b: Flight, key: SortKey): number` (ascending; caller negates for desc). `est` orders by `effectiveTime`; `extra` orders by `baggage ?? checkin ?? ''`
  - `matchesQuery(f: Flight, q: string): boolean` — **prefix** on flightNumber, substring on airline and city, case-insensitive, empty query matches all

- [ ] **Step 1: Write the failing tests** — `src/lib/__tests__/flight-view.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { compareFlights, effectiveTime, matchesQuery, windowed } from '@/lib/flight-view'
import type { Flight } from '@/lib/types'

const NOW = new Date('2026-08-03T16:42:00-07:00')

function flight(over: Partial<Flight>): Flight {
  return {
    id: 'SFO/x', airport: 'SFO', direction: 'departure', airline: 'United',
    flightNumber: '100', city: 'Denver', scheduled: '2026-08-03T17:00:00-07:00',
    status: { kind: 'on-time', text: 'On Time' }, isCodeshare: false,
    ...over,
  }
}

describe('effectiveTime and windowed', () => {
  it('prefers estimated over scheduled', () => {
    const f = flight({ estimated: '2026-08-03T19:52:00-07:00', scheduled: '2026-08-03T13:10:00-07:00' })
    expect(effectiveTime(f)).toBe(Date.parse('2026-08-03T19:52:00-07:00'))
  })
  it('keeps the DL 691 shape: scheduled before the window, estimate inside', () => {
    const f = flight({ scheduled: '2026-08-03T13:10:00-07:00', estimated: '2026-08-03T19:52:00-07:00' })
    expect(windowed([f], NOW)).toHaveLength(1)
  })
  it('drops flights outside −1h/+8h', () => {
    const past = flight({ scheduled: '2026-08-03T15:41:00-07:00' })   // 61 min ago
    const future = flight({ scheduled: '2026-08-04T00:43:00-07:00' }) // 8h 1min ahead
    const edge = flight({ scheduled: '2026-08-03T15:43:00-07:00' })   // 59 min ago
    expect(windowed([past, future, edge], NOW)).toEqual([edge])
  })
  it('includes flights at exactly the −1h and +8h boundaries (inclusive both ends)', () => {
    const lowerEdge = flight({ scheduled: '2026-08-03T15:42:00-07:00' })  // exactly now − 1h
    const upperEdge = flight({ scheduled: '2026-08-04T00:42:00-07:00' })  // exactly now + 8h
    expect(windowed([lowerEdge, upperEdge], NOW)).toEqual([lowerEdge, upperEdge])
  })
  it('drops a flight with an unparseable scheduled time instead of letting it leak through', () => {
    const bad = flight({ scheduled: 'not-a-time', estimated: undefined })
    const good = flight({ scheduled: '2026-08-03T17:00:00-07:00' })
    expect(windowed([bad, good], NOW)).toEqual([good])
  })
})

describe('compareFlights', () => {
  it('sorts est by effective time so estimate-less rows interleave by scheduled', () => {
    const a = flight({ scheduled: '2026-08-03T17:00:00-07:00' }) // no estimate
    const b = flight({ scheduled: '2026-08-03T16:00:00-07:00', estimated: '2026-08-03T18:00:00-07:00' })
    expect(compareFlights(a, b, 'est')).toBeLessThan(0)
  })
  it('sorts flight numbers numerically', () => {
    const a = flight({ flightNumber: '99' })
    const b = flight({ flightNumber: '540' })
    expect(compareFlights(a, b, 'flight')).toBeLessThan(0)
  })
  it('sorts strings case-insensitively', () => {
    const a = flight({ airline: 'alaska' })
    const b = flight({ airline: 'United' })
    expect(compareFlights(a, b, 'airline')).toBeLessThan(0)
  })
  it('treats identical airline names differing only in case as equal', () => {
    const a = flight({ airline: 'united' })
    const b = flight({ airline: 'United' })
    expect(compareFlights(a, b, 'airline')).toBe(0)
  })
  it('sorts sched by scheduled time, ignoring the estimate', () => {
    const a = flight({ scheduled: '2026-08-03T16:00:00-07:00', estimated: '2026-08-03T20:00:00-07:00' })
    const b = flight({ scheduled: '2026-08-03T17:00:00-07:00' })
    expect(compareFlights(a, b, 'sched')).toBeLessThan(0)
  })
  it('sorts extra by baggage, preferring baggage over checkin when both are present, falling back to checkin otherwise', () => {
    const withBoth = flight({ baggage: 'Carousel 9', checkin: 'Aisles 1-2' })
    const baggageOnly = flight({ baggage: 'Carousel 1' })
    expect(compareFlights(withBoth, baggageOnly, 'extra')).toBeGreaterThan(0)

    const checkinOnly = flight({ checkin: 'Aisles 1-2' })
    expect(compareFlights(checkinOnly, baggageOnly, 'extra')).toBeLessThan(0)
  })
})

describe('matchesQuery', () => {
  const f = flight({ airline: 'Turkish Airlines', flightNumber: '290', city: 'Istanbul' })
  it('matches flight number by prefix, not substring', () => {
    expect(matchesQuery(f, '29')).toBe(true)
    expect(matchesQuery(f, '90')).toBe(false)
  })
  it('matches airline and city by substring, case-insensitive', () => {
    expect(matchesQuery(f, 'turkish')).toBe(true)
    expect(matchesQuery(f, 'stanbul')).toBe(true)
  })
  it('empty query matches everything', () => {
    expect(matchesQuery(f, '')).toBe(true)
    expect(matchesQuery(f, '  ')).toBe(true)
  })
  it('does not search airline codes', () => {
    const withCode = flight({ airline: 'Turkish Airlines', airlineCode: 'TK', flightNumber: '290', city: 'Istanbul' })
    expect(matchesQuery(withCode, 'tk')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/flight-view.test.ts`
Expected: FAIL — cannot resolve `@/lib/flight-view`.

- [ ] **Step 3: Write `src/lib/flight-view.ts`**

```ts
import type { Flight } from '@/lib/types'

export type SortKey =
  | 'airline' | 'city' | 'flight' | 'sched' | 'est'
  | 'status' | 'terminal' | 'gate' | 'extra'

/** Epoch ms of the Effective time: Best-known when present, else Scheduled. */
export function effectiveTime(f: Flight): number {
  return Date.parse(f.estimated ?? f.scheduled)
}

const HOUR = 3_600_000

/** The Window: Effective time within [now − 1h, now + 8h]. */
export function windowed(flights: Flight[], now: Date): Flight[] {
  const lo = +now - HOUR
  const hi = +now + 8 * HOUR
  return flights.filter((f) => {
    const t = effectiveTime(f)
    return !Number.isNaN(t) && t >= lo && t <= hi
  })
}

function str(a: string | undefined, b: string | undefined): number {
  return (a ?? '').localeCompare(b ?? '', 'en', { sensitivity: 'base' })
}

function primaryCompare(a: Flight, b: Flight, key: SortKey): number {
  switch (key) {
    case 'airline': return str(a.airline, b.airline)
    case 'city': return str(a.city, b.city)
    case 'flight': return Number(a.flightNumber) - Number(b.flightNumber) || str(a.flightNumber, b.flightNumber)
    case 'sched': return Date.parse(a.scheduled) - Date.parse(b.scheduled)
    case 'est': return effectiveTime(a) - effectiveTime(b)
    case 'status': return str(a.status.text, b.status.text)
    case 'terminal': return str(a.terminal, b.terminal)
    case 'gate': return str(a.gate, b.gate)
    case 'extra': return str(a.baggage ?? a.checkin, b.baggage ?? b.checkin)
  }
}

/**
 * Ascending comparator; the caller reverses for descending. Low-cardinality
 * keys (terminal, gate, status) tie constantly — without a tiebreak, ties
 * fall back to whatever order the array happened to be in, which looks
 * arbitrary and reshuffles on every click. Falling back to Effective time
 * keeps a tied group internally time-ordered and stable across re-sorts.
 */
export function compareFlights(a: Flight, b: Flight, key: SortKey): number {
  return primaryCompare(a, b, key) || effectiveTime(a) - effectiveTime(b)
}

/** Prefix match on flight number; substring on airline and Far-end city. */
export function matchesQuery(f: Flight, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    f.flightNumber.toLowerCase().startsWith(needle) ||
    f.airline.toLowerCase().includes(needle) ||
    f.city.toLowerCase().includes(needle)
  )
}
```

> **Updated by the Task 12 fix pass (2026-08-04):** `compareFlights` was
> split into a `primaryCompare` per-key switch plus a wrapper that falls back
> to `effectiveTime(a) - effectiveTime(b)` when the primary comparison is 0.
> Low-cardinality keys (terminal, gate, status) tied constantly, leaving tied
> rows in whatever order the array happened to be in — arbitrary, and it
> reshuffled on every click. A regression test in
> `src/lib/__tests__/flight-view.test.ts` pins two flights tied on `terminal`
> resolving by Effective time; see `task-12-report.md` for the mutation
> check (removing the fallback fails only that test).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/flight-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/flight-view.ts src/lib/__tests__/flight-view.test.ts
git commit -m "feat: window, effective-time sorting, and search predicates"
```

---

### Task 7: Contract test over the full sample payloads

**Files:**
- Test: `src/lib/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: full payloads from `docs/samples/` and `normalizeSfo`.
- Produces: nothing importable — this test guards the assumptions normalization rests on (spec §Testing). When SFO changes its feed, this fails loudly before the normalizer misbehaves quietly.

- [ ] **Step 1: Write the test** — `src/lib/__tests__/contract.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { normalizeSfo } from '@/lib/normalize-sfo'
import checkins from '../../../docs/samples/sfo-checkins.json'
import feed from '../../../docs/samples/sfo-flight-status.json'

interface RawRecord {
  remark: string | null
  is_code_share?: boolean
  original_flight?: unknown
  scheduled_in_off_block_time: string | null
  scheduled_aod_time: string | null
  estimated_in_off_block_time: string | null
  estimated_aod_time: string | null
}

const data = (feed as { data: RawRecord[] }).data

const KNOWN_REMARKS = new Set([
  'Arrived', 'Cancelled', 'Delayed', 'Departed', 'Departing',
  'Diverted', 'Landed', 'Last call', 'On Time', 'On time',
])

describe('SFO feed contract', () => {
  it('every remark is in the known set of ten', () => {
    const unknown = data.filter((r) => r.remark !== null && !KNOWN_REMARKS.has(r.remark))
    expect(unknown).toEqual([])
  })

  it('is_code_share is present iff original_flight is present', () => {
    const violations = data.filter(
      (r) => (r.is_code_share != null) !== (r.original_flight != null),
    )
    expect(violations).toEqual([])
  })

  it('no record is missing scheduled_in_off_block_time', () => {
    expect(data.filter((r) => !r.scheduled_in_off_block_time)).toEqual([])
  })

  it('scheduled and estimated agree across the gate/runway axes', () => {
    // The whole "gate vs runway only matters for actuals" simplification
    // rests on this invariant.
    expect(data.filter((r) => r.scheduled_aod_time !== r.scheduled_in_off_block_time)).toEqual([])
    expect(data.filter((r) => r.estimated_aod_time !== r.estimated_in_off_block_time)).toEqual([])
  })
})

describe('SFO checkins contract', () => {
  it('is exactly 168 counters mapping to 12 contiguous aisles of 14', () => {
    const dict = checkins as Record<string, string>
    const entries = Object.entries(dict)
    expect(entries).toHaveLength(168)
    const aisles = new Map<string, number>()
    for (const [, aisle] of entries) aisles.set(aisle, (aisles.get(aisle) ?? 0) + 1)
    expect(aisles.size).toBe(12)
    expect([...aisles.values()].every((n) => n === 14)).toBe(true)
  })
})

describe('full-feed normalization smoke', () => {
  it('normalizes the entire 2,650-record feed without throwing', () => {
    const flights = normalizeSfo(feed as { data: unknown[] }, checkins as Record<string, string>)
    expect(flights.length).toBe(2650 - 24) // dedupe drops the 24 exact duplicate pairs
    expect(flights.every((f) => f.status.kind !== 'other')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/lib/__tests__/contract.test.ts`
Expected: PASS on the first run (the code under test already exists). If the duplicate count differs, verify with `jq` before changing the assertion — the spec says exactly 24 pairs.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/contract.test.ts
git commit -m "test: contract test pinning SFO feed invariants"
```

---

### Task 8: TTL cache with single-flight and stale-on-error

**Files:**
- Create: `src/lib/cache.ts`
- Test: `src/lib/__tests__/cache.test.ts`

**Interfaces:**
- Consumes: `Airport` from `@/lib/types`.
- Produces (used by the API route in Task 9):

```ts
createCache<T>(fetcher: (airport: Airport) => Promise<T>): {
  get(airport: Airport, opts?: { force?: boolean }): Promise<{ value: T; fetchedAt: number; stale: boolean }>
}
```

Behavior: TTL 300 000 ms normally, 60 000 ms when `force`. Concurrent misses share one in-flight fetch. A failed fetch serves the previous value with `stale: true`, or rethrows when there is nothing cached.

- [ ] **Step 1: Write the failing tests** — `src/lib/__tests__/cache.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCache } from '@/lib/cache'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createCache', () => {
  it('serves cached data within 5 minutes and refetches after', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1')
    const cache = createCache(fetcher)
    expect((await cache.get('SFO')).value).toBe('v1')
    vi.advanceTimersByTime(4 * 60_000)
    await cache.get('SFO')
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2 * 60_000) // now 6 min old
    fetcher.mockResolvedValue('v2')
    expect((await cache.get('SFO')).value).toBe('v2')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('forceRefresh shrinks the acceptable age to 1 minute', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1')
    const cache = createCache(fetcher)
    await cache.get('SFO')
    vi.advanceTimersByTime(2 * 60_000) // 2 min old: fresh normally, stale for force
    await cache.get('SFO')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await cache.get('SFO', { force: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
    // within the 1-minute floor, force is a no-op
    vi.advanceTimersByTime(30_000)
    await cache.get('SFO', { force: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('single-flights concurrent misses', async () => {
    let release!: (v: string) => void
    const fetcher = vi.fn(() => new Promise<string>((res) => { release = res }))
    const cache = createCache(fetcher)
    const p1 = cache.get('SFO')
    const p2 = cache.get('SFO')
    release('v1')
    expect((await p1).value).toBe('v1')
    expect((await p2).value).toBe('v1')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps airports independent', async () => {
    const fetcher = vi.fn(async (a: string) => `data-${a}`)
    const cache = createCache(fetcher)
    expect((await cache.get('SFO')).value).toBe('data-SFO')
    expect((await cache.get('SJC')).value).toBe('data-SJC')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('serves stale on fetch failure, rethrows when nothing is cached', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('down'))
    const cache = createCache(fetcher)
    await expect(cache.get('SFO')).rejects.toThrow('down')
    fetcher.mockResolvedValueOnce('v1')
    const first = await cache.get('SFO')
    expect(first.stale).toBe(false)
    vi.advanceTimersByTime(6 * 60_000)
    fetcher.mockRejectedValue(new Error('down again'))
    const served = await cache.get('SFO')
    expect(served).toMatchObject({ value: 'v1', stale: true })
    // the stale response must report when the data was ORIGINALLY fetched,
    // not the failed attempt's time -- the UI prints this as "data from".
    expect(served.fetchedAt).toBe(first.fetchedAt)
  })

  it('a failed fetch clears the in-flight slot so the next call retries', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('v1')
    const cache = createCache(fetcher)
    await expect(cache.get('SFO')).rejects.toThrow('down')
    expect((await cache.get('SFO')).value).toBe('v1')
  })

  it('serves a cached undefined value as stale rather than treating it as uncached', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('down'))
    const cache = createCache(fetcher)
    const first = await cache.get('SFO')
    expect(first).toMatchObject({ value: undefined, stale: false })
    vi.advanceTimersByTime(6 * 60_000)
    const served = await cache.get('SFO')
    expect(served).toMatchObject({ value: undefined, stale: true })
  })

  it('keeps failure state independent between airports', async () => {
    let sfoDown = false
    const fetcher = vi.fn(async (a: string) => {
      if (a === 'SFO' && sfoDown) throw new Error('down')
      return `data-${a}`
    })
    const cache = createCache(fetcher)
    await cache.get('SFO')
    await cache.get('SJC')
    vi.advanceTimersByTime(6 * 60_000)
    sfoDown = true
    const sfo = await cache.get('SFO')
    const sjc = await cache.get('SJC')
    expect(sfo).toMatchObject({ value: 'data-SFO', stale: true })
    expect(sjc).toMatchObject({ value: 'data-SJC', stale: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/cache.test.ts`
Expected: FAIL — cannot resolve `@/lib/cache`.

- [ ] **Step 3: Write `src/lib/cache.ts`**

```ts
import type { Airport } from '@/lib/types'

const TTL_MS = 5 * 60_000
const FORCE_TTL_MS = 60_000

interface Entry<T> {
  value?: T
  fetchedAt?: number
  inFlight?: Promise<void>
}

/**
 * Per-airport in-memory cache. 5-minute TTL, 1-minute floor under force.
 * Concurrent misses share one upstream fetch. Failures serve the previous
 * value with stale: true, or rethrow when nothing has ever been cached.
 */
export function createCache<T>(fetcher: (airport: Airport) => Promise<T>) {
  const entries = new Map<Airport, Entry<T>>()

  async function get(
    airport: Airport,
    opts: { force?: boolean } = {},
  ): Promise<{ value: T; fetchedAt: number; stale: boolean }> {
    let entry = entries.get(airport)
    if (!entry) {
      entry = {}
      entries.set(airport, entry)
    }
    const ttl = opts.force ? FORCE_TTL_MS : TTL_MS
    if (entry.fetchedAt !== undefined && Date.now() - entry.fetchedAt < ttl) {
      return { value: entry.value!, fetchedAt: entry.fetchedAt, stale: false }
    }
    if (!entry.inFlight) {
      entry.inFlight = fetcher(airport)
        .then((value) => {
          entry.value = value
          entry.fetchedAt = Date.now()
        })
        .finally(() => {
          entry.inFlight = undefined
        })
    }
    try {
      await entry.inFlight
      return { value: entry.value!, fetchedAt: entry.fetchedAt!, stale: false }
    } catch (err) {
      if (entry.fetchedAt !== undefined) {
        return { value: entry.value!, fetchedAt: entry.fetchedAt, stale: true }
      }
      throw err
    }
  }

  return { get }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts src/lib/__tests__/cache.test.ts
git commit -m "feat: per-airport TTL cache with single-flight and stale-on-error"
```

---

### Task 9: Upstream fetchers and API routes

**Files:**
- Create: `src/lib/upstream.ts`, `src/app/api/flights/route.ts`, `src/app/api/health/route.ts`
- Test: `src/lib/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `normalizeSfo`, `normalizeSjc`, `createCache`, `windowed`, `toPtIso`, `Flight`, `FlightsResponse`.
- Produces:
  - `upstream.ts`: `fetchAirport(airport: Airport): Promise<Flight[]>` (10 s timeout per upstream call)
  - `GET /api/flights?airport=sfo|sjc[&forceRefresh=1]` → `FlightsResponse` JSON with `ETag` + `Cache-Control: no-store`; `304` on matching `If-None-Match`; `400` on bad airport; `502` when upstream fails with nothing cached
  - `GET /api/health` → `200 {"ok":true}`, touches nothing upstream

- [ ] **Step 1: Write `src/lib/upstream.ts`**

```ts
import { normalizeSfo } from '@/lib/normalize-sfo'
import { normalizeSjc } from '@/lib/normalize-sjc'
import type { Airport, Flight } from '@/lib/types'

const SFO_FLIGHTS_URL = 'https://www.flysfo.com/flysfo/api/flight-status'
const SFO_CHECKINS_URL = 'https://www.flysfo.com/flysfo/api/checkins'
const SJC_ARRIVALS_URL = 'https://www.flysanjose.com/api/flightstatus/arrivals'
const SJC_DEPARTURES_URL = 'https://www.flysanjose.com/api/flightstatus/departures'

const TIMEOUT_MS = 10_000

async function getJson(url: string): Promise<unknown> {
  // Timeout is load-bearing: a stalled upstream body would otherwise hang the
  // route handler forever and the serve-stale path would never fire.
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} responded ${res.status}`)
  return res.json()
}

export async function fetchAirport(airport: Airport): Promise<Flight[]> {
  if (airport === 'SFO') {
    const [feed, checkins] = await Promise.all([
      getJson(SFO_FLIGHTS_URL),
      getJson(SFO_CHECKINS_URL),
    ])
    return normalizeSfo(feed as { data: unknown[] }, checkins as Record<string, string>)
  }
  const [arrivals, departures] = await Promise.all([
    getJson(SJC_ARRIVALS_URL),
    getJson(SJC_DEPARTURES_URL),
  ])
  return normalizeSjc(arrivals as unknown[], departures as unknown[], new Date())
}
```

- [ ] **Step 2: Write `src/app/api/health/route.ts`**

```ts
import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Write `src/app/api/flights/route.ts`**

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { createCache } from '@/lib/cache'
import { windowed } from '@/lib/flight-view'
import { toPtIso } from '@/lib/time'
import type { Airport, FlightsResponse } from '@/lib/types'
import { fetchAirport } from '@/lib/upstream'

// Module scope: the cache lives for the lifetime of the server process.
const cache = createCache(fetchAirport)

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const airport = params.get('airport')?.toUpperCase()
  if (airport !== 'SFO' && airport !== 'SJC') {
    return NextResponse.json({ error: 'airport must be sfo or sjc' }, { status: 400 })
  }
  const force = params.get('forceRefresh') === '1'

  let result
  try {
    result = await cache.get(airport as Airport, { force })
  } catch {
    return NextResponse.json({ error: `Could not reach ${airport}` }, { status: 502 })
  }

  const etag = `"${airport}-${result.fetchedAt}"`
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store' },
    })
  }

  const body: FlightsResponse = {
    airport: airport as Airport,
    cachedAt: toPtIso(new Date(result.fetchedAt)),
    stale: result.stale,
    flights: windowed(result.value, new Date()),
  }
  return NextResponse.json(body, {
    headers: { ETag: etag, 'Cache-Control': 'no-store' },
  })
}
```

- [ ] **Step 4: Write the failing route test** — `src/lib/__tests__/route.test.ts`

The route module holds its cache at module scope, so each test re-imports it
fresh via `vi.resetModules()` + dynamic import. Upstream fetch is stubbed with
the sample payloads; `Date` is faked to the sample capture instant.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'

const sfoFeed = readFileSync('docs/samples/sfo-flight-status.json', 'utf8')
const sfoCheckins = readFileSync('docs/samples/sfo-checkins.json', 'utf8')
const sjcArrivals = readFileSync('docs/samples/sjc-arrivals.json', 'utf8')
const sjcDepartures = readFileSync('docs/samples/sjc-departures.json', 'utf8')

function stubUpstream(fail = false) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (fail) throw new Error('upstream down')
    const url = String(input)
    const body =
      url.includes('flysfo') && url.includes('flight-status') ? sfoFeed :
      url.includes('flysfo') ? sfoCheckins :
      url.includes('arrivals') ? sjcArrivals : sjcDepartures
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

async function importRoute() {
  vi.resetModules()
  return await import('@/app/api/flights/route')
}

const request = (qs: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/flights?${qs}`, { headers })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-03T16:42:00-07:00'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GET /api/flights', () => {
  it('rejects a bad airport', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    expect((await GET(request('airport=oak'))).status).toBe(400)
  })

  it('returns a windowed normalized SFO payload with cache metadata', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const res = await GET(request('airport=sfo'))
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeTruthy()
    const body = await res.json()
    expect(body.airport).toBe('SFO')
    expect(body.stale).toBe(false)
    expect(body.cachedAt).toBe('2026-08-03T16:42:00-07:00')
    expect(body.flights.length).toBeGreaterThan(1500) // windowed subset of 2,626
    expect(body.flights.length).toBeLessThan(2626)
  })

  it('serves SJC and includes both directions', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const res = await GET(request('airport=sjc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const dirs = new Set(body.flights.map((f: { direction: string }) => f.direction))
    expect(dirs).toEqual(new Set(['arrival', 'departure']))
  })

  it('answers 304 to a matching If-None-Match', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const first = await GET(request('airport=sfo'))
    const etag = first.headers.get('etag')!
    const second = await GET(request('airport=sfo', { 'if-none-match': etag }))
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
  })

  it('502s when upstream fails with nothing cached', async () => {
    stubUpstream(true)
    const { GET } = await importRoute()
    expect((await GET(request('airport=sfo'))).status).toBe(502)
  })

  it('serves stale with stale:true when upstream fails after a success', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    await GET(request('airport=sfo'))
    vi.setSystemTime(new Date('2026-08-03T16:48:00-07:00')) // TTL expired
    stubUpstream(true)
    const res = await GET(request('airport=sfo'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale).toBe(true)
    expect(body.cachedAt).toBe('2026-08-03T16:42:00-07:00')
  })

  it('forceRefresh bypasses the 5-minute TTL early, via the 1-minute force floor', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    const first = await GET(request('airport=sfo'))
    const etag = first.headers.get('etag')!

    // +90s: fresh under the 5-minute normal TTL, stale under the 1-minute force TTL.
    vi.setSystemTime(new Date('2026-08-03T16:43:30-07:00'))

    const plain = await GET(request('airport=sfo'))
    expect(plain.headers.get('etag')).toBe(etag)

    const forced = await GET(request('airport=sfo&forceRefresh=1'))
    expect(forced.headers.get('etag')).not.toBe(etag)
  })

  it('sends a timeout signal with every upstream fetch', async () => {
    stubUpstream()
    const { GET } = await importRoute()
    await GET(request('airport=sfo'))
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('GET /api/health', () => {
  it('returns ok without touching upstream', async () => {
    stubUpstream(true) // even a dead upstream must not matter
    vi.resetModules()
    const { GET } = await import('@/app/api/health/route')
    const res = GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/__tests__/route.test.ts`
Expected: PASS (implementation was written in Steps 1–3; failures here mean the route or a normalizer is wrong, not the test). The windowed-count bounds are deliberately loose — exact counts live in the contract test.

- [ ] **Step 6: Verify against the real airports once, manually**

Run: `npm run dev` then `curl -s 'http://localhost:3000/api/flights?airport=sjc' | head -c 400` and `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' 'http://localhost:3000/api/flights?airport=sfo'`
Expected: real JSON from both airports, SFO body well under 1 MB (windowed, no `original_flight` bloat). Then `curl -s localhost:3000/api/health` → `{"ok":true}`. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/lib/upstream.ts src/app/api src/lib/__tests__/route.test.ts
git commit -m "feat: /api/flights with ETag/304 and /api/health"
```

---

### Task 10: URL state codec

**Files:**
- Create: `src/lib/url-state.ts`
- Test: `src/lib/__tests__/url-state.test.ts`

**Interfaces:**
- Consumes: `Airport`, `Direction` from `@/lib/types`; `SortKey` from `@/lib/flight-view`.
- Produces (used by the page in Tasks 11–12):

```ts
interface ViewState {
  airport: Airport            // default 'SFO'
  dir: Direction              // default 'departure'   (URL value: departures|arrivals)
  q: string                   // default ''
  airline: string             // default '' = All
  terminal: string            // default '' = All
  location: string            // default '' = All (holds cityCode ?? city)
  hideCodeshares: boolean     // default false          (URL value: 1)
  sort: { key: SortKey; asc: boolean }  // default { key: 'est', asc: true } (URL: est.asc)
}
DEFAULT_VIEW: ViewState
parseView(params: URLSearchParams): ViewState        // tolerant of garbage → defaults
serializeView(v: ViewState): string                  // omits defaults; '' when all default
```

- [ ] **Step 1: Write the failing tests** — `src/lib/__tests__/url-state.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, parseView, serializeView } from '@/lib/url-state'

describe('parseView', () => {
  it('returns defaults for an empty query', () => {
    expect(parseView(new URLSearchParams(''))).toEqual(DEFAULT_VIEW)
  })
  it('parses a fully specified query', () => {
    const v = parseView(new URLSearchParams(
      'airport=SJC&dir=arrivals&q=1260&airline=Delta&terminal=A&location=SLC&hideCodeshares=1&sort=sched.desc',
    ))
    expect(v).toEqual({
      airport: 'SJC', dir: 'arrival', q: '1260', airline: 'Delta',
      terminal: 'A', location: 'SLC', hideCodeshares: true,
      sort: { key: 'sched', asc: false },
    })
  })
  it('falls back to defaults on garbage values', () => {
    const v = parseView(new URLSearchParams('airport=LAX&dir=sideways&sort=nope.upward'))
    expect(v).toEqual(DEFAULT_VIEW)
  })
  it('treats a valid sort key with a nonsense direction as ascending', () => {
    const v = parseView(new URLSearchParams('sort=sched.upward'))
    expect(v.sort).toEqual({ key: 'sched', asc: true })
  })
  it('treats a dotless sort value as ascending', () => {
    const v = parseView(new URLSearchParams('sort=sched'))
    expect(v.sort).toEqual({ key: 'sched', asc: true })
  })
})

describe('serializeView', () => {
  it('serializes all-defaults to an empty string', () => {
    expect(serializeView(DEFAULT_VIEW)).toBe('')
  })
  it('omits defaults and writes the rest', () => {
    const qs = serializeView({
      ...DEFAULT_VIEW, airport: 'SJC', q: '29', sort: { key: 'sched', asc: false },
    })
    expect(qs).toBe('airport=SJC&q=29&sort=sched.desc')
  })
  it('round-trips', () => {
    const v = {
      ...DEFAULT_VIEW, dir: 'arrival' as const, airline: 'Alaska Airlines',
      hideCodeshares: true,
    }
    expect(parseView(new URLSearchParams(serializeView(v)))).toEqual(v)
  })
  it('round-trips every field at once', () => {
    const v = {
      airport: 'SJC' as const, dir: 'arrival' as const, q: '1260',
      airline: 'Delta', terminal: 'A', location: 'SLC', hideCodeshares: true,
      sort: { key: 'gate' as const, asc: false },
    }
    expect(parseView(new URLSearchParams(serializeView(v)))).toEqual(v)
  })
  it('round-trips a non-default asc on the default sort key', () => {
    const v = { ...DEFAULT_VIEW, sort: { key: 'est' as const, asc: false } }
    expect(parseView(new URLSearchParams(serializeView(v)))).toEqual(v)
  })
  it('round-trips URL-hazardous characters in airline, location, and free text', () => {
    const v = {
      ...DEFAULT_VIEW,
      q: 'A&B=C',
      airline: 'ANA (All Nippon Airways)',
      location: 'Seattle/Tacoma, WA',
    }
    expect(parseView(new URLSearchParams(serializeView(v)))).toEqual(v)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/url-state.test.ts`
Expected: FAIL — cannot resolve `@/lib/url-state`.

- [ ] **Step 3: Write `src/lib/url-state.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/url-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/url-state.ts src/lib/__tests__/url-state.test.ts
git commit -m "feat: URL view-state codec with default omission"
```

---

### Task 11: Data hook and header (page shell)

Frontend tasks carry no unit tests (the spec's test scope is lib + route); each
ends with typecheck, full test run, and a manual dev-server check.

**Files:**
- Create: `src/hooks/useFlights.ts`, `src/components/Header.tsx`
- Modify: `src/app/page.tsx` (placeholder → shell that proves the plumbing)

**Interfaces:**
- Consumes: `FlightsResponse`, `Airport` from `@/lib/types`; `formatTimePT` from `@/lib/time`.
- Produces:
  - `useFlights(airport: Airport): { data: FlightsResponse | null; updatedAt: Date | null; fetchFailed: boolean; flash: string | null; refreshing: boolean; refresh: () => void }`
  - `<Header airport onAirportChange updatedAt cachedAt flash refreshing onForceRefresh />`

- [ ] **Step 1: Write `src/hooks/useFlights.ts`**

Behavior (spec §Refresh behavior): fetch on mount and on airport change; refetch
60 s after each completed load (timer restarts on manual refresh); skip ticks
while the tab is hidden and fire once on re-show; send `If-None-Match`, treat
304 as "Updated moves, data unchanged"; force refresh flashes "Already up to
date" when `cachedAt` did not change.

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Airport, FlightsResponse } from '@/lib/types'

const POLL_MS = 60_000
const FLASH_MS = 3_000

export function useFlights(airport: Airport) {
  const [data, setData] = useState<FlightsResponse | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const etagRef = useRef<string | null>(null)
  const cachedAtRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flashRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const loadRef = useRef<(force?: boolean) => void>(() => {})
  // Bumped at the start of every load() and on every airport switch. A load
  // only applies its result if its captured generation still matches when it
  // resolves — otherwise it mutates nothing. This is what stops a slow
  // response for an airport the user has since switched away from (or a slow
  // poll overtaken by a faster forced refresh) from clobbering newer state.
  // Do not delete this as ceremony: without it, a fetch in flight during an
  // airport switch can land later and silently overwrite the screen with the
  // wrong airport's flights.
  const generationRef = useRef(0)

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    clearTimeout(flashRef.current)
    flashRef.current = setTimeout(() => setFlash(null), FLASH_MS)
  }, [])

  const load = useCallback(async (force = false) => {
    const gen = ++generationRef.current
    clearTimeout(pollRef.current)
    if (force) setRefreshing(true)
    try {
      const headers: HeadersInit = etagRef.current
        ? { 'If-None-Match': etagRef.current }
        : {}
      const res = await fetch(
        `/api/flights?airport=${airport.toLowerCase()}${force ? '&forceRefresh=1' : ''}`,
        { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) },
      )
      if (gen !== generationRef.current) return
      if (res.status === 304) {
        setUpdatedAt(new Date())
        setFetchFailed(false)
        if (force) showFlash('Already up to date')
      } else if (res.ok) {
        const body: FlightsResponse = await res.json()
        if (gen !== generationRef.current) return
        if (force && cachedAtRef.current === body.cachedAt) showFlash('Already up to date')
        etagRef.current = res.headers.get('etag')
        cachedAtRef.current = body.cachedAt
        setData(body)
        setUpdatedAt(new Date())
        setFetchFailed(false)
      } else {
        setFetchFailed(true)
      }
    } catch {
      if (gen !== generationRef.current) return
      setFetchFailed(true)
    } finally {
      if (gen === generationRef.current) {
        setRefreshing(false)
        // Restart the countdown AFTER the load completes, so a manual refresh
        // resets the timer. Hidden tabs skip the fetch and re-arm the timer.
        schedule()
      }
    }
  }, [airport, showFlash])

  function schedule() {
    clearTimeout(pollRef.current)
    pollRef.current = setTimeout(() => {
      if (document.visibilityState === 'hidden') schedule()
      else loadRef.current()
    }, POLL_MS)
  }

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    generationRef.current++
    setData(null)
    setUpdatedAt(null)
    setFetchFailed(false)
    setFlash(null)
    etagRef.current = null
    cachedAtRef.current = null
    load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      // Bump first: invalidates any load still in flight so its `finally`
      // cannot call schedule() after we've just cleared the timer below,
      // which would otherwise arm an orphan poller with no live component
      // (or, on airport switch, for the airport we're leaving).
      generationRef.current++
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(pollRef.current)
      clearTimeout(flashRef.current)
    }
  }, [load])

  return { data, updatedAt, fetchFailed, flash, refreshing, refresh: () => loadRef.current(true) }
}
```

(`schedule` is a function declaration below its first use in `load` — hoisting
makes that legal, and keeping `load` first keeps the file readable.)

`generationRef` exists to close a real race, found and reproduced during
implementation: without it, a fetch left in flight when the user switches
airports (or a slow 60s poll overtaken by a faster forced refresh) can resolve
afterward and overwrite state with the wrong airport's flights — a volunteer
would see the wrong airport's board. A `generationRef` counter, bumped on
every `load()` call and on every airport switch, catches both cases with one
mechanism (an `AbortController` scoped to the effect would only catch the
airport-switch case); every state mutation in `load` is guarded by a check
that the load's captured generation still matches before it runs.

Three follow-up robustness fixes found on review, folded into the same hook:

- **`setFlash(null)` in the reset block.** The reset block already cleared
  `data`/`updatedAt`/`fetchFailed`/the etag and cachedAt refs on airport
  change, and the effect cleanup clears the flash *timer* — but nothing
  cleared the flash *state* itself. Without this line, force-refreshing (which
  flashes "Already up to date") and then switching airports within the 3s
  flash window cancels the timer that would have cleared it, leaving the
  message pinned under the new airport's header indefinitely — and since nothing
  but a future `showFlash` call clears it, and the fresh-data path deliberately
  doesn't call `showFlash`, the user can end up seeing "Already up to date" at
  the exact moment genuinely new data arrives.
- **`generationRef.current++` as the first statement of the effect cleanup.**
  Without this, a load still in flight at unmount (or airport switch) settles
  with a *matching* generation, runs its `finally`, and calls `schedule()`
  after the cleanup has already cleared the timer — arming an orphan poller
  that keeps fetching with no live component behind it. Bumping generation in
  cleanup invalidates such a load before its `finally` runs, so it can never
  reschedule. Makes the mental model uniform: teardown invalidates in-flight
  loads, matching how an airport switch already invalidates them.
- **`fetch` now passes `signal: AbortSignal.timeout(15_000)`.** Without a
  timeout, a hung request (as opposed to one that errors) never reaches
  `catch` or `finally`, so it never reschedules — silently stopping all
  polling for the rest of a shift. A 15s timeout routes a hang through the
  existing `catch` block (which already sets `fetchFailed` and, via
  `finally`, reschedules) instead of hanging forever.

Also: `loadRef.current = load` moved out of the render body into its own
`useEffect(() => { loadRef.current = load })` (no deps, runs after every
render). Assigning a ref during render is undefined behavior under React's
rules even though it's harmless today (no transitions or suspending children
in this app to discard a render after it wrote the ref) — one concurrent
feature away from reintroducing the exact wrong-airport-under-the-wrong-tab
symptom the generation ref exists to prevent, and the generation ref does not
cover this path since it's a ref write, not a `load()` state mutation.

- [ ] **Step 2: Write `src/components/Header.tsx`**

```tsx
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
            type="button"
            aria-pressed={a === airport}
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
```

`type="button"` and `aria-pressed={a === airport}` on the segmented buttons:
the pair conveys which airport is selected to assistive tech, since the
selected/unselected states otherwise differ by background color alone.
Visual layout is unchanged — approved from a mockup — so nothing else in
`Header.tsx` moved.

- [ ] **Step 3: Wire a temporary shell in `src/app/page.tsx`**

```tsx
'use client'

import { Suspense, useState } from 'react'
import { Header } from '@/components/Header'
import { useFlights } from '@/hooks/useFlights'
import type { Airport } from '@/lib/types'

function Shell() {
  const [airport, setAirport] = useState<Airport>('SFO')
  const { data, updatedAt, fetchFailed, flash, refreshing, refresh } = useFlights(airport)
  return (
    <main className="mx-auto max-w-7xl p-4">
      <Header
        airport={airport}
        onAirportChange={setAirport}
        updatedAt={updatedAt}
        cachedAt={data?.cachedAt ?? null}
        flash={flash}
        refreshing={refreshing}
        onForceRefresh={refresh}
      />
      {fetchFailed && <p className="mt-4 text-red-700">Fetch failed.</p>}
      <p className="mt-4 text-sm">{data ? `${data.flights.length} flights loaded` : 'Loading…'}</p>
    </main>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Shell />
    </Suspense>
  )
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run && npm run dev`
Manual check at `http://localhost:3000`:
- Flight count appears for SFO; switching to SJC reloads and shows a smaller count.
- "Updated" and "Server data from" both populate; clicking **⟳ Force refresh** twice within a minute flashes "Already up to date" and moves only "Updated".
Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFlights.ts src/components/Header.tsx src/app/page.tsx
git commit -m "feat: polling data hook with ETag/visibility handling and header"
```

---

### Task 12: Full dashboard UI — table, filters, pills, URL wiring

**Files:**
- Create: `src/components/StatusPill.tsx`, `src/components/FlightTable.tsx`, `src/components/FilterBar.tsx`
- Modify: `src/app/page.tsx` (shell → full dashboard)

**Interfaces:**
- Consumes: everything above — `ViewState`/`parseView`/`serializeView`, `compareFlights`/`matchesQuery`/`SortKey`, `useFlights`, `Header`, `formatTimePT`/`isNextDayPT`, `Flight`.
- Produces: the finished page. Reference the approved mockups (`.superpowers/brainstorm/*/content/header-layout-v3.html`) and `docs/screenshots/` for look-and-feel; Tailwind approximations are fine — layout and behavior are what matter.

- [ ] **Step 1: Write `src/components/StatusPill.tsx`**

Pills show the **kind only** — never the embedded time (spec §Layout).

```tsx
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
```

- [ ] **Step 2: Write `src/components/FlightTable.tsx`**

Columns (spec §Layout): departures `Airline · To · Flight · Sched · Est · Status
· Term · Gate · Check-in`; arrivals swap To→From and Check-in→Baggage. Next-day
marker `⁺¹` is per cell. Sorting: click cycles asc → desc.

```tsx
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
    <table className="w-full min-w-[720px] border-collapse text-sm">
      <thead>
        <tr className="bg-indigo-950 text-left text-white">
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              aria-sort={sort.key === c.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              className="whitespace-nowrap px-2.5 py-2 font-semibold"
            >
              <button onClick={() => onSort(c.key)} className="inline-flex items-center gap-1">
                {c.label}
                <span aria-hidden="true" className="text-[0.6em] opacity-80">
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
```

- [ ] **Step 3: Write `src/components/FilterBar.tsx`**

Dropdown options come from the loaded data (never a zero-result value for a
single filter). Exclude-codeshares is disabled at SJC.

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { Direction, Flight } from '@/lib/types'
import type { ViewState } from '@/lib/url-state'

interface FilterBarProps {
  view: ViewState
  flights: Flight[] // current airport + direction, pre-filter (for options)
  onChange: (patch: Partial<ViewState>) => void
  onReset: () => void
}

// The URL round-trip (router.replace → new searchParams → new view) is
// asynchronous, so a search box wired straight to `view.q` can drop or
// revert keystrokes typed faster than that commit. Debouncing the URL write
// keeps the DOM input authoritative for display while typing.
const SEARCH_DEBOUNCE_MS = 275

function options(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort()
}

/**
 * A filter value can survive a direction switch (e.g. an airline that only
 * ever departs, a terminal used one-way) even though the options derived
 * from the new direction's flights no longer include it. A controlled
 * <select value="X"> with no matching <option> renders as a blank control
 * (selectedIndex -1), not "All" — so the active value is always kept in its
 * own option list rather than auto-cleared.
 */
function withActive(values: string[], active: string): string[] {
  if (!active || values.includes(active)) return values
  return [...values, active].sort()
}

export function FilterBar({ view, flights, onChange, onReset }: FilterBarProps) {
  const airlines = withActive(options(flights.map((f) => f.airline)), view.airline)
  const terminals = withActive(options(flights.map((f) => f.terminal)), view.terminal)
  const locationPairs = new Map(flights.map((f) => [f.cityCode ?? f.city, f.city]))
  if (view.location && !locationPairs.has(view.location)) {
    // No flight in the current direction names this location anymore; fall
    // back to the raw value itself so the select still shows *something*
    // rather than going blank.
    locationPairs.set(view.location, view.location)
  }
  const locations = [...locationPairs.entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const dirs: Array<{ value: Direction; label: string }> = [
    { value: 'departure', label: 'Departures' },
    { value: 'arrival', label: 'Arrivals' },
  ]
  const select = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm'

  // Local echo of the search box so keystrokes render immediately; mirrored
  // to the URL on a debounce instead of on every keystroke. `lastSent` is
  // set the moment a write is *scheduled* (not when it lands) so it always
  // reflects "the value the URL should end up holding" — that's what makes
  // it possible to tell an external change to `view.q` (Reset, browser
  // back/forward, a pasted URL) apart from our own debounced write landing.
  // Updating it only when the timeout fires would miss the case where an
  // external reset happens to land on the same value the box started with
  // (e.g. both ''), which would otherwise leave the stale timeout armed to
  // fire later and clobber the reset.
  const [q, setQ] = useState(view.q)
  const lastSent = useRef(view.q)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (view.q !== lastSent.current) {
      // The change came from outside our own debounce (notably Reset) —
      // cancel any pending write so it can't fire later and clobber it.
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      lastSent.current = view.q
      setQ(view.q)
    }
  }, [view.q])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  function handleQueryChange(next: string) {
    setQ(next)
    lastSent.current = next
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      onChange({ q: next })
    }, SEARCH_DEBOUNCE_MS)
  }

  function handleReset() {
    // Reset can land on a URL that's identical to the current one (e.g. the
    // debounced write for the current keystroke hasn't committed yet, so
    // `view.q` is still '' — same as DEFAULT_VIEW.q). When that happens
    // `router.replace` is a no-op and `view.q` never changes, so the effect
    // above — which only reacts to a `view.q` prop change — would never see
    // it and the stale timeout would survive to fire later and clobber the
    // reset. Cancelling it here, synchronously, doesn't depend on the URL
    // actually changing.
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    lastSent.current = ''
    setQ('')
    onReset()
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5">
      <div className="inline-flex overflow-hidden rounded-md border-2 border-indigo-950 text-sm font-bold">
        {dirs.map((d) => (
          <button
            key={d.value}
            onClick={() => onChange({ dir: d.value })}
            className={`px-4 py-1.5 ${view.dir === d.value ? 'bg-indigo-950 text-white' : 'bg-white text-indigo-950'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Flight #, airline, or city…"
        className={`${select} min-w-44 flex-1`}
      />
      <select value={view.airline} onChange={(e) => onChange({ airline: e.target.value })} className={select}>
        <option value="">Airline: All</option>
        {airlines.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={view.terminal} onChange={(e) => onChange({ terminal: e.target.value })} className={select}>
        <option value="">Terminal: All</option>
        {terminals.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={view.location} onChange={(e) => onChange({ location: e.target.value })} className={select}>
        <option value="">Location: All</option>
        {locations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className={`flex items-center gap-1.5 text-sm ${view.airport === 'SJC' ? 'text-slate-400' : 'text-slate-700'}`}>
        <input
          type="checkbox"
          checked={view.hideCodeshares && view.airport !== 'SJC'}
          disabled={view.airport === 'SJC'}
          onChange={(e) => onChange({ hideCodeshares: e.target.checked })}
        />
        Exclude codeshares
      </label>
      <button onClick={handleReset} className={`${select} hover:bg-slate-100`}>Reset</button>
    </div>
  )
}
```

> **Updated by the Task 12 fix pass (2026-08-04):** the search box now holds
> local `useState` (debounced 275ms into the URL) instead of reading
> `view.q` directly, since the router round-trip could drop or revert
> keystrokes typed faster than it commits; the dropdown options are widened
> to include the active `airline`/`terminal`/`location` value even when the
> current direction's flights don't produce it (so a controlled `<select>`
> never renders blank); and the codeshare checkbox is gated to
> `view.hideCodeshares && view.airport !== 'SJC'` so it can't render checked
> at SJC. See `task-12-report.md` for the full rationale, including a
> caught-and-fixed race where Reset landing on a URL identical to the
> current one left a stale debounced write able to fire later and clobber
> the reset.

- [ ] **Step 4: Rewrite `src/app/page.tsx` as the full dashboard**

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { FilterBar } from '@/components/FilterBar'
import { FlightTable } from '@/components/FlightTable'
import { Header } from '@/components/Header'
import { useFlights } from '@/hooks/useFlights'
import { compareFlights, matchesQuery } from '@/lib/flight-view'
import { formatTimePT } from '@/lib/time'
import { DEFAULT_VIEW, parseView, serializeView, type ViewState } from '@/lib/url-state'

function Dashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = useMemo(() => parseView(new URLSearchParams(searchParams)), [searchParams])
  const { data, updatedAt, fetchFailed, flash, refreshing, refresh } = useFlights(view.airport)

  const setView = (patch: Partial<ViewState>) => {
    let next = { ...view, ...patch }
    // Airport switch clears the data-derived dropdowns; dir/sort/q/codeshares survive.
    if (patch.airport && patch.airport !== view.airport) {
      next = { ...next, airline: '', terminal: '', location: '' }
    }
    const qs = serializeView(next)
    router.replace(qs ? `?${qs}` : '/', { scroll: false })
  }

  const directional = useMemo(
    () => (data?.flights ?? []).filter((f) => f.direction === view.dir),
    [data, view.dir],
  )
  const visible = useMemo(() => {
    const filtered = directional.filter((f) =>
      (!view.hideCodeshares || !f.isCodeshare) &&
      (!view.airline || f.airline === view.airline) &&
      (!view.terminal || f.terminal === view.terminal) &&
      (!view.location || (f.cityCode ?? f.city) === view.location) &&
      matchesQuery(f, view.q),
    )
    const sorted = [...filtered].sort((a, b) => compareFlights(a, b, view.sort.key))
    return view.sort.asc ? sorted : sorted.reverse()
  }, [directional, view])

  const onSort = (key: ViewState['sort']['key']) =>
    setView({ sort: { key, asc: view.sort.key === key ? !view.sort.asc : true } })

  const emptyMessage = data?.stale
    ? `${view.airport} is unreachable and the cached data has aged out of the window — this may not mean there are no flights.`
    : 'No flights match the current filters and time window.'

  return (
    <main className="mx-auto max-w-7xl p-4">
      <Header
        airport={view.airport}
        onAirportChange={(airport) => setView({ airport })}
        updatedAt={updatedAt}
        cachedAt={data?.cachedAt ?? null}
        flash={flash}
        refreshing={refreshing}
        onForceRefresh={refresh}
      />
      {data?.stale && (
        <p className="mt-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Couldn&apos;t reach {view.airport} — showing data from {formatTimePT(data.cachedAt)}.
        </p>
      )}
      {fetchFailed && data && (
        <p className="mt-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Last refresh failed — retrying every minute.
        </p>
      )}
      {fetchFailed && !data ? (
        <div className="mt-16 text-center">
          <p className="text-slate-600">Couldn&apos;t load flight data.</p>
          <button
            onClick={() => refresh()}
            className="mt-3 rounded-md bg-indigo-950 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <FilterBar
            view={view}
            flights={directional}
            onChange={setView}
            onReset={() => setView({ ...DEFAULT_VIEW, airport: view.airport, dir: view.dir })}
          />
          <div className="mt-3 overflow-x-auto">
            {data ? (
              <FlightTable
                flights={visible}
                direction={view.dir}
                sort={view.sort}
                onSort={onSort}
                emptyMessage={emptyMessage}
              />
            ) : (
              <p className="py-16 text-center text-slate-500">Loading…</p>
            )}
          </div>
        </>
      )}
    </main>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  )
}
```

- [ ] **Step 5: Verify the full behavior manually**

Run: `npm run typecheck && npx vitest run && npm run build && npm run dev`

Checklist at `http://localhost:3000` (compare against `docs/screenshots/` and the spec):
- Default view: SFO departures sorted by Est ascending; URL bar is bare `/`.
- Toggle each filter and confirm the URL updates and a hard reload restores the exact view.
- Search `29` → flight numbers starting with 29 only; search an SFO marketing number from a visible "Operated by" row → its codeshare row appears.
- Codeshare rows show "Operated by …"; the Exclude-codeshares box hides them; the box is greyed out on SJC.
- SFO arrivals: Baggage shows `Carousel N` with the 1st/last-bag sub-line where present; SFO departures: Check-in shows `Aisle(s) …` only for INTL rows, `—` elsewhere.
- Header sort arrows cycle asc/desc and land in the URL (`?sort=…`); Est-sort interleaves rows lacking estimates by their scheduled time.
- Late-evening rows show `+1` markers on next-day cells (visible in the sample data around midnight).
- Switch airport: airline/terminal/location dropdowns reset; dir, query, sort survive.
Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components src/app/page.tsx
git commit -m "feat: full dashboard UI with URL-driven filters, sorting, and states"
```

---

### Task 13: Dockerfile

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: the standalone Next build (`output: 'standalone'` from Task 1).
- Produces: an image that runs on port 3000 with a `/api/health` healthcheck — what the CI workflow (Task 14) builds and pushes.

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
.next
.git
docs
tests
scripts
.superpowers
*.md
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
# tzdata: belt-and-braces for America/Los_Angeles handling in the runtime image.
RUN apk add --no-cache tzdata
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
# wget ships with busybox — no extra package needed. Probe /api/health only:
# probing /api/flights would pull 14.3 MB from flysfo on every check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
```

If `public/` does not exist (nothing was ever put there), create it with a
`.gitkeep` so the `COPY` succeeds: `mkdir -p public && touch public/.gitkeep`.

- [ ] **Step 3: Build and verify locally**

```bash
docker build -t flight-status:dev .
docker run -d --name fs-test -p 3000:3000 flight-status:dev
sleep 3
curl -s localhost:3000/api/health
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:3000/api/flights?airport=sjc'
# Timezone must be correct INSIDE the container — the board is silently wrong
# by seven hours if this breaks:
docker exec fs-test node -e '
  const s = new Date("2026-08-03T23:42:00Z").toLocaleTimeString("en-US",
    { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
  if (s !== "4:42 PM") { console.error("TZ broken:", s); process.exit(1) }
  console.log("TZ ok:", s)'
docker rm -f fs-test
```

Expected: `{"ok":true}`, `200`, `TZ ok: 4:42 PM`.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore public/.gitkeep
git commit -m "feat: multi-stage Dockerfile with health check"
```

---

### Task 14: GitHub Actions workflow and README

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: the Dockerfile (Task 13), `npm run typecheck` / `npx vitest run` (all earlier tasks).
- Produces: on every push to `main` — tests, then multi-arch images at `ghcr.io/iltc/flight-status:latest` and `:sha-<commit>`. Native runners per arch; **no QEMU** (spec §Deployment — emulation turns a two-minute build into twenty).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

env:
  IMAGE: ghcr.io/iltc/flight-status  # username lowercased — GHCR rejects "iLtc"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npx vitest run

  build:
    needs: test
    strategy:
      matrix:
        include:
          - arch: amd64
            runner: ubuntu-latest
          - arch: arm64
            runner: ubuntu-24.04-arm
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push by digest
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/${{ matrix.arch }}
          outputs: type=image,name=${{ env.IMAGE }},push-by-digest=true,name-canonical=true,push=true
      - name: Assert container timezone handling
        run: |
          docker run --rm ${{ env.IMAGE }}@${{ steps.build.outputs.digest }} node -e '
            const s = new Date("2026-08-03T23:42:00Z").toLocaleTimeString("en-US",
              { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
            if (s !== "4:42 PM") { console.error("TZ broken:", s); process.exit(1) }
            console.log("TZ ok:", s)'
      - name: Export digest
        run: |
          mkdir -p /tmp/digests
          digest="${{ steps.build.outputs.digest }}"
          touch "/tmp/digests/${digest#sha256:}"
      - uses: actions/upload-artifact@v4
        with:
          name: digest-${{ matrix.arch }}
          path: /tmp/digests/*
          if-no-files-found: error

  manifest:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: /tmp/digests
          pattern: digest-*
          merge-multiple: true
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Create multi-arch manifest
        working-directory: /tmp/digests
        run: |
          docker buildx imagetools create \
            -t ${{ env.IMAGE }}:latest \
            -t ${{ env.IMAGE }}:sha-${{ github.sha }} \
            $(printf '${{ env.IMAGE }}@sha256:%s ' *)
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Flight Status — SFO + SJC

One dashboard for SFO's and SJC's public flight-status feeds, for airport
volunteers answering passenger questions. One normalized table, the same
filters at both airports, all view state in the URL.

Design docs: `docs/superpowers/specs/`, glossary in `docs/CONTEXT.md`,
decisions in `docs/adr/`.

## Develop

    npm install
    npm run dev          # http://localhost:3000
    npx vitest run       # tests
    npm run typecheck

## Deploy

Every push to `main` publishes `ghcr.io/iltc/flight-status:latest`
(amd64 + arm64). On the server:

    docker pull ghcr.io/iltc/flight-status:latest
    docker run -d --name flight-status -p 3000:3000 \
      --restart unless-stopped ghcr.io/iltc/flight-status:latest

## API

- `GET /api/flights?airport=sfo|sjc[&forceRefresh=1]` — normalized, windowed
  (−1 h to +8 h) flights for one airport. Server cache: 5 min (1 min under
  forceRefresh). Supports `If-None-Match`/304.
- `GET /api/health` — liveness probe; touches nothing upstream.
```

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run && npm run typecheck` one last time locally.

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: multi-arch GHCR build on native runners; README"
```

- [ ] **Step 4: Push and watch CI**

```bash
git push origin main
gh run watch
```

Expected: `test` job green, both `build` jobs green (TZ assertion passes),
`manifest` job green. Then `docker pull ghcr.io/iltc/flight-status:latest`
works from any machine. If `ubuntu-24.04-arm` is queued forever, the repo is
private — confirm with the user before switching approaches (spec assumes a
public repo).

---

## Execution notes

- Task order is dependency order; do not reorder. Tasks 1–10 are fully
  test-driven; 11–12 are manual-verification UI tasks; 13–14 are
  infrastructure.
- `docs/samples/*.json` are immutable reference data — never regenerate or
  edit them. `tests/fixtures/sfo-curated.json` is generated once by
  `scripts/extract-fixtures.mjs` and then committed; CI never runs the
  extractor.
- When a test disagrees with the sample data, the sample data wins: inspect
  with `jq` before changing either the test or the normalizer. The spec's
  fixture table (§Testing) states the intended outcome per record.
- Full suite must stay green at every commit: `npx vitest run && npm run typecheck`.

