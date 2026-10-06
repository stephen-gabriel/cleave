# Milestone 02 — Key features (target: finish by Oct 11)

Agent: same rules as Milestone 01. Commit and push at the end of every task. `ui_spec.md` is the single source for how screens look and read; `frd.md` for behaviour.

## T2.1 CRE dividend workflow (2–3 h) — start here, it is the riskiest bounty piece
- Build `cre/` from the completed tutorial (same language/tooling). Replace the calculator logic with `frd.md` §5: HTTP GET `/api/dividend-feed` → read `DividendOracle.lastSeq()` → skip if not newer → encode `(seq, amountPerShare, refPrice)` → report → write via forwarder to the deployed `DividendOracle` on Monad Testnet.
- Config: oracle address (from `deployments/monad-testnet.json`), production feed URL, Monad Testnet chain selector and the same forwarder as the tutorial.
- Add `cre/README.md` with the exact commands to simulate with broadcast and what output to expect.
- **Accept:** simulation with broadcast succeeds; explorer shows the tx; `DividendOracle.count()` increments and `latest().source == CRE`; running it again immediately prints "no new declaration" and writes nothing. **Record the 2-minute CRE video now** (see `submission_kit.md`) while it works.

## T2.2 Envio indexer (2–3 h)
- Create `indexer/` with `config.yaml`, `schema.graphql` (from `frd.md` §6), handlers. `start_block` = deploy block. Add `config/sim-wallets.json` usage.
- Run locally once (Docker) to verify handlers, then deploy to Envio Cloud (free tier). Make sure the GraphQL endpoint is **publicly queryable without login**; set `VITE_ENVIO_GRAPHQL_URL`, redeploy Vercel.
- Write `src/data/envio.ts` with typed queries: recent swaps by pool, `PoolHourly` series, declarations list, protocol stats, account history, activity feed. One shared polling hook (3 s) with backoff.
- **Accept:** after one split, one swap, one declaration and one distribution (script or UI), each shows up in GraphQL within ~10 s; `ProtocolStats` totals are correct; `isSimulated` splits volume correctly once bot wallets exist.

## T2.3 Split / Merge / Redeem screen (2 h)
- Implement `ui_spec.md` §5 incl. Starter pack panel, silent approve+split stepper, split animation, merge tab, matured state.
- **Accept:** from a fresh passkey account: drip → faucets → split 100 → balances read from chain show 100 pACME-A and 100 dACME-A; merge returns stock; clearing site data then signing in shows the same balances.

## T2.4 Trade screen (3 h)
- Implement `ui_spec.md` §6: leg toggle, chart (Envio), stats tiles with fair value formulas, order ticket (quote via `getAmountOut`, price impact, slippage, min received), trades feed with SIM tags, liquidity accordion (can be last).
- Fair value: Dividend leg = `remainingDividends × latest.amountPerShare`; Price leg = `latest.refPrice − dividendFair`. If no declaration yet, use the seeded defaults (1.00 and 100.00) and label "Estimated".
- **Accept:** buy and sell on both pools work with correct output and min-out; price impact displayed; chart updates after a trade; pool price vs fair value chip behaves; a >5,000 mUSD-value action triggers the session re-prompt modal.

## T2.5 Dividends screen (2 h)
- Implement `ui_spec.md` §7 state machine: none → declared (countdown to `exAt`) → ready (Pay dividend → `Splitter.distribute()`) → paid → claim. Demo trigger button uses `declareDemo` with the cooldown shown. Source badges (CRE/Demo) from the oracle event. Timeline from Envio.
- **Accept:** full loop works: declare (demo or CRE) → countdown → pay → claimable updates for holders proportionally → claim pays exactly; two accounts holding different amounts get proportional dividends (verify with two passkeys or bot wallet).

## T2.6 Mera session policy UI (1.5 h)
- Implement `frd.md` §3: 15-minute expiry with countdown, allowlist, 5,000 mUSD-value cap, re-prompt flows, Session sheet (`ui_spec.md` §10), expired modal that retries the pending action. First read `mera.category.xyz/concepts/signing-sessions` and use native scoping if available; record the choice in `docs/decisions.md`.
- **Accept:** actions inside policy sign with no prompt; native MON transfer or over-cap action prompts; expiry locks the session and the modal restores it with one prompt.

## T2.7 Portfolio and Market screens (2 h)
- Implement `ui_spec.md` §8–9 from chain + Envio. Market page shows simulated vs organic split honestly.
- **Accept:** numbers match explorer/GraphQL; empty states work for a brand-new account.

## T2.8 Bot and simulated volume (1.5 h)
- Implement `frd.md` §7. Generate wallets, fund with MON, write `config/sim-wallets.json`. Run `--burst 300`, then a 20-minute run. If time allows, ask up to ~3 friends to try the live app (optional bonus, not a dependency).
- **Accept:** ≥ 300 simulated trades and ≥ 20 splits visible on the Market page, labelled SIM; no failed-tx spam (bot backs off on errors).

### Milestone 2 exit checklist
- [ ] CRE simulation recorded, declaration visible in UI with CRE badge
- [ ] Envio live and driving charts/feeds/stats
- [ ] Split → Trade → Dividend → Claim loop works for a fresh account end to end
- [ ] Session policy and stateless test both demonstrable
- [ ] Pushed; Vercel serving latest; no secrets in git
