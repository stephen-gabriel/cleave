import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTION_WEIGHTS,
  ArgError,
  DEFAULT_CONFIG,
  FailureTracker,
  ShutdownController,
  TxBudget,
  applySlippage,
  createRateLimiter,
  decideBuy,
  emptySummary,
  legAmountForUsd,
  lognormalSizeUsd,
  mulberry32,
  parseArgs,
  pickAction,
  pickTradeKind,
  priceWad,
  runLoop,
  shortAddr,
  usdWadFromNumber,
  type BotView,
  type PlannedAction,
  type Rng,
  type TxResult,
  type WalletView,
} from '../scripts/lib/botCore'
import {
  addressesFromKeys,
  formatEnvBot,
  generatePrivateKeys,
  loadBotKeys,
  writeEnvBot,
  writeSimWallets,
} from '../scripts/lib/botWallets'

const E = 10n ** 18n

function wallet(overrides: Partial<WalletView> = {}): WalletView {
  return {
    address: '0x1111111111111111111111111111111111111111',
    monBalance: 10n ** 17n,
    mUsdBalance: 10_000n * E,
    mAcmeBalance: 1_000n * E,
    priceLegBalance: 500n * E,
    divLegBalance: 500n * E,
    pendingDividend: 0n,
    canSplit: true,
    canDistribute: false,
    ...overrides,
  }
}

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    wallet: overrides.wallet ?? wallet(),
    div: overrides.div ?? { reserveToken: 5_000n * E, reserveQuote: 30_000n * E, fairWad: 6n * E },
    price: overrides.price ?? { reserveToken: 5_000n * E, reserveQuote: 470_000n * E, fairWad: 94n * E },
  }
}

function fixedRng(values: number[]): Rng {
  let i = 0
  return {
    next(): number {
      const v = values[i % values.length]
      i += 1
      return v
    },
  }
}

describe('parseArgs', () => {
  it('defaults to dry-run with safe limits', () => {
    const { command, config } = parseArgs([])
    expect(command).toBe('run')
    expect(config.execute).toBe(false)
    expect(config.burst).toBeNull()
    expect(config.maxTxs).toBe(DEFAULT_CONFIG.maxTxs)
    expect(config.maxGasMon).toBe(DEFAULT_CONFIG.maxGasMon)
    expect(config.minSplits).toBe(0)
  })

  it('parses run flags', () => {
    const { config } = parseArgs([
      'run', '--burst', '300', '--minutes', '20', '--max-txs', '400',
      '--max-gas-mon', '0.2', '--execute', '--min-splits', '20', '--slippage-bps', '150',
    ])
    expect(config.burst).toBe(300)
    expect(config.minutes).toBe(20)
    expect(config.maxTxs).toBe(400)
    expect(config.maxGasMon).toBe(0.2)
    expect(config.execute).toBe(true)
    expect(config.minSplits).toBe(20)
    expect(config.slippageBps).toBe(150)
  })

  it('parses generate-wallets command', () => {
    const { command, count, force } = parseArgs(['generate-wallets', '--count', '8', '--force'])
    expect(command).toBe('generate-wallets')
    expect(count).toBe(8)
    expect(force).toBe(true)
  })

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--nope'])).toThrow(ArgError)
  })

  it('rejects non-integer burst', () => {
    expect(() => parseArgs(['--burst', 'abc'])).toThrow(ArgError)
    expect(() => parseArgs(['--burst', '1.5'])).toThrow(ArgError)
  })

  it('rejects burst greater than max-txs', () => {
    expect(() => parseArgs(['--burst', '50', '--max-txs', '10'])).toThrow(/cannot exceed/)
  })

  it('rejects missing flag values', () => {
    expect(() => parseArgs(['--burst'])).toThrow(ArgError)
  })

  it('rejects out-of-range slippage', () => {
    expect(() => parseArgs(['--slippage-bps', '9999'])).toThrow(ArgError)
  })
})

