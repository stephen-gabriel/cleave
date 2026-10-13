# Cleave — Product Requirements Document

## 1. Executive summary
**Problem.** A tokenized stock bundles two very different things: a stream of cash dividends and exposure to price. Holders cannot separate them. Income-seeking treasuries are forced to take price risk to earn dividends; growth holders are forced to sit on a cash flow they do not want. Offchain, stripping a dividend stream is institutional OTC derivatives with large minimums.

**Solution.** Cleave lets anyone deposit a tokenized stock into a Splitter and receive two ERC-20 legs:
- **Price leg (pACME-A):** the stock's price movement; redeemable 1:1 for the stock at maturity.
- **Dividend leg (dACME-A):** every dividend paid until maturity, in mUSD, claimable by whoever holds the leg.
Legs trade against mUSD in on-chain pools. 1 Price leg + 1 Dividend leg can always be merged back into 1 stock before maturity, which anchors fair pricing.

**Tagline.** *Split a stock into its dividends and its price.*

**Why Monad / why now.** Dividend legs reprice sharply around ex-dividend moments. With 400ms blocks and ~800ms finality, a trader can watch a dividend get declared, see the countdown, trade the repricing and claim in seconds, with no "pending" state. The Finance track asks for equities that are "locked, streamed, conditioned, or distributed by a contract": Cleave locks the equity and distributes its cash flows by contract.

**Honest originality statement.** Conceptually close to yield stripping (Pendle-style) applied to equities. The novelty is (a) discrete, oracle-declared dividends with a live ex-date countdown as a trading experience, (b) equity-specific cash-flow legs, (c) a CRE-orchestrated dividend feed.

## 2. First user (Founder & Market Readiness, 25%)
**Primary user: on-chain treasury allocators** — treasurers/stewards at DAOs and protocols holding stablecoins who must produce predictable yield, cannot hold volatile assets, and are starting to see tokenized equities arrive on-chain.
- Pain: stablecoin yields are variable and tied to crypto cycles; equity dividends are a scheduled, uncorrelated cash flow, but holding the equity forces price risk.
- Cleave job: buy the Dividend leg for scheduled mUSD cash flow with no price exposure.
**Counterparty:** tokenized-equity holders who want cash now (sell the Dividend leg) or want clean price exposure (sell it, keep the Price leg).
**Illustrative persona (not a real person):** "Tolu, treasury steward of a mid-size DAO, 18 months of runway in USDC, mandate to earn 4–6% with no token price risk."
**Why the market does not exist yet:** tokenized equities with real dividend pass-through are new; no venue lists their cash-flow legs; dividends are discrete, which generic yield-splitters handle poorly.
**Distribution plan (next 100 users):** (1) pitch to tokenized-equity issuers/communities as a listing layer, (2) DAO treasury working groups and forums, (3) Monad ecosystem channels, (4) integration as a market in existing Monad trading venues.

## 3. Scope
### In scope (MVP)
- Contracts: MockStock (mACME), MockUSD (mUSD), DividendOracle (CRE consumer + demo path), Splitter + SplitToken(price/dividend), Pool (CPMM) ×2.
- Mera passkey account as the ENTIRE account layer: create, sign in, scoped session, stateless test.
- Screens: Landing, Split/Merge, Trade (both legs), Dividends, Portfolio, Market stats, About & Risks, Judges page.
- CRE workflow: HTTP fetch of dividend feed → read oracle state → write report via forwarder on Monad Testnet (simulation with broadcast).
- Envio HyperIndex: events → entities incl. aggregates (hourly pool stats, protocol stats, simulated vs organic split); GraphQL consumed by UI.
- Starter experience: `/api/drip` for gas, in-app token faucets.
- Test-wallet bot producing simulated volume (labelled).
- Deliverables: README, logo, demo video, pitch video, CRE demo video, judge instructions.
### Out of scope
- Real assets, real dividends, mainnet, fiat, KYC.
- Multiple series, governance, fee switches, AMM LP token standard, order books.
- Native mobile app, light theme, i18n.
- Production-grade security (no audit; documented as demo).

