import { r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const particleStream: SvgTool = {
  id: 'particle-stream',
  name: 'Particle Stream',
  category: 'Texture',
  description: 'Stippled particles swept along vortices and currents, like data made visible.',
  kind: 'svg',
  raw: true,
  animated: true,
  duration: 6,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (field, inks…)', default: ['#0B2DF5', '#F4F4FF', '#FF9FD8', '#A9B8FF'], min: 2, max: 5 },
    {
      type: 'select', key: 'field', label: 'Field', default: 'vortex',
      options: [{ value: 'vortex', label: 'Vortex' }, { value: 'dual', label: 'Dual' }, { value: 'flow', label: 'Flow' }, { value: 'orbit', label: 'Orbit' }],
    },
    { type: 'number', key: 'streams', label: 'Streams', min: 20, max: 900, step: 10, default: 320, rand: [160, 520] },
    { type: 'number', key: 'length', label: 'Stream length', min: 4, max: 90, step: 1, default: 40, rand: [20, 60] },
    { type: 'number', key: 'spacing', label: 'Dot spacing', min: 1, max: 8, step: 1, default: 3 },
    { type: 'number', key: 'size', label: 'Dot size', min: 1, max: 16, step: 0.5, default: 5, unit: 'px' },
    { type: 'number', key: 'jitter', label: 'Scatter', min: 0, max: 1, step: 0.01, default: 0.35 },
    { type: 'number', key: 'curl', label: 'Curl', min: 0, max: 2, step: 0.01, default: 0.6 },
    {
      type: 'select', key: 'shape', label: 'Mark', default: 'square',
      options: [{ value: 'square', label: 'Square' }, { value: 'circle', label: 'Dot' }, { value: 'mix', label: 'Mixed' }],
    },
  ],
  defaults: {
    format: 'portrait',
    finish: { grain: 0.25, grainType: 'soft' },
    type: { enabled: true, layout: 'tl', title: 'Signal Detection', body: 'Classification', label: '', caption: '', color: '#F4F4FF', size: 1.7, measure: 0.7 },
  },
  presets: [
    { name: 'Signal', format: 'portrait', seed: 7 },
    {
      name: 'Ember', format: 'square', seed: 23,
      params: { palette: ['#120806', '#FF6A1A', '#FFD2A8', '#8C1C13'], field: 'dual', streams: 420, size: 3.5, shape: 'circle' },
      finish: { grain: 0.4, grainType: 'soft', vignette: 0.4 },
      type: { enabled: false },
    },
    {
      name: 'Ink on paper', format: 'portrait', seed: 91,
      params: { palette: ['#EFECE6', '#111111', '#FF4F12'], field: 'flow', streams: 500, length: 50, size: 3, jitter: 0.2 },
      finish: { grain: 0.45, grainType: 'speckle' },
      type: { enabled: true, layout: 'bl', title: 'Currents', body: 'A study of movement in still form', label: '', caption: 'PLATE 07', color: '#111111' },
    },
  ],
  render({ w, h, p, rng, noise, t }) {
    const [bg, ...inks] = pal(p, 'palette')
    const m = Math.min(w, h)
    const field = str(p, 'field')
    const streams = num(p, 'streams')
    const len = num(p, 'length')
    const spacing = num(p, 'spacing')
    const size = num(p, 'size') * (m / 1080)
    const jitter = num(p, 'jitter')
    const curl = num(p, 'curl')
    const shape = str(p, 'shape')
    const step = m * 0.009

    // Vortex centres are part of the seed's composition.
    const c1: [number, number] = [w * rng.range(0.3, 0.7), h * rng.range(0.3, 0.6)]
    const c2: [number, number] = [w * rng.range(0.15, 0.85), h * rng.range(0.4, 0.9)]
    const spin = rng.chance(0.5) ? 1 : -1

    const vortex = (x: number, y: number, c: [number, number], s: number): [number, number] => {
      const dx = x - c[0]
      const dy = y - c[1]
      const d = Math.hypot(dx, dy) + m * 0.02
      // tangential swirl with a slight inward pull
      return [(-dy / d) * s - (dx / d) * 0.25, (dx / d) * s - (dy / d) * 0.25]
    }
    const dir = (x: number, y: number): [number, number] => {
      const n = noise.n2((x / m) * 1.6, (y / m) * 1.6) * curl * Math.PI
      let vx: number
      let vy: number
      if (field === 'flow') {
        const a = noise.n2((x / m) * 1.2 + 10, (y / m) * 1.2) * Math.PI * 1.5
        return [Math.cos(a), Math.sin(a)]
      } else if (field === 'dual') {
        const a = vortex(x, y, c1, spin)
        const b = vortex(x, y, c2, -spin)
        vx = a[0] + b[0]
        vy = a[1] + b[1]
      } else if (field === 'orbit') {
        const dx = x - c1[0]
        const dy = y - c1[1]
        const d = Math.hypot(dx, dy) || 1
        vx = (-dy / d) * spin
        vy = (dx / d) * spin
      } else {
        ;[vx, vy] = vortex(x, y, c1, spin)
      }
      const cs = Math.cos(n)
      const sn = Math.sin(n)
      const l = Math.hypot(vx, vy) || 1
      return [(vx * cs - vy * sn) / l, (vx * sn + vy * cs) / l]
    }

    const paths = inks.map(() => '')
    const weights = inks.map((_, i) => (i === 0 ? 0.62 : 0.38 / Math.max(1, inks.length - 1)))
    const pickInk = (r: number) => {
      let acc = 0
      for (let i = 0; i < weights.length; i++) {
        acc += weights[i]
        if (r <= acc) return i
      }
      return 0
    }
    const mark = (x: number, y: number, s: number, round: boolean) =>
      round
        ? `M${r2(x - s / 2)},${r2(y)}a${r2(s / 2)},${r2(s / 2)} 0 1,0 ${r2(s)},0a${r2(s / 2)},${r2(s / 2)} 0 1,0 ${r2(-s)},0`
        : `M${r2(x - s / 2)},${r2(y - s / 2)}h${r2(s)}v${r2(s)}h${r2(-s)}Z`

    for (let k = 0; k < streams; k++) {
      let x = rng.range(-0.05, 1.05) * w
      let y = rng.range(-0.05, 1.05) * h
      const ci = pickInk(rng())
      const scale = rng.range(0.5, 1.25)
      const round = shape === 'circle' || (shape === 'mix' && rng.chance(0.5))
      // integrate the stream path
      const pts: [number, number][] = [[x, y]]
      for (let s = 0; s < len; s++) {
        const [dx, dy] = dir(x, y)
        x += dx * step
        y += dy * step
        pts.push([x, y])
      }
      // dots slide one spacing along the path per loop, fading in and out at the ends
      const offset = (((t % 1) + 1) % 1) * spacing
      for (let s = offset; s < len; s += spacing) {
        const i = Math.floor(s)
        const f = s - i
        const [x0, y0] = pts[i]
        const [x1, y1] = pts[Math.min(i + 1, len)]
        const env = Math.sin(Math.PI * Math.min(1, s / len))
        const sz = size * scale * (0.35 + 0.65 * env)
        if (sz < 0.3) continue
        const jx = (rng() - 0.5) * jitter * size * 2
        const jy = (rng() - 0.5) * jitter * size * 2
        paths[ci] += mark(x0 + (x1 - x0) * f + jx, y0 + (y1 - y0) * f + jy, sz, round)
      }
    }
    return rect(w, h, bg) + paths.map((d, i) => (d ? `<path fill="${inks[i]}" d="${d}"/>` : '')).join('')
  },
}
