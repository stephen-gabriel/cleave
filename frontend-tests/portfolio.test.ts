import { expect, it } from 'vitest'
import {
  buildHoldings,
  describeActivity,
  holdingValue,
  inHistoryTab,
  portfolioTotal,
  selectHistory,
  spotPriceUsd,
} from '../src/lib/portfolio'
import type { HistoryEntry } from '../src/lib/portfolio'

const WAD = 10n ** 18n

const pools = {
  div: '0x1111111111111111111111111111111111111111',
  price: '0x2222222222222222222222222222222222222222',
}

function entry(partial: Partial<HistoryEntry> & Pick<HistoryEntry, 'kind'>): HistoryEntry {
  return {
    id: partial.id ?? `id-${partial.kind}`,
    kind: partial.kind,
    amount: partial.amount ?? (100n * WAD).toString(),
    quoteAmount: partial.quoteAmount ?? null,
    pool: partial.pool ?? null,
    timestamp: partial.timestamp ?? 1_700_000_000,
    txHash: partial.txHash ?? '0xabc',
    isSimulated: partial.isSimulated ?? false,
  }
}

it('prices holdings only from the reference price and pool reserves', () => {
  const rows = buildHoldings(
    {
      stock: 100n * WAD,
      priceLeg: 50n * WAD,
      divLeg: 100n * WAD,
      usd: 1_000n * WAD,
      mon: 25n * WAD,
    },
    { refPrice: 100, priceLeg: 94, divLeg: 6 },
  )

  expect(rows.map((r) => r.symbol)).toEqual(['mACME', 'pACME-A', 'dACME-A', 'mUSD', 'MON'])
  expect(rows[0].value).toBeCloseTo(10_000)
  expect(rows[1].value).toBeCloseTo(4_700)
  expect(rows[2].value).toBeCloseTo(600)
  expect(rows[3].value).toBeCloseTo(1_000)
  // The fee token has no pool: it never gets an invented price.
  expect(rows[4].price).toBeNull()
  expect(rows[4].value).toBeNull()
  expect(rows[4].note).toBe('Fee credit')
  expect(rows.map((r) => r.dot)).toEqual(['stock', 'price', 'div', 'usd', null])
})

it('treats a zero balance as worth zero even without a price', () => {
  expect(holdingValue(0n, null)).toBe(0)
  expect(holdingValue(1n * WAD, null)).toBeNull()
  expect(holdingValue(0n, 6)).toBe(0)
  expect(holdingValue(2n * WAD, 6)).toBe(12)
  expect(holdingValue(1n * WAD, Number.NaN)).toBeNull()
})

it('sums priced holdings plus unclaimed dividends and skips unpriced rows', () => {
  const rows = buildHoldings(
    { stock: 100n * WAD, priceLeg: 50n * WAD, divLeg: 100n * WAD, usd: 1_000n * WAD, mon: 25n * WAD },
    { refPrice: 100, priceLeg: 94, divLeg: 6 },
  )
  expect(portfolioTotal(rows, (125n * WAD) / 10n)).toBeCloseTo(16_312.5)
  expect(portfolioTotal(rows, null)).toBeCloseTo(16_300)
  // All-zero balances (brand-new account) total 0, not NaN.
  const empty = buildHoldings(
    { stock: null, priceLeg: null, divLeg: null, usd: null, mon: null },
    { refPrice: null, priceLeg: null, divLeg: null },
  )
  expect(portfolioTotal(empty, null)).toBe(0)
})

it('derives the pool price from reserves and refuses to price an empty pool', () => {
  expect(spotPriceUsd(200n * WAD, 1_200n * WAD)).toBe(6)
  expect(spotPriceUsd(1_000n * WAD, 94_000n * WAD)).toBe(94)
  expect(spotPriceUsd(0n, 100n * WAD)).toBeNull()
  expect(spotPriceUsd(100n * WAD, 0n)).toBeNull()
  expect(spotPriceUsd(null, 100n * WAD)).toBeNull()
  expect(spotPriceUsd(100n * WAD, null)).toBeNull()
})

