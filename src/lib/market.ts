// Pure market-summary logic (ui_spec §9). Everything derives from indexer rows
// or chain reads — a missing source reports null and is never estimated.

import { formatEther } from 'viem'
import type { Pool, Quantity, Swap } from '../data/envio'
import { spotPriceUsd } from './portfolio'

/** Parse an indexer decimal-string quantity to a non-negative wad; null when malformed. */
export function parseWad(value: Quantity | null | undefined): bigint | null {
  if (value === null || value === undefined) return null
  try {
    const big = BigInt(value)
    return big >= 0n ? big : null
  } catch {
    return null
  }
}

function asWadNumber(value: Quantity | null | undefined): number | null {
  const wad = parseWad(value)
  return wad === null ? null : Number(formatEther(wad))
}

/** Stock currently backing outstanding legs: split − merged − redeemed. */
export function netStockLocked(stats: {
  totalSplit: Quantity
  totalMerged: Quantity
  totalRedeemed: Quantity
}): bigint | null {
  const split = parseWad(stats.totalSplit)
  const merged = parseWad(stats.totalMerged)
  const redeemed = parseWad(stats.totalRedeemed)
  if (split === null || merged === null || redeemed === null) return null
  return split - merged - redeemed
}

export type VolumeSplit = {
  simUsd: number
  organicUsd: number
  totalUsd: number
  simPct: number
  organicPct: number
}

/** Simulated vs organic volume; null when either leg is missing or the total is zero. */
export function volumeSplit(
  simulated: Quantity | null,
  organic: Quantity | null,
): VolumeSplit | null {
  const simUsd = asWadNumber(simulated)
  const organicUsd = asWadNumber(organic)
  if (simUsd === null || organicUsd === null) return null
  const totalUsd = simUsd + organicUsd
  if (!(totalUsd > 0)) return null
  const simPct = (simUsd / totalUsd) * 100
  return { simUsd, organicUsd, totalUsd, simPct, organicPct: 100 - simPct }
}

export type HourBar = { hour: number; simUsd: number; organicUsd: number; totalUsd: number }

/** Bucket swaps into hours, summing simulated and organic mUSD volume separately. */
export function aggregateHourlySwaps(swaps: readonly Pick<Swap, 'timestamp' | 'amountQuote' | 'isSimulated'>[]): HourBar[] {
  const map = new Map<number, { sim: bigint; organic: bigint }>()
  for (const swap of swaps) {
    if (!Number.isFinite(swap.timestamp) || swap.timestamp <= 0) continue
    const quote = parseWad(swap.amountQuote)
    if (quote === null || quote <= 0n) continue
    const hour = Math.floor(swap.timestamp / 3600) * 3600
    const cur = map.get(hour) ?? { sim: 0n, organic: 0n }
    if (swap.isSimulated) cur.sim += quote
    else cur.organic += quote
    map.set(hour, cur)
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, v]) => ({
      hour,
      simUsd: Number(formatEther(v.sim)),
      organicUsd: Number(formatEther(v.organic)),
      totalUsd: Number(formatEther(v.sim + v.organic)),
    }))
}

export function poolTicker(kind: string): 'pACME-A' | 'dACME-A' | null {
  if (kind === 'price') return 'pACME-A'
  if (kind === 'dividend') return 'dACME-A'
  return null
}

export type MarketPoolRow = {
  key: 'price' | 'dividend'
  ticker: string
  /** Pool spot price from reserves; null when the pool cannot price the token. */
  marketPrice: number | null
  /** Pool mUSD liquidity (reserve × 2). */
  liquidityUsd: number | null
  volumeUsd: number
  tradeCount: number
  /** Oracle fair value for this leg; null when the chain read is unavailable. */
  fair: number | null
}

/** Pools table rows: known pools only, ordered price then dividend. */
export function marketPoolRows(
  pools: readonly Pool[],
  fair: { priceFair: number; divFair: number } | null,
): MarketPoolRow[] {
  const rows = pools.flatMap<MarketPoolRow>((pool) => {
    const ticker = poolTicker(pool.kind)
    if (ticker === null) return []
    const key = pool.kind === 'price' ? 'price' : 'dividend'
    const reserveToken = parseWad(pool.reserveToken)
    const reserveQuote = parseWad(pool.reserveQuote)
    return [
      {
        key,
        ticker,
        marketPrice: spotPriceUsd(reserveToken, reserveQuote),
        liquidityUsd: reserveQuote === null ? null : Number(formatEther(reserveQuote)) * 2,
        volumeUsd: asWadNumber(pool.volumeUsd) ?? 0,
        tradeCount: Number.isFinite(pool.tradeCount) ? pool.tradeCount : 0,
        fair: key === 'price' ? fair?.priceFair ?? null : fair?.divFair ?? null,
      },
    ]
  })
  const order = { price: 0, dividend: 1 } as const
  return rows.sort((a, b) => order[a.key] - order[b.key])
}
