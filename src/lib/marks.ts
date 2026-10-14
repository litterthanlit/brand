import { r2 } from './svg'

// Stand-in for the hypher H mark, redrawn as geometry until a real logo SVG is supplied.
// Normalised box: width HYPHER_ASPECT, height 1. Left block, narrow bridge, slanted right block.

export const HYPHER_ASPECT = 5.2
/** Centre of the bridge in the normalised box (where the ember pixel sits). */
export const HYPHER_BRIDGE = { u: 2.55, v: 0.5 }

const R = 0.08 // left block corner radius
const BRIDGE = [1.9, 3.3, 0.36, 0.64] as const // u0, u1 (runs into the right block), v0, v1

/** SVG path `d` for the mark with its top-left at (x, y); three same-wound subpaths, so nonzero fill unions them. */
export function hypherMarkPath(x: number, y: number, height: number) {
  const k = height
  const P = (u: number, v: number) => `${r2(x + u * k)},${r2(y + v * k)}`
  const a = `a${r2(R * k)},${r2(R * k)} 0 0 1`
  const rr = r2(R * k)
  const left =
    `M${P(R, 0)}H${r2(x + (1.9 - R) * k)}${a} ${rr},${rr}V${r2(y + (1 - R) * k)}${a} ${-rr},${rr}` +
    `H${r2(x + R * k)}${a} ${-rr},${-rr}V${r2(y + R * k)}${a} ${rr},${-rr}Z`
  // bridge starts inside the left block so the union has no seam
  const bridge = `M${P(1.8, BRIDGE[2])}H${r2(x + BRIDGE[1] * k)}V${r2(y + BRIDGE[3] * k)}H${r2(x + 1.8 * k)}Z`
  const right = `M${P(3.3, 0)}L${P(5, 0)}L${P(5.2, 1)}L${P(3.2, 1)}Z`
  return left + bridge + right
}

/** Analytic point-in-mark test in the normalised box (u in [0, 5.2], v in [0, 1]). */
export function insideHypherMark(u: number, v: number) {
  if (v < 0 || v > 1 || u < 0 || u > HYPHER_ASPECT) return false
  if (u <= 1.9) {
    const dx = Math.max(R - u, u - (1.9 - R), 0)
    const dy = Math.max(R - v, v - (1 - R), 0)
    return dx * dx + dy * dy <= R * R
  }
  if (u <= BRIDGE[1] && v >= BRIDGE[2] && v <= BRIDGE[3]) return true
  return u >= 3.3 - 0.1 * v && u <= 5 + 0.2 * v
}
