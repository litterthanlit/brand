import type { Rng } from '../lib/random'
import { r2, rect } from '../lib/svg'
import { bool, num, pal, str, type SvgTool } from './types'

type Pt = [number, number]
type Rail = (u: number) => Pt

const RAILS = [
  { value: 'arc', label: 'Arc' },
  { value: 'sine', label: 'Sine' },
  { value: 'spiral', label: 'Spiral' },
  { value: 'stairs', label: 'Stairs' },
  { value: 'line', label: 'Line' },
  { value: 'circle', label: 'Circle' },
]

/** Parametric rails in canvas space; `wob` (−1..1) gently deforms them for looping motion. */
function makeRail(kind: string, rng: Rng, w: number, h: number, wob: number): Rail {
  const m = Math.min(w, h)
  const tau = Math.PI * 2
  switch (kind) {
    case 'circle':
    case 'arc': {
      const cx = w * rng.range(0.1, 0.9)
      const cy = h * rng.range(0.1, 0.9)
      const r = m * rng.range(0.3, 0.75)
      const a0 = rng.range(0, tau) + wob * 0.25
      const sweep = kind === 'circle' ? tau : rng.range(0.6, 1.4) * Math.PI
      return (u) => [cx + Math.cos(a0 + sweep * u) * r, cy + Math.sin(a0 + sweep * u) * r]
    }
    case 'sine': {
      const vertical = rng.chance(0.5)
      const base = rng.range(0.15, 0.85)
      const amp = rng.range(0.08, 0.28) * m
      const freq = rng.range(0.6, 2.2)
      const ph = rng.range(0, tau) + wob * 0.8
      return (u) => {
        const s = -0.1 + u * 1.2
        const d = Math.sin(s * freq * tau + ph) * amp
        return vertical ? [base * w + d, s * h] : [s * w, base * h + d]
      }
    }
    case 'spiral': {
      const cx = w * rng.range(0.2, 0.8)
      const cy = h * rng.range(0.2, 0.8)
      const r0 = m * rng.range(0.02, 0.12)
      const r1 = m * rng.range(0.45, 0.8)
      const turns = rng.range(0.8, 2.2)
      const a0 = rng.range(0, tau) + wob * 0.35
      return (u) => {
        const a = a0 + u * turns * tau
        const r = r0 + (r1 - r0) * u
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
      }
    }
    case 'stairs': {
      const steps = rng.int(4, 9)
      const x0 = w * rng.range(-0.05, 0.35)
      const y0 = h * rng.range(-0.05, 0.3)
      const x1 = w * rng.range(0.65, 1.05)
      const y1 = h * rng.range(0.7, 1.05)
      const pts: Pt[] = [[x0, y0]]
      for (let i = 1; i <= steps; i++) {
        const x = x0 + ((x1 - x0) * i) / steps + wob * m * 0.02
        const y = y0 + ((y1 - y0) * i) / steps
        pts.push([x, pts[pts.length - 1][1]], [x, y])
      }
      const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
      const total = lens.reduce((a, b) => a + b, 0)
      return (u) => {
        let d = u * total
        for (let i = 0; i < lens.length; i++) {
          if (d <= lens[i] || i === lens.length - 1) {
            const k = lens[i] ? Math.min(1, d / lens[i]) : 0
            return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]
          }
          d -= lens[i]
        }
        return pts[pts.length - 1]
      }
    }
    default: {
      const a: Pt = [w * rng.range(-0.1, 1.1), h * rng.range(-0.1, 0.4)]
      const b: Pt = [w * rng.range(-0.1, 1.1), h * rng.range(0.6, 1.1) + wob * m * 0.03]
      return (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
    }
  }
}

/** Fold any number into 0..1 and back (ping-pong), so offsets never jump. */
const fold = (v: number) => {
  const x = ((v % 2) + 2) % 2
  return x > 1 ? 2 - x : x
}

