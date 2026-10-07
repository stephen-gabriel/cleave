// Measure real gas on Monad Testnet via estimateGas (frd.md §2, T1.3).
// Writes src/chain/gas.ts with measured x 1.25 (rounded up), since Monad
// charges the declared limit, not gas used.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { encodeFunctionData, formatEther, getAddress } from 'viem'
import type { Abi, Address } from 'viem'
import { createClients, assertChain, readArtifact } from './lib/chain'
import { loadDeployment } from './lib/deployments'

const E = 10n ** 18n
const MAX = 2n ** 256n - 1n
const GAS_HEADROOM = 125n
const RELAY_EOA = '0x0000000000000000000000000000000000000001' as Address

type Clients = Awaited<ReturnType<typeof createClients>>

async function main(): Promise<void> {
  const client = await createClients()
  const { account, publicClient, walletClient } = client
  await assertChain(publicClient)

  const depl = await loadDeployment()
  const need = (name: string): `0x${string}` => {
    const c = depl.contracts[name]
    if (c === undefined) throw new Error(`No ${name} in deployments/monad-testnet.json`)
    return getAddress(c.address)
  }
  const stock = need('stock')
  const usd = need('usd')
  const oracle = need('oracle')
  const splitter = need('splitter')
  const divLeg = need('divLeg')
  const poolDiv = need('poolDiv')

  const abi = async (name: string): Promise<Abi> => (await readArtifact(name)).abi as Abi
  const stockAbi = await abi('MockStock')
  const usdAbi = await abi('MockUSD')
  const oracleAbi = await abi('DividendOracle')
  const splitterAbi = await abi('Splitter')
  const splitTokenAbi = await abi('SplitToken')
  const poolAbi = await abi('Pool')

  const read = async <T>(to: Address, a: Abi, fn: string, args: unknown[] = []) =>
    (await publicClient.readContract({ address: to, abi: a, functionName: fn, args })) as T

  const estData = (to: Address, a: Abi, fn: string, args: unknown[]) => {
    const data = encodeFunctionData({ abi: a, functionName: fn, args })
    return publicClient.estimateGas({ account: account.address, to, data })
  }

  const send = async (to: Address, a: Abi, fn: string, args: unknown[]) => {
    const data = encodeFunctionData({ abi: a, functionName: fn, args })
    const fees = await publicClient.estimateFeesPerGas()
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice
    const estimated = await publicClient.estimateGas({ account: account.address, to, data })
    const gasLimit = (estimated * GAS_HEADROOM) / 100n
    const hash = await walletClient.sendTransaction({ to, data, gas: gasLimit, maxFeePerGas })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${fn} reverted`)
    console.log(`  [tx] ${fn} ok (gas used ${receipt.gasUsed} of ${gasLimit} declared)`)
    return receipt
  }

  const results: Record<string, bigint> = {}
  const measure = async (label: string, fn: () => Promise<bigint>) => {
    const g = await fn()
    results[label] = g
    console.log(`  ${label.padEnd(16)} estimated ${g} gas`)
  }

  console.log(`deployer  : ${account.address}`)
  console.log(`balance   : ${formatEther(await publicClient.getBalance({ address: account.address }))} MON`)
  console.log('')

  // faucet + approve need no state prep.
  await measure('faucet', () => estData(stock, stockAbi, 'faucet', []))
  await measure('approve', () => estData(usd, usdAbi, 'approve', [splitter, 0n]))

  // Give the deployer mACME so split() can be simulated from their account.
  const stockBal = await read<bigint>(stock, stockAbi, 'balanceOf', [account.address])
  const allowance = await read<bigint>(stock, stockAbi, 'allowance', [
    account.address,
    splitter,
  ])
  if (stockBal < E) await send(stock, stockAbi, 'mint', [account.address, E])
  if (allowance < E) await send(stock, stockAbi, 'approve', [splitter, MAX])

  await measure('split', () => estData(splitter, splitterAbi, 'split', [E]))
  await measure('merge', () => estData(splitter, splitterAbi, 'merge', [E]))
  await measure('swap', () => estData(poolDiv, poolAbi, 'swapExactIn', [false, 10n * E, 0n]))
  await measure('addLiquidity', () => estData(poolDiv, poolAbi, 'addLiquidity', [E, E, 0n]))
  await measure('removeLiquidity', () =>
    estData(poolDiv, poolAbi, 'removeLiquidity', [1n, 0n, 0n]),
  )
  await measure('claim', () => estData(divLeg, splitTokenAbi, 'claim', []))

  // declareDemo: estimate first, then a real demo declaration so distribute()
  // has a declaration past exAt to simulate against.
  await measure('declareDemo', () => estData(oracle, oracleAbi, 'declareDemo', [E]))
  await send(oracle, oracleAbi, 'declareDemo', [E])
  const decl = (await read<{
    id: bigint
    seq: bigint
    amountPerShare: bigint
    refPrice: bigint
    declaredAt: bigint
    exAt: bigint
    source: number
  }>(oracle, oracleAbi, 'get', [1n]))!
  console.log(`  waiting for exAt=${decl.exAt} ...`)
  const target = Number(decl.exAt) + 1
  while (Number((await publicClient.getBlock()).timestamp) < target) {
    await new Promise((r) => setTimeout(r, 4000))
  }
  await measure('distribute', () => estData(splitter, splitterAbi, 'distribute', []))

  await measure('nativeTransfer', () =>
    publicClient.estimateGas({
      account: account.address,
      to: RELAY_EOA,
      value: 1n,
    }),
  )

  // Declared limits = measured x 1.25, rounded up.
  const declared: Record<string, bigint> = {}
  for (const key of Object.keys(results)) {
    declared[key] = (results[key] * GAS_HEADROOM + 99n) / 100n
  }

  const body = [
    '// Gas limits measured on Monad Testnet via estimateGas (frd.md §2, T1.3),',
    '// then multiplied by 1.25 and rounded up. Monad charges the declared limit,',
    '// so the +25% headroom is the value the app sends as `gas`.',
    `// measured (wei): ${Object.entries(results)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
    'export const GAS_LIMITS = {',
    ...Object.entries(declared).map(([k, v]) => `  ${k}: ${v}n,`),
    '} as const',
    '',
    'export const GAS_HEADROOM_PERCENT = 125n',
    '',
  ].join('\n')
  await writeFile(join(process.cwd(), 'src', 'chain', 'gas.ts'), body, 'utf8')

  console.log('')
  console.log('Measured -> declared (x1.25, rounded up)')
  console.log('-----------------------------------------')
  for (const key of Object.keys(results)) {
    console.log(`  ${key.padEnd(16)} ${results[key]}  ->  ${declared[key]}`)
  }
  console.log('')
  console.log('Written: src/chain/gas.ts')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})