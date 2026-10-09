# Project Paths

- Repo root (Mera app, `_build_plan/`): `C:\Users\ZERO\Desktop\Cleave`
- CRE project: `C:\Users\ZERO\Desktop\Cleave-CRE` (the tutorial workflow, forwarder and `ReceiverTemplate` are reused in Milestone 2)
- Envio indexer: `C:\Users\ZERO\Desktop\Cleave-Envio`

# CRE Configuration (from Cleave-CRE/cleave-dividend-feed/config.staging.json)

- Chain: monad-testnet (Chain Selector - Monad Testnet is 10143 as per architecture; chain selector ID 10143)
- CalculatorConsumer (Receiver) Address: `0x6B91fAfE9fb63282A13b467dAB068BCD87274117`
- Storage/MockStock Address: `0x90000dbEcA8f03Bc96017F52b28FaA5e55Fd9Abe`
- Gas Limit: `500000`

**Note**: The CRE workflow writes reports through the Monad forwarder to the CalculatorConsumer. The forwarder address is specified by Chainlink CRE for the target chain; in the tutorial setup, the ReceiverTemplate/CalculatorConsumer integration uses the standard Chainlink CRE forwarder for Monad Testnet. This is to be referenced from the CRE deployment context when running in production - for now, note that the forwarder is the Chainlink CRE forwarder for Monad Testnet (chain selector 10143).

# Chainlink CRE Details

- Chain Selector (Monad Testnet): `10143`
- CRE CLI staging config: `C:\Users\ZERO\Desktop\Cleave-CRE\cleave-dividend-feed\config.staging.json`
- CRE project config: `C:\Users\ZERO\Desktop\Cleave-CRE\project.yaml`
- Workflow: `C:\Users\ZERO\Desktop\Cleave-CRE\cleave-dividend-feed/workflow.yaml`

# Envio Details

- Envio project: `C:\Users\ZERO\Desktop\Cleave-Envio`
- GraphQL URL: Not yet deployed (needs `envio deploy` to Envio Cloud). Expected format per architecture: `VITE_ENVIO_GRAPHQL_URL` (e.g., `https://indexer.hyperindex.xyz/<deployment-id>/graphql` or Envio Cloud URL). Check Envio dashboard after deployment.
- API Token: Present in `.env` (do not commit/share - excluded by git; local only)
- Start block: To be set to contract deployment block from `deployments/monad-testnet.json` after contracts deploy.

# Commands to run each piece

## Repo (Cleave)
```powershell
# Install dependencies
npm install

# Local development
npm run dev

# Build
npm run build

# Run contract tests (if using foundry/forge)
forge test

# Run lint/typecheck if configured
npm run lint 2>$null; npm run typecheck 2>$null

# Scan secrets
bash scripts/scan-secrets.sh  # or pwsh equivalent
```

## CRE (Cleave-CRE)
```powershell
cd C:\Users\ZERO\Desktop\Cleave-CRE\cleave-dividend-feed

# Install deps
npm install  # or bun install

# Typecheck
npm run typecheck

# Run locally (simulation)
cre local  # if cre CLI installed globally
# or via npx if configured

# Run simulation with broadcast (as per workflow)
cre workflow run --network staging  # check CLI syntax; CRE CLI v0.8.x uses different flags
```

**Note**: CRE CLI must be installed. Check with `cre --version` or `cre help`.

## Envio (Cleave-Envio)
```powershell
cd C:\Users\ZERO\Desktop\Cleave-Envio

# Install deps
npm install

# Generate types/codegen
npm run codegen

# Dev mode (local)
npm run dev

# Start (production mode)
npm run start

# Deploy to Envio Cloud
envio deploy

# Run tests
npm run test
```

**Note**: Envio CLI must be installed. Check with `envio --version`.

# Deployment

- Production URL: https://cleave-web.vercel.app


## Current status (2026-10-09)

