import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }))
vi.mock('@category-labs/mera', async (original) => ({
  ...await original<typeof import('@category-labs/mera')>(),
  getPasskeyPrfOutput: mocks.get,
  createPasskeyWithPrfOutput: mocks.create,
}))
vi.mock('../src/chain/clients', () => ({ publicClient: {} }))
import { createAccount, signIn } from '../src/wallet/mera'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('recovers the same account from the same passkey without any browser storage', async () => {
  vi.stubGlobal('window', { location: { hostname: 'cleave-web.vercel.app' } })
  const blockedStorage = new Proxy({}, { get: () => { throw new Error('Identity must not use storage') } })
  vi.stubGlobal('localStorage', blockedStorage)
  vi.stubGlobal('sessionStorage', blockedStorage)
  vi.stubGlobal('indexedDB', blockedStorage)
  // Synthetic PRF fixture only; no real passkey or funded account is used.
  mocks.create.mockResolvedValue({ prfOutput: new Uint8Array(32).fill(7) })
  mocks.get.mockResolvedValue({ prfOutput: new Uint8Array(32).fill(7) })
  const created = await createAccount()
  const address = created.account.address
  created.session.end()
  const recovered = await signIn()
  expect(recovered.account.address).toBe(address)
  expect(mocks.get).toHaveBeenCalledWith({ rpId: 'cleave-web.vercel.app' })
  recovered.session.end()
  mocks.get.mockResolvedValue({ prfOutput: new Uint8Array(32).fill(8) })
  const different = await signIn()
  expect(different.account.address).not.toBe(address)
  different.session.end()
})
