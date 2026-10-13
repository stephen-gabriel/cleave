// Cleave deployment script (frd.md §1.8, milestone T1.3).
// Resumable: every contract address is written to deployments/monad-testnet.json
// immediately after it is mined; on a re-run, contracts that already have code
// at the recorded address are skipped.
import {
  getAddress,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
} from 'viem'
import type { Abi, Address } from 'viem'
import { monadTestnet } from 'viem/chains'
import {
  createClients,
  assertChain,
  CRE_FORWARDER,
  explorerUrl,
  readArtifact,
} from './lib/chain'
import { loadDeployment, saveDeployment } from './lib/deployments'
import type { DeploymentFile } from './lib/deployments'

const DAY = 86_400
const GAS_HEADROOM = 125n // estimated gas x 1.25 as the declared limit
const SERIES_MATURITY_DAYS = 120 // redeployed 2026-10-08: judging window unknown
// Superseded Series A Splitter: still a registered mUSD minter and must be revoked
// whenever a new Splitter is deployed (it is removed from deployments/monad-testnet.json).
const LEGACY_SPLITTER_MINTERS: readonly Address[] = [
  '0x64bc1B02d9513Ffe341262B3B86039cA5A6fc5fd',
]

type Clients = Awaited<ReturnType<typeof createClients>>

const log = (...args: unknown[]) => console.log(...args)

let depl: DeploymentFile

async function hasCode(publicClient: Clients['publicClient'], address: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address })
  return code !== null && code !== '0x' && code !== undefined
}

async function record(name: string, address: `0x${string}`, block: number): Promise<void> {
  depl.contracts[name] = { address, block }
  let min = Number.MAX_SAFE_INTEGER
  for (const c of Object.values(depl.contracts)) {
    if (c.block > 0 && c.block < min) min = c.block
  }
  depl.deployBlock = min === Number.MAX_SAFE_INTEGER ? 0 : min
  await saveDeployment(depl)
  log(`    wrote deployments/monad-testnet.json (${name} @ block ${block})`)
}

async function deploy(
  client: Clients,
  contractName: string,
  args: readonly unknown[],
): Promise<{ address: `0x${string}`; block: number; gasUsed: bigint }> {
  const { account, publicClient, walletClient } = client
  const artifact = await readArtifact(contractName)
  const data = encodeDeployData({
    abi: artifact.abi as Abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: args as readonly unknown[],
  })
  const fees = await publicClient.estimateFeesPerGas()
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice
  const estimated = await publicClient.estimateGas({ account: account.address, data })
  const gasLimit = (estimated * GAS_HEADROOM) / 100n
  log(
    `  deploy ${contractName}: ${estimated} est -> declare ${gasLimit} (max fee ${formatEther(
      gasLimit * maxFeePerGas,
    )} MON)`,
  )
  const hash = await walletClient.sendTransaction({ data, gas: gasLimit, maxFeePerGas })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${contractName} deployment reverted`)
  if (receipt.contractAddress === null) throw new Error(`${contractName}: no contract address`)
  const address = getAddress(receipt.contractAddress)
  log(`    ${contractName} = ${address}`)
  log(`      ${explorerUrl(address)}`)
  log(`      gas used ${receipt.gasUsed} of ${gasLimit} declared; block ${receipt.blockNumber}`)
  return { address, block: Number(receipt.blockNumber), gasUsed: receipt.gasUsed }
}

/** Sends an ABI-encoded call from the deployer with an explicit gas limit. */
async function call(
  client: Clients,
  to: Address,
  abi: Abi,
  functionName: string,
  args: unknown[],
): Promise<void> {
  const { account, publicClient, walletClient } = client
  const data = encodeFunctionData({ abi, functionName, args })
  const fees = await publicClient.estimateFeesPerGas()
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice
  const estimated = await publicClient.estimateGas({ account: account.address, to, data })
  const gasLimit = (estimated * GAS_HEADROOM) / 100n
  const hash = await walletClient.sendTransaction({ to, data, gas: gasLimit, maxFeePerGas })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted`)
  log(`    ${functionName} ok (gas used ${receipt.gasUsed} of ${gasLimit} declared)`)
}

