import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { network } from 'hardhat'
import { encodeAbiParameters } from 'viem'

const { viem, networkHelpers } = await network.create()
const publicClient = await viem.getPublicClient()
const wallets = await viem.getWalletClients()
const [forwarder, alice, bob] = wallets

const E = 10n ** 18n
const MAX = 2n ** 256n - 1n
const DAY = 86_400

const gasLog: Array<{ label: string; gas: bigint }> = []

async function tx(label: string, hash: Promise<`0x${string}`>) {
  const h = await hash
  const receipt = await publicClient.waitForTransactionReceipt({ hash: h })
  gasLog.push({ label, gas: receipt.gasUsed })
  return receipt
}

async function expectRevert(p: Promise<unknown>, reason: string): Promise<void> {
  let error: unknown
  try {
    await p
  } catch (e) {
    error = e
  }
  assert.ok(error !== undefined, `expected revert containing "${reason}", but the call succeeded`)
  const text = error instanceof Error ? `${error.message}\n${String(error)}` : String(error)
  assert.ok(
    text.includes(reason),
    `expected revert containing "${reason}", got: ${text.slice(0, 600)}`,
  )
}

async function deployCore() {
  const latest = await publicClient.getBlock()
  const maturity = latest.timestamp + 30n * BigInt(DAY)
  const stock = await viem.deployContract('MockStock')
  const usd = await viem.deployContract('MockUSD')
  const oracle = await viem.deployContract('DividendOracle', [forwarder.account.address])
  const splitter = await viem.deployContract('Splitter', [
    stock.address,
    usd.address,
    oracle.address,
    maturity,
    6,
  ])
  await tx('setMinter (setup)', usd.write.setMinter([splitter.address, true]))

  const priceLegAddress = await splitter.read.priceLeg()
  const divLegAddress = await splitter.read.dividendLeg()

  const bound = async <N extends 'MockStock' | 'MockUSD' | 'Splitter' | 'SplitToken' | 'DividendOracle'>(
    name: N,
    address: `0x${string}`,
    account: (typeof wallets)[number],
  ) => viem.getContractAt(name, address, { client: { walletClient: account, publicClient } })

  return {
    stock,
    usd,
    oracle,
    splitter,
    maturity,
    priceLegAddress,
    divLegAddress,
    stockAlice: await bound('MockStock', stock.address, alice),
    usdAlice: await bound('MockUSD', usd.address, alice),
    splitterAlice: await bound('Splitter', splitter.address, alice),
    divLegAlice: await bound('SplitToken', divLegAddress, alice),
    priceLegAlice: await bound('SplitToken', priceLegAddress, alice),
    divLegBob: await bound('SplitToken', divLegAddress, bob),
    oracleAlice: await bound('DividendOracle', oracle.address, alice),
    oracleForwarder: await bound('DividendOracle', oracle.address, forwarder),
  }
}

type Core = Awaited<ReturnType<typeof deployCore>>

async function splitAs(c: Core, who: (typeof wallets)[number], amount: bigint): Promise<void> {
  const stockWho = await viem.getContractAt('MockStock', c.stock.address, {
    client: { walletClient: who, publicClient },
  })
  const splitterWho = await viem.getContractAt('Splitter', c.splitter.address, {
    client: { walletClient: who, publicClient },
  })
  await tx('faucet', stockWho.write.faucet())
  await tx('approve stock', stockWho.write.approve([c.splitter.address, MAX]))
  await tx('split', splitterWho.write.split([amount]))
}

function encodeReport(seq: bigint, amountPerShare: bigint, refPrice: bigint): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [seq, amountPerShare, refPrice],
  )
}

after(() => {
  const rows = [...new Map(gasLog.map((g) => [g.label, g.gas])).entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, gas]) => `| ${label} | ${gas} |`)
    .join('\n')
  writeFileSync(
    join(process.cwd(), 'docs', 'gas.md'),
    [
      '# Gas report',
      '',
      'Measured via `receipt.gasUsed` on the Hardhat simulated network (solc 0.8.28, evm target paris),',
      'produced by the 8 required test groups in `test/cleave.test.ts` (`npx hardhat test`).',
      'T1.3 measures `estimateGas` on Monad Testnet × 1.25 and stores the limits in `src/chain/gas.ts`.',
      '',
      '| Call | gasUsed |',
      '|---|---|',
      rows,
      '',
    ].join('\n'),
  )
  console.log(`\ngas report written: ${gasLog.length} entries -> docs/gas.md`)
})

