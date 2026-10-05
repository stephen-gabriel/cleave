import type { TransactionRequest } from 'viem'
import { publicClient } from './wallet'

/**
 * Monad's RPC has been observed returning an inflated `eth_maxFeePerGas` (182.4
 * gwei against a 100 gwei baseFee) when viem asks it to estimate fees. The node
 * validates `balance >= gasLimit * maxFeePerGas` before accepting a transaction,
 * so that estimate becomes a hard upfront requirement rather than a real cost: at
 * a 100,000 gas limit, 182.4 gwei demands 0.01824 MON and rejects thin accounts
 * even though the block's baseFee would only cost 0.0102 MON.
 *
 * Capping the fee at a fixed multiple of the live baseFee keeps the requirement
 * proportional to the work actually done. If the baseFee rises past the ceiling
 * the node rejects with "max fee per gas less than block base fee", and
 * `sendWithFees` re-resolves once before giving up.
 */
const MAX_FEE_MULTIPLIER = 2n

/** Covers the priority fee observed on Monad testnet (2 gwei). */
const PRIORITY_FEE_WEI = 2_000_000_000n

export type Fees = {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  baseFeePerGas: bigint
}

export async function resolveFees(): Promise<Fees> {
  const block = await publicClient.getBlock({ blockTag: 'pending' })

  // Monad does not implement eth_maxPriorityFeePerGas, so estimateFeesPerGas
  // reports only maxFeePerGas. Fall back through the shapes viem may return.
  const estimated = await publicClient.estimateFeesPerGas()
  const reported = estimated.maxFeePerGas ?? estimated.gasPrice
  if (reported === undefined) {
    throw new Error('The RPC did not report a gas price. Try again in a moment.')
  }

  const baseFeePerGas = block.baseFeePerGas ?? reported
  const ceiling = baseFeePerGas * MAX_FEE_MULTIPLIER
  const maxFeePerGas = reported > ceiling ? ceiling : reported
  const maxPriorityFeePerGas = PRIORITY_FEE_WEI < maxFeePerGas ? PRIORITY_FEE_WEI : maxFeePerGas

  return { maxFeePerGas, maxPriorityFeePerGas, baseFeePerGas }
}

/**
 * The balance the node will require before accepting this transaction shape.
 * Monad rejects with "Signer had insufficient balance" when it is unmet, which
 * is why this is surfaced as a preflight check instead of a raw RPC error.
 */
export function requiredBalance(gas: bigint, fees: Fees): bigint {
  return gas * fees.maxFeePerGas
}

function isBaseFeeTooLow(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('base fee') || message.includes('FeeTooLow')
}

/**
 * Signs and broadcasts with fees pinned to the baseFee ceiling, retrying once if
 * the baseFee moved out from under us. The caller must supply an explicit `gas`
 * because Monad bills the declared limit rather than the gas consumed.
 */
export async function sendWithFees(
  send: (fees: Fees) => Promise<`0x${string}`>,
  gas: bigint,
  availableBalance: bigint,
): Promise<`0x${string}`> {
  let fees = await resolveFees()

  const needed = requiredBalance(gas, fees)
  if (availableBalance < needed) {
    throw new Error(
      `Not enough MON. This transaction declares ${gas.toLocaleString('en-US')} gas at ` +
        `${formatGwei(fees.maxFeePerGas)} gwei, so the node requires ` +
        `${formatMon(needed)} MON, but the account holds ${formatMon(availableBalance)} MON. ` +
        `Get more from the faucet.`,
    )
  }

  try {
    return await send(fees)
  } catch (error) {
    if (!isBaseFeeTooLow(error)) throw error
    fees = await resolveFees()
    return await send(fees)
  }
}

function formatGwei(wei: bigint): string {
  return (Number(wei) / 1e9).toString()
}

function formatMon(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6)
}

export type { TransactionRequest }