describe('rng helpers', () => {
  it('mulberry32 is deterministic and within [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const x = a.next()
      expect(x).toBe(b.next())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('decideBuy prefers buying cheap pools and selling rich pools', () => {
    const cheapRng = mulberry32(1)
    let buys = 0
    for (let i = 0; i < 200; i++) {
      if (decideBuy(cheapRng, 5n * E, 6n * E)) buys += 1
    }
    expect(buys).toBeGreaterThan(130)

    const richRng = mulberry32(2)
    let sells = 0
    for (let i = 0; i < 200; i++) {
      if (!decideBuy(richRng, 7n * E, 6n * E)) sells += 1
    }
    expect(sells).toBeGreaterThan(130)
  })

  it('decideBuy without fair value is roughly even', () => {
    const rng = mulberry32(3)
    let buys = 0
    for (let i = 0; i < 400; i++) {
      if (decideBuy(rng, 6n * E, null)) buys += 1
    }
    expect(buys).toBeGreaterThan(140)
    expect(buys).toBeLessThan(260)
  })

  it('lognormalSizeUsd stays within floor and cap', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 500; i++) {
      const size = lognormalSizeUsd(rng, 50, 500)
      expect(size).toBeGreaterThanOrEqual(5)
      expect(size).toBeLessThanOrEqual(500)
    }
  })

  it('lognormalSizeUsd respects a smaller cap', () => {
    const rng = mulberry32(8)
    for (let i = 0; i < 100; i++) {
      expect(lognormalSizeUsd(rng, 50, 10)).toBeLessThanOrEqual(10)
    }
  })
})

describe('pure math', () => {
  it('applySlippage reduces output by bps', () => {
    expect(applySlippage(10_000n, 100)).toBe(9_900n)
    expect(applySlippage(10_000n, 0)).toBe(10_000n)
    expect(applySlippage(10_000n, 5_000)).toBe(5_000n)
  })

  it('applySlippage clamps invalid bps', () => {
    expect(applySlippage(10_000n, -5)).toBe(10_000n)
    expect(applySlippage(10_000n, 99_999)).toBe(0n)
  })

  it('priceWad returns quote per token in wad', () => {
    expect(priceWad(30_000n * E, 5_000n * E)).toBe(6n * E)
    expect(priceWad(470_000n * E, 5_000n * E)).toBe(94n * E)
    expect(priceWad(1n, 0n)).toBeNull()
  })

  it('legAmountForUsd converts mUSD value into leg units', () => {
    expect(legAmountForUsd(50n * E, 6n * E)).toBe((50n * E * E) / (6n * E))
    expect(legAmountForUsd(50n * E, null)).toBe(0n)
    expect(legAmountForUsd(50n * E, 0n)).toBe(0n)
  })

  it('usdWadFromNumber rounds to wad', () => {
    expect(usdWadFromNumber(50)).toBe(50n * E)
    expect(usdWadFromNumber(0.5)).toBe(E / 2n)
    expect(usdWadFromNumber(-1)).toBe(0n)
  })

  it('shortAddr abbreviates', () => {
    expect(shortAddr('0x899595c2802828BCc25636Bf976A89d4B15824Cd')).toBe('0x8995…24Cd')
  })
})

describe('pickTradeKind', () => {
  it('returns null when no pool has liquidity', () => {
    const v = view({
      div: { reserveToken: 0n, reserveQuote: 0n, fairWad: null },
      price: { reserveToken: 0n, reserveQuote: 0n, fairWad: null },
    })
    expect(pickTradeKind(mulberry32(1), v)).toBeNull()
  })

  it('returns null when wallet has no balances', () => {
    const v = view({
      wallet: wallet({ mUsdBalance: 0n, priceLegBalance: 0n, divLegBalance: 0n }),
    })
    expect(pickTradeKind(mulberry32(1), v)).toBeNull()
  })

  it('only buys when the wallet has no leg tokens', () => {
    const v = view({
      wallet: wallet({ priceLegBalance: 0n, divLegBalance: 0n }),
    })
    for (let i = 0; i < 20; i++) {
      const kind = pickTradeKind(mulberry32(i), v)
      expect(kind === 'buy-div' || kind === 'buy-price').toBe(true)
    }
  })

  it('only sells when the wallet has no mUSD', () => {
    const v = view({
      wallet: wallet({ mUsdBalance: 0n }),
    })
    for (let i = 0; i < 20; i++) {
      const kind = pickTradeKind(mulberry32(i), v)
      expect(kind === 'sell-div' || kind === 'sell-price').toBe(true)
    }
  })
})

