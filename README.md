# Cleave — Split a stock into its dividends and its price

**Live app:** [https://cleave-web.vercel.app](https://cleave-web.vercel.app)
**Track:** Onchain Finance & Trading · **Bounties:** Mera UX, Chainlink CRE, Envio
**Honesty line:** All assets, dividends and volume are simulated on Monad Testnet. Volume labelled SIM comes from our own test wallets.

Stocks bundle dividends and price. Cleave splits a tokenized stock into two ERC-20 legs you can trade on their own — a **dividend leg** (every cash distribution until maturity) and a **price leg** (the residual). Everything runs live on Monad Testnet with passkey accounts (Mera), a CRE-driven dividend oracle, and an Envio indexer for history and market stats.

## What it does

1. Deposit a mock stock (mACME) into the Splitter.
2. Receive `dACME-A` (dividend leg) + `pACME-A` (price leg).
3. Trade each leg in its own CPMM pool against mUSD.
4. Dividends are declared (CRE or demo), paid on-chain at ex-dividend, and claimed by dividend-leg holders.
5. Merge legs back into the stock (before maturity), or redeem the price leg for the stock at maturity.

```
1 pACME-A + 1 dACME-A  =  1 mACME
```

## Try it in 2 minutes (judges)

Open the [live app](https://cleave-web.vercel.app) and follow **[Judges](https://cleave-web.vercel.app/judges)** in-app, or:

1. Tap **Create your account** — one passkey prompt (desktop Chrome / Safari / 1Password). No extension, no seed phrase.
2. Claim the starter pack (fee credit is added automatically).
3. **Split** 100 mACME → receive both legs.
4. **Trade** the dividend leg — note fair value, price impact, and SIM tags.
5. **Declare dividend (demo)** on Dividends → wait for the countdown → **Pay dividend** → **Claim**.
6. Stateless test: clear site data (or fresh profile) → **Sign in** → same address, balances, history.

Need testnet MON? [Monad faucet](https://faucet.monad.xyz/) or the in-app faucet link.

## Why Monad

Dividend legs reprice around ex-dividend moments. With 400ms blocks and sub-second finality you can watch declare → reprice → pay → claim with no pending states — the whole event is a live trading experience, not a multi-block wait.

## Architecture

```
┌─────────────┐     passkey / session      ┌──────────────────┐
│  React app  │ ◄────────────────────────► │  Mera account    │
│  (Vite)     │                            │  (WebAuthn PRF)  │
└──────┬──────┘                            └──────────────────┘
       │ multicall reads + session-signed txs
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Monad Testnet (10143)                                       │
│  Splitter · SplitToken×2 · Pool×2 · DividendOracle · Mock*  │
└──────┬──────────────────────────────┬───────────────────────┘
       │ events                       │ HTTP feed
       ▼                              ▼
┌──────────────┐              ┌──────────────────┐
│ Envio        │              │ Chainlink CRE    │
│ HyperIndex   │              │ workflow (CLI)   │
└──────┬───────┘              └────────┬─────────┘
       │ GraphQL                       │ report tx
       ▼                               ▼
┌──────────────────────────────  DividendOracle ──────────────┐
└─────────────────────────────────────────────────────────────┘
```

- **Frontend:** React + TypeScript + Vite (`src/`), viem client, one shared multicall poller.
- **Accounts:** Mera passkey sessions — 15-minute expiry, Cleave-contract allowlist, 5,000 mUSD value cap. Identity is never stored; the same passkey always returns the same address.
- **CRE:** `CREDividendCalculator` consumer fetches a dividend feed, writes a report through the Keystone forwarder into `DividendOracle`, which drives `Splitter.distribute()`.
- **Envio:** HyperIndex indexes Splitter, pools, and oracle events into GraphQL for trades, timeline, history, and protocol stats (SIM vs organic volume).

## Contracts (Monad Testnet)

| Contract | Address | Explorer |
|---|---|---|
| MockStock (mACME) | [`0x0887e9c2259e1BeE30A8Ca5e7A7106C9cB06aC4a`](https://testnet.monadexplorer.com/address/0x0887e9c2259e1BeE30A8Ca5e7A7106C9cB06aC4a) | |
| MockUSD (mUSD) | [`0xa269989a4807a5da423B1973835EcbCc0cea5874`](https://testnet.monadexplorer.com/address/0xa269989a4807a5da423B1973835EcbCc0cea5874) | |
| Splitter | [`0x042D56AcC5b0223930350B41F0FCdAF439480370`](https://testnet.monadexplorer.com/address/0x042D56AcC5b0223930350B41F0FCdAF439480370) | |
| Price leg (pACME-A) | [`0xe917A6927fEC963eB014529225A9Bff2De6498D7`](https://testnet.monadexplorer.com/address/0xe917A6927fEC963eB014529225A9Bff2De6498D7) | |
| Dividend leg (dACME-A) | [`0x6615F732F278e78BB321FE89342488cf4D139DCe`](https://testnet.monadexplorer.com/address/0x6615F732F278e78BB321FE89342488cf4D139DCe) | |
| Price pool | [`0xF0e425305c2F96995a055583876F0Ab85581e72c`](https://testnet.monadexplorer.com/address/0xF0e425305c2F96995a055583876F0Ab85581e72c) | |
| Dividend pool | [`0x0995F279Ed01F6A1019dc1d37570b7DDD783533c`](https://testnet.monadexplorer.com/address/0x0995F279Ed01F6A1019dc1d37570b7DDD783533c) | |
| DividendOracle | [`0x1f6ce6F6C0f24d7b93A56982988e7F274860e8Cc`](https://testnet.monadexplorer.com/address/0x1f6ce6F6C0f24d7b93A56982988e7F274860e8Cc) | |
| CRE forwarder | [`0xb9f79d863261869b234c481d1f9a7af84aead192`](https://testnet.monadexplorer.com/address/0xb9f79d863261869b234c481d1f9a7af84aead192) | |

Deployments also live in `deployments/monad-testnet.json`. Series A maturity: **2027-02-04**.

## Chainlink CRE

Dividend declarations and the reference price enter the chain only through a CRE workflow:

1. Fetch the dividend feed over HTTP (labelled simulated endpoint — real tokenized-equity feeds are not on testnet yet).
2. Read the oracle’s last sequence on Monad Testnet.
3. Decide whether a new declaration exists; build a report.
4. Write through the Keystone forwarder into `DividendOracle`.
5. `Splitter.distribute()` uses the oracle to move value into the dividend leg.

The sibling project **Cleave-CRE** contains the `CalculatorConsumer` workflow and CLI (simulate + broadcast). The on-screen **Declare dividend (demo)** button uses the same oracle path via `declareDemo` for a self-contained judge demo.

## Envio

Public GraphQL endpoint (HyperIndex on Monad Testnet):

```
https://indexer.dev.hyperindex.xyz/de75845/v1/graphql
```

Sample query:

```graphql
{
  ProtocolStats(where: { id: { _eq: "global" } }, limit: 1) {
    totalSplit
    volumeUsd
    simulatedVolumeUsd
    organicVolumeUsd
    uniqueAccounts
    dividendsPaidUsd
  }
}
```

Repo includes `indexer/config.yaml`, `indexer/schema.graphql`, and handlers. Balances and countdowns use direct chain reads; trades, timeline, history, and market stats come from Envio.

## Mera (account layer)

Cleave has no wallet, extension, seed phrase, email, or custody backend. A single passkey prompt creates the account: Mera derives the key from the PRF output and a scoped signing session signs transactions.

- **Session policy:** 15-minute expiry · allowlist of Cleave contracts only · 5,000 mUSD value cap. Sending elsewhere, exceeding the cap, or extending the session re-prompts.
- **Stateless test:** clear site data or use a fresh browser → Sign in → same address, balances, pending history. Identity lives in the passkey; positions live on chain.

## What is simulated (read this)

| Piece | Real / Simulated |
|---|---|
| Contracts, settlement, pricing math, CRE→oracle→Splitter path | **Real** on Monad Testnet |
| Mock stock / mock USD | **Simulated** assets |
| Dividend feed for CRE | **Simulated** labelled endpoint |
| Bot / test-wallet volume | **Simulated**, labelled SIM in the UI |
| Passkey accounts, sessions, drip faucet | **Real** Mera flows |

We show simulated vs organic volume honestly on the Market page.

## Known limitations

- Mock assets only — not real equities or real dividends.
- Single series (Series A); multi-series and snapshot-based payouts are roadmap.
- CRE uses a simulated feed because real issuer feeds are not available on testnet.
- Entitlement is by holders at the payout transaction (production would use snapshots + verified issuer).
- Fee credit drip is capped; excess faucet MON is reported, never swept.
- Indexer is eventually consistent; charts show last known values if Envio is briefly down.

## Roadmap

- Pilot with a tokenized-equity issuer.
- Multiple series and snapshot-based payouts.
- Liquidity partner plan for launch pools.
- Production CRE feed + multi-oracle options.

## Commands

```bash
npm install
npm run dev          # local dev server
npm run build        # tsc -b && vite build (must pass before every push)
npm run test:frontend
npx hardhat compile
powershell -File .\scripts\scan-secrets.ps1
```

## Team & license

Solo builder. Hackathon demo on Monad Testnet — not a live exchange, not financial advice.

Licensed under the [MIT License](./LICENSE).

Licensed under the [MIT License](./LICENSE).

## Docs

- `_build_plan/` — FRD, milestones, submission kit, UI spec
- `docs/decisions.md` — architecture decision records
- `indexer/README.md` — Envio config notes
