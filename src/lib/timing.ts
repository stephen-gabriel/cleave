export type TxEvent =
  | { type: 'confirmed'; hash: string; seconds: number }
  | { type: 'first'; seconds: number }

type Listener = (event: TxEvent) => void

const listeners = new Set<Listener>()

export function onTxEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(event: TxEvent): void {
  for (const listener of listeners) listener(event)
}

let landingInteractMs: number | null = null
let firstConfirmed: number | null = null

export function noteLandingInteraction(): void {
  if (landingInteractMs === null) landingInteractMs = Date.now()
}

export function timeToFirstTxMs(): number | null {
  if (landingInteractMs === null || firstConfirmed === null) return null
  return firstConfirmed - landingInteractMs
}

export function isFirstTx(): boolean {
  return firstConfirmed === null
}

export function reportConfirmedTx(hash: string, seconds: number): { isFirst: boolean } {
  const nowMs = Date.now()
  const first = firstConfirmed === null
  if (first) {
    firstConfirmed = nowMs
    const from = landingInteractMs ?? nowMs
    emit({ type: 'first', seconds: (nowMs - from) / 1000 })
  }
  emit({ type: 'confirmed', hash, seconds })
  return { isFirst: first }
}

export function startTxTimer(): () => number {
  const startMs = Date.now()
  return () => confirmedSeconds(startMs)
}

function confirmedSeconds(startMs: number): number {
  return Math.max(0, Date.now() - startMs) / 1000
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}