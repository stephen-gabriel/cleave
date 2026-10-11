import { useCallback, useMemo, useState } from 'react'
import { formatEther } from 'viem'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { CHAIN } from '../chain/addresses'
import { GAS_LIMITS } from '../chain/gas'
import { SPLIT_TOKEN_ABI } from '../chain/abis'
import { useChainState } from '../chain/multicall'
import { useSession, isRevertedTransactionError } from '../wallet/session'
import type { SendResult } from '../wallet/session'
import { isOutOfFeeCredit } from '../wallet/txFailure'
import { ConfirmationChip } from '../ui/ConfirmationChip'
import { toastError } from '../ui/toast'
import { FAUCET_URL, describeError, explorerAddressUrl, explorerTxUrl } from '../wallet/mera'
import { Link } from '../router'
import { refreshEnvioStore, envioConfigured, useEnvio } from '../data/useEnvio'
import { queries } from '../data/envio'
import { formatAmount, formatUsd, timeAgo } from '../lib/format'
import { quoteRemoveLiquidity } from '../lib/trading'
import {
  buildHoldings,
  portfolioTotal,
  selectHistory,
  spotPriceUsd,
} from '../lib/portfolio'
import type { HistoryTab } from '../lib/portfolio'
import './Portfolio.css'

type Phase = 'idle' | 'claiming' | 'drip'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const TABS: Array<{ id: HistoryTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'splits', label: 'Splits' },
  { id: 'trades', label: 'Trades' },
  { id: 'dividends', label: 'Dividends' },
]

const EMPTY_COPY: Record<HistoryTab, string> = {
  all: 'No activity yet.',
  splits: 'No splits yet.',
  trades: 'No trades yet.',
  dividends: 'No dividend events yet.',
}

