// Cleave seeding script (frd.md §1.8).
// Mints mock balances to the deployer, splits 10_000 mACME, and seeds the two
// CPMM pools so the dividend leg ≈ 6.00 mUSD and the price leg ≈ 94.00 mUSD.
import {
  encodeFunctionData,
  formatEther,
  getAddress,
} from 'viem'
import type { Abi, Address } from 'viem'
import {
  createClients,
  assertChain,
  explorerUrl,
  readArtifact,
} from './lib/chain'
import { loadDeployment } from './lib/deployments'

const E = 10n ** 18n
const MAX = 2n ** 256n - 1n
const GAS_HEADROOM = 125n

const TOKENS = {
  STOCK: 10_000n * E, // mACME minted to deployer
  USD: 600_000n * E, // mUSD minted to deployer
  SPLIT: 10_000n * E, // amount split into 10_000 pACME-A + 10_000 dACME-A
  DIV_LIQ: [5_000n * E, 30_000n * E] as const, // 5_000 dACME : 30_000 mUSD → 6.00
  PRICE_LIQ: [5_000n * E, 470_000n * E] as const, // 5_000 pACME : 470_000 mUSD → 94.00
}

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
  const splitter = need('splitter')
  const priceLeg = need('priceLeg')
  const divLeg = need('divLeg')
  const poolPrice = need('poolPrice')
  const poolDiv = need('poolDiv')

  const abi = async (name: string): Promise<Abi> => (await readArtifact(name)).abi as Abi
  const stockAbi = await abi('MockStock')
  const usdAbi = await abi('MockUSD')
  const splitTokenAbi = await abi('SplitToken')
  const splitterAbi = await abi('Splitter')
  const poolAbi = await abi('Pool')

  const read = async <T>(to: Address, a: Abi, fn: string, args: unknown[] = []) =>
    (await publicClient.readContract({ address: to, abi: a, functionName: fn, args })) as T

  const send = async (to: Address, a: Abi, fn: string, args: unknown[]) => {
    const data = encodeFunctionData({ abi: a, functionName: fn, args })
    const fees = await publicClient.estimateFeesPerGas()
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice
    const estimated = await publicClient.estimateGas({
      account: account.address,
      to,
      data,
    })
    const gasLimit = (estimated * GAS_HEADROOM) / 100n
    const hash = await walletClient.sendTransaction({ to, data, gas: gasLimit, maxFeePerGas })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${fn} reverted`)
    console.log(`  ${fn} ok (gas used ${receipt.gasUsed} of ${gasLimit} declared)`)
  }

  const ensureAllowance = async (
    token: Address,
    a: Abi,
    spender: Address,
    min: bigint,
  ) => {
    const current = await read<bigint>(token, a, 'allowance', [account.address, spender])
    if (current >= min) {
      console.log(`  allowance ${spender} on ${token}: already >= required (skip)`)
      return
    }
    await send(token, a, 'approve', [spender, MAX])
  }

  console.log(`deployer  : ${account.address}`)
  console.log(`balance   : ${formatEther(await publicClient.getBalance({ address: account.address }))} MON`)
  console.log('')
  console.log('Contracts loaded from deployments/monad-testnet.json')
  console.log(`  stock    ${stock}   ${explorerUrl(stock)}`)
  console.log(`  usd      ${usd}   ${explorerUrl(usd)}`)
  console.log(`  splitter ${splitter}   ${explorerUrl(splitter)}`)
  console.log(`  pLeg     ${priceLeg}   ${explorerUrl(priceLeg)}`)
  console.log(`  dLeg     ${divLeg}   ${explorerUrl(divLeg)}`)
  console.log(`  poolP    ${poolPrice}   ${explorerUrl(poolPrice)}`)
  console.log(`  poolD    ${poolDiv}   ${explorerUrl(poolDiv)}`)
  console.log('')

  // 1. Owner-mint mock balances to the deployer (targets per frd 1.8).
  const stockBal = await read<bigint>(stock, stockAbi, 'balanceOf', [account.address])
  if (stockBal < TOKENS.STOCK) {
    await send(stock, stockAbi, 'mint', [account.address, TOKENS.STOCK - stockBal])
  } else {
    console.log(`  mACME balance already >= ${formatEther(TOKENS.STOCK)} (skip mint)`)
  }
  const usdBal = await read<bigint>(usd, usdAbi, 'balanceOf', [account.address])
  if (usdBal < TOKENS.USD) {
    await send(usd, usdAbi, 'mint', [account.address, TOKENS.USD - usdBal])
  } else {
    console.log(`  mUSD balance already >= ${formatEther(TOKENS.USD)} (skip mint)`)
  }

  // 2. Approve + split 10_000 mACME into equal leg amounts.
  const already = await read<bigint>(divLeg, splitTokenAbi, 'balanceOf', [account.address])
  if (already === 0n) {
    await ensureAllowance(stock, stockAbi, splitter, TOKENS.SPLIT)
    await send(splitter, splitterAbi, 'split', [TOKENS.SPLIT])
  } else {
    console.log(`  deployer already holds ${formatEther(already)} dACME (skip split)`)
  }

  // 3. Approve each pool to pull the leg token and mUSD it needs.
  await ensureAllowance(priceLeg, splitTokenAbi, poolPrice, TOKENS.PRICE_LIQ[0])
  await ensureAllowance(divLeg, splitTokenAbi, poolDiv, TOKENS.DIV_LIQ[0])
  await ensureAllowance(usd, usdAbi, poolPrice, TOKENS.PRICE_LIQ[1])
  await ensureAllowance(usd, usdAbi, poolDiv, TOKENS.DIV_LIQ[1])

  // 4. Seeded liquidity: only touch a pool that is still empty.
  const poolPriceTotal = await read<bigint>(poolPrice, poolAbi, 'totalShares')
  if (poolPriceTotal === 0n) {
    await send(poolPrice, poolAbi, 'addLiquidity', [
      TOKENS.PRICE_LIQ[0],
      TOKENS.PRICE_LIQ[1],
      1n,
    ])
  } else {
    console.log(`  price pool already has ${poolPriceTotal} shares (skip addLiquidity)`)
  }
  const poolDivTotal = await read<bigint>(poolDiv, poolAbi, 'totalShares')
  if (poolDivTotal === 0n) {
    await send(poolDiv, poolAbi, 'addLiquidity', [TOKENS.DIV_LIQ[0], TOKENS.DIV_LIQ[1], 1n])
  } else {
    console.log(`  dividend pool already has ${poolDivTotal} shares (skip addLiquidity)`)
  }

  // 5. Report reserves, prices and leftover leg balances.
  console.log('')
  console.log('Seeded state')
  console.log('------------')
  const [pt, pq] = [
    await read<bigint>(poolPrice, poolAbi, 'reserveToken'),
    await read<bigint>(poolPrice, poolAbi, 'reserveQuote'),
  ]
  const [dt, dq] = [
    await read<bigint>(poolDiv, poolAbi, 'reserveToken'),
    await read<bigint>(poolDiv, poolAbi, 'reserveQuote'),
  ]
  console.log(`  price pool    reserves ${formatEther(pt)} pACME : ${formatEther(pq)} mUSD  -> price ${fmtRate(pq, pt)} mUSD/pACME`)
  console.log(`  dividend pool reserves ${formatEther(dt)} dACME : ${formatEther(dq)} mUSD  -> price ${fmtRate(dq, dt)} mUSD/dACME`)
  console.log(`  deployer pACME left: ${formatEther(await read<bigint>(priceLeg, splitTokenAbi, 'balanceOf', [account.address]))}`)
  console.log(`  deployer dACME left: ${formatEther(await read<bigint>(divLeg, splitTokenAbi, 'balanceOf', [account.address]))}`)
  console.log(`  deployer mACME left: ${formatEther(await read<bigint>(stock, stockAbi, 'balanceOf', [account.address]))}`)
  console.log(`  deployer mUSD left : ${formatEther(await read<bigint>(usd, usdAbi, 'balanceOf', [account.address]))}`)
  console.log('')
  console.log('No dividend declared at seed (per frd 1.8).')
}

function fmtRate(quote: bigint, token: bigint): string {
  if (token === 0n) return 'n/a'
  const scaled = (quote * 1_000_000n) / token
  const whole = scaled / 1_000_000n
  const frac = scaled % 1_000_000n
  return `${whole}.${frac.toString().padStart(6, '0')}`
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})