# Gas report

Measured via `receipt.gasUsed` on the Hardhat simulated network (solc 0.8.28, evm target paris),
produced by the 8 required test groups in `test/cleave.test.ts` (`npx hardhat test`).
T1.3 measures `estimateGas` on Monad Testnet × 1.25 and stores the limits in `src/chain/gas.ts`.

| Call | gasUsed |
|---|---|
| CRE report | 195682 |
| CRE report seq=5 | 192882 |
| approve stock | 47065 |
| approve stock to pool | 47065 |
| approve usd to pool | 47065 |
| declare #1 | 206827 |
| declareDemo | 206827 |
| declareDemo #1 | 206827 |
| declareDemo #2 | 155527 |
| distribute | 133827 |
| distribute #1 | 56533 |
| faucet | 67839 |
| mint stock to alice | 71181 |
| mint usd to alice | 71147 |
| redeem | 50698 |
| setMinter (setup) | 48230 |
| split | 169773 |
| transfer 40 dACME | 68245 |
