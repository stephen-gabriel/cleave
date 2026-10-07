export default function handler(req: any, res: any) {
  const now = Math.floor(Date.now() / 1000)
  const window = Math.floor(now / 600)
  const SERIES_START_WINDOW = window // for demo
  const seq = window - SERIES_START_WINDOW + 1
  const amounts = ['1.00', '1.00', '1.05', '1.05', '1.10', '1.10']
  const idx = ((seq - 1) % 6)
  const amountPerShare = amounts[idx]
  const refPrice = (100 + (seq % 20) - 10).toFixed(2)
  
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({
    symbol: 'mACME',
    seq,
    amountPerShare,
    refPrice,
    currency: 'mUSD',
    source: 'simulated',
    asOf: new Date(now * 1000).toISOString(),
  })
}
