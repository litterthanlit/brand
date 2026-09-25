export function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Round to 2 decimals to keep SVG output compact. */
export const r2 = (n: number) => Math.round(n * 100) / 100

export function wrapSvg(w: number, h: number, inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`
}

export const rect = (w: number, h: number, fill: string) => `<rect width="${w}" height="${h}" fill="${fill}"/>`

/** Smooth closed path through points (Catmull-Rom → cubic Bézier). */
export function smoothClosedPath(pts: [number, number][], tension = 1) {
  const n = pts.length
  if (n < 3) return ''
  let d = `M${r2(pts[0][0])},${r2(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension
    d += `C${r2(c1x)},${r2(c1y)} ${r2(c2x)},${r2(c2y)} ${r2(p2[0])},${r2(p2[1])}`
  }
  return d + 'Z'
}

/** Smooth open path through points. */
export function smoothOpenPath(pts: [number, number][]) {
  if (pts.length < 2) return ''
  let d = `M${r2(pts[0][0])},${r2(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    d += `C${r2(p1[0] + (p2[0] - p0[0]) / 6)},${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)},${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])},${r2(p2[1])}`
  }
  return d
}

export const FONT_STACKS: Record<string, string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: "'SF Mono', Menlo, 'Courier New', monospace",
  condensed: "'Arial Narrow', 'Helvetica Neue Condensed', Impact, sans-serif",
}
