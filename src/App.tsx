import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createWalletClient, formatEther, formatUnits, http, parseEther } from 'viem'
import type { Hash } from 'viem'
import { monadTestnet } from 'viem/chains'
import {
  DEPLOYER_ADDRESS,
  EVM_ACCOUNT_PATH,
  FUND_DEPLOYER_AMOUNT_MON,
  MINT_GAS_LIMIT,
  MOCK_STOCK_ABI,
  MOCK_STOCK_ADDRESS,
  SEND_AMOUNT_MON,
  TRANSFER_GAS_LIMIT,
} from './config'
import { requiredBalance, resolveFees, sendWithFees, type Fees } from './fees'
import {
  connect,
  describeError,
  explorerTxUrl,
  FAUCET_URL,
  forgetCredential,
  loadCredential,
  publicClient,
  type ConnectMode,
  type PasskeyWallet,
} from './wallet'
import './App.css'

/**
 * Used only for the first paint, before the live baseFee is known. Matches the
 * 100 gwei baseFee and 2 gwei priority fee observed on Monad testnet.
 */
const FALLBACK_FEES: Fees = {
  maxFeePerGas: 200_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  baseFeePerGas: 100_000_000_000n,
}

type Action = 'connect' | 'send' | 'fund' | 'mint'

type Result = {
  label: string
  hash: Hash
  gasUsed: bigint
  status: 'success' | 'reverted'
}

function App() {
  const [hasPasskey, setHasPasskey] = useState(() => loadCredential() !== undefined)
  const [wallet, setWallet] = useState<PasskeyWallet | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [stock, setStock] = useState<{ balance: bigint; mintAmount: bigint } | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fees, setFees] = useState<Fees | null>(null)

  const walletRef = useRef<PasskeyWallet | null>(null)
  const busy = action !== null

  const dispose = useCallback(() => {
    walletRef.current?.session.end()
    walletRef.current = null
  }, [])

  useEffect(() => dispose, [dispose])

  const walletClient = useMemo(
    () =>
      wallet === null
        ? null
        : createWalletClient({
            account: wallet.account,
            chain: monadTestnet,
            transport: http(),
          }),
    [wallet],
  )

  const readStock = useCallback(async (holder: `0x${string}`) => {
    if (MOCK_STOCK_ADDRESS === undefined) {
      setStock(null)
      return
    }
    try {
      const [tokenBalance, mintAmount] = await Promise.all([
        publicClient.readContract({
          address: MOCK_STOCK_ADDRESS,
          abi: MOCK_STOCK_ABI,
          functionName: 'balanceOf',
          args: [holder],
        }),
        publicClient.readContract({
          address: MOCK_STOCK_ADDRESS,
          abi: MOCK_STOCK_ABI,
          functionName: 'MINT_AMOUNT',
        }),
      ])
      setStock({ balance: tokenBalance, mintAmount })
    } catch {
      setStock(null)
    }
  }, [])

  const refresh = useCallback(
    async (holder: `0x${string}`) => {
      setBalance(await publicClient.getBalance({ address: holder }))
      await readStock(holder)
      try {
        setFees(await resolveFees())
      } catch {
        // Keep the last known fees; sendWithFees re-resolves before every send.
      }
    },
    [readStock],
  )

  const run = useCallback(
    async (which: Action, label: string, send: () => Promise<Hash>) => {
      const holder = walletRef.current?.account.address
      if (holder === undefined) return
      setAction(which)
      setError(null)
      setResult(null)
      try {
        const hash = await send()
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        setResult({ label, hash, gasUsed: receipt.gasUsed, status: receipt.status })
        await refresh(holder)
      } catch (cause) {
        setError(describeError(cause))
      } finally {
        setAction(null)
      }
    },
    [refresh],
  )

  const onConnect = async (mode: ConnectMode) => {
    setAction('connect')
    setError(null)
    try {
      dispose()
      const { wallet: opened, created } = await connect(window.location.hostname, mode)
      walletRef.current = opened
      setWallet(opened)
      setResult(null)
      setHasPasskey(loadCredential() !== undefined)
      await refresh(opened.account.address)
      if (created) {
        setError(
          'New passkey created. This is a separate account with its own balance, not your previous one.',
        )
      }
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setAction(null)
    }
  }

  const onSendToSelf = () => {
    const client = walletClient
    const me = wallet?.account.address
    if (client === null || me === undefined) return
    return run('send', `Sent ${SEND_AMOUNT_MON} MON to self`, () =>
      sendWithFees(
        (fees) =>
          client.sendTransaction({
            to: me,
            value: parseEther(SEND_AMOUNT_MON),
            gas: TRANSFER_GAS_LIMIT,
            ...fees,
          }),
        TRANSFER_GAS_LIMIT,
        balance ?? 0n,
      ),
    )
  }

  const onFundDeployer = () => {
    const client = walletClient
    const deployer = DEPLOYER_ADDRESS
    if (client === null || deployer === undefined) return
    return run('fund', `Funded deployer with ${FUND_DEPLOYER_AMOUNT_MON} MON`, () =>
      sendWithFees(
        (fees) =>
          client.sendTransaction({
            to: deployer,
            value: parseEther(FUND_DEPLOYER_AMOUNT_MON),
            gas: TRANSFER_GAS_LIMIT,
            ...fees,
          }),
        TRANSFER_GAS_LIMIT,
        balance ?? 0n,
      ),
    )
  }

  const onMint = () => {
    const client = walletClient
    const token = MOCK_STOCK_ADDRESS
    if (client === null || token === undefined) return
    return run('mint', 'Minted MockStock', () =>
      sendWithFees(
        (fees) =>
          client.writeContract({
            address: token,
            abi: MOCK_STOCK_ABI,
            functionName: 'mint',
            gas: MINT_GAS_LIMIT,
            ...fees,
          }),
        MINT_GAS_LIMIT,
        balance ?? 0n,
      ),
    )
  }

  const onLock = () => {
    dispose()
    setWallet(null)
    setBalance(null)
    setStock(null)
    setResult(null)
  }

  const onReset = () => {
    dispose()
    forgetCredential()
    setHasPasskey(false)
    setWallet(null)
    setBalance(null)
    setStock(null)
    setResult(null)
    setError(
      'Cached credential forgotten. Sign in again to pick the same passkey back up; no funds are affected.',
    )
  }

  const secureContext = window.isSecureContext
  const webauthnAvailable = typeof window.PublicKeyCredential !== 'undefined'
  const mon = balance === null ? null : Number(formatEther(balance)).toFixed(4)
  // Mirrors the node's own upfront check so the button reflects real affordability
