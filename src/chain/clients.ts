import { createPublicClient, http } from 'viem'
import { monadTestnet } from 'viem/chains'

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(import.meta.env.VITE_RPC_URL ?? monadTestnet.rpcUrls.default.http[0]),
})

export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL ?? 'https://testnet.monadexplorer.com'
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://testnet-rpc.monad.xyz'
