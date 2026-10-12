import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hash,
} from 'viem'
import { monadTestnet } from 'viem/chains'
import type { PrivateKeyAccount } from 'viem/accounts'
import { privateKeyToAccount } from 'viem/accounts'
import {
  ArgError,
  applySlippage,
  createRateLimiter,
  legAmountForUsd,
  lognormalSizeUsd,
  mulberry32,
  parseArgs,
  pickAction,
  priceWad,
  runLoop,
  shortAddr,
  usdWadFromNumber,
  ShutdownController,
  TxBudget,
  type BotConfig,
  type BotView,
  type PlannedAction,
  type PoolView,
  type TxResult,
  type WalletView,
} from './lib/botCore.ts'
import {
  addressesFromKeys,
  defaultBotEnvPath,
  defaultSimWalletsPath,
  generatePrivateKeys,
  loadBotKeys,
  writeEnvBot,
  writeSimWallets,
} from './lib/botWallets.ts'

const E = 10n ** 18n
const GAS_HEADROOM_PERCENT = 125n
const BOUND_USD_POOL = 25_000n * E
const BOUND_LEG_POOL = 1_000n * E
const BOUND_SPLITTER = 1_000n * E
const FAUCET_USD_LOW = 1_000n * E
const FAUCET_ACME_LOW = 100n * E
const MIN_SPLIT = 1n * E
const MAX_SPLIT = 100n * E
const MAX_MERGE = 100n * E
const NATIVE_TRANSFER_GAS = 21_000n
const FALLBACK_DEPLOYER = '0x899595c2802828BCc25636Bf976A89d4B15824Cd' as Address

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function faucet()',
])

const SPLITTER_ABI = parseAbi([
  'function split(uint256 amount)',
  'function merge(uint256 amount)',
  'function distribute()',
  'function remainingDividends() view returns (uint256)',
  'function nextDistributionId() view returns (uint64)',
])

const SPLIT_TOKEN_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function pending(address account) view returns (uint256)',
  'function claim()',
])

const POOL_ABI = parseAbi([
  'function getAmountOut(bool tokenIn, uint256 amountIn) view returns (uint256 out, uint256 fee, uint256 priceImpactBps)',
  'function reserveToken() view returns (uint256)',
  'function reserveQuote() view returns (uint256)',
  'function swapExactIn(bool tokenIn, uint256 amountIn, uint256 minOut) returns (uint256 out)',
])

const ORACLE_ABI = [
  { type: 'function', name: 'count', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function',
    name: 'latest',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint64' },
          { name: 'seq', type: 'uint256' },
          { name: 'amountPerShare', type: 'uint256' },
          { name: 'refPrice', type: 'uint256' },
          { name: 'declaredAt', type: 'uint64' },
          { name: 'exAt', type: 'uint64' },
          { name: 'source', type: 'uint8' },
        ],
      },
    ],
  },
] as const satisfies Abi

type PublicClient = ReturnType<typeof createPublicClient>

interface Addresses {
  stock: Address
  usd: Address
  splitter: Address
  priceLeg: Address
  divLeg: Address
  poolPrice: Address
  poolDiv: Address
  oracle: Address
}

interface DeploymentFile {
  network: string
  chainId: number
  deployBlock: number
  deployer: Address
  forwarder: Address
  contracts: Record<string, { address: Address; block: number }>
}

interface SetupTx {
  to: Address
  data: `0x${string}`
  describe: string
  estimatedGas: bigint
}

function loadEnvFiles(): void {
  for (const file of ['.env', '.env.bot']) {
    const path = join(process.cwd(), file)
    if (existsSync(path)) process.loadEnvFile(path)
  }
}

function loadDeploymentSync(): DeploymentFile {
  const path = join(process.cwd(), 'deployments', 'monad-testnet.json')
  if (!existsSync(path)) throw new Error('deployments/monad-testnet.json not found')
  return JSON.parse(readFileSync(path, 'utf8')) as DeploymentFile
}

function loadAddresses(): Addresses {
  const deployment = loadDeploymentSync()
  const need = (name: string): Address => {
    const c = deployment.contracts[name]
    if (c === undefined) throw new Error(`No ${name} in deployments/monad-testnet.json`)
    return c.address
  }
  return {
    stock: need('stock'),
    usd: need('usd'),
    splitter: need('splitter'),
    priceLeg: need('priceLeg'),
    divLeg: need('divLeg'),
    poolPrice: need('poolPrice'),
    poolDiv: need('poolDiv'),
    oracle: need('oracle'),
  }
}

