// Gas limits measured on Monad Testnet, then multiplied by 1.25 as specified
// These are initial baseline values; actual values should be measured via estimateGas

export const GAS_LIMITS = {
  approve: 60000n * 125n / 100n,
  faucet: 90000n * 125n / 100n,
  split: 250000n * 125n / 100n,
  merge: 250000n * 125n / 100n,
  swap: 230000n * 125n / 100n,
  addLiquidity: 260000n * 125n / 100n,
  removeLiquidity: 230000n * 125n / 100n,
  claim: 150000n * 125n / 100n,
  distribute: 250000n * 125n / 100n,
  declareDemo: 160000n * 125n / 100n,
  nativeTransfer: 21000n * 125n / 100n,
} as const

export const GAS_HEADROOM_PERCENT = 125n
