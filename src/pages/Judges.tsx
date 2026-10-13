import './About.css'

export default function Judges() {
  return (
    <div className="about">
      <section className="card" aria-label="Judge walkthrough">
        <h2>Judges — 2 minute walkthrough</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          No login is needed. Open the app, tap <strong>Create your account</strong>, approve the
          passkey prompt (desktop Chrome with a password manager, or Safari/1Password). Then:
        </p>
        <ol className="muted" style={{ marginTop: 12, paddingLeft: 20 }}>
          <li>
            <strong>Starter pack</strong> — fee credit is added automatically on a new account.
          </li>
          <li>
            <strong>Split</strong> 100 mACME → receive dACME-A (dividend leg) and pACME-A (price leg).
          </li>
          <li>
            <strong>Trade</strong> the dividend leg — note fair value chip, price impact, min received,
            and SIM tags in the trades feed.
          </li>
          <li>
            <strong>Dividends</strong> → press <em>Declare dividend (demo)</em> → wait for the
            countdown → <em>Pay dividend</em> → Portfolio shows claimable → <em>Claim</em>.
          </li>
          <li>
            <strong>Stateless test</strong> — clear site data (or fresh profile) → <em>Sign in</em> →
            same address, balances, and history. Identity lives in the passkey; positions live on
            chain.
          </li>
        </ol>
      </section>

      <section className="card" aria-label="What to look for">
        <h2>What to look for</h2>
        <ul className="muted" style={{ marginTop: 8, paddingLeft: 20 }}>
          <li>One passkey tap in; no extension, no seed phrase, no email.</li>
          <li>Fair value + price impact + risk disclosure on every trade ticket.</li>
          <li>CRE-driven dividend badge on Dividends (declare → countdown → pay → claim).</li>
          <li>Market page splits volume into simulated vs organic, honestly.</li>
          <li>Everything is mock assets on Monad Testnet — labelled in the UI.</li>
        </ul>
      </section>

      <section className="card" aria-label="Links">
        <h2>Links</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Live app:{' '}
          <a href="https://cleave-web.vercel.app" target="_blank" rel="noreferrer">
            cleave-web.vercel.app
          </a>
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          Repo:{' '}
          <a href="https://github.com/stephen-gabriel/cleave" target="_blank" rel="noreferrer">
            github.com/stephen-gabriel/cleave
          </a>
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          If fee credit runs out, use the{' '}
          <a href="https://faucet.monad.xyz/" target="_blank" rel="noreferrer">
            Monad faucet
          </a>{' '}
          or the in-app faucet link.
        </p>
      </section>
    </div>
  )
}
