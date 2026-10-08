import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatEther, maxUint256, parseEther } from 'viem'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { CHAIN } from '../chain/addresses'
import { GAS_LIMITS } from '../chain/gas'
import { MOCK_STOCK_ABI, MOCK_USD_ABI, SPLITTER_ABI } from '../chain/abis'
import { useChainState } from '../chain/multicall'
import { useSession, isRevertedTransactionError } from '../wallet/session'
import type { SendResult } from '../wallet/session'
import { ConfirmationChip } from '../ui/ConfirmationChip'
import { toastError } from '../ui/toast'
import { FAUCET_URL, describeError, explorerTxUrl } from '../wallet/mera'
import { Link } from '../router'
import './Split.css'

const MIN_MON = parseEther('0.05')
const DEFAULT_AMOUNT = '100'
const LEG_TAGLINE_PRICE = 'The stock\u2019s ups and downs. Redeem for the stock at maturity.'
const LEG_TAGLINE_DIV = 'Every dividend paid until maturity, in mUSD.'
const RISK_COPY =
  'Before you split \u2014 Dividend legs are worth nothing after maturity. Legs can trade below fair value and you may lose value. This is a demo with mock assets.'

type Phase = 'idle' | 'approving' | 'splitting' | 'merging' | 'redeeming' | 'drip' | 'macme' | 'musd'

