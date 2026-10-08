// Gas limits measured on Monad Testnet via estimateGas (frd.md §2, T1.3),
// then multiplied by 1.25 and rounded up. Monad charges the declared limit,
// so the +25% headroom is the value the app sends as `gas`.
// session.tsx re-estimates before every send — these constants are the
// fallback when estimation itself fails.
// original measurements (wei): faucet=63457, approve=33024, split=171509,
// merge=162636, swap=187426, addLiquidity=205289, removeLiquidity=182060,
// claim=58216, declareDemo=189537, distribute=173380, nativeTransfer=27344.
// re-measured 2026-10-08 after approve/split ran out of gas on-chain:
// approve=53645 (the allowance slot was still zero, and zero -> non-zero
// costs ~20k more than the original read), split=205790 (contract state has
// grown), faucet=63457 and merge=162648 (unchanged).
export const GAS_LIMITS = {
  faucet: 79322n,
  approve: 67057n,
  split: 257238n,
  merge: 203310n,
  swap: 234283n,
  addLiquidity: 256612n,
  removeLiquidity: 227575n,
  claim: 72770n,
  declareDemo: 236922n,
  distribute: 216725n,
  nativeTransfer: 34180n,
} as const

export const GAS_HEADROOM_PERCENT = 125n
