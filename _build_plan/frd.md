# Cleave — Functional Requirements Document

All tokens use **18 decimals**. All amounts in UI shown with max 4 decimals (mUSD 2). Time uses `block.timestamp`.

## 1. Contracts

### 1.1 MockStock (mACME) — ERC20 (OpenZeppelin)
- name "Mock Acme Corp", symbol `mACME`.
- `faucet()` external: mints `1_000e18` to `msg.sender` (unlimited; testnet mock).
- `mint(address to, uint256 amount)` onlyOwner (seeding).
- Replaces the earlier MockStock test deployment (retire it).

### 1.2 MockUSD (mUSD) — ERC20
- name "Mock USD", symbol `mUSD`.
- `faucet()` external: mints `10_000e18` to `msg.sender`.
- `mint(address,uint256)` onlyOwner.
- `setMinter(address,bool)` onlyOwner; `mintTo(address to, uint256 amount)` callable by allowed minters only (the Splitter is the minter that pays mock dividends).

### 1.3 DividendOracle (CRE consumer)
Inherit the same Keystone `ReceiverTemplate` pattern as the working `CalculatorConsumer`; constructor takes the **same forwarder address** used for that deployment (Monad Testnet).
```
enum Source { CRE, DEMO }
struct Declaration {
  uint64 id;                // 1-based
  uint256 seq;              // feed sequence (CRE) or 0 (DEMO)
  uint256 amountPerShare;   // mUSD (1e18) per 1 mACME
  uint256 refPrice;         // reference mACME price in mUSD (1e18), display only
  uint64 declaredAt;
  uint64 exAt;              // declaredAt + NOTICE_SECONDS
  Source source;
}
uint64 public constant NOTICE_SECONDS = 60;
uint64 public constant DEMO_COOLDOWN = 120;
uint64 public count;  uint256 public lastSeq;  uint256 public lastRefPrice = 100e18;  uint64 public lastDemoAt;
mapping(uint64 => Declaration) internal _decl;
function get(uint64 id) external view returns (Declaration memory);
function latest() external view returns (Declaration memory);
// CRE path: report = abi.encode(uint256 seq, uint256 amountPerShare, uint256 refPrice)
function _processReport(bytes calldata report) internal override;  // require seq > lastSeq; bounds; Source.CRE
// Demo path (anyone, labelled in UI):
function declareDemo(uint256 amountPerShare) external;  // require now >= lastDemoAt + DEMO_COOLDOWN; Source.DEMO; uses lastRefPrice
event DividendDeclared(uint64 indexed id, uint256 seq, uint256 amountPerShare, uint256 refPrice, uint64 exAt, uint8 source);
```
Bounds on both paths: `0.01e18 <= amountPerShare <= 5e18`; `1e18 <= refPrice <= 10_000e18`. CRE path updates `lastRefPrice`.

### 1.4 SplitToken — ERC20 used for both legs (two instances), deployed by the Splitter
- `mint/burn` only by Splitter (owner).
- **Price leg:** plain ERC20 (`pACME-A`).
- **Dividend leg (`dACME-A`)** additionally has the dividend accumulator (flag `isDividendLeg`):
```
uint256 constant SCALE = 1e36;
uint256 public accPerToken;
mapping(address=>uint256) public paid;    // accPerToken at last settle
mapping(address=>uint256) public owed;    // settled but unclaimed mUSD
function _update(address from,address to,uint256 v) internal override { _settle(from); _settle(to); super._update(from,to,v); }
function _settle(address a) internal { if(a==address(0)) return; owed[a] += balanceOf(a)*(accPerToken-paid[a])/SCALE; paid[a]=accPerToken; }
function notifyDividend(uint256 total) external onlySplitter { accPerToken += total*SCALE/totalSupply(); }   // only if totalSupply>0
function pending(address a) public view returns (uint256) { return owed[a] + balanceOf(a)*(accPerToken-paid[a])/SCALE; }
function claim() external { _settle(msg.sender); uint256 o=owed[msg.sender]; owed[msg.sender]=0; mUSD.transfer(msg.sender,o); emit Claimed(msg.sender,o); }
event Claimed(address indexed account, uint256 amount);
```
Invariant: claims never exceed mUSD minted via `notifyDividend`; merge never forfeits unclaimed dividends (settle happens before burn).

