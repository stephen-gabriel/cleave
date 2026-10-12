import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatEther, parseEther } from 'viem'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { CHAIN } from '../chain/addresses'
import { GAS_LIMITS } from '../chain/gas'
import { DIVIDEND_ORACLE_ABI, SPLIT_TOKEN_ABI, SPLITTER_ABI } from '../chain/abis'
import { useChainState } from '../chain/multicall'
import { useSession, isRevertedTransactionError } from '../wallet/session'
import { isOutOfFeeCredit } from '../wallet/txFailure'
import type { SendResult } from '../wallet/session'
import { ConfirmationChip } from '../ui/ConfirmationChip'
import { toastError } from '../ui/toast'
import { FAUCET_URL, describeError, explorerTxUrl } from '../wallet/mera'
import { Link } from '../router'
import { refreshEnvioStore, envioConfigured, useEnvio } from '../data/useEnvio'
import { queries } from '../data/envio'
import type { Declaration } from '../data/envio'
import './Dividends.css'

const DEMO_COOLDOWN_SECONDS = 120
const NOTICE_SECONDS = 60

type DeclarationStatus = 'none' | 'countdown' | 'ready' | 'paid'
type Phase = 'idle' | 'claiming' | 'declaring' | 'distributing' | 'drip'

export default function Dividends() {
  const session = useSession()
  const address = session.wallet?.account.address ?? null
  const state = useChainState(address)

  const [phase, setPhase] = useState<Phase>('idle')
  const [last, setLast] = useState<{ result: SendResult; label: string } | null>(null)
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000)
  const timers = useRef<number[]>([])

  const loading = state.loading
  const divBalance = state.divLegBalance
  const divPending = state.divLegPending
  const maturity = state.maturity
  const plannedDividends = state.plannedDividends
  const distributedCount = state.distributedCount
  const oracleCount = state.oracleCount
  const amountPerShare = state.amountPerShare
  const latestSource = state.latestSource
  const refPrice = state.refPrice

  const declarations = useEnvio(queries.declarations(50))

  const totalEarned = useMemo(() => {
    if (divPending === null) return 0
    return Number(formatEther(divPending))
  }, [divPending])

  const matured = maturity !== null && nowSec >= Number(maturity)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowSec(Date.now() / 1000)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const owned = timers.current
    return () => owned.forEach((t) => window.clearTimeout(t))
  }, [])

  const latestDeclaration = useMemo(() => {
    if (oracleCount === null || oracleCount === 0 || amountPerShare === null || latestSource === null) {
      return null
    }
    return {
      id: oracleCount,
      amountPerShare,
      refPrice: refPrice ?? 0,
      source: (latestSource === 0 ? 'CRE' : 'Demo') as 'CRE' | 'Demo',
    }
  }, [oracleCount, amountPerShare, refPrice, latestSource])

  const declarationStatus = useMemo((): DeclarationStatus => {
    if (!latestDeclaration) return 'none'
    if (matured) return 'paid'
    const exAt = getExAt(latestDeclaration.id)
    if (exAt === null) return 'none'
    if (nowSec < exAt) return 'countdown'
    const distCount = distributedCount ?? 0
    if (distCount < latestDeclaration.id) return 'ready'
    return 'paid'
  }, [latestDeclaration, matured, distributedCount, nowSec])

  const nextExAt = useMemo(() => {
    if (!latestDeclaration) return null
    return getExAt(latestDeclaration.id)
  }, [latestDeclaration])

  const busy = phase !== 'idle'
  const canClaim = !!session.wallet && !loading && divPending !== null && divPending > 0n && !busy
  const elapsed = useElapsedSeconds(busy)

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
      const data = (await res.json()) as { status?: 'sent' | 'skipped' | 'error'; txHash?: string; reason?: string }
      if (data.status === 'sent') {
        setLast({ result: { hash: data.txHash as `0x${string}`, seconds: 0, isFirst: false }, label: '0.25 MON fee credit added' })
        refresh()
      }
    } catch {
      // Fee credit unavailable, user can retry
    } finally {
      setPhase('idle')
    }
  }, [busy, session, refresh])

  const runClaim = useCallback(async () => {
    if (busy || divPending === null || divPending === 0n || session.wallet === null) return
    setPhase('claiming')
    try {
      const result = await session.send({
        to: CHAIN.divLeg,
        abi: SPLIT_TOKEN_ABI,
        functionName: 'claim',
        args: [],
        gas: GAS_LIMITS.claim,
      })
      setLast({ result, label: `Claimed ${formatEther(divPending)} mUSD` })
      refreshEnvioStore()
      refresh()
    } catch (error) {
      handleTxError(error, { onFeeCredit: runDrip })
    } finally {
      setPhase('idle')
    }
  }, [busy, divPending, session, refresh, runDrip])

  const runDeclareDemo = useCallback(async () => {
    if (busy || session.wallet === null || amountPerShare === null) return
    setPhase('declaring')
    try {
      const result = await session.send({
        to: CHAIN.oracle,
        abi: DIVIDEND_ORACLE_ABI,
        functionName: 'declareDemo',
        args: [parseEther(amountPerShare.toFixed(2))],
        gas: GAS_LIMITS.declareDemo,
      })
      setLast({ result, label: 'Demo dividend declared' })
      refreshEnvioStore()
      refresh()
    } catch (error) {
      handleTxError(error, { onFeeCredit: runDrip })
    } finally {
      setPhase('idle')
    }
  }, [busy, session, amountPerShare, refresh, runDrip])

  const runDistribute = useCallback(async () => {
    if (busy || session.wallet === null) return
    setPhase('distributing')
    try {
      const result = await session.send({
        to: CHAIN.splitter,
        abi: SPLITTER_ABI,
        functionName: 'distribute',
        args: [],
        gas: GAS_LIMITS.distribute,
      })
      setLast({ result, label: 'Dividend distributed' })
      refreshEnvioStore()
      refresh()
    } catch (error) {
      handleTxError(error, { onFeeCredit: runDrip })
    } finally {
      setPhase('idle')
    }
  }, [busy, session, refresh, runDrip])

  const demoCooldownRemaining = useMemo(() => {
    if (latestDeclaration === null || latestDeclaration.source !== 'Demo') return 0
    if (distributedCount === null || distributedCount === 0) return 0
    const lastDeclaredAt = getDeclaredAt(latestDeclaration.id)
    if (lastDeclaredAt === null) return 0
    const remaining = lastDeclaredAt + DEMO_COOLDOWN_SECONDS - nowSec
    return Math.max(0, remaining)
  }, [latestDeclaration, distributedCount, nowSec])

  const envioError = declarations.status === 'error'

  return (
    <div className="dividends">
      <SummaryCard
        totalEarned={totalEarned}
        divBalance={divBalance}
        canClaim={canClaim}
        phase={phase}
        elapsed={elapsed}
        onClaim={runClaim}
        last={last}
      />

      <NextDividendPanel
        matured={matured}
        status={declarationStatus}
        declaration={latestDeclaration}
        nextExAt={nextExAt}
        plannedDividends={plannedDividends}
        distributedCount={distributedCount}
        demoCooldownRemaining={demoCooldownRemaining}
        nowSec={nowSec}
        phase={phase}
        elapsed={elapsed}
        onDeclareDemo={runDeclareDemo}
        onDistribute={runDistribute}
        disabled={busy || !session.wallet}
      />

      <TimelineList
        loading={declarations.status === 'loading'}
        error={envioError}
        declarations={declarations.data ?? []}
        envioConfigured={envioConfigured()}
      />

      <EducationFooter />
    </div>
  )
}

