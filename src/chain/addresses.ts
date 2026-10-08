import type { Address } from 'viem'

// Addresses come from VITE_* env vars (injected by Vite at build time).
// Fallbacks mirror deployments/monad-testnet.json so a build never silently
// points at empty addresses when an env var is missing.
const FROM_ENV = {
  stock: import.meta.env.VITE_STOCK_ADDRESS,
  usd: import.meta.env.VITE_USD_ADDRESS,
  splitter: import.meta.env.VITE_SPLITTER_ADDRESS,
  priceLeg: import.meta.env.VITE_PRICE_LEG_ADDRESS,
  divLeg: import.meta.env.VITE_DIV_LEG_ADDRESS,
  poolPrice: import.meta.env.VITE_POOL_PRICE_ADDRESS,
  poolDiv: import.meta.env.VITE_POOL_DIV_ADDRESS,
  oracle: import.meta.env.VITE_ORACLE_ADDRESS,
} as const

const FALLBACKS: Record<keyof typeof FROM_ENV, Address> = {
  stock: '0x0887e9c2259e1BeE30A8Ca5e7A7106C9cB06aC4a',
  usd: '0xa269989a4807a5da423B1973835EcbCc0cea5874',
  splitter: '0x042D56AcC5b0223930350B41F0FCdAF439480370',
  priceLeg: '0xe917A6927fEC963eB014529225A9Bff2De6498D7',
  divLeg: '0x6615F732F278e78BB321FE89342488cf4D139DCe',
  poolPrice: '0xF0e425305c2F96995a055583876F0Ab85581e72c',
  poolDiv: '0x0995F279Ed01F6A1019dc1d37570b7DDD783533c',
  oracle: '0x1f6ce6F6C0f24d7b93A56982988e7F274860e8Cc',
}

type ChainKey = keyof typeof FROM_ENV

function pick(key: ChainKey): Address {
  const value = FROM_ENV[key]
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as Address)
    : FALLBACKS[key]
}

export const CHAIN = {
  stock: pick('stock'),
  usd: pick('usd'),
  splitter: pick('splitter'),
  priceLeg: pick('priceLeg'),
  divLeg: pick('divLeg'),
  poolPrice: pick('poolPrice'),
  poolDiv: pick('poolDiv'),
  oracle: pick('oracle'),
} as const

// Session policy allowlist (frd.md §3): the contracts this session may sign.
export const ALLOWLIST: readonly Address[] = Object.values(CHAIN)

export default CHAIN