describe('1. split→merge round trip returns exact stock; legs burned', () => {
  it('returns exactly the deposited stock and burns both legs', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await splitAs(c, alice, 1000n * E)

    assert.equal(await c.stock.read.balanceOf([alice.account.address]), 0n)
    assert.equal(await c.priceLegAlice.read.balanceOf([alice.account.address]), 1000n * E)
    assert.equal(await c.divLegAlice.read.balanceOf([alice.account.address]), 1000n * E)

    await tx('merge', c.splitterAlice.write.merge([1000n * E]))

    const splitterStock = await c.stock.read.balanceOf([c.splitter.address])
    const balStockAfter = await c.stock.read.balanceOf([alice.account.address])
    // debug removed
    console.log('DEBUG:', splitterStock, balStockAfter)
    assert.equal(balStockAfter, 1000n * E)
    assert.equal(await c.priceLegAlice.read.balanceOf([alice.account.address]), 0n)
    assert.equal(await c.divLegAlice.read.balanceOf([alice.account.address]), 0n)
    assert.equal(await c.priceLegAlice.read.totalSupply(), 0n)
    assert.equal(await c.divLegAlice.read.totalSupply(), 0n)
    assert.equal(await c.stock.read.balanceOf([c.splitter.address]), 0n)
  })
})

describe('2. dividend accumulator: split 100, transfer 40, distribute $1 → A 60 / B 40, claim pays exactly once', () => {
  it('pays A 60 mUSD and B 40 mUSD, and only once', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await splitAs(c, alice, 100n * E)
    await tx('transfer 40 dACME', c.divLegAlice.write.transfer([bob.account.address, 40n * E]))

    await tx('declareDemo', c.oracle.write.declareDemo([1n * E]))
    await networkHelpers.time.increase(61)
    await tx('distribute', c.splitter.write.distribute())

    assert.equal(await c.divLegAlice.read.pending([alice.account.address]), 60n * E)
    assert.equal(await c.divLegBob.read.pending([bob.account.address]), 40n * E)

    await tx('claim A', c.divLegAlice.write.claim())
    assert.equal(await c.usd.read.balanceOf([alice.account.address]), 60n * E)

    await tx('claim B', c.divLegBob.write.claim())
    assert.equal(await c.usd.read.balanceOf([bob.account.address]), 40n * E)

    await tx('claim A again', c.divLegAlice.write.claim())
    assert.equal(await c.usd.read.balanceOf([alice.account.address]), 60n * E)
    assert.equal(await c.divLegAlice.read.pending([alice.account.address]), 0n)
  })
})

describe('3. transfer between two distributions: entitlements follow holdings at each distribution', () => {
  it('second distribution follows the new holder split', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await splitAs(c, alice, 100n * E)
    await tx('transfer 40 dACME', c.divLegAlice.write.transfer([bob.account.address, 40n * E]))

    await tx('declare #1', c.oracle.write.declareDemo([1n * E]))
    await networkHelpers.time.increase(61)
    await tx('distribute #1', c.splitter.write.distribute())
    assert.equal(await c.divLegAlice.read.pending([alice.account.address]), 60n * E)
    assert.equal(await c.divLegBob.read.pending([bob.account.address]), 40n * E)

    await tx('B returns 40 dACME', c.divLegBob.write.transfer([alice.account.address, 40n * E]))
    await networkHelpers.time.increase(61)
    await tx('declare #2', c.oracle.write.declareDemo([1n * E]))
    await networkHelpers.time.increase(61)
    await tx('distribute #2', c.splitter.write.distribute())

    assert.equal(await c.divLegAlice.read.pending([alice.account.address]), 160n * E)
    assert.equal(await c.divLegBob.read.pending([bob.account.address]), 40n * E)

    await tx('claim A', c.divLegAlice.write.claim())
    await tx('claim B', c.divLegBob.write.claim())
    assert.equal(await c.usd.read.balanceOf([alice.account.address]), 160n * E)
    assert.equal(await c.usd.read.balanceOf([bob.account.address]), 40n * E)
  })
})

