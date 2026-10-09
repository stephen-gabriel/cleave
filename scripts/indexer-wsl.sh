#!/usr/bin/env bash
# Run from Ubuntu: bash /mnt/c/Users/ZERO/Desktop/Cleave/scripts/indexer-wsl.sh <command>
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=${CLEAVE_WSL_DIR:-$HOME/cleave-t22-20261009}
case "$work" in /mnt/*) echo 'Choose a Linux filesystem workspace, not /mnt/*' >&2; exit 1;; esac
mkdir -p "$work/indexer" "$work/config" "$work/deployments"
for file in package.json pnpm-lock.yaml pnpm-workspace.yaml config.yaml schema.graphql tsconfig.json envio-env.d.ts; do
  cp "$repo/indexer/$file" "$work/indexer/$file"
done
if [ -d "$repo/indexer/src" ]; then cp -r "$repo/indexer/src" "$work/indexer/"; fi
cp "$repo/config/sim-wallets.json" "$work/config/"
cp "$repo/deployments/monad-testnet.json" "$work/deployments/"
cd "$work/indexer"
case "${1:-check}" in
  install) pnpm install --frozen-lockfile --store-dir "$HOME/.local/share/pnpm/store" --child-concurrency=1 --network-concurrency=2 ;;
  codegen) pnpm codegen ;;
  check) pnpm codegen && pnpm typecheck && pnpm test ;;
  dev) pnpm dev ;;
  sync) printf 'Synced public sources to %s\n' "$work/indexer" ;;
  *) echo 'Usage: indexer-wsl.sh {install|codegen|check|dev|sync}' >&2; exit 1 ;;
esac
