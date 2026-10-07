import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

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
    throw new Error(
      'DEPLOYER_PRIVATE_KEY is not set. Expected it in .env.deployer.',
    )
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
    'CalculatorConsumer.sol',
    'CalculatorConsumer.json',
  )

  const artifact = JSON.parse(
    await readFile(artifactPath, 'utf8'),
  ) as Artifact

  if (!artifact.bytecode.startsWith('0x')) {
    throw new Error(
      `Artifact at ${artifactPath} has no creation bytecode. Run npm run compile.`,
    )
  }

  const MOCK_FORWARDER =
    '0xB9F79d863261869B234c481D1f9A7af84AeAd192' as `0x${string}`

  const rpcUrl =
    process.env.MONAD_TESTNET_RPC ??
    monadTestnet.rpcUrls.default.http[0]

  const transport = http(rpcUrl)

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport,
  })

  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport,
  })

  const chainId = await publicClient.getChainId()

  if (chainId !== monadTestnet.id) {
    throw new Error(
      `Expected chain ${monadTestnet.id} but RPC reports ${chainId}.`,
    )
  }

  const fees = await publicClient.estimateFeesPerGas()

  const maxFeePerGas =
    fees.maxFeePerGas ?? fees.gasPrice

  if (maxFeePerGas === undefined) {
    throw new Error(
      'RPC did not report maxFeePerGas or gasPrice; cannot price the deployment.',
    )
  }

  // Constructor argument:
  // CalculatorConsumer(address _forwarderAddress)
  //
  // We must ABI-encode the forwarder address and append it
  // to the creation bytecode.

  const constructorArg = MOCK_FORWARDER.slice(2).padStart(64, '0')

  const deploymentData = (
    artifact.bytecode + constructorArg
  ) as `0x${string}`

  const estimated = await publicClient.estimateGas({
    account: account.address,
    data: deploymentData,
  })

  const gasLimit =
    (estimated * GAS_HEADROOM_PERCENT) / 100n

  const required =
    gasLimit * maxFeePerGas

  console.log(`rpc           : ${rpcUrl}`)
  console.log(`deployer      : ${account.address}`)
  console.log(`forwarder     : ${MOCK_FORWARDER}`)
  console.log(
    `baseFee       : ${
      (await publicClient.getBlock({ blockTag: 'latest' }))
        .baseFeePerGas
    } wei`,
  )
  console.log(`maxFeePerGas  : ${maxFeePerGas} wei`)
  console.log(
    `deploy gas    : ${estimated.toLocaleString('en-US')} estimated`,
  )
  console.log(
    `declared limit: ${gasLimit.toLocaleString('en-US')}`,
  )
  console.log(
    `upfront cost  : ${formatEther(required)} MON`,
  )

  const balance = await publicClient.getBalance({
    address: account.address,
  })

  console.log(
    `balance       : ${formatEther(balance)} MON`,
  )

  if (balance < required) {
    const missing = required - balance

    throw new Error(
      `Deployer is short by ${formatEther(missing)} MON. ` +
      `It needs ${formatEther(required)} MON for the ` +
      `${gasLimit.toLocaleString('en-US')} gas declared limit ` +
      `at ${maxFeePerGas} wei maxFeePerGas, and holds ` +
      `${formatEther(balance)} MON.`,
    )
  }

  const hash = await walletClient.sendTransaction({
    data: deploymentData,
    gas: gasLimit,
  })

  console.log(`deploy tx     : ${hash}`)
  console.log('Waiting for confirmation...')

  const receipt =
    await publicClient.waitForTransactionReceipt({
      hash,
    })

  if (receipt.status !== 'success') {
    throw new Error('Deployment reverted.')
  }

  if (receipt.contractAddress === null) {
    throw new Error(
      'Receipt has no contract address.',
    )
  }

  const address =
    getAddress(receipt.contractAddress)

  const code =
    await publicClient.getCode({ address })

  if (code === null || code === '0x') {
    throw new Error(
      `No runtime code at ${address}; deployment did not land.`,
    )
  }

  console.log(
    `CalculatorConsumer : ${address}`,
  )

  console.log(
    `gas used      : ${receipt.gasUsed.toLocaleString('en-US')} of ${gasLimit.toLocaleString('en-US')} declared`,
  )

  console.log(
    `deployer left : ${formatEther(
      await publicClient.getBalance({
        address: account.address,
      }),
    )} MON`,
  )

  console.log(
    `\nExplorer      : ${monadTestnet.blockExplorers.default.url}/address/${address}`,
  )
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : error,
  )

  process.exitCode = 1
})