function nowMs(): number {
  return Date.now()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function logLine(line: string): void {
  console.log(`[${new Date().toISOString()}] ${line}`)
}

function declaredGas(estimated: bigint): bigint {
  return (estimated * GAS_HEADROOM_PERCENT) / 100n
}

class ChainGateway {
  publicClient: PublicClient
  addresses: Addresses
  nonces = new Map<string, number>()
  maxFeePerGas = 0n
  dryRun = false

  constructor(publicClient: PublicClient, addresses: Addresses) {
    this.publicClient = publicClient
    this.addresses = addresses
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled
  }

  async refreshFee(): Promise<bigint> {
    const fees = await this.publicClient.estimateFeesPerGas()
    this.maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n
    return this.maxFeePerGas
  }

  async read<T>(to: Address, abi: Abi, fn: string, args: unknown[] = []): Promise<T> {
    return (await this.publicClient.readContract({ address: to, abi, functionName: fn, args })) as T
  }

  async estimate(to: Address, data: `0x${string}`, from: Address): Promise<bigint> {
    return this.publicClient.estimateGas({ account: from, to, data })
  }

  gasCostWei(gasLimit: bigint): bigint {
    return gasLimit * (this.maxFeePerGas || 1n)
  }

  async nextNonce(address: Address): Promise<number> {
    const fresh = await this.publicClient.getTransactionCount({ address, blockTag: 'pending' })
    this.nonces.set(address.toLowerCase(), fresh)
    return fresh
  }

  async send(account: PrivateKeyAccount, to: Address, data: `0x${string}`): Promise<TxResult> {
    if (this.dryRun) {
      return { ok: false, error: 'dry-run: broadcast not allowed' }
    }
    if (this.maxFeePerGas === 0n) await this.refreshFee()
    let gasLimit: bigint
    try {
      const estimated = await this.estimate(to, data, account.address)
      gasLimit = declaredGas(estimated)
    } catch (error) {
      return { ok: false, error: `estimate failed: ${String(error)}` }
    }

    const key = account.address.toLowerCase()
    let nonce = this.nonces.get(key)
    if (nonce === undefined) nonce = await this.nextNonce(account.address)

    const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http() })
    let hash: Hash
    try {
      hash = await walletClient.sendTransaction({
        to,
        data,
        gas: gasLimit,
        maxFeePerGas: this.maxFeePerGas,
        nonce,
      })
    } catch (error) {
      await this.nextNonce(account.address)
      return {
        ok: false,
        error: `send failed: ${String(error)}`,
        gasUsed: gasLimit,
        gasPriceWei: this.maxFeePerGas,
      }
    }

    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
      if (receipt.status !== 'success') {
        return {
          ok: false,
          hash,
          error: 'transaction reverted',
          gasUsed: receipt.gasUsed,
          gasPriceWei: this.maxFeePerGas,
        }
      }
      this.nonces.set(key, nonce + 1)
      return { ok: true, hash, gasUsed: receipt.gasUsed, gasPriceWei: this.maxFeePerGas }
    } catch (error) {
      return {
        ok: false,
        hash,
        error: `receipt wait failed: ${String(error)}`,
        gasUsed: gasLimit,
        gasPriceWei: this.maxFeePerGas,
      }
    }
  }
}

async function buildWalletView(gateway: ChainGateway, address: Address): Promise<WalletView> {
  const { addresses, publicClient } = gateway
  const [mon, mUsd, mAcme, priceLeg, divLeg, pending, nextId, oracleCount] = await Promise.all([
    publicClient.getBalance({ address }),
    gateway.read<bigint>(addresses.usd, ERC20_ABI, 'balanceOf', [address]),
    gateway.read<bigint>(addresses.stock, ERC20_ABI, 'balanceOf', [address]),
    gateway.read<bigint>(addresses.priceLeg, SPLIT_TOKEN_ABI, 'balanceOf', [address]),
    gateway.read<bigint>(addresses.divLeg, SPLIT_TOKEN_ABI, 'balanceOf', [address]),
    gateway.read<bigint>(addresses.divLeg, SPLIT_TOKEN_ABI, 'pending', [address]),
    gateway.read<bigint>(addresses.splitter, SPLITTER_ABI, 'nextDistributionId', []),
    gateway.read<bigint>(addresses.oracle, ORACLE_ABI, 'count', []),
  ])
  return {
    address,
    monBalance: mon,
    mUsdBalance: mUsd,
    mAcmeBalance: mAcme,
    priceLegBalance: priceLeg,
    divLegBalance: divLeg,
    pendingDividend: pending,
    canSplit: true,
    canDistribute: nextId <= oracleCount,
  }
}

async function buildPoolView(gateway: ChainGateway, pool: Address, fairWad: bigint | null): Promise<PoolView> {
  const [reserveToken, reserveQuote] = await Promise.all([
    gateway.read<bigint>(pool, POOL_ABI, 'reserveToken', []),
    gateway.read<bigint>(pool, POOL_ABI, 'reserveQuote', []),
  ])
  return { reserveToken, reserveQuote, fairWad }
}

async function computeFairValues(gateway: ChainGateway): Promise<{ divFairWad: bigint; priceFairWad: bigint }> {
  const { addresses } = gateway
  try {
    const count = await gateway.read<bigint>(addresses.oracle, ORACLE_ABI, 'count', [])
    if (count === 0n) return { divFairWad: E, priceFairWad: 99n * E }
    const latest = await gateway.read<{ amountPerShare: bigint; refPrice: bigint }>(
      addresses.oracle,
      ORACLE_ABI,
      'latest',
      [],
    )
    const remaining = await gateway.read<bigint>(addresses.splitter, SPLITTER_ABI, 'remainingDividends', [])
    const divFairWad = (remaining * latest.amountPerShare) / E
    const priceFairWad = latest.refPrice > divFairWad ? latest.refPrice - divFairWad : 0n
    return { divFairWad, priceFairWad }
  } catch {
    return { divFairWad: E, priceFairWad: 99n * E }
  }
}