export default function Split() {
  const session = useSession()
  const address = session.wallet?.account.address ?? null
  const state = useChainState(address)

  const [tab, setTab] = useState<'split' | 'merge'>('split')
  const [amountStr, setAmountStr] = useState(DEFAULT_AMOUNT)
  const [phase, setPhase] = useState<Phase>('idle')
  const [approve, setApprove] = useState<SendResult | null>(null)
  const [last, setLast] = useState<{ result: SendResult; label: string } | null>(null)
  const [animating, setAnimating] = useState(false)
  const [dripNote, setDripNote] = useState<string | null>(null)
  const timers = useRef<number[]>([])

  const loading = state.loading
  const offline = state.offline

  const stockBalance = state.stockBalance
  const usdBalance = state.usdBalance
  const priceBalance = state.priceLegBalance
  const divBalance = state.divLegBalance
  const monBalance = state.monBalance
  const allowance = state.stockAllowance

  const [now, setNow] = useState(() => Date.now() / 1000)

  const dividendFair = useMemo(() => {
    if (state.remainingDividends === null || state.amountPerShare === null) return null
    return state.remainingDividends * state.amountPerShare
  }, [state.remainingDividends, state.amountPerShare])

  const priceFair =
    state.refPrice !== null && dividendFair !== null ? state.refPrice - dividendFair : null

  const [, forceTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now() / 1000)
      forceTick((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const matured = state.maturity !== null && now >= Number(state.maturity)

  useEffect(() => {
    const owned = timers.current
    return () => owned.forEach((t) => window.clearTimeout(t))
  }, [])

  const mergeMax =
    priceBalance !== null && divBalance !== null
      ? priceBalance < divBalance
        ? priceBalance
        : divBalance
      : null

  const amount = parseAmount(amountStr)
  const amountUsd =
    amount > 0n && state.refPrice !== null ? Number(formatEther(amount)) * state.refPrice : null
  const needsApprove = allowance !== null && allowance < amount
  const exceedsBalance = stockBalance !== null && amount > stockBalance
  const busy = phase !== 'idle'
  const canSplit = !!session.wallet && !loading && !matured && amount > 0n && !exceedsBalance && !busy
  const canMerge =
    !!session.wallet && !loading && !matured && mergeMax !== null && amount > 0n && amount <= mergeMax && !busy
  const elapsed = useElapsedSeconds(busy)

  const refresh = state.refresh

  const runSplit = useCallback(async () => {
    if (busy || amount <= 0n || session.wallet === null) return
    const value = amount
    setPhase(needsApprove ? 'approving' : 'splitting')
    try {
      if (needsApprove) {
        const approveResult = await session.send({
          to: CHAIN.stock,
          abi: MOCK_STOCK_ABI,
          functionName: 'approve',
          args: [CHAIN.splitter, maxUint256],
          gas: GAS_LIMITS.approve,
        })
        setApprove(approveResult)
        setPhase('splitting')
      }
      const result = await session.send({
        to: CHAIN.splitter,
        abi: SPLITTER_ABI,
        functionName: 'split',
        args: [value],
        gas: GAS_LIMITS.split,
        usdValue: amountUsd ?? 0,
      })
      setLast({ result, label: `Split ${formatEther(value)} mACME` })
      setAnimating(true)
      timers.current.push(window.setTimeout(() => setAnimating(false), 1500))
      refresh()
    } catch (error) {
      handleTxError(error)
    } finally {
      setPhase('idle')
    }
  }, [busy, amount, needsApprove, amountUsd, session, refresh])

  const runMerge = useCallback(async () => {
    if (busy || amount <= 0n || session.wallet === null) return
    const value = amount
    setPhase('merging')
    try {
      const result = await session.send({
        to: CHAIN.splitter,
        abi: SPLITTER_ABI,
        functionName: 'merge',
        args: [value],
        gas: GAS_LIMITS.merge,
      })
      setLast({ result, label: `Merge ${formatEther(value)} legs` })
      refresh()
    } catch (error) {
      handleTxError(error)
    } finally {
      setPhase('idle')
    }
  }, [busy, amount, session, refresh])

  const runRedeem = useCallback(async () => {
    if (busy || priceBalance === null || priceBalance === 0n || session.wallet === null) return
    const value = priceBalance
    setPhase('redeeming')
    try {
      const result = await session.send({
        to: CHAIN.splitter,
        abi: SPLITTER_ABI,
        functionName: 'redeem',
        args: [value],
        gas: GAS_LIMITS.merge,
      })
      setLast({ result, label: `Redeemed ${formatEther(value)} mACME` })
      setAmountStr(DEFAULT_AMOUNT)
      refresh()
    } catch (error) {
      handleTxError(error)
    } finally {
      setPhase('idle')
    }
  }, [busy, priceBalance, session, refresh])

  const runFaucet = useCallback(
    async (kind: 'macme' | 'musd') => {
      if (busy || session.wallet === null) return
      setPhase(kind)
      try {
        const result = await session.send(
          kind === 'macme'
            ? {
                to: CHAIN.stock,
                abi: MOCK_STOCK_ABI,
                functionName: 'faucet',
                args: [],
                gas: GAS_LIMITS.faucet,
              }
            : {
                to: CHAIN.usd,
                abi: MOCK_USD_ABI,
                functionName: 'faucet',
                args: [],
                gas: GAS_LIMITS.faucet,
              },
        )
        setLast({
          result,
          label: kind === 'macme' ? '1,000 mACME claimed' : '10,000 mUSD claimed',
        })
        refresh()
      } catch (error) {
        handleTxError(error)
      } finally {
        setPhase('idle')
      }
    },
    [busy, session, refresh],
  )

  const runDrip = useCallback(async () => {
    if (busy || session.wallet === null) return
    setPhase('drip')
    setDripNote(null)
    try {
      const res = await fetch('/api/drip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: session.wallet.account.address }),
      })
      const data = (await res.json()) as {
        status?: 'sent' | 'skipped' | 'error'
        txHash?: string
        reason?: string
        error?: string
      }
      if (data.status === 'sent') {
        setLast({
          result: { hash: data.txHash as `0x${string}`, seconds: 0, isFirst: false },
          label: '0.25 MON fee credit added',
        })
        refresh()
      } else if (data.status === 'skipped') {
        setDripNote(data.reason ?? 'Fee credit temporarily unavailable')
      } else {
        setDripNote('Fee credit temporarily unavailable')
      }
    } catch {
      setDripNote('Fee credit temporarily unavailable')
    } finally {
      setPhase('idle')
    }
  }, [busy, session, refresh])

  const stepsDone: [boolean, boolean, boolean] = [
    monBalance !== null && monBalance >= MIN_MON,
    stockBalance !== null && stockBalance > 0n,
    usdBalance !== null && usdBalance > 0n,
  ]
  const allStepsDone = stepsDone.every(Boolean)
  const doneCount = stepsDone.filter(Boolean).length

  return (
    <div className="split">
      <StarterPack
        loading={loading}
        phase={phase}
        stepsDone={stepsDone}
        allDone={allStepsDone}
        doneCount={doneCount}
        dripNote={dripNote}
        firstBadge={last?.result.isFirst ? `\u26A1 First transaction` : null}
        onDrip={runDrip}
        onMacme={() => void runFaucet('macme')}
        onMusd={() => void runFaucet('musd')}
      />

      <div className="split__grid">
        <section className="card split__main" aria-label="Split or merge">
          <TabBar tab={tab} onChange={setTab} disabled={busy} />

          {matured && (
            <div className="banner banner--warn" role="status">
              Series A has matured. Price legs can now be redeemed for stock.
            </div>
          )}

          {tab === 'split' ? (
            <SplitTab
              loading={loading}
              offline={offline}
              matured={matured}
              amountStr={amountStr}
              amount={amount}
              amountUsd={amountUsd}
              priceFair={priceFair}
              dividendFair={dividendFair}
              stockBalance={stockBalance}
              exceedsBalance={exceedsBalance}
              canSplit={canSplit}
              phase={phase}
              elapsed={elapsed}
              approve={approve}
              animating={animating}
              last={last}
              onAmount={setAmountStr}
              onMax={() => setAmountStr(stockBalance !== null ? formatEther(stockBalance) : '0')}
              onSplit={() => void runSplit()}
            />
          ) : (
            <MergeTab
              loading={loading}
              matured={matured}
              amountStr={amountStr}
              amount={amount}
              mergeMax={mergeMax}
              priceBalance={priceBalance}
              divBalance={divBalance}
              canMerge={canMerge}
              phase={phase}
              elapsed={elapsed}
              last={last}
              onAmount={setAmountStr}
              onMax={() => setAmountStr(mergeMax !== null ? formatEther(mergeMax) : '0')}
              onMerge={() => void runMerge()}
              onRedeem={() => void runRedeem()}
            />
          )}
        </section>

        <aside className="split__rail">
          <HowItWorks />
          <SeriesCard
            loading={loading}
            series={{
              maturity: state.maturity,
              plannedDividends: state.plannedDividends,
              distributedCount: state.distributedCount,
              remainingDividends: state.remainingDividends,
              amountPerShare: state.amountPerShare,
              latestSource: state.latestSource,
              oracleCount: state.oracleCount,
            }}
            refPrice={state.refPrice}
            matured={matured}
          />
          <section className="card risk-box">
            <h3>Risk</h3>
            <p>{RISK_COPY}</p>
            <Link to="/about" className="risk-box__link">
              More in About &amp; risks
            </Link>
          </section>
        </aside>
      </div>
    </div>
  )
}

type TabBarProps = {
  tab: 'split' | 'merge'
  onChange: (tab: 'split' | 'merge') => void
  disabled: boolean
}

function TabBar({ tab, onChange, disabled }: TabBarProps) {
  return (
    <div className="segmented" role="tablist" aria-label="Choose an action">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'split'}
        className={`segmented__btn${tab === 'split' ? ' segmented__btn--on' : ''}`}
        disabled={disabled}
        onClick={() => onChange('split')}
      >
        Split
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'merge'}
        className={`segmented__btn${tab === 'merge' ? ' segmented__btn--on' : ''}`}
        disabled={disabled}
        onClick={() => onChange('merge')}
      >
        Merge
      </button>
    </div>
  )
}

