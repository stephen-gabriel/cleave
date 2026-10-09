// Pure trading math (frd.md §1.6, ui_spec §6). Mirrors Pool.getAmountOut so
// the UI and tests share the exact on-chain formulas without an RPC.

export const POOL_FEE_BPS = 30
export const DEFAULT_SLIPPAGE_BPS = 50
export const IN_LINE_BPS = 100 // ±1% counts as "In line"
export const HIGH_IMPACT_BPS = 1000 // >10% requires the "I understand" checkbox
export const ACCEPTED_IMPACT_BPS = 1000

export function divWad(a: bigint, b: bigint): bigint {
  if (b <= 0n) return 0n
  return (a * 10n ** 18n) / b
}

export type Quote = {
  out: bigint
  fee: bigint
  priceImpactBps: number
  priceWad: bigint
}

export function quoteSwap(opts: {
  reserveToken: bigint
  reserveQuote: bigint
  buy: boolean
  amountIn: bigint
}): Quote | null {
  const { reserveToken, reserveQuote, buy, amountIn } = opts
  if (amountIn <= 0n || reserveToken <= 0n || reserveQuote <= 0n) return null
  const withFee = (amountIn * (10000n - BigInt(POOL_FEE_BPS))) / 10000n
  if (withFee <= 0n) return null
  const tokenIn = !buy
  const out = tokenIn
    ? (reserveQuote * withFee) / (reserveToken + withFee)
    : (reserveToken * withFee) / (reserveQuote + withFee)
  if (out <= 0n) return null
  const fee = amountIn - withFee
  // Mirror Pool.getAmountOut exactly: spot and execution are compared in the
  // input asset's own units (quote per token when selling, token per quote when
  // buying). The displayed price is always mUSD per leg.
  const spotPriceWad = tokenIn
    ? divWad(reserveQuote, reserveToken)
    : divWad(reserveToken, reserveQuote)
  const execPriceWad = divWad(out, amountIn)
  const priceImpactBps =
    execPriceWad < spotPriceWad
      ? Number(((spotPriceWad - execPriceWad) * 10000n) / spotPriceWad)
      : 0
  const priceWad = buy ? divWad(amountIn, out) : divWad(out, amountIn)
  return { out, fee, priceImpactBps, priceWad }
}

export function priceFromReserves(reserveQuote: bigint, reserveToken: bigint): bigint {
  return divWad(reserveQuote, reserveToken)
}

export function withSlippage(amount: bigint, slippageBps: number): bigint {
  const bps = Number.isFinite(slippageBps) ? Math.max(0, Math.trunc(slippageBps)) : 0
  return (amount * (10000n - BigInt(bps))) / 10000n
}

export type FairValues = {
  divFair: number
  priceFair: number
  estimated: boolean
}

export function fairValues(opts: {
  remainingDividends: number | null
  amountPerShare: number | null
  refPrice: number | null
}): FairValues | null {
  if (opts.remainingDividends === null) return null
  const amountPerShare = opts.amountPerShare ?? 1.0
  const refPrice = opts.refPrice ?? 100.0
  const divFair = opts.remainingDividends * amountPerShare
  const priceFair = refPrice - divFair
  return { divFair, priceFair, estimated: opts.amountPerShare === null || opts.refPrice === null }
}

export type DeviationTone = 'cheap' | 'rich' | 'in-line'

export function deviationChip(poolPrice: number | null, fair: number | null): {
  label: string
  tone: DeviationTone
} | null {
  if (poolPrice === null || fair === null || fair <= 0) return null
  const deviationPct = ((poolPrice - fair) / fair) * 100
  const devBps = Math.abs(deviationPct) * 100
  if (devBps < IN_LINE_BPS) return { label: 'In line', tone: 'in-line' }
  if (deviationPct < 0) {
    return { label: `${deviationPct.toFixed(1)}% · cheap`, tone: 'cheap' }
  }
  return { label: `+${deviationPct.toFixed(1)}% · rich`, tone: 'rich' }
}

export function wouldExceedCap(spentUsd: number, valueUsd: number, cap: number): boolean {
  return valueUsd > 0 && spentUsd + valueUsd > cap
}

export function quoteLiquidityShares(opts: {
  reserveToken: bigint
  reserveQuote: bigint
  totalShares: bigint
  tokenAmt: bigint
  quoteAmt: bigint
}): bigint | null {
  const { reserveToken, reserveQuote, totalShares, tokenAmt, quoteAmt } = opts
  if (tokenAmt <= 0n || quoteAmt <= 0n) return null
  if (totalShares <= 0n) {
    const got = sqrt(tokenAmt * quoteAmt)
    return got > 0n ? got - min(got, 1000n) : null
  }
  if (reserveToken <= 0n || reserveQuote <= 0n) return null
  const sh1 = (tokenAmt * totalShares) / reserveToken
  const sh2 = (quoteAmt * totalShares) / reserveQuote
  return sh1 < sh2 ? sh1 : sh2
}

export function quoteRemoveLiquidity(opts: {
  reserveToken: bigint
  reserveQuote: bigint
  totalShares: bigint
  sharesOwned: bigint
}): { tokenOut: bigint; quoteOut: bigint } | null {
  const { reserveToken, reserveQuote, totalShares, sharesOwned } = opts
  if (sharesOwned <= 0n || totalShares <= 0n) return null
  return {
    tokenOut: (sharesOwned * reserveToken) / totalShares,
    quoteOut: (sharesOwned * reserveQuote) / totalShares,
  }
}

function sqrt(y: bigint): bigint {
  if (y <= 3n) return y > 0n ? 1n : 0n
  let z = y
  let x = y / 2n + 1n
  while (x < z) {
    z = x
    x = (y / x + x) / 2n
  }
  return z
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}