async function ensureBoundedAllowance(
  gateway: ChainGateway,
  account: PrivateKeyAccount,
  token: Address,
  abi: Abi,
  spender: Address,
  bound: bigint,
  needed: bigint,
): Promise<SetupTx | null> {
  const current = await gateway.read<bigint>(token, abi, 'allowance', [account.address, spender])
  if (current >= needed) return null
  const data = encodeFunctionData({ abi, functionName: 'approve', args: [spender, bound] })
  let estimatedGas = 67_057n
  try {
    estimatedGas = declaredGas(await gateway.estimate(token, data, account.address))
  } catch {
    estimatedGas = 67_057n
  }
  return {
    to: token,
    data,
    describe: `approve ${shortAddr(spender)} on ${shortAddr(token)} bound=${bound}`,
    estimatedGas,
  }
}

async function planSetup(gateway: ChainGateway, account: PrivateKeyAccount): Promise<SetupTx[]> {
  const { addresses } = gateway
  const addr = account.address
  const txs: SetupTx[] = []

  const mUsd = await gateway.read<bigint>(addresses.usd, ERC20_ABI, 'balanceOf', [addr])
  const mAcme = await gateway.read<bigint>(addresses.stock, ERC20_ABI, 'balanceOf', [addr])

  if (mUsd < FAUCET_USD_LOW) {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'faucet', args: [] })
    txs.push({ to: addresses.usd, data, describe: 'faucet mUSD', estimatedGas: 79_322n })
  }
  if (mAcme < FAUCET_ACME_LOW) {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'faucet', args: [] })
    txs.push({ to: addresses.stock, data, describe: 'faucet mACME', estimatedGas: 79_322n })
  }

  const approvals: Array<[Address, Abi, Address, bigint, bigint]> = [
    [addresses.usd, ERC20_ABI, addresses.poolPrice, BOUND_USD_POOL, 500n * E],
    [addresses.usd, ERC20_ABI, addresses.poolDiv, BOUND_USD_POOL, 500n * E],
    [addresses.priceLeg, SPLIT_TOKEN_ABI, addresses.poolPrice, BOUND_LEG_POOL, E],
    [addresses.divLeg, SPLIT_TOKEN_ABI, addresses.poolDiv, BOUND_LEG_POOL, E],
    [addresses.stock, ERC20_ABI, addresses.splitter, BOUND_SPLITTER, MAX_SPLIT],
  ]
  for (const [token, abi, spender, bound, needed] of approvals) {
    const planned = await ensureBoundedAllowance(gateway, account, token, abi, spender, bound, needed)
    if (planned) txs.push(planned)
  }
  return txs
}