type SplitTabProps = {
  loading: boolean
  offline: boolean
  matured: boolean
  amountStr: string
  amount: bigint
  amountUsd: number | null
  priceFair: number | null
  dividendFair: number | null
  stockBalance: bigint | null
  exceedsBalance: boolean
  canSplit: boolean
  phase: Phase
  elapsed: number
  approve: SendResult | null
  animating: boolean
  last: { result: SendResult; label: string } | null
  onAmount: (v: string) => void
  onMax: () => void
  onSplit: () => void
}

function SplitTab({
  loading,
  offline,
  matured,
  amountStr,
  amount,
  amountUsd,
  priceFair,
  dividendFair,
  stockBalance,
  exceedsBalance,
  canSplit,
  phase,
  elapsed,
  approve,
  animating,
  last,
  onAmount,
  onMax,
  onSplit,
}: SplitTabProps) {
  const label = splitButtonLabel(phase, elapsed, amount, exceedsBalance, matured)
  return (
    <div className="split__tab">
      <div className="split__holdrow">
        <span>You hold</span>
        <span className="mono split__balance">
          {loading ? '\u2026' : balanceText(stockBalance)}
          {!matured && stockBalance !== null && stockBalance > 0n && phase === 'idle' ? (
            <button type="button" className="linkbtn" onClick={onMax}>
              Max
            </button>
          ) : null}
        </span>
      </div>

      <AmountInput
        label="Amount of mACME"
        value={amountStr}
        disabled={matured || phase !== 'idle'}
        onChange={onAmount}
        inlineHint={amountUsd !== null ? `\u2248 $${amountUsd.toFixed(2)}` : null}
      />

      {matured ? (
        <p className="field-error">Series has matured.</p>
      ) : exceedsBalance ? (
        <p className="field-error">Not enough mACME.</p>
      ) : offline && !loading ? (
        <p className="field-error">Live data delayed \u2014 try again in a moment.</p>
      ) : null}

      <div className={`splitflow${animating ? ' splitflow--anim' : ''}`} aria-hidden="true">
        <span className="splitflow__stem" />
        <div className="splitflow__legs">
          <LegCard
            kind="price"
            ticker="pACME-A"
            amount={formatEther(amount)}
            fair={priceFair}
            tagline={LEG_TAGLINE_PRICE}
          />
          <LegCard
            kind="div"
            ticker="dACME-A"
            amount={formatEther(amount)}
            fair={dividendFair}
            tagline={LEG_TAGLINE_DIV}
          />
        </div>
      </div>

      <Stepper approve={approve} phase={phase} />

      <button type="button" className="btn btn--full btn--lg btn--twotone" disabled={!canSplit} onClick={onSplit}>
        {label}
      </button>

      {phase === 'idle' && last !== null && (
        <div className="split__whatnext">
          <ConfirmationChip seconds={last.result.seconds} txHash={last.result.hash} label={last.label} />
          <span className="split__whatnext-links">
            <Link to="/trade/price">Trade your legs \u2192</Link>
            <Link to="/dividends">See dividends \u2192</Link>
          </span>
        </div>
      )}
    </div>
  )
}