describe('pickAction', () => {
  it('follows the documented weight buckets', () => {
    const rng = mulberry32(11)
    const counts: Record<string, number> = {}
    const v = view()
    for (let i = 0; i < 2_000; i++) {
      const kind = pickAction(rng, v, 100, 0)
      if (kind === null) continue
      counts[kind] = (counts[kind] ?? 0) + 1
    }
    const trades = (counts['buy-div'] ?? 0) + (counts['sell-div'] ?? 0) + (counts['buy-price'] ?? 0) + (counts['sell-price'] ?? 0)
    const splits = counts['split'] ?? 0
    const merges = counts['merge'] ?? 0
    const claims = counts['claim'] ?? 0
    const distributes = counts['distribute'] ?? 0
    expect(trades).toBeGreaterThan(1_400)
    expect(splits + merges).toBeGreaterThan(100)
    expect(claims).toBe(0)
    expect(distributes).toBe(0)
    const total = trades + splits + merges + claims + distributes
    expect(total).toBe(2_000)
    expect(trades / total).toBeGreaterThan(0.7)
    expect(trades / total).toBeLessThan(0.9)
  })

  it('forces splits while under min-splits', () => {
    const rng = fixedRng([0.25])
    const v = view()
    const kind = pickAction(rng, v, 0, 20)
    expect(kind).toBe('split')
  })

  it('claims when pending dividend exists and claim weight hits', () => {
    const v = view({ wallet: wallet({ pendingDividend: 5n * E }) })
    const kind = pickAction(fixedRng([0.91]), v, 100, 0)
    expect(kind).toBe('claim')
  })

  it('distributes when due and distribute weight hits', () => {
    const v = view({ wallet: wallet({ canDistribute: true }) })
    const kind = pickAction(fixedRng([0.96]), v, 100, 0)
    expect(kind).toBe('distribute')
  })

  it('falls back to trade when claim is unavailable', () => {
    const v = view({ wallet: wallet({ pendingDividend: 0n }) })
    const kind = pickAction(fixedRng([0.91, 0.5]), v, 100, 0)
    expect(kind === 'buy-div' || kind === 'sell-div' || kind === 'buy-price' || kind === 'sell-price').toBe(true)
  })
})

describe('FailureTracker', () => {
  it('backs off exponentially and then cools down', () => {
    const tracker = new FailureTracker()
    const wait1 = tracker.recordFailure('w', 0)
    expect(wait1).toBe(2_000)
    expect(tracker.isCoolingDown('w', 1_000)).toBe(true)
    expect(tracker.isCoolingDown('w', 3_000)).toBe(false)

    const wait2 = tracker.recordFailure('w', 3_000)
    expect(wait2).toBe(4_000)
    const wait3 = tracker.recordFailure('w', 8_000)
    expect(wait3).toBe(300_000)
    expect(tracker.isCoolingDown('w', 8_001)).toBe(true)
    expect(tracker.isCoolingDown('w', 309_000)).toBe(false)
  })

  it('clears failures on success', () => {
    const tracker = new FailureTracker()
    tracker.recordFailure('w', 0)
    expect(tracker.consecutive('w')).toBe(1)
    tracker.recordSuccess('w')
    expect(tracker.consecutive('w')).toBe(0)
    expect(tracker.isCoolingDown('w', 1)).toBe(false)
  })

  it('reports earliest available time', () => {
    const tracker = new FailureTracker()
    tracker.recordFailure('a', 0)
    tracker.recordFailure('b', 10)
    expect(tracker.earliestAvailable(0)).toBe(2_000)
    expect(tracker.earliestAvailable(10_000)).toBeNull()
  })
})