## 4. Tech stack
- Frontend: existing Vite + React + TypeScript app; viem; `@category-labs/mera`, `@scure/bip32`, `@scure/bip39`; Recharts for charts; Google Fonts (Manrope, IBM Plex Mono). Hosting: Vercel free tier (static + 2 serverless functions in `/api`).
- Contracts: Solidity ^0.8.24 with OpenZeppelin 5.x, using the repo's existing toolchain (keep whatever deploys `CalculatorConsumer` today).
- Indexer: Envio HyperIndex on Envio Cloud free tier (Monad Testnet, chain 10143).
- Orchestration: Chainlink CRE CLI workflow (same language as the tutorial already completed), simulation only.
- Chain: Monad Testnet, RPC `https://testnet-rpc.monad.xyz` (rate limited ~25 rps: batch and poll sensibly), explorer `https://testnet.monadexplorer.com`.

## 5. Success metrics (for the demo, not production)
- Time from landing to first confirmed transaction ≤ 45 s with ≤ 2 passkey prompts.
- Clearing site data then signing in reproduces address and balances 100% of the time.
- ≥ 300 simulated trades and ≥ 20 splits visible in Envio-powered stats at submission, labelled simulated; plus any real tester wallets (bonus).
  - **Status 2026-10-13 — closed without completion.** Bounded runs indexed 20 simulated swaps and 20 simulated splits (splits target met; swaps 20/300) before testnet gas/funding ceilings stopped further runs; the 20-minute continuous run was not achieved. Original target kept above as plan history — not a submission claim. See `docs/decisions.md`.
- Zero console errors on the demo path.

## 6. Rubric mapping
| Criterion | How Cleave scores |
|---|---|
| Technical Execution 20 | Real split/merge, accumulator dividends, CPMM pricing, CRE→oracle→Splitter flow, all on-chain |
| Design & Craft 20 | Legible pricing, fair-value indicator, price impact + min-received, risk disclosure, countdown to ex-date, trust-first UI |
| Originality 15 | Equity cash-flow legs + live ex-date trading + CRE feed; honest about Pendle lineage |
| Founder & Market Readiness 25 | Named user role (treasury allocators), pain, counterparty, why-not-yet, distribution plan |
| Traction 20 | Simulated volume (explicitly accepted by this track) shown honestly + optional friend testers + next-step plan |

## 7. Bounty mapping
| Bounty | How it is used meaningfully |
|---|---|
| Mera UX ($2.5K) | Mera is the entire account layer; one-prompt onboarding; scoped prompt-free session; stateless test; time-to-first-tx badge |
| Chainlink CRE ($3K) | Dividend declarations and reference price enter the chain only via the CRE workflow (HTTP → read → report → write); demo video of CLI simulation |
| Envio ($1K) | Indexer drives price charts, trade/activity feeds, per-user history and the Market page aggregates |
Skipped: Mera PRF (would be forced decoration).

## 8. Key risks and mitigations
| Risk | Mitigation |
|---|---|
| Originality read as "Pendle for stocks" | Lead with discrete dividends + ex-date repricing + equity focus; be upfront |
| Distribution gaming at ex-time (entitlement = holders at distribution tx) | Document as a known demo limitation; production would use snapshots; UI auto-prompts "Pay dividend" at ex-time |
| Judges cannot get gas | `/api/drip` + faucet link + Judges page |
| Stale deploys | Rule 3 (commit+push every task, verify Vercel commit) |
| Gate took 5× estimate | Milestones have buffers; cut order defined |
| Passkey provider differences | PRF-unavailable screen with plain-language guidance; Judges page lists tested browsers |
| Testnet RPC rate limits | Multicall, 1–3 s polling, Envio for history |
