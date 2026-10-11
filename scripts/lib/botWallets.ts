import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getAddress } from 'viem'

export function generatePrivateKeys(count: number): string[] {
  if (count < 1 || count > 64) throw new Error('wallet count must be 1..64')
  const keys: string[] = []
  for (let i = 0; i < count; i++) keys.push(generatePrivateKey())
  return keys
}

export function addressesFromKeys(keys: readonly string[]): string[] {
  return keys.map((k) => privateKeyToAccount(k as `0x${string}`).address)
}

export function formatEnvBot(keys: readonly string[]): string {
  return `BOT_PRIVATE_KEYS=${keys.join(',')}\n`
}

export function writeEnvBot(path: string, keys: readonly string[], overwrite: boolean): void {
  if (existsSync(path) && !overwrite) {
    throw new Error(`${path} already exists; pass --force to overwrite`)
  }
  writeFileSync(path, formatEnvBot(keys), { encoding: 'utf8', mode: 0o600 })
}

export function loadBotKeys(path: string): string[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const match = text.match(/^BOT_PRIVATE_KEYS=(.*)$/m)
  if (!match) return []
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^0x[0-9a-fA-F]{64}$/.test(s))
}

export function writeSimWallets(path: string, addresses: readonly string[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const normalized = [...addresses]
    .map((a) => getAddress(a))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  writeFileSync(path, `${JSON.stringify({ wallets: normalized })}\n`, 'utf8')
}

export function defaultBotEnvPath(cwd: string): string {
  return join(cwd, '.env.bot')
}

export function defaultSimWalletsPath(cwd: string): string {
  return join(cwd, 'config', 'sim-wallets.json')
}