async function planLoopAction(
  gateway: ChainGateway,
  account: PrivateKeyAccount,
  config: BotConfig,
  splitsDone: number,
  fair: { divFairWad: bigint; priceFairWad: bigint },
): Promise<PlannedAction | null> {
  const { addresses } = gateway
  const addr = account.address
  const wallet = await buildWalletView(gateway, addr)
  if (wallet.monBalance < usdWadFromNumber(config.minMon)) return null

  const div = await buildPoolView(gateway, addresses.poolDiv, fair.divFairWad)
  const price = await buildPoolView(gateway, addresses.poolPrice, fair.priceFairWad)
  const view: BotView = { wallet, div, price }

  const rng = mulberry32((Date.now() ^ addr.charCodeAt(2) ^ (addr.charCodeAt(3) << 8) ^ splitsDone) >>> 0)
  const kind = pickAction(rng, view, splitsDone, config.minSplits)
  if (kind === null) return null

  if (kind === 'buy-div' || kind === 'buy-price') {
    const pool = kind === 'buy-div' ? addresses.poolDiv : addresses.poolPrice
    const usdIn = usdWadFromNumber(lognormalSizeUsd(rng, config.medianUsd, config.maxTradeUsd))
    if (usdIn <= 0n || usdIn > wallet.mUsdBalance) return null
    const quoteTuple = await gateway.read<[bigint, bigint, bigint]>(pool, POOL_ABI, 'getAmountOut', [false, usdIn])
    const quote = quoteTuple[0]
    if (quote <= 0n) return null
    const min = applySlippage(quote, config.slippageBps)
    const estimated = declaredGas(await gateway.estimate(
      pool,
      encodeFunctionData({ abi: POOL_ABI, functionName: 'swapExactIn', args: [false, usdIn, min] }),
      addr,
    ))
    return {
      kind,
      describe: `buy ${kind === 'buy-div' ? 'div' : 'price'}: in=${usdIn} mUSD minOut=${min}`,
      estimateGasCostWei: gateway.gasCostWei(estimated),
      params: { amountIn: usdIn, minOut: min },
    }
  }

  if (kind === 'sell-div' || kind === 'sell-price') {
    const pool = kind === 'sell-div' ? addresses.poolDiv : addresses.poolPrice
    const poolView = kind === 'sell-div' ? div : price
    const legBal = kind === 'sell-div' ? wallet.divLegBalance : wallet.priceLegBalance
    const p = priceWad(poolView.reserveQuote, poolView.reserveToken)
    if (p === null || legBal === 0n) return null
    const usdTarget = usdWadFromNumber(lognormalSizeUsd(rng, config.medianUsd, config.maxTradeUsd))
    let legIn = legAmountForUsd(usdTarget, p)
    if (legIn <= 0n) legIn = legBal / 10n
    if (legIn <= 0n || legIn > legBal) return null
    const quoteTuple = await gateway.read<[bigint, bigint, bigint]>(pool, POOL_ABI, 'getAmountOut', [true, legIn])
    const quote = quoteTuple[0]
    if (quote <= 0n) return null
    const min = applySlippage(quote, config.slippageBps)
    const estimated = declaredGas(await gateway.estimate(
      pool,
      encodeFunctionData({ abi: POOL_ABI, functionName: 'swapExactIn', args: [true, legIn, min] }),
      addr,
    ))
    return {
      kind,
      describe: `sell ${kind === 'sell-div' ? 'dACME' : 'pACME'}: in=${legIn} minOut=${min} mUSD`,
      estimateGasCostWei: gateway.gasCostWei(estimated),
      params: { amountIn: legIn, minOut: min },
    }
  }

  if (kind === 'split') {
    if (!wallet.canSplit || wallet.mAcmeBalance < MIN_SPLIT) return null
    const amount = wallet.mAcmeBalance > MAX_SPLIT ? MAX_SPLIT : wallet.mAcmeBalance
    let estimated = 257_238n
    try {
      estimated = declaredGas(
        await gateway.estimate(
          addresses.splitter,
          encodeFunctionData({ abi: SPLITTER_ABI, functionName: 'split', args: [amount] }),
          addr,
        ),
      )
    } catch {
      estimated = 257_238n
    }
    return {
      kind,
      describe: `split ${amount} mACME`,
      estimateGasCostWei: gateway.gasCostWei(estimated),
      params: { amount },
    }
  }

  if (kind === 'merge') {
    const both = wallet.priceLegBalance < wallet.divLegBalance ? wallet.priceLegBalance : wallet.divLegBalance
    if (both === 0n) return null
    const amount = both > MAX_MERGE ? MAX_MERGE : both
    const estimated = declaredGas(
      await gateway.estimate(
        addresses.splitter,
        encodeFunctionData({ abi: SPLITTER_ABI, functionName: 'merge', args: [amount] }),
        addr,
      ),
    )
    return {
      kind,
      describe: `merge ${amount} legs`,
      estimateGasCostWei: gateway.gasCostWei(estimated),
      params: { amount },
    }
  }

  if (kind === 'claim') {
    if (wallet.pendingDividend === 0n) return null
    const estimated = declaredGas(
      await gateway.estimate(
        addresses.divLeg,
        encodeFunctionData({ abi: SPLIT_TOKEN_ABI, functionName: 'claim', args: [] }),
        addr,
      ),
    )
    return {
      kind,
      describe: `claim ${wallet.pendingDividend} mUSD pending`,
      estimateGasCostWei: gateway.gasCostWei(estimated),
    }
  }

  if (kind === 'distribute') {
    if (!wallet.canDistribute) return null
    const estimated = declaredGas(
      await gateway.estimate(
        addresses.splitter,
        encodeFunctionData({ abi: SPLITTER_ABI, functionName: 'distribute', args: [] }),
        addr,
      ),
    )
    return {
      kind,
      describe: 'distribute due dividend',
      estimateGasCostWei: gateway.gasCostWei(estimated),
    }
  }

  return null
}

async function executeSetupTx(
  gateway: ChainGateway,
  account: PrivateKeyAccount,
  tx: SetupTx,
  execute: boolean,
): Promise<TxResult> {
  if (!execute) {
    logLine(`dry-run setup ${shortAddr(account.address)}: ${tx.describe}`)
    return { ok: true, gasUsed: tx.estimatedGas, gasPriceWei: gateway.maxFeePerGas || 1n, hash: 'dry-run' }
  }
  const result = await gateway.send(account, tx.to, tx.data)
  if (result.ok) logLine(`setup ok ${shortAddr(account.address)}: ${tx.describe} ${result.hash ?? ''}`)
  else logLine(`setup fail ${shortAddr(account.address)}: ${tx.describe}: ${result.error ?? ''}`)
  return result
}

