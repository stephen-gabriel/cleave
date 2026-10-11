// Pure portfolio math (ui_spec §8). Balances come from chain reads and prices
// from the oracle reference price and pool reserves. An asset with no real
// price reports null — it is never estimated or invented.

import { formatEther } from 'viem'
import type { Quantity } from '../data/envio'
import { formatAmount } from './format'
import { priceFromReserves } from './trading'

export type HistoryTab = 'all' | 'splits' | 'trades' | 'dividends'

const TAB_KINDS: Record<Exclude<HistoryTab, 'all'>, readonly string[]> = {
  splits: ['Split', 'Merge', 'Redeem'],
  trades: ['Buy', 'Sell', 'AddLiquidity', 'RemoveLiquidity'],
  dividends: ['Declare', 'Distribute', 'Claim'],
}

export function inHistoryTab(kind: string, tab: HistoryTab): boolean {
  if (tab === 'all') return true
  return TAB_KINDS[tab].includes(kind)
}

/** Pool price (mUSD per token) from reserves; null when the pool cannot price the token. */
export function spotPriceUsd(
  reserveToken: bigint | null,
  reserveQuote: bigint | null,
): number | null {
  if (reserveToken === null || reserveQuote === null) return null
  if (reserveToken <= 0n || reserveQuote <= 0n) return null
  return Number(priceFromReserves(reserveQuote, reserveToken)) / 1e18
}

export type Balances = {
  stock: bigint | null
  priceLeg: bigint | null
  divLeg: bigint | null
  usd: bigint | null
  mon: bigint | null
}

export type Prices = {
  /** Oracle reference price for mACME (DividendOracle.lastRefPrice). */
  refPrice: number | null
  /** Pool prices from reserves. */
  priceLeg: number | null
  divLeg: number | null
}

export type HoldingKey = 'stock' | 'priceLeg' | 'divLeg' | 'usd' | 'mon'
export type HoldingDot = 'stock' | 'price' | 'div' | 'usd' | null

export type HoldingRow = {
  key: HoldingKey
  symbol: string
  note: string | null
  dot: HoldingDot
  balance: bigint
  /** mUSD per unit; null = no market price (shown as —, excluded from totals). */
  price: number | null
  /** balance × price; null when the balance cannot be priced. */
  value: number | null
}

/** Value of a balance at a price. A zero balance is worth 0 even without a price. */
export function holdingValue(balance: bigint, price: number | null): number | null {
  if (price !== null && Number.isFinite(price) && price >= 0) {
    return Number(formatEther(balance)) * price
  }
  return balance === 0n ? 0 : null
}

export function buildHoldings(balances: Balances, prices: Prices): HoldingRow[] {
  const spec: Array<Omit<HoldingRow, 'balance' | 'value'>> = [
    { key: 'stock', symbol: 'mACME', note: null, dot: 'stock', price: prices.refPrice },
    { key: 'priceLeg', symbol: 'pACME-A', note: 'Price leg', dot: 'price', price: prices.priceLeg },
    { key: 'divLeg', symbol: 'dACME-A', note: 'Dividend leg', dot: 'div', price: prices.divLeg },
    { key: 'usd', symbol: 'mUSD', note: null, dot: 'usd', price: 1 },
    // The network fee token has no pool: never fake a price for it.
    { key: 'mon', symbol: 'MON', note: 'Fee credit', dot: null, price: null },
  ]
  const balanceOf: Record<HoldingKey, bigint | null> = {
    stock: balances.stock,
    priceLeg: balances.priceLeg,
    divLeg: balances.divLeg,
    usd: balances.usd,
    mon: balances.mon,
  }
  return spec.map((row) => {
    const balance = balanceOf[row.key] ?? 0n
    return { ...row, balance, value: holdingValue(balance, row.price) }
  })
}

/**
 * Total value in mUSD: every holding that has a real price, plus unclaimed
 * dividends (already denominated in mUSD). Unpriced rows are excluded.
 */
export function portfolioTotal(rows: readonly HoldingRow[], pendingDividends: bigint | null): number {
  let total = 0
  for (const row of rows) {
    if (row.value !== null) total += row.value
  }
  if (pendingDividends !== null && pendingDividends > 0n) {
    total += Number(formatEther(pendingDividends))
  }
  return total
}

export type HistoryEntry = {
  id: string
  kind: string
  account: string
  amount: Quantity
  quoteAmount: Quantity | null
  pool: string | null
  timestamp: number
  txHash: string
  isSimulated: boolean
}

/** mUSD quantity copy: one decimal minimum, matching the ui_spec examples ("74.0 mUSD"). */
function qty(value: Quantity | null): string | null {
  if (value === null) return null
  let big: bigint
  try {
    big = BigInt(value)
  } catch {
    return null
  }
  const n = Number(formatEther(big))
  if (!Number.isFinite(n)) return null
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: n < 1 ? 4 : 2,
  })
}

function tickerOf(pool: string | null, pools: { div: string; price: string }): string {
  if (pool === null) return 'leg'
  const id = pool.toLowerCase()
  if (id === pools.div.toLowerCase()) return 'dACME-A'
  if (id === pools.price.toLowerCase()) return 'pACME-A'
  return 'leg'
}

/** Token quantity copy: whole units drop trailing zeros ("100", "12.3"). */
function tok(value: Quantity): string | null {
  try {
    return formatAmount(BigInt(value))
  } catch {
    return null
  }
}

/** Human description of an indexer Activity row; null when the kind is unknown (never invented). */
export function describeActivity(
  entry: Pick<HistoryEntry, 'kind' | 'amount' | 'quoteAmount' | 'pool'>,
  pools: { div: string; price: string },
): string | null {
  const amount = tok(entry.amount)
  if (amount === null) return null
  const quote = qty(entry.quoteAmount)
  const ticker = tickerOf(entry.pool, pools)
  switch (entry.kind) {
    case 'Split':
      return `Split ${amount} mACME`
    case 'Merge':
      return `Merged ${amount} legs`
    case 'Redeem':
      return `Redeemed ${amount} mACME`
    case 'Buy':
      return quote === null ? null : `Bought ${amount} ${ticker} for ${quote} mUSD`
    case 'Sell':
      return quote === null ? null : `Sold ${amount} ${ticker} for ${quote} mUSD`
    case 'AddLiquidity':
      return quote === null ? null : `Added ${amount} ${ticker} + ${quote} mUSD`
    case 'RemoveLiquidity':
      return quote === null ? null : `Removed ${amount} ${ticker} + ${quote} mUSD`
    case 'Claim': {
      const mUsd = qty(entry.amount)
      return mUsd === null ? null : `Claimed ${mUsd} mUSD`
    }
    case 'Declare': {
      const perShare = qty(entry.amount)
      return perShare === null ? null : `Dividend declared · $${perShare}/share`
    }
    case 'Distribute': {
      const total = qty(entry.amount)
      return total === null ? null : `Dividend paid · ${total} mUSD`
    }
    default:
      return null
  }
}

/** Tab-filtered history with descriptions; unknown kinds are dropped rather than fabricated. */
export function selectHistory(
  rows: readonly HistoryEntry[],
  tab: HistoryTab,
  pools: { div: string; price: string },
): Array<{ entry: HistoryEntry; description: string }> {
  const out: Array<{ entry: HistoryEntry; description: string }> = []
  for (const entry of rows) {
    if (!inHistoryTab(entry.kind, tab)) continue
    const description = describeActivity(entry, pools)
    if (description === null) continue
    out.push({ entry, description })
  }
  return out
}