async function main(): Promise<void> {
  const client = await createClients()
  const { account, publicClient } = client
  await assertChain(publicClient)

  depl = await loadDeployment()
  depl.deployer = account.address
  depl.forwarder = CRE_FORWARDER
  depl.network = 'monad-testnet'
  depl.chainId = monadTestnet.id
  await saveDeployment(depl)

  log(`deployer  : ${account.address}`)
  log(`  ${explorerUrl(account.address)}`)
  log(
    `balance   : ${formatEther(
      await publicClient.getBalance({ address: account.address }),
    )} MON`,
  )
  log(`forwarder : ${CRE_FORWARDER} (${explorerUrl(CRE_FORWARDER)})`)
  log('')

  // Reuse a recorded address only if code exists there.
  const existing = async (name: string): Promise<`0x${string}` | null> => {
    const c = depl.contracts[name]
    if (c === undefined) return null
    if (await hasCode(publicClient, c.address)) return c.address
    log(`  ${name}: recorded address has no code; redeploying`)
    return null
  }

  // Deploy if missing; always persists immediately.
  const ensure = async (
    key: string,
    contractName: string,
    args: readonly unknown[],
  ): Promise<`0x${string}`> => {
    const current = await existing(key)
    if (current !== null) {
      log(`  ${key}: already deployed at ${current} (skip)`)
      return current
    }
    const { address, block } = await deploy(client, contractName, args)
    await record(key, address, block)
    return address
  }

  const stock = await ensure('stock', 'MockStock', [])
  const usd = await ensure('usd', 'MockUSD', [])
  const oracle = await ensure('oracle', 'DividendOracle', [CRE_FORWARDER])

  // Splitter: needs maturity only on first deploy; on resume it is skipped.
  let splitter = await existing('splitter')
  if (splitter === null) {
    const latest = await publicClient.getBlock()
    const maturity = latest.timestamp + BigInt(SERIES_MATURITY_DAYS) * BigInt(DAY)
    log(
      `  splitter maturity = ${maturity} (block ts ${latest.timestamp} + ${SERIES_MATURITY_DAYS}d)`,
    )
    const { address, block } = await deploy(client, 'Splitter', [
      stock,
      usd,
      oracle,
      maturity,
      6,
    ])
    splitter = address
    await record('splitter', address, block)
  } else {
    log(`  splitter: already deployed at ${splitter} (skip)`)
  }

  // Legs are created inside the Splitter constructor; read them once.
  const splitterAbi = (await readArtifact('Splitter')).abi as Abi
  if (depl.contracts.priceLeg === undefined || depl.contracts.divLeg === undefined) {
    const priceLegRaw = (await publicClient.readContract({
      address: splitter,
      abi: splitterAbi,
      functionName: 'priceLeg',
    })) as unknown as string
    const divLegRaw = (await publicClient.readContract({
      address: splitter,
      abi: splitterAbi,
      functionName: 'dividendLeg',
    })) as unknown as string
    const lexBlock = depl.contracts.splitter.block
    if (depl.contracts.priceLeg === undefined) {
      await record('priceLeg', getAddress(priceLegRaw), lexBlock)
    }
    if (depl.contracts.divLeg === undefined) {
      await record('divLeg', getAddress(divLegRaw), lexBlock)
    }
  } else {
    log(`  priceLeg & divLeg: already recorded (skip)`)
  }
  const priceLeg = depl.contracts.priceLeg.address
  const divLeg = depl.contracts.divLeg.address

  await ensure('poolPrice', 'Pool', [priceLeg, usd, 30])
  await ensure('poolDiv', 'Pool', [divLeg, usd, 30])

  // Set the Splitter as an allowed mUSD minter (idempotent).
  if (depl.contracts.usd) {
    const usdAbi = (await readArtifact('MockUSD')).abi as Abi
    const isMinter = (await publicClient.readContract({
      address: usd,
      abi: usdAbi,
      functionName: 'minters',
      args: [splitter],
    })) as unknown as boolean
    if (!isMinter) {
      await call(client, usd, usdAbi, 'setMinter', [splitter, true])
    } else {
      log('  splitter is already an mUSD minter (skip)')
    }

    // Remove the minter role from superseded Splitters so only the live one may mint.
    for (const legacy of LEGACY_SPLITTER_MINTERS) {
      if (getAddress(legacy) === splitter) continue
      const legacyIsMinter = (await publicClient.readContract({
        address: usd,
        abi: usdAbi,
        functionName: 'minters',
        args: [legacy],
      })) as unknown as boolean
      if (legacyIsMinter) {
        log(`  revoking mUSD minter from legacy splitter ${legacy}`)
        await call(client, usd, usdAbi, 'setMinter', [legacy, false])
      } else {
        log(`  legacy splitter ${legacy} is no longer an mUSD minter (skip)`)
      }
    }
  }

  // deployBlock tracks the current series deployment, i.e. the earliest block of the
  // series contracts (splitter first). Legacy token/oracle blocks are not the series.
  const seriesBlock = Math.min(
    depl.contracts.splitter.block,
    depl.contracts.priceLeg.block,
    depl.contracts.divLeg.block,
    depl.contracts.poolPrice.block,
    depl.contracts.poolDiv.block,
  )
  depl.deployBlock = seriesBlock
  await saveDeployment(depl)

  log('')
  log('Deployment summary')
  log('------------------')
  for (const name of [
    'stock',
    'usd',
    'oracle',
    'splitter',
    'priceLeg',
    'divLeg',
    'poolPrice',
    'poolDiv',
  ]) {
    const c = depl.contracts[name]
    log(`${name.padEnd(9)} ${c.address}   block ${c.block}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})