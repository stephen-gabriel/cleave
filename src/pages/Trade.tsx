import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatEther, maxUint256, parseEther } from 'viem'
import type { Address } from 'viem'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { CHAIN } from '../chain/addresses'
import { GAS_LIMITS } from '../chain/gas'
import { MOCK_USD_ABI, POOL_ABI, SPLIT_TOKEN_ABI } from '../chain/abis'
import { useChainState } from '../chain/multicall'
import { publicClient } from '../chain/clients'
import { useSession, isRevertedTransactionError, SESSION_CAP_USD } from '../wallet/session'
import type { SendResult } from '../wallet/session'
import { isOutOfFeeCredit } from '../wallet/txFailure'
import { ConfirmationChip } from '../ui/ConfirmationChip'
import { toastError } from '../ui/toast'
import { describeError, explorerTxUrl, FAUCET_URL } from '../wallet/mera'
import { useEnvio, refreshEnvioStore, envioConfigured } from '../data/useEnvio'
import { queries } from '../data/envio'
import type { Swap } from '../data/envio'
import { navigate } from '../router'
import {
  DEFAULT_SLIPPAGE_BPS,
  HIGH_IMPACT_BPS,
  POOL_FEE_BPS,
  deviationChip,
  divWad,
  fairValues,
  priceFromReserves,
  quoteLiquidityShares,
  quoteRemoveLiquidity,
  quoteSwap,
  withSlippage,
  wouldExceedCap,
} from '../lib/trading'
import type { Quote } from '../lib/trading'
import { formatAmount, formatPrice, formatUsd, formatUsdFromWad, shortAddress, timeAgo } from '../lib/format'
import simWallets from '../../config/sim-wallets.json'
import './Trade.css'

type Leg = 'price' | 'dividend'
type Side = 'buy' | 'sell'
type Phase =
  | 'idle'
  | 'approving'
  | 'swapping'
  | 'liqApproving'
  | 'addingLiquidity'
  | 'removingLiquidity'
  | 'drip'

const DISCLOSURE =
  'Prices come from an on-chain pool and can move before your trade confirms. Mock assets, testnet.'
const SLIPPAGE_KEYS: readonly number[] = [50, 100]

function readSlippage(): number {
  try {
    const raw = window.localStorage.getItem('cleave.slippage')
    if (raw === null) return DEFAULT_SLIPPAGE_BPS
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) && value >= 0 && value <= 5000 ? value : DEFAULT_SLIPPAGE_BPS
  } catch {
    return DEFAULT_SLIPPAGE_BPS
  }
}

function writeSlippage(bps: number): void {
  try {
    window.localStorage.setItem('cleave.slippage', String(Math.trunc(bps)))
  } catch {
    return
  }
}

const SIM_WALLETS = new Set(
  (((simWallets as { wallets?: string[] }).wallets) ?? [])
    .filter((w): w is string => /^0x[0-9a-fA-F]{40}$/.test(w))
    .map((w) => w.toLowerCase()),
)

