import type { Address } from 'viem'

export const EVM_ACCOUNT_PATH = "m/44'/60'/0'/0/0"
export const SEND_AMOUNT_MON = '0.001'
// Deployment declares ~1.01M gas at Monad's 122 gwei maxFeePerGas, so the
// upfront cost is ~0.123 MON. This covers that with room for price drift.
export const FUND_DEPLOYER_AMOUNT_MON = '0.2'

/** Intrinsic cost of a value transfer with no calldata. Monad bills the declared limit. */
export const TRANSFER_GAS_LIMIT = 21_000n

/**
 * `eth_estimateGas` for a first `mint()` measured 80,504 on chain: it writes two
 * cold-zero slots (the caller's balance and totalSupply) plus a log. Later mints
 * reuse the warm slots and cost ~53k. 100k covers the cold case with margin;
 * Monad bills the declared limit, so padding further would cost real MON.
 */
export const MINT_GAS_LIMIT = 100_000n

function readAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as Address)
    : undefined
}

/** Throwaway EOA that publishes MockStock. Public data, safe to ship to the browser. */
export const DEPLOYER_ADDRESS = readAddress(import.meta.env.VITE_DEPLOYER_ADDRESS)

/** Written by `npm run deploy:mockstock`. Absent until the first deployment. */
export const MOCK_STOCK_ADDRESS = readAddress(import.meta.env.VITE_MOCK_STOCK_ADDRESS)

export const MOCK_STOCK_ABI = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MINT_AMOUNT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const