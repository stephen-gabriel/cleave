import { useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes } from 'react'

const NAV_EVENT = 'cleave:navigate'

function subscribe(onChange: () => void): () => void {
  const listener = () => onChange()
  window.addEventListener('popstate', listener)
  window.addEventListener(NAV_EVENT, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAV_EVENT, listener)
  }
}

function getPath(): string {
  return window.location.pathname
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, getPath)
}

export function navigate(to: string, opts?: { replace?: boolean }): void {
  if (opts?.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAV_EVENT))
}

type Params = Record<string, string>

export function matchPath(pattern: string, path: string): Params | null {
  const wanted = pattern.split('/').filter(Boolean)
  const actual = path.split('/').filter(Boolean)
  if (wanted.length !== actual.length) return null
  const params: Params = {}
  for (let i = 0; i < wanted.length; i += 1) {
    const part = wanted[i]
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(actual[i])
    } else if (part !== actual[i]) {
      return null
    }
  }
  return params
}

type LinkProps = { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>

export function Link({ to, onClick, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(event) => {
        if (event.defaultPrevented) return
        const modifier = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        if (modifier || event.button !== 0) return
        event.preventDefault()
        navigate(to)
        onClick?.(event)
      }}
    />
  )
}