import { useCallback, useSyncExternalStore } from 'react'
import type { Query } from './envio'
import { createEnvioStore } from './envioStore'

const store = createEnvioStore(import.meta.env.VITE_ENVIO_GRAPHQL_URL?.trim() || undefined)
export function useEnvio<T>(query: Query<T>) {
  // Callers may construct a query inline; its stable key controls subscriptions.
  const key = query.key
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subscribe = useCallback((notify: () => void) => store.subscribe(query, notify), [key])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useCallback(() => store.snapshot(query), [key])
  return { ...useSyncExternalStore(subscribe, snapshot, snapshot), refresh: store.refresh }
}