### 1.5 Splitter (Series A)
Constructor: `(IERC20 stock, MockUSD usd, DividendOracle oracle, uint64 maturity, uint8 plannedDividends=6)`; deploys `priceLeg` ("Cleave Price Leg ACME-A","pACME-A") and `divLeg` ("Cleave Dividend Leg ACME-A","dACME-A").
```
function split(uint256 amount) external;   // before maturity; pull stock; mint equal pACME-A and dACME-A to caller
function merge(uint256 amount) external;   // before maturity; burn equal legs from caller; return stock
function redeem(uint256 amount) external;  // at/after maturity; burn price leg; return stock (dividend leg expires worthless)
function distribute() external;            // pays NEXT undistributed declaration
uint64 public nextDistributionId = 1;
```
`distribute()`:
1. `id = nextDistributionId`; require `id <= oracle.count()`.
2. `d = oracle.get(id)`; require `block.timestamp >= d.exAt` and `block.timestamp < maturity`.
3. `locked = divLeg.totalSupply()`; `total = d.amountPerShare * locked / 1e18`.
4. If `locked > 0`: `usd.mintTo(address(divLeg), total); divLeg.notifyDividend(total);`
5. `nextDistributionId++`; emit `DividendDistributed(id, total, locked, msg.sender)`.
Events: `Split(address indexed user,uint256 amount)`, `Merge(address indexed user,uint256 amount)`, `Redeem(address indexed user,uint256 amount)`, `DividendDistributed(uint64 indexed id,uint256 total,uint256 supply,address caller)`.
Views: `maturity()`, `plannedDividends()`, `distributedCount()` (= nextDistributionId-1), `remainingDividends()` (= plannedDividends − distributedCount, floor 0).
Known limitation (document, do not fix): entitlement = holders at the `distribute()` transaction.
Reentrancy guard on split/merge/redeem. Use SafeERC20.

### 1.6 Pool (CPMM, one per leg), constructor `(IERC20 token, IERC20 quote, uint16 feeBps=30)`
```
reserveToken, reserveQuote, totalShares, mapping shares
function addLiquidity(uint256 tokenAmt,uint256 quoteAmt,uint256 minShares) external returns (uint256 sh);
function removeLiquidity(uint256 sh,uint256 minToken,uint256 minQuote) external returns (uint256,uint256);
function getAmountOut(bool tokenIn,uint256 amountIn) public view returns (uint256 out, uint256 fee, uint256 priceImpactBps);
function swapExactIn(bool tokenIn,uint256 amountIn,uint256 minOut) external returns (uint256 out);
event Swap(address indexed trader,bool isBuy,uint256 amountToken,uint256 amountQuote,uint256 fee,uint256 reserveToken,uint256 reserveQuote);
event LiquidityChanged(address indexed provider,bool added,uint256 tokenAmt,uint256 quoteAmt,uint256 shares,uint256 reserveToken,uint256 reserveQuote);
```
`isBuy = true` means trader sold quote (mUSD) and received the leg token. Constant-product with fee taken on input. First deposit: `shares = sqrt(t*q)`, lock `1000` wei shares. Reentrancy guard. Post-swap reserves are in the event so the indexer never needs RPC calls.

### 1.7 Required Foundry/Hardhat tests (all must pass)
1. split→merge round trip returns exact stock; legs burned.
2. dividend accumulator: A splits 100, transfers 40 dACME to B, distribution of $1/share pays A 60 and B 40; claim pays exactly and only once.
3. transfer between two distributions: entitlements follow holdings at each distribution.
4. merge before claim keeps unclaimed dividends claimable.
5. `distribute()` reverts before `exAt`, after `maturity`, out of order, and when no declaration exists.
6. oracle: CRE path rejects `seq <= lastSeq`, bad bounds and non-forwarder callers; demo path enforces cooldown and bounds.
7. redeem before maturity reverts; after maturity returns stock.
8. pool: k never decreases after swaps; `getAmountOut` equals executed output; slippage `minOut` enforced; add/remove liquidity round trip within rounding.

### 1.8 Deployment script (`scripts/deploy-cleave.ts`) and seeding (`scripts/seed.ts`)
Deploy: mACME, mUSD, DividendOracle(forwarder), Splitter(maturity = now+120d), 2 Pools; set Splitter as mUSD minter; write addresses + deployment block to `deployments/monad-testnet.json` (committed, public) and mirror into `.env`/Vercel `VITE_*` vars. Seed (owner-mint, free on testnet): mint `10_000` mACME and `600_000` mUSD to the deployer; split `10_000` mACME; reference price 100, so fair dividend leg ≈ 6.00 mUSD (6 planned dividends × ~1.00) and fair price leg ≈ 94.00 mUSD. Create initial liquidity: dividend pool `5_000 dACME : 30_000 mUSD` (price 6.00) and price pool `5_000 pACME : 470_000 mUSD` (price 94.00). Keep the remaining `5_000` of each leg for bot funding. Declare no dividend at seed.

