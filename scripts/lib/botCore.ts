export type ActionKind =
  | 'buy-div'
  | 'sell-div'
  | 'buy-price'
  | 'sell-price'
  | 'split'
  | 'merge'
  | 'claim'
  | 'distribute'

export type PoolKind = 'div' | 'price'

export interface Rng {
  next(): number
}

export interface BotConfig {
  burst: number | null
  minutes: number | null
  maxTxs: number
  maxGasMon: number
  execute: boolean
  slippageBps: number
  stopFile: string
  rateLimitMs: number
  burstRateLimitMs: number
  medianUsd: number
  maxTradeUsd: number
  minSplits: number
  minTrades: number
  minMon: number
  maxConsecutiveFailures: number
  walletIndex: number
}

export const DEFAULT_CONFIG: BotConfig = {
  burst: null,
  minutes: null,
  maxTxs: 500,
  maxGasMon: 1.0,
  execute: false,
  slippageBps: 100,
  stopFile: 'bot.stop',
  rateLimitMs: 1_000,
  burstRateLimitMs: 400,
  medianUsd: 50,
  maxTradeUsd: 500,
  minSplits: 0,
  minTrades: 0,
  minMon: 0.01,
  maxConsecutiveFailures: 10,
  walletIndex: 0,
}

export const ACTION_WEIGHTS = {
  div: 40,
  price: 40,
  splitMerge: 10,
  claim: 5,
  distribute: 5,
} as const

export interface PoolView {
  reserveToken: bigint
  reserveQuote: bigint
  fairWad: bigint | null
}

export interface WalletView {
  address: string
  monBalance: bigint
  mUsdBalance: bigint
  mAcmeBalance: bigint
  priceLegBalance: bigint
  divLegBalance: bigint
  pendingDividend: bigint
  canSplit: boolean
  canDistribute: boolean
}

export interface BotView {
  wallet: WalletView
  div: PoolView
  price: PoolView
}

export interface PlannedAction {
  kind: ActionKind
  describe: string
  estimateGasCostWei: bigint
  /** True only when a fresh approval tx will be broadcast for this action. */
  approvalNeeded?: boolean
  params?: Record<string, bigint>
}

export interface TxResult {
  ok: boolean
  gasUsed?: bigint
  gasPriceWei?: bigint
  hash?: string
  error?: string
  /** Actual broadcast tx count for this action (1, or 2 with approval). */
  txs?: number
}

export interface RunSummary {
  txCount: number
  trades: number
  splits: number
  merges: number
  claims: number
  distributes: number
  failed: number
  skipped: number
  gasSpentWei: bigint
  stopped: boolean
  stopReason: string
}

export interface LoopDeps {
  wallets: string[]
  config: BotConfig
  /** Shared budget (setup + loop). When omitted, the loop creates a fresh one. */
  budget?: TxBudget
  prepareAction: (wallet: string, splitsDone: number) => Promise<PlannedAction | null>
  execute: (wallet: string, action: PlannedAction) => Promise<TxResult>
  isStopped: () => boolean
  checkStopFile: () => boolean
  rateLimit: () => Promise<void>
  now: () => number
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
}

export class ArgError extends Error {}

function parseIntFlag(value: string | undefined, name: string): number {
  const n = Number(value)
  if (value === undefined || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ArgError(`${name} requires an integer value`)
  }
  return n
}

function parseFloatFlag(value: string | undefined, name: string): number {
  const n = Number(value)
  if (value === undefined || !Number.isFinite(n) || n <= 0) {
    throw new ArgError(`${name} requires a positive number`)
  }
  return n
}

