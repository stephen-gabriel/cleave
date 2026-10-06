# Milestone 01 — Core architecture (target: finish by Oct 8 night)

Agent: execute tasks in order. After each task run its acceptance checks, then **commit and push without asking**, then state the commit Vercel is serving. Do not ask the owner questions (see `00_READ_ME_FIRST.md`). Keep `frd.md` open: it holds exact signatures.

## T1.0 Repo hygiene and secrets (30 min)
- Untrack `.env` if tracked; add `.env`, `.env.*` (except `.env.example`) to `.gitignore`; create `.env.example` with variable NAMES from `architecture.md` §4.
- Add `scripts/scan-secrets.sh` that fails if any tracked file contains `0x` followed by 64 hex chars or the strings `PRIVATE_KEY=` with a value.
- Create `docs/decisions.md`.
- Commit the pending CRE tutorial files (CalculatorConsumer, interfaces/ReceiverTemplate, deploy script, `@openzeppelin/contracts` + `dotenv` deps) as a separate commit "chore: CRE tutorial files" (keep ReceiverTemplate; it is reused).
- **Accept:** scan script passes; `git status` clean; push done.

## T1.1 Passkey sign-in on production (30 min) — HIGH PRIORITY, already coded, verify only
- Confirm the "Sign in with existing passkey" path (`getPasskeyPrfOutput({ rpId })` with no stored credential) is on production and that **no identity data is read from storage**.
- **Accept (manual, record in `docs/decisions.md`):** sign in → note address/MON balance → clear site data → sign in → identical address and balances. Only ONE passkey exists for the production domain (owner already deleted extras).

## T1.2 Contracts (3–4 h)
Implement in this order, with tests from `frd.md` §1.7 as you go:
1. `MockStock` (mACME), `MockUSD` (mUSD).
2. `SplitToken` (price + dividend variants) and `Splitter`.
3. `DividendOracle` (reuse the working `ReceiverTemplate` and the SAME forwarder address used by the completed `CalculatorConsumer` deployment).
4. `Pool`.
- **Accept:** all 8 test groups in `frd.md` §1.7 pass locally (`forge test` or the repo's runner); no compiler warnings that matter; gas report saved to `docs/gas.md`.

## T1.3 Deployment and seeding (1–1.5 h)
- Write `scripts/deploy-cleave.ts` and `scripts/seed.ts` per `frd.md` §1.8. Deployer key from `.env.deployer` (gitignored).
- Measure gas for every function on testnet (call `estimateGas`), fill `src/chain/gas.ts` with measured × 1.25.
- Write `deployments/monad-testnet.json` (addresses + deploy block).
- **Accept:** all contracts visible on the explorer; `Splitter.split(1e18)` and `merge` work from a script; pools hold seeded liquidity at ~6.00 and ~94.00 mUSD per leg; `forge`/script output saved to `docs/deploy-log.md`.

## T1.4 App skeleton on the new contracts (1.5 h)
- Add `src/chain/{clients,abis,addresses,quotes}.ts`; set all `VITE_*` vars locally and in Vercel (**then redeploy**).
- Implement the app shell, routes (Landing, Split, Trade, Dividends, Portfolio, Market, About, Judges) as empty pages with the top bar, SIMULATED pill, navigation (desktop tabs / mobile bottom bar) and design tokens from `ui_spec.md` §1–2. Load fonts.
- Replace the old test mint screen; keep the working Mera create/sign-in logic and move it to `src/wallet/mera.ts`.
- **Accept:** production URL loads the shell; signing in works; no console errors; Vercel shows the pushed commit.

## T1.5 `/api/drip` and `/api/dividend-feed` (1 h)
- Implement per `frd.md` §4. Create a separate drip wallet (new key), fund it with ~2.5 MON from the owner's faucet wallet(s), set `DRIP_PRIVATE_KEY` in Vercel (Production only). **Never commit it.**
- **Accept:** `curl /api/dividend-feed` returns valid JSON with a monotonically increasing `seq` across 10-minute windows; `POST /api/drip` to a fresh address sends 0.25 MON and a second call returns `skipped`.

## T1.6 Time-to-first-tx instrumentation (20 min)
- Add the timer from first landing interaction to first confirmed tx, and the per-tx "Confirmed in X.X s" chip utility (used everywhere later).
- **Accept:** badge appears once after the first confirmed transaction.

### Milestone 1 exit checklist
- [ ] Contracts deployed, tested, seeded, documented in `deployments/monad-testnet.json`
- [ ] Production app shell live with working sign-in and stateless test passing
- [ ] `/api/drip` and `/api/dividend-feed` working
- [ ] Everything pushed; Vercel serving the latest commit; no secrets in git