describe('TxBudget', () => {
  it('caps confirmed transactions', () => {
    const budget = new TxBudget(2, 1)
    expect(budget.canConfirm()).toBe(true)
    budget.recordSuccess(1n)
    budget.recordSuccess(1n)
    expect(budget.canConfirm()).toBe(false)
    expect(budget.exhausted()).toBe(true)
    expect(budget.txCount).toBe(2)
  })

  it('caps gas spend in MON terms', () => {
    const budget = new TxBudget(100, 0.001)
    expect(budget.wouldExceedGas(10n ** 15n)).toBe(false)
    budget.recordSuccess(9n * 10n ** 14n)
    expect(budget.wouldExceedGas(2n * 10n ** 14n)).toBe(true)
    expect(budget.exhausted()).toBe(false)
    budget.recordSuccess(2n * 10n ** 14n)
    expect(budget.exhausted()).toBe(true)
  })

  it('counts failure gas without incrementing tx count', () => {
    const budget = new TxBudget(10, 1)
    budget.recordFailureGas(10n ** 18n)
    expect(budget.txCount).toBe(0)
    expect(budget.exhausted()).toBe(true)
    expect(budget.gasSpentMon()).toBeCloseTo(1)
  })
})

describe('ShutdownController', () => {
  it('stops on request', () => {
    const shutdown = new ShutdownController('bot.stop', () => false)
    expect(shutdown.isStopped()).toBe(false)
    shutdown.requestStop('test')
    expect(shutdown.isStopped()).toBe(true)
    expect(shutdown.getReason()).toBe('test')
  })

  it('stops when the stop file appears', () => {
    let present = false
    const shutdown = new ShutdownController('bot.stop', () => present)
    expect(shutdown.checkStopFile()).toBe(false)
    present = true
    expect(shutdown.checkStopFile()).toBe(true)
    expect(shutdown.isStopped()).toBe(true)
    expect(shutdown.getReason()).toContain('bot.stop')
  })
})

describe('createRateLimiter', () => {
  it('waits for the minimum interval', async () => {
    let clock = 0
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    }
    const now = () => clock
    const limit = createRateLimiter(1_000, now, sleep)
    await limit()
    await limit()
    await limit()
    expect(sleeps).toEqual([1_000, 1_000])
    expect(clock).toBe(2_000)
  })
})

interface MockLoopOptions {
  burst?: number | null
  maxTxs?: number
  maxGasMon?: number
  minSplits?: number
  executeResult?: (wallet: string, action: PlannedAction) => TxResult | Promise<TxResult>
  prepare?: (wallet: string, splitsDone: number) => PlannedAction | null | Promise<PlannedAction | null>
  wallets?: string[]
  maxConsecutiveFailures?: number
  stopFilePresent?: boolean
}

async function runMockLoop(options: MockLoopOptions = {}) {
  const wallets = options.wallets ?? ['0xaaa0000000000000000000000000000000000001', '0xaaa0000000000000000000000000000000000002']
  const config = {
    ...DEFAULT_CONFIG,
    burst: options.burst ?? null,
    maxTxs: options.maxTxs ?? 100,
    maxGasMon: options.maxGasMon ?? 1,
    minSplits: options.minSplits ?? 0,
    maxConsecutiveFailures: options.maxConsecutiveFailures ?? 10,
  }
  let clock = 0
  const logs: string[] = []
  let tradeCount = 0
  let splitCount = 0

  const summary = await runLoop({
    wallets,
    config,
    isStopped: () => false,
    checkStopFile: () => options.stopFilePresent === true,
    rateLimit: async () => {
      clock += 10
    },
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
    },
    log: (line) => logs.push(line),
    prepareAction: async (wallet, splitsDone): Promise<PlannedAction | null> => {
      if (options.prepare) return options.prepare(wallet, splitsDone)
      if (config.minSplits > 0 && splitsDone < config.minSplits) {
        return { kind: 'split', describe: `split ${splitsDone}`, estimateGasCostWei: 0n, params: { amount: E } }
      }
      tradeCount += 1
      splitCount += 0
      return { kind: 'buy-div', describe: 'buy', estimateGasCostWei: 0n, params: { amountIn: E, minOut: E } }
    },
    execute: async (_wallet, action): Promise<TxResult> => {
      if (options.executeResult) return await options.executeResult(_wallet, action)
      return { ok: true, gasUsed: 1_000n, gasPriceWei: 1n, hash: '0xmock' }
    },
  })
  return { summary, logs, clock }
}