export default function Portfolio() {
  const session = useSession()
  const address = session.wallet?.account.address ?? null
  const state = useChainState(address)
  const history = useEnvio(queries.history(address ?? ZERO_ADDRESS, 50))

  const [tab, setTab] = useState<HistoryTab>('all')
  const [phase, setPhase] = useState<Phase>('idle')
  const [last, setLast] = useState<{ result: SendResult; label: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const loading = state.loading
  const offline = state.offline
  const busy = phase !== 'idle'

  const priceLegPrice = spotPriceUsd(state.poolPriceReserveToken, state.poolPriceReserveQuote)
  const divLegPrice = spotPriceUsd(state.poolDivReserveToken, state.poolDivReserveQuote)

  const rows = useMemo(
    () =>
      buildHoldings(
        {
          stock: state.stockBalance,
          priceLeg: state.priceLegBalance,
          divLeg: state.divLegBalance,
          usd: state.usdBalance,
          mon: state.monBalance,
        },
        { refPrice: state.refPrice, priceLeg: priceLegPrice, divLeg: divLegPrice },
      ),
    [
      state.stockBalance,
      state.priceLegBalance,
      state.divLegBalance,
      state.usdBalance,
      state.monBalance,
      state.refPrice,
      priceLegPrice,
      divLegPrice,
    ],
  )

  const pending = state.divLegPending
  const total = useMemo(() => portfolioTotal(rows, pending), [rows, pending])

  const positions = useMemo(() => {
    const defs = [
      {
        key: 'price' as const,
        ticker: 'pACME-A',
        shares: state.poolPriceShares,
        total: state.poolPriceTotalShares,
        reserveToken: state.poolPriceReserveToken,
        reserveQuote: state.poolPriceReserveQuote,
        price: priceLegPrice,
      },
      {
        key: 'div' as const,
        ticker: 'dACME-A',
        shares: state.poolDivShares,
        total: state.poolDivTotalShares,
        reserveToken: state.poolDivReserveToken,
        reserveQuote: state.poolDivReserveQuote,
        price: divLegPrice,
      },
    ]
    return defs.flatMap((def) => {
      if (def.shares === null || def.shares <= 0n) return []
      const totalShares = def.total ?? 0n
      const pct = totalShares > 0n ? (Number(def.shares) / Number(totalShares)) * 100 : 0
      const out =
        def.reserveToken !== null && def.reserveQuote !== null && totalShares > 0n
          ? quoteRemoveLiquidity({
              reserveToken: def.reserveToken,
              reserveQuote: def.reserveQuote,
              totalShares,
              sharesOwned: def.shares,
            })
          : null
      let value: number | null = null
      if (out !== null) {
        const quoteValue = Number(formatEther(out.quoteOut))
        if (def.price !== null) value = quoteValue + Number(formatEther(out.tokenOut)) * def.price
        else if (out.tokenOut === 0n) value = quoteValue
      }
      return [{ key: def.key, ticker: def.ticker, shares: def.shares, pct, value }]
    })
  }, [
    state.poolPriceShares,
    state.poolPriceTotalShares,
    state.poolPriceReserveToken,
    state.poolPriceReserveQuote,
    state.poolDivShares,
    state.poolDivTotalShares,
    state.poolDivReserveToken,
    state.poolDivReserveQuote,
    priceLegPrice,
    divLegPrice,
  ])

  const entries = useMemo(
    () => selectHistory(history.data ?? [], tab, { div: CHAIN.poolDiv, price: CHAIN.poolPrice }),
    [history.data, tab],
  )

  const canClaim = !loading && !busy && pending !== null && pending > 0n

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
        setLast({
          result: { hash: data.txHash as `0x${string}`, seconds: 0, isFirst: false },
          label: '0.25 MON fee credit added',
        })
        refresh()
      }
    } catch {
      toastError('Fee credit temporarily unavailable')
    } finally {
      setPhase('idle')
    }
  }, [busy, session, refresh])

  const runClaim = useCallback(async () => {
    if (busy || pending === null || pending === 0n || session.wallet === null) return
    setPhase('claiming')
    try {
      const result = await session.send({
        to: CHAIN.divLeg,
        abi: SPLIT_TOKEN_ABI,
        functionName: 'claim',
        args: [],
        gas: GAS_LIMITS.claim,
      })
      setLast({ result, label: `Claimed ${formatAmount(pending)} mUSD` })
      refreshEnvioStore()
      refresh()
    } catch (error) {
      handleTxError(error, { onFeeCredit: runDrip })
    } finally {
      setPhase('idle')
    }
  }, [busy, pending, session, refresh, runDrip])

  const copyAddress = useCallback(async () => {
    if (address === null) return
    await navigator.clipboard.writeText(address).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [address])

  const historyStatus = envioConfigured() ? history.status : 'unconfigured'

  return (
    <div className="portfolio">
      <section className="card pf-total" aria-label="Portfolio value">
        <div className="pf-total__main">
          <span className="pf-total__label">Total value</span>
          <span className="pf-total__value mono">
            {loading && total === 0 ? '\u2026' : formatUsd(total)}
          </span>
          <span className="pf-total__note">Includes unclaimed dividends</span>
        </div>
        <div className="pf-total__meta">
          <span className="pf-total__pending mono">
            {loading ? '\u2026' : `Unclaimed ${pending !== null ? formatAmount(pending) : '\u2014'} mUSD`}
          </span>
          <span className="pf-total__fee muted">Fee credit (MON) has no market price and is not part of the total.</span>
        </div>
      </section>

      <section className="card" aria-label="Holdings">
        <div className="pf-card__head">
          <h3>Holdings</h3>
          {offline && (
            <span className="chip" title="The network did not answer; showing last known values">
              Last known values
            </span>
          )}
        </div>
        <div className="pf-tablewrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="pf-num">Balance</th>
                <th className="pf-num">Price (mUSD)</th>
                <th className="pf-num">Value</th>
                <th className="pf-action" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : (
                <>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <span className="pf-asset">
                          <span className={`pf-dot${row.dot ? ` pf-dot--${row.dot}` : ''}`} aria-hidden />
                          <span className="pf-asset__symbol">{row.symbol}</span>
                          {row.note !== null && <span className="pf-asset__note">{row.note}</span>}
                        </span>
                      </td>
                      <td className="pf-num mono">{formatAmount(row.balance)}</td>
                      <td className="pf-num mono">{row.price === null ? '\u2014' : formatUsd(row.price)}</td>
                      <td className="pf-num mono">{row.value === null ? '\u2014' : formatUsd(row.value)}</td>
                      <td className="pf-action" />
                    </tr>
                  ))}
                  <tr className="pf-row--claim">
                    <td>
                      <span className="pf-asset">
                        <span className="pf-dot pf-dot--div" aria-hidden />
                        <span className="pf-asset__symbol">Unclaimed dividends</span>
                        <span className="pf-asset__note">from dACME-A</span>
                      </span>
                    </td>
                    <td className="pf-num mono">{pending !== null ? `${formatAmount(pending)} mUSD` : '\u2014'}</td>
                    <td className="pf-num mono">{pending !== null ? formatUsd(1) : '\u2014'}</td>
                    <td className="pf-num mono">{pending !== null ? formatUsd(Number(formatEther(pending))) : '\u2014'}</td>
                    <td className="pf-action">
                      <button
                        type="button"
                        className="btn btn--sm btn--leg-div"
                        disabled={!canClaim}
                        title={pending === null || pending === 0n ? 'Nothing to claim yet' : undefined}
                        onClick={() => void runClaim()}
                      >
                        {phase === 'claiming' ? 'Claiming\u2026' : 'Claim'}
                      </button>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {phase === 'idle' && last !== null && (
          <div className="pf-claim-result">
            <ConfirmationChip seconds={last.result.seconds} txHash={last.result.hash} label={last.label} />
          </div>
        )}
      </section>

      {positions.length > 0 && (
        <section className="card" aria-label="Liquidity positions">
          <div className="pf-card__head">
            <h3>Liquidity positions</h3>
          </div>
          <ul className="pf-liq">
            {positions.map((position) => (
              <li key={position.key} className="pf-liq__row">
                <span className="pf-liq__name">
                  <span className={`pf-dot pf-dot--${position.key}`} aria-hidden />
                  {position.ticker} / mUSD pool
                </span>
                <span className="pf-liq__shares mono">
                  {formatAmount(position.shares)} shares · {position.pct.toFixed(2)}%
                </span>
                <span className="pf-liq__value mono">
                  {position.value === null ? '\u2014' : formatUsd(position.value)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-label="History">
        <div className="pf-card__head pf-card__head--tabs">
          <h3>History</h3>
          <div className="pf-tabs" role="tablist" aria-label="Filter history">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={`pf-tabs__btn${tab === item.id ? ' pf-tabs__btn--on' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {historyStatus === 'unconfigured' ? (
          <p className="pf-empty">
            History needs the Envio indexer. <Link to="/judges">See the Judges page for setup.</Link>
          </p>
        ) : historyStatus === 'loading' ? (
          <div className="pf-history__skeleton">
            <div className="skeleton" style={{ height: 44 }} aria-hidden />
            <div className="skeleton" style={{ height: 44 }} aria-hidden />
            <div className="skeleton" style={{ height: 44 }} aria-hidden />
          </div>
        ) : historyStatus === 'error' ? (
          <p className="pf-empty">{'Unable to load history. Retrying\u2026'}</p>
        ) : entries.length === 0 ? (
          <div className="pf-empty">
            <p>{EMPTY_COPY[tab]}</p>
            {tab === 'all' && (
              <Link className="btn btn--primary btn--sm" to="/split">
                Split your first 100 mACME
              </Link>
            )}
          </div>
        ) : (
          <ul className="pf-history">
            {entries.map(({ entry, description }) => (
              <li key={entry.id} className="pf-history__row">
                <span className="pf-history__time muted">{timeAgo(entry.timestamp)}</span>
                <span className="pf-history__desc">
                  {description}
                  {entry.isSimulated && (
                    <span className="pf-history__sim" title="Simulated test wallet">
                      SIM
                    </span>
                  )}
                </span>
                <a
                  className="pf-history__link"
                  href={explorerTxUrl(entry.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View transaction on explorer"
                >
                  ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        {historyStatus === 'ready' && entries.length > 0 && (
          <p className="pf-history__note muted">Live from the indexer · SIM = simulated test wallet.</p>
        )}
        {historyStatus === 'stale' && entries.length > 0 && (
          <p className="pf-history__note muted">Indexer unreachable — showing last known activity.</p>
        )}
      </section>

      {address !== null && (
        <section className="card pf-session" aria-label="Account">
          <div className="pf-card__head">
            <h3>Account</h3>
          </div>
          <div className="pf-session__addr">
            <span className="mono pf-session__value">{address}</span>
            <span className="pf-session__icons">
              <button
                type="button"
                className="icon-btn"
                onClick={() => void copyAddress()}
                title="Copy address"
              >
                {copied ? '✓' : '⧉'}
              </button>
              <a
                className="icon-btn"
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
                title="View on explorer"
              >
                ↗
              </a>
            </span>
          </div>
          <p className="muted pf-session__explainer">
            Sign in works anywhere with your passkey. Your positions live on chain — clearing site
            data never loses them.
          </p>
          <div className="pf-session__btns">
            <button type="button" className="btn btn--ghost" onClick={session.lock}>
              Lock now
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr aria-hidden>
      <td colSpan={5}>
        <div className="skeleton" style={{ height: 28 }} />
      </td>
    </tr>
  )
}

function revertReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.reason ?? reverted.data?.errorName ?? 'reverted'
  }
  return null
}

function humanizeError(error: unknown): string {
  const reason = revertReason(error)
  if (reason !== null) {
    const map: Record<string, string> = {
      'SplitToken: nothing to claim': 'Nothing to claim yet.',
      'ERC20: insufficient balance': 'Not enough balance.',
      'ERC20: insufficient allowance': 'Approval needed \u2014 try again.',
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
