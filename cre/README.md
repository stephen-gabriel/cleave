# Cleave CRE dividend workflow (`cre/`)

Chainlink CRE workflow that feeds dividend declarations into the Monad Testnet
`DividendOracle`. Reuses the tutorial setup (TypeScript + `@chainlink/cre-sdk`,
writes through the Monad Testnet CRE forwarder) that previously wrote to the
`CalculatorConsumer`.

Workflow steps:

1. HTTP GET `https://cleave-web.vercel.app/api/dividend-feed`.
2. EVM read `DividendOracle.lastSeq()`.
3. If `feed.seq <= lastSeq` log `no new declaration` and exit **without writing**.
4. ABI-encode `(uint256 seq, uint256 amountPerShare, uint256 refPrice)` with the
   decimal strings `"1.05"` / `"101.37"` parsed to 1e18 integers via string/BigInt
   arithmetic (no floating point).
5. Generate the CRE signed report.
6. Write it via the Monad Testnet forwarder to the `DividendOracle`.

## Layout

```
cre/
  project.yaml                      CRE project settings (rpcs per target)
  .env                              gitignored; CRE_ETH_PRIVATE_KEY (broadcast signer)
  .env.example                      template (name only, committed)
  README.md                         this file
  cleave-dividend-feed/
    workflow.yaml                   staging/production targets
    config.staging.json             staging config (oracle, feed, chain, gas)
    config.production.json          production config
    main.ts                         workflow entry point (all steps above)
    package.json
    tsconfig.json
    contracts/abi/DividendOracle.ts viem ABI used for the lastSeq() read
```

## Configuration

`cleave-dividend-feed/config.staging.json`:

| field | value |
|---|---|
| `schedule` | `*/30 * * * * *` (cron; every 30 s in the simulator) |
| `apiUrl` | `https://cleave-web.vercel.app/api/dividend-feed` |
| `evms[0].oracleAddress` | `0x1f6ce6F6C0f24d7b93A56982988e7F274860e8Cc` |
| `evms[0].chainName` | `monad-testnet` (chain selector 10143) |
| `evms[0].gasLimit` | `500000` (Monad charges the declared limit) |

The deployed `DividendOracle` was constructed with the CRE forwarder
`0xB9F79d863261869B234c481D1f9A7af84AeAd192`; its `getExpectedAuthor`,
`getExpectedWorkflowName` and `getExpectedWorkflowId` are all `0`, so the
ReceiverTemplate metadata checks are disabled and **no on-chain
author/workflow-id configuration is required** — the forwarder-only check is
sufficient (this mirrors the tutorial `CalculatorConsumer`).

## Setup

```bash
cd cre/cleave-dividend-feed
bun install        # or npm install
npm run typecheck  # tsc --noEmit
```

Put the broadcast account key into `cre/.env` (see `.env.example`). The account
must hold MON on Monad Testnet (`>= 0.3 MON` recommended):

```bash
# from repo root
node -e "const{privateKeyToAccount}=require('viem/accounts');const fs=require('fs');const k=fs.readFileSync('cre/.env','utf8').match(/=(\S+)/)[1];console.log(privateKeyToAccount(k).address)"
```

## Run the simulation with broadcast

Run from the **project root** (`cre/`), exactly like the tutorial:

```bash
cd cre
cre workflow simulate ./cleave-dividend-feed --target=staging-settings --broadcast
```

The cron trigger waits for the next `*/30` tick (up to ~30 s) — press Enter to
skip waiting, or just let it fire. Expected output:

```
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  ...
2026-10-08T04:42:04Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-08T04:42:35Z [USER LOG] Feed fetched: seq=1031 amountPerShare=1.10 refPrice=95.31
2026-10-08T04:42:36Z [USER LOG] DividendOracle.lastSeq on-chain: 1028
2026-10-08T04:42:36Z [USER LOG] CRE report generated successfully
2026-10-08T04:42:38Z [USER LOG] DividendOracle transaction: 0x8c971e5c…0a15
✓ Workflow Simulation Result:
{
  "amountPerShare": 1100000000000000000,   // 1.10 mUSD (1e18)
  "feedSeq": 1031,
  "lastSeqOnChain": 1028,
  "refPrice": 95310000000000000000,        // 95.31 mUSD (1e18)
  "txHash": "0x8c971e5c…0a15",
  "wrote": true
}
```

The transaction is sent from the `.env` account **to the CRE forwarder**
`0xB9F79d…Ad192` (not to the oracle directly); the forwarder then calls
`DividendOracle.onReport(metadata, report)`. View on
Monadexplorer: `https://testnet.monadexplorer.com/tx/<txHash>`.

Verify on-chain (expect `count()` to increase and `latest().source == 0` = CRE):

```bash
cast call 0x1f6ce6F6C0f24d7b93A56982988e7F274860e8Cc "count()(uint64)" --rpc-url https://testnet-rpc.monad.xyz
cast call 0x1f6ce6F6C0f24d7b93A56982988e7F274860e8Cc "latest()(uint64,uint256,uint256,uint256,uint64,uint64,uint8)" --rpc-url https://testnet-rpc.monad.xyz
# last tuple element 0 => Source.CRE
cast call 0x1f6ce6F6C0f24d7b93A56982988e7F274860e8Cc "getForwarderAddress()(address)" --rpc-url https://testnet-rpc.monad.xyz
```

## Run it again immediately → "no new declaration"

The feed only advances every 600 s, so a second run in the same window writes
nothing:

```bash
cre workflow simulate ./cleave-dividend-feed --target=staging-settings
```

Expected:

```
2026-10-08T04:46:02Z [USER LOG] Feed fetched: seq=1031 amountPerShare=1.10 refPrice=95.31
2026-10-08T04:46:03Z [USER LOG] DividendOracle.lastSeq on-chain: 1031
2026-10-08T04:46:03Z [USER LOG] no new declaration (feed seq 1031 <= on-chain lastSeq 1031); skipping write
✓ Workflow Simulation Result:
{ "amountPerShare": ..., "feedSeq": 1031, "lastSeqOnChain": 1031, "refPrice": ..., "txHash": "", "wrote": false }
```

No transaction is broadcast (`wrote: false`, empty `txHash`).

## Recorded run (evidence for T2.1)

Unrelated to the command itself, the broadcast account has ~1.3 MON on Monad
Testnet. Recorded broadcasts when a feed window advanced:

| declaration | feed seq | amountPerShare | refPrice | tx hash | block |
|---|---|---|---|---|---|
| 2 | 1026 | 1.10 | 95.25 | `0x22b84300…1ca16` | 69143004 |
| 3 | 1028 | 1.00 | 95.44 | `0x33881e78…a3ee` | after 69143004 |
| 4 | 1031 | 1.10 | 95.31 | `0x8c971e5c…0a15` | 69151560 |

`count()` went `1 → 4`; `latest()` = `[id=4, seq=1031, amountPerShare=1.10e18,
refPrice=95.31e18, declaredAt, exAt=declaredAt+60, source=0]` (source `0` = CRE).

## Notes

- Simulation requires a logged-in `cre` account (`cre whoami`). Deploy access is
  not enabled for this account, so the workflow runs in simulation with
  `--broadcast`, which is the accepted T2.1 flow.
- `--broadcast` signs the forwarder write with `CRE_ETH_PRIVATE_KEY` from
  `cre/.env`.
- Do not commit `cre/.env` (repo `.gitignore` covers `.env*`).