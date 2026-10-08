import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createAccount, signIn, publicClient, type PasskeyWallet } from './mera'

export const SESSION_MS = 15 * 60 * 1000
export const SESSION_CAP_USD = 5000

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
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<PasskeyWallet | null>(null)
  const [signedInAt, setSignedInAt] = useState<number | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [expired, setExpired] = useState(false)
  const [created, setCreated] = useState(false)
  const [monBalance, setMonBalance] = useState<bigint | null>(null)
  const [spentUsd] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const walletRef = useRef<PasskeyWallet | null>(null)

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
  }, [])

  const handleExtend = useCallback(async () => {
    const opened = await signIn()
    applyWallet(opened)
    void readBalance(opened.account.address)
  }, [applyWallet, readBalance])

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
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (ctx === null) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}