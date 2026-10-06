# Cleave — UI/UX Specification

Audience: a coding agent that cannot see a mockup. Everything needed is described here. Rubric reminder: Design & Craft = "a trading experience a trader would trust with capital": clear pricing, clear risk, no mystery states, plus an invisible-blockchain feel for onboarding (no "wallet", "seed phrase", "gas" jargon in primary flows).

## 1. Design language
**Feel:** a calm, precise trading instrument. Dark, quiet, typographic. The brand idea is the **cleave**: one thing divides cleanly into two. Every screen reinforces two colours for two legs.

**Colours (CSS variables):**
`--bg:#0A0B0E` page · `--surface:#12141A` cards · `--surface-2:#1A1D26` inputs/hover · `--border:#262A36` hairlines (1px) · `--text:#ECEEF3` · `--muted:#8A90A2` · `--price:#5B8CFF` (Price leg, blue) · `--div:#FFB547` (Dividend leg, amber) · `--pos:#3DDC97` · `--neg:#FF6B6B` · `--warn-bg:rgba(245,196,81,.12)` · `--focus:#8FB3FF`.
Rule: **blue always means Price leg, amber always means Dividend leg, white means the whole stock.** Never use these colours for anything else. Green/red only for gains/losses and success/error.

**Typography (Google Fonts):** UI = Manrope (400/500/600/700). Numbers, addresses, prices = IBM Plex Mono with `font-variant-numeric: tabular-nums`. Scale: 12 / 14 / 16 / 20 / 28 / 40. Headlines 700, tight letter-spacing (−0.02em). Body 14–16.

**Shape & space:** 8px grid. Cards radius 16, inputs/buttons radius 12, chips radius 999. Borders 1px `--border`, almost no shadows. Max content width 1120px desktop. Generous padding (24 on desktop, 16 on mobile).

**Signature elements:**
1. **The split line:** a 1px vertical hairline with a faint gradient (blue top → amber bottom) used in the logo, the Split card divider and the primary Split button.
2. **Split animation (450ms ease-out):** on a successful split the stock card divides down the middle; the left half turns blue and slides left while the right half turns amber and slides right, becoming the two leg cards. Reverse for merge. Disabled when `prefers-reduced-motion`.
3. **Two-tone button:** the primary "Split" button is dark with a centred 1px split line and the left label zone tinted blue 8%, right zone amber 8%.
4. **Number motion:** balances/prices count up/down over 250ms; never flicker; keep width stable (tabular numerals).
5. **Confirmation chip:** after every transaction a chip "⚡ Confirmed in 0.9 s" (green dot, mono text) with an explorer link icon.

**Voice:** plain, confident, no crypto slang in primary flows. Say "account", "sign in", "network fee". Say "gas" only in tooltips. Never say "wallet", "seed phrase", "connect", "bridge".

**Logo (deliverable):** a rounded square (radius 22%) on `--bg`; inside, a bold lowercase "c" shape cut by a vertical gap; left part `--price` blue, right part `--div` amber. Export SVG + 512×512 PNG (<3MB) + favicon. Wordmark "cleave" in Manrope 700.

## 2. App shell
- **Top bar (sticky, 64px, `--bg` with bottom hairline):** left: logo + wordmark. Centre/right: **SIMULATED · MONAD TESTNET** pill (amber outline, 11px caps, always visible, tooltip: "Mock tokens only. No real money, no real equity."). Far right: account chip (see §10) or "Sign in" button.
- **Navigation:** desktop = horizontal tabs under the top bar: **Split · Trade · Dividends · Portfolio · Market**; "About & risks" in the footer. Mobile (<768px) = fixed bottom tab bar with icons + labels (5 items), top bar slimmed to logo + chip.
- **Footer (desktop):** "Cleave is a hackathon demo on Monad Testnet. About & risks · Judges · GitHub".
- **Global toast area:** bottom-right desktop, top on mobile. Toasts: success (green dot), error (red dot), info. Auto-dismiss 6s except errors with actions.
- **Global status strip (only when needed):** amber banner under top bar: "Live data delayed — showing last known values." when RPC/Envio fails.
- Signed-out users can browse Market, About, Judges. Other tabs show a centred sign-in prompt.