type MergeTabProps = {
  loading: boolean
  matured: boolean
  amountStr: string
  amount: bigint
  mergeMax: bigint | null
  priceBalance: bigint | null
  divBalance: bigint | null
  canMerge: boolean
  phase: Phase
  elapsed: number
  last: { result: SendResult; label: string } | null
  onAmount: (v: string) => void
  onMax: () => void
  onMerge: () => void
  onRedeem: () => void
}

function MergeTab({
  loading,
  matured,
  amountStr,
  amount,
  mergeMax,
  priceBalance,
  divBalance,
  canMerge,
  phase,
  elapsed,
  last,
  onAmount,
  onMax,
  onMerge,
  onRedeem,
}: MergeTabProps) {
  if (matured) {
    const hasPrice = priceBalance !== null && priceBalance > 0n
    return (
      <div className="split__tab">
        <label className="amount">
          <span className="amount__label">Redeem</span>
          <span className="amount__value mono">{balanceText(priceBalance)} pACME-A \u2192 {balanceText(priceBalance)} mACME</span>
        </label>
        <div className="amount" style={{ paddingTop: 8 }}>
          <span className="amount__label">Dividend leg</span>
          <span className="amount__value mono muted">{balanceText(divBalance)} dACME-A \u2014 expired</span>
        </div>
        <p className="muted">
          Series has matured. Redeem Price legs for stock instead. Dividend legs are worth nothing
          now.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--lg btn--full"
          disabled={!hasPrice || phase !== 'idle'}
          onClick={onRedeem}
        >
          {phase === 'redeeming' ? `Redeeming\u2026 ${elapsed.toFixed(1)} s` : 'Redeem Price legs for stock'}
        </button>
        {phase === 'idle' && last !== null && (
          <ConfirmationChip seconds={last.result.seconds} txHash={last.result.hash} label={last.label} />
        )}
      </div>
    )
  }

  const exceeds = mergeMax !== null && amount > mergeMax
  const label = mergeButtonLabel(phase, elapsed, amount, exceeds)
  return (
    <div className="split__tab">
      <div className="split__holdrow">
        <span>You hold</span>
        <span className="mono split__balance">
          {loading ? '\u2026' : `${balanceText(priceBalance)} pACME-A \u00b7 ${balanceText(divBalance)} dACME-A`}
          {mergeMax !== null && mergeMax > 0n && phase === 'idle' ? (
            <button type="button" className="linkbtn" onClick={onMax}>
              Max
            </button>
          ) : null}
        </span>
      </div>

      <AmountInput
        label="Amount of legs to merge"
        value={amountStr}
        disabled={phase !== 'idle'}
        onChange={onAmount}
        inlineHint={null}
      />

      {exceeds && <p className="field-error">Not enough of both legs to merge.</p>}

      <div className="splitflow splitflow--merge" aria-hidden="true">
        <div className="splitflow__legs">
          <LegCard kind="price" ticker="pACME-A" amount={formatEther(amount)} fair={null} tagline={null} />
          <LegCard kind="div" ticker="dACME-A" amount={formatEther(amount)} fair={null} tagline={null} />
        </div>
        <span className="splitflow__stem splitflow__stem--merge" />
        <div className="splitflow__out">
          <span className="dot dot--stock" />
          <span className="mono">You receive {formatEther(amount)} mACME</span>
        </div>
      </div>

      <button type="button" className="btn btn--full btn--lg btn--merge" disabled={!canMerge} onClick={onMerge}>
        {label}
      </button>
      <p className="split__note">Unclaimed dividends stay claimable after you merge.</p>
      {phase === 'idle' && last !== null && (
        <ConfirmationChip seconds={last.result.seconds} txHash={last.result.hash} label={last.label} />
      )}
    </div>
  )
}

