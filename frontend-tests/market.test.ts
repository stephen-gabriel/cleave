import { expect, it } from 'vitest'
import {
  aggregateHourlySwaps,
  marketPoolRows,
  netStockLocked,
  parseWad,
  poolTicker,
  volumeSplit,
} from '../src/lib/market'
import type { Pool, Swap } from '../src/data/envio'

const WAD = 10n ** 18n
const wad = (n: number) => (BigInt(Math.round(n * 1000)) * WAD / 1000n).toString()

function pool(partial: Partial<Pool> & Pick<Pool, 'id' | 'kind'>): Pool {
  return {
    reserveToken: '0',
    reserveQuote: '0',
    lastPrice: '0',
    volumeUsd: '0',
    tradeCount: 0,
    ...partial,
  }
}

function swap(partial: Partial<Swap> & Pick<Swap, 'timestamp' | 'amountQuote' | 'isSimulated'>): Swap {
  return {
    id: `swap-${partial.timestamp}-${partial.amountQuote}-${partial.isSimulated}`,
    pool_id: '0xpool',
    trader: '0xtrader',
    isBuy: true,
    amountToken: '0',
    price: '1',
    txHash: '0xhash',
    ...partial,
  }
}

it('parses indexer quantities and refuses malformed or negative values', () => {
  expect(parseWad((100n * WAD).toString())).toBe(100n * WAD)
  expect(parseWad('0')).toBe(0n)
  expect(parseWad('1.5')).toBeNull()
  expect(parseWad('-1')).toBeNull()
  expect(parseWad('oops')).toBeNull()
  expect(parseWad(null)).toBeNull()
  expect(parseWad(undefined)).toBeNull()
})

it('computes net stock locked as split minus merged minus redeemed', () => {
  const net = netStockLocked({
    totalSplit: (1_000n * WAD).toString(),
    totalMerged: (300n * WAD).toString(),
    totalRedeemed: (100n * WAD).toString(),
  })
  expect(net).toBe(600n * WAD)
  // A malformed counter nulls the whole metric rather than guessing.
  expect(netStockLocked({ totalSplit: 'x', totalMerged: '0', totalRedeemed: '0' })).toBeNull()
})

it('splits simulated vs organic volume and refuses to divide by zero', () => {
  const split = volumeSplit((750n * WAD).toString(), (250n * WAD).toString())
  expect(split).not.toBeNull()
  expect(split?.simUsd).toBe(750)
  expect(split?.organicUsd).toBe(250)
  expect(split?.totalUsd).toBe(1000)
  expect(split?.simPct).toBeCloseTo(75)
  expect(split?.organicPct).toBeCloseTo(25)
  // Zero volume has no split to show — never 0/0.
  expect(volumeSplit('0', '0')).toBeNull()
  expect(volumeSplit(null, (10n * WAD).toString())).toBeNull()
  expect(volumeSplit((10n * WAD).toString(), 'bad')).toBeNull()
})

it('buckets swaps per hour with sim and organic summed separately', () => {
  const hour = 3_600
  const bars = aggregateHourlySwaps([
    swap({ timestamp: hour + 10, amountQuote: wad(10), isSimulated: true }),
    swap({ timestamp: hour + 20, amountQuote: wad(5), isSimulated: true }),
    swap({ timestamp: hour + 30, amountQuote: wad(20), isSimulated: false }),
    swap({ timestamp: hour * 2 + 5, amountQuote: wad(1), isSimulated: true }),
    // Malformed and zero quotes are skipped, not fabricated.
    swap({ timestamp: hour + 40, amountQuote: 'nope', isSimulated: true }),
    swap({ timestamp: hour + 50, amountQuote: '0', isSimulated: false }),
    swap({ timestamp: 0, amountQuote: wad(3), isSimulated: true }),
  ])
  expect(bars).toHaveLength(2)
  expect(bars[0].hour).toBe(hour)
  expect(bars[0].simUsd).toBe(15)
  expect(bars[0].organicUsd).toBe(20)
  expect(bars[0].totalUsd).toBe(35)
  expect(bars[1].hour).toBe(hour * 2)
  expect(bars[1].simUsd).toBe(1)
  expect(aggregateHourlySwaps([])).toEqual([])
})

it('maps pool kinds to tickers and drops unknown pools', () => {
  expect(poolTicker('price')).toBe('pACME-A')
  expect(poolTicker('dividend')).toBe('dACME-A')
  expect(poolTicker('mystery')).toBeNull()
  const rows = marketPoolRows(
    [
      pool({ id: '0xaaa', kind: 'dividend', reserveToken: wad(200), reserveQuote: wad(1200), volumeUsd: wad(900), tradeCount: 12 }),
      pool({ id: '0xbbb', kind: 'price', reserveToken: wad(100), reserveQuote: wad(9400), volumeUsd: wad(5000), tradeCount: 40 }),
      pool({ id: '0xccc', kind: 'other' }),
    ],
    { priceFair: 96, divFair: 4 },
  )
  expect(rows.map((r) => r.key)).toEqual(['price', 'dividend'])
  expect(rows[0].ticker).toBe('pACME-A')
  expect(rows[0].marketPrice).toBe(94)
  expect(rows[0].fair).toBe(96)
  expect(rows[0].liquidityUsd).toBe(18_800)
  expect(rows[0].volumeUsd).toBe(5000)
  expect(rows[0].tradeCount).toBe(40)
  expect(rows[1].marketPrice).toBe(6)
  expect(rows[1].fair).toBe(4)
})

it('keeps pool prices null when reserves cannot price the token', () => {
  const rows = marketPoolRows(
    [pool({ id: '0xaaa', kind: 'dividend', reserveToken: '0', reserveQuote: '0' })],
    null,
  )
  expect(rows).toHaveLength(1)
  expect(rows[0].marketPrice).toBeNull()
  expect(rows[0].fair).toBeNull()
  expect(rows[0].liquidityUsd).toBe(0)
})