## 3. Screen: Landing (signed out, route `/`)
Layout: two columns desktop (copy left, interactive preview right), stacked on mobile.
- **Eyebrow:** "SIMULATED · MONAD TESTNET" chip.
- **Headline (40px):** "Split a stock into its dividends and its price."
- **Subhead (16px, muted):** "Cleave separates a tokenized stock into two pieces you can trade on their own: the dividend stream and the price exposure. Settled in under a second."
- **Primary CTA:** full-width on mobile, 56px: "Create your account" with a small fingerprint icon; below it micro-text: "One tap. Your device's passkey is your account — no seed phrase, no extension."
- **Secondary:** text button "I already have an account — Sign in".
- **Right side preview card (non-interactive animation, loops every 6s):** a card "mACME · $100.00" divides into "Price leg $94.00" (blue) and "Dividend leg $6.00" (amber) with the split line. Caption: "1 stock = 1 price leg + 1 dividend leg. Always."
- **Below fold (3 cards in a row):** (1) "Hold only what you want" — income without price risk, or price without waiting for dividends; (2) "Know exactly what you pay" — fair value, price impact and fees shown before you confirm; (3) "Built on Monad" — 400ms blocks, ~800ms finality, no pending states.
- **Judge strip (subtle, bottom):** "Judging this? Open the 2-minute walkthrough →" linking `/judges`.
- Timer starts on first interaction on this screen for the time-to-first-tx badge.

## 4. Onboarding flow (invisible blockchain)
1. Click "Create your account" → browser passkey dialog (one prompt; if the authenticator forces a second, show our own inline text "One more tap to finish" between them).
2. While waiting: button shows spinner + "Creating your account…" (never "generating keys").
3. Success: full-screen overlay 1.2s: checkmark + "You're in." then route to **Split** with the **Starter pack** panel open (§5.1).
4. If creation is cancelled: inline message "No problem — nothing was created. Try again when you're ready."
5. Sign in: "Sign in" → passkey picker → same account. If the user picks the wrong passkey (different address) nothing breaks; they see a different (probably empty) account. Show a small hint in the account menu: "Not your account? Lock and sign in again."
6. **First-run time budget:** landing → account ≤ 10 s; account → first confirmed transaction ≤ 30 s.

## 5. Screen: Split (route `/split`)
**Purpose:** convert stock into two legs, or merge them back.
**Layout desktop:** two columns. Left (60%): main card. Right (40%): "How it works" + "Series details" + risk box. Mobile: stacked, main card first.

### 5.1 Starter pack panel (shown while balances are empty or `localStorage`-free flag cannot be used — determine from chain balances only)
Card at the top with 3 checklist steps and a progress ring:
1. **"Get network fee credit"** — button "Add fee credit" → `POST /api/drip`. Success: "0.25 MON added". If skipped (balance already ok) the step auto-ticks.
2. **"Get 1,000 mACME"** — button "Get mACME" → `mACME.faucet()`.
3. **"Get 10,000 mUSD"** — button "Get mUSD" → `mUSD.faucet()`.
Each step shows a tiny spinner then ✓ with the confirmation chip. When all done: panel collapses to a one-line "Starter pack claimed ✓". Include explainer: "Test tokens only. They have no value." On first ever confirmed transaction show the **"⚡ First transaction in X s"** badge (once).

### 5.2 Main card (tabs: **Split** | **Merge**)
**Split tab**
- Header row: "You hold" + stock balance (mono) + "Max" link.
- Input block (large, 28px mono): amount of **mACME** with a stock icon, inline "≈ $X.XX" (balance × refPrice).
- A thin vertical **split line** descends from the input into two output cards side by side:
  - **Price leg (blue card):** title "Price leg", ticker pACME-A, "You receive **100**", fair value line "Fair value ≈ $94.00 each", one-sentence explainer: "The stock's ups and downs. Redeem for the stock at maturity."
  - **Dividend leg (amber card):** title "Dividend leg", ticker dACME-A, "You receive **100**", fair value "≈ $6.00 each (6 dividends left × ~$1.00)", explainer: "Every dividend paid until maturity, in mUSD."
