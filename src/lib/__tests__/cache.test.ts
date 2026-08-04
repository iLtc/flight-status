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
