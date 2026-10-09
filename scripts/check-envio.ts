import { fetchQuery, queries, type Query } from '../src/data/envio.ts'
import { readFileSync } from 'node:fs'
// Read-only endpoint acceptance; never uses an admin token or broadcasts a transaction.
const endpoint = process.argv[2] ?? process.env.VITE_ENVIO_GRAPHQL_URL
if (!endpoint) throw new Error('Supply a public GraphQL URL as the first argument')
const deployment = JSON.parse(readFileSync(new URL('../deployments/monad-testnet.json', import.meta.url), 'utf8'))
const definitions: Query<unknown[]>[] = [queries.stats(), queries.pools(), queries.activity(), queries.declarations(),
  queries.swaps(deployment.contracts.poolPrice.address), queries.hourly(deployment.contracts.poolPrice.address),
  queries.account(deployment.deployer), queries.history(deployment.deployer)]
let hasStats = false
for (const q of definitions) {
  const rows = await fetchQuery(endpoint, q, AbortSignal.timeout(15_000))
  console.log(`${q.key.split(':')[0]}: ${rows.length} rows`)
  if (q.key.startsWith('stats:')) hasStats = rows.length > 0
}
if (!hasStats) throw new Error('Endpoint responds but has not indexed protocol activity yet')
console.log('Public GraphQL queries passed without authentication.')
