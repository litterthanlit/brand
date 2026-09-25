import type { ParamValues } from '../tools/types'
import type { DocState } from './engine'

function toBase64Url(s: string) {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Serialise shareable state. Images are never put in URLs (they never leave the browser). */
export function encodeState(state: DocState) {
  const params: ParamValues = {}
  for (const [k, v] of Object.entries(state.params)) {
    if (v === null || (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap)) continue
    params[k] = v
  }
  return toBase64Url(JSON.stringify({ s: state.seed, f: state.format, p: params }))
}

export function decodeState(data: string): Partial<DocState> | null {
  try {
    const raw = JSON.parse(fromBase64Url(data))
    if (!raw || typeof raw !== 'object') return null
    return {
      seed: Number.isFinite(raw.s) ? raw.s : undefined,
      format: typeof raw.f === 'string' ? raw.f : undefined,
      params: raw.p && typeof raw.p === 'object' ? raw.p : undefined,
    }
  } catch {
    return null
  }
}
