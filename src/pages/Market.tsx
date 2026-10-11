import { useCallback, useEffect, useMemo, useState } from 'react'
import { CHAIN } from '../chain/addresses'
import { DIVIDEND_ORACLE_ABI, SPLITTER_ABI } from '../chain/abis'
import { publicClient } from '../chain/clients'
import { useEnvio } from '../data/useEnvio'
import { queries } from '../data/envio'
import type { ProtocolStats } from '../data/envio'
import { deviationChip, fairValues } from '../lib/trading'
import type { FairValues } from '../lib/trading'
import {
  aggregateHourlySwaps,
  marketPoolRows,
  netStockLocked,
  parseWad,
  volumeSplit,
} from '../lib/market'
import type { HourBar } from '../lib/market'
import { selectHistory } from '../lib/portfolio'
import { formatAmount, formatPrice, formatUsd, formatUsdFromWad, shortAddress, timeAgo } from '../lib/format'
import { explorerAddressUrl, explorerTxUrl } from '../wallet/mera'
import { Link } from '../router'
import './Market.css'

const BANNER =
  'Volume labelled SIM comes from our own test wallets on Monad Testnet. Everything here is testnet data.'
const FAIR_LEGEND = 'Dashed line = oracle fair value (remaining dividends \u00d7 latest declaration)'
const VOLUME_BAR_LIMIT = 24