function getExAt(_id: number): number | null {
  // In production this would look up from Envio or chain state
  return null
}

function getDeclaredAt(_id: number): number | null {
  // In production this would look up from Envio or chain state
  return null
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

function SummaryCard({
  totalEarned,
  divBalance,
  canClaim,
  phase,
  elapsed,
  onClaim,
  last,
}: {
  totalEarned: number
  divBalance: bigint | null
  canClaim: boolean
  phase: Phase
  elapsed: number
  onClaim: () => void
  last: { result: SendResult; label: string } | null
}) {
  const balanceText = divBalance === null ? '…' : Number(formatEther(divBalance)).toLocaleString('en-US', { maximumFractionDigits: 2 })

  return (
    <section className="card summary" aria-label="Dividend summary">
      <div className="summary__main">
        <h2>Your dividend legs have earned <span className="mono">${totalEarned.toFixed(2)} mUSD</span></h2>
        <p className="summary__balance">Dividend leg balance: <span className="mono">{balanceText}</span> dACME-A</p>
      </div>
      <div className="summary__actions">
        <button
          type="button"
          className={`btn btn--lg btn--leg-div${!canClaim ? ' btn--disabled' : ''}`}
          disabled={!canClaim}
          onClick={onClaim}
        >
          {phase === 'claiming' ? `Claiming\u2026 ${elapsed.toFixed(1)} s` : totalEarned > 0 ? `Claim ${totalEarned.toFixed(2)} mUSD` : 'Nothing to claim yet'}
        </button>
      </div>
      {phase === 'idle' && last !== null && (
        <ConfirmationChip seconds={last.result.seconds} txHash={last.result.hash} label={last.label} />
      )}
    </section>
  )
}

function NextDividendPanel({
  matured,
  status,
  declaration,
  nextExAt,
  plannedDividends,
  distributedCount,
  demoCooldownRemaining,
  nowSec,
  phase,
  elapsed,
  onDeclareDemo,
  onDistribute,
  disabled,
}: {
  matured: boolean
  status: DeclarationStatus
  declaration: { id: number; amountPerShare: number; refPrice: number; source: 'CRE' | 'Demo' } | null
  nextExAt: number | null
  plannedDividends: number | null
  distributedCount: number | null
  demoCooldownRemaining: number
  nowSec: number
  phase: Phase
  elapsed: number
  onDeclareDemo: () => void
  onDistribute: () => void
  disabled: boolean
}) {
  if (matured) {
    return (
      <section className="card next-dividend matured" aria-label="Series matured">
        <div className="next-dividend__header">
          <h3>Series matured</h3>
          <span className="chip chip--matured">Matured</span>
        </div>
        <p className="muted">
          All {plannedDividends ?? 6} dividends have been distributed. Price legs can be redeemed for stock on the
          <Link to="/split">Split</Link> screen. Dividend legs are now worthless.
        </p>
      </section>
    )
  }

  if (status === 'none') {
    return (
      <section className="card next-dividend" aria-label="No dividend declared">
        <div className="next-dividend__header">
          <h3>Next dividend</h3>
          <span className="chip chip--none">None pending</span>
        </div>
        <p className="next-dividend__empty">
          No dividend declared. In production the next one is published by the Chainlink CRE workflow. You can trigger a demo dividend below.
        </p>
        <div className="next-dividend__actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={disabled || demoCooldownRemaining > 0}
            onClick={onDeclareDemo}
          >
            {demoCooldownRemaining > 0
              ? `Declare dividend (demo) · {demoCooldownRemaining}s`
              : 'Declare dividend (demo)'}
          </button>
        </div>
        <p className="next-dividend__cre-note">
          Or run the <Link to="/judges">CRE workflow</Link> (see Judges page)
        </p>
      </section>
    )
  }

  if (status === 'countdown' && declaration && nextExAt) {
    const remaining = Math.max(0, nextExAt - nowSec)
    const minutes = Math.floor(remaining / 60)
    const seconds = remaining % 60
    const progress = 1 - remaining / NOTICE_SECONDS

    return (
      <section className="card next-dividend countdown" aria-label="Dividend countdown">
        <div className="next-dividend__header">
          <h3>Next dividend</h3>
          <SourceBadge source={declaration.source} />
        </div>
        <div className="next-dividend__countdown">
          <CountdownRing progress={progress} />
          <div className="next-dividend__countdown-info">
            <span className="mono next-dividend__amount">${declaration.amountPerShare.toFixed(2)} per share</span>
            <span className="next-dividend__timer mono">{minutes}:{seconds.toString().padStart(2, '0')}</span>
            <span className="muted">Ex-dividend in {minutes}m {seconds}s</span>
          </div>
        </div>
        <p className="next-dividend__note">
          Hold the dividend leg before the countdown ends to receive this dividend.
        </p>
      </section>
    )
  }

  if (status === 'ready' && declaration) {
    return (
      <section className="card next-dividend ready" aria-label="Dividend ready to pay">
        <div className="next-dividend__header">
          <h3>Dividend ready to pay</h3>
          <SourceBadge source={declaration.source} />
        </div>
        <div className="next-dividend__ready">
          <span className="next-dividend__check" aria-hidden>✓</span>
          <span className="mono">${declaration.amountPerShare.toFixed(2)} per share</span>
        </div>
        <p className="next-dividend__note">
          The ex-dividend time has passed. Anyone can press <strong>Pay dividend</strong> to distribute to current
          holders.
        </p>
        <button
          type="button"
          className="btn btn--lg btn--leg-div"
          disabled={disabled}
          onClick={onDistribute}
        >
          {phase === 'distributing' ? `Distributing\u2026 ${elapsed.toFixed(1)} s` : 'Pay dividend'}
        </button>
        <p className="next-dividend__cre-note">
          In production this is triggered automatically by the Chainlink CRE workflow. Demo dividends are manual.
        </p>
      </section>
    )
  }

  if (status === 'paid' && declaration) {
    return (
      <section className="card next-dividend paid" aria-label="Dividend paid">
        <div className="next-dividend__header">
          <h3>Dividend paid</h3>
          <SourceBadge source={declaration.source} />
        </div>
        <div className="next-dividend__paid">
          <span className="next-dividend__pulse" aria-hidden />
          <span className="mono">Paid ${declaration.amountPerShare.toFixed(2)} per share</span>
        </div>
        <p className="next-dividend__note">
          {distributedCount} of {plannedDividends} dividends distributed.{' '}
          <Link to="/trade/dividend">See the repricing on Trade \u2192</Link>
        </p>
      </section>
    )
  }

  return null
}

function SourceBadge({ source }: { source: 'CRE' | 'Demo' }) {
  if (source === 'CRE') {
    return (
      <span className="chip chip--source-cre">
        <span className="chip__dot chip__dot--cre" aria-hidden />
        Chainlink CRE
      </span>
    )
  }
  return (
    <span className="chip chip--source-demo">
      <span className="chip__dot chip__dot--demo" aria-hidden />
      Demo trigger
    </span>
  )
}

function CountdownRing({ progress }: { progress: number }) {
  const r = 28
  const c = 2 * Math.PI * r
  return (
    <svg className="countdown-ring" width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r={r} fill="none" className="countdown-ring__track" strokeWidth="4" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        className="countdown-ring__fill"
        strokeWidth="4"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        style={{ transition: 'stroke-dashoffset 1s linear' }}
      />
    </svg>
  )
}

function TimelineList({
  loading,
  error,
  declarations,
  envioConfigured,
}: {
  loading: boolean
  error: boolean
  declarations: Declaration[]
  envioConfigured: boolean
}) {
  if (loading) {
    return (
      <section className="card timeline" aria-label="Dividend timeline">
        <h3>Timeline</h3>
        <div className="timeline__skeleton">
          <div className="skeleton" style={{ height: 60 }} aria-hidden />
          <div className="skeleton" style={{ height: 60 }} aria-hidden />
          <div className="skeleton" style={{ height: 60 }} aria-hidden />
        </div>
      </section>
    )
  }

  if (!envioConfigured) {
    return (
      <section className="card timeline" aria-label="Dividend timeline">
        <h3>Timeline</h3>
        <p className="timeline__empty">
          Connect Envio to see the dividend timeline. <Link to="/judges">See Judges page for setup.</Link>
        </p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="card timeline" aria-label="Dividend timeline">
        <h3>Timeline</h3>
        <p className="timeline__error">Unable to load timeline. Retrying\u2026</p>
      </section>
    )
  }

  if (declarations.length === 0) {
    return (
      <section className="card timeline" aria-label="Dividend timeline">
        <h3>Timeline</h3>
        <p className="timeline__empty">No dividends declared yet.</p>
      </section>
    )
  }

  return (
    <section className="card timeline" aria-label="Dividend timeline">
      <h3>Timeline</h3>
      <ul className="timeline__list">
        {declarations.map((decl) => (
          <TimelineRow key={decl.id} declaration={decl} />
        ))}
      </ul>
    </section>
  )
}

function TimelineRow({ declaration }: { declaration: Declaration }) {
  const isPaid = declaration.distributed
  const statusLabel = isPaid ? 'Paid' : 'Declared'
  const statusClass = isPaid ? 'chip--paid' : 'chip--declared'
  const date = new Date(declaration.declaredAt * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const amount = Number(declaration.amountPerShare) / 1e18
  const totalPaid = declaration.totalPaid ? Number(declaration.totalPaid) / 1e18 : null
  const supply = declaration.supplyAtDistribution ? Number(declaration.supplyAtDistribution) / 1e18 : null

  return (
    <li className="timeline__row">
      <div className="timeline__col timeline__col--num">
        <span className="mono">#{declaration.id}</span>
      </div>
      <div className="timeline__col timeline__col--amount">
        <span className="mono">${amount.toFixed(2)} / share</span>
      </div>
      <div className="timeline__col timeline__col--source">
        <SourceBadge source={declaration.source} />
      </div>
      <div className="timeline__col timeline__col--date">
        <span className="muted">{date}</span>
      </div>
      <div className="timeline__col timeline__col--status">
        <span className={`chip ${statusClass}`}>{statusLabel}</span>
      </div>
      <div className="timeline__col timeline__col--details">
        {totalPaid !== null && <span className="mono muted">Total: ${totalPaid.toFixed(2)}</span>}
        {supply !== null && <span className="mono muted">Supply: {supply.toLocaleString()}</span>}
      </div>
      <div className="timeline__col timeline__col--tx">
        <a
          href={explorerTxUrl(declaration.txHash)}
          target="_blank"
          rel="noreferrer"
          className="linkbtn"
          aria-label="View transaction"
        >
          ↗
        </a>
      </div>
    </li>
  )
}

function EducationFooter() {
  return (
    <section className="card education" aria-label="Why dividend legs reprice">
      <h3>Why dividend legs reprice at ex-dividend time</h3>
      <p className="muted">
        When a dividend is distributed, the dividend leg receives mUSD proportional to its share of the pool.
        This value is transferred from the stock's price into the dividend leg. The price leg drops by the same
        amount, keeping the total value of 1 pACME-A + 1 dACME-A = 1 mACME constant.
      </p>
    </section>
  )
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

function humanizeError(error: unknown): string {
  const reason = revertReason(error)
  if (reason !== null) {
    const map: Record<string, string> = {
      'SplitToken: nothing to claim': 'No dividends to claim.',
      'Splitter: no declaration': 'No dividend declared yet.',
      'Splitter: too early': 'Dividend not ready yet — wait for ex-dividend time.',
      'Splitter: out of order': 'Dividends must be paid in order.',
      'Splitter: matured': 'Series has matured.',
      'DividendOracle: cooldown': 'Demo trigger on cooldown — wait 2 minutes.',
      'DividendOracle: bad amount': 'Invalid dividend amount.',
      'ERC20: insufficient balance': 'Not enough balance.',
      'ERC20: insufficient allowance': 'Approval needed \u2014 try again.',
      'Splitter: reentrant': 'Something went wrong \u2014 try again.',
    }
    for (const key of Object.keys(map)) {
      if (reason.includes(key)) return map[key]
    }
    return 'Transaction reverted.'
  }
  return describeError(error)
}

function revertReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.reason ?? reverted.data?.errorName ?? 'reverted'
  }
  return null
}