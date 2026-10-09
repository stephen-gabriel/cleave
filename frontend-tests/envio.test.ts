import { afterEach, expect, it, vi } from 'vitest'
import { fetchQuery, queries } from '../src/data/envio'
import { createEnvioStore } from '../src/data/envioStore'

const address = '0x00000000000000000000000000000000000000Aa'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('normalizes addresses, bounds queries and keeps exact token quantities', async () => {
  const amount = '123456789012345678901234567890'
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { Swap: [{ amountQuote: amount }] } }) })
  vi.stubGlobal('fetch', fetch)
  const q = queries.swaps(address, 9999)
  const rows = await fetchQuery('https://example.test/graphql', q)
  expect(rows[0].amountQuote).toBe(amount)
  expect(q.variables).toMatchObject({ chain: 10143, pool: address.toLowerCase(), limit: 200 })
  const options = fetch.mock.calls[0][1]
  expect(JSON.parse(options.body).variables.pool).toBe(address.toLowerCase())
  expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
  expect(() => queries.history('invalid')).toThrow('Invalid')
})

it('treats GraphQL errors, missing fields and HTTP errors as failures', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ProtocolStats: [] }, errors: [{ message: 'private server details' }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    .mockResolvedValueOnce({ ok: false, status: 429 })
  vi.stubGlobal('fetch', fetch)
  await expect(fetchQuery('test', queries.stats())).rejects.toThrow('Indexer query failed')
  await expect(fetchQuery('test', queries.stats())).rejects.toThrow('incomplete')
  await expect(fetchQuery('test', queries.stats())).rejects.toThrow('HTTP 429')
})

it('shares a single poll for identical queries and stops after the last subscriber', async () => {
  vi.useFakeTimers()
  const load = vi.fn().mockResolvedValue([])
  const store = createEnvioStore('test', load)
  const q = queries.stats()
  const stop1 = store.subscribe(q, vi.fn())
  const stop2 = store.subscribe(queries.stats(), vi.fn())
  await vi.advanceTimersByTimeAsync(0)
  expect(load).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(3000)
  expect(load).toHaveBeenCalledTimes(2)
  stop1()
  await vi.advanceTimersByTimeAsync(3000)
  expect(load).toHaveBeenCalledTimes(3)
  stop2()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(load).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
})

it('retains stale data, backs off on failure and recovers', async () => {
  vi.useFakeTimers()
  const rows = [{ id: 'global', totalSplit: '100' }]
  const load = vi.fn().mockResolvedValueOnce(rows).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
  const store = createEnvioStore('test', load)
  const q = queries.stats()
  const stop = store.subscribe(q, vi.fn())
  await vi.advanceTimersByTimeAsync(0)
  expect(store.snapshot(q).status).toBe('ready')
  await vi.advanceTimersByTimeAsync(3000)
  expect(store.snapshot(q)).toMatchObject({ status: 'stale', data: rows })
  await vi.advanceTimersByTimeAsync(5999)
  expect(load).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(store.snapshot(q)).toMatchObject({ status: 'ready', error: null, data: [] })
  stop()
})

it('makes no request when no endpoint is configured', async () => {
  vi.useFakeTimers()
  const load = vi.fn()
  const store = createEnvioStore(undefined, load)
  const q = queries.activity()
  const stop = store.subscribe(q, vi.fn())
  await vi.advanceTimersByTimeAsync(30_000)
  expect(load).not.toHaveBeenCalled()
  expect(store.snapshot(q).status).toBe('unconfigured')
  stop()
})

it('aborts timed-out requests and never overlaps requests for different queries', async () => {
  vi.useFakeTimers()
  let active = 0
  let peak = 0
  const load = vi.fn((_url, _query, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
    active++; peak = Math.max(peak, active)
    signal?.addEventListener('abort', () => { active--; reject(new Error('aborted')) })
  }))
  const store = createEnvioStore('test', load)
  const stop1 = store.subscribe(queries.stats(), vi.fn())
  const stop2 = store.subscribe(queries.activity(), vi.fn())
  await vi.advanceTimersByTimeAsync(10_000)
  expect(peak).toBe(1)
  expect(load).toHaveBeenCalledTimes(2)
  stop1(); stop2()
  await vi.advanceTimersByTimeAsync(0)
  expect(active).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects numeric responses that have already lost token precision', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ProtocolStats: [{ totalSplit: 1e18 }] } }) }))
  await expect(fetchQuery('test', queries.stats())).rejects.toThrow('decimal strings')
})
