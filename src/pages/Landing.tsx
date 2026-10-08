import { useCallback, useState } from 'react'
import { useSession } from '../wallet/session'
import { describeError } from '../wallet/mera'
import { noteLandingInteraction } from '../lib/timing'
import { Link } from '../router'
import './Landing.css'

const PILL_TITLE = 'Mock tokens only. No real money, no real equity.'

function Pill() {
  return (
    <span className="chip pill--simulated" title={PILL_TITLE}>
      SIMULATED · MONAD TESTNET
    </span>
  )
}

function FingerprintIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 11a2.5 2.5 0 0 1 2.5 2.5c0 2.6.4 4.2 1 5.4" />
      <path d="M12 11a2.5 2.5 0 0 0-2.5 2.5c0 1.7-.7 3.4-1.7 5" />
      <path d="M5.1 13.5A7 7 0 0 1 19 13.5" />
      <path d="M3 17.8a10.4 10.4 0 0 0 2.2 2.2" />
      <path d="M21 12a9 9 0 0 0-13.3-7.7" />
      <path d="M9 5.5A9 9 0 0 1 21 14" />
    </svg>
  )
}

export default function Landing() {
  const session = useSession()
  const [busy, setBusy] = useState<'create' | 'signin' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (mode: 'create' | 'signin') => {
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
    },
    [session],
  )

  return (
    <div className="landing" onPointerDown={noteLandingInteraction}>
      <section className="landing__hero">
        <div className="landing__copy">
          <Pill />
          <h1 className="landing__headline">Split a stock into its dividends and its price.</h1>
          <p className="landing__subhead">
            Cleave separates a tokenized stock into two pieces you can trade on their own: the
            dividend stream and the price exposure. Settled in under a second.
          </p>
          <div className="landing__cta">
            <button
              type="button"
              className="btn btn--primary btn--lg btn--full"
              onClick={() => void run('create')}
              disabled={busy !== null}
            >
              <FingerprintIcon />
              {busy === 'create' ? 'Creating your account…' : 'Create your account'}
            </button>
            <p className="landing__micro">
              One tap. Your device&apos;s passkey is your account — no seed phrase, no extension.
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void run('signin')}
              disabled={busy !== null}
            >
              {busy === 'signin' ? 'Waiting for authenticator…' : 'I already have an account — Sign in'}
            </button>
            {error !== null && (
              <p className="landing__error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        <Preview />
      </section>

      <section className="landing__below">
        <div className="card landing__point">
          <h3>Hold only what you want</h3>
          <p className="muted">
            Income without price risk, or price without waiting for dividends.
          </p>
        </div>
        <div className="card landing__point">
          <h3>Know exactly what you pay</h3>
          <p className="muted">
            Fair value, price impact and fees are shown before you confirm.
          </p>
        </div>
        <div className="card landing__point">
          <h3>Built on Monad</h3>
          <p className="muted">400ms blocks, ~800ms finality, no pending states.</p>
        </div>
      </section>

      <p className="landing__judges">
        Judging this? <Link to="/judges">Open the 2-minute walkthrough →</Link>
      </p>
    </div>
  )
}

function Preview() {
  return (
    <div className="landing__preview" aria-hidden>
      <div className="pv">
        <div className="pv__card">
          <div className="pv__half pv__half--l">
            <div className="pv__inner">
              <span className="pv__stock">mACME · $100.00</span>
              <span className="pv__leg">
                Price leg
                <b className="pv__leg-price">$94.00</b>
              </span>
            </div>
          </div>
          <div className="pv__splitline" />
          <div className="pv__half pv__half--r">
            <div className="pv__inner">
              <span className="pv__stock">mACME · $100.00</span>
              <span className="pv__leg">
                Dividend leg
                <b className="pv__leg-div">$6.00</b>
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="landing__caption">1 stock = 1 price leg + 1 dividend leg. Always.</p>
    </div>
  )
}