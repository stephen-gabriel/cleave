import { expect, it } from 'vitest'
import {
  POOL_FEE_BPS,
  deviationChip,
  fairValues,
  priceFromReserves,
  quoteLiquidityShares,
  quoteRemoveLiquidity,
  quoteSwap,
  withSlippage,
  wouldExceedCap,
} from '../src/lib/trading'

const WAD = 10n ** 18n

// Independent mirror of Pool.getAmountOut (contracts/Pool.sol). Any drift between
// src/lib/trading.ts and the on-chain pool shows up as a failure here.
function onChainQuote(
  reserveToken: bigint,
  reserveQuote: bigint,
  tokenIn: boolean,
  amountIn: bigint,
): { out: bigint; fee: bigint; priceImpactBps: number } {
  const amountInWithFee = (amountIn * (10000n - BigInt(POOL_FEE_BPS))) / 10000n
  const out = tokenIn
    ? (reserveQuote * amountInWithFee) / (reserveToken + amountInWithFee)
    : (reserveToken * amountInWithFee) / (reserveQuote + amountInWithFee)
  const spotPrice = tokenIn
    ? (reserveQuote * WAD) / reserveToken
    : (reserveToken * WAD) / reserveQuote
  const execPrice = (out * WAD) / amountIn
  const priceImpactBps =
    execPrice < spotPrice ? Number(((spotPrice - execPrice) * 10000n) / spotPrice) : 0
  return { out, fee: amountIn - amountInWithFee, priceImpactBps }
}

// Asymmetric reserves so an inverted buy-side spot price cannot pass by accident.
const reserveToken = 1000n * WAD
const reserveQuote = 10_000n * WAD

it('mirrors Pool.getAmountOut for a buy (mUSD in) with an asymmetric pool', () => {
  const amountIn = 500n * WAD
  const expected = onChainQuote(reserveToken, reserveQuote, false, amountIn)
  const quote = quoteSwap({ reserveToken, reserveQuote, buy: true, amountIn })
  expect(quote).not.toBeNull()
  expect(quote!.out).toBe(expected.out)
  expect(quote!.fee).toBe(expected.fee)
  expect(quote!.priceImpactBps).toBe(expected.priceImpactBps)
  expect(quote!.priceWad).toBe((amountIn * WAD) / quote!.out)
})

it('mirrors Pool.getAmountOut for a sell (leg in) with an asymmetric pool', () => {
  const amountIn = 100n * WAD
  const expected = onChainQuote(reserveToken, reserveQuote, true, amountIn)
  const quote = quoteSwap({ reserveToken, reserveQuote, buy: false, amountIn })
  expect(quote).not.toBeNull()
  expect(quote!.out).toBe(expected.out)
  expect(quote!.fee).toBe(expected.fee)
  expect(quote!.priceImpactBps).toBe(expected.priceImpactBps)
  expect(quote!.priceWad).toBe((quote!.out * WAD) / amountIn)
})

it('rejects zero/invalid swap inputs and tiny pools', () => {
  expect(quoteSwap({ reserveToken, reserveQuote, buy: true, amountIn: 0n })).toBeNull()
  expect(quoteSwap({ reserveToken: 0n, reserveQuote, buy: true, amountIn: WAD })).toBeNull()
  expect(quoteSwap({ reserveToken, reserveQuote: 0n, buy: false, amountIn: WAD })).toBeNull()
  // 1 wei in loses the entire amount to the 0.30% fee floor.
  expect(quoteSwap({ reserveToken, reserveQuote, buy: true, amountIn: 1n })).toBeNull()
})

it('derives pool price from reserves and applies slippage to the minimum out', () => {
  expect(priceFromReserves(reserveQuote, reserveToken)).toBe(10n * WAD)
  const amount = 123_456n * WAD
  expect(withSlippage(amount, 50)).toBe((amount * 9950n) / 10000n)
  expect(withSlippage(amount, 100)).toBe((amount * 9900n) / 10000n)
  expect(withSlippage(amount, 0)).toBe(amount)
  expect(withSlippage(amount, -10)).toBe(amount)
})

it('computes fair values with seeded defaults labelled estimated', () => {
  const estimated = fairValues({ remainingDividends: 6, amountPerShare: null, refPrice: null })
  expect(estimated).toEqual({ divFair: 6, priceFair: 94, estimated: true })

  const declared = fairValues({ remainingDividends: 4, amountPerShare: 1.05, refPrice: 100 })
  expect(declared).toEqual({ divFair: 4.2, priceFair: 95.8, estimated: false })

  expect(fairValues({ remainingDividends: null, amountPerShare: 1, refPrice: 100 })).toBeNull()
})

it('labels pool price vs fair value as cheap, rich or in line', () => {
  expect(deviationChip(96, 100)!.label).toBe('-4.0% \u00b7 cheap')
  expect(deviationChip(96, 100)!.tone).toBe('cheap')
  expect(deviationChip(103, 100)!.label).toBe('+3.0% \u00b7 rich')
  expect(deviationChip(103, 100)!.tone).toBe('rich')
  expect(deviationChip(100.5, 100)!.tone).toBe('in-line')
  expect(deviationChip(99.5, 100)!.tone).toBe('in-line')
  expect(deviationChip(null, 100)).toBeNull()
  expect(deviationChip(1, 0)).toBeNull()
})

it('flags session-cap breaches only for non-zero spend', () => {
  expect(wouldExceedCap(4900, 200, 5000)).toBe(true)
  expect(wouldExceedCap(4900, 100, 5000)).toBe(false)
  expect(wouldExceedCap(9000, 0, 5000)).toBe(false)
})

it('mints first-deposit shares against sqrt(k) minus the locked dead shares', () => {
  const tokenAmt = 400n * WAD
  const quoteAmt = 900n * WAD
  const shares = quoteLiquidityShares({ reserveToken: 0n, reserveQuote: 0n, totalShares: 0n, tokenAmt, quoteAmt })
  const k = tokenAmt * quoteAmt
  const root = bigintSqrt(k)
  expect(shares).toBe(root - 1000n)
  expect(shares).toBeLessThan(root)
})

it('takes the smaller ratio for subsequent deposits', () => {
  const totalShares = 60_000n * WAD
  const shares = quoteLiquidityShares({
    reserveToken: 1000n * WAD,
    reserveQuote: 10_000n * WAD,
    totalShares,
    tokenAmt: 100n * WAD,
    quoteAmt: 2000n * WAD,
  })
  const sh1 = (100n * WAD * totalShares) / (1000n * WAD)
  const sh2 = (2000n * WAD * totalShares) / (10_000n * WAD)
  expect(shares).toBe(sh1 < sh2 ? sh1 : sh2)
  expect(shares).toBe(sh1)
})

it('redeems liquidity pro rata to shares', () => {
  const out = quoteRemoveLiquidity({
    reserveToken: 1000n * WAD,
    reserveQuote: 10_000n * WAD,
    totalShares: 100_000n * WAD,
    sharesOwned: 25_000n * WAD,
  })
  expect(out).toEqual({ tokenOut: 250n * WAD, quoteOut: 2500n * WAD })
  expect(quoteRemoveLiquidity({ reserveToken, reserveQuote, totalShares: 0n, sharesOwned: WAD })).toBeNull()
})

function bigintSqrt(y: bigint): bigint {
  if (y <= 3n) return y > 0n ? 1n : 0n
  let z = y
  let x = y / 2n + 1n
  while (x < z) {
    z = x
    x = (y / x + x) / 2n
  }
  return z
}
