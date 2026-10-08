import { useSyncExternalStore } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export type Toast = {
  id: number
  kind: ToastKind
  message: string
  actions?: Array<{ label: string; onClick: () => void }>
  sticky?: boolean
}

type Store = { list: Toast[]; nextId: number }

let store: Store = { list: [], nextId: 1 }

const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

function getSnapshot(): Store {
  return store
}

function addToast(input: Omit<Toast, 'id'>): number {
  const id = store.nextId
  store = { ...store, nextId: id + 1, list: [...store.list, { ...input, id }] }
  emit()
  if (!input.sticky) {
    const ttl = input.kind === 'error' ? 8000 : 6000
    window.setTimeout(() => dismiss(id), ttl)
  }
  return id
}

export function dismiss(id: number): void {
  store = { ...store, list: store.list.filter((t) => t.id !== id) }
  emit()
}

export function toastSuccess(message: string, opts?: { sticky?: boolean }): number {
  return addToast({ kind: 'success', message, sticky: opts?.sticky })
}

export function toastError(message: string, opts?: { actions?: Toast['actions'] }): number {
  return addToast({ kind: 'error', message, sticky: true, actions: opts?.actions })
}

export function toastInfo(message: string): number {
  return addToast({ kind: 'info', message })
}

export function useToasts(): Store {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    getSnapshot,
  )
}

export function Toaster() {
  const { list } = useToasts()
  if (list.length === 0) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((item) => (
        <div className="toast" key={item.id}>
          <span className={`toast__dot toast__dot--${item.kind}`} aria-hidden />
          <div className="toast__body">
            <span>{item.message}</span>
            {item.actions && item.actions.length > 0 && (
              <span className="toast__actions">
                {item.actions.map((action) => (
                  <button
                    key={action.label}
                    className="toast__action"
                    onClick={() => {
                      action.onClick()
                      dismiss(item.id)
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}