type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type Req = {
  method: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type Res = {
  status: (code: number) => Res
  json: (body: JsonValue) => void
  setHeader: (name: string, value: string) => void
  end: () => void
}

const SERIES_START_ISO = '2026-10-01T00:00:00.000Z'
const SERIES_START_WINDOW = Math.floor(Date.parse(SERIES_START_ISO) / 600_000)
const WINDOW_SECONDS = 600
const AMOUNTS = ['1.00', '1.00', '1.05', '1.05', '1.10', '1.10']

function refPriceFor(seq: number): number {
  let state = (Math.imul(seq, 2246822519) ^ 0x5bd1e995) >>> 0
  let price = 100
  const steps = Math.min(Math.max(seq, 1), 5000)
  for (let i = 0; i < steps; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const jitter = ((state >>> 24) % 201 - 100) / 400
    price = Math.min(130, Math.max(85, price + jitter))
  }
  return price
}

export default function handler(req: Req, res: Res): void {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.status(204).end()
    return
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const windowIdx = Math.floor(nowSeconds / WINDOW_SECONDS)
  const seq = Math.max(1, windowIdx - SERIES_START_WINDOW + 1)
  const amountPerShare = AMOUNTS[(seq - 1) % AMOUNTS.length]
  const refPrice = refPriceFor(seq).toFixed(2)

  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({
    symbol: 'mACME',
    seq,
    amountPerShare,
    refPrice,
    currency: 'mUSD',
    source: 'simulated',
    asOf: new Date(nowSeconds * 1000).toISOString(),
  })
}