describe('4. merge before claim keeps unclaimed dividends claimable', () => {
  it('settles on burn; claim after merge still pays the mUSD', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await splitAs(c, alice, 100n * E)
    await tx('declareDemo', c.oracle.write.declareDemo([1n * E]))
    await networkHelpers.time.increase(61)
    await tx('distribute', c.splitter.write.distribute())

    assert.equal(await c.divLegAlice.read.pending([alice.account.address]), 100n * E)

    await tx('merge before claim', c.splitterAlice.write.merge([100n * E]))
    assert.equal(await c.divLegAlice.read.pending([alice.account.address]), 100n * E)
    assert.equal(await c.divLegAlice.read.balanceOf([alice.account.address]), 0n)
    assert.equal(await c.stock.read.balanceOf([alice.account.address]), 1000n * E)

    await tx('claim after merge', c.divLegAlice.write.claim())
    assert.equal(await c.usd.read.balanceOf([alice.account.address]), 100n * E)
  })
})

describe('5. distribute() reverts: no declaration / before exAt / out of order / after maturity', () => {
  it('reverts when no declaration exists', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await expectRevert(c.splitter.write.distribute(), 'Splitter: no declaration')
  })

  it('reverts before exAt', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await tx('declareDemo', c.oracle.write.declareDemo([1n * E]))
    await expectRevert(c.splitter.write.distribute(), 'Splitter: too early')
  })

  it('reverts when asked to pay an id out of order (before it exists)', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await tx('declareDemo', c.oracle.write.declareDemo([1n * E]))
    await networkHelpers.time.increase(61)
    await tx('distribute #1', c.splitter.write.distribute())
    // nextDistributionId is now 2 but only id 1 exists: paying id 2 first
    // (out of order) must revert.
    await expectRevert(c.splitter.write.distribute(), 'Splitter: no declaration')
  })

  it('reverts after maturity', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await tx('declareDemo', c.oracle.write.declareDemo([1n * E]))
    await networkHelpers.time.increase(30 * DAY + 300)
    await expectRevert(c.splitter.write.distribute(), 'Splitter: matured')
  })
})

