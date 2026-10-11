// GraphQL numeric values stay decimal strings. Never convert token quantities to JS Number.
export type Quantity = string
export type Account = { id: string; firstSeenAt: number; isSimulated: boolean; splitVolume: Quantity; tradeVolumeUsd: Quantity; tradeCount: number; dividendsClaimed: Quantity }
export type Pool = { id: string; kind: string; reserveToken: Quantity; reserveQuote: Quantity; lastPrice: string; volumeUsd: Quantity; tradeCount: number }
export type Swap = { id: string; pool_id: string; trader: string; isBuy: boolean; amountToken: Quantity; amountQuote: Quantity; price: string; timestamp: number; isSimulated: boolean; txHash: string }
export type PoolHourly = { id: string; pool_id: string; hour: number; open: string; high: string; low: string; close: string; volumeUsd: Quantity; trades: number }
export type Declaration = { id: string; seq: Quantity; amountPerShare: Quantity; refPrice: Quantity; exAt: number; declaredAt: number; source: 'CRE' | 'Demo'; txHash: string; distributed: boolean; distributedAt: number | null; totalPaid: Quantity | null; supplyAtDistribution: Quantity | null }
export type ProtocolStats = { id: string; totalSplit: Quantity; totalMerged: Quantity; totalRedeemed: Quantity; tradeCount: number; volumeUsd: Quantity; simulatedVolumeUsd: Quantity; organicVolumeUsd: Quantity; uniqueAccounts: number; organicAccounts: number; dividendsDeclared: number; dividendsDistributed: number; dividendsPaidUsd: Quantity }
export type Activity = { id: string; kind: string; account: string; pool: string | null; amount: Quantity; quoteAmount: Quantity | null; timestamp: number; blockNumber: number; logIndex: number; txHash: string; isSimulated: boolean }

export type Query<T> = { key: string; document: string; variables: Record<string, string | number>; select: (data: Record<string, unknown>) => T }
const CHAIN = 10143
const activityFields = 'id kind account pool amount quoteAmount timestamp blockNumber logIndex txHash isSimulated'
function address(value: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid account or pool address')
  return value.toLowerCase()
}
function limit(value: number) { return Number.isFinite(value) ? Math.max(1, Math.min(200, Math.trunc(value))) : 50 }
const numericFields = new Set(['splitVolume', 'tradeVolumeUsd', 'dividendsClaimed', 'reserveToken', 'reserveQuote',
  'lastPrice', 'volumeUsd', 'amountToken', 'amountQuote', 'price', 'open', 'high', 'low', 'close', 'seq',
  'amountPerShare', 'refPrice', 'totalPaid', 'supplyAtDistribution', 'totalSplit', 'totalMerged', 'totalRedeemed',
  'simulatedVolumeUsd', 'organicVolumeUsd', 'dividendsPaidUsd', 'amount', 'quoteAmount'])
