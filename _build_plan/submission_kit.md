# Cleave — Submission Kit

**Tagline:** Split a stock into its dividends and its price.
**Market angle:** the first venue where equity cash flows trade on their own — built for on-chain treasury allocators who want scheduled dividend income without price risk.
**Honesty line (use everywhere):** "All assets, dividends and volume are simulated on Monad Testnet. Volume labelled SIM comes from our own test wallets."

## 1. Judge hooks (what to make unforgettable)
1. Dividend declared → live countdown → repricing → claim, all in seconds.
2. Clear fair value + price impact + risk disclosure (trust-first UI).
3. Account in one passkey tap; pass the stateless test live.
4. CRE feed visibly drives the dividend badge.
5. Envio-powered Market page showing simulated vs organic volume honestly.

## 2. Demo video script (≤ 3:00, live product only, no slides)
| Time | Screen | Say / show |
|---|---|---|
| 0:00–0:12 | Landing | "Stocks bundle dividends and price. Cleave splits them so you can hold only what you want. Everything here is simulated on Monad Testnet." |
| 0:12–0:35 | Create account | One passkey tap → "You're in." Starter pack: fee credit, mACME, mUSD. Show the ⚡ first-transaction badge ("no seed phrase, no extension"). |
| 0:35–1:00 | Split | Split 100 mACME → split animation → pACME-A and dACME-A. Mention 1 stock = 1 price leg + 1 dividend leg; merge returns the stock. |
| 1:00–1:30 | Trade | Dividend leg page: fair value chip "cheap", price impact, min received; buy; chip "Confirmed in 0.8 s". Point out SIM tags in the trades feed. |
| 1:30–2:10 | Dividends | Show CRE-declared dividend badge (declared earlier by the CRE workflow); or press Declare (demo); countdown; hold dividend leg; **Pay dividend**; Portfolio shows claimable; **Claim**; show price repricing on the chart. |
| 2:10–2:35 | Stateless test | DevTools → Clear site data → reload → Sign in → same address, balances, pending history. "Identity lives in the passkey; positions live on chain." |
| 2:35–2:52 | Market | Envio-driven stats: total split, volume split into simulated vs organic, dividends paid. |
| 2:52–3:00 | Close | "Cleave: split a stock into its dividends and its price. Live on Monad Testnet." |
Tips: pre-fund a clean account for retakes; keep a second profile ready for the stateless test; hide bookmarks; zoom 110%.

## 3. Pitch video script (≤ 2:00; face + voice, can overlay product clips)
- **0:00–0:15 Who:** "I'm [name], a solo builder. I built Cleave for the Finance track." (introduce team of one)
- **0:15–0:40 Problem:** "Tokenized stocks arrive on-chain, but you can't separate the dividend from the price. Treasuries that need predictable income must take price risk to get it."
- **0:40–1:05 Solution + user:** "Cleave splits a stock into a Dividend leg and a Price leg that trade separately. Our first user is the on-chain treasury allocator: stablecoin holders at DAOs who want scheduled dividend cash flow with no token price risk. Counterparties are holders who want cash now or clean price exposure."
- **1:05–1:25 Why Monad:** "Dividend legs reprice around ex-dividend moments. With 400ms blocks and sub-second finality you can watch it, trade it and claim it with no pending states."
- **1:25–1:45 Traction (honest):** "On testnet: [N] splits and [M] trades — [x]% simulated from our own wallets, labelled in the app — plus [k] outside testers [if any]."
- **1:45–2:00 Next step:** "Next: pilot with a tokenized-equity issuer, add multiple series and snapshot-based payouts, and bring this to treasury working groups."

## 4. Bounty submission answers (paste-ready)
**Mera UX — "Describe how your project meaningfully integrates Mera as the entire account layer."**
Cleave has no wallet, extension, seed phrase, email or custody backend. A single passkey prompt creates the account: Mera derives the key from the PRF output and a signing session signs transactions. Sessions are scoped (15-minute expiry, allowlist of Cleave contracts, 5,000 mUSD-value cap) so normal actions are prompt-free while sending anywhere else, exceeding the cap or extending the session re-prompts. The app stores nothing for identity: "Sign in" calls `getPasskeyPrfOutput` and the same address returns; balances and positions are read from the chain and Envio, so the stateless test (clear site data or fresh browser) passes live. Time from landing to first confirmed transaction is shown in the UI.