export default function Trade({ leg }: { leg?: string }) {
  const activeLeg: Leg = leg === 'price' ? 'price' : 'dividend'
  const session = useSession()
  const address = session.wallet?.account.address ?? null
  const state = useChainState(address)

  const [side, setSide] = useState<Side>('buy')
  const [phase, setPhase] = useState<Phase>('idle')
  const [approve, setApprove] = useState<SendResult | null>(null)
  const [last, setLast] = useState<{ result: SendResult; label: string } | null>(null)
  const [amountStr, setAmountStr] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [slipBps, setSlipBps] = useState<number>(readSlippage)
  const [customSlip, setCustomSlip] = useState(false)
  const [acceptImpact, setAcceptImpact] = useState(false)
  const [capPrompt, setCapPrompt] = useState(false)

  const [liqTokenStr, setLiqTokenStr] = useState('')
  const [liqQuoteStr, setLiqQuoteStr] = useState('')
  const [liqOpen, setLiqOpen] = useState(false)

  const busy = phase !== 'idle'
  const elapsed = useElapsedSeconds(busy)
  const isDiv = activeLeg === 'dividend'
  const poolAddress = isDiv ? CHAIN.poolDiv : CHAIN.poolPrice
  const legAddress = isDiv ? CHAIN.divLeg : CHAIN.priceLeg
  const ticker = isDiv ? 'dACME-A' : 'pACME-A'
  const inputTicker = side === 'buy' ? 'mUSD' : ticker

  const legBalance = isDiv ? state.divLegBalance : state.priceLegBalance
  const inputBalance = side === 'buy' ? state.usdBalance : legBalance
  const allowance = side === 'buy'
    ? isDiv ? state.usdAllowanceDiv : state.usdAllowancePrice
    : isDiv ? state.divLegAllowance : state.priceLegAllowance

  const amount = parseAmount(amountStr)
  const excess = inputBalance !== null && amount > inputBalance
  const needsApprove = allowance !== null && amount > allowance
  const usdValue = useMemo(() => {
    if (amount <= 0n) return 0
    if (side === 'buy') return Number(formatEther(amount))
    if (quote !== null) return Number(formatEther(quote.out))
    return 0
  }, [side, amount, quote])

  const buy = side === 'buy'

  const fair = useMemo(
    () =>
      fairValues({
        remainingDividends: state.remainingDividends ?? state.plannedDividends,
        amountPerShare: state.amountPerShare,
        refPrice: state.refPrice,
      }),
    [state.remainingDividends, state.plannedDividends, state.amountPerShare, state.refPrice],
  )
  const fairLine = isDiv ? fair?.divFair ?? null : fair?.priceFair ?? null
  const spotPrice = spotPriceFrom(state, activeLeg)
  const chip = useMemo(() => deviationChip(spotPrice, fairLine), [spotPrice, fairLine])
  const priceLabel = formatPrice(spotPrice)

  const reservesKey = useMemo(
    () =>
      `${state.poolDivReserveToken?.toString() ?? ''}:${state.poolDivReserveQuote?.toString() ?? ''}:${state.poolPriceReserveToken?.toString() ?? ''}:${state.poolPriceReserveQuote?.toString() ?? ''}`,
    [state.poolDivReserveToken, state.poolDivReserveQuote, state.poolPriceReserveToken, state.poolPriceReserveQuote],
  )

  useEffect(() => {
    setApprove(null)
    setLast(null)
    setQuote(null)
    setAcceptImpact(false)
    setAmountStr('')
    setLiqTokenStr('')
    setLiqQuoteStr('')
  }, [activeLeg, side])

  useEffect(() => {
    if (amount <= 0n) {
      setQuote(null)
      return
    }
    let alive = true
    const timer = window.setTimeout(async () => {
      try {
        const pool = isDiv ? CHAIN.poolDiv : CHAIN.poolPrice
        const [out, , impact] = await publicClient.readContract({
          address: pool,
          abi: POOL_ABI,
          functionName: 'getAmountOut',
          args: [!buy, amount],
        })
        if (!alive) return
        setQuote({
          out,
          fee: (amount * BigInt(POOL_FEE_BPS)) / 10000n,
          priceImpactBps: Number(impact),
          priceWad: buy ? divWad(amount, out) : divWad(out, amount),
        })
      } catch {
        if (!alive) return
        const reserveToken = isDiv ? state.poolDivReserveToken : state.poolPriceReserveToken
        const reserveQuote = isDiv ? state.poolDivReserveQuote : state.poolPriceReserveQuote
        const local =
          reserveToken !== null && reserveQuote !== null
            ? quoteSwap({ reserveToken, reserveQuote, buy, amountIn: amount })
            : null
        setQuote(local)
      }
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // reservesKey refreshes the quote when the pool moves between polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, buy, isDiv, reservesKey])

  const minOut = quote !== null ? withSlippage(quote.out, slipBps) : 0n
  const impactPct = quote === null ? 0 : quote.priceImpactBps / 100
  const impactTooHigh = impactPct > HIGH_IMPACT_BPS / 100
  const canTrade =
    !!session.wallet && !state.loading && !busy && amount > 0n && quote !== null && !excess && (!impactTooHigh || acceptImpact)

  const refresh = state.refresh

  const runDrip = useCallback(async () => {
    if (busy || session.wallet === null) return
    setPhase('drip')
    try {
      const res = await fetch('/api/drip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: session.wallet.account.address }),
      })
      const data = (await res.json()) as { status?: 'sent' | 'skipped'; txHash?: string }
      if (data.status === 'sent') {
        setLast({ result: { hash: data.txHash as `0x${string}`, seconds: 0, isFirst: false }, label: '0.25 MON fee credit added' })
        refresh()
      }
    } catch {
      toastError('Fee credit temporarily unavailable')
    } finally {
      setPhase('idle')
    }
  }, [busy, session, refresh])

  const swapSender = useCallback(
    async (overCapConfirmed: boolean) => {
      if (busy || amount <= 0n || quote === null || session.wallet === null) return
      if (!overCapConfirmed && wouldExceedCap(session.spentUsd, usdValue, SESSION_CAP_USD)) {
        setCapPrompt(true)
        return
      }
      setPhase('approving')
      const token = side === 'buy' ? CHAIN.usd : legAddress
      const abi = side === 'buy' ? MOCK_USD_ABI : SPLIT_TOKEN_ABI
      try {
        if (needsApprove) {
          const approveResult = await session.send({
            to: token,
            abi,
            functionName: 'approve',
            args: [poolAddress, maxUint256],
            gas: GAS_LIMITS.approve,
          })
          setApprove(approveResult)
        } else {
          setApprove(null)
        }
        setPhase('swapping')
        const result = await session.send({
          to: poolAddress,
          abi: POOL_ABI,
          functionName: 'swapExactIn',
          args: [buy, amount, minOut],
          gas: GAS_LIMITS.swap,
          usdValue,
        })
        setLast({ result, label: `${buy ? 'Bought' : 'Sold'} ${formatAmount(quote.out)} ${buy ? ticker : 'mUSD'}` })
        refreshEnvioStore()
        refresh()
      } catch (error) {
        handleTxError(error, { onFeeCredit: runDrip })
      } finally {
        setPhase('idle')
      }
    },
    [busy, amount, quote, session, usdValue, needsApprove, side, legAddress, poolAddress, buy, ticker, minOut, refresh, runDrip],
  )

  const confirmCap = useCallback(async () => {
    setCapPrompt(false)
    try {
      await session.extend()
    } catch {
      return
    }
    void swapSender(true)
  }, [session, swapSender])

  const runLiquidity = useCallback(async () => {
    const tokenAmt = parseAmount(liqTokenStr)
    const quoteAmt = parseAmount(liqQuoteStr)
    if (busy || session.wallet === null || tokenAmt <= 0n || quoteAmt <= 0n) return
    const reserveToken = isDiv ? state.poolDivReserveToken : state.poolPriceReserveToken
    const reserveQuote = isDiv ? state.poolDivReserveQuote : state.poolPriceReserveQuote
    const totalShares = isDiv ? state.poolDivTotalShares : state.poolPriceTotalShares
    if (
      reserveToken === null ||
      reserveQuote === null ||
      totalShares === null ||
      reserveToken <= 0n ||
      reserveQuote <= 0n
    ) {
      toastError('Pool has no liquidity yet \u2014 try a trade first.')
      return
    }
    const expected = quoteLiquidityShares({ reserveToken, reserveQuote, totalShares, tokenAmt, quoteAmt })
    if (expected === null) return
    const minShares = withSlippage(expected, slipBps)
    const liqValue =
      Number(formatEther(quoteAmt)) + Number(formatEther(tokenAmt)) * (spotPriceFrom(state, activeLeg) ?? 0)
    if (wouldExceedCap(session.spentUsd, liqValue, SESSION_CAP_USD)) {
      setCapPrompt(true)
      return
    }
    setPhase('liqApproving')
    try {
      const legAllow = isDiv ? state.divLegAllowance : state.priceLegAllowance
      const usdAllow = isDiv ? state.usdAllowanceDiv : state.usdAllowancePrice
      if (legAllow !== null && legAllow < tokenAmt) {
        await session.send({
          to: legAddress,
          abi: SPLIT_TOKEN_ABI,
          functionName: 'approve',
          args: [poolAddress, maxUint256],
          gas: GAS_LIMITS.approve,
        })
      }
      if (usdAllow !== null && usdAllow < quoteAmt) {
        await session.send({
          to: CHAIN.usd,
          abi: MOCK_USD_ABI,
          functionName: 'approve',
          args: [poolAddress, maxUint256],
          gas: GAS_LIMITS.approve,
        })
      }
      setPhase('addingLiquidity')
      const result = await session.send({
        to: poolAddress,
        abi: POOL_ABI,
        functionName: 'addLiquidity',
        args: [tokenAmt, quoteAmt, minShares],
        gas: GAS_LIMITS.addLiquidity,
        usdValue: liqValue,
      })
      setLast({ result, label: `Added ${formatAmount(tokenAmt)} ${ticker} + ${formatAmount(quoteAmt)} mUSD` })
      refreshEnvioStore()
      refresh()
      setLiqTokenStr('')
      setLiqQuoteStr('')
    } catch (error) {
      handleTxError(error, { onFeeCredit: runDrip })
    } finally {
      setPhase('idle')
    }
  }, [
    busy,
    session,
    isDiv,
    state.poolDivReserveToken,
    state.poolDivReserveQuote,
    state.poolDivTotalShares,
    state.poolPriceReserveToken,
    state.poolPriceReserveQuote,
    state.poolPriceTotalShares,
    state.divLegAllowance,
    state.priceLegAllowance,
    state.usdAllowanceDiv,
    state.usdAllowancePrice,
    activeLeg,
    slipBps,
    liqTokenStr,
    liqQuoteStr,
    legAddress,
    poolAddress,
    ticker,
    refresh,
    runDrip,
  ])

  const runRemove = useCallback(async () => {
    const myShares = isDiv ? state.poolDivShares : state.poolPriceShares
    const reserveToken = isDiv ? state.poolDivReserveToken : state.poolPriceReserveToken
    const reserveQuote = isDiv ? state.poolDivReserveQuote : state.poolPriceReserveQuote
    const totalShares = isDiv ? state.poolDivTotalShares : state.poolPriceTotalShares
    if (
      busy ||
      session.wallet === null ||
      myShares === null ||
      myShares <= 0n ||
      reserveToken === null ||
      reserveQuote === null ||
      totalShares === null ||
      totalShares <= 0n
    ) {
      return
    }
    const out = quoteRemoveLiquidity({ reserveToken, reserveQuote, totalShares, sharesOwned: myShares })
    if (out === null) return
    setPhase('removingLiquidity')
    try {
      const result = await session.send({
        to: poolAddress,
        abi: POOL_ABI,
        functionName: 'removeLiquidity',
        args: [myShares, withSlippage(out.tokenOut, slipBps), withSlippage(out.quoteOut, slipBps)],
        gas: GAS_LIMITS.removeLiquidity,
      })
      setLast({ result, label: `Removed ${formatAmount(out.tokenOut)} ${ticker} + ${formatAmount(out.quoteOut)} mUSD` })
      refreshEnvioStore()
      refresh()
    } catch (error) {
      handleTxError(error, { onFeeCredit: runDrip })
    } finally {
      setPhase('idle')
    }
  }, [
    busy,
    session,
    isDiv,
    state.poolDivShares,
    state.poolPriceShares,
    state.poolDivReserveToken,
    state.poolDivReserveQuote,
    state.poolPriceReserveToken,
    state.poolPriceReserveQuote,
    state.poolDivTotalShares,
    state.poolPriceTotalShares,
    poolAddress,
    ticker,
    slipBps,
    refresh,
    runDrip,
  ])

  const hourly = useEnvio(queries.hourly(poolAddress, 168))
  const swaps = useEnvio(queries.swaps(poolAddress, 200))
  const declarations = useEnvio(queries.declarations(50))

  useEffect(() => {
    console.info('[cleave:trade] state', {
      leg: activeLeg,
      side,
      busy,
      staged: phase,
      amount: amount.toString(),
      minOut: minOut.toString(),
      impactPct,
      excess,
      needsApprove,
      usdValue,
      spentUsd: session.spentUsd,
      canTrade,
      price: priceLabel,
    })
  })

  const hourlyPoints = useMemo(() => {
    const rows = hourly.data ?? []
    const asc = [...rows].sort((a, b) => a.hour - b.hour)
    return asc
      .map((h) => ({ t: h.hour * 1000, p: Number(h.close) }))
      .filter((point) => Number.isFinite(point.p) && point.p > 0)
  }, [hourly.data])
  const tradePoints = useMemo(() => {
    const rows = swaps.data ?? []
    const asc = [...rows].sort((a, b) => a.timestamp - b.timestamp)
    return asc
      .map((s) => ({ t: s.timestamp * 1000, p: Number(s.price) }))
      .filter((point) => Number.isFinite(point.p) && point.p > 0)
  }, [swaps.data])
  const exDivs = useMemo(() => {
    const rows = declarations.data ?? []
    return rows
      .filter((d) => d.distributedAt !== null)
      .map((d) => ({
        t: (d.distributedAt as number) * 1000,
        label: `Dividend paid $${(Number(d.amountPerShare) / 1e18).toFixed(2)}/share`,
      }))
  }, [declarations.data])
  const recentTrades = useMemo(() => (swaps.data ?? []).slice(0, 20), [swaps.data])
  const volumeUsd = useMemo(() => {
    const rows = hourly.data ?? []
    const dayAgo = Date.now() - 86_400_000
    let sum = 0n
    for (const h of rows) {
      if (h.hour * 1000 < dayAgo) continue
      try {
        sum += BigInt(h.volumeUsd)
      } catch {
        /* skip malformed indexer value */
      }
    }
    return sum
  }, [hourly.data])

  const liquidity = useMemo(() => {
    const shares = isDiv ? state.poolDivShares : state.poolPriceShares
    const total = isDiv ? state.poolDivTotalShares : state.poolPriceTotalShares
    const reserveToken = isDiv ? state.poolDivReserveToken : state.poolPriceReserveToken
    const reserveQuote = isDiv ? state.poolDivReserveQuote : state.poolPriceReserveQuote
    if (shares === null || total === null || total <= 0n) return null
    const pct = total > 0n ? (Number(shares) / Number(total)) * 100 : 0
    const out =
      reserveToken !== null && reserveQuote !== null
        ? quoteRemoveLiquidity({ reserveToken, reserveQuote, totalShares: total, sharesOwned: shares })
        : null
    return { shares, pct, tokenOut: out?.tokenOut ?? null, quoteOut: out?.quoteOut ?? null }
  }, [isDiv, state.poolDivShares, state.poolDivTotalShares, state.poolPriceShares, state.poolPriceTotalShares, state.poolDivReserveToken, state.poolDivReserveQuote, state.poolPriceReserveToken, state.poolPriceReserveQuote])

  return (
    <div className="trade">
      <TradeHeader
        price={priceLabel}
        points={hourlyPoints}
        volumeUsd={volumeUsd}
        fair={fairLine}
        ticker={ticker}
        isDiv={isDiv}
      />

      <LegToggle active={activeLeg} disabled={busy} />

      <div className="trade__grid">
        <section className="trade__main">
          <PriceChart
            leg={activeLeg}
            hourlyPoints={hourlyPoints}
            tradePoints={tradePoints}
            exDivs={exDivs}
            fair={fairLine}
            status={envioConfigured() ? swaps.status : 'unconfigured'}
            spot={spotPriceFrom(state, activeLeg)}
          />

          <StatRow
            fair={fairLine}
            estimated={fair?.estimated ?? false}
            isDiv={isDiv}
            chip={chip}
            liquidity={isDiv ? state.poolDivReserveQuote : state.poolPriceReserveQuote}
            price={spotPrice}
            refPrice={state.refPrice}
          />

          <TradesFeed
            rows={recentTrades}
            address={address}
            status={envioConfigured() ? swaps.status : 'unconfigured'}
            ticker={ticker}
          />
        </section>

        <OrderTicket
          leg={activeLeg}
          side={side}
          onSide={setSide}
          amountStr={amountStr}
          onAmount={setAmountStr}
          onMax={() => setAmountStr(inputBalance !== null ? formatEther(inputBalance) : '0')}
          inputBalance={inputBalance}
          inputTicker={inputTicker}
          quote={quote}
          amount={amount}
          excess={excess}
          minOut={minOut}
          impactPct={impactPct}
          impactTooHigh={impactTooHigh}
          acceptImpact={acceptImpact}
          onAcceptImpact={setAcceptImpact}
          slipBps={slipBps}
          customSlip={customSlip}
          onSlip={setSlipBps}
          onCustomSlip={setCustomSlip}
          canTrade={canTrade}
          phase={phase}
          elapsed={elapsed}
          approve={approve}
          needsApprove={needsApprove}
          last={last}
          onTrade={() => void swapSender(false)}
          highlight={hourlyPoints.length === 0 && tradePoints.length === 0}
        />
      </div>

      <LiquidityCard
        open={liqOpen}
        onToggle={() => setLiqOpen((o) => !o)}
        tokenStr={liqTokenStr}
        onTokenStr={setLiqTokenStr}
        quoteStr={liqQuoteStr}
        onQuoteStr={setLiqQuoteStr}
        phase={phase}
        elapsed={elapsed}
        legBalance={legBalance}
        usdBalance={state.usdBalance}
        liquidity={liquidity}
        ticker={ticker}
        onAdd={() => void runLiquidity()}
        onRemove={() => void runRemove()}
      />

      {capPrompt && (
        <CapModal
          onCancel={() => setCapPrompt(false)}
          onConfirm={() => void confirmCap()}
        />
      )}
    </div>
  )
}

function spotPriceFrom(state: ReturnType<typeof useChainState>, leg: Leg): number | null {
  const token = leg === 'dividend' ? state.poolDivReserveToken : state.poolPriceReserveToken
  const quote = leg === 'dividend' ? state.poolDivReserveQuote : state.poolPriceReserveQuote
  if (token === null || quote === null || token <= 0n) return null
  return Number(priceFromReserves(quote, token)) / 1e18
}

function TradeHeader({
  price,
  points,
  volumeUsd,
  fair,
  ticker,
  isDiv,
}: {
  price: string
  points: Array<{ t: number; p: number }>
  volumeUsd: bigint
  fair: number | null
  ticker: string
  isDiv: boolean
}) {
  const now = Date.now()
  const dayAgo = now - 86_400_000
  const window = points.filter((p) => p.t >= dayAgo)
  const newest = window.length > 0 ? window[window.length - 1].p : null
  const oldest = window.length > 1 ? window[0].p : null
  const changePct = newest !== null && oldest !== null ? ((newest - oldest) / oldest) * 100 : null
  return (
    <header className="trade__head">
      <span className="mono trade__price" title={`Pool price · ${ticker} in mUSD`}>
        {price}
      </span>
      <div className="trade__headmeta">
        {changePct !== null ? (
          <span className={`chip chip--move${changePct >= 0 ? ' chip--pos' : ' chip--neg'}`}>
            {changePct >= 0 ? '+' : ''}
            {changePct.toFixed(2)}% · 24h
          </span>
        ) : (
          <span className="chip" title="Not enough history yet">
            —
          </span>
        )}
        <span className="chip" title="24h volume from the indexer (simulated included)">
          Vol {formatUsdFromWad(volumeUsd)} · 24h
        </span>
        {fair !== null && <span className="chip chip--fair">Fair {formatUsd(fair)}</span>}
      </div>
      <span className="mono trade__ticker">{isDiv ? 'dACME-A' : 'pACME-A'}</span>
    </header>
  )
}

function LegToggle({ active, disabled }: { active: Leg; disabled: boolean }) {
  return (
    <div className="legtoggle" role="tablist" aria-label="Choose a leg">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'dividend'}
        className={`legtoggle__btn legtoggle__btn--div${active === 'dividend' ? ' legtoggle__btn--on' : ''}`}
        disabled={disabled}
        onClick={() => navigate('/trade/dividend')}
      >
        Dividend leg · dACME-A
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'price'}
        className={`legtoggle__btn legtoggle__btn--price${active === 'price' ? ' legtoggle__btn--on' : ''}`}
        disabled={disabled}
        onClick={() => navigate('/trade/price')}
      >
        Price leg · pACME-A
      </button>
    </div>
  )
}

function PriceChart({
  leg,
  hourlyPoints,
  tradePoints,
  exDivs,
  fair,
  status,
  spot,
}: {
  leg: Leg
  hourlyPoints: Array<{ t: number; p: number }>
  tradePoints: Array<{ t: number; p: number }>
  exDivs: Array<{ t: number; label: string }>
  fair: number | null
  status: string
  spot: number | null
}) {
  const [mode, setMode] = useState<'hourly' | 'trades'>('hourly')
  const points = mode === 'hourly' ? hourlyPoints : tradePoints
  const empty = points.length === 0

  return (
    <section className="card chart" aria-label={`${leg === 'dividend' ? 'Dividend' : 'Price'} leg price chart`}>
      <div className="chart__head">
        <h3>Price</h3>
        <div className="segmented segmented--sm">
          <button
            type="button"
            className={`segmented__btn${mode === 'hourly' ? ' segmented__btn--on' : ''}`}
            onClick={() => setMode('hourly')}
          >
            Hourly
          </button>
          <button
            type="button"
            className={`segmented__btn${mode === 'trades' ? ' segmented__btn--on' : ''}`}
            onClick={() => setMode('trades')}
          >
            Trades
          </button>
        </div>
      </div>

      {empty ? (
        <div className="chart__empty">
          <p>{status === 'error' || status === 'stale' ? 'Indexer unavailable. Retrying.' : 'No trades yet \u2014 be the first.'}</p>
          {spot !== null && (
            <p className="mono chart__spot">Current pool price · {formatPrice(spot)}</p>
          )}
        </div>
      ) : (
        <ChartSvg points={points} exDivs={exDivs} fair={fair} leg={leg} />
      )}
    </section>
  )
}

function ChartSvg({
  points,
  exDivs,
  fair,
  leg,
}: {
  points: Array<{ t: number; p: number }>
  exDivs: Array<{ t: number; label: string }>
  fair: number | null
  leg: Leg
}) {
  const W = 640
  const H = 220
  const PAD = 8
  const [hover, setHover] = useState<number | null>(null)
  const values = points.map((p) => p.p)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const padSpan = span * 0.12
  const lo = min - padSpan
  const hi = max + padSpan
  const tMin = points[0].t
  const tMax = points[points.length - 1].t
  const range = Math.max(1, tMax - tMin)
  const x = (t: number) => PAD + ((t - tMin) / range) * (W - PAD * 2)
  const y = (p: number) => H - PAD - ((p - lo) / (hi - lo)) * (H - PAD * 2)
  const color = leg === 'dividend' ? 'var(--div)' : 'var(--price)'
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ')
  const area = `${line} L${x(tMax).toFixed(1)},${H - PAD} L${x(tMin).toFixed(1)},${H - PAD} Z`
  const fairY = fair !== null && fair >= lo && fair <= hi ? y(fair) : null
  const markers = exDivs.filter((d) => d.t >= tMin && d.t <= tMax)

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const index = Math.round(ratio * (points.length - 1))
    setHover(index)
  }

  const hoverPoint = hover !== null ? points[hover] : null
  const hoverX = hoverPoint !== null ? x(hoverPoint.t) : 0
  const gridMarks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="chart__wrap">
      <svg
        className="chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${leg === 'dividend' ? 'Dividend' : 'Price'} leg pool price over time`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridMarks.map((m) => (
          <line key={m} x1="0" x2={W} y1={y(lo + (hi - lo) * (1 - m))} y2={y(lo + (hi - lo) * (1 - m))} className="chart__gridline" />
        ))}
        {markers.map((d) => (
          <line key={`${d.t}-${d.label}`} x1={x(d.t)} x2={x(d.t)} y1={PAD} y2={H - PAD} className="chart__exdiv" />
        ))}
        {fairY !== null && (
          <line x1={PAD} x2={W - PAD} y1={fairY} y2={fairY} className="chart__fair" />
        )}
        <path d={area} fill="url(#chart-fill)" />
        <path d={line} className="chart__line" style={{ stroke: color }} />
        {hoverPoint !== null && (
          <>
            <line x1={hoverX} x2={hoverX} y1={PAD} y2={H - PAD} className="chart__hoverline" />
            <circle cx={hoverX} cy={y(hoverPoint.p)} r="3.5" className="chart__hoverdot" style={{ fill: color }} />
          </>
        )}
        <rect
          x="0"
          y="0"
          width={W}
          height={H}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hoverPoint !== null && (
        <div className="chart__tooltip" style={{ left: `${(hoverX / W) * 100}%` }}>
          <span className="mono">{formatPrice(hoverPoint.p)}</span>
          <span className="chart__tooltip-time">{new Date(hoverPoint.t).toLocaleString()}</span>
        </div>
      )}
      {markers.length > 0 && (
        <div className="chart__legend">
          {markers.slice(-2).map((d) => (
            <span key={d.label} className="chart__legend-item">
              <span className="chart__exdiv-k" aria-hidden />
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StatRow({
  fair,
  estimated,
  isDiv,
  chip,
  liquidity,
  price,
  refPrice,
}: {
  fair: number | null
  estimated: boolean
  isDiv: boolean
  chip: { label: string; tone: 'cheap' | 'rich' | 'in-line' } | null
  liquidity: bigint | null
  price: number | null
  refPrice: number | null
}) {
  const yieldPct = isDiv
    ? fair !== null && price !== null && price > 0
      ? (fair / price) * 100
      : null
    : null
  const liqUsd = liquidity !== null ? liquidity * 2n : null
  return (
    <section className="stats" aria-label="Market statistics">
      <StatTile
        label="Fair value"
        value={formatUsd(fair)}
        hint={
          isDiv
            ? 'Remaining dividends \u00d7 latest declared amount'
            : 'Reference price \u2212 dividend fair value'
        }
        emphasized={estimated}
        badge={estimated ? 'Estimated' : null}
      />
      <div className="stat">
        <span className="stat__label">Pool price vs fair</span>
        <span className={`chip chip--${chip?.tone ?? 'muted'}`}>{chip?.label ?? '\u2014'}</span>
      </div>
      <StatTile label="Liquidity" value={liqUsd !== null ? formatUsdFromWad(liqUsd) : '\u2014'} hint="Pool mUSD reserve \u00d7 2" />
      <StatTile
        label={isDiv ? 'Implied yield' : 'At maturity'}
        value={
          isDiv
            ? yieldPct !== null
              ? `${yieldPct.toFixed(2)}%`
              : '\u2014'
            : refPrice !== null
              ? formatUsd(refPrice)
              : '\u2014'
        }
        hint={isDiv ? 'Remaining dividends \u00f7 price (not annualised)' : 'Accretes toward the reference price as dividends are paid'}
      />
    </section>
  )
}

function StatTile({
  label,
  value,
  hint,
  emphasized,
  badge,
}: {
  label: string
  value: string
  hint: string
  emphasized?: boolean
  badge?: string | null
}) {
  return (
    <div className={`stat${emphasized ? ' stat--emph' : ''}`} title={hint}>
      <span className="stat__label">
        {label}
        {badge !== null && badge !== undefined && <span className="stat__badge">{badge}</span>}
      </span>
      <span className="mono stat__value">{value}</span>
    </div>
  )
}

function OrderTicket({
  leg,
  side,
  onSide,
  amountStr,
  onAmount,
  onMax,
  inputBalance,
  inputTicker,
  quote,
  amount,
  excess,
  minOut,
  impactPct,
  impactTooHigh,
  acceptImpact,
  onAcceptImpact,
  slipBps,
  customSlip,
  onSlip,
  onCustomSlip,
  canTrade,
  phase,
  elapsed,
  approve,
  needsApprove,
  last,
  onTrade,
  highlight,
}: {
  leg: Leg
  side: Side
  onSide: (side: Side) => void
  amountStr: string
  onAmount: (v: string) => void
  onMax: () => void
  inputBalance: bigint | null
  inputTicker: string
  quote: Quote | null
  amount: bigint
  excess: boolean
  minOut: bigint
  impactPct: number
  impactTooHigh: boolean
  acceptImpact: boolean
  onAcceptImpact: (v: boolean) => void
  slipBps: number
  customSlip: boolean
  onSlip: (bps: number) => void
  onCustomSlip: (open: boolean) => void
  canTrade: boolean
  phase: Phase
  elapsed: number
  approve: SendResult | null
  needsApprove: boolean
  last: { result: SendResult; label: string } | null
  onTrade: () => void
  highlight: boolean
}) {
  const isDiv = leg === 'dividend'
  const buy = side === 'buy'
  const ticker = isDiv ? 'dACME-A' : 'pACME-A'
  const receiveTicker = buy ? ticker : 'mUSD'
  const action = `${buy ? 'Buy' : 'Sell'} ${isDiv ? 'dividend leg' : 'price leg'}`
  const busy = phase !== 'idle'
  const label = buttonLabel(phase, elapsed, amount, excess, impactTooHigh, acceptImpact, action)

  const impactClass = impactPct > 5 ? ' detail--neg' : impactPct > 2 ? ' detail--warn' : ''
  const receiveStr = quote !== null && amount > 0n ? formatAmount(quote.out) : ''
  const priceStr = quote !== null && amount > 0n ? formatPrice(Number(quote.priceWad) / 1e18) : '\u2014'
  const impactStr = amount > 0n && quote !== null ? `${impactPct.toFixed(2)}%` : '\u2014'

  return (
    <section className={`card ticket${highlight ? ' ticket--spotlight' : ''}`} aria-label="Order ticket">
      <div className="segmented segmented--ticket">
        <button
          type="button"
          className={`segmented__btn${buy ? ' segmented__btn--on' : ''}`}
          disabled={busy}
          onClick={() => onSide('buy')}
        >
          Buy
        </button>
        <button
          type="button"
          className={`segmented__btn${!buy ? ' segmented__btn--on' : ''}`}
          disabled={busy}
          onClick={() => onSide('sell')}
        >
          Sell
        </button>
      </div>

      <p className="ticket__pair mono">
        {buy ? 'mUSD \u2192' : `${ticker} \u2192`} {buy ? ticker : 'mUSD'}
      </p>

      <div className="ticket__input">
        <label className="amount">
          <span className="amount__label">You pay</span>
          <span className="amount__field">
            <input
              className="amount__input mono"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amountStr}
              disabled={busy}
              onChange={(event) => onAmount(sanitizeAmount(event.target.value))}
            />
            <span className="amount__suffix mono">{inputTicker}</span>
          </span>
          <span className="amount__hint mono">
            Balance {formatAmount(inputBalance)}
            {inputBalance !== null && inputBalance > 0n && !busy ? (
              <button type="button" className="linkbtn" onClick={onMax}>
                Max
              </button>
            ) : null}
          </span>
        </label>
      </div>

      {excess && <p className="field-error">Not enough {inputTicker}.</p>}

      <div className="ticket__receive">
        <span className="ticket__receive-label">You receive</span>
        <span className="mono ticket__receive-value">{receiveStr || '\u2026'}</span>
        <span className="mono ticket__receive-ticker">{receiveTicker}</span>
      </div>

      <dl className="details mono">
        <div>
          <dt>Price</dt>
          <dd>{priceStr}</dd>
        </div>
        <div>
          <dt>Price impact</dt>
          <dd className={impactClass}>{impactStr}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{(POOL_FEE_BPS / 100).toFixed(2)}%</dd>
        </div>
        <div>
          <dt>Minimum received</dt>
          <dd>{amount > 0n && quote !== null ? `${formatAmount(minOut)} ${receiveTicker}` : '\u2014'}</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>Paid from your fee credit</dd>
        </div>
      </dl>

      <SlippageRow
        slipBps={slipBps}
        customSlip={customSlip}
        onSlip={onSlip}
        onCustomSlip={onCustomSlip}
        disabled={busy}
      />

      {impactTooHigh && !acceptImpact && (
        <label className="ticket__ack">
          <input type="checkbox" checked={acceptImpact} onChange={(event) => onAcceptImpact(event.target.checked)} />
          <span>I understand the price impact</span>
        </label>
      )}

      {needsApprove && <TradeStepper approve={approve} phase={phase} />}

      <button
        type="button"
        className={`btn btn--full btn--lg btn--leg-${isDiv ? 'div' : 'price'}`}
        disabled={!canTrade}
        onClick={onTrade}
      >
        {label}
      </button>

      <p className="ticket__disclosure">{DISCLOSURE}</p>

      {phase === 'idle' && last !== null && (
        <ConfirmationChip seconds={last.result.seconds} txHash={last.result.hash} label={last.label} />
      )}
    </section>
  )
}

function SlippageRow({
  slipBps,
  customSlip,
  onSlip,
  onCustomSlip,
  disabled,
}: {
  slipBps: number
  customSlip: boolean
  onSlip: (bps: number) => void
  onCustomSlip: (open: boolean) => void
  disabled: boolean
}) {
  const commit = (bps: number) => {
    writeSlippage(bps)
    onSlip(bps)
    onCustomSlip(false)
  }
  return (
    <div className="slippage">
      <span className="slippage__label">Slippage</span>
      <div className="slippage__chips">
        {SLIPPAGE_KEYS.map((bps) => (
          <button
            key={bps}
            type="button"
            className={`chip chip--slippage${slipBps === bps && !customSlip ? ' chip--slippage-on' : ''}`}
            disabled={disabled}
            onClick={() => commit(bps)}
          >
            {bps / 100}%
          </button>
        ))}
        {customSlip ? (
          <CustomSlippage current={slipBps} onCommit={commit} />
        ) : (
          <button
            type="button"
            className={`chip chip--slippage${customSlip ? ' chip--slippage-on' : ''}`}
            disabled={disabled}
            onClick={() => onCustomSlip(true)}
          >
            {(slipBps / 100).toFixed(1)}% Custom
          </button>
        )}
      </div>
    </div>
  )
}

function CustomSlippage({ current, onCommit }: { current: number; onCommit: (bps: number) => void }) {
  const [value, setValue] = useState(String(current / 100))
  const commit = () => {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    onCommit(Math.min(50, Math.round(parsed * 100)))
  }
  return (
    <span className="slippage__custom">
      <input
        className="mono"
        type="text"
        inputMode="decimal"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value.replace(/[^\d.]/g, ''))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
        onBlur={commit}
      />
      <span>%</span>
    </span>
  )
}

function TradeStepper({ approve, phase }: { approve: SendResult | null; phase: Phase }) {
  if (phase === 'idle' && approve === null) return null
  const step1Done = approve !== null
  const step2Active = phase === 'swapping'
  return (
    <ol className="stepper" aria-label="Transaction progress">
      <li className={`stepper__item${step1Done ? ' stepper__item--done' : phase === 'approving' ? ' stepper__item--active' : ''}`}>
        {step1Done ? (
          <ConfirmationChip seconds={approve?.seconds ?? 0} txHash={approve?.hash ?? ''} label="Approved" />
        ) : (
          <span>{phase === 'approving' ? '1 Approve \u2026' : '1 Approve'}</span>
        )}
      </li>
      <li className={`stepper__item${step2Active ? ' stepper__item--active' : ''}`}>
        <span>{step2Active ? '2 Swap \u2026' : '2 Swap'}</span>
      </li>
    </ol>
  )
}

function TradesFeed({
  rows,
  address,
  status,
  ticker,
}: {
  rows: Swap[]
  address: Address | null
  status: string
  ticker: string
}) {
  const me = address?.toLowerCase() ?? null
  return (
    <section className="card feed" aria-label="Recent trades">
      <div className="feed__head">
        <h3>Recent trades</h3>
        <span className="chip chip--simfeed">{ticker} / mUSD</span>
      </div>
      {rows.length === 0 ? (
        <p className="feed__empty">
          {status === 'unconfigured'
            ? 'Trades appear here once the indexer is live.'
            : status === 'error'
              ? 'Indexer unavailable. Retrying.'
              : 'No trades yet — be the first.'}
        </p>
      ) : (
        <table className="feed__table mono">
          <thead>
            <tr>
              <th>Time</th>
              <th>Side</th>
              <th>Size ({ticker})</th>
              <th>Price</th>
              <th>Trader</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const mine = me !== null && row.trader.toLowerCase() === me
              const sim = row.isSimulated || SIM_WALLETS.has(row.trader.toLowerCase())
              return (
                <tr key={`${row.id}-${index}`} className={mine ? 'feed__row--mine' : undefined}>
                  <td className="feed__time">{timeAgo(row.timestamp)}</td>
                  <td>
                    <span className={`feed__side${row.isBuy ? ' feed__side--buy' : ' feed__side--sell'}`}>
                      {row.isBuy ? 'Buy' : 'Sell'}
                    </span>
                    {sim && <span className="feed__sim" title="Simulated test wallet">SIM</span>}
                  </td>
                  <td>{formatAmount(BigInt(row.amountToken))}</td>
                  <td>{formatPrice(Number(row.price))}</td>
                  <td className="feed__trader">{shortAddress(row.trader)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="feed__note">Live from the indexer · SIM = simulated test wallet.</p>
    </section>
  )
}

function LiquidityCard({
  open,
  onToggle,
  tokenStr,
  onTokenStr,
  quoteStr,
  onQuoteStr,
  phase,
  elapsed,
  legBalance,
  usdBalance,
  liquidity,
  ticker,
  onAdd,
  onRemove,
}: {
  open: boolean
  onToggle: () => void
  tokenStr: string
  onTokenStr: (v: string) => void
  quoteStr: string
  onQuoteStr: (v: string) => void
  phase: Phase
  elapsed: number
  legBalance: bigint | null
  usdBalance: bigint | null
  liquidity: { shares: bigint; pct: number; tokenOut: bigint | null; quoteOut: bigint | null } | null
  ticker: string
  onAdd: () => void
  onRemove: () => void
}) {
  const busy = phase !== 'idle'
  const liqBusy = phase === 'liqApproving' || phase === 'addingLiquidity'
  const rmBusy = phase === 'removingLiquidity'
  const canAdd =
    parseAmount(tokenStr) > 0n && parseAmount(quoteStr) > 0n && !busy && legBalance !== null && usdBalance !== null
  const canRemove = liquidity !== null && liquidity.shares > 0n && !busy
  const shareText =
    liquidity === null || liquidity.pct <= 0
      ? 'No position yet'
      : `${liquidity.pct.toFixed(4)}% \u00b7 ${formatAmount(liquidity.shares)} shares`
  return (
    <section className="card liquidity">
      <button type="button" className="liquidity__toggle" onClick={onToggle} aria-expanded={open}>
        <h3>Provide liquidity</h3>
        <span className="liquidity__chev" aria-hidden>
          {open ? '\u2212' : '+'}
        </span>
      </button>
      {open && (
        <div className="liquidity__body">
          <div className="liquidity__inputs">
            <label className="amount">
              <span className="amount__label">{ticker}</span>
              <span className="amount__field">
                <input
                  className="amount__input mono"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={tokenStr}
                  disabled={busy}
                  onChange={(event) => onTokenStr(sanitizeAmount(event.target.value))}
                />
                <span className="amount__suffix mono">{ticker}</span>
              </span>
            </label>
            <label className="amount">
              <span className="amount__label">mUSD</span>
              <span className="amount__field">
                <input
                  className="amount__input mono"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={quoteStr}
                  disabled={busy}
                  onChange={(event) => onQuoteStr(sanitizeAmount(event.target.value))}
                />
                <span className="amount__suffix mono">mUSD</span>
              </span>
            </label>
          </div>
          <div className="liquidity__actions">
            <button type="button" className="btn btn--secondary" disabled={!canAdd} onClick={onAdd}>
              {liqBusy ? (phase === 'liqApproving' ? `Approving\u2026 ${elapsed.toFixed(1)} s` : `Adding\u2026 ${elapsed.toFixed(1)} s`) : 'Add liquidity'}
            </button>
          </div>
          <div className="liquidity__share">
            <span>
              Your pool share: <span className="mono">{shareText}</span>
            </span>
            {liquidity !== null && liquidity.tokenOut !== null && liquidity.pct > 0 && (
              <span className="mono muted">
                Removable ≈ {formatAmount(liquidity.tokenOut)} {ticker} + {formatAmount(liquidity.quoteOut)} mUSD
              </span>
            )}
            {canRemove ? (
              <button type="button" className="linkbtn" onClick={onRemove}>
                {rmBusy ? `Removing\u2026 ${elapsed.toFixed(1)} s` : 'Remove'}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

function CapModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Session limit</h2>
        <p className="muted">
          This trade is above your session limit ({formatUsd(SESSION_CAP_USD)}). Confirm with your
          passkey.
        </p>
        <button type="button" className="btn btn--primary" onClick={onConfirm}>
          Confirm with passkey
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function buttonLabel(
  phase: Phase,
  elapsed: number,
  amount: bigint,
  excess: boolean,
  impactTooHigh: boolean,
  acceptImpact: boolean,
  action: string,
): string {
  if (phase !== 'idle') return `Confirming\u2026 ${elapsed.toFixed(1)} s`
  if (amount <= 0n) return 'Enter an amount'
  if (excess) return 'Not enough balance'
  if (impactTooHigh && !acceptImpact) return 'Price impact too high'
  return action
}

function sanitizeAmount(raw: string): string {
  const value = raw.replace(/[^\d.]/g, '')
  const [head, ...rest] = value.split('.')
  if (rest.length === 0) return head
  return `${head}.${rest.join('').slice(0, 18)}`
}

function parseAmount(raw: string): bigint {
  const trimmed = raw.trim()
  if (trimmed === '') return 0n
  try {
    return parseEther(trimmed)
  } catch {
    return 0n
  }
}

function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const started = Date.now()
    const timer = window.setInterval(() => setSeconds((Date.now() - started) / 1000), 100)
    return () => window.clearInterval(timer)
  }, [active])
  return seconds
}

function humanizeError(error: unknown): string {
  const reason = revertReason(error)
  if (reason !== null) {
    const map: Record<string, string> = {
      'Pool: slippage': 'Price moved. Try again.',
      'Pool: zero input': 'Enter an amount above zero.',
      'Pool: empty pool': 'This pool has no liquidity yet.',
      'Pool: zero amounts': 'Enter amounts above zero.',
      'Pool: zero shares': 'Not enough pool shares.',
      'Pool: insufficient shares': 'Not enough pool shares.',
      'Pool: tiny first deposit': 'The first deposit is too small.',
      'ERC20: insufficient balance': 'Not enough balance.',
      'ERC20: insufficient allowance': 'Approval needed \u2014 try again.',
      'Pool: reentrant': 'Something went wrong \u2014 try again.',
    }
    for (const key of Object.keys(map)) {
      if (reason.includes(key)) return map[key]
    }
    return 'Transaction reverted.'
  }
  return describeError(error)
}

function handleTxError(error: unknown, hooks: { onFeeCredit?: () => void } = {}) {
  if (isRevertedTransactionError(error)) {
    toastError('Something went wrong \u2014 view details', {
      actions: [
        {
          label: 'View details',
          onClick: () => window.open(explorerTxUrl(error.hash), '_blank', 'noopener'),
        },
      ],
    })
    return
  }
  if (isOutOfFeeCredit(error)) {
    toastError("You're out of network fee credit.", {
      actions: [
        ...(hooks.onFeeCredit ? [{ label: 'Add fee credit', onClick: hooks.onFeeCredit }] : []),
        { label: 'Use the faucet', onClick: () => window.open(FAUCET_URL, '_blank', 'noopener') },
      ],
    })
    return
  }
  toastError(humanizeError(error))
}

function revertReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.reason ?? reverted.data?.errorName ?? 'reverted'
  }
  return null
}