describe('6. oracle: CRE path enforces forwarder, seq and bounds; demo path enforces cooldown and bounds', () => {
  it('rejects non-forwarder callers', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    const report = encodeReport(1n, 1n * E, 100n * E)
    let err: unknown
    try {
      await c.oracleAlice.write.onReport(['0x', report])
    } catch (e) {
      err = e
    }
    assert.ok(err !== undefined)
  })

  it('accepts a forwarder report and stores a CRE declaration', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    const report = encodeReport(7n, 15n * 10n ** 16n, 101n * E)
    await tx('CRE report', c.oracleForwarder.write.onReport(['0x', report]))

    assert.equal(await c.oracle.read.count(), 1n)
    assert.equal(await c.oracle.read.lastSeq(), 7n)
    const d = await c.oracle.read.get([1n])
    assert.equal(d.id, 1n)
    assert.equal(d.seq, 7n)
    assert.equal(d.amountPerShare, 15n * 10n ** 16n)
    assert.equal(d.refPrice, 101n * E)
    assert.equal(Number(d.source), 0) // CRE
    assert.equal(d.exAt, d.declaredAt + 60n)
    assert.equal(await c.oracle.read.lastRefPrice(), 101n * E)
  })

  it('rejects seq <= lastSeq, bad amount and bad refPrice', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await tx(
      'CRE report seq=5',
      c.oracleForwarder.write.onReport(['0x', encodeReport(5n, 1n * E, 100n * E)]),
    )

    await expectRevert(
      c.oracleForwarder.write.onReport(['0x', encodeReport(5n, 1n * E, 100n * E)]),
      'DividendOracle: seq must increase',
    )
    await expectRevert(
      c.oracleForwarder.write.onReport(['0x', encodeReport(6n, 10n ** 15n, 100n * E)]),
      'DividendOracle: bad amount',
    )
    await expectRevert(
      c.oracleForwarder.write.onReport(['0x', encodeReport(6n, 6n * E, 100n * E)]),
      'DividendOracle: bad amount',
    )
    await expectRevert(
      c.oracleForwarder.write.onReport(['0x', encodeReport(6n, 1n * E, 10n ** 17n)]),
      'DividendOracle: bad refPrice',
    )
    await expectRevert(
      c.oracleForwarder.write.onReport(['0x', encodeReport(6n, 1n * E, 20_000n * E)]),
      'DividendOracle: bad refPrice',
    )
    assert.equal(await c.oracle.read.count(), 1n)
  })

  it('demo path enforces cooldown and bounds', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await expectRevert(c.oracle.write.declareDemo([10n ** 15n]), 'DividendOracle: bad amount')
    await expectRevert(c.oracle.write.declareDemo([6n * E]), 'DividendOracle: bad amount')

    await tx('declareDemo #1', c.oracle.write.declareDemo([1n * E]))
    await expectRevert(c.oracle.write.declareDemo([1n * E]), 'DividendOracle: cooldown')

    await networkHelpers.time.increase(120)
    await tx('declareDemo #2', c.oracle.write.declareDemo([2n * E]))
    assert.equal(await c.oracle.read.count(), 2n)
    const d = await c.oracle.read.get([2n])
    assert.equal(Number(d.source), 1) // DEMO
    assert.equal(d.refPrice, 100n * E)
  })
})

describe('7. redeem before maturity reverts; after maturity returns stock', () => {
  it('redeem is only possible at/after maturity and leaves the dividend leg worthless', async () => {
    const c = await networkHelpers.loadFixture(deployCore)
    await splitAs(c, alice, 100n * E)

    await expectRevert(c.splitterAlice.write.redeem([100n * E]), 'Splitter: not matured')

    await networkHelpers.time.increaseTo(c.maturity)
    await tx('redeem', c.splitterAlice.write.redeem([100n * E]))

    assert.equal(await c.stock.read.balanceOf([alice.account.address]), 1000n * E)
    assert.equal(await c.priceLegAlice.read.balanceOf([alice.account.address]), 0n)
    assert.equal(await c.divLegAlice.read.balanceOf([alice.account.address]), 100n * E)

    // merge and split are closed after maturity
    await expectRevert(c.splitterAlice.write.merge([1n]), 'Splitter: matured')
  })
})