**Chainlink CRE — "Describe how your project meaningfully utilizes CRE as an orchestration layer."**
Dividend declarations and the reference price enter the chain only through a CRE workflow: it fetches the dividend feed over HTTP, reads the oracle's last sequence on Monad Testnet, decides whether a new declaration exists, builds a report and writes it through the Keystone forwarder to the `DividendOracle`, which then drives the Splitter's dividend distribution. The CLI simulation (with broadcast) is shown in the video. The feed is a labelled simulated endpoint because real tokenized-equity dividend feeds are not yet available on testnet.

**Envio — "Describe how your project meaningfully uses Envio."**
A HyperIndex indexer on Monad Testnet powers the product's core views: pool price series (hourly OHLC), trades and activity feeds, dividend timeline, per-account history and protocol aggregates, including a split between simulated and organic volume. The frontend reads these through a public GraphQL endpoint; balances and countdowns use direct chain reads. Repo includes `config.yaml`, `schema.graphql` and handlers.

## 5. Judge access instructions (paste into submission field)
> **Live app:** [URL]. No login is needed: open the link, tap **Create your account**, approve the passkey prompt (use desktop Chrome with Google Password Manager, or Safari/1Password; some devices show a second tap). Then follow the **Judges** page at [URL]/judges (2 minutes): claim the starter pack (fee credit is added automatically), split 100 mACME, buy some dividend leg, press **Declare dividend (demo)**, wait for the countdown, press **Pay dividend**, then **Claim**. To run the stateless test: clear site data (or open a fresh profile) and tap **Sign in** — you will see the same address and balances. If fee credit ever runs out, use https://faucet.monad.xyz/ or the Alchemy Monad Testnet faucet. All assets are mock tokens on Monad Testnet (chain 10143).

## 6. README skeleton
```
# Cleave — Split a stock into its dividends and its price
Live: <url> · Videos: demo / pitch / CRE / Mera / Envio · Track: Onchain Finance & Trading · Bounties: Mera UX, Chainlink CRE, Envio
## What it does (3 sentences + diagram)
## Try it in 2 minutes (judge steps)
## Why Monad
## Architecture (diagram from architecture.md §1)
## Contracts (table: name, address, explorer link)
## Chainlink CRE (how to run the simulation with broadcast, expected output)
## Envio (endpoint, sample query, schema summary)
## Mera (account layer, session policy, stateless test)
## What is simulated (assets, dividends, volume, bot) — honest disclosure
## Known limitations
## Roadmap / next steps
## Team & license
```
Sample Envio query to include:
```
{ ProtocolStats(where:{id:{_eq:"global"}}){ totalSplit volumeUsd simulatedVolumeUsd organicVolumeUsd uniqueAccounts dividendsPaidUsd } }
```

## 7. Anticipated judge questions (prepare answers)
- *Isn't this Pendle for stocks?* Yes in lineage; the difference is discrete, oracle-declared equity dividends, ex-date repricing as a trading experience, and equity-specific legs.
- *Who is the first user?* On-chain treasury allocators with stablecoin mandates; counterparties are equity holders wanting cash or clean price exposure.
- *What is real?* The contracts, settlement, pricing and indexing are real on testnet. The assets, dividend feed and most volume are simulated and labelled.
- *Can the dividend feed be gamed?* Entitlement is by holders at the payout transaction (documented); production would use snapshots and a verified issuer feed.
- *Why no deployed CRE?* Deployment needs separate access; the CLI simulation with broadcast writes real transactions on Monad Testnet.
- *What is next?* Pilot with a tokenized-equity issuer, multiple series, snapshot payouts, liquidity partner plan.

## 7. Live URL

Production: https://cleave-web.vercel.app
