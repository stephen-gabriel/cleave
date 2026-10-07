# Cleave

On-chain asset vaults on Monad testnet with splits, real-time dividends, and passkey accounts.

**Live app: https://cleave-web.vercel.app**

## Stack

- Solidity 0.8.28 + Hardhat 3.18 (contracts in `contracts/`)
- React + TypeScript + Vite (`src/`)
- viem wallet client, passkey (WebAuthn PRF) accounts (`src/wallet.ts`)
- Vercel serverless APIs (`api/drip`, `api/dividend-feed`)
- CREDividendCalculator consumer workflow (CRE, sibling project `Cleave-CRE`)
- Envio indexer (sibling project `Cleave-Envio`)

## Commands

```bash
npm install
npm run dev        # local dev server
npm run build      # tsc -b && vite build (must pass before every push)
npx hardhat compile
powershell -File .\scripts\scan-secrets.ps1   # pre-push secrets gate
```

## Configuration

Copy `.env.example` to `.env` and fill in values. No secrets are committed.

## Docs

- `NOTES.md` — project paths, CRE/Envio details, run commands
- `_build_plan/` — FRD, milestones, submission kit
- `docs/decisions.md` — architecture decision records
