# Cleave — Architecture

## 1. System overview
```
                    ┌────────────────────────── Browser (Vercel static app) ──────────────────────────┐
 Passkey (device) ─▶│ Mera: PRF → key → signing session (15 min, allowlist, cap)                         │
                    │ viem: reads (multicall) + signs/broadcasts                                         │
                    │ UI: Split · Trade · Dividends · Portfolio · Market · About · Judges                │
                    └───────┬───────────────────────┬───────────────────────────────┬───────────────────┘
                            │ RPC (balances, quotes)│ GraphQL (history, charts)     │ POST /api/drip
                            ▼                       ▼                               ▼
                 Monad Testnet (10143)      Envio Cloud (HyperIndex)       Vercel serverless (/api)
              mACME mUSD Splitter dACME       ▲ events                       /drip  /dividend-feed
              pACME Pool×2 DividendOracle ────┘                                     │
                            ▲                                                       │ HTTP GET
                            │ report via Keystone forwarder                         ▼
                      Chainlink CRE workflow (CLI simulation + broadcast) ──────────┘
 Bot (local) ──▶ same contracts, 8 simulated wallets (labelled SIM)
```

## 2. Data flows
1. **Onboarding:** Create passkey → PRF → derive key → session → `/api/drip` (MON) → `faucet()` mACME and mUSD.
2. **Split:** approve (once, unlimited, mock tokens) → `Splitter.split` → legs minted → Envio `SplitEvent`/stats.
3. **Dividend (CRE path):** CRE simulation: GET feed → read `lastSeq` → report → forwarder → `DividendOracle.DividendDeclared(source=CRE)` → UI countdown → at `exAt` anyone calls `Splitter.distribute()` → mUSD minted to dividend leg and accumulated → holders `claim()`.
4. **Dividend (Demo path):** `declareDemo(amount)` → identical downstream, badge "Demo trigger".
5. **Trade:** quote via `Pool.getAmountOut` (viem call) → `swapExactIn` with min-out from slippage → Envio `Swap` → charts/feeds update (poll 3 s).
6. **Stateless sign-in:** page load → "Sign in" → `getPasskeyPrfOutput` → same key → balances read from chain.

## 3. Repo layout (adapt to existing; keep working files)
```
cleave/
  _build_plan/                 this documentation pack
  contracts/                   MockStock, MockUSD, DividendOracle, SplitToken, Splitter, Pool, interfaces/ (ReceiverTemplate)
  test/                        contract tests (see frd §1.7)
  scripts/                     deploy-cleave.ts, seed.ts, bot.ts, scan-secrets.sh
  deployments/monad-testnet.json   addresses + deploy block (public)
  config/sim-wallets.json      bot wallet addresses (public)
  src/                         Vite + React app
    chain/ (clients, abis, addresses, gas.ts, quotes.ts)
    wallet/ (mera.ts, session.ts, policy.ts)
    data/ (envio.ts queries, hooks)
    ui/ (components) pages/ (Landing, Split, Trade, Dividends, Portfolio, Market, About, Judges)
  api/                         drip.ts, dividend-feed.ts (Vercel functions)
  indexer/                     Envio: config.yaml, schema.graphql, src/EventHandlers.ts
  cre/                         CRE project + workflow + config
  docs/decisions.md            agent decision log
  README.md                    submission README (see submission_kit.md)
```

## 4. Environment variables
| Name | Where | Public? | Purpose |
|---|---|---|---|
| `VITE_RPC_URL` | Vercel + local | yes | Monad Testnet RPC |
| `VITE_STOCK_ADDRESS`, `VITE_USD_ADDRESS`, `VITE_SPLITTER_ADDRESS`, `VITE_PRICE_LEG_ADDRESS`, `VITE_DIV_LEG_ADDRESS`, `VITE_POOL_PRICE_ADDRESS`, `VITE_POOL_DIV_ADDRESS`, `VITE_ORACLE_ADDRESS` | Vercel + local | yes | Contract addresses |
| `VITE_ENVIO_GRAPHQL_URL` | Vercel + local | yes | Indexer endpoint |
| `VITE_EXPLORER_URL` | Vercel + local | yes | `https://testnet.monadexplorer.com` |
| `MONAD_TESTNET_RPC` | Vercel (functions) + local | yes | server-side RPC |
| `DRIP_PRIVATE_KEY` | Vercel only (Production) | **SECRET** | funds `/api/drip` (separate wallet holding ~2–3 MON) |
| `DEPLOYER_PRIVATE_KEY` | local `.env.deployer` | **SECRET** | deploy/seed |
| `BOT_PRIVATE_KEYS` | local `.env.bot` | **SECRET** | bot wallets |
After adding or changing any Vercel env var, **trigger a redeploy** (env changes only apply to new builds).

## 5. Deployment pipeline
1. Deploy contracts → write `deployments/monad-testnet.json` → set Vercel env vars → push → verify Vercel commit.
2. Set Envio `start_block` to the deploy block → deploy indexer to Envio Cloud → set `VITE_ENVIO_GRAPHQL_URL` → redeploy.
3. Put the live oracle address in `cre/` config → run CRE simulation with broadcast → verify declaration in UI.
4. Seed liquidity → run bot burst → confirm stats on Market page.
5. Make the GitHub repo public and grant access to `metropolis@hackathon.monad.xyz`.

## 6. Constraints and gotchas
- Passkeys are bound to the hostname; the production domain must stay fixed (use one Vercel production domain; avoid per-deploy preview URLs in demos).
- Desktop Chrome needs the passkey saved in Google Password Manager (else `PRF_UNAVAILABLE`); 1Password and iCloud Keychain are recommended authenticators.
- Mera requires HTTPS or localhost.
- Monad testnet RPC is rate limited: use multicall, poll 1–3 s, avoid per-component polling (one shared poller).
- Monad charges the declared gas limit: tune limits; ensure `gasLimit × maxFee ≤ balance`.
- CRE deployment requires separate access: **simulation + broadcast only**.
- Envio free tier: confirm the deployed GraphQL endpoint is public and responding before recording.

## 7. Security posture (demo-grade, state it honestly)
Mock tokens with public faucets; unlimited approvals to protocol contracts; no audit; known distribution-timing limitation; drip wallet funds are capped and separate from the deployer; secrets never in git.