export function parseArgs(argv: readonly string[]): { command: string; config: BotConfig; count?: number; force: boolean; mon: number; graphql: string | null } {
  const args = [...argv]
  let command = 'run'
  if (args.length > 0 && !args[0].startsWith('--')) {
    command = args.shift()!
  }
  const config: BotConfig = { ...DEFAULT_CONFIG }
  let count = 8
  let force = false
  let mon = 0.12
  let graphql: string | null = null

  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const next = () => {
      const v = args[++i]
      if (v === undefined) throw new ArgError(`${flag} requires a value`)
      return v
    }
    switch (flag) {
      case '--burst':
        config.burst = parseIntFlag(next(), flag)
        break
      case '--minutes':
        config.minutes = parseFloatFlag(next(), flag)
        break
      case '--max-txs':
        config.maxTxs = parseIntFlag(next(), flag)
        break
      case '--max-gas-mon':
        config.maxGasMon = parseFloatFlag(next(), flag)
        break
      case '--execute':
        config.execute = true
        break
      case '--dry-run':
        config.execute = false
        break
      case '--slippage-bps':
        config.slippageBps = parseIntFlag(next(), flag)
        break
      case '--stop-file':
        config.stopFile = next()
        break
      case '--rate-limit-ms':
        config.rateLimitMs = parseIntFlag(next(), flag)
        break
      case '--burst-rate-limit-ms':
        config.burstRateLimitMs = parseIntFlag(next(), flag)
        break
      case '--median-usd':
        config.medianUsd = parseFloatFlag(next(), flag)
        break
      case '--max-trade-usd':
        config.maxTradeUsd = parseFloatFlag(next(), flag)
        break
      case '--min-splits':
        config.minSplits = parseIntFlag(next(), flag)
        break
      case '--min-trades':
        config.minTrades = parseIntFlag(next(), flag)
        break
      case '--min-mon':
        config.minMon = parseFloatFlag(next(), flag)
        break
      case '--max-consecutive-failures':
        config.maxConsecutiveFailures = parseIntFlag(next(), flag)
        break
      case '--wallet-index':
        config.walletIndex = parseIntFlag(next(), flag)
        break
      case '--count':
        count = parseIntFlag(next(), flag)
        break
      case '--mon':
        mon = parseFloatFlag(next(), flag)
        break
      case '--force':
        force = true
        break
      case '--graphql':
        graphql = next()
        break
      default:
        throw new ArgError(`unknown flag: ${flag}`)
    }
  }

  if (config.burst !== null && config.burst < 0) throw new ArgError('--burst must be >= 0')
  if (config.maxTxs < 1) throw new ArgError('--max-txs must be >= 1')
  if (config.slippageBps < 0 || config.slippageBps > 5_000) throw new ArgError('--slippage-bps must be 0..5000')
  if (config.burst !== null && config.burst > config.maxTxs) {
    throw new ArgError('--burst cannot exceed --max-txs')
  }

  return { command, config, count, force, mon, graphql }
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

export function decideBuy(rng: Rng, poolPriceWad: bigint, fairWad: bigint | null): boolean {
  if (fairWad === null || fairWad === 0n) return rng.next() < 0.5
  if (poolPriceWad < fairWad) return rng.next() < 0.8
  if (poolPriceWad > fairWad) return rng.next() < 0.2
  return rng.next() < 0.5
}

export function lognormalSizeUsd(rng: Rng, median: number, cap: number): number {
  const u1 = Math.max(rng.next(), Number.EPSILON)
  const u2 = rng.next()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const raw = median * Math.exp(0.6 * z)
  const floor = Math.min(5, cap)
  return Math.min(Math.max(raw, floor), cap)
}

export function priceWad(reserveQuote: bigint, reserveToken: bigint): bigint | null {
  if (reserveToken <= 0n || reserveQuote <= 0n) return null
  return (reserveQuote * 10n ** 18n) / reserveToken
}

export function applySlippage(out: bigint, slippageBps: number): bigint {
  const bps = Math.max(0, Math.min(10_000, Math.trunc(slippageBps)))
  return (out * BigInt(10_000 - bps)) / 10_000n
}

export function legAmountForUsd(usdWad: bigint, price: bigint | null): bigint {
  if (price === null || price <= 0n) return 0n
  return (usdWad * 10n ** 18n) / price
}

export function usdWadFromNumber(n: number): bigint {
  const clamped = Math.max(0, n)
  return BigInt(Math.round(clamped * 1e18))
}