- **Primary button** (two-tone): "Split 100 mACME". States: disabled (no amount / exceeds balance: label "Not enough mACME"), loading ("Confirming…" with the live ms counter), success (triggers split animation and chip).
- **First split needs approval:** do it silently as part of the same action sequence (two transactions, one user gesture, one progress stepper: "1 Approve → 2 Split"), prompt-free within the session.
- After success: below the cards a "What next?" row with two links: "Trade your legs →" and "See dividends →".

**Merge tab**
- Input: amount of legs to merge (max = min(price leg balance, dividend leg balance)).
- Show two input chips (blue and amber, balances) merging into one white stock card "You receive 100 mACME". Button "Merge 100 legs". Note: "Unclaimed dividends stay claimable after you merge."
- Disabled with explanation after maturity: "Series has matured. Redeem Price legs for stock instead." and show **Redeem** button (calls `redeem`).

### 5.3 Right column
- **How it works:** 3-step vertical diagram: (1) Deposit stock → (2) Receive two legs → (3) Trade, hold or merge back. Include a mini formula "1 pACME-A + 1 dACME-A = 1 mACME".
- **Series A details:** Matures (date + countdown), Dividends planned 6 · paid X · remaining Y, Last declared dividend $/share, Reference price $.
- **Risk box (amber outline, always visible):** "Before you split — Dividend legs are worth nothing after maturity. Legs can trade below fair value and you may lose value. This is a demo with mock assets." with link "More in About & risks".

## 6. Screen: Trade (route `/trade/:leg`, default `dividend`)
**Header:** segmented control **[Dividend leg (amber)] [Price leg (blue)]** with the tickers, plus live pill: price (mono, 20px), 24h change chip (green/red), 24h volume (simulated included, see label).
**Layout desktop:** chart left (65%), order ticket right (35%); trades feed under the chart; Mobile: price header → chart (220px) → ticket → feed.

### 6.1 Chart
Recharts area/line chart of pool price from Envio `PoolHourly.close` (hourly) with a toggle "Trades" (line from `Swap.price`, last 200). Y-axis mono. Hover tooltip shows time + price. **Fair value dotted line** (leg colour at 60%). **Ex-dividend markers:** small amber vertical ticks on the x-axis at each distributed dividend with tooltip "Dividend paid $1.05/share". Empty state: "No trades yet — be the first." with the ticket highlighted.

### 6.2 Key stats row (4 tiles)
- **Fair value** (with tooltip formula: Dividend leg = remaining dividends × latest declared amount; Price leg = reference price − dividend fair value).
- **Pool price vs fair value** chip: "−4.2% · cheap" (green) or "+3.1% · rich" (red) or "In line" (grey, within ±1%).
- **Liquidity** (pool mUSD reserve ×2).
- **Implied yield (Dividend leg only)** = (remaining dividends × latest amount) / price, labelled "Remaining dividends ÷ price (not annualised)". For Price leg show "Accretes to $X as dividends are paid".

### 6.3 Order ticket
- Tabs **Buy | Sell**. Pair label "mUSD → dACME-A".
- **You pay** input (mono, with balance + Max), **You receive** read-only (updates live, debounce 200ms via `getAmountOut`).
- Detail rows (14px, muted labels): Price (mUSD per leg) · **Price impact** (% — turns amber >2%, red >5%) · Fee (0.30%) · **Minimum received** (after slippage) · Network fee "paid from your fee credit".
- **Slippage chips:** 0.5% · 1% · custom (stored in localStorage; allowed).
- **Button:** leg-coloured "Buy dividend leg" / "Sell price leg". Disabled states with reasons: "Enter an amount", "Not enough mUSD", "Price impact too high" (>10% requires ticking "I understand the price impact").
- Under the button: one-line risk disclosure: "Prices come from an on-chain pool and can move before your trade confirms. Mock assets, testnet."
- After confirm: success chip "⚡ Bought 12.3 dACME-A · Confirmed in 0.8 s".
- If the order exceeds the session cap: modal "This trade is above your session limit (5,000 mUSD). Confirm with your passkey." → one prompt → proceeds.