async function executeSetupWithBudget(
  gateway: ChainGateway,
  account: PrivateKeyAccount,
  tx: SetupTx,
  execute: boolean,
  budget: TxBudget,
): Promise<TxResult> {
  if (!budget.canConfirm(1) || budget.wouldExceedGas(gateway.gasCostWei(tx.estimatedGas))) {
    logLine(`setup skip ${shortAddr(account.address)}: budget exhausted (${tx.describe})`)
    return { ok: false, error: 'budget exhausted' }
  }
  budget.reserve(1, gateway.gasCostWei(tx.estimatedGas))
  const result = await executeSetupTx(gateway, account, tx, execute)
  const gasCost = (result.gasUsed ?? 0n) * (result.gasPriceWei ?? 0n)
  budget.release(1, gateway.gasCostWei(tx.estimatedGas))
  if (result.ok) {
    budget.recordSuccess(gasCost)
  } else {
    budget.recordFailureGas(gasCost)
  }
  return result
}

async function executePlanned(
  gateway: ChainGateway,
  account: PrivateKeyAccount,
  action: PlannedAction,
): Promise<TxResult> {
  const { addresses } = gateway
  const params = action.params ?? {}

  if (action.kind === 'buy-div' || action.kind === 'buy-price' || action.kind === 'sell-div' || action.kind === 'sell-price') {
    const isDiv = action.kind.endsWith('div')
    const isBuy = action.kind.startsWith('buy')
    const pool = isDiv ? addresses.poolDiv : addresses.poolPrice
    const spendToken = isBuy ? addresses.usd : isDiv ? addresses.divLeg : addresses.priceLeg
    const spendAbi = isBuy ? ERC20_ABI : SPLIT_TOKEN_ABI
    const bound = isBuy ? BOUND_USD_POOL : BOUND_LEG_POOL
    const amountIn = params.amountIn ?? 0n
    const minOut = params.minOut ?? 0n
    if (amountIn <= 0n || minOut <= 0n) return { ok: false, error: 'missing trade params' }

    const tokenIn = !isBuy
    const approval = await ensureBoundedAllowance(gateway, account, spendToken, spendAbi, pool, bound, amountIn)
    if (approval) {
      const approveResult = await gateway.send(account, approval.to, approval.data)
      if (!approveResult.ok) return approveResult
      await sleep(300)
    }

    const data = encodeFunctionData({ abi: POOL_ABI, functionName: 'swapExactIn', args: [tokenIn, amountIn, minOut] })
    return gateway.send(account, pool, data)
  }

  if (action.kind === 'split') {
    const amount = params.amount ?? 0n
    if (amount <= 0n) return { ok: false, error: 'missing split amount' }
    const approval = await ensureBoundedAllowance(
      gateway,
      account,
      addresses.stock,
      ERC20_ABI,
      addresses.splitter,
      BOUND_SPLITTER,
      amount,
    )
    if (approval) {
      const approveResult = await gateway.send(account, approval.to, approval.data)
      if (!approveResult.ok) return approveResult
      await sleep(300)
    }
    const data = encodeFunctionData({ abi: SPLITTER_ABI, functionName: 'split', args: [amount] })
    return gateway.send(account, addresses.splitter, data)
  }

  if (action.kind === 'merge') {
    const amount = params.amount ?? 0n
    if (amount <= 0n) return { ok: false, error: 'missing merge amount' }
    const data = encodeFunctionData({ abi: SPLITTER_ABI, functionName: 'merge', args: [amount] })
    return gateway.send(account, addresses.splitter, data)
  }

  if (action.kind === 'claim') {
    const data = encodeFunctionData({ abi: SPLIT_TOKEN_ABI, functionName: 'claim', args: [] })
    return gateway.send(account, addresses.divLeg, data)
  }

  if (action.kind === 'distribute') {
    const data = encodeFunctionData({ abi: SPLITTER_ABI, functionName: 'distribute', args: [] })
    return gateway.send(account, addresses.splitter, data)
  }

  return { ok: false, error: `unhandled action kind ${action.kind}` }
}