export function pickTradeKind(rng: Rng, view: BotView): ActionKind | null {
  const divPrice = priceWad(view.div.reserveQuote, view.div.reserveToken)
  const pricePrice = priceWad(view.price.reserveQuote, view.price.reserveToken)

  const candidates: PoolKind[] = []
  const divOk = divPrice !== null && (view.wallet.mUsdBalance > 0n || view.wallet.divLegBalance > 0n)
  const priceOk = pricePrice !== null && (view.wallet.mUsdBalance > 0n || view.wallet.priceLegBalance > 0n)
  if (divOk) candidates.push('div')
  if (priceOk) candidates.push('price')
  if (candidates.length === 0) return null

  const pool: PoolKind = candidates.length === 1 ? candidates[0] : rng.next() < 0.5 ? 'div' : 'price'
  const p = pool === 'div' ? divPrice : pricePrice
  const fair = pool === 'div' ? view.div.fairWad : view.price.fairWad
  const legBal = pool === 'div' ? view.wallet.divLegBalance : view.wallet.priceLegBalance
  const usdBal = view.wallet.mUsdBalance

  const canBuy = usdBal > 0n
  const canSell = legBal > 0n && p !== null
  if (!canBuy && !canSell) return null

  let buy: boolean
  if (canBuy && canSell && p !== null) buy = decideBuy(rng, p, fair)
  else buy = canBuy

  if (buy) return pool === 'div' ? 'buy-div' : 'buy-price'
  return pool === 'div' ? 'sell-div' : 'sell-price'
}

export function pickAction(rng: Rng, view: BotView, splitsDone: number, minSplits: number): ActionKind | null {
  const mustSplit =
    minSplits > 0 && splitsDone < minSplits && view.wallet.canSplit && view.wallet.mAcmeBalance > 0n
  if (mustSplit && rng.next() < 0.5) return 'split'

  const roll = rng.next() * 100
  if (roll < ACTION_WEIGHTS.div || roll < ACTION_WEIGHTS.div + ACTION_WEIGHTS.price) {
    return pickTradeKind(rng, view)
  }
  if (roll < ACTION_WEIGHTS.div + ACTION_WEIGHTS.price + ACTION_WEIGHTS.splitMerge) {
    if (view.wallet.canSplit && view.wallet.mAcmeBalance > 0n) return 'split'
    if (view.wallet.priceLegBalance > 0n && view.wallet.divLegBalance > 0n) return 'merge'
    return pickTradeKind(rng, view)
  }
  if (roll < 95) {
    if (view.wallet.pendingDividend > 0n) return 'claim'
    return pickTradeKind(rng, view)
  }
  if (view.wallet.canDistribute) return 'distribute'
  return pickTradeKind(rng, view)
}

export class FailureTracker {
  baseBackoffMs = 2_000
  maxBackoffMs = 60_000
  cooldownFailures = 3
  cooldownMs = 300_000
  private entries = new Map<string, { consecutive: number; until: number }>()

  recordSuccess(wallet: string): void {
    this.entries.delete(wallet)
  }

  recordFailure(wallet: string, now: number): number {
    const cur = this.entries.get(wallet) ?? { consecutive: 0, until: 0 }
    cur.consecutive += 1
    const backoff = Math.min(this.baseBackoffMs * 2 ** (cur.consecutive - 1), this.maxBackoffMs)
    const wait = cur.consecutive >= this.cooldownFailures ? this.cooldownMs : backoff
    cur.until = now + wait
    this.entries.set(wallet, cur)
    return wait
  }

  isCoolingDown(wallet: string, now: number): boolean {
    const cur = this.entries.get(wallet)
    return cur !== undefined && now < cur.until
  }

  consecutive(wallet: string): number {
    return this.entries.get(wallet)?.consecutive ?? 0
  }

  earliestAvailable(now: number): number | null {
    let min: number | null = null
    for (const cur of this.entries.values()) {
      if (cur.until > now && (min === null || cur.until < min)) min = cur.until
    }
    return min
  }
}

function monToWei(mon: number): bigint {
  const whole = Math.floor(mon)
  const frac = Math.round((mon - whole) * 1e18)
  return BigInt(whole) * 10n ** 18n + BigInt(frac)
}

export class TxBudget {
  maxTxs: number
  maxGasWei: bigint
  txCount = 0
  gasSpentWei = 0n
  reservedTxCount = 0
  reservedGasWei = 0n

  constructor(maxTxs: number, maxGasMon: number) {
    this.maxTxs = maxTxs
    this.maxGasWei = monToWei(maxGasMon)
  }

  canConfirm(count = 1): boolean {
    return this.txCount + this.reservedTxCount + count <= this.maxTxs
  }

