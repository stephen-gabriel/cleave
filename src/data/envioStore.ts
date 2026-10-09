import { fetchQuery, type Query } from './envio'
export type Snapshot<T> = { data: T | null; status: 'unconfigured' | 'loading' | 'ready' | 'stale' | 'error'; updatedAt: number | null; error: string | null }
type Entry = { query: Query<unknown>; state: Snapshot<unknown>; listeners: Map<symbol, () => void>; failures: number; nextAt: number }
const INTERVAL = 3000
const MAX_BACKOFF = 30_000
// One scheduler per endpoint, shared by every mounted consumer. Requests are sequential.
export function createEnvioStore(endpoint: string | undefined, load = fetchQuery) {
  const entries = new Map<string, Entry>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let running = false
  const entryFor = (q: Query<unknown>) => {
    let entry = entries.get(q.key)
    if (!entry) {
      entry = { query: q, state: { data: null, status: endpoint ? 'loading' : 'unconfigured', updatedAt: null, error: null }, listeners: new Map(), failures: 0, nextAt: 0 }
      entries.set(q.key, entry)
    }
    return entry
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (running || !endpoint) return
    const active = [...entries.values()].filter(e => e.listeners.size)
    if (active.length) timer = setTimeout(() => void tick(), Math.max(0, Math.min(...active.map(e => e.nextAt)) - Date.now()))
  }
  const tick = async () => {
    timer = undefined
    running = true
    for (const entry of entries.values()) {
      if (!entry.listeners.size || entry.nextAt > Date.now()) continue
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10_000)
      try {
        const data = await load(endpoint!, entry.query, controller.signal)
        if (!entry.listeners.size) continue
        entry.state = { data, status: 'ready', updatedAt: Date.now(), error: null }
        entry.failures = 0
      } catch {
        if (!entry.listeners.size) continue
        entry.failures++
        entry.state = { ...entry.state, status: entry.state.data === null ? 'error' : 'stale', error: 'Indexer unavailable. Retrying.' }
      } finally { clearTimeout(timeout); controller = undefined }
      entry.nextAt = Date.now() + Math.min(MAX_BACKOFF, INTERVAL * 2 ** Math.min(entry.failures, 4))
      for (const notify of entry.listeners.values()) notify()
    }
    running = false
    schedule()
  }
  return {
    snapshot<T>(q: Query<T>): Snapshot<T> { return entryFor(q).state as Snapshot<T> },
    subscribe<T>(q: Query<T>, listener: () => void) {
      const entry = entryFor(q)
      const token = Symbol()
      entry.listeners.set(token, listener)
      schedule()
      return () => {
        entry.listeners.delete(token)
        if (![...entries.values()].some(e => e.listeners.size)) controller?.abort()
        // Inactive query results are not identity storage; evict to avoid retaining account history.
        if (!entry.listeners.size) entries.delete(q.key)
        schedule()
      }
    },
    refresh() { for (const entry of entries.values()) entry.nextAt = 0; schedule() },
  }
}
