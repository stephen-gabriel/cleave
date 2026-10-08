import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { SessionProvider, useSession } from './wallet/session'
import { publicClient, describeError } from './wallet/mera'
import { usePath, matchPath, navigate, Link } from './router'
import { Logo } from './ui/Logo'
import { AccountChip } from './ui/AccountChip'
import { SignInPrompt } from './ui/SignInPrompt'
import { Toaster, toastInfo } from './ui/toast'
import { onTxEvent } from './lib/timing'
import Landing from './pages/Landing'
import Split from './pages/Split'
import Trade from './pages/Trade'
import Dividends from './pages/Dividends'
import Portfolio from './pages/Portfolio'
import Market from './pages/Market'
import About from './pages/About'
import Judges from './pages/Judges'

const PILL_TITLE = 'Mock tokens only. No real money, no real equity.'

type Tab = { path: string; label: string; match: (path: string) => boolean; icon: ReactNode }

const TABS: Tab[] = [
  { path: '/split', label: 'Split', match: (p) => p === '/split', icon: <SplitIcon /> },
  { path: '/trade/dividend', label: 'Trade', match: (p) => p.startsWith('/trade'), icon: <TradeIcon /> },
  { path: '/dividends', label: 'Dividends', match: (p) => p === '/dividends', icon: <DividendIcon /> },
  { path: '/portfolio', label: 'Portfolio', match: (p) => p === '/portfolio', icon: <PortfolioIcon /> },
  { path: '/market', label: 'Market', match: (p) => p === '/market', icon: <MarketIcon /> },
]

function AppShell() {
  const path = usePath()
  const session = useSession()
  const signedIn = session.wallet !== null
  const rpcOk = useRpcHealth()
  const [welcome, setWelcome] = useState(false)
  const createdRef = useRef(false)

  useEffect(() => {
    if (session.created && !createdRef.current) setWelcome(true)
    createdRef.current = session.created
  }, [session.created])

  useEffect(() => {
    if (!welcome) return
    const timer = window.setTimeout(() => {
      setWelcome(false)
      navigate('/split', { replace: true })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [welcome])

  useEffect(() => {
    return onTxEvent((event) => {
      if (event.type === 'first') {
        toastInfo(`⚡ First transaction in ${event.seconds.toFixed(1)} s`)
      }
    })
  }, [])

  const secureContext = typeof window !== 'undefined' && window.isSecureContext
  const webauthnAvailable =
    typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined'

  const [welcomeBusy, setWelcomeBusy] = useState(false)
  const [welcomeError, setWelcomeError] = useState<string | null>(null)

  const signInFromBar = async () => {
    setWelcomeBusy(true)
    setWelcomeError(null)
    try {
      await session.signIn()
    } catch (cause) {
      setWelcomeError(describeError(cause))
    } finally {
      setWelcomeBusy(false)
    }
  }

  return (
    <div className="shell">
      {!secureContext && (
        <div className="status-strip">Passkeys need an HTTPS context — serve over HTTPS or localhost.</div>
      )}
      {secureContext && !webauthnAvailable && (
        <div className="status-strip">This browser does not expose WebAuthn. Try Chrome or Safari.</div>
      )}
      {!rpcOk && <div className="status-strip">Live data delayed — showing last known values.</div>}

      <header className="topbar">
        <Link className="topbar__brand" to="/" aria-label="Cleave home">
          <Logo size={30} />
          <span className="topbar__wordmark">cleave</span>
        </Link>
        <div className="topbar__spacer" />
        <div className="topbar__right">
          <span className="chip pill--simulated" title={PILL_TITLE}>
            SIMULATED · MONAD TESTNET
          </span>
          {signedIn ? (
            <AccountChip />
          ) : (
            <Link className="btn btn--primary" to="/">
              Sign in
            </Link>
          )}
        </div>
      </header>

      {!signedIn && (
        <div className="welcomebar" role="status">
          <span className="welcomebar__text">Welcome back —</span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={welcomeBusy}
            onClick={() => void signInFromBar()}
          >
            {welcomeBusy ? 'Waiting for authenticator…' : 'Sign in'}
          </button>
          {welcomeError !== null && <span className="welcomebar__note">{welcomeError}</span>}
        </div>
      )}

      <nav className="tabs" aria-label="Primary">
        {TABS.map((tab) => (
          <Link
            key={tab.path}
            className={`tabs__link${tab.match(path) ? ' tabs__link--active' : ''}`}
            to={tab.path}
            aria-current={tab.match(path) ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <main className="main">
        <Page path={path} signedIn={signedIn} />
      </main>

      <nav className="bottombar" aria-label="Primary">
        {TABS.map((tab) => (
          <Link
            key={tab.path}
            className={`bottombar__link${tab.match(path) ? ' bottombar__link--active' : ''}`}
            to={tab.path}
            aria-current={tab.match(path) ? 'page' : undefined}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>

      <footer className="footer">
        <span>Cleave is a hackathon demo on Monad Testnet.</span>
        <span className="footer__links">
          <Link to="/about">About &amp; risks</Link>
          <Link to="/judges">Judges</Link>
          <a href="https://github.com/stephen-gabriel/cleave" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </footer>

      <Toaster />

      {welcome && (
        <div className="modal-backdrop overlay-welcome">
          <div className="overlay-welcome__inner">
            <div className="overlay-welcome__check" aria-hidden>
              ✓
            </div>
            <p>You&apos;re in.</p>
          </div>
        </div>
      )}

      {session.expired && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Session expired</h2>
            <p className="muted">
              Your signing session ended for your safety. Continue with one passkey prompt.
            </p>
            <button type="button" className="btn btn--primary" onClick={() => void session.signIn()}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Page({ path, signedIn }: { path: string; signedIn: boolean }) {
  if (path === '/') {
    if (signedIn) return <Redirect to="/split" />
    return <Landing />
  }

  const tradeParams = matchPath('/trade/:leg', path)
  if (tradeParams !== null) {
    if (!signedIn) return <SignInPrompt />
    return <Trade leg={tradeParams.leg} />
  }

  switch (path) {
    case '/split':
      return signedIn ? <Split /> : <SignInPrompt />
    case '/dividends':
      return signedIn ? <Dividends /> : <SignInPrompt />
    case '/portfolio':
      return signedIn ? <Portfolio /> : <SignInPrompt />
    case '/market':
      return <Market />
    case '/about':
      return <About />
    case '/judges':
      return <Judges />
    default:
      return (
        <section className="card" style={{ maxWidth: 560 }}>
          <h2>Page not found</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            That route does not exist. <Link to="/">Back to the landing page.</Link>
          </p>
        </section>
      )
  }
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true })
  }, [to])
  return null
}

function useRpcHealth(): boolean {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        await publicClient.getChainId()
        if (alive) setOk(true)
      } catch {
        if (alive) setOk(false)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 20_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  return ok
}

export default function App() {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  )
}

function SplitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <path d="M12 3v18" strokeDasharray="2 3" />
    </svg>
  )
}

function TradeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 17V7" />
      <path d="M17 17V7" />
      <path d="M3 19h18" />
    </svg>
  )
}

function DividendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.5 10.5h5" />
    </svg>
  )
}

function PortfolioIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 6.5h16v11H4z" />
      <path d="M9 21h6" />
      <path d="M12 17v4" />
    </svg>
  )
}

function MarketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 19V9" />
      <path d="M10 19V5" />
      <path d="M15 19v-7" />
      <path d="M20 19V3" />
      <path d="M3 21h18" />
    </svg>
  )
}