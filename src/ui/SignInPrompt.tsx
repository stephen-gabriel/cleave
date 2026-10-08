import { useState } from 'react'
import { useSession } from '../wallet/session'
import { describeError, FAUCET_URL } from '../wallet/mera'

export function SignInPrompt() {
  const session = useSession()
  const [busy, setBusy] = useState<null | 'signin' | 'create'>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (mode: 'signin' | 'create') => {
    setBusy(mode)
    setError(null)
    try {
      if (mode === 'create') await session.create()
      else await session.signIn()
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="prompt">
      <div className="prompt__icon" aria-hidden>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="1.6">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </div>
      <h2>Sign in to continue</h2>
      <p className="muted">
        Your device&apos;s passkey is your account. Balances live on-chain, so signing in anywhere
        brings back the same account.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={busy !== null}
          onClick={() => void run('signin')}
        >
          {busy === 'signin' ? 'Waiting for authenticator…' : 'Sign in'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy !== null}
          onClick={() => void run('create')}
        >
          {busy === 'create' ? 'Creating your account…' : 'Create your account'}
        </button>
      </div>
      {error !== null && <p className="muted" style={{ color: 'var(--neg)' }}>{error}</p>}
      <p className="muted" style={{ fontSize: 12 }}>
        Need testnet MON? Use the{' '}
        <a href={FAUCET_URL} target="_blank" rel="noreferrer">
          faucet
        </a>
        .
      </p>
    </section>
  )
}