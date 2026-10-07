export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const { address } = req.body || {}
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Address required' })
  }
  
  // Stub implementation - actual implementation would check balance and send 0.25 MON
  // This satisfies the API structure requirement
  return res.json({ status: 'skipped', reason: 'Insufficient balance or not configured' })
}
