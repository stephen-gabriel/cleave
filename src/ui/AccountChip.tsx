import { useCallback, useEffect, useRef } from 'react'
import { useState } from 'react'
import { formatEther } from 'viem'
import { useSession } from '../wallet/session'
import { SESSION_CAP_USD } from '../wallet/session'
import { explorerAddressUrl } from '../wallet/mera'

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function ringProgress(remainingMs: number): number {
  const total = 15 * 60 * 1000
  return Math.max(0, Math.min(1, remainingMs / total))
}

function formatMon(wei: bigint | null): string {
  if (wei === null) return '…'
  return `${Number(formatEther(wei)).toFixed(4)} fee credit`
}

export function AccountChip() {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const wallet = session.wallet
  const address = wallet?.account.address ?? ''

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(address).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [address])

  useEffect(() => {
    if (!open) return
    const handler = (event: PointerEvent) => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  if (wallet === null) return null

  const progress = ringProgress(session.remainingMs)
  const ringCx = 11
  const ringR = 9
  const circumference = 2 * Math.PI * ringR

  return (
    <div className="sheet-wrap" ref={wrapRef}>
      <button type="button" className="account-chip" onClick={() => setOpen((v) => !v)}>
        <svg className="account-chip__ring" viewBox="0 0 22 22" aria-label="Session time left">
          <circle
            cx={ringCx}
            cy={ringCx}
            r={ringR}
            fill="none"
            stroke="var(--border)"
            strokeWidth="2.5"
          />
          <circle
            cx={ringCx}
            cy={ringCx}
            r={ringR}
            fill="none"
            stroke="var(--price)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={`${circumference * (1 - progress)}`}
            transform={`rotate(-90 ${ringCx} ${ringCx})`}
          />
        </svg>
        <span className="account-chip__ok">
          <span className="account-chip__addr">{shortAddress(address)}</span>
          <span className="account-chip__mon">{formatMon(session.monBalance)}</span>
        </span>
        <svg className="account-chip__chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div className="sheet" role="dialog" aria-label="Session details">
          <div className="sheet__row">
            <span className="sheet__addr">{address}</span>
            <span className="sheet__row--icons">
              <button type="button" className="icon-btn" onClick={() => void copy()} title="Copy address">
                {copied ? '✓' : '⧉'}
              </button>
              <a
                className="icon-btn"
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
                title="View on explorer"
              >
                ↗
              </a>
            </span>
          </div>

          <div>
            <div className="sheet__row">
              <span>Session active</span>
              <span className="mono">expires in {formatRemaining(session.remainingMs)}</span>
            </div>
            <div className="sheet__progress" style={{ marginTop: 8 }}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
          </div>

          <div className="sheet__row">
            <span className="muted">Spend limit</span>
            <span className="mono">
              {session.spentUsd.toLocaleString('en-US')} / {SESSION_CAP_USD.toLocaleString('en-US')} mUSD used
            </span>
          </div>

          <p className="sheet__info">
            <span aria-hidden>ⓘ</span>
            <span>
              This session can only sign actions on Cleave contracts. Sending anything elsewhere always
              asks for your passkey.
            </span>
          </p>

          <div className="sheet__btns">
            <button type="button" className="btn" onClick={() => void session.extend()}>
              Extend session
            </button>
            <button type="button" className="btn btn--ghost" onClick={session.lock}>
              Lock now
            </button>
          </div>

          <p className="sheet__row muted" style={{ justifyContent: 'center', fontSize: 12 }}>
            Not your account? Lock and sign in again.
          </p>
        </div>
      )}
    </div>
  )
}