import { describe, it, expect } from 'vitest'
import { deriveDeclarationStatus, deriveDemoCooldownSeconds } from '../src/lib/dividends'

// Facts from the live CRE broadcast under test:
// declaration #5, declaredAt 1791892204, exAt 1791892264 (chain time later than exAt),
// Splitter nextDistributionId = 5 → distributedCount = 4.
const EX_AT_5 = 1_791_892_264
const DECLARED_AT_5 = 1_791_892_204
const CHAIN_TIME_AFTER_NOTICE = 1_791_893_401

describe('deriveDeclarationStatus', () => {
  it('shows none while no declaration is loaded', () => {
    expect(
      deriveDeclarationStatus({ latestId: null, exAt: null, distributedCount: null, matured: false, nowSec: 100 }),
    ).toBe('none')
  })

  it('shows none while the declaration exAt is still loading', () => {
    expect(
      deriveDeclarationStatus({ latestId: 5, exAt: null, distributedCount: 4, matured: false, nowSec: 100 }),
    ).toBe('none')
  })

  it('counts down before exAt', () => {
    expect(
      deriveDeclarationStatus({
        latestId: 5,
        exAt: EX_AT_5,
        distributedCount: 4,
        matured: false,
        nowSec: EX_AT_5 - 30,
      }),
    ).toBe('countdown')
  })

  it('regression: declared #5 with expired notice and undistributed cursor is ready to pay, not none', () => {
    expect(
      deriveDeclarationStatus({
        latestId: 5,
        exAt: EX_AT_5,
        distributedCount: 4,
        matured: false,
        nowSec: CHAIN_TIME_AFTER_NOTICE,
      }),
    ).toBe('ready')
  })

  it('treats an unloaded distribution cursor as not yet distributed', () => {
    expect(
      deriveDeclarationStatus({ latestId: 5, exAt: EX_AT_5, distributedCount: null, matured: false, nowSec: EX_AT_5 }),
    ).toBe('ready')
  })

  it('shows paid once the latest declaration id has been distributed', () => {
    expect(
      deriveDeclarationStatus({
        latestId: 5,
        exAt: EX_AT_5,
        distributedCount: 5,
        matured: false,
        nowSec: EX_AT_5 + 100,
      }),
    ).toBe('paid')
  })

  it('shows paid after maturity regardless of the countdown', () => {
    expect(
      deriveDeclarationStatus({
        latestId: 5,
        exAt: EX_AT_5,
        distributedCount: 4,
        matured: true,
        nowSec: EX_AT_5 - 30,
      }),
    ).toBe('paid')
  })
})

describe('deriveDemoCooldownSeconds', () => {
  it('is zero for CRE-sourced declarations', () => {
    expect(
      deriveDemoCooldownSeconds({
        source: 'CRE',
        distributedCount: 4,
        declaredAt: DECLARED_AT_5,
        nowSec: DECLARED_AT_5 + 10,
        cooldownSeconds: 120,
      }),
    ).toBe(0)
  })

  it('is zero before the first distribution', () => {
    expect(
      deriveDemoCooldownSeconds({
        source: 'Demo',
        distributedCount: 0,
        declaredAt: DECLARED_AT_5,
        nowSec: DECLARED_AT_5 + 10,
        cooldownSeconds: 120,
      }),
    ).toBe(0)
  })

  it('counts down after a demo declaration once distributions have happened', () => {
    expect(
      deriveDemoCooldownSeconds({
        source: 'Demo',
        distributedCount: 4,
        declaredAt: DECLARED_AT_5,
        nowSec: DECLARED_AT_5 + 30,
        cooldownSeconds: 120,
      }),
    ).toBe(90)
  })

  it('clamps to zero once the cooldown expires', () => {
    expect(
      deriveDemoCooldownSeconds({
        source: 'Demo',
        distributedCount: 4,
        declaredAt: DECLARED_AT_5,
        nowSec: DECLARED_AT_5 + 500,
        cooldownSeconds: 120,
      }),
    ).toBe(0)
  })

  it('is zero while declaredAt is still loading', () => {
    expect(
      deriveDemoCooldownSeconds({
        source: 'Demo',
        distributedCount: 4,
        declaredAt: null,
        nowSec: DECLARED_AT_5 + 10,
        cooldownSeconds: 120,
      }),
    ).toBe(0)
  })
})
