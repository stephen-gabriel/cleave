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
  POOL_ABI,
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
  poolPriceReserveToken: bigint | null
  poolPriceReserveQuote: bigint | null
  poolDivReserveToken: bigint | null
  poolDivReserveQuote: bigint | null
  usdAllowanceDiv: bigint | null
  usdAllowancePrice: bigint | null
  priceLegAllowance: bigint | null
  divLegAllowance: bigint | null
  poolPriceShares: bigint | null
  poolDivShares: bigint | null
  poolPriceTotalShares: bigint | null
  poolDivTotalShares: bigint | null
  divLegPending: bigint | null
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
  poolPriceReserveToken: null,
  poolPriceReserveQuote: null,
  poolDivReserveToken: null,
  poolDivReserveQuote: null,
  usdAllowanceDiv: null,
  usdAllowancePrice: null,
  priceLegAllowance: null,
  divLegAllowance: null,
  poolPriceShares: null,
  poolDivShares: null,
  poolPriceTotalShares: null,
  poolDivTotalShares: null,
  divLegPending: null,
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
          {
            address: CHAIN.poolPrice,
            abi: POOL_ABI,
            functionName: 'reserveToken',
            args: [],
          },
          {
            address: CHAIN.poolPrice,
            abi: POOL_ABI,
            functionName: 'reserveQuote',
            args: [],
          },
          {
            address: CHAIN.poolDiv,
            abi: POOL_ABI,
            functionName: 'reserveToken',
            args: [],
          },
          {
            address: CHAIN.poolDiv,
            abi: POOL_ABI,
            functionName: 'reserveQuote',
            args: [],
          },
          {
            address: CHAIN.usd,
            abi: MOCK_USD_ABI,
            functionName: 'allowance',
            args: [address, CHAIN.poolDiv],
          },
          {
            address: CHAIN.usd,
            abi: MOCK_USD_ABI,
            functionName: 'allowance',
            args: [address, CHAIN.poolPrice],
          },
          {
            address: CHAIN.priceLeg,
            abi: SPLIT_TOKEN_ABI,
            functionName: 'allowance',
            args: [address, CHAIN.poolPrice],
          },
          {
            address: CHAIN.divLeg,
            abi: SPLIT_TOKEN_ABI,
            functionName: 'allowance',
            args: [address, CHAIN.poolDiv],
          },
          {
            address: CHAIN.poolPrice,
            abi: POOL_ABI,
            functionName: 'shares',
            args: [address],
          },
          {
            address: CHAIN.poolDiv,
            abi: POOL_ABI,
            functionName: 'shares',
            args: [address],
          },
          {
            address: CHAIN.poolPrice,
            abi: POOL_ABI,
            functionName: 'totalShares',
            args: [],
          },
          {
            address: CHAIN.poolDiv,
            abi: POOL_ABI,
            functionName: 'totalShares',
            args: [],
          },
          {
            address: CHAIN.divLeg,
            abi: SPLIT_TOKEN_ABI,
            functionName: 'pending',
            args: [address],
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
      const poolPriceReserveToken = asBigInt(result[11])
      const poolPriceReserveQuote = asBigInt(result[12])
      const poolDivReserveToken = asBigInt(result[13])
      const poolDivReserveQuote = asBigInt(result[14])
      const usdAllowanceDiv = asBigInt(result[15])
      const usdAllowancePrice = asBigInt(result[16])
      const priceLegAllowance = asBigInt(result[17])
      const divLegAllowance = asBigInt(result[18])
      const poolPriceShares = asBigInt(result[19])
      const poolDivShares = asBigInt(result[20])
      const poolPriceTotalShares = asBigInt(result[21])
      const poolDivTotalShares = asBigInt(result[22])
      const divLegPending = asBigInt(result[23])

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
        poolPriceReserveToken,
        poolPriceReserveQuote,
        poolDivReserveToken,
        poolDivReserveQuote,
        usdAllowanceDiv,
        usdAllowancePrice,
        priceLegAllowance,
        divLegAllowance,
        poolPriceShares,
        poolDivShares,
        poolPriceTotalShares,
        poolDivTotalShares,
        divLegPending,
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