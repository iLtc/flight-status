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
