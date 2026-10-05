import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { setEnvValue } from './lib/env.ts'

const key = generatePrivateKey()
const account = privateKeyToAccount(key)

await setEnvValue('VITE_DEPLOYER_ADDRESS', account.address)

const { writeFile } = await import('node:fs/promises')
await writeFile(
  '.env.deployer',
  `# Throwaway Monad Testnet deployer key. Fund it from the app's "Fund deployer" button.\nDEPLOYER_PRIVATE_KEY=${key}\n`,
  'utf8',
)

console.log(`deployer  : ${account.address}`)
console.log('wrote     : .env.deployer (gitignored) and VITE_DEPLOYER_ADDRESS in .env')
console.log('next      : open the app and click "Fund deployer"')