export const lineSweep: SvgTool = {
  id: 'line-sweep',
  name: 'Line Sweep',
  category: 'Pattern',
  description: 'String-art envelopes spun between two rails: lattices, ribbons and stepped structures.',
  kind: 'svg',
  raw: true,
  animated: true,
  duration: 10,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (field, line, accent)', default: ['#5E9DB3', '#86DDF8', '#F7D2E4'], min: 2, max: 4 },
    { type: 'select', key: 'railA', label: 'Rail A', default: 'arc', options: RAILS },
    { type: 'select', key: 'railB', label: 'Rail B', default: 'stairs', options: RAILS },
    { type: 'number', key: 'count', label: 'Lines', min: 10, max: 400, step: 1, default: 64, rand: [36, 120] },
    { type: 'number', key: 'twist', label: 'Twist', min: -1, max: 1, step: 0.01, default: 0.18 },
    {
      type: 'select', key: 'connector', label: 'Connector', default: 'mixed',
      options: [{ value: 'straight', label: 'Straight' }, { value: 'stepped', label: 'Stepped' }, { value: 'mixed', label: 'Mixed' }],
    },
    { type: 'number', key: 'weight', label: 'Stroke weight', min: 0.4, max: 8, step: 0.1, default: 3.4, unit: 'px' },
    { type: 'number', key: 'layers', label: 'Echo layers', min: 1, max: 4, step: 1, default: 2 },
    { type: 'boolean', key: 'marker', label: 'Accent marker', default: true },
  ],
  defaults: {
    format: 'portrait',
    finish: { grain: 0.55, grainType: 'speckle', grainSize: 1.2 },
    type: {
      enabled: true, layout: 'br', title: 'The work begins.',
      body: 'Computational systems for brand, motion and print; simulation-based making',
      label: 'Brand Playground', caption: '', color: '#E8E8E8', labelBg: '#DCDCDC', labelInk: '#111111',
    },
  },
  presets: [
    { name: 'Lattice', format: 'portrait', seed: 7 },
    {
      name: 'Blueprint', format: 'landscape', seed: 31,
      params: { palette: ['#0E1A2B', '#9FB8D6', '#FF5A36'], railA: 'spiral', railB: 'line', connector: 'straight', count: 120, weight: 1.6, layers: 1 },
      finish: { grain: 0.35, grainType: 'light' },
      type: { enabled: true, layout: 'tl', title: 'System 04', body: 'Field notes on structure', label: '', caption: 'FIG. 04 — RAIL/SPIRAL', color: '#DDE6F0' },
    },
    {
      name: 'Paper', format: 'portrait', seed: 12,
      params: { palette: ['#EDEAE3', '#161616', '#FF4F12'], railA: 'sine', railB: 'arc', connector: 'mixed', count: 90, weight: 2 },
      finish: { grain: 0.5, grainType: 'speckle' },
      type: { enabled: true, layout: 'bl', title: 'Index', body: 'An open archive of generative forms', label: 'Volume 01', color: '#161616', labelBg: '#161616', labelInk: '#EDEAE3' },
    },
  ],
  render({ w, h, p, rng, t }) {
    const [bg, ink, accent = ink, ink2 = ink] = pal(p, 'palette')
    const m = Math.min(w, h)
    const count = num(p, 'count')
    const twist = num(p, 'twist')
    const sw = num(p, 'weight') * (m / 1080)
    const conn = str(p, 'connector')
    const wob = Math.sin(Math.PI * 2 * t)
    let out = rect(w, h, bg)

    const layers = num(p, 'layers')
    for (let l = 0; l < layers; l++) {
      const kindA = l === 0 ? str(p, 'railA') : rng.pick(RAILS).value
      const kindB = l === 0 ? str(p, 'railB') : rng.pick(RAILS).value
      const A = makeRail(kindA, rng, w, h, wob)
      const B = makeRail(kindB, rng, w, h, -wob)
      const stepped = conn === 'stepped' || (conn === 'mixed' && l % 2 === 1)
      const tw = twist + 0.12 * wob * (l % 2 ? -1 : 1)
      let d = ''
      for (let i = 0; i < count; i++) {
        const u = count > 1 ? i / (count - 1) : 0
        const [ax, ay] = A(u)
        const [bx, by] = B(fold(u + tw))
        d += stepped ? `M${r2(ax)},${r2(ay)}H${r2(bx)}V${r2(by)}` : `M${r2(ax)},${r2(ay)}L${r2(bx)},${r2(by)}`
      }
      const color = l === 2 ? ink2 : ink
      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r2(sw * (l === 0 ? 1 : 0.85))}" stroke-linejoin="miter" stroke-opacity="${l === 0 ? 1 : 0.9}"/>`
    }

    if (bool(p, 'marker')) {
      // A vertical run of square ticks with irregular gaps, like a measurement track.
      const x = w * rng.range(0.3, 0.55)
      const size = m * 0.02
      const y1 = h * rng.range(0.3, 0.45)
      let y = h * 0.015
      let d = ''
      while (y < y1) {
        if (rng.chance(0.82)) d += `M${r2(x - size / 2)},${r2(y)}h${r2(size)}v${r2(size)}h${r2(-size)}Z`
        y += size * rng.pick([1.45, 1.6, 1.6, 2.4])
      }
      out += `<path d="M${r2(x)},${r2(h * 0.015)}V${r2(y1)}" stroke="${accent}" stroke-width="${r2(sw * 0.8)}"/>`
      out += `<path d="${d}" fill="${accent}"/>`
    }
    return out
  },
}