it('maps every activity kind to exactly one history tab', () => {
  expect(inHistoryTab('Split', 'splits')).toBe(true)
  expect(inHistoryTab('Merge', 'splits')).toBe(true)
  expect(inHistoryTab('Redeem', 'splits')).toBe(true)
  expect(inHistoryTab('Buy', 'trades')).toBe(true)
  expect(inHistoryTab('Sell', 'trades')).toBe(true)
  expect(inHistoryTab('AddLiquidity', 'trades')).toBe(true)
  expect(inHistoryTab('RemoveLiquidity', 'trades')).toBe(true)
  expect(inHistoryTab('Claim', 'dividends')).toBe(true)
  expect(inHistoryTab('Declare', 'dividends')).toBe(true)
  expect(inHistoryTab('Distribute', 'dividends')).toBe(true)
  expect(inHistoryTab('Split', 'trades')).toBe(false)
  expect(inHistoryTab('Buy', 'dividends')).toBe(false)
  expect(inHistoryTab('Ping', 'all')).toBe(true)
  expect(inHistoryTab('Ping', 'splits')).toBe(false)
})

it('writes history descriptions exactly as the ui_spec examples read', () => {
  expect(
    describeActivity(entry({ kind: 'Split', amount: (100n * WAD).toString() }), pools),
  ).toBe('Split 100 mACME')
  expect(
    describeActivity(
      entry({ kind: 'Buy', amount: (123n * 10n ** 17n).toString(), quoteAmount: (74n * WAD).toString(), pool: pools.div }),
      pools,
    ),
  ).toBe('Bought 12.3 dACME-A for 74.0 mUSD')
  expect(
    describeActivity(entry({ kind: 'Claim', amount: (63n * WAD).toString() }), pools),
  ).toBe('Claimed 63.0 mUSD')
})

it('describes the remaining activity kinds with the correct pool ticker', () => {
  expect(describeActivity(entry({ kind: 'Merge' }), pools)).toBe('Merged 100 legs')
  expect(describeActivity(entry({ kind: 'Redeem' }), pools)).toBe('Redeemed 100 mACME')
  expect(
    describeActivity(
      entry({ kind: 'Sell', amount: (100n * WAD).toString(), quoteAmount: (740n * WAD).toString(), pool: pools.price }),
      pools,
    ),
  ).toBe('Sold 100 pACME-A for 740.0 mUSD')
  expect(
    describeActivity(
      entry({ kind: 'AddLiquidity', amount: (250n * WAD).toString(), quoteAmount: (1_500n * WAD).toString(), pool: pools.div }),
      pools,
    ),
  ).toBe('Added 250 dACME-A + 1,500.0 mUSD')
  expect(
    describeActivity(
      entry({ kind: 'RemoveLiquidity', amount: (10n * WAD).toString(), quoteAmount: (50n * WAD).toString(), pool: pools.price }),
      pools,
    ),
  ).toBe('Removed 10 pACME-A + 50.0 mUSD')
  expect(
    describeActivity(entry({ kind: 'Declare', amount: (105n * 10n ** 16n).toString() }), pools),
  ).toBe('Dividend declared · $1.05/share')
  expect(
    describeActivity(entry({ kind: 'Distribute', amount: (30n * WAD).toString() }), pools),
  ).toBe('Dividend paid · 30.0 mUSD')
  // Unknown kinds and malformed amounts are dropped rather than invented.
  expect(describeActivity(entry({ kind: 'Ping' }), pools)).toBeNull()
  expect(describeActivity(entry({ kind: 'Claim', amount: 'not-a-number' }), pools)).toBeNull()
  expect(describeActivity(entry({ kind: 'Buy', quoteAmount: null, pool: pools.div }), pools)).toBeNull()
})

it('filters history by tab, keeps SIM flags and drops unknown kinds', () => {
  const rows: HistoryEntry[] = [
    entry({ id: '1', kind: 'Split', isSimulated: false }),
    entry({ id: '2', kind: 'Buy', amount: (123n * 10n ** 17n).toString(), quoteAmount: (74n * WAD).toString(), pool: pools.div, isSimulated: true }),
    entry({ id: '3', kind: 'Claim', amount: (63n * WAD).toString() }),
    entry({ id: '4', kind: 'Distribute', amount: (30n * WAD).toString() }),
    entry({ id: '5', kind: 'Ping' }),
  ]

  const all = selectHistory(rows, 'all', pools)
  expect(all.map((e) => e.entry.id)).toEqual(['1', '2', '3', '4'])
  expect(all[1].entry.isSimulated).toBe(true)
  expect(all[1].description).toBe('Bought 12.3 dACME-A for 74.0 mUSD')

  expect(selectHistory(rows, 'splits', pools).map((e) => e.entry.id)).toEqual(['1'])
  expect(selectHistory(rows, 'trades', pools).map((e) => e.entry.id)).toEqual(['2'])
  expect(selectHistory(rows, 'dividends', pools).map((e) => e.entry.id)).toEqual(['3', '4'])
  expect(selectHistory([], 'all', pools)).toEqual([])
})
