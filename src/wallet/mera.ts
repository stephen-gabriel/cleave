import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type Secp256k1SigningSession,
} from '@category-labs/mera'
import { toViemAccount } from '@category-labs/mera/viem'
import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { monadTestnet } from 'viem/chains'

export const EVM_ACCOUNT_PATH = "m/44'/60'/0'/0/0"

export const FAUCET_URL = 'https://faucet.monad.xyz'

export { publicClient } from '../chain/clients'

export function explorerTxUrl(hash: string): string {
  return `${monadTestnet.blockExplorers.default.url}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${monadTestnet.blockExplorers.default.url}/address/${address}`
}

export function rpId(): string {
  return window.location.hostname
}

export type ViemAccount = ReturnType<typeof toViemAccount>
export type PasskeyWallet = {
  session: Secp256k1SigningSession
  account: ViemAccount
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

export async function createAccount(): Promise<PasskeyWallet> {
  const id = rpId()
  const result = await createPasskeyWithPrfOutput({
    rp: { id, name: 'Cleave' },
    user: { name: id, displayName: 'Cleave account' },
  })
  return openWallet(result.prfOutput)
}

export async function signIn(): Promise<PasskeyWallet> {
  const { prfOutput } = await getPasskeyPrfOutput({ rpId: rpId() })
  return openWallet(prfOutput)
}

export function describeError(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === 'PRF_UNAVAILABLE') {
      return 'Your browser can\u2019t create this kind of account yet. Try Chrome with Google Password Manager, Safari on iPhone or Mac, or a password manager like 1Password.'
    }
    if (error.code === 'SESSION_ENDED') {
      return 'The signing session has ended. Sign in again.'
    }
    if (error.code === 'PASSKEY_OPERATION_FAILED') {
      return 'No problem \u2014 nothing was created. Try again when you\u2019re ready.'
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}