# Gas report

Measured via `receipt.gasUsed` on the Hardhat simulated network (solc 0.8.28, evm target paris),
produced by the 8 required test groups in `test/cleave.test.ts` (`npx hardhat test`).
T1.3 measures `estimateGas` on Monad Testnet × 1.25 and stores the limits in `src/chain/gas.ts`.

| Call | gasUsed |
|---|---|
| B returns 40 dACME | 125957 |
| CRE report | 195682 |
| CRE report seq=5 | 192882 |
| addLiquidity | 261482 |
| approve stock | 47065 |
| approve stock to pool | 47065 |
| approve usd to pool | 47065 |
| claim A | 72255 |
| claim A again | 35418 |
| claim B | 67455 |
| claim after merge | 61159 |
| declare #1 | 206827 |
| declare #2 | 155527 |
| declareDemo | 206827 |
| declareDemo #1 | 206827 |
| declareDemo #2 | 155527 |
| distribute | 133827 |
| distribute #1 | 56533 |
| distribute #2 | 82527 |
| faucet | 67839 |
| faucet usd | 67839 |
| merge | 70213 |
| merge before claim | 102053 |
| mint stock to alice | 71181 |
| mint usd to alice | 71147 |
| redeem | 50698 |
| removeLiquidity | 83568 |
| setMinter (setup) | 48230 |
| split | 169773 |
| swap tokenIn=false | 79516 |
| swap tokenIn=true | 79518 |
| transfer 40 dACME | 68245 |
