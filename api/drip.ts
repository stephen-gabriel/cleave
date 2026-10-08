import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type Rep =
  | { status: 'sent'; txHash: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error' }

type Req = {
  method: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type Res = {
  status: (code: number) => Res
  json: (body: Rep | JsonValue) => void
  setHeader: (name: string, value: string) => void
  end: () => void
}

const RPC_URL = process.env.MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz'
const DRIP_AMOUNT = '0.25'
const MIN_RECIPIENT = '0.05'
const MIN_DRIP = '0.5'
const RATE_LIMIT = 3
const RATE_WINDOW_MS = 60 * 60 * 1000

const hits = new Map<string, number[]>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) return true
  recent.push(now)
  hits.set(key, recent)
  return false
}

function clientIp(req: Req): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim()
  return 'direct'
}

function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function secretKey(): `0x${string}` | null {
  const raw = process.env.DRIP_PRIVATE_KEY
  if (typeof raw !== 'string' || raw.length === 0) return null
  const prefixed = raw.startsWith('0x') ? raw : `0x${raw}`
  return /^0x[0-9a-fA-F]{64}$/.test(prefixed) ? (prefixed as `0x${string}`) : null
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = (req.body ?? {}) as { address?: unknown }
  if (!isAddress(body.address)) {
    res.status(400).json({ error: 'Address required' })
    return
  }
  const address = body.address.toLowerCase() as Address

  if (rateLimited(clientIp(req))) {
    res.status(429).json({ status: 'skipped', reason: 'rate limit — try again later' })
    return
  }

  const key = secretKey()
  if (key === null) {
    res.status(200).json({ status: 'skipped', reason: 'drip wallet not configured' })
    return
  }

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(RPC_URL),
  })

  try {
    const recipient = await publicClient.getBalance({ address })
    if (recipient >= parseEther(MIN_RECIPIENT)) {
      res.status(200).json({
        status: 'skipped',
        reason: 'balance already above 0.05 MON',
      })
      return
    }

    const account = privateKeyToAccount(key)
    const dripBalance = await publicClient.getBalance({ address: account.address })
    if (dripBalance < parseEther(MIN_DRIP)) {
      res.status(200).json({
        status: 'skipped',
        reason: 'drip wallet below 0.5 MON',
      })
      return
    }

    const walletClient = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(RPC_URL),
    })

    const txHash = await walletClient.sendTransaction({
      to: address,
      value: parseEther(DRIP_AMOUNT),
      gas: 21_000n,
    })
    res.status(200).json({ status: 'sent', txHash })
  } catch {
    res.status(502).json({ status: 'error' })
  }
}