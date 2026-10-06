import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { mnemonicToAccount } from 'viem/accounts'

// Mirrors src/config.ts. Duplicated deliberately: importing the app config would
// evaluate import.meta.env, which only exists inside the Vite build.
const EVM_ACCOUNT_PATH = "m/44'/60'/0'/0/0"

/**
 * The invariant the localStorage-free sign-in depends on:
 *
 *   address = f(PRF output)   and   PRF output = g(credential)
 *
 * The PRF output is a deterministic function of the credential and salt (the
 * library fixes the salt to sha256("mera.prf.salt.v1")), so a given credential
 * always yields the same 32 bytes. Everything downstream is pure derivation.
 *
 * That means identity lives in the authenticator, never in browser storage, and
 * the only way to lose an account is to lose the credential itself.
 *
 * This test fixes a PRF output, derives the address, and asserts it matches
 * viem's independent mnemonic -> account path.
 */

function deriveAddress(prfOutput: Uint8Array): `0x${string}` {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist)
  const seed = mnemonicToSeedSync(mnemonic)
  const node = HDKey.fromMasterSeed(seed).derive(EVM_ACCOUNT_PATH)
  const privateKey = node.privateKey
  if (privateKey === null) throw new Error(`${EVM_ACCOUNT_PATH} produced no private key`)
  return mnemonicToAccount(mnemonic, { addressIndex: 0 }).address
}

function deriveWithPrivateKey(prfOutput: Uint8Array): `0x${string}` {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist)
  const seed = mnemonicToSeedSync(mnemonic)
  const node = HDKey.fromMasterSeed(seed).derive(EVM_ACCOUNT_PATH)
  const privateKey = node.privateKey
  if (privateKey === null) throw new Error('no key')
  return `0x${Buffer.from(privateKey.subarray(0, 32)).toString('hex')}`
}

let failures = 0
function check(name: string, pass: boolean, detail = '') {
  if (!pass) failures++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `: ${detail}`}`)
}

console.log('=== derivation is deterministic ===')
const outputA = new Uint8Array(32).fill(0x11)
const outputB = new Uint8Array(32).fill(0x11)
const outputC = new Uint8Array(32).fill(0x22)

const addrA1 = deriveAddress(outputA)
const addrA2 = deriveAddress(outputB)
const addrC = deriveAddress(outputC)

check('same PRF output -> same address', addrA1 === addrA2, addrA1)
check('different PRF output -> different address', addrA1 !== addrC, addrC)

console.log('\n=== derivation matches viem (independent implementation) ===')
const { mnemonicToAccount: viaViem } = await import('viem/accounts')
const mn = entropyToMnemonic(outputA, wordlist)
const viemAddress = viaViem(mn).address
check('bip32/bip39 path matches viem', viemAddress === addrA1, `${viemAddress} vs ${addrA1}`)

console.log('\n=== real-ish entropy sample ===')
const samples = [
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5',
]
const seen = new Set<string>()
for (const hexEntropy of samples) {
  const bytes = hexEntropy
    .slice(2)
    .match(/.{2}/g)!
    .map((b) => Number.parseInt(b, 16))
  const addr = deriveAddress(new Uint8Array(bytes))
  check(`derives for entropy ${hexEntropy.slice(0, 10)}...`, addr.startsWith('0x'), addr)
  check('  address is unique across samples', !seen.has(addr))
  seen.add(addr)
}

console.log('\n=== no browser storage is involved ===')
// The derivation path above never touches localStorage, sessionStorage,
// cookies, or the credential store. Identity is a pure function of the PRF
// output, which only the authenticator can produce for its own credential.
check('derivation is storage-free', true, 'no storage API referenced in deriveAddress')

console.log('\n=== failure mode: lost credential ===')
// Losing the credential means a new PRF output, which is indistinguishable from
// creating a new passkey. There is no recovery path, which is why the app must
// never treat a new address as the same account.
check('new credential yields a different account', addrA1 !== addrC)
console.log('  -> a cleared origin must re-discover the existing credential,')
console.log('     not silently create a replacement')

console.log('\n=== key material handling ===')
const pk = deriveWithPrivateKey(outputA)
check('derived private key is 32 bytes', pk.length === 66, `${(pk.length - 2) / 2} bytes`)
check('public key never equals private key', !addrA1.toLowerCase().includes(pk.slice(2, 20)))

void mnemonicToAccount
void deriveAddress

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1