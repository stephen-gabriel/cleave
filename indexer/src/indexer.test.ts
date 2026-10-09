import { describe, expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import deployment from '../../deployments/monad-testnet.json'
import { walletClassifier } from './simulation'

const E = 10n ** 18n
const organic = '0x00000000000000000000000000000000000000bb' as const
const sim = '0x00000000000000000000000000000000000000aa' as const
const pricePool = deployment.contracts.poolPrice.address.toLowerCase() as `0x${string}`
const divPool = deployment.contracts.poolDiv.address.toLowerCase() as `0x${string}`
const block = { number: 70_000_000, timestamp: 7200 }
const transaction = { hash: `0x${'1'.repeat(64)}`, from: organic }
const meta = { block, transaction }
type Simulate = NonNullable<NonNullable<Parameters<ReturnType<typeof createTestIndexer>['process']>[0]['chains'][10143]>['simulate']>
const process = (indexer: ReturnType<typeof createTestIndexer>, simulate: Simulate) => indexer.process({ chains: { 10143: { simulate } } })

const split = (user = organic, amount = 100n * E) => ({ ...meta, contract: 'Splitter' as const, event: 'Split' as const, params: { user, amount } })
const swap = (trader: `0x${string}`, quote: bigint, reserveQuote: bigint, srcAddress = pricePool) => ({
  ...meta, srcAddress, contract: 'Pool' as const, event: 'Swap' as const,
  params: { trader, isBuy: true, amountToken: E, amountQuote: quote, fee: 1n, reserveToken: 100n * E, reserveQuote },
})

describe('Series A event pipeline', () => {
  it('split, merge, redeem and claim keep separate totals and a single account', async () => {
    const ix = createTestIndexer()
    await process(ix, [split(),
      { ...meta, contract: 'Splitter', event: 'Merge', params: { user: organic, amount: 40n * E } },
      { ...meta, contract: 'Splitter', event: 'Redeem', params: { user: organic, amount: 60n * E } },
      { ...meta, contract: 'SplitToken', event: 'Claimed', params: { account: organic, amount: 7n * E } },
    ])
    expect(await ix.ProtocolStats.getOrThrow('global')).toMatchObject({ totalSplit: 100n * E, totalMerged: 40n * E, totalRedeemed: 60n * E, uniqueAccounts: 1, organicAccounts: 1 })
    expect(await ix.Account.getOrThrow(organic)).toMatchObject({ dividendsClaimed: 7n * E, splitVolume: 100n * E })
    const events = await ix.SplitEvent.getAll()
    expect(events.map(e => e.kind).sort()).toEqual(['Merge', 'Redeem', 'Split'])
    expect(events.find(e => e.kind === 'Redeem')?.isMerge).toBe(false)
    expect(await ix.Activity.getAll()).toHaveLength(4)
  })

  it('calculates per-pool OHLC and exact organic/simulated volume without double counting preload', async () => {
    const ix = createTestIndexer()
    // Existing classified account: the committed production bot list is intentionally empty.
    ix.Account.set({ id: sim, chainId: 10143, firstSeenAt: 0, isSimulated: true, splitVolume: 0n,
      tradeVolumeUsd: 0n, tradeCount: 0, dividendsClaimed: 0n })
    ix.ProtocolStats.set({ id: 'global', chainId: 10143, totalSplit: 0n, totalMerged: 0n, totalRedeemed: 0n,
      tradeCount: 0, volumeUsd: 0n, simulatedVolumeUsd: 0n, organicVolumeUsd: 0n,
      uniqueAccounts: 1, organicAccounts: 0, dividendsDeclared: 0, dividendsDistributed: 0, dividendsPaidUsd: 0n })
    await process(ix, [swap(organic, 94n * E, 9400n * E), swap(sim, 97n * E, 9700n * E),
      swap(organic, 91n * E, 9100n * E), swap(sim, 6n * E, 600n * E, divPool),
      { ...swap(organic, 95n * E, 9500n * E), block: { number: block.number + 1, timestamp: 10800 } },
    ])
    const stats = await ix.ProtocolStats.getOrThrow('global')
    expect(stats).toMatchObject({ tradeCount: 5, volumeUsd: 383n * E, simulatedVolumeUsd: 103n * E,
      organicVolumeUsd: 280n * E, uniqueAccounts: 2, organicAccounts: 1 })
    expect(stats.volumeUsd).toBe(stats.simulatedVolumeUsd + stats.organicVolumeUsd)
    const candle = await ix.PoolHourly.getOrThrow(`${pricePool}_2`)
    expect([candle.open, candle.high, candle.low, candle.close].map(x => x.toString())).toEqual(['94', '97', '91', '91'])
    expect(candle.trades).toBe(3)
    expect((await ix.Pool.getOrThrow(divPool)).kind).toBe('dividend')
    expect((await ix.PoolHourly.getOrThrow(`${pricePool}_3`)).open.toString()).toBe('95')
    expect((await ix.Account.getOrThrow(sim)).isSimulated).toBe(true)
    expect((await ix.Activity.getAll()).filter(e => e.account === sim).every(e => e.isSimulated)).toBe(true)
  })

  it('links CRE and Demo declarations with distribution and keeps claims out of paid totals', async () => {
    const ix = createTestIndexer()
    await process(ix, [
      { ...meta, contract: 'DividendOracle', event: 'DividendDeclared', params: { id: 1n, seq: 7n, amountPerShare: E, refPrice: 100n * E, exAt: 7260n, source: 0n } },
      { ...meta, contract: 'DividendOracle', event: 'DividendDeclared', params: { id: 2n, seq: 8n, amountPerShare: 2n * E, refPrice: 100n * E, exAt: 7260n, source: 1n } },
      { ...meta, contract: 'Splitter', event: 'DividendDistributed', params: { id: 1n, total: 100n * E, supply: 100n * E, caller: organic } },
      { ...meta, contract: 'SplitToken', event: 'Claimed', params: { account: organic, amount: 60n * E } },
    ])
    expect(await ix.DividendDeclaration.getOrThrow('1')).toMatchObject({ source: 'CRE', distributed: true, totalPaid: 100n * E, supplyAtDistribution: 100n * E })
    expect(await ix.DividendDeclaration.getOrThrow('2')).toMatchObject({ source: 'Demo', distributed: false })
    expect(await ix.ProtocolStats.getOrThrow('global')).toMatchObject({ dividendsDeclared: 2, dividendsDistributed: 1, dividendsPaidUsd: 100n * E })
    expect(await ix.Activity.getAll()).toHaveLength(4)
  })

  it('updates liquidity reserves including empty pools without creating volume', async () => {
    const ix = createTestIndexer()
    await process(ix, [
      { ...meta, srcAddress: divPool, contract: 'Pool', event: 'LiquidityChanged', params: { provider: organic, added: true, tokenAmt: 10n * E, quoteAmt: 60n * E, shares: E, reserveToken: 10n * E, reserveQuote: 60n * E } },
      { ...meta, srcAddress: divPool, contract: 'Pool', event: 'LiquidityChanged', params: { provider: organic, added: false, tokenAmt: 10n * E, quoteAmt: 60n * E, shares: E, reserveToken: 0n, reserveQuote: 0n } },
    ])
    const pool = await ix.Pool.getOrThrow(divPool)
    expect(pool.lastPrice.toString()).toBe('0')
    expect(pool.volumeUsd).toBe(0n)
    expect((await ix.ProtocolStats.getOrThrow('global')).tradeCount).toBe(0)
    expect(await ix.LiquidityEvent.getAll()).toHaveLength(2)
  })

  it('preserves integer quantities larger than Number precision', async () => {
    const ix = createTestIndexer()
    const amount = 123456789012345678901234567890n
    await process(ix, [split(organic, amount)])
    expect((await ix.ProtocolStats.getOrThrow('global')).totalSplit).toBe(amount)
  })
})

it('classifies committed bot addresses case-insensitively and rejects malformed configuration', () => {
  const classify = walletClassifier([sim.toUpperCase().replace('0X', '0x')])
  expect(classify(sim)).toBe(true)
  expect(classify(organic)).toBe(false)
  expect(walletClassifier([])(sim)).toBe(false)
  expect(() => walletClassifier(['bad'])).toThrow('Invalid address')
})