- **Split gas issue: RESOLVED.** Owner confirmed a successful split of 100 mACME using the existing passkey wallet on https://cleave-web.vercel.app. This closes the owner-test blocker for dynamic gas-estimation fix `0da6c2b`, verified on GitHub main and in the live JavaScript bundle. No transaction hash or console trace was supplied; a separate approval receipt was not independently checked.
- T2.3 still has outstanding documented acceptance checks: merge returns stock, clearing site data and signing back in preserves address/balances, and the fresh-account starter flow. The successful existing-wallet split does not establish those results.
- Next unfinished milestone: **Milestone 02 - Key features**. Recommended next implementation task: **T2.2 Envio indexer**, after owner approval. Main-repo `indexer/` is an untracked Series A scaffold without handlers; sibling `Cleave-Envio` is the original MockStock indexer. Preserve both and build on the current Series A configuration. `src/data/envio.ts` is absent; Trade, Dividends, Portfolio and Market are currently placeholders.
- Current implemented CRE dividend workflow is in main-repo `cre/`; use `cre/README.md` for current configuration and recorded evidence. The sibling CRE/MockStock configuration above describes the original tutorial, not the current Cleave dividend workflow. Do not broadcast additional declarations for this inspection.
- `_gas.mjs` and `indexer/` remain untracked and preserved. This status update authorizes documentation edits only; no application changes, new milestone work, commit, push, or deployment.

## T2.4 Trade screen — verified (2026-10-09)

- **T2.4 implementation complete and committed (`180aba8`).** `src/pages/Trade.tsx` + `Trade.css`: Dividend/Price leg toggle, pool price chart (Envio `PoolHourly`/`Swap`) with fair-value dotted line and ex-dividend markers, 4-tile stats row (fair value w/ "Estimated" badge, pool-vs-fair chip, liquidity = mUSD reserve ×2, implied yield / accretes note), buy/sell order ticket quoting live via `Pool.getAmountOut` with debounce, price impact + min-received + 0.30% fee + custom slippage (localStorage), session-cap (5,000 mUSD) re-prompt modal, Envio trades feed (SIM tags for sim-wallets, own-trade highlight), and a Provide-liquidity accordion.
- Supporting: `POOL_ABI` + pool reserve/allowance/share reads in `src/chain/multicall.ts`; `src/lib/trading.ts` (pure math mirroring `Pool.getAmountOut`/`addLiquidity`/`removeLiquidity`, fair value per ui_spec §6.2, deviation chip, slippage, session cap); `src/lib/format.ts`; `refreshEnvioStore()`/`envioConfigured()` in `useEnvio.ts`; `resolveJsonModule` for `sim-wallets.json`.
- **Verification:** `npx tsc -b`, `npm run build`, `npm run typecheck:tests` pass. 18 frontend tests pass (3 files incl. new `frontend-tests/trading.test.ts` enforcing on-chain-equivalent swap/liquidity/fair-value math). `npm run lint` = 0 errors (24 pre-existing warnings, non-blocking; the previous session's lint stall is not reproducible — oxlint completes in ~0.3 s).
- **One fix applied on top of the prior session's draft:** `quoteSwap` price-impact now compares spot vs execution in the on-chain input-asset units (token/quote for buys), matching `Pool.getAmountOut`; buy-side fallback impact was previously computed inverted.
- **Not done / owner-gated:** live buy/sell on both pools against testnet (needs `VITE_ENVIO_GRAPHQL_URL` + a wallet with dripped gas/mUSD + indexer live), >0 trade so chart/feed update can be eyeballed, Liquidity add/remove on a seeded pool. Scratch files `_gas.mjs` and `temp_tsc.txt` remain untracked.

## T2.2 Envio — verified (2026-10-09)

- **T2.2 implementation complete and committed.** Series A `indexer/` (config from `frd.md` §6 contract/event surface, handlers for Split/Merge/Redeem/Swap/LiquidityChanged/DividendDeclared/DividendDistributed/Claimed, `Activity` feed, ProtocolStats simulated vs organic split), `src/data/{envio,envioStore,useEnvio}.ts` typed queries + single 3 s shared poller with backoff, and test harness (`frontend-tests/`, `vitest.config.ts`, `tsconfig.tests.json`).
- **Verification run locally:** 17 contract tests pass (`npx hardhat test`); indexer codegen + strict typecheck + 6 deterministic tests pass in Ubuntu WSL (`scripts/indexer-wsl.sh check`); 8 frontend tests pass; `tsc -b && vite build` passes; `oxlint` 0 errors.
- **Remaining T2.2 owner-gated steps (not done):** Docker/PostgreSQL/GraphQL local run (Docker daemon currently stopped), Envio Cloud deploy (`ENVIO_API_TOKEN` not present locally), public endpoint check (`scripts/check-envio.ts`), setting `VITE_ENVIO_GRAPHQL_URL`, and Vercel redeploy. The repo-root relative imports in `indexer/src/handlers/cleave.ts` must have the full checkout available when hosted; verify Envio Cloud checkout layout at deploy time.
- `_gas.mjs` remains a throwaway scratch script (self-labelled "deleted before commit") and is intentionally left untracked.