// instead of letting a thin account discover the problem through an RPC error.
const mintRequirementWei =
    fees === null ? requiredBalance(MINT_GAS_LIMIT, FALLBACK_FEES) : requiredBalance(MINT_GAS_LIMIT, fees)
  const mintRequirement = formatEther(mintRequirementWei)
  const canAffordMint = balance === null || balance >= mintRequirementWei

  return (
    <main className="app">
      <header className="head">
        <h1>Passkey wallet on Monad</h1>
        <p className="sub">
          @category-labs/mera derives an EVM key from a WebAuthn PRF output. viem signs
          and broadcasts; the private key never leaves the signing session.
        </p>
      </header>

      {!secureContext && (
        <p className="banner banner--warn">
          WebAuthn needs a secure context. Serve this app over HTTPS, or use localhost.
        </p>
      )}
      {secureContext && !webauthnAvailable && (
        <p className="banner banner--warn">
          This browser does not expose the WebAuthn credential API.
        </p>
      )}

      {wallet === null ? (
        <section className="card">
          <h2>Sign in</h2>
          <p className="muted">
            Select the passkey you registered for this site and its PRF output
            re-derives the same account.
          </p>
          <dl className="facts">
            <div>
              <dt>Relying party</dt>
              <dd>{window.location.hostname}</dd>
            </div>
            <div>
              <dt>Chain</dt>
              <dd>
                {monadTestnet.name} · {monadTestnet.id}
              </dd>
            </div>
            <div>
              <dt>Derivation path</dt>
              <dd>{EVM_ACCOUNT_PATH}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => void onConnect('discoverable')}
            disabled={busy || !secureContext || !webauthnAvailable}
          >
            {action === 'connect' ? 'Waiting for authenticator…' : 'Sign in with existing passkey'}
          </button>

          {/*
            Discovery does not depend on localStorage: getPasskeyPrfOutput with no
            allowCredentials lets the authenticator offer every credential it holds
            for this rpId, and the PRF output re-derives the same account. Clearing
            site data therefore costs nothing. Creating a new passkey is a separate
            account with its own balance, so it sits behind a secondary button.
          */}
          <p className="muted">
            Finds this account from the passkey itself, so clearing site data does not
            strand funds.
          </p>

          <button
            type="button"
            className="ghost"
            onClick={() => void onConnect('create')}
            disabled={busy || !secureContext || !webauthnAvailable}
          >
            Create a new passkey instead
          </button>
          <p className="muted">
            This derives a different address with its own balance. Use it only if you
            want a second account.
          </p>

          {hasPasskey && (
            <button type="button" className="ghost" onClick={onReset}>
              Forget cached credential
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="card">
            <h2>Account</h2>
            <p className="label">Address</p>
            <p className="address">{wallet.account.address}</p>

            <dl className="facts">
              <div>
                <dt>MON balance</dt>
                <dd>{mon === null ? '…' : `${mon} MON`}</dd>
              </div>
              <div>
                <dt>Derivation path</dt>
                <dd>{EVM_ACCOUNT_PATH}</dd>
              </div>
              <div>
                <dt>Adapter</dt>
                <dd>toViemAccount · source {wallet.account.source}</dd>
              </div>
            </dl>

            <button type="button" onClick={onSendToSelf} disabled={busy}>
              {action === 'send' ? 'Sending…' : `Send ${SEND_AMOUNT_MON} MON to myself`}
            </button>

            <dl className="facts">
              <div>
                <dt>Amount</dt>
                <dd>{SEND_AMOUNT_MON} MON</dd>
              </div>
              <div>
                <dt>Gas limit</dt>
                <dd>{TRANSFER_GAS_LIMIT.toLocaleString('en-US')}</dd>
              </div>
            </dl>

            <p className="muted">
              Monad charges the declared gas limit, so this transfer declares exactly{' '}
              {TRANSFER_GAS_LIMIT.toLocaleString('en-US')} — the intrinsic cost of a
              value transfer with no calldata. Get testnet MON from the{' '}
              <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                faucet
              </a>
              .
            </p>
          </section>

          <section className="card">
            <h2>MockStock</h2>

            {MOCK_STOCK_ADDRESS === undefined ? (
              <>
                <p className="muted">
                  Not deployed yet. Fund the throwaway deployer, then run{' '}
                  <code>npm run deploy:mockstock</code> and restart the dev server.
                </p>
                <dl className="facts">
                  <div>
                    <dt>Deployer</dt>
                    <dd>{DEPLOYER_ADDRESS ?? 'not configured'}</dd>
                  </div>
                  <div>
                    <dt>Needs</dt>
                    <dd>{FUND_DEPLOYER_AMOUNT_MON} MON</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={onFundDeployer}
                  disabled={busy || DEPLOYER_ADDRESS === undefined}
                >
                  {action === 'fund'
                    ? 'Funding…'
                    : `Fund deployer with ${FUND_DEPLOYER_AMOUNT_MON} MON`}
                </button>
              </>
            ) : (
              <>
                <p className="label">Contract</p>
                <p className="address">{MOCK_STOCK_ADDRESS}</p>
                <dl className="facts">
                  <div>
                    <dt>Your balance</dt>
                    <dd>{stock === null ? '…' : `${formatUnits(stock.balance, 18)} MOCK`}</dd>
                  </div>
                  <div>
                    <dt>Per mint</dt>
                    <dd>{stock === null ? '…' : `${formatUnits(stock.mintAmount, 18)} MOCK`}</dd>
                  </div>
<div>
                    <dt>Gas limit</dt>
                    <dd>{MINT_GAS_LIMIT.toLocaleString('en-US')}</dd>
                  </div>
                  <div>
                    <dt>Max fee</dt>
                    <dd>
                      {fees === null
                        ? '…'
                        : `${(Number(fees.maxFeePerGas) / 1e9).toString()} gwei`}
                    </dd>
                  </div>
                </dl>
                <button type="button" onClick={onMint} disabled={busy || !canAffordMint}>
              {action === 'mint' ? 'Minting…' : 'Mint MockStock'}
            </button>
            {!canAffordMint && mon !== null && (
              <p className="muted">
                Needs {mintRequirement} MON to cover the declared gas limit. This account holds{' '}
                {mon} MON — top up from the{' '}
                <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                  faucet
                </a>
                .
              </p>
            )}
                <a
                  className="hash"
                  href={`${monadTestnet.blockExplorers.default.url}/address/${MOCK_STOCK_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View contract on explorer
                </a>
              </>
            )}
          </section>

          {result !== null && (
            <section className="card result">
              <p className="label">{result.label}</p>
              <a className="hash" href={explorerTxUrl(result.hash)} target="_blank" rel="noreferrer">
                {result.hash}
              </a>
              <p className="muted">
                {result.status === 'success' ? 'Confirmed' : 'Reverted'} · gas used{' '}
                {result.gasUsed.toLocaleString('en-US')}
              </p>
            </section>
          )}

          <button type="button" className="ghost lock" onClick={onLock}>
            Lock session
          </button>
        </>
      )}

      {error !== null && <p className="banner banner--error">{error}</p>}
    </main>
  )
}

export default App