  wouldExceedGas(estimateCostWei: bigint): boolean {
    return this.gasSpentWei + this.reservedGasWei + estimateCostWei > this.maxGasWei
  }

  reserve(count: number, estimateCostWei: bigint): boolean {
    if (!this.canConfirm(count) || this.wouldExceedGas(estimateCostWei)) {
      return false
    }
    this.reservedTxCount += count
    this.reservedGasWei += estimateCostWei
    return true
  }

  release(count: number, estimateCostWei: bigint): void {
    this.reservedTxCount = Math.max(0, this.reservedTxCount - count)
    this.reservedGasWei = this.reservedGasWei > estimateCostWei ? this.reservedGasWei - estimateCostWei : 0n
  }

  recordSuccess(gasCostWei: bigint, txCount = 1): void {
    this.txCount += txCount
    this.gasSpentWei += gasCostWei
  }

  recordFailureGas(gasCostWei: bigint): void {
    this.gasSpentWei += gasCostWei
  }

  exhausted(): boolean {
    return this.txCount >= this.maxTxs || this.gasSpentWei >= this.maxGasWei
  }

  gasSpentMon(): number {
    return Number(this.gasSpentWei) / 1e18
  }
}

export class ShutdownController {
  stopFile: string
  private fileExists: (path: string) => boolean
  private stopped = false
  private reason = ''

  constructor(stopFile: string, fileExists: (path: string) => boolean) {
    this.stopFile = stopFile
    this.fileExists = fileExists
  }

  requestStop(reason: string): void {
    this.stopped = true
    this.reason = reason
  }

  isStopped(): boolean {
    return this.stopped
  }

  getReason(): string {
    return this.reason
  }

  checkStopFile(): boolean {
    if (this.stopped) return true
    if (this.fileExists(this.stopFile)) {
      this.requestStop(`stop file present: ${this.stopFile}`)
      return true
    }
    return false
  }
}

export function createRateLimiter(
  minIntervalMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): () => Promise<void> {
  let last: number | null = null
  return async () => {
    const t = now()
    if (last !== null) {
      const wait = last + minIntervalMs - t
      if (wait > 0) await sleep(wait)
    }
    last = now()
  }
}

