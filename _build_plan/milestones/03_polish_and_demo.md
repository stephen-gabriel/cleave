# Milestone 03 — Polish, QA and deliverables (target: Oct 12 – Oct 13 evening)

Hard stop for new features: **start of Oct 12**. After that only fixes, polish and deliverables. Same rules: commit and push every task.

## T3.1 UX polish (3 h)
- Split animation, number count-up, skeleton loaders, empty states, toasts and the confirmation chip everywhere (see `ui_spec.md` §1, §13–14).
- Mobile pass at 360 and 390 widths: bottom tab bar, ticket and chart layout, safe-area insets.
- Accessibility pass: focus rings, labels, reduced-motion, contrast.
- **Accept:** no layout shift on load; every async action shows pending, success and error states; keyboard-only can complete Split.

## T3.2 Edge cases and error handling (2 h)
Test and fix each row of `frd.md` §8 and the following: user cancels passkey; no PRF browser; out of fee credit (drip then fallback link); slippage exceeded; session expiry mid-action; RPC throttled (429) → backoff and banner; Envio down → banner and last known values; maturity passed (merge disabled, redeem shown); no dividends declared; zero balances.
- **Accept:** each case shows the specified plain-language message, never a raw error string.

## T3.3 Stateless test hardening (1 h) — non-negotiable
- With a fresh browser profile and phone: sign in, do a split, trade and claim; clear site data; sign in; verify identical address, balances, history and pending dividends (all chain/Envio-derived).
- Time landing → first confirmed tx on a fresh account; target ≤ 45 s with ≤ 2 prompts; record the number for the pitch.
- **Accept:** repeated 3 times in a row without differences.

## T3.4 Security and secrets sweep (45 min)
- Run `scripts/scan-secrets.sh`; grep history for keys; confirm `.env*` ignored; confirm Vercel secrets only in Production; drip wallet balance capped (~2.5 MON).
- Write the honest limitations list in `README.md` and `/about`.
- **Accept:** clean scan; no secret ever in git history (if found: rotate the key and note it).

## T3.5 README and repo (1.5 h) — use `submission_kit.md` §6 skeleton
Public GitHub repo; access granted to `metropolis@hackathon.monad.xyz`; README with overview, live URL, judge instructions, architecture diagram, contract addresses with explorer links, CRE/Envio sections (with how to run), simulated-data disclosure, team info, license.

## T3.6 Logo and visuals (45 min)
Create the logo per `ui_spec.md` §1 (SVG + 512×512 PNG <3MB + favicon). Add OG image for link previews.

## T3.7 Recording day (3–4 h total, do in this order)
1. **CRE video (≤2 min)** — if not already recorded in T2.1, re-record with the final contracts.
2. **Demo video (≤3 min, live product, no slides)** — follow `submission_kit.md` §2. Record at 1080p, clean browser profile, DevTools open to demonstrate the stateless test.
3. **Mera UX video (optional ≤2 min)** — onboarding speed, session sheet, stateless test.
4. **Envio video (optional ≤2 min)** — schema → handlers → GraphQL query → UI.
5. **Pitch video (≤2 min)** — follow `submission_kit.md` §3.
6. Optional 30 s ad if time remains.
Upload to YouTube (unlisted) or Loom; test each link while logged out.

## T3.8 Submission (1 h) — by Oct 13 evening
On hackathon.monad.xyz: confirm the project has the Finance track selected and the three bounties added (Mera UX, CRE, Envio); paste bounty descriptions from `submission_kit.md` §4; add logo, repo, live link, access instructions (`submission_kit.md` §5), demo/pitch/CRE/Mera/Envio video links. Re-open the submission after saving and test every link from a private window.

### Final exit checklist
- [ ] Live app works on a fresh profile and a phone (create account → first tx → split → trade → dividend → claim)
- [ ] Stateless test passes live
- [ ] CRE simulation video, demo video, pitch video uploaded and playable logged out
- [ ] Repo public, README complete, no secrets, access granted
- [ ] Envio endpoint public; Market page shows simulated vs organic volume honestly
- [ ] Submission saved before Oct 13 night (deadline Oct 14 04:59 GMT+1)
