import type { DocState } from '../lib/engine'
import { glowOf } from '../lib/glow'
import type { ToolDef } from '../tools/types'

/** Light spilling from an artwork into the dark room around it. Its parent must be positioned. */
export function Halo({ tool, state, className = '' }: { tool: ToolDef; state: DocState; className?: string }) {
  return <div aria-hidden="true" className={`halo ${className}`} style={{ ['--glow' as string]: glowOf(tool, state.params) }} />
}
