import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { publicClient } from './clients'
import { CHAIN } from './addresses'
import {
  MOCK_STOCK_ABI,
  MOCK_USD_ABI,
  SPLITTER_ABI,
  SPLIT_TOKEN_ABI,
  DIVIDEND_ORACLE_ABI,
} from './abis'

export const POLL_INTERVAL_MS = 6_000

export type ChainState = {
  loading: boolean
  offline: boolean
  stockBalance: bigint | null
  usdBalance: bigint | null
  priceLegBalance: bigint | null
  divLegBalance: bigint | null
  monBalance: bigint | null
  stockAllowance: bigint | null
  maturity: bigint | null
  plannedDividends: number | null
  distributedCount: number | null
  remainingDividends: number | null
  oracleCount: number | null
  refPrice: number | null
  amountPerShare: number | null
  latestSource: number | null
  refresh: () => void
}

const EMPTY: Omit<
  ChainState,
  'loading' | 'offline' | 'refresh'
> = {
  stockBalance: null,
  usdBalance: null,
  priceLegBalance: null,
  divLegBalance: null,
  monBalance: null,
  stockAllowance: null,
  maturity: null,
  plannedDividends: null,
  distributedCount: null,
  remainingDividends: null,
  oracleCount: null,
  refPrice: null,
  amountPerShare: null,
  latestSource: null,
}

export function useChainState(address: Address | null): ChainState {
  const [state, setState] = useState(EMPTY)
  const [loading, setLoading] = useState(address !== null)
  const [offline, setOffline] = useState(false)
  const inflight = useRef(false)
  const dirty = useRef(false)

  const load = useCallback(async () => {
    if (address === null) return
    if (inflight.current) {
      dirty.current = true
      return
    }
    inflight.current = true
    try {
      const batch = await publicClient.multicall({
        contracts: [
          {
            address: CHAIN.stock,
            abi: MOCK_STOCK_ABI,
            functionName: 'balanceOf',
            args: [address],
          },
          {
            address: CHAIN.stock,
            abi: MOCK_STOCK_ABI,
            functionName: 'allowance',
            args: [address, CHAIN.splitter],
          },
          {
            address: CHAIN.usd,
            abi: MOCK_USD_ABI,
            functionName: 'balanceOf',
            args: [address],
          },
          {
            address: CHAIN.priceLeg,
            abi: SPLIT_TOKEN_ABI,
            functionName: 'balanceOf',
            args: [address],
          },
          {
            address: CHAIN.divLeg,
            abi: SPLIT_TOKEN_ABI,
            functionName: 'balanceOf',
            args: [address],
          },
          {
            address: CHAIN.splitter,
            abi: SPLITTER_ABI,
            functionName: 'maturity',
            args: [],
          },
          {
            address: CHAIN.splitter,
            abi: SPLITTER_ABI,
            functionName: 'plannedDividends',
            args: [],
          },
          {
            address: CHAIN.splitter,
            abi: SPLITTER_ABI,
            functionName: 'distributedCount',
            args: [],
          },
          {
            address: CHAIN.splitter,
            abi: SPLITTER_ABI,
            functionName: 'remainingDividends',
            args: [],
          },
          {
            address: CHAIN.oracle,
            abi: DIVIDEND_ORACLE_ABI,
            functionName: 'count',
            args: [],
          },
          {
            address: CHAIN.oracle,
            abi: DIVIDEND_ORACLE_ABI,
            functionName: 'lastRefPrice',
            args: [],
          },
        ],
      })

      if (batch.some((r) => r.error)) {
        throw new Error('multicall item failed')
      }

      const result = batch.map((r) => r.result)
      const stockBalance = asBigInt(result[0])
      const stockAllowance = asBigInt(result[1])
      const usdBalance = asBigInt(result[2])
      const priceLegBalance = asBigInt(result[3])
      const divLegBalance = asBigInt(result[4])
      const maturity = asBigInt(result[5])
      const plannedDividends = asNumber(result[6])
      const distributedCount = asNumber(result[7])
      const remainingDividends = asNumber(result[8])
      const oracleCount = asNumber(result[9])
      const refPriceWad = asBigInt(result[10]) ?? 100n * 10n ** 18n
      const refPrice = refPriceWad === null ? null : Number(refPriceWad) / 1e18

      let amountPerShare: number | null = null
      let latestSource: number | null = null
      if (oracleCount !== null && oracleCount > 0) {
        const latest = await publicClient.readContract({
          address: CHAIN.oracle,
          abi: DIVIDEND_ORACLE_ABI,
          functionName: 'latest',
        })
        const declared = latest as {
          id: bigint
          seq: bigint
          amountPerShare: bigint
          refPrice: bigint
          declaredAt: bigint
          exAt: bigint
          source: number
        }
        amountPerShare = Number(declared.amountPerShare) / 1e18
        latestSource = declared.source
      }

      const monBalance = await publicClient.getBalance({ address })

      setState({
        stockBalance,
        usdBalance,
        priceLegBalance,
        divLegBalance,
        monBalance,
        stockAllowance,
        maturity,
        plannedDividends,
        distributedCount,
        remainingDividends,
        oracleCount,
        refPrice,
        amountPerShare,
        latestSource,
      })
      setOffline(false)
    } catch {
      // RPC hiccup — keep last known values (§14), the shell shows the banner.
      setOffline(true)
    } finally {
      setLoading(false)
      inflight.current = false
      if (dirty.current) {
        dirty.current = false
        void load()
      }
    }
  }, [address])

  useEffect(() => {
    if (address === null) {
      setState(EMPTY)
      setLoading(false)
      return
    }
    setState(EMPTY)
    setLoading(true)
    void load()
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [address, load])

  const refresh = useCallback(() => {
    void load()
  }, [load])

  return { ...state, loading, offline, refresh }
}

function asBigInt(value: unknown): bigint | null {
  return typeof value === 'bigint' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'bigint' ? Number(value) : null
}