export default function Market() {
  const stats = useEnvio(queries.stats())
  const pools = useEnvio(queries.pools())
  const activity = useEnvio(queries.activity(30))
  const swapsAll = useEnvio(queries.swapsAll(200))
  const divHourly = useEnvio(queries.hourly(CHAIN.poolDiv, 168))
  const priceHourly = useEnvio(queries.hourly(CHAIN.poolPrice, 168))
  const oracle = useOracleFair()

  const s = stats.data?.[0] ?? null
  const locked = useMemo(() => (s === null ? null : netStockLocked(s)), [s])
  const split = useMemo(
    () => volumeSplit(s?.simulatedVolumeUsd ?? null, s?.organicVolumeUsd ?? null),
    [s],
  )

  const volumeBars = useMemo(
    () => aggregateHourlySwaps(swapsAll.data ?? []).slice(-VOLUME_BAR_LIMIT),
    [swapsAll.data],
  )
  const divPoints = useMemo(() => hourlyPoints(divHourly.data ?? []), [divHourly.data])
  const pricePoints = useMemo(() => hourlyPoints(priceHourly.data ?? []), [priceHourly.data])

  const poolRows = useMemo(
    () => marketPoolRows(pools.data ?? [], oracle.data?.fair ?? null),
    [pools.data, oracle.data],
  )
  const feed = useMemo(
    () => selectHistory(activity.data ?? [], 'all', { div: CHAIN.poolDiv, price: CHAIN.poolPrice }),
    [activity.data],
  )

  return (
    <div className="market">
      <p className="banner banner--warn" role="note">
        {BANNER}
      </p>

      <StatsSection
        status={stats.status}
        stats={s}
        locked={locked}
        split={split}
        stale={stats.status === 'stale'}
      />

      <VolumeChart
        rows={volumeBars}
        status={swapsAll.status}
        swapCount={swapsAll.data?.length ?? 0}
      />

      <div className="mk-charts-grid mk-charts-grid--split">
        <LineChart
          title="Dividend leg price"
          color="var(--div)"
          points={divPoints}
          fair={oracle.data?.fair.divFair ?? null}
          estimated={oracle.data?.fair.estimated ?? false}
          status={divHourly.status}
        />
        <LineChart
          title="Price leg price"
          color="var(--price)"
          points={pricePoints}
          fair={oracle.data?.fair.priceFair ?? null}
          estimated={oracle.data?.fair.estimated ?? false}
          status={priceHourly.status}
        />
      </div>

      <PoolsSection
        status={pools.status}
        rows={poolRows}
        chainLoading={oracle.loading}
        chainFailed={oracle.failed}
        estimated={oracle.data?.fair.estimated ?? false}
      />

      <ActivitySection status={activity.status} feed={feed} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chain reads: oracle fair values (public page, no session required)  */
/* ------------------------------------------------------------------ */

type OracleFair = { fair: FairValues }

function useOracleFair() {
  const [data, setData] = useState<OracleFair | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const batch = await publicClient.multicall({
        contracts: [
          { address: CHAIN.splitter, abi: SPLITTER_ABI, functionName: 'remainingDividends', args: [] },
          { address: CHAIN.oracle, abi: DIVIDEND_ORACLE_ABI, functionName: 'lastRefPrice', args: [] },
          { address: CHAIN.oracle, abi: DIVIDEND_ORACLE_ABI, functionName: 'count', args: [] },
        ],
      })
      if (batch.some((r) => r.error)) throw new Error('oracle multicall failed')
      const remaining = Number(batch[0].result)
      const refPrice = Number(batch[1].result) / 1e18
      const count = Number(batch[2].result)
      let amountPerShare: number | null = null
      if (Number.isFinite(count) && count > 0) {
        const latest = (await publicClient.readContract({
          address: CHAIN.oracle,
          abi: DIVIDEND_ORACLE_ABI,
          functionName: 'latest',
        })) as { amountPerShare: bigint }
        amountPerShare = Number(latest.amountPerShare) / 1e18
      }
      const fair = fairValues({ remainingDividends: remaining, amountPerShare, refPrice })
      if (fair === null) throw new Error('no fair values')
      setData({ fair })
      setFailed(false)
    } catch {
      // Keep last known fair values; the section shows an offline chip.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  return { data, failed, loading }
}

/* ------------------------------------------------------------------ */
/* Stat tiles                                                          */
/* ------------------------------------------------------------------ */

function StatsSection({
  status,
  stats,
  locked,
  split,
  stale,
}: {
  status: string
  stats: ProtocolStats | null
  locked: bigint | null
  split: ReturnType<typeof volumeSplit>
  stale: boolean
}) {
  if (status === 'unconfigured') return <IndexerNote status={status} />
  if (stats === null && status === 'loading') return <StatsSkeleton />
  if (stats === null && status === 'error') return <IndexerNote status={status} />
  if (stats === null) return <IndexerNote status="error" />

  return (
    <section aria-label="Protocol statistics">
      {stale && <p className="mk-stale muted">Indexer unreachable — showing last known statistics.</p>}
      <div className="stats mk-stats">
        <Tile label="Total split" hint="Cumulative mACME split into legs">
          <span className="mono stat__value">{formatAmount(parseWad(stats.totalSplit))} mACME</span>
        </Tile>
        <Tile label="Net stock locked" hint="Split − merged − redeemed (stock backing outstanding legs)">
          <span className="mono stat__value">{formatAmount(locked)} mACME</span>
        </Tile>
        <Tile label="Total volume" hint={`${stats.tradeCount.toLocaleString('en-US')} trades indexed`}>
          <span className="mono stat__value">{formatUsdFromWad(stats.volumeUsd)}</span>
        </Tile>
        <div className="stat stat--wide" title="Simulated volume comes from our own test wallets; organic from everyone else">
          <span className="stat__label">Simulated vs organic volume</span>
          {split === null ? (
            <span className="mono stat__value">{stats.volumeUsd === '0' ? '$0.00' : '\u2014'}</span>
          ) : (
            <>
              <span className="mk-split__nums">
                <span className="mono mk-split__sim">{formatUsd(split.simUsd)} SIM</span>
                <span className="mono mk-split__org">{formatUsd(split.organicUsd)} organic</span>
              </span>
              <span className="mk-split" aria-hidden>
                <span className="mk-split__bar mk-split__bar--sim" style={{ width: `${split.simPct}%` }} />
                <span className="mk-split__bar mk-split__bar--org" style={{ width: `${split.organicPct}%` }} />
              </span>
              <span className="mk-tile__hint muted">
                {split.simPct.toFixed(1)}% SIM · {split.organicPct.toFixed(1)}% organic
              </span>
            </>
          )}
        </div>
        <Tile
          label="Unique accounts"
          hint="Accounts seen by the indexer; organic = not one of our test wallets"
        >
          <span className="mono stat__value">{stats.uniqueAccounts.toLocaleString('en-US')}</span>
          <span className="mk-tile__hint muted">
            {stats.organicAccounts.toLocaleString('en-US')} outside our test wallets
          </span>
        </Tile>
        <Tile label="Dividends paid" hint="Distributions paid out (count and total mUSD)">
          <span className="mono stat__value">
            {stats.dividendsDistributed.toLocaleString('en-US')}
          </span>
          <span className="mk-tile__hint muted">{formatUsdFromWad(stats.dividendsPaidUsd)} paid</span>
        </Tile>
      </div>
    </section>
  )
}

function StatsSkeleton() {
  return (
    <div className="stats mk-stats" aria-hidden>
      {['Total split', 'Net stock locked', 'Total volume', 'Simulated vs organic volume', 'Unique accounts', 'Dividends paid'].map((label) => (
        <div className="stat" key={label}>
          <span className="stat__label">{label}</span>
          <div className="skeleton" style={{ height: 24, width: '55%' }} />
        </div>
      ))}
    </div>
  )
}

function Tile({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="stat" title={hint}>
      <span className="stat__label">{label}</span>
      {children}
      {hint !== undefined && <span className="mk-tile__hint muted">{hint}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Volume per hour (stacked simulated / organic)                       */
/* ------------------------------------------------------------------ */

function VolumeChart({
  rows,
  status,
  swapCount,
}: {
  rows: HourBar[]
  status: string
  swapCount: number
}) {
  const empty = rows.length === 0
  return (
    <section className="card chart" aria-label="Hourly trading volume">
      <div className="chart__head">
        <h3>Volume per hour</h3>
        <span className="mk-chart__note muted">
          {swapCount > 0 ? `Latest ${swapCount.toLocaleString('en-US')} swaps \u00b7 hourly` : 'Hourly'}
        </span>
      </div>
      {status === 'unconfigured' || status === 'error' ? (
        <IndexerNote status={status} />
      ) : empty ? (
        <div className="chart__empty">
          <p>{status === 'stale' ? 'Indexer unavailable. Retrying.' : 'No swaps indexed yet.'}</p>
        </div>
      ) : (
        <VolumeSvg rows={rows} />
      )}
    </section>
  )
}

function VolumeSvg({ rows }: { rows: HourBar[] }) {
  const W = 640
  const H = 180
  const PAD = 10
  const max = rows.reduce((m, r) => Math.max(m, r.totalUsd), 0)
  const scale = max > 0 ? (H - PAD * 2) / max : 0
  const slot = (W - PAD * 2) / rows.length
  const barW = Math.max(2, Math.min(28, slot - 6))
  const gridMarks = [0, 0.5, 1]

  return (
    <div className="chart__wrap">
      <svg
        className="chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Hourly traded volume stacked by simulated and organic activity"
      >
        {gridMarks.map((m) => (
          <line
            key={m}
            x1={0}
            x2={W}
            y1={H - PAD - (H - PAD * 2) * m}
            y2={H - PAD - (H - PAD * 2) * m}
            className="chart__gridline"
          />
        ))}
        {rows.map((r, i) => {
          const x = PAD + i * slot + (slot - barW) / 2
          const simH = r.simUsd * scale
          const orgH = r.organicUsd * scale
          return (
            <g key={r.hour}>
              <rect x={x} y={H - PAD - simH} width={barW} height={simH} className="mk-vol__sim" />
              <rect
                x={x}
                y={H - PAD - simH - orgH}
                width={barW}
                height={orgH}
                className="mk-vol__org"
              />
              <title>
                {`${new Date(r.hour * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit' })} · SIM ${formatUsd(r.simUsd)} · organic ${formatUsd(r.organicUsd)}`}
              </title>
            </g>
          )
        })}
      </svg>
      <div className="chart__legend">
        <span className="chart__legend-item">
          <span className="mk-vol__k mk-vol__k--sim" aria-hidden />
          Simulated (our test wallets)
        </span>
        <span className="chart__legend-item">
          <span className="mk-vol__k mk-vol__k--org" aria-hidden />
          Organic
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Leg price lines                                                     */
/* ------------------------------------------------------------------ */

function hourlyPoints(rows: Array<{ hour: number; close: string }>): Array<{ t: number; p: number }> {
  const asc = [...rows].sort((a, b) => a.hour - b.hour)
  return asc
    .map((h) => ({ t: h.hour * 1000, p: Number(h.close) }))
    .filter((point) => Number.isFinite(point.p) && point.p > 0)
}

function LineChart({
  title,
  color,
  points,
  fair,
  estimated,
  status,
}: {
  title: string
  color: string
  points: Array<{ t: number; p: number }>
  fair: number | null
  estimated: boolean
  status: string
}) {
  const empty = points.length === 0
  return (
    <section className="card chart" aria-label={`${title} chart`}>
      <div className="chart__head">
        <h3>{title}</h3>
        <span className="mk-chart__note muted">Pool price from hourly candles</span>
      </div>
      {status === 'unconfigured' || status === 'error' ? (
        <IndexerNote status={status} />
      ) : empty ? (
        <div className="chart__empty">
          <p>{status === 'stale' ? 'Indexer unavailable. Retrying.' : 'No trades yet \u2014 prices appear after the first swap.'}</p>
        </div>
      ) : (
        <MiniLineChart points={points} fair={fair} color={color} label={title} />
      )}
      {fair !== null && !empty && (
        <div className="chart__legend">
          <span className="chart__legend-item">
            <span className="mk-fair-k" aria-hidden />
            Oracle fair value · {formatPrice(fair)}
            {estimated && <span className="mk-est" title="Using defaults while the latest declaration is unavailable">est.</span>}
          </span>
          <span className="chart__legend-item">{FAIR_LEGEND}</span>
        </div>
      )}
    </section>
  )
}

function MiniLineChart({
  points,
  fair,
  color,
  label,
}: {
  points: Array<{ t: number; p: number }>
  fair: number | null
  color: string
  label: string
}) {
  const W = 640
  const H = 200
  const PAD = 8
  const [hover, setHover] = useState<number | null>(null)
  const values = points.map((p) => p.p)
  const min = Math.min(...values, ...(fair !== null ? [fair] : []))
  const max = Math.max(...values, ...(fair !== null ? [fair] : []))
  const span = max - min || 1
  const padSpan = span * 0.12
  const lo = min - padSpan
  const hi = max + padSpan
  const tMin = points[0].t
  const tMax = points[points.length - 1].t
  const range = Math.max(1, tMax - tMin)
  const x = (t: number) => PAD + ((t - tMin) / range) * (W - PAD * 2)
  const y = (p: number) => H - PAD - ((p - lo) / (hi - lo)) * (H - PAD * 2)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ')
  const area = `${line} L${x(tMax).toFixed(1)},${H - PAD} L${x(tMin).toFixed(1)},${H - PAD} Z`
  const fairY = fair !== null && fair >= lo && fair <= hi ? y(fair) : null
  const gridMarks = [0, 0.5, 1]

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    setHover(Math.round(ratio * (points.length - 1)))
  }

  const hoverPoint = hover !== null ? points[hover] : null
  const hoverX = hoverPoint !== null ? x(hoverPoint.t) : 0
  const fillId = `mk-line-fill-${label.replace(/\s+/g, '-')}`

  return (
    <div className="chart__wrap">
      <svg
        className="chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} pool price over time, with oracle fair value reference`}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridMarks.map((m) => (
          <line
            key={m}
            x1={0}
            x2={W}
            y1={y(lo + (hi - lo) * (1 - m))}
            y2={y(lo + (hi - lo) * (1 - m))}
            className="chart__gridline"
          />
        ))}
        {fairY !== null && <line x1={PAD} x2={W - PAD} y1={fairY} y2={fairY} className="chart__fair" />}
        <path d={area} fill={`url(#${fillId})`} />
        <path d={line} className="chart__line" style={{ stroke: color }} />
        {hoverPoint !== null && (
          <>
            <line x1={hoverX} x2={hoverX} y1={PAD} y2={H - PAD} className="chart__hoverline" />
            <circle cx={hoverX} cy={y(hoverPoint.p)} r="3.5" className="chart__hoverdot" style={{ fill: color }} />
          </>
        )}
        <rect
          x={0}
          y={0}
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
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pools table                                                         */
/* ------------------------------------------------------------------ */

function PoolsSection({
  status,
  rows,
  chainLoading,
  chainFailed,
  estimated,
}: {
  status: string
  rows: ReturnType<typeof marketPoolRows>
  chainLoading: boolean
  chainFailed: boolean
  estimated: boolean
}) {
  return (
    <section className="card" aria-label="Pools">
      <div className="mk-card__head">
        <h3>Pools</h3>
        {chainFailed && !chainLoading && (
          <span className="chip chip--muted" title="RPC unavailable — market prices still come from the indexer">
            Chain reads unavailable · fair values hidden
          </span>
        )}
      </div>
      {status === 'unconfigured' || status === 'error' ? (
        <IndexerNote status={status} />
      ) : rows.length === 0 && status === 'loading' ? (
        <div className="skeleton" style={{ height: 120 }} aria-hidden />
      ) : rows.length === 0 ? (
        <div className="mk-empty">
          <p>{status === 'stale' ? 'Indexer unavailable. Retrying.' : 'No pools indexed yet.'}</p>
        </div>
      ) : (
        <>
          <div className="mk-tablewrap">
            <table className="mk-table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="mk-num">Market price</th>
                  <th className="mk-num">Oracle fair value</th>
                  <th>Vs fair</th>
                  <th className="mk-num">Liquidity</th>
                  <th className="mk-num">Volume</th>
                  <th className="mk-num">Trades</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const chip = deviationChip(row.marketPrice, row.fair)
                  return (
                    <tr key={row.key}>
                      <td>
                        <Link className="mk-pool" to={`/trade/${row.key}`}>
                          <span
                            className={`pf-dot ${row.key === 'price' ? 'pf-dot--price' : 'pf-dot--div'}`}
                            aria-hidden
                          />
                          <span className="mk-pool__ticker">{row.ticker}</span>
                          <span className="muted mk-pool__note">
                            {row.key === 'price' ? 'Price leg' : 'Dividend leg'}
                          </span>
                        </Link>
                      </td>
                      <td className="mk-num mono">
                        {row.marketPrice === null ? '\u2014' : formatPrice(row.marketPrice)}
                      </td>
                      <td className="mk-num mono">
                        {row.fair === null ? '\u2014' : formatPrice(row.fair)}
                        {row.fair !== null && estimated && (
                          <span className="mk-est" title="Using defaults while the latest declaration is unavailable">
                            est.
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`chip chip--${chip?.tone ?? 'muted'}`}>{chip?.label ?? '\u2014'}</span>
                      </td>
                      <td className="mk-num mono">{formatUsd(row.liquidityUsd)}</td>
                      <td className="mk-num mono">{formatUsd(row.volumeUsd)}</td>
                      <td className="mk-num mono">{row.tradeCount.toLocaleString('en-US')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {status === 'stale' && (
            <p className="mk-stale muted">Indexer unreachable — showing last known pool data.</p>
          )}
          <p className="mk-note muted">
            Market price = pool reserves. Oracle fair value = remaining dividends × latest declared
            amount (dividend leg) and reference price − that amount (price leg).
          </p>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */

function ActivitySection({
  status,
  feed,
}: {
  status: string
  feed: ReturnType<typeof selectHistory>
}) {
  return (
    <section className="card" aria-label="Latest activity">
      <div className="mk-card__head">
        <h3>Activity</h3>
        <span className="mk-chart__note muted">Latest 30 events</span>
      </div>
      {status === 'unconfigured' || status === 'error' ? (
        <IndexerNote status={status} />
      ) : feed.length === 0 && status === 'loading' ? (
        <div className="mk-feed-skel">
          <div className="skeleton" style={{ height: 44 }} aria-hidden />
          <div className="skeleton" style={{ height: 44 }} aria-hidden />
          <div className="skeleton" style={{ height: 44 }} aria-hidden />
        </div>
      ) : feed.length === 0 ? (
        <div className="mk-empty">
          <p>{status === 'stale' ? 'Indexer unavailable. Retrying.' : 'No activity yet.'}</p>
          <Link className="btn btn--primary btn--sm" to="/split">
            Split your first 100 mACME
          </Link>
        </div>
      ) : (
        <>
          <ul className="mk-feed">
            {feed.map(({ entry, description }) => (
              <li key={entry.id} className="mk-feed__row">
                <span className="mk-feed__time muted">{timeAgo(entry.timestamp)}</span>
                <span className={feedDot(entry.kind, entry.pool)} aria-hidden />
                <span className="mk-feed__desc">
                  {description}
                  {entry.isSimulated && (
                    <span className="feed__sim" title="Simulated test wallet">
                      SIM
                    </span>
                  )}
                </span>
                <a
                  className="mk-feed__acct muted"
                  href={explorerAddressUrl(entry.account)}
                  target="_blank"
                  rel="noreferrer"
                  title={entry.account}
                >
                  {shortAddress(entry.account)}
                </a>
                <a
                  className="mk-feed__link"
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
          {status === 'stale' && (
            <p className="mk-stale muted">Indexer unreachable — showing last known activity.</p>
          )}
          <p className="mk-note muted">SIM = simulated test wallet. Live from the Envio indexer.</p>
        </>
      )}
    </section>
  )
}

function feedDot(kind: string, pool: string | null): string {
  if (pool !== null) {
    const id = pool.toLowerCase()
    if (id === CHAIN.poolDiv.toLowerCase()) return 'pf-dot pf-dot--div'
    if (id === CHAIN.poolPrice.toLowerCase()) return 'pf-dot pf-dot--price'
  }
  if (kind === 'Declare' || kind === 'Distribute' || kind === 'Claim') return 'pf-dot pf-dot--div'
  return 'pf-dot pf-dot--stock'
}

/* ------------------------------------------------------------------ */
/* Shared states                                                       */
/* ------------------------------------------------------------------ */

function IndexerNote({ status }: { status: string }) {
  if (status === 'unconfigured') {
    return (
      <div className="mk-empty">
        <p>
          This view needs the Envio indexer. <Link to="/judges">See the Judges page for setup.</Link>
        </p>
      </div>
    )
  }
  return (
    <div className="mk-empty">
      <p>{status === 'stale' ? 'Indexer unavailable. Retrying.' : 'Unable to load data. Retrying\u2026'}</p>
    </div>
  )
}
