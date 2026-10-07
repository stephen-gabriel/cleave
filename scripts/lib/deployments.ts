import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface DeployedContract {
  address: `0x${string}`
  block: number
}

export interface DeploymentFile {
  network: string
  chainId: number
  deployBlock: number
  deployer: `0x${string}`
  forwarder: `0x${string}`
  contracts: Record<string, DeployedContract>
}

export function deploymentPath(): string {
  return join(process.cwd(), 'deployments', 'monad-testnet.json')
}

/** Reads the deployment file whether it is fresh, empty, or UTF-16-with-BOM. */
export async function loadDeployment(): Promise<DeploymentFile> {
  const path = deploymentPath()
  const empty: DeploymentFile = {
    network: 'monad-testnet',
    chainId: 10143,
    deployBlock: 0,
    deployer: '0x',
    forwarder: '0x',
    contracts: {},
  }
  if (!existsSync(path)) return empty

  const raw = await readFile(path)
  // The old committed file was saved as UTF-16 LE with a BOM; treat those
  // bytes as "nothing useful" instead of mojibake.
  if (raw[0] === 0xff && raw[1] === 0xfe) return empty

  const text = raw.toString('utf8').replace(/^\uFEFF/, '')
  const data = JSON.parse(text) as Partial<DeploymentFile>
  return {
    network: data.network ?? 'monad-testnet',
    chainId: data.chainId ?? 10143,
    deployBlock: data.deployBlock ?? 0,
    deployer: data.deployer ?? '0x',
    forwarder: data.forwarder ?? '0x',
    contracts: data.contracts ?? {},
  }
}

/** Writes the whole file. Called after every successful deployment. */
export async function saveDeployment(deployment: DeploymentFile): Promise<void> {
  const path = deploymentPath()
  await writeFile(path, `${JSON.stringify(deployment, null, 2)}\n`, 'utf8')
}