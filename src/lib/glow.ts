import type { ToolDef } from '../tools/types'
import type { DocState } from './engine'
import { filterActive } from './filter'

/** The artwork's colours: its palette param, or the tool's default palette. */
export function paletteOf(tool: ToolDef, params?: DocState['params']): string[] {
  const param = tool.params.find((p) => p.type === 'palette')
  if (!param) return []
  const value = params?.[param.key]
  return Array.isArray(value) && value.length ? value : (param.default as string[])
}

/**
 * A soft light field for the halo behind an artwork: the field colour fills the room,
 * the other colours pool at the edges. Blurred heavily in CSS, so it reads as spill, not shape.
 * A mono filter replaces the palette: its background is the field and its ink is the light pooling over it.
 * (In source colour the filter keeps the artwork's own hues, so the palette glow still fits.)
 */
export function glowOf(tool: ToolDef, params?: DocState['params'], filter?: DocState['filter']): string {
  if (filter && filterActive(filter) && filter.colorMode !== 'source') {
    const field = typeof filter.background === 'string' ? filter.background : '#111111'
    const ink = typeof filter.ink === 'string' ? filter.ink : '#D9D6CF'
    return `radial-gradient(60% 60% at 30% 35%, color-mix(in srgb, ${ink} 60%, transparent), transparent 70%), radial-gradient(55% 55% at 72% 70%, color-mix(in srgb, ${ink} 40%, transparent), transparent 70%), ${field}`
  }
  const [field = '#2a2a2e', ...rest] = paletteOf(tool, params)
  const a = rest[0] ?? field
  const b = rest[1] ?? a
  return `radial-gradient(60% 60% at 30% 35%, ${a}, transparent 70%), radial-gradient(55% 55% at 72% 70%, ${b}, transparent 70%), ${field}`
}
