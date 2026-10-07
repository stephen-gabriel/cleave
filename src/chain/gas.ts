// Gas limits measured on Monad Testnet via estimateGas (frd.md §2, T1.3),
// then multiplied by 1.25 and rounded up. Monad charges the declared limit,
// so the +25% headroom is the value the app sends as `gas`.
// measured (wei): faucet=63457, approve=33024, split=171509, merge=162636, swap=187426, addLiquidity=205289, removeLiquidity=182060, claim=58216, declareDemo=189537, distribute=173380, nativeTransfer=27344
export const GAS_LIMITS = {
  faucet: 79322n,
  approve: 41280n,
  split: 214387n,
  merge: 203295n,
  swap: 234283n,
  addLiquidity: 256612n,
  removeLiquidity: 227575n,
  claim: 72770n,
  declareDemo: 236922n,
  distribute: 216725n,
  nativeTransfer: 34180n,
} as const

export const GAS_HEADROOM_PERCENT = 125n