describe('runLoop', () => {
  it('stops at the burst target counting only successful trades', async () => {
    const { summary } = await runMockLoop({ burst: 10 })
    expect(summary.trades).toBe(10)
    expect(summary.txCount).toBe(10)
    expect(summary.stopReason).toBe('burst complete')
    expect(summary.failed).toBe(0)
  })

  it('does not count failed transactions toward the cap', async () => {
    let attempt = 0
    const { summary } = await runMockLoop({
      burst: 3,
      maxTxs: 5,
      maxConsecutiveFailures: 100,
      executeResult: () => {
        attempt += 1
        return attempt % 2 === 1 ? { ok: false, error: 'boom' } : { ok: true, gasUsed: 1n, gasPriceWei: 1n, hash: '0xok' }
      },
    })
    expect(summary.trades).toBe(3)
    expect(summary.failed).toBe(3)
    expect(summary.txCount).toBe(3)
  })

  it('stops at max-txs', async () => {
    const { summary } = await runMockLoop({ maxTxs: 4 })
    expect(summary.txCount).toBe(4)
    expect(summary.stopReason).toBe('max txs reached')
  })

  it('stops at max-gas-mon', async () => {
    const { summary } = await runMockLoop({
      maxGasMon: 0.00001,
      executeResult: () => ({ ok: true, gasUsed: 10n ** 15n, gasPriceWei: 1n, hash: '0xgas' }),
    })
    expect(summary.stopReason).toMatch(/gas/)
    expect(summary.txCount).toBeLessThanOrEqual(1)
  })

  it('cools a failing wallet down and continues with the other wallet', async () => {
    const failing = '0xaaa0000000000000000000000000000000000001'
    let failingExecs = 0
    const { summary, logs } = await runMockLoop({
      burst: 4,
      maxConsecutiveFailures: 100,
      executeResult: (wallet) => {
        if (wallet === failing) {
          failingExecs += 1
          return { ok: false, error: 'revert' }
        }
        return { ok: true, gasUsed: 1n, gasPriceWei: 1n, hash: '0xok' }
      },
    })
    expect(summary.trades).toBe(4)
    expect(failingExecs).toBeLessThanOrEqual(3)
    expect(logs.some((l) => l.includes('backoff'))).toBe(true)
    expect(summary.failed).toBeGreaterThan(0)
  })

  it('stops after too many consecutive global failures', async () => {
    const { summary } = await runMockLoop({
      burst: 50,
      maxConsecutiveFailures: 3,
      executeResult: () => ({ ok: false, error: 'always fails' }),
    })
    expect(summary.stopped).toBe(true)
    expect(summary.stopReason).toContain('consecutive failures')
    expect(summary.failed).toBe(3)
  })

  it('stops when the stop file is present', async () => {
    const { summary } = await runMockLoop({ stopFilePresent: true })
    expect(summary.stopped).toBe(true)
    expect(summary.stopReason).toBe('stop file')
    expect(summary.txCount).toBe(0)
  })

  it('keeps splitting until min-splits even after the burst target', async () => {
    let plannedSplits = 0
    const { summary } = await runMockLoop({
      burst: 2,
      minSplits: 5,
      prepare: async (_wallet, splitsDone): Promise<PlannedAction | null> => {
        if (splitsDone < 5) {
          plannedSplits += 1
          return { kind: 'split', describe: 'split', estimateGasCostWei: 0n, params: { amount: E } }
        }
        return { kind: 'buy-div', describe: 'buy', estimateGasCostWei: 0n, params: { amountIn: E, minOut: E } }
      },
    })
    expect(summary.trades).toBe(2)
    expect(summary.splits).toBe(5)
    expect(plannedSplits).toBe(5)
  })

  it('skips actions that return null and ends cleanly', async () => {
    const { summary } = await runMockLoop({
      burst: 1,
      prepare: async (): Promise<PlannedAction | null> => null,
    })
    expect(summary.trades).toBe(0)
    expect(summary.skipped).toBeGreaterThan(0)
    expect(summary.stopReason).toBe('no further actions available')
  })

  it('dry-run style results still count as confirmed planning successes', async () => {
    const { summary } = await runMockLoop({
      burst: 3,
      executeResult: () => ({ ok: true, gasUsed: 0n, gasPriceWei: 0n, hash: 'dry-run' }),
    })
    expect(summary.trades).toBe(3)
    expect(summary.gasSpentWei).toBe(0n)
  })
})

