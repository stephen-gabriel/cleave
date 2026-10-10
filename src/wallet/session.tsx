import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createWalletClient, formatEther, formatGwei, http } from 'viem'
import type { Abi, Address } from 'viem'
import { monadTestnet } from 'viem/chains'
import { createAccount, signIn, publicClient, type PasskeyWallet } from './mera'
import { RPC_URL } from '../chain/clients'
import { ALLOWLIST } from '../chain/addresses'
import { reportConfirmedTx, startTxTimer } from '../lib/timing'
import { buildTxDiagnostics, rememberTxCause, txFailureLogLine } from './txFailure'

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

export type PendingAction = {
  type: 'send'
  params: SendParams
} | null

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
  pendingAction: PendingAction
  setPendingAction: (action: PendingAction) => void
  clearPendingAction: () => void
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
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)

  const clearPendingAction = useCallback(() => {
    setPendingAction(null)
  }, [])

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

  const handleSend = useCallback(async (params: SendParams): Promise<SendResult> => {
    const opened = walletRef.current
    if (opened === null) throw new Error('Not signed in')

    // Set pending action for potential session expiry retry
    setPendingAction({ type: 'send', params })

    const target = params.to.toLowerCase()
    if (!ALLOWLIST.some((entry) => entry.toLowerCase() === target)) {
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
    // Fee cap is always the chain's current gas price × 1.2 — never a
    // hard-coded gwei value (a fixed cap drifts away from the live price and
    // gasLimit × maxFeePerGas is what the node requires up front). A failure
    // while reading the price must also be logged, so it stays inside the
    // same diagnostics block as a rejected write.
    let gasPrice = 0n
    let maxFeePerGas = 0n
    // Monad charges the declared limit in full (src/chain/gas.ts), and
    // execution costs drift as contract state grows, so the limit is
    // re-estimated before every send. The configured GAS_LIMITS constant is
    // only the fallback when estimation itself fails.
    let gas = params.gas
    let gasSource = 'configured limit'
    let hash: `0x${string}`
    try {
      gasPrice = await publicClient.getGasPrice()
      maxFeePerGas = (gasPrice * 120n) / 100n
      try {
        const estimated = await publicClient.estimateContractGas({
          account: opened.account,
          address: params.to,
          abi: params.abi,
          functionName: params.functionName,
          args: params.args,
        })
        gas = (estimated * 125n) / 100n
        gasSource = `estimate ${estimated} +25%`
      } catch {
        gasSource = `configured limit ${params.gas}`
      }
      console.info(
        `[cleave:send] begin ${params.functionName} gas=${gas} (${gasSource}) gasPrice=${formatGwei(gasPrice)} gwei maxFeePerGas=${formatGwei(maxFeePerGas)} gwei required=${formatEther(gas * maxFeePerGas)} MON`,
      )
      hash = await client.writeContract({
        address: params.to,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        gas,
        maxFeePerGas,
      })
    } catch (error) {
      let monBalance: bigint | null = null
      try {
        monBalance = await publicClient.getBalance({ address: opened.account.address })
      } catch {
        monBalance = null
      }
      const diagnostics = buildTxDiagnostics({
        address: opened.account.address,
        gasLimit: gas,
        gasPrice,
        maxFeePerGas,
        monBalance,
        error,
      })
      console.error(txFailureLogLine(diagnostics), diagnostics)
      rememberTxCause(error, diagnostics.cause)
      throw error
    }

    console.info(`[cleave:send] submitted ${hash} — waiting for receipt`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.info(`[cleave:send] mined ${hash} status=${receipt.status}`)
    if (receipt.status === 'reverted') {
      console.error(
        `[cleave:send] reverted ${hash} gas=${gas} (${gasSource}) — on-chain revert, the declared limit is charged in full`,
      )
      throw new RevertedTransactionError(hash)
    }
    const seconds = finish()
    if (typeof params.usdValue === 'number' && params.usdValue > 0) {
      spentUsdRef.current += params.usdValue
      setSpentUsd(spentUsdRef.current)
    }
    const isFirst = reportConfirmedTx(hash, seconds).isFirst
    clearPendingAction()
    return { hash, seconds, isFirst }
  }, [])

  const handleExtend = useCallback(async () => {
    const opened = await signIn()
    applyWallet(opened)
    void readBalance(opened.account.address)
    // Retry pending action after session extension
    if (pendingAction && pendingAction.type === 'send') {
      try {
        await handleSend(pendingAction.params)
      } catch {
        // Error will be handled by caller
      }
    }
    clearPendingAction()
  }, [applyWallet, readBalance, pendingAction, handleSend])

  const handleSignIn = useCallback(async () => {
    const opened = await signIn()
    applyWallet(opened)
    void readBalance(opened.account.address)
    // Retry pending action after re-authentication (e.g., after session expiry)
    if (pendingAction && pendingAction.type === 'send') {
      try {
        await handleSend(pendingAction.params)
      } catch {
        // Error will be handled by caller
      }
    }
    clearPendingAction()
  }, [applyWallet, readBalance, pendingAction, handleSend])

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
      pendingAction,
      setPendingAction,
      clearPendingAction,
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
      pendingAction,
      setPendingAction,
      clearPendingAction,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (ctx === null) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}