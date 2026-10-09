# Cleave Series A indexer

Uses the existing Series A scaffold and deployed Monad Testnet contracts. Envio is pinned to 3.12.1. The sibling `Cleave-Envio` MockStock tutorial is not used.

## Sources and data

- `config.yaml`: oracle from block 69097595; Series A Splitter/dividend leg from 69107200; both pools from 69107205 (the earlier pool deployment). Earlier oracle history is needed to join distributions to declarations.
- `src/handlers/cleave.ts`: Split, Merge, Redeem, Swap, LiquidityChanged, DividendDeclared, DividendDistributed, Claimed.
- `schema.graphql`: plan entities plus `Activity`, explicit `SplitEvent.kind`, `ProtocolStats.totalRedeemed`, and liquidity transaction hashes. Redeeming never inflates split or merge totals.
- `../config/sim-wallets.json`: committed public bot addresses, normalized case-insensitively. Empty until bots exist. Change it only with a full reindex; existing classifications are historical. Invalid addresses fail startup.
- Token quantities and volume remain bigint (18 decimals); prices use BigDecimal. Hour keys use `floor(timestamp / 3600)`. Candles use post-swap reserve prices, with no synthetic empty-hour candles.
- Activity IDs contain chain, block and log index. Handlers read/write through Envio context, so preload and rollback remain framework-managed. Activity guards avoid double-counting duplicate event IDs.
- Declared totals count oracle declarations; paid totals count distributions, not claims. Accounts count split/merge/redeem, trading, liquidity, distribution callers and claim participants; oracle report signers alone do not count as users.

## Low-memory local workflow (Ubuntu WSL)

Run one process at a time. Keep dependencies on Linux, not `/mnt/c`:

```bash
bash /mnt/c/Users/ZERO/Desktop/Cleave/scripts/indexer-wsl.sh install
bash /mnt/c/Users/ZERO/Desktop/Cleave/scripts/indexer-wsl.sh check
```

The helper copies public source files to `$HOME/cleave-t22-20261009`, keeps the Windows main repository authoritative, and uses a Linux pnpm store. It never copies `.env` or private keys. Set `CLEAVE_WSL_DIR` to change the Linux destination. Synced files are copied without deleting unrelated files; if a source is renamed, remove the corresponding obsolete mirror file yourself. pnpm 12.9.1 was used, with only esbuild's build script allowed. Codegen must run before typechecking; generated `.envio/` is ignored.

`check` runs codegen, strict typecheck and six deterministic in-process tests, one worker. No Docker, API token, network calls or blockchain transactions are needed. Tests cover aggregate totals, account uniqueness, both pools, OHLC across hours, simulated vs organic volume, declarations/distribution/claim links, liquidity, redeem separation, large integer precision and case-insensitive bot classification. The simulation test preloads a classified bot account and tests the classifier separately, keeping the production bot list empty.

## Local GraphQL acceptance (pending Docker)

1. Start Docker Desktop and enable Ubuntu under Settings > Resources > WSL Integration.
2. Put only `ENVIO_API_TOKEN` in the Linux indexer's local `.env` if HyperSync requires it. Keep it out of Git; do not copy deployment wallet files.
3. Run the helper with `dev` to start Envio's local database/Hasura/indexer stack. This reads existing chain events; it does not broadcast transactions.
4. Verify the endpoint without authentication from the main repository:

```powershell
node --experimental-strip-types scripts/check-envio.ts http://localhost:8080/v1/graphql
```

The script validates all eight frontend query shapes, including an indexed stats row. The full T2.2 acceptance still requires checking split, swap, declaration and distribution records plus totals through GraphQL and observing head latency. Reuse historical transactions and existing declarations; do not run another CRE broadcast. Synthetic handler tests do not establish GraphQL permissions or live latency.

## Frontend and deployment handoff

`src/data/envio.ts` exports typed, bounded, chain-filtered queries for swaps, candles, declarations, stats, pools, accounts, history and activity. `src/data/useEnvio.ts` uses one shared scheduler: 3-second polling, sequential requests, per-query exponential backoff up to 30 seconds, 10-second timeout, last-good data on errors, and cancellation when unused. An unset `VITE_ENVIO_GRAPHQL_URL` yields `unconfigured` without requests. Numeric quantities are represented as decimal strings; the endpoint must serialize numeric fields without precision loss.

The later Trade/Dividends/Portfolio/Market screens can consume these hooks; their placeholder pages are unchanged by T2.2.

Cloud deployment, setting the production frontend endpoint, Vercel redeployment and live latency checks require owner approval. When approved, choose main-repo `indexer/` as the Envio project directory. The full repository must remain available because handlers import the public root configuration and deployment manifest. Verify the hosted build's checkout layout before deploying.

References: [Envio v3 handlers](https://docs.envio.dev/docs/HyperIndex/event-handlers), [testing](https://docs.envio.dev/docs/HyperIndex/testing), [preload](https://docs.envio.dev/docs/HyperIndex/preload-optimization).
