# Project Paths

- Repo root (Mera app, `_build_plan/`): `C:\Users\ZERO\Desktop\Cleave`
- CRE project: `C:\Users\ZERO\Desktop\Cleave-CRE` (the tutorial workflow, forwarder and `ReceiverTemplate` are reused in Milestone 2)
- Envio indexer: `C:\Users\ZERO\Desktop\Cleave-Envio`

# CRE Configuration (from Cleave-CRE/cleave-dividend-feed/config.staging.json)

- Chain: monad-testnet (Chain Selector - Monad Testnet is 10143 as per architecture; chain selector ID 10143)
- CalculatorConsumer (Receiver) Address: `0x6B91fAfE9fb63282A13b467dAB068BCD87274117`
- Storage/MockStock Address: `0x90000dbEcA8f03Bc96017F52b28FaA5e55Fd9Abe`
- Gas Limit: `500000`

**Note**: The CRE workflow writes reports through the Monad forwarder to the CalculatorConsumer. The forwarder address is specified by Chainlink CRE for the target chain; in the tutorial setup, the ReceiverTemplate/CalculatorConsumer integration uses the standard Chainlink CRE forwarder for Monad Testnet. This is to be referenced from the CRE deployment context when running in production - for now, note that the forwarder is the Chainlink CRE forwarder for Monad Testnet (chain selector 10143).

# Chainlink CRE Details

- Chain Selector (Monad Testnet): `10143`
- CRE CLI staging config: `C:\Users\ZERO\Desktop\Cleave-CRE\cleave-dividend-feed\config.staging.json`
- CRE project config: `C:\Users\ZERO\Desktop\Cleave-CRE\project.yaml`
- Workflow: `C:\Users\ZERO\Desktop\Cleave-CRE\cleave-dividend-feed/workflow.yaml`

# Envio Details

- Envio project: `C:\Users\ZERO\Desktop\Cleave-Envio`
- GraphQL URL: Not yet deployed (needs `envio deploy` to Envio Cloud). Expected format per architecture: `VITE_ENVIO_GRAPHQL_URL` (e.g., `https://indexer.hyperindex.xyz/<deployment-id>/graphql` or Envio Cloud URL). Check Envio dashboard after deployment.
- API Token: Present in `.env` (do not commit/share - excluded by git; local only)
- Start block: To be set to contract deployment block from `deployments/monad-testnet.json` after contracts deploy.

# Commands to run each piece

## Repo (Cleave)
```powershell
# Install dependencies
npm install

# Local development
npm run dev

# Build
npm run build

# Run contract tests (if using foundry/forge)
forge test

# Run lint/typecheck if configured
npm run lint 2>$null; npm run typecheck 2>$null

# Scan secrets
bash scripts/scan-secrets.sh  # or pwsh equivalent
```

## CRE (Cleave-CRE)
```powershell
cd C:\Users\ZERO\Desktop\Cleave-CRE\cleave-dividend-feed

# Install deps
npm install  # or bun install

# Typecheck
npm run typecheck

# Run locally (simulation)
cre local  # if cre CLI installed globally
# or via npx if configured

# Run simulation with broadcast (as per workflow)
cre workflow run --network staging  # check CLI syntax; CRE CLI v0.8.x uses different flags
```

**Note**: CRE CLI must be installed. Check with `cre --version` or `cre help`.

## Envio (Cleave-Envio)
```powershell
cd C:\Users\ZERO\Desktop\Cleave-Envio

# Install deps
npm install

# Generate types/codegen
npm run codegen

# Dev mode (local)
npm run dev

# Start (production mode)
npm run start

# Deploy to Envio Cloud
envio deploy

# Run tests
npm run test
```

**Note**: Envio CLI must be installed. Check with `envio --version`.
