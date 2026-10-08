import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createWalletClient, http } from 'viem'
import type { Abi, Address } from 'viem'
import { monadTestnet } from 'viem/chains'
import { createAccount, signIn, publicClient, type PasskeyWallet } from './mera'
import { RPC_URL } from '../chain/clients'
import { ALLOWLIST } from '../chain/addresses'
import { reportConfirmedTx, startTxTimer } from '../lib/timing'

export const SESSION_MS = 15 * 60 * 1000
export const SESSION_CAP_USD = 5000

export type SendParams = {
  to: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  gas: bigint
  usdValue?: number
}

export type SendResult = { hash: `0x${string}`; seconds: number; isFirst: boolean }

export type PolicyCode = 'NOT_ALLOWLISTED' | 'CAP_EXCEEDED'

export class SessionPolicyError extends Error {
  code: PolicyCode
  constructor(code: PolicyCode, message: string) {
    super(message)
    this.name = 'SessionPolicyError'
    this.code = code
  }
}

export function isSessionPolicyError(error: unknown): error is SessionPolicyError {
  return error instanceof SessionPolicyError
}

export class RevertedTransactionError extends Error {
  readonly hash: `0x${string}`
  constructor(hash: `0x${string}`) {
    super('Transaction reverted')
    this.name = 'RevertedTransactionError'
    this.hash = hash
  }
}

export function isRevertedTransactionError(error: unknown): error is RevertedTransactionError {
  return error instanceof RevertedTransactionError
}

export type SessionContextValue = {
  wallet: PasskeyWallet | null
  signedInAt: number | null
  expiresAt: number | null
  remainingMs: number
  expired: boolean
  monBalance: bigint | null
  spentUsd: number
  created: boolean
  create: () => Promise<void>
  signIn: () => Promise<void>
  lock: () => void
  extend: () => Promise<void>
  send: (params: SendParams) => Promise<SendResult>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<PasskeyWallet | null>(null)
  const [signedInAt, setSignedInAt] = useState<number | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [expired, setExpired] = useState(false)
  const [created, setCreated] = useState(false)
  const [monBalance, setMonBalance] = useState<bigint | null>(null)
  const [spentUsd, setSpentUsd] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const walletRef = useRef<PasskeyWallet | null>(null)
  const spentUsdRef = useRef(0)

  const applyWallet = useCallback((opened: PasskeyWallet) => {
    walletRef.current?.session.end()
    walletRef.current = opened
    setWallet(opened)
    const now = Date.now()
    setNowMs(now)
    setSignedInAt(now)
    setExpiresAt(now + SESSION_MS)
    setExpired(false)
    setMonBalance(null)
    spentUsdRef.current = 0
    setSpentUsd(0)
  }, [])

  const readBalance = useCallback(async (address: `0x${string}`) => {
    try {
      setMonBalance(await publicClient.getBalance({ address }))
    } catch {
      return
    }
  }, [])

  const handleCreate = useCallback(async () => {
    const opened = await createAccount()
    applyWallet(opened)
    setCreated(true)
    void readBalance(opened.account.address)
  }, [applyWallet, readBalance])

  const handleSignIn = useCallback(async () => {
    const opened = await signIn()
    applyWallet(opened)
    void readBalance(opened.account.address)
  }, [applyWallet, readBalance])

  const handleLock = useCallback(() => {
    walletRef.current?.session.end()
    walletRef.current = null
    setWallet(null)
    setSignedInAt(null)
    setExpiresAt(null)
    setCreated(false)
    setMonBalance(null)
    spentUsdRef.current = 0
    setSpentUsd(0)
  }, [])

  const handleExtend = useCallback(async () => {
    const opened = await signIn()
    applyWallet(opened)
    void readBalance(opened.account.address)
  }, [applyWallet, readBalance])

  const handleSend = useCallback(async (params: SendParams): Promise<SendResult> => {
    const opened = walletRef.current
    if (opened === null) throw new Error('Not signed in')

    const target = params.to.toLowerCase() as Address
    if (!ALLOWLIST.includes(target)) {
      throw new SessionPolicyError(
        'NOT_ALLOWLISTED',
        'This action is outside your session scope and needs your passkey.',
      )
    }

    const finish = startTxTimer()
    const client = createWalletClient({
      account: opened.account,
      chain: monadTestnet,
      transport: http(RPC_URL),
    })
    const gasPrice = await publicClient.getGasPrice()
    const maxFeePerGas = (gasPrice * 120n) / 100n

    const hash = await client.writeContract({
      address: params.to,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      gas: params.gas,
      maxFeePerGas,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status === 'reverted') throw new RevertedTransactionError(hash)
    const seconds = finish()
    if (typeof params.usdValue === 'number' && params.usdValue > 0) {
      spentUsdRef.current += params.usdValue
      setSpentUsd(spentUsdRef.current)
    }
    const isFirst = reportConfirmedTx(hash, seconds).isFirst
    return { hash, seconds, isFirst }
  }, [])

  useEffect(() => {
    if (wallet === null) return
    const timer = window.setInterval(() => {
      void readBalance(wallet.account.address)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [wallet, readBalance])

  useEffect(() => {
    if (expiresAt === null || wallet === null) return
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
      if (Date.now() >= expiresAt) {
        wallet.session.end()
        walletRef.current = null
        setWallet(null)
        setSignedInAt(null)
        setExpiresAt(null)
        setExpired(true)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt, wallet])

  const remainingMs = expiresAt === null ? 0 : Math.max(0, expiresAt - nowMs)

  const value = useMemo<SessionContextValue>(
    () => ({
      wallet,
      signedInAt,
      expiresAt,
      remainingMs,
      expired,
      monBalance,
      spentUsd: spentUsd,
      created,
      create: handleCreate,
      signIn: handleSignIn,
      lock: handleLock,
      extend: handleExtend,
      send: handleSend,
    }),
    [
      wallet,
      signedInAt,
      expiresAt,
      remainingMs,
      expired,
      monBalance,
      spentUsd,
      created,
      handleCreate,
      handleSignIn,
      handleLock,
      handleExtend,
      handleSend,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (ctx === null) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}