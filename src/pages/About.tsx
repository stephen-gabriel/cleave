import './About.css'

export default function About() {
  return (
    <div className="about">
      <section className="card" aria-label="How Cleave works">
        <h2>How Cleave works</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          A tokenized stock is deposited into a Splitter and comes back as two ERC-20 legs: a price leg
          (the stock&apos;s ups and downs) and a dividend leg (every cash distribution until maturity).
          Hold either, trade either, or merge them back into the stock before maturity. At maturity the
          price leg redeems for the stock; the dividend leg is worth nothing after the last payout.
        </p>
        <p className="mono" style={{ marginTop: 12 }}>
          1 pACME-A + 1 dACME-A = 1 mACME
        </p>
      </section>

      <section className="card" aria-label="How legs are priced">
        <h2>How legs are priced</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Each leg trades in its own constant-product pool against mUSD. Fair value for the dividend leg
          is the remaining declared dividends × the latest oracle amount per share; the price leg&apos;s
          fair value is the reference stock price minus that amount. The Trade page shows pool price vs
          fair value, price impact, and minimum received before you sign.
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          When a dividend is paid, value moves from the price leg into the dividend leg, keeping
          1 pACME-A + 1 dACME-A ≈ 1 mACME. That reprice is visible on the chart around ex-dividend time.
        </p>
      </section>

      <section className="card" aria-label="What is simulated">
        <h2>What is simulated</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Contracts, settlement, pricing math, passkey accounts and the CRE→oracle→Splitter path are
          real on Monad Testnet. The stock and USD are mock tokens. The CRE dividend feed is a labelled
          simulated endpoint because real tokenized-equity feeds are not available on testnet. Volume
          labelled SIM comes from our own test wallets and is shown separately from organic volume on
          the Market page.
        </p>
      </section>

      <section className="card" aria-label="Known limitations">
        <h2>Known limitations</h2>
        <ul className="muted" style={{ marginTop: 8, paddingLeft: 20 }}>
          <li>Single series (Series A); multi-series and snapshot payouts are roadmap.</li>
          <li>Entitlement is by holders at the payout transaction — production would use snapshots.</li>
          <li>Fee-credit drip is capped; if it runs out, use the Monad faucet link.</li>
          <li>Indexer is eventually consistent; charts show last known values if Envio is briefly down.</li>
          <li>Hackathon demo — not a live exchange, not financial advice.</li>
        </ul>
      </section>

      <section className="card" aria-label="Built with">
        <h2>Built with</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Solidity + Hardhat on Monad Testnet · React + TypeScript + Vite · Mera passkey accounts
          (WebAuthn PRF sessions) · Chainlink CRE workflow via Keystone forwarder · Envio HyperIndex ·
          viem.
        </p>
      </section>
    </div>
  )
}
