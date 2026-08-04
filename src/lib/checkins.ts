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