describe('8. pool: k never decreases, quotes match, slippage enforced, liquidity round trip', () => {
  async function deployPool() {
    const c = await deployCore()
    const pool = await viem.deployContract('Pool', [c.stock.address, c.usd.address, 30])
    // ensure alice has stock
    await tx('mint stock to alice', c.stock.write.mint([alice.account.address, 10_000n * E]))
    await tx('mint usd to alice', c.usd.write.mint([alice.account.address, 1_000_000n * E]))
    const poolAlice = await viem.getContractAt('Pool', pool.address, {
      client: { walletClient: alice, publicClient },
    })
    await tx('approve stock to pool', c.stockAlice.write.approve([pool.address, MAX]))
    await tx('approve usd to pool', c.usdAlice.write.approve([pool.address, MAX]))
    const sA = await c.stock.read.balanceOf([alice.account.address])
    const qA = await c.usd.read.balanceOf([alice.account.address])
    assert.equal(sA, 10_000n * E)
    assert.equal(qA, 1_000_000n * E)
    return { ...c, pool, poolAlice }
  }

  it('k never decreases after swaps and getAmountOut equals the executed output', async () => {
    const { pool, poolAlice, stockAlice, usdAlice } = await networkHelpers.loadFixture(deployPool)
    await tx('addLiquidity', poolAlice.write.addLiquidity([5000n * E, 30_000n * E, 1n]))

    const cases: Array<[boolean, bigint]> = [
      [true, 100n * E],
      [false, 600n * E],
      [true, 250n * E],
    ]
    for (const [tokenIn, amountIn] of cases) {
      const rT0 = await pool.read.reserveToken()
      const rQ0 = await pool.read.reserveQuote()
      const k0 = rT0 * rQ0

      const [quoted] = await pool.read.getAmountOut([tokenIn, amountIn])
      const stockBefore = await stockAlice.read.balanceOf([alice.account.address])
      const usdBefore = await usdAlice.read.balanceOf([alice.account.address])

      await tx(
        `swap tokenIn=${tokenIn}`,
        poolAlice.write.swapExactIn([tokenIn, amountIn, quoted]),
      )

      const rT1 = await pool.read.reserveToken()
      const rQ1 = await pool.read.reserveQuote()
      assert.ok(rT1 * rQ1 >= k0, `k decreased after swap (tokenIn=${tokenIn})`)

      const stockAfter = await stockAlice.read.balanceOf([alice.account.address])
      const usdAfter = await usdAlice.read.balanceOf([alice.account.address])
      if (tokenIn) {
        assert.equal(stockBefore - stockAfter, amountIn, 'paid stock equals amountIn')
        assert.equal(usdAfter - usdBefore, quoted, 'received mUSD equals getAmountOut quote')
      } else {
        assert.equal(usdBefore - usdAfter, amountIn, 'paid mUSD equals amountIn')
        assert.equal(stockAfter - stockBefore, quoted, 'received stock equals getAmountOut quote')
      }
    }
  })

  it('enforces slippage via minOut', async () => {
    const { pool, poolAlice } = await networkHelpers.loadFixture(deployPool)
    await tx('addLiquidity', poolAlice.write.addLiquidity([5000n * E, 30_000n * E, 1n]))
    const [quoted] = await pool.read.getAmountOut([true, 100n * E])
    await expectRevert(
      poolAlice.write.swapExactIn([true, 100n * E, quoted + 1n]),
      'Pool: slippage',
    )
  })

  it('first deposit locks 1000 wei shares and add/remove round trips within rounding', async () => {
    const { pool, poolAlice, stockAlice, usdAlice } = await networkHelpers.loadFixture(deployPool)

    await tx('addLiquidity', poolAlice.write.addLiquidity([5000n * E, 30_000n * E, 1n]))
    const aliceShares = await pool.read.shares([alice.account.address])
    const total = await pool.read.totalShares()
    assert.equal(await pool.read.shares(['0x0000000000000000000000000000000000000000']), 1000n)
    assert.equal(total, aliceShares + 1000n)

    const stockBefore = await stockAlice.read.balanceOf([alice.account.address])
    const usdBefore = await usdAlice.read.balanceOf([alice.account.address])

    await tx('removeLiquidity', poolAlice.write.removeLiquidity([aliceShares, 0n, 0n]))

    const stockAfter = await stockAlice.read.balanceOf([alice.account.address])
    const usdAfter = await usdAlice.read.balanceOf([alice.account.address])
    const tokenOut = stockAfter - stockBefore
    const quoteOut = usdAfter - usdBefore

    // within rounding: the only loss is the 1000 dead shares + integer division dust
    const stockLoss = 5000n * E - tokenOut
    const usdLoss = 30_000n * E - quoteOut
    assert.ok(stockLoss < 10n ** 15n, `stock round-trip loss too large: ${stockLoss}`)
    assert.ok(usdLoss < 10n ** 15n, `usd round-trip loss too large: ${usdLoss}`)

    // only the dead shares remain in the pool
    assert.equal(await pool.read.totalShares(), 1000n)
    assert.ok((await pool.read.reserveToken()) < 10n ** 15n)
    assert.ok((await pool.read.reserveQuote()) < 10n ** 15n)
  })
})

function keccakSelector(signature: string): string {
  // Inline import avoided at module top to keep this helper self-contained.
  const { keccak256, toHex } = viemUtils
  return keccak256(toHex(signature)).slice(0, 10)
}

const viemUtils = await import('viem')
