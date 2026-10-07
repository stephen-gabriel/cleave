// Cleave deployment script — implemented in T1.3 per frd.md §1.8.
// Deploy: mACME, mUSD, DividendOracle(forwarder), Splitter(maturity=now+30d), 2 Pools;
// writes deployments/monad-testnet.json.
async function main(): Promise<void> {
  throw new Error('Not implemented yet: see frd.md §1.8 (Milestone 01, task T1.3).')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