type AmountInputProps = {
  label: string
  value: string
  disabled: boolean
  onChange: (v: string) => void
  inlineHint: string | null
}

function AmountInput({ label, value, disabled, onChange, inlineHint }: AmountInputProps) {
  return (
    <label className="amount">
      <span className="amount__label">{label}</span>
      <span className="amount__field">
        <input
          className="amount__input mono"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(sanitizeAmount(event.target.value))}
        />
        <span className="amount__suffix mono">mACME</span>
      </span>
      {inlineHint !== null && <span className="amount__hint mono">{inlineHint}</span>}
    </label>
  )
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

function balanceText(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return '\u2014'
  const n = Number(formatEther(value))
  if (n >= 100_000) return Math.round(n).toLocaleString('en-US')
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2 })
}

function splitButtonLabel(
  phase: Phase,
  elapsed: number,
  amount: bigint,
  exceeds: boolean,
  matured: boolean,
): string {
  if (matured) return 'Series has matured'
  if (phase === 'approving' || phase === 'splitting') return `Confirming\u2026 ${elapsed.toFixed(1)} s`
  if (exceeds) return 'Not enough mACME'
  return `Split ${formatEther(amount)} mACME`
}

function mergeButtonLabel(phase: Phase, elapsed: number, amount: bigint, exceeds: boolean): string {
  if (phase === 'merging') return `Confirming\u2026 ${elapsed.toFixed(1)} s`
  if (exceeds) return 'Not enough of both legs'
  return `Merge ${formatEther(amount)} legs`
}

