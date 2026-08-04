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