### 6.4 Recent trades (table, 20 rows, live-updating every 3s)
Columns: Time (relative), Side (Buy green / Sell red), Size (leg), Price, Trader (short address, mono). Rows from known bot wallets get a small grey **SIM** tag with tooltip "Simulated test wallet". Your own trades highlighted with a subtle blue/amber left border.

### 6.5 Liquidity (collapsed accordion "Provide liquidity")
Two inputs (leg, mUSD) + "Add liquidity" and a "Your pool share" readout with "Remove". Low priority; script seeds liquidity.

## 7. Screen: Dividends (route `/dividends`)
**Purpose:** make dividends tangible; this is the demo's centrepiece.
- **Top summary card (amber accent):** "Your dividend legs have earned **$X.XX mUSD**" (big mono) + **Claim** button (disabled at 0 with "Nothing to claim yet"); beneath: "Dividend leg balance: N dACME-A".
- **Next dividend panel (large):** shows the latest declaration state machine:
  - *None pending:* "No dividend declared. The next one arrives via the Chainlink feed." with buttons: **Declare dividend (demo)** (outlined, tooltip "Demo trigger — in production this comes from the Chainlink CRE workflow. Limited to once every 2 minutes.") and a disabled-looking info line "Or run the CRE workflow (see Judges page)".
  - *Declared (countdown):* big countdown ring "Ex-dividend in 00:42", the amount "$1.05 per share", source badge (**Chainlink CRE** in blue-purple outline with tx link, or **Demo trigger** in grey), and a note "Hold the dividend leg before the countdown ends to receive this dividend."
  - *Ready to pay:* ring complete, button **Pay dividend** (anyone can press; tooltip "Distributes to everyone holding the dividend leg right now").
  - *Paid:* success state with "Paid $X to N dividend legs" and the confetti-free subtle amber pulse; the **price chart link** "See the repricing on Trade →".
- **Timeline list (from Envio):** each declaration as a row: #, amount per share, source badge, declared time, status chip (Declared / Paid), total paid, "supply at payout", explorer links.
- **Education footer:** "Why dividend legs reprice at ex-dividend time" — 2 sentences.

## 8. Screen: Portfolio (route `/portfolio`)
- **Header card:** Total value in mUSD (sum of balances at pool prices; stock at refPrice), with "Includes unclaimed dividends".
- **Holdings table:** rows mACME, pACME-A (blue dot), dACME-A (amber dot), mUSD, MON (labelled "Fee credit"). Columns: Asset, Balance, Price (mUSD), Value. Mono numbers, right-aligned.
- **Unclaimed dividends** row with inline Claim button.
- **Liquidity positions** (if any).
- **History (from Envio):** tabs All · Splits · Trades · Dividends; each entry with time, description ("Split 100 mACME", "Bought 12.3 dACME-A for 74.0 mUSD", "Claimed 63.0 mUSD"), explorer link. Empty state with CTA to Split.
- **Session & account block:** address (copy), "Sign in works anywhere with your passkey" explainer, Lock button.

## 9. Screen: Market (route `/market`, public)
Purpose: honest traction evidence.
- **Stat tiles (from `ProtocolStats`):** Total split, Net stock locked, Total volume, **Simulated volume vs Organic volume** (two numbers with a stacked bar), Unique accounts (and "of which outside our test wallets"), Dividends paid (count + $).
- **Banner:** "Volume labelled SIM comes from our own test wallets on Monad Testnet. Everything here is testnet data."
- **Charts:** volume per hour (stacked simulated/organic bars), dividend leg price line, price leg price line.
- **Activity feed:** latest 30 events across splits, merges, trades, dividends (icons, SIM tags).
- **Pools table:** both pools with liquidity, price, volume, trades.

## 10. Account chip & Session sheet
- **Chip (top right):** short address (0x8114…B29b, mono), a tiny ring showing session time left, MON balance in a muted line ("0.84 fee credit"). Click opens the **Session sheet** (popover desktop, bottom sheet mobile).
- **Session sheet contents:**
  - Address with Copy and Explorer icons.
  - "Session active · expires in 12:34" with a progress bar.
  - "Spend limit: 1,240 / 5,000 mUSD used".
  - "This session can only sign actions on Cleave contracts. Sending anything elsewhere always asks for your passkey." (info icon)
  - Buttons: **Extend session** (one passkey prompt), **Lock now**.
  - Small link "Not your account? Lock and sign in again".
