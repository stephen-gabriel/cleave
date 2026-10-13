// Pure "Next dividend" panel state machine (ui_spec §7):
// none → declared (countdown to exAt) → ready (Pay) → paid → claim.
// Driven by chain facts: the oracle's latest declaration and the Splitter's
// distribution cursor (`distributedCount` vs the latest declaration id).

export type DeclarationStatus = 'none' | 'countdown' | 'ready' | 'paid'

export function deriveDeclarationStatus(input: {
  /** Latest declaration id (oracle count), or null while no declaration is loaded. */
  latestId: number | null
  /** `latest().exAt` from the DividendOracle, or null while loading. */
  exAt: number | null
  /** Splitter `distributedCount()` — declarations paid so far. */
  distributedCount: number | null
  matured: boolean
  nowSec: number
}): DeclarationStatus {
  if (input.latestId === null) return 'none'
  if (input.matured) return 'paid'
  if (input.exAt === null) return 'none'
  if (input.nowSec < input.exAt) return 'countdown'
  return (input.distributedCount ?? 0) < input.latestId ? 'ready' : 'paid'
}

export function deriveDemoCooldownSeconds(input: {
  source: 'CRE' | 'Demo'
  /** Splitter `distributedCount()` — cooldown display starts after the first distribution. */
  distributedCount: number | null
  /** `latest().declaredAt` from the DividendOracle, or null while loading. */
  declaredAt: number | null
  nowSec: number
  cooldownSeconds: number
}): number {
  if (input.source !== 'Demo') return 0
  if (input.distributedCount === null || input.distributedCount === 0) return 0
  if (input.declaredAt === null) return 0
  return Math.max(0, input.declaredAt + input.cooldownSeconds - input.nowSec)
}
