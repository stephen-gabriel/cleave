import { explorerTxUrl } from '../wallet/mera'

type Props = {
  seconds: number
  txHash: string
  label?: string
}

export function ConfirmationChip({ seconds, txHash, label }: Props) {
  const text = label ?? `Confirmed in ${seconds.toFixed(1)} s`
  return (
    <span className="chip chip--confirmed" aria-live="polite">
      {text}
      <a
        href={explorerTxUrl(txHash)}
        target="_blank"
        rel="noreferrer"
        aria-label="View transaction on explorer"
      >
        ↗
      </a>
    </span>
  )
}