# Cleave — Agent Build Pack (READ THIS FIRST)

Cleave splits a (mock) tokenized stock into two independently tradable pieces: a **Price leg** and a **Dividend leg**. Built for the Monad Metropolis hackathon, track **Onchain Finance & Trading**, plus bounties **Mera UX**, **Chainlink CRE**, **Envio**.

Deadline: **Oct 14, 2026 04:59 GMT+1** (Lagos time). Submit by **Oct 13 evening**.

## Reading order
1. `00_READ_ME_FIRST.md` (this file: rules + locked decisions)
2. `prd.md` (what and why, scope, rubric/bounty mapping)
3. `frd.md` (exact contracts, events, schema, APIs, CRE workflow, bot)
4. `architecture.md` (components, data flow, repo layout, env vars, deployment)
5. `ui_spec.md` (every screen, component, state, copy)
6. `milestones/01_core_architecture.md` → `02_key_features.md` → `03_polish_and_demo.md`
7. `submission_kit.md` (demo scripts, pitch, bounty answers, judge access page copy)

## Rules of engagement (non-negotiable)
1. **Do not ask the owner clarifying questions.** Every decision is made in these docs. If something is genuinely missing, pick the simplest option that satisfies the acceptance criteria, append one line to `docs/decisions.md` (date, decision, reason) and continue.
2. **$0 spend.** Monad Testnet only (chain ID 10143). Free tiers only (Vercel, Envio Cloud, Chainlink CRE simulation). No paid APIs. No mainnet.
3. **Commit AND push at the end of every task without asking.** (A previous fix was never pushed and the live site served stale code for hours.) After each push, state which commit Vercel is serving.
4. **Secrets never enter git.** `.env`, `.env.*` (except `.env.example` with names only) are in `.gitignore`. Private keys (deployer, drip, bot) live only in local `.env.*` files and Vercel env vars. Before every push run a quick scan for `0x` + 64 hex characters in tracked files.
5. **Everything on screen is honest.** Every screen shows the "SIMULATED · MONAD TESTNET" pill. Bot-generated volume is labelled as simulated everywhere it is displayed. Never imply real equity, real dividends or real users.
6. **Stateless identity.** Nothing needed for identity or balances may live in localStorage/sessionStorage/IndexedDB. Identity = passkey. Balances/positions = chain (viem) and Envio. Clearing site data must never lose anything.
7. **Gas on Monad is charged on the declared gas limit, not gas used.** Set explicit per-transaction gas limits (see `frd.md` §Gas), measured then +25%. Fee cap must not exceed what the balance can cover (`gasLimit × maxFeePerGas`).
8. **Test before moving on.** Each task lists acceptance checks. Run them. Do not start the next task with a failing check.
9. Keep scope exactly as specified. No extra features before all "Never cut" items work end to end.

## Never cut (in priority order)
1. Split / merge of the stock (contract + UI) on Monad Testnet.
2. Mera passkey login incl. the stateless test and the scoped session.
3. CRE dividend workflow (simulation with `--broadcast` writing a declaration the UI shows with a "Chainlink CRE" badge) + the 2-minute recording.
4. Dividend distribution + claim.
5. Trading of both legs against mUSD (CPMM pools).
6. Envio indexer driving the Market page, price charts and activity feeds.

## Cut order if time slips (cut first → last)
polish animations → Portfolio P&L extras → liquidity UI (keep script-seeded liquidity) → Envio hourly candles (keep line chart from swaps) → bot sophistication (keep simple random trader) → Market page extras.

## Locked decisions (owner may veto before building starts)
| # | Decision | Reason |
|---|---|---|
| D1 | Name **Cleave**; underlying **mACME** (new mock token, redeployed), quote **mUSD**, legs **pACME-A** / **dACME-A** | Consistent naming; old MockStock retired |
| D2 | Single series "A": 6 planned dividends, matures deploy+120 days | Keeps one coherent market |
| D3 | Dividend leg uses an accumulator (dividend-paying token pattern), distribution is permissionless | Correct under transfers; simple |
| D4 | Trading via two constant-product pools (30 bps fee): pACME-A/mUSD and dACME-A/mUSD | Real pricing logic, easy to build |
| D5 | Dividends enter via `DividendOracle`: CRE path (forwarder) + clearly labelled Demo path (anyone, rate-limited) | CRE cannot be deployed (no deploy access) so the live app needs a Demo path; both are shown honestly |
| D6 | External data source for CRE = our own `/api/dividend-feed` endpoint, deterministic, labelled simulated | $0, reproducible, real HTTP call |
| D7 | Gas: server-side `/api/drip` sends 0.25 MON once per low-balance address | Judges cannot use Discord-gated faucets |
| D8 | Mera session policy enforced at app layer (15 min expiry, 5,000 mUSD-value cap, allowlisted contracts only) unless Mera docs expose native scoping — check `mera.category.xyz/concepts/signing-sessions` first | Bounty needs a scoped session |
| D9 | Web app (responsive, mobile-first), not native | Rules allow it |
| D10 | First user: on-chain **treasury allocators** (DAO/protocol treasurers) — see `prd.md` | Rubric needs a named user beyond "crypto traders" |