function LegCard({
  kind,
  ticker,
  amount,
  fair,
  tagline,
}: {
  kind: 'price' | 'div'
  ticker: string
  amount: string
  fair: number | null
  tagline: string | null
}) {
  return (
    <div className={`legcard legcard--${kind}`}>
      <h3 className="legcard__title">{kind === 'price' ? 'Price leg' : 'Dividend leg'}</h3>
      <span className="mono legcard__ticker">{ticker}</span>
      <span className="legcard__receive">
        You receive <strong>{amount}</strong>
      </span>
      {fair !== null && <span className="mono legcard__fair">Fair value \u2248 ${fair.toFixed(2)} each</span>}
      {tagline !== null && <span className="legcard__tagline">{tagline}</span>}
    </div>
  )
}

function Stepper({
  approve,
  phase,
}: {
  approve: SendResult | null
  phase: Phase
}) {
  if (phase === 'idle' && approve === null) return null
  const step1Done = approve !== null
  const step2Active = phase === 'splitting'
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
        <span>{step2Active ? '2 Split \u2026' : '2 Split'}</span>
      </li>
    </ol>
  )
}

type StarterPackProps = {
  loading: boolean
  phase: Phase
  stepsDone: [boolean, boolean, boolean]
  allDone: boolean
  doneCount: number
  dripNote: string | null
  firstBadge: string | null
  onDrip: () => void
  onMacme: () => void
  onMusd: () => void
}

const STARTER_STEPS = [
  { label: 'Get network fee credit', key: 'drip', cta: 'Add fee credit' },
  { label: 'Get 1,000 mACME', key: 'faucet', cta: 'Get mACME' },
  { label: 'Get 10,000 mUSD', key: 'faucet', cta: 'Get mUSD' },
] as const

