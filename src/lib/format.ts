import { formatEther } from 'viem'
import type { Quantity } from '../data/envio'

export function formatAmount(value: bigint | null | undefined, maxDecimals = 4): string {
  if (value === null || value === undefined) return '\u2014'
  const n = Number(formatEther(value))
  if (!Number.isFinite(n)) return '\u2014'
  return n.toLocaleString('en-US', {
    maximumFractionDigits: n < 1 ? Math.min(maxDecimals, 4) : Math.min(maxDecimals, 2),
  })
}

export function formatUsd(value: number | null | undefined, opts?: { compact?: boolean }): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014'
  if (opts?.compact === true && Math.abs(value) >= 100_000) {
    return `$${(value / 1000).toFixed(1)}K`
  }
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  })}`
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014'
  return `$${value.toLocaleString('en-US', {
    maximumFractionDigits: value < 1 ? 4 : 2,
  })}`
}

export function formatUsdFromWad(wad: Quantity | bigint | null | undefined): string {
  if (wad === null || wad === undefined) return '\u2014'
  return formatUsd(Number(formatEther(typeof wad === 'bigint' ? wad : BigInt(wad))))
}

export function shortAddress(address: string): string {
  if (address.length < 10) return address
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`
}

export function timeAgo(unixSeconds: number, now = Math.floor(Date.now() / 1000)): string {
  const diff = Math.max(0, now - Math.floor(unixSeconds))
  if (diff < 5) return 'now'
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export function timeOfDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}