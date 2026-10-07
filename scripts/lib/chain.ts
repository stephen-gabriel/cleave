import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

/** Same Chainlink CRE forwarder used by the working CalculatorConsumer. */
export const CRE_FORWARDER =
  '0xb9f79d863261869b234c481d1f9a7af84aead192' as `0x${string}`

export function rpcUrl(): string {
  return process.env.MONAD_TESTNET_RPC ?? monadTestnet.rpcUrls.default.http[0]
}

export function loadDeployerKey(): `0x${string}` {
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

export function loadEnvFiles(): void {
  for (const file of ['.env', '.env.deployer']) {
    const path = join(process.cwd(), file)
    if (existsSync(path)) process.loadEnvFile(path)
  }
}

export async function createClients() {
  loadEnvFiles()
  const transport = http(rpcUrl())
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport,
  })
  const account = privateKeyToAccount(loadDeployerKey())
  const walletClient = createWalletClient({
    chain: monadTestnet,
    transport,
    account,
  })
  return { publicClient, walletClient, account }
}

export async function assertChain(
  publicClient: Awaited<ReturnType<typeof createClients>>['publicClient'],
): Promise<void> {
  const chainId = await publicClient.getChainId()
  if (chainId !== monadTestnet.id) {
    throw new Error(`Expected chain ${monadTestnet.id} but RPC reports ${chainId}.`)
  }
}

export function explorerUrl(address: `0x${string}`): string {
  return `${monadTestnet.blockExplorers.default.url}/address/${address}`
}

export interface ArtifactJson {
  abi: readonly unknown[]
  bytecode: string
  deployedBytecode: string
}

export async function readArtifact(contractName: string): Promise<ArtifactJson> {
  const path = join(
    process.cwd(),
    'artifacts',
    'contracts',
    `${contractName}.sol`,
    `${contractName}.json`,
  )
  const artifact = JSON.parse(await readFile(path, 'utf8')) as ArtifactJson
  if (!artifact.bytecode.startsWith('0x')) {
    throw new Error(`Artifact for ${contractName} has no creation bytecode. Run npm run compile.`)
  }
  return artifact
}