- **Expired state:** modal (non-dismissable if an action was pending): "Session expired — Continue" with a single button (passkey prompt) that restores the session and retries the pending action.
- **Reload behaviour:** after a page reload the user sees the Landing or a "Welcome back — Sign in" bar (one prompt). No local data is needed.

## 11. Screen: About & risks (route `/about`)
Sections: What Cleave does (diagram), How legs are priced (fair value formulas), What is simulated (assets, dividends, volume), Known limitations (distribution entitlement is by holders at the payout transaction; mock tokens; unaudited; one series), Built with (Mera, Chainlink CRE, Envio, Monad) with links, GitHub link.

## 12. Screen: Judges (route `/judges`, public, linked from landing and footer)
A one-page checklist so judges never get stuck:
1. Open the live app in desktop Chrome (Google Password Manager) or Safari/1Password.
2. "Create your account" → approve the passkey prompt (second prompt possible on some devices).
3. Claim the starter pack (3 taps). If fee credit fails, use faucet link.
4. Split 100 mACME → see two legs.
5. Trade: buy some dividend leg.
6. Dividends → "Declare dividend (demo)" → watch the countdown → "Pay dividend" → "Claim".
7. **Stateless test:** DevTools → Application → Clear site data (or open a fresh browser profile) → Sign in → same address and balances.
8. CRE: video link + how to run the simulation (`cre` command from repo `cre/README.md`).
9. Envio: GraphQL endpoint link + sample query.
10. Known issues (honest list).
Include contact line and links to the 3 videos.

## 13. Components catalogue (build once, reuse)
Button (primary/secondary/leg-coloured/two-tone), AmountInput (mono, max, balance), TokenChip (dot + ticker), LegCard (blue/amber), StatTile, Chip (status/SIM/source), ConfirmationChip, Toast, Modal/BottomSheet, Tooltip, Stepper (tx progress), CountdownRing, Table, Skeleton, EmptyState, Banner, CopyButton, ExplorerLink.

## 14. States every screen must handle
Loading (skeleton shimmer, never layout shift), empty (message + CTA), error (human text + retry), offline/RPC down (banner + last-known values), transaction pending (stepper with elapsed ms, button disabled), reverted (toast with mapped reason: "Price moved", "Not enough balance", "Dividend not ready yet", "Series matured", otherwise "Something went wrong — view details" with explorer link), session expired (§10).

## 15. Errors in plain language
- **No PRF / unsupported browser (full-screen on Landing CTA failure):** "Your browser can't create this kind of account yet. Try Chrome with Google Password Manager, Safari on iPhone/Mac, or a password manager like 1Password." with "Why?" expandable: "Cleave uses passkeys with an extra capability (PRF) that not every browser supports."
- **User cancelled passkey:** neutral, no red.
- **Fee credit empty:** "You're out of network fee credit." + "Add fee credit" button; if `/api/drip` skips: link to faucet.

## 16. Responsive & accessibility
- Breakpoints 360, 768, 1120. Touch targets ≥ 44px. Bottom tab bar on mobile with safe-area insets.
- Keyboard focus ring `--focus` 2px; labels on all inputs; colour is never the only signal (legs also have text labels and dot shapes: blue circle vs amber diamond).
- `prefers-reduced-motion`: disable split/count animations.
- Contrast ≥ 4.5:1 for body text.

## 17. Copy constants (use verbatim)
- Pill: "SIMULATED · MONAD TESTNET"
- Tooltip for pill: "Mock tokens only. No real money, no real equity."
- Price leg tagline: "The stock's ups and downs. Redeem for the stock at maturity."
- Dividend leg tagline: "Every dividend paid until maturity, in mUSD."
- Identity line: "1 stock = 1 price leg + 1 dividend leg. Always."
- Disclosure under order ticket: "Prices come from an on-chain pool and can move before your trade confirms. Mock assets, testnet."
- SIM tooltip: "Simulated test wallet"