export function shortAddr(address: string): string {
  return address.length >= 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function emptySummary(): RunSummary {
  return {
    txCount: 0,
    trades: 0,
    splits: 0,
    merges: 0,
    claims: 0,
    distributes: 0,
    failed: 0,
    skipped: 0,
    gasSpentWei: 0n,
    stopped: false,
    stopReason: '',
  }
}

function countKind(summary: RunSummary, kind: ActionKind): void {
  if (kind === 'split') summary.splits += 1
  else if (kind === 'merge') summary.merges += 1
  else if (kind === 'claim') summary.claims += 1
  else if (kind === 'distribute') summary.distributes += 1
  else summary.trades += 1
}

export async function runLoop(deps: LoopDeps): Promise<RunSummary> {
  const summary = emptySummary()
  const failures = new FailureTracker()
  const budget = deps.budget ?? new TxBudget(deps.config.maxTxs, deps.config.maxGasMon)
  const start = deps.now()
  let index = 0
  let consecutiveGlobalFailures = 0
  let splitsDone = 0
  let skipStreak = 0

  for (;;) {
    if (deps.isStopped() || deps.checkStopFile()) {
      summary.stopped = true
      summary.stopReason = deps.isStopped() ? 'stopped' : 'stop file'
      break
    }
    if (
      deps.config.burst !== null &&
      summary.trades >= deps.config.burst &&
      summary.splits >= deps.config.minSplits
    ) {
      summary.stopReason = 'burst complete'
      break
    }
    if (deps.config.minutes !== null && deps.now() - start >= deps.config.minutes * 60_000) {
      summary.stopReason = 'minutes elapsed'
      break
    }
    if (budget.exhausted()) {
      summary.stopReason = budget.txCount >= deps.config.maxTxs ? 'max txs reached' : 'max gas reached'
      break
    }

    const now = deps.now()
    const active = deps.wallets.filter((w) => !failures.isCoolingDown(w, now))
    if (active.length === 0) {
      const earliest = failures.earliestAvailable(now)
      const wait = earliest === null ? 500 : Math.max(earliest - now, 250)
      await deps.sleep(wait)
      continue
    }

    const wallet = active[index % active.length]
    index += 1

    await deps.rateLimit()

    let action: PlannedAction | null = null
    let prepareAttempts = 0
    let prepareFailed = false
    for (;;) {
      prepareAttempts += 1
      try {
        action = await deps.prepareAction(wallet, splitsDone)
        break
      } catch (error) {
        const msg = String(error)
        const rateLimited = /15\/sec|rate|429|too many/i.test(msg)
        if (rateLimited && prepareAttempts < 4) {
          const backoff = prepareAttempts * 750
          deps.log(`retry ${shortAddr(wallet)}: prepare rate-limited (attempt ${prepareAttempts}) after ${backoff} ms`)
          await deps.sleep(backoff)
          continue
        }
        prepareFailed = true
        summary.skipped += 1
        skipStreak += 1
        deps.log(`skip ${shortAddr(wallet)}: prepare failed: ${msg}`)
        break
      }
    }

    if (prepareFailed) {
      if (skipStreak > deps.wallets.length * 4) {
        summary.stopReason = 'no further actions available'
        break
      }
      continue
    }

    if (action === null) {
      summary.skipped += 1
      skipStreak += 1
      if (skipStreak > deps.wallets.length * 4) {
        summary.stopReason = 'no further actions available'
        break
      }
      continue
    }
    skipStreak = 0

    const burstDone = deps.config.burst !== null && summary.trades >= deps.config.burst
    if (burstDone && !(action.kind === 'split' && splitsDone < deps.config.minSplits)) {
      summary.stopReason = 'burst complete'
      break
    }

    // Reserve only for txs that will actually be broadcast this step.
    // Reused bounded allowances need no approval tx (setup already paid those once).
    const needsApproval = action.approvalNeeded === true
    const reservedTxs = needsApproval ? 2 : 1

    if (!budget.canConfirm(reservedTxs) || budget.wouldExceedGas(action.estimateGasCostWei)) {
      summary.stopReason = budget.canConfirm(reservedTxs) ? 'max gas reached' : 'max txs reached'
      break
    }

    const reserved = budget.reserve(reservedTxs, action.estimateGasCostWei)
    if (!reserved) {
      summary.stopReason = budget.canConfirm(reservedTxs) ? 'max gas reached' : 'max txs reached'
      break
    }

    let result: TxResult
    try {
      result = await deps.execute(wallet, action)
    } catch (error) {
      result = { ok: false, error: String(error) }
    }

    const gasCost = (result.gasUsed ?? 0n) * (result.gasPriceWei ?? 0n)
    const actualTxs = Math.max(1, result.txs ?? 1)

    if (result.ok) {
      budget.release(reservedTxs, action.estimateGasCostWei)
      failures.recordSuccess(wallet)
      consecutiveGlobalFailures = 0
      budget.recordSuccess(gasCost, actualTxs)
      summary.gasSpentWei += gasCost
      countKind(summary, action.kind)
      if (action.kind === 'split') splitsDone += 1
      summary.txCount += actualTxs
      deps.log(
        `ok   ${shortAddr(wallet)} ${action.kind}${action.kind === 'split' || action.kind === 'merge' ? ` (${splitsDone} splits)` : ''} ${result.hash ?? ''}`.trimEnd(),
      )
    } else {
      budget.release(reservedTxs, action.estimateGasCostWei)
      budget.recordFailureGas(gasCost)
      summary.failed += 1
      consecutiveGlobalFailures += 1
      const waitMs = failures.recordFailure(wallet, deps.now())
      deps.log(`fail ${shortAddr(wallet)} ${action.kind}: ${result.error ?? 'unknown'} (backoff ${waitMs} ms)`)
      if (consecutiveGlobalFailures >= deps.config.maxConsecutiveFailures) {
        summary.stopped = true
        summary.stopReason = `${consecutiveGlobalFailures} consecutive failures`
        break
      }
    }
  }

  summary.gasSpentWei = budget.gasSpentWei
  if (summary.stopReason === '') summary.stopReason = deps.isStopped() ? 'stopped' : 'loop ended'
  return summary
}
