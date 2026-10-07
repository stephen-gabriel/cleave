import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { network } from 'hardhat'

describe('Cleave contracts', () => {
  it('connects to the simulated network', async () => {
    const { viem } = await network.create()
    const publicClient = await viem.getPublicClient()
    const blockNumber = await publicClient.getBlockNumber()
    assert.ok(blockNumber >= 0n)
  })
})