async function runBot(config: BotConfig): Promise<void> {
  loadEnvFiles()
  const keys = loadBotKeys(defaultBotEnvPath(process.cwd()))
  if (keys.length === 0) {
    throw new Error('No BOT_PRIVATE_KEYS found in .env.bot. Generate wallets first: npm run bot -- generate-wallets')
  }
  const addressesList = addressesFromKeys(keys)
  const addresses = loadAddresses()
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http() })
  const chainId = await publicClient.getChainId()
  if (chainId !== 10143) throw new Error(`Expected chain 10143, got ${chainId}`)

  const gateway = new ChainGateway(publicClient, addresses)
  gateway.setDryRun(!config.execute)
  await gateway.refreshFee()
  const accounts = new Map<string, PrivateKeyAccount>()
  for (const key of keys) {
    const account = privateKeyToAccount(key as `0x${string}`)
    accounts.set(account.address.toLowerCase(), account)
  }

  const setupBudget = new TxBudget(config.maxTxs, config.maxGasMon)

  logLine(
    `bot starting: ${addressesList.length} wallets, execute=${config.execute}, burst=${config.burst ?? 'none'}, maxTxs=${config.maxTxs}, maxGas=${config.maxGasMon} MON`,
  )

  logLine('setup: checking faucets and bounded allowances')
  for (const address of addressesList) {
    const account = accounts.get(address.toLowerCase())
    if (!account) continue
    const setupTxs = await planSetup(gateway, account)
    if (setupTxs.length === 0) {
      logLine(`setup ok ${shortAddr(address)}: ready`)
      continue
    }
    for (const tx of setupTxs) {
      const result = await executeSetupWithBudget(gateway, account, tx, config.execute, setupBudget)
      if (!result.ok && config.execute) {
        logLine(`setup issue ${shortAddr(address)}: ${result.error ?? 'unknown'}`)
      }
      await sleep(config.rateLimitMs)
    }
  }

  const shutdown = new ShutdownController(config.stopFile, (path) => existsSync(path))
  const onSignal = (signal: string) => {
    logLine(`signal ${signal}: graceful shutdown`)
    shutdown.requestStop(`signal ${signal}`)
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  const fair = await computeFairValues(gateway)
  logLine(`fair values: div=${fair.divFairWad} price=${fair.priceFairWad}`)

  const normalLimit = createRateLimiter(config.rateLimitMs, nowMs, sleep)
  const burstLimit = createRateLimiter(config.burstRateLimitMs, nowMs, sleep)
  const dynamicRateLimit = async () => {
    await (config.burst !== null ? burstLimit() : normalLimit())
  }

  const summary = await runLoop({
    wallets: addressesList,
    config,
    isStopped: () => shutdown.isStopped(),
    checkStopFile: () => shutdown.checkStopFile(),
    rateLimit: dynamicRateLimit,
    now: nowMs,
    sleep,
    log: logLine,
    prepareAction: async (wallet, splitsDone) => {
      const account = accounts.get(wallet.toLowerCase())
      if (!account) return null
      const action = await planLoopAction(gateway, account, config, splitsDone, fair)
      if (action === null) return null
      if (!config.execute) logLine(`dry-run plan ${shortAddr(wallet)}: ${action.kind} — ${action.describe}`)
      return action
    },
    execute: async (wallet, action) => {
      const account = accounts.get(wallet.toLowerCase())
      if (!account) return { ok: false, error: 'unknown wallet' }
      if (!config.execute) {
        const estGas = action.estimateGasCostWei / (gateway.maxFeePerGas || 1n)
        return { ok: true, gasUsed: estGas, gasPriceWei: gateway.maxFeePerGas || 1n, hash: 'dry-run' }
      }
      return executePlanned(gateway, account, action)
    },
  })

  logLine('run complete')
  logLine(`  mode: ${config.execute ? 'EXECUTE' : 'DRY-RUN'}`)
  logLine(`  reason: ${summary.stopReason}`)
  logLine(`  confirmed txs: ${summary.txCount}`)
  logLine(
    `  trades: ${summary.trades}, splits: ${summary.splits}, merges: ${summary.merges}, claims: ${summary.claims}, distributes: ${summary.distributes}`,
  )
  logLine(`  failed: ${summary.failed}, skipped: ${summary.skipped}`)
  logLine(`  gas spent (declared): ${Number(summary.gasSpentWei) / 1e18} MON`)
  if (summary.splits < config.minSplits) {
    logLine(`warn: splits ${summary.splits} < min-splits ${config.minSplits}; re-run to top up`)
  }
  if (config.burst !== null && summary.trades < config.burst) {
    logLine(`warn: trades ${summary.trades} < burst target ${config.burst}; re-run to top up`)
  }
  logLine('verify indexed totals with: npm run bot -- verify')
}

function cmdGenerateWallets(count: number, force: boolean): void {
  const envPath = defaultBotEnvPath(process.cwd())
  const simPath = defaultSimWalletsPath(process.cwd())
  if (existsSync(envPath) && !force) {
    throw new Error(`${envPath} exists; pass --force to overwrite (this regenerates all bot keys)`)
  }
  const keys = generatePrivateKeys(count)
  const addresses = addressesFromKeys(keys)
  writeEnvBot(envPath, keys, force)
  writeSimWallets(simPath, addresses)
  logLine(`generated ${count} wallets`)
  logLine(`  keys:   ${envPath} (gitignored, mode 600)`)
  logLine(`  public: ${simPath}`)
  for (const a of addresses) logLine(`  ${a}`)
  logLine('')
  logLine('SIM wallet configuration (for Cleave-Envio/src/config/sim-wallets.json):')
  const normalized = [...addresses]
    .map((a) => getAddress(a))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  logLine(JSON.stringify({ wallets: normalized }, null, 2))
  logLine('')
  logLine('next steps:')
  logLine('  1. npm run bot -- fund --mon 0.12            (dry-run; add --execute to send)')
  logLine('     ~0.12 MON/wallet covers ~4 swaps + 1 split/merge + claim at current gas prices')
  logLine('  2. Copy the above JSON into Cleave-Envio/src/config/sim-wallets.json')
  logLine('  3. Commit + push Cleave-Envio repo, redeploy the Envio indexer, then run a small batch')
  logLine('  4. Main Cleave repository pushes do NOT automatically redeploy Envio')
}

