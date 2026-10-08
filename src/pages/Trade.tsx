import { Placeholder } from '../ui/Placeholder'

export default function Trade({ leg }: { leg?: string }) {
  const active = leg === 'price' ? 'price' : 'dividend'
  return (
    <Placeholder
      title={`Trade · ${active === 'price' ? 'Price leg' : 'Dividend leg'}`}
      text="Order ticket, chart and trades feed for the legs against mUSD. Lands with the pool and Envio integration."
    />
  )
}