describe('wallet utilities', () => {
  it('generates unique keys with matching addresses', () => {
    const keys = generatePrivateKeys(4)
    expect(keys).toHaveLength(4)
    for (const key of keys) {
      expect(key).toMatch(/^0x[0-9a-f]{64}$/)
    }
    const unique = new Set(keys)
    expect(unique.size).toBe(4)
    const addresses = addressesFromKeys(keys)
    expect(addresses).toHaveLength(4)
    for (const address of addresses) {
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('rejects invalid wallet counts', () => {
    expect(() => generatePrivateKeys(0)).toThrow()
    expect(() => generatePrivateKeys(100)).toThrow()
  })

  it('round-trips keys through the env format', () => {
    const keys = generatePrivateKeys(3)
    const text = formatEnvBot(keys)
    expect(text.startsWith('BOT_PRIVATE_KEYS=')).toBe(true)
    const dir = mkdtempSync(join(tmpdir(), 'cleave-bot-'))
    try {
      const path = join(dir, '.env.bot')
      writeFileSync(path, text, 'utf8')
      const loaded = loadBotKeys(path)
      expect(loaded).toEqual(keys)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('filters malformed keys on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cleave-bot-'))
    try {
      const path = join(dir, '.env.bot')
      writeFileSync(path, 'BOT_PRIVATE_KEYS=0xabc,notakey,0xdef\n', 'utf8')
      expect(loadBotKeys(path)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns empty list when the env file is missing', () => {
    expect(loadBotKeys(join(tmpdir(), 'definitely-missing-.env.bot'))).toEqual([])
  })

  it('writeEnvBot refuses to overwrite without force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cleave-bot-'))
    try {
      const path = join(dir, '.env.bot')
      writeEnvBot(path, generatePrivateKeys(2), false)
      expect(() => writeEnvBot(path, generatePrivateKeys(2), false)).toThrow(/exists/)
      writeEnvBot(path, generatePrivateKeys(2), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes sorted public addresses for the sim classifier', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cleave-bot-'))
    try {
      const path = join(dir, 'config', 'sim-wallets.json')
      const keys = generatePrivateKeys(3)
      const addresses = addressesFromKeys(keys)
      writeSimWallets(path, [...addresses].reverse())
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { wallets: string[] }
      expect(parsed.wallets).toHaveLength(3)
      const sorted = [...addresses].map((a) => a.toLowerCase()).sort()
      expect(parsed.wallets.map((a) => a.toLowerCase())).toEqual(sorted)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('emptySummary', () => {
  it('starts zeroed', () => {
    const s = emptySummary()
    expect(s.txCount).toBe(0)
    expect(s.gasSpentWei).toBe(0n)
    expect(ACTION_WEIGHTS.div + ACTION_WEIGHTS.price + ACTION_WEIGHTS.splitMerge + ACTION_WEIGHTS.claim + ACTION_WEIGHTS.distribute).toBe(100)
  })
})
