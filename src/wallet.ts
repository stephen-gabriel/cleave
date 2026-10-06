import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
} from '@category-labs/mera'
import { toViemAccount } from '@category-labs/mera/viem'
import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { createPublicClient, http } from 'viem'
import { monadTestnet } from 'viem/chains'
import { EVM_ACCOUNT_PATH } from './config'

export const FAUCET_URL = 'https://faucet.monad.xyz'

const CREDENTIAL_STORAGE_KEY = 'cleave.passkeyCredential'

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
})

export function explorerTxUrl(hash: string): string {
  return `${monadTestnet.blockExplorers.default.url}/tx/${hash}`
}

export function loadCredential(): PasskeyCredentialMetadata | undefined {
  const raw = localStorage.getItem(CREDENTIAL_STORAGE_KEY)
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { credentialId, transports } = parsed as Partial<PasskeyCredentialMetadata>
    if (typeof credentialId !== 'string' || credentialId === '') return undefined
    return { credentialId, transports }
  } catch {
    return undefined
  }
}

function saveCredential(credential: PasskeyCredentialMetadata): void {
  localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(credential))
}

export function forgetCredential(): void {
  localStorage.removeItem(CREDENTIAL_STORAGE_KEY)
}

export type PasskeyWallet = {
  session: Secp256k1SigningSession
  account: ReturnType<typeof toViemAccount>
}

function openWallet(prfOutput: Uint8Array): PasskeyWallet {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist)
  const seed = mnemonicToSeedSync(mnemonic)
  const node = HDKey.fromMasterSeed(seed).derive(EVM_ACCOUNT_PATH)
  const privateKey = node.privateKey
  if (privateKey === null) {
    throw new Error(`${EVM_ACCOUNT_PATH} produced no private key`)
  }
  const session = createSecp256k1SigningSession({ privateKey })
  return { session, account: toViemAccount(session) }
}

export type ConnectMode = 'stored' | 'discoverable' | 'create'

export async function connect(
  rpId: string,
  mode: ConnectMode,
): Promise<{ wallet: PasskeyWallet; created: boolean }> {
  // A stored credentialId is only a UX shortcut. Identity comes from the PRF
  // output, which the authenticator recomputes from the credential itself, so
  // clearing site data loses no funds: 'discoverable' lets the platform offer
  // any credential registered for this rpId and derives the same account.
  if (mode === 'stored') {
    const known = loadCredential()
    if (known === undefined) return connect(rpId, 'discoverable')
    const { prfOutput, credentialId } = await getPasskeyPrfOutput({ rpId, credential: known })
    saveCredential({ ...known, credentialId })
    return { wallet: openWallet(prfOutput), created: false }
  }

  if (mode === 'discoverable') {
    const { prfOutput, credentialId } = await getPasskeyPrfOutput({ rpId })
    // Re-cache the selected credential so later sign-ins can skip the picker.
    // Transports are unknown for a discovered credential; WebAuthn treats a
    // missing list as "try all", which is what we want.
    saveCredential({ credentialId })
    return { wallet: openWallet(prfOutput), created: false }
  }

  const result = await createPasskeyWithPrfOutput({
    rp: { id: rpId, name: 'Cleave' },
    user: { name: rpId, displayName: 'Cleave account' },
  })
  saveCredential({ credentialId: result.credentialId, transports: result.transports })
  return { wallet: openWallet(result.prfOutput), created: true }
}

export function describeError(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === 'PRF_UNAVAILABLE') {
      return 'This authenticator returned no WebAuthn PRF output. Use a PRF-capable authenticator such as 1Password, iCloud Keychain, or a platform passkey on a current OS.'
    }
    if (error.code === 'SESSION_ENDED') {
      return 'The signing session has ended. Sign in again.'
    }
    if (error.code === 'PASSKEY_OPERATION_FAILED') {
      return 'Sign-in was cancelled or no passkey matched this site. Use "Create a new passkey instead" if you have not registered one here yet.'
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}