async function cmdFund(mon: number, execute: boolean): Promise<void> {
  loadEnvFiles()
  const deployerPath = join(process.cwd(), '.env.deployer')
  if (existsSync(deployerPath)) process.loadEnvFile(deployerPath)
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY not set (expected in .env.deployer)')
  if (!execute) logLine('dry-run fund: pass --execute to broadcast')

  const keys = loadBotKeys(defaultBotEnvPath(process.cwd()))
  if (keys.length === 0) throw new Error('No BOT_PRIVATE_KEYS in .env.bot')
  const addresses = addressesFromKeys(keys)
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http() })

  const chainId = await publicClient.getChainId()
  if (chainId !== 10143) throw new Error(`Expected chain 10143, got ${chainId}`)

  const deployment = loadDeploymentSync()
  const expectedDeployer = deployment.deployer
  const deployer = privateKeyToAccount(
    (deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`) as `0x${string}`,
  )
  if (deployer.address.toLowerCase() !== expectedDeployer.toLowerCase()) {
    throw new Error(`Deployer address mismatch: expected ${expectedDeployer}, got ${deployer.address}`)
  }

  const walletClient = createWalletClient({ account: deployer, chain: monadTestnet, transport: http() })
  const value = BigInt(Math.round(mon * 1e18))
  const deployerBal = await publicClient.getBalance({ address: deployer.address })

  const fees = await publicClient.estimateFeesPerGas()
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n
  const gasPerTransfer = NATIVE_TRANSFER_GAS * 125n / 100n
  const gasBuffer = gasPerTransfer * BigInt(addresses.length) * maxFeePerGas
  const totalNeeded = value * BigInt(addresses.length) + gasBuffer + 10n ** 16n
  logLine(`deployer ${shortAddr(deployer.address)} balance ${Number(deployerBal) / 1e18} MON`)
  if (deployerBal < totalNeeded) {
    throw new Error(`deployer needs >= ${Number(totalNeeded) / 1e18} MON for ${addresses.length} wallets (value + gas buffer + safety margin)`)
  }

  for (const address of addresses) {
    const target = address as Address
    const bal = await publicClient.getBalance({ address: target })
    if (bal >= value) {
      logLine(`skip ${target}: already has ${Number(bal) / 1e18} MON`)
      continue
    }
    if (!execute) {
      logLine(`dry-run would send ${mon} MON to ${target}`)
      continue
    }
    const hash = await walletClient.sendTransaction({
      to: target,
      value,
      gas: gasPerTransfer,
      maxFeePerGas,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    if (receipt.status !== 'success') {
      throw new Error(`funding failed for ${target}: tx reverted ${hash}`)
    }
    logLine(`funded ${target}: ${receipt.status} ${hash}`)
    await sleep(500)
  }
}

async function cmdEstimateGas(): Promise<void> {
  loadEnvFiles()
  const addresses = loadAddresses()
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http() })
  const keys = loadBotKeys(defaultBotEnvPath(process.cwd()))
  const from: Address = keys.length > 0 ? (addressesFromKeys(keys)[0] as Address) : FALLBACK_DEPLOYER

  const samples: Array<[string, Address, Abi, string, unknown[]]> = [
    ['faucet-usd', addresses.usd, ERC20_ABI, 'faucet', []],
    ['faucet-acme', addresses.stock, ERC20_ABI, 'faucet', []],
    ['approve-usd-poolDiv', addresses.usd, ERC20_ABI, 'approve', [addresses.poolDiv, BOUND_USD_POOL]],
    ['swap-div-buy-50', addresses.poolDiv, POOL_ABI, 'swapExactIn', [false, 50n * E, 0n]],
    ['swap-div-sell-10', addresses.poolDiv, POOL_ABI, 'swapExactIn', [true, 10n * E, 0n]],
    ['swap-price-buy-50', addresses.poolPrice, POOL_ABI, 'swapExactIn', [false, 50n * E, 0n]],
    ['split-100', addresses.splitter, SPLITTER_ABI, 'split', [100n * E]],
    ['merge-100', addresses.splitter, SPLITTER_ABI, 'merge', [100n * E]],
    ['claim', addresses.divLeg, SPLIT_TOKEN_ABI, 'claim', []],
    ['distribute', addresses.splitter, SPLITTER_ABI, 'distribute', []],
  ]

  const fee = (await publicClient.estimateFeesPerGas()).maxFeePerGas ?? 0n
  logLine(`maxFeePerGas: ${fee} wei (${Number(fee) / 1e9} gwei)`)
  logLine(`read-only gas estimates (from ${from}):`)
  for (const [label, to, abi, fn, args] of samples) {
    try {
      const data = encodeFunctionData({ abi, functionName: fn, args })
      const estimated = await publicClient.estimateGas({ account: from, to, data })
      const declared = declaredGas(estimated)
      const cost = Number((declared * fee) * 100_000n / E) / 100_000
      logLine(`  ${label.padEnd(22)} est=${estimated} declared=${declared} cost≈${cost} MON`)
    } catch (error) {
      logLine(`  ${label.padEnd(22)} estimate failed: ${String(error)}`)
    }
  }
}

async function cmdVerify(graphql: string | null, minTrades: number, minSplits: number): Promise<void> {
  loadEnvFiles()
  const endpoint = graphql ?? process.env.VITE_ENVIO_GRAPHQL_URL ?? process.env.ENVIO_GRAPHQL_URL
  if (!endpoint) throw new Error('No GraphQL endpoint; pass --graphql or set VITE_ENVIO_GRAPHQL_URL')

  const post = async (query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { data?: Record<string, unknown>; errors?: unknown[] }
    if (body.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`)
    if (!body.data) throw new Error('no data in response')
    return body.data
  }

  const statsData = await post(
    `query ($chain: Int!) {
      ProtocolStats(where: {chainId: {_eq: $chain}, id: {_eq: "global"}}, limit: 1) {
        tradeCount volumeUsd simulatedVolumeUsd organicVolumeUsd totalSplit
      }
    }`,
    { chain: 10143 },
  )
  const statsRows = statsData.ProtocolStats as Array<Record<string, unknown>> | undefined
  const stats = statsRows?.[0]
  if (!stats) throw new Error('ProtocolStats row missing')
  const tradeCount = Number(stats.tradeCount)
  logLine(
    `ProtocolStats: tradeCount=${tradeCount} volumeUsd=${stats.volumeUsd} simVolume=${stats.simulatedVolumeUsd} organicVolume=${stats.organicVolumeUsd} totalSplit=${stats.totalSplit}`,
  )

  const splitsData = await post(
    `query ($chain: Int!, $limit: Int!) {
      SplitEvent(where: {chainId: {_eq: $chain}, isSimulated: {_eq: true}, isMerge: {_eq: false}}, limit: $limit) { id }
    }`,
    { chain: 10143, limit: 1000 },
  )
  const splits = (splitsData.SplitEvent as unknown[] | undefined)?.length ?? 0
  logLine(`simulated SplitEvents (isMerge=false, up to 1000): ${splits}`)

  const swapsData = await post(
    `query ($chain: Int!, $limit: Int!) {
      Swap(where: {chainId: {_eq: $chain}, isSimulated: {_eq: true}}, limit: $limit) { id }
    }`,
    { chain: 10143, limit: 1000 },
  )
  const simSwaps = (swapsData.Swap as unknown[] | undefined)?.length ?? 0
  logLine(`simulated Swaps (indexed, up to 1000): ${simSwaps}`)

  const indexerStatus = await post(
    `query {
      _meta { block { number } }
    }`,
    {},
  )
  const currentBlock = (indexerStatus._meta as { block?: { number: number } } | undefined)?.block?.number
  if (currentBlock) {
    logLine(`indexer head block: ${currentBlock}`)
  }

  const classifierCheck = await post(
    `query ($chain: Int!) {
      SimulatedClassifier(where: {chainId: {_eq: $chain}}, limit: 1) { id address }
    }`,
    { chain: 10143 },
  )
  const classifier = (classifierCheck.SimulatedClassifier as Array<Record<string, unknown>> | undefined)?.[0]
  if (classifier) {
    logLine(`classifier registered: ${classifier.address} (id: ${classifier.id})`)
  } else {
    logLine('WARNING: no SimulatedClassifier registered for chain 10143')
  }

  const tradesOk = simSwaps >= minTrades
  const splitsOk = splits >= minSplits
  logLine(
    `target check: >=${minTrades} trades ${tradesOk ? 'OK' : 'NOT MET'} (indexed sim swaps: ${simSwaps}), >=${minSplits} splits ${splitsOk ? 'OK' : 'NOT MET'} (indexed sim splits: ${splits})`,
  )
  logLine('note: Only indexed simulated swaps/splits count toward verification. ProtocolStats.tradeCount is NOT used.')
  if (!tradesOk || !splitsOk) process.exitCode = 1
}

