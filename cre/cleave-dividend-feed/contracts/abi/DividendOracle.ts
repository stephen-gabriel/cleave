export const DividendOracle = [
  {
    stateMutability: "view",
    type: "function",
    name: "lastSeq",
    inputs: [],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
  },
  {
    stateMutability: "view",
    type: "function",
    name: "count",
    inputs: [],
    outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
  },
] as const