## 2. Gas (Monad charges the declared limit)
Initial limits (MEASURE with estimateGas on testnet, then use measured × 1.25, store in `src/chain/gas.ts`): approve 60k, faucet 90k, split 250k, merge 250k, swap 230k, addLiquidity 260k, removeLiquidity 230k, claim 150k, distribute 250k, declareDemo 160k, native transfer 21k. Max fee per gas: read from the chain (`getGasPrice`) × 1.2, never a hard-coded value that makes `gasLimit × maxFee` exceed balance; if balance is short, show "Get gas" CTA (calls `/api/drip`).

## 3. Mera account layer and session policy
- **Create account:** `createPasskeyWithPrfOutput` (one prompt; some authenticators show a second fallback prompt: note in Judges page). Derive EVM key at `m/44'/60'/0'/0/0` from the PRF output via BIP-39/BIP-32 (as in Mera getting-started), `createSecp256k1SigningSession`, `toViemAccount` from `@category-labs/mera/viem`.
- **Sign in:** `getPasskeyPrfOutput({ rpId })` with NO stored credential (browser offers discoverable passkeys). rpId = `location.hostname`. Storing the credential ID is allowed only as an optional hint; correctness must never depend on it.
- **Stateless rule:** no identity or balances in browser storage. UI preferences (slippage) may use localStorage but must default sensibly when empty.
- **Session policy (app-layer; first check Mera docs for native scoping and use it if present):**
  - Expiry 15 minutes from sign-in; countdown visible; auto-lock at expiry (`session.end()`), zero key in memory.
  - Prompt-free: any transaction whose `to` is in the allowlist {mACME, mUSD, Splitter, priceLeg, divLeg, Pool×2, DividendOracle} **and** whose cumulative mUSD-value this session ≤ **5,000 mUSD** (value = mUSD amounts in swaps/liquidity + stock amounts × latest refPrice).
  - Re-prompt (new passkey assertion) for: any native MON transfer, any token transfer to a non-allowlisted address, any action beyond the cap, "Extend session".
  - UI shows session state, spent/limit, Lock now, Extend.
- **Time-to-first-tx badge:** measure from first user interaction on landing to first confirmed tx; show once as "⚡ First transaction in 14.2 s" and after every tx show "Confirmed in X.X s".

## 4. Serverless APIs (`/api`, Vercel)
### 4.1 `POST /api/drip` body `{address}`
- Validate address; read balance via RPC; if `< 0.05 MON` and drip wallet balance ≥ 0.5 MON, send **0.25 MON** from `DRIP_PRIVATE_KEY` (Vercel env only); respond `{status:"sent",txHash}`; else `{status:"skipped",reason}`. Per-IP soft rate limit (in-memory) 3/hour. This is a faucet, not an account custody backend; never holds user keys.
### 4.2 `GET /api/dividend-feed`
Deterministic simulated feed (labelled): `window = floor(now / 600s)`; `seq = window - SERIES_START_WINDOW + 1` (constant at deploy). `amountPerShare` cycles `[1.00,1.00,1.05,1.05,1.10,1.10]` (mUSD); `refPrice` = 100 + deterministic pseudo-random walk seeded by `seq` (bounded 85–130). Response:
```
{ "symbol":"mACME","seq":123,"amountPerShare":"1.05","refPrice":"101.37","currency":"mUSD","source":"simulated","asOf":"ISO-8601" }
```
CORS enabled, cache `no-store`.

## 5. CRE workflow (`cre/`)
Language: same as the completed tutorial. Trigger: cron (every 10 min, irrelevant for simulation) — for the recording run the CLI simulation with broadcast exactly as in tutorial Part 4.
Steps: (1) HTTP GET `/api/dividend-feed`; (2) EVM read `DividendOracle.lastSeq()`; (3) if `feed.seq <= lastSeq` log "no new declaration" and exit; (4) ABI-encode `(uint256 seq,uint256 amountPerShare,uint256 refPrice)` (1e18 scaled); (5) generate report; (6) write via forwarder to `DividendOracle` on Monad Testnet. Config holds oracle address, feed URL, chain selector for Monad Testnet. Record: terminal run + explorer tx + UI showing the new declaration with the **Chainlink CRE** badge.