function StarterPack({
  loading,
  phase,
  stepsDone,
  allDone,
  doneCount,
  dripNote,
  firstBadge,
  onDrip,
  onMacme,
  onMusd,
}: StarterPackProps) {
  const busyFor: Record<string, boolean> = {
    drip: phase === 'drip',
    macme: phase === 'macme',
    musd: phase === 'musd',
  }

  if (loading) {
    return (
      <section className="card starter">
        <div className="skeleton" style={{ width: 200, height: 16 }} aria-hidden />
      </section>
    )
  }

  if (allDone && phase === 'idle') {
    return (
      <section className="card starter starter--done">
        <span className="starter__ring" aria-hidden>
          <Ring done={3} total={3} />
        </span>
        <span>Starter pack claimed \u2713</span>
        <span className="starter__explainer">Test tokens only. They have no value.</span>
      </section>
    )
  }

  const names = ['drip', 'macme', 'musd'] as const
  const handlers = [onDrip, onMacme, onMusd] as const

  return (
    <section className="card starter" aria-label="Starter pack">
      <header className="starter__head">
        <h3>Starter pack</h3>
        <Ring done={doneCount} total={3} />
      </header>
      <ul className="starter__steps">
        {STARTER_STEPS.map((step, index) => {
          const done = stepsDone[index]
          const name = names[index]
          const busyStep = busyFor[name]
          return (
            <li key={step.label} className="starter__step">
              <span className={`starter__check${done ? ' starter__check--done' : ''}`} aria-hidden>
                {done ? '\u2713' : busyStep ? '\u2022' : ''}
              </span>
              <span className="starter__label">{step.label}</span>
              {done ? null : (
                <button type="button" className="btn btn--sm" disabled={busyStep || phase !== 'idle'} onClick={handlers[index]}>
                  {busyStep ? 'Adding\u2026' : step.cta}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {firstBadge !== null && <span className="chip chip--sunburst">{firstBadge}</span>}
      {dripNote !== null && (
        <p className="starter__note">
          {dripNote}
          {/fee credit|faucet/i.test(dripNote) && (
            <>
              {' '}
              <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                Use the Monad faucet &#8599;
              </a>
            </>
          )}
        </p>
      )}
      <p className="starter__explainer">Test tokens only. They have no value.</p>
    </section>
  )
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 9
  const c = 2 * Math.PI * r
  const fraction = total > 0 ? done / total : 0
  return (
    <svg className="ring" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" className="ring__track" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        className="ring__fill"
        strokeWidth="3"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
      />
    </svg>
  )
}

function HowItWorks() {
  return (
    <section className="card howitworks">
      <h3>How it works</h3>
      <ol className="howitworks__steps">
        <li>Deposit stock</li>
        <li>Receive two legs</li>
        <li>Trade, hold or merge back</li>
      </ol>
      <p className="mono howitworks__formula">1 pACME-A + 1 dACME-A = 1 mACME</p>
    </section>
  )
}

type SeriesData = {
  maturity: bigint | null
  plannedDividends: number | null
  distributedCount: number | null
  remainingDividends: number | null
  amountPerShare: number | null
  latestSource: number | null
  oracleCount: number | null
}

function countdownText(maturity: bigint | null): string {
  if (maturity === null) return '\u2014'
  const ms = Number(maturity) * 1000 - Date.now()
  if (ms <= 0) return 'matured'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${minutes}m`
  return `in ${minutes}m`
}

function maturityDate(maturity: bigint | null): string {
  if (maturity === null) return '\u2014'
  return new Date(Number(maturity) * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SeriesCard({
  loading,
  series,
  refPrice,
  matured,
}: {
  loading: boolean
  series: SeriesData
  refPrice: number | null
  matured: boolean
}) {
  const lastSource = series.latestSource === 0 ? 'CRE' : series.latestSource === 1 ? 'Demo' : null
  const dividendLine =
    series.oracleCount !== null && series.oracleCount > 0 && series.amountPerShare !== null
      ? `$${series.amountPerShare.toFixed(2)} / share${lastSource !== null ? ` \u00b7 ${lastSource}` : ''}`
      : 'None yet'
  return (
    <section className="card series">
      <h3>Series A details</h3>
      <dl className="series__grid">
        <div>
          <dt>Matures</dt>
          <dd className="series__matures">
            {loading ? '\u2026' : matured ? 'Matured' : countdownText(series.maturity)}
            <span className="series__date">{loading ? '' : maturityDate(series.maturity)}</span>
          </dd>
        </div>
        <div>
          <dt>Dividends</dt>
          <dd className="mono">
            planned {loading ? '\u2026' : series.plannedDividends ?? '\u2014'} \u00b7 paid{' '}
            {loading ? '\u2026' : series.distributedCount ?? '\u2014'} \u00b7 remaining{' '}
            {loading ? '\u2026' : series.remainingDividends ?? '\u2014'}
          </dd>
        </div>
        <div>
          <dt>Last declared dividend</dt>
          <dd className="mono">{loading ? '\u2026' : dividendLine}</dd>
        </div>
        <div>
          <dt>Reference price</dt>
          <dd className="mono">{loading ? '\u2026' : refPrice !== null ? `$${refPrice.toFixed(2)}` : '\u2014'}</dd>
        </div>
      </dl>
    </section>
  )
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
      'Splitter: matured': 'Series matured.',
      'Splitter: not matured': 'The series has not matured yet.',
      'Splitter: zero amount': 'Enter an amount above zero.',
      'Splitter: reentrant': 'Something went wrong \u2014 try again.',
      'ERC20: insufficient balance': 'Not enough balance.',
      'ERC20: insufficient allowance': 'Approval needed \u2014 try again.',
      'ERC20: transfer to the zero address': 'Something went wrong \u2014 try again.',
    }
    for (const key of Object.keys(map)) {
      if (reason.includes(key)) return map[key]
    }
    return 'Transaction reverted.'
  }
  return describeError(error)
}

function handleTxError(error: unknown) {
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