function usage(): void {
  console.log(`Usage:
  npm run bot -- [run] [--burst N] [--minutes M] [--max-txs N] [--max-gas-mon X] [--execute] [--min-splits N] [--min-trades N] [--wallet-index N]
  npm run bot -- generate-wallets [--count N] [--force]
  npm run bot -- fund [--mon X] [--execute]
  npm run bot -- estimate-gas
  npm run bot -- verify [--graphql URL] [--min-trades N] [--min-splits N]

Default mode is dry-run. Broadcasts require --execute.
Stop a running bot with Ctrl+C or by creating the stop file (default bot.stop).`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    usage()
    return
  }

  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    if (error instanceof ArgError) {
      console.error(`error: ${error.message}`)
      usage()
      process.exitCode = 2
      return
    }
    throw error
  }

  const { command, config, count, force, mon, graphql } = parsed

  if (command === 'generate-wallets') {
    cmdGenerateWallets(count ?? 8, force)
    return
  }
  if (command === 'fund') {
    await cmdFund(mon, config.execute)
    return
  }
  if (command === 'estimate-gas') {
    await cmdEstimateGas()
    return
  }
  if (command === 'verify') {
    const minTrades = config.minTrades > 0 ? config.minTrades : (config.burst ?? 300)
    const minSplits = config.minSplits > 0 ? config.minSplits : 20
    await cmdVerify(graphql, minTrades, minSplits)
    return
  }
  if (command === 'run') {
    await runBot(config)
    return
  }
  console.error(`unknown command: ${command}`)
  usage()
  process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