## 6. Envio indexer (`indexer/`)
Network Monad Testnet (10143), `start_block` = deployment block. Contracts: DividendOracle (`DividendDeclared`), Splitter (`Split`,`Merge`,`Redeem`,`DividendDistributed`), SplitToken for dividend leg (`Claimed`; also `Transfer` not needed), Pool×2 (`Swap`,`LiquidityChanged`). Simulated-wallet flag: handlers read `config/sim-wallets.json` (addresses only, committed) → `isSimulated`.
### schema.graphql
```
type Account { id: ID! firstSeenAt: Int! isSimulated: Boolean! splitVolume: BigInt! tradeVolumeUsd: BigInt! tradeCount: Int! dividendsClaimed: BigInt! }
type Pool { id: ID! kind: String! reserveToken: BigInt! reserveQuote: BigInt! lastPrice: BigDecimal! volumeUsd: BigInt! tradeCount: Int! }
type Swap { id: ID! pool: Pool! trader: String! isBuy: Boolean! amountToken: BigInt! amountQuote: BigInt! price: BigDecimal! timestamp: Int! isSimulated: Boolean! txHash: String! }
type PoolHourly { id: ID! pool: Pool! hour: Int! open: BigDecimal! high: BigDecimal! low: BigDecimal! close: BigDecimal! volumeUsd: BigInt! trades: Int! }
type SplitEvent { id: ID! user: String! amount: BigInt! isMerge: Boolean! timestamp: Int! isSimulated: Boolean! txHash: String! }
type DividendDeclaration { id: ID! seq: BigInt! amountPerShare: BigInt! refPrice: BigInt! exAt: Int! declaredAt: Int! source: String! txHash: String! distributed: Boolean! distributedAt: Int totalPaid: BigInt supplyAtDistribution: BigInt }
type DividendClaim { id: ID! account: String! amount: BigInt! timestamp: Int! txHash: String! }
type LiquidityEvent { id: ID! pool: Pool! provider: String! added: Boolean! tokenAmt: BigInt! quoteAmt: BigInt! timestamp: Int! }
type ProtocolStats { id: ID! totalSplit: BigInt! totalMerged: BigInt! tradeCount: Int! volumeUsd: BigInt! simulatedVolumeUsd: BigInt! organicVolumeUsd: BigInt! uniqueAccounts: Int! organicAccounts: Int! dividendsDeclared: Int! dividendsDistributed: Int! dividendsPaidUsd: BigInt! }
```
Handlers: price = `reserveQuote/reserveToken` after swap (BigDecimal); upsert `PoolHourly` by `floor(timestamp/3600)`; upsert `Account`; update `ProtocolStats` (id `"global"`) including simulated vs organic split; set `DividendDeclaration.distributed` on `DividendDistributed` (matched by id). Deploy to **Envio Cloud free tier** with public repo containing `config.yaml`, `schema.graphql`, handlers. GraphQL endpoint must be publicly queryable; store in `VITE_ENVIO_GRAPHQL_URL`.
Frontend uses Envio for: charts, trades feed, activity feed, dividends timeline, Market stats, portfolio history. Balances, allowances, pending dividends, countdowns use viem multicall.

## 7. Bot (`scripts/bot.ts`, runs locally, not in prod)
- 8 wallets generated once, keys in `.env.bot` (gitignored), funded with MON from the deployer; public addresses in `config/sim-wallets.json`.
- Each wallet gets mACME/mUSD from faucets, splits some stock, then loops every 3–8 s: random action weighted: buy/sell dividend leg (40%), buy/sell price leg (40%), split/merge (10%), claim (5%), `distribute()` if due (5%). Trade size lognormal (median 50 mUSD, cap 500). Bias: buy when pool price < fair value, sell when > fair value (fair values per UI spec).
- CLI flags: `--burst N` (execute N trades quickly) and `--minutes M`. Logs tx hashes.
- Purpose: honest simulated volume, labelled "SIM" in UI.

## 8. Error handling matrix
| Situation | Behaviour |
|---|---|
| No PRF support | Full-screen friendly guidance (see UI spec §Errors) |
| Insufficient MON | Inline "Get gas" → `/api/drip`; fallback link to faucet |
| Slippage exceeded | Toast "Price moved. Try again" + refreshed quote |
| Session expired | Modal "Continue" (one prompt) and retry the pending action |
| RPC/Envio down | Banner "Live data delayed", UI falls back to last known values; never fabricate data |
| Reverted tx | Toast with human reason map + explorer link |
