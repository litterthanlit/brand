import { useEffect, useState } from 'react'

export type Route = { name: 'home' } | { name: 'tool'; id: string; data: string | null }

export function parseHash(hash: string): Route {
  const m = hash.match(/^#\/t\/([\w-]+)(?:\?(.*))?$/)
  if (!m) return { name: 'home' }
  const data = new URLSearchParams(m[2] ?? '').get('d')
  return { name: 'tool', id: m[1], data }
}

export const toolHref = (id: string, data?: string) => `#/t/${id}${data ? `?d=${data}` : ''}`

/** Minimal hash router. Only reacts to real navigations (replaceState updates are ignored). */
export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