function normalizeRows(rows: unknown[]) {
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Indexer returned an invalid row')
    return Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (!numericFields.has(key) || value === null) return [key, value]
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return [key, value]
      if (typeof value === 'number' && Number.isSafeInteger(value)) return [key, String(value)]
      throw new Error('Indexer must serialize numeric fields as decimal strings')
    }))
  })
}
function query<T>(key: string, document: string, variables: Query<T>['variables'], field: string): Query<T> {
  return { key: `${key}:${JSON.stringify(variables)}`, document, variables, select(data) {
    if (!Array.isArray(data[field])) throw new Error('Indexer returned an incomplete response')
    return normalizeRows(data[field] as unknown[]) as T
  } }
}
export const queries = {
  swaps: (pool: string, count = 50) => query<Swap[]>('swaps', `query Swaps($chain: Int!, $pool: String!, $limit: Int!) {
    Swap(where: {chainId: {_eq: $chain}, pool_id: {_eq: $pool}}, order_by: [{timestamp: desc}, {id: desc}], limit: $limit) {
      id pool_id trader isBuy amountToken amountQuote price timestamp isSimulated txHash
    } }`, { chain: CHAIN, pool: address(pool), limit: limit(count) }, 'Swap'),
  swapsAll: (count = 200) => query<Swap[]>('swapsAll', `query SwapsAll($chain: Int!, $limit: Int!) {
    Swap(where: {chainId: {_eq: $chain}}, order_by: [{timestamp: desc}, {id: desc}], limit: $limit) {
      id pool_id trader isBuy amountToken amountQuote price timestamp isSimulated txHash
    } }`, { chain: CHAIN, limit: limit(count) }, 'Swap'),
  hourly: (pool: string, count = 168) => query<PoolHourly[]>('hourly', `query Hourly($chain: Int!, $pool: String!, $limit: Int!) {
    PoolHourly(where: {chainId: {_eq: $chain}, pool_id: {_eq: $pool}}, order_by: {hour: desc}, limit: $limit) {
      id pool_id hour open high low close volumeUsd trades
    } }`, { chain: CHAIN, pool: address(pool), limit: limit(count) }, 'PoolHourly'),
  declarations: (count = 50) => query<Declaration[]>('declarations', `query Declarations($chain: Int!, $limit: Int!) {
    DividendDeclaration(where: {chainId: {_eq: $chain}}, order_by: [{declaredAt: desc}, {seq: desc}], limit: $limit) {
      id seq amountPerShare refPrice exAt declaredAt source txHash distributed distributedAt totalPaid supplyAtDistribution
    } }`, { chain: CHAIN, limit: limit(count) }, 'DividendDeclaration'),
  stats: () => query<ProtocolStats[]>('stats', `query Stats($chain: Int!) {
    ProtocolStats(where: {chainId: {_eq: $chain}, id: {_eq: "global"}}, limit: 1) {
      id totalSplit totalMerged totalRedeemed tradeCount volumeUsd simulatedVolumeUsd organicVolumeUsd uniqueAccounts organicAccounts dividendsDeclared dividendsDistributed dividendsPaidUsd
    } }`, { chain: CHAIN }, 'ProtocolStats'),
  pools: () => query<Pool[]>('pools', `query Pools($chain: Int!) {
    Pool(where: {chainId: {_eq: $chain}}, order_by: {id: asc}, limit: 2) { id kind reserveToken reserveQuote lastPrice volumeUsd tradeCount }
    }`, { chain: CHAIN }, 'Pool'),
  account: (who: string) => query<Account[]>('account', `query Account($chain: Int!, $account: String!) {
    Account(where: {chainId: {_eq: $chain}, id: {_eq: $account}}, limit: 1) { id firstSeenAt isSimulated splitVolume tradeVolumeUsd tradeCount dividendsClaimed }
    }`, { chain: CHAIN, account: address(who) }, 'Account'),
  history: (who: string, count = 50) => query<Activity[]>('history', `query History($chain: Int!, $account: String!, $limit: Int!) {
    Activity(where: {chainId: {_eq: $chain}, account: {_eq: $account}}, order_by: [{blockNumber: desc}, {logIndex: desc}], limit: $limit) { ${activityFields} }
    }`, { chain: CHAIN, account: address(who), limit: limit(count) }, 'Activity'),
  activity: (count = 50) => query<Activity[]>('activity', `query Activity($chain: Int!, $limit: Int!) {
    Activity(where: {chainId: {_eq: $chain}}, order_by: [{blockNumber: desc}, {logIndex: desc}], limit: $limit) { ${activityFields} }
    }`, { chain: CHAIN, limit: limit(count) }, 'Activity'),
}

export async function fetchQuery<T>(endpoint: string, query: Query<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query.document, variables: query.variables }), signal,
  })
  if (!response.ok) throw new Error(`Indexer unavailable (HTTP ${response.status})`)
  const body = await response.json() as { data?: Record<string, unknown>; errors?: unknown[] }
  if (body.errors?.length || !body.data) throw new Error('Indexer query failed')
  return query.select(body.data)
}
