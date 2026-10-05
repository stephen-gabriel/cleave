import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { envFilePath, setEnvValue } from './lib/env.ts'

const GAS_HEADROOM_PERCENT = 120n

type Artifact = {
  abi: readonly unknown[]
  bytecode: string
  deployedBytecode: string
}

function loadDeployerKey(): `0x${string}` {
  const deployerEnv = join(process.cwd(), '.env.deployer')
  if (existsSync(deployerEnv)) process.loadEnvFile(deployerEnv)

  const raw = process.env.DEPLOYER_PRIVATE_KEY
  if (raw === undefined || raw === '') {
    throw new Error('DEPLOYER_PRIVATE_KEY is not set. Expected it in .env.deployer.')
  }
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('DEPLOYER_PRIVATE_KEY is not a 32-byte hex value.')
  }
  return key
}

async function main() {
  const key = loadDeployerKey()
  const account = privateKeyToAccount(key)

  const artifactPath = join(
    process.cwd(),
    'artifacts',
    'contracts',
    'MockStock.sol',
    'MockStock.json',
  )
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as Artifact
  if (!artifact.bytecode.startsWith('0x')) {
    throw new Error(`Artifact at ${artifactPath} has no creation bytecode. Run npm run compile.`)
  }

  const rpcUrl = process.env.MONAD_TESTNET_RPC ?? monadTestnet.rpcUrls.default.http[0]
  const transport = http(rpcUrl)
  const publicClient = createPublicClient({ chain: monadTestnet, transport })
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport })

  const chainId = await publicClient.getChainId()
  if (chainId !== monadTestnet.id) {
    throw new Error(`Expected chain ${monadTestnet.id} but RPC reports ${chainId}.`)
  }

  // Monad is EIP-1559. The node checks balance against gasLimit * maxFeePerGas,
  // so both must be known before we can decide whether the deployer can afford it.
  const fees = await publicClient.estimateFeesPerGas()
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice
  if (maxFeePerGas === undefined) {
    throw new Error('RPC did not report maxFeePerGas or gasPrice; cannot price the deployment.')
  }

  const estimated = await publicClient.estimateGas({
    account: account.address,
    data: artifact.bytecode as `0x${string}`,
  })
  const gasLimit = (estimated * GAS_HEADROOM_PERCENT) / 100n
  const required = gasLimit * maxFeePerGas

  console.log(`rpc           : ${rpcUrl}`)
  console.log(`deployer      : ${account.address}`)
  console.log(`baseFee       : ${(await publicClient.getBlock({ blockTag: 'latest' })).baseFeePerGas} wei`)
  console.log(`maxFeePerGas  : ${maxFeePerGas} wei`)
  console.log(`deploy gas    : ${estimated.toLocaleString('en-US')} estimated`)
  console.log(`declared limit: ${gasLimit.toLocaleString('en-US')}`)
  console.log(`upfront cost  : ${formatEther(required)} MON`)

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`balance       : ${formatEther(balance)} MON`)

  if (balance < required) {
    const missing = required - balance
    throw new Error(
      `Deployer is short by ${formatEther(missing)} MON. It needs ` +
        `${formatEther(required)} MON for the ${gasLimit.toLocaleString('en-US')} gas ` +
        `declared limit at ${maxFeePerGas} wei maxFeePerGas, and holds ` +
        `${formatEther(balance)} MON. Open the app and click "Fund deployer" again.`,
    )
  }

  const hash = await walletClient.sendTransaction({
    data: artifact.bytecode as `0x${string}`,
    gas: gasLimit,
  })
  console.log(`deploy tx     : ${hash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Deployment reverted.')
  if (receipt.contractAddress === null) throw new Error('Receipt has no contract address.')

  const address = getAddress(receipt.contractAddress)
  const code = await publicClient.getCode({ address })
  if (code === null || code === '0x') {
    throw new Error(`No runtime code at ${address}; the deployment did not land.`)
  }

  console.log(`MockStock     : ${address}`)
  console.log(
    `gas used      : ${receipt.gasUsed.toLocaleString('en-US')} of ${gasLimit.toLocaleString('en-US')} declared`,
  )
  console.log(
    `deployer left : ${formatEther(await publicClient.getBalance({ address: account.address }))} MON`,
  )

  const mintData = encodeFunctionData({ abi: artifact.abi, functionName: 'mint' })
  const mintGas = await publicClient.estimateGas({
    account: account.address,
    to: address,
    data: mintData,
  })
  console.log(`mint() gas    : ${mintGas.toLocaleString('en-US')} estimated for a first mint`)

  await setEnvValue('VITE_MOCK_STOCK_ADDRESS', address)
  console.log(`\nWrote VITE_MOCK_STOCK_ADDRESS to ${envFilePath()}. Restart the dev server to pick it up.`)

  console.log(`\nExplorer      : ${monadTestnet.blockExplorers.default.url}/address/${address}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})