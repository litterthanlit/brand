import { r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export const halftone: SvgTool = {
  id: 'halftone',
  name: 'Halftone',
  category: 'Pattern',
  description: 'Print-style dot screens driven by noise, radial and wave fields.',
  kind: 'svg',
  animated: true,
  duration: 6,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#F4F2EE', '#111111', '#FF4F12'], min: 2, max: 5 },
    {
      type: 'select', key: 'shape', label: 'Shape', default: 'circle',
      options: [
        { value: 'circle', label: 'Dot' }, { value: 'square', label: 'Square' },
        { value: 'diamond', label: 'Diamond' }, { value: 'line', label: 'Line' }, { value: 'cross', label: 'Cross' },
      ],
    },
    {
      type: 'select', key: 'field', label: 'Field', default: 'noise',
      options: [
        { value: 'noise', label: 'Noise' }, { value: 'radial', label: 'Radial' },
        { value: 'linear', label: 'Linear' }, { value: 'wave', label: 'Wave' },
      ],
    },
    { type: 'number', key: 'cells', label: 'Density', min: 8, max: 90, step: 1, default: 36, rand: [14, 60] },
    { type: 'number', key: 'scale', label: 'Field scale', min: 0.3, max: 6, step: 0.1, default: 1.6 },
    { type: 'number', key: 'contrast', label: 'Contrast', min: 0.5, max: 4, step: 0.1, default: 1.6 },
    { type: 'number', key: 'minSize', label: 'Min size', min: 0, max: 0.6, step: 0.01, default: 0.04 },
    { type: 'number', key: 'maxSize', label: 'Max size', min: 0.3, max: 1.5, step: 0.01, default: 1.05 },
    { type: 'number', key: 'angle', label: 'Screen angle', min: 0, max: 90, step: 1, default: 0, unit: '°' },
    {
      type: 'select', key: 'colorMode', label: 'Colour', default: 'value',
      options: [{ value: 'single', label: 'Single' }, { value: 'value', label: 'By value' }, { value: 'random', label: 'Random' }],
    },
  ],
  render({ w, h, p, rng, noise, t }) {
    const colors = pal(p, 'palette')
    const [bg, ...inks] = colors
    const m = Math.min(w, h)
    const cell = m / num(p, 'cells')
    const scale = num(p, 'scale')
    const contrast = num(p, 'contrast')
    const minS = num(p, 'minSize')
    const maxS = num(p, 'maxSize')
    const shape = str(p, 'shape')
    const field = str(p, 'field')
    const mode = str(p, 'colorMode')
    const ang = (num(p, 'angle') * Math.PI) / 180
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const cx = w / 2
    const cy = h / 2
    const half = Math.hypot(w, h) / 2
    const n = Math.ceil(half / cell) + 1
    const tau = Math.PI * 2
    const paths: string[] = inks.map(() => '')

    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        // grid-space position (rotated screen), then map to canvas space
        const gx = i * cell
        const gy = j * cell
        const x = cx + gx * cos - gy * sin
        const y = cy + gx * sin + gy * cos
        const pickRandom = rng()
        if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue

        const u = gx / m
        const v = gy / m
        let val: number
        if (field === 'radial') {
          const d = Math.hypot(u, v) / 0.72
          val = 0.5 + 0.5 * Math.cos(d * scale * Math.PI - tau * t)
        } else if (field === 'linear') {
          val = 0.5 + 0.5 * Math.cos((u + 0.5) * scale * Math.PI - tau * t)
        } else if (field === 'wave') {
          val = 0.5 + 0.5 * Math.sin(u * scale * 6 + Math.sin(v * scale * 3 + tau * t) * 2)
        } else {
          val = 0.5 + 0.55 * noise.loop(u * scale, v * scale, t, 0.5)
        }
        val = clamp01(0.5 + (val - 0.5) * contrast)
        const s = (minS + (maxS - minS) * val) * cell
        if (s < 0.4) continue

        let ci = 0
        if (mode === 'value') ci = Math.min(inks.length - 1, Math.floor(val * inks.length))
        else if (mode === 'random') ci = Math.floor(pickRandom * inks.length)

        const hs = s / 2
        let d = ''
        if (shape === 'circle') {
          d = `M${r2(x - hs)},${r2(y)}a${r2(hs)},${r2(hs)} 0 1,0 ${r2(s)},0a${r2(hs)},${r2(hs)} 0 1,0 ${r2(-s)},0`
        } else if (shape === 'diamond') {
          d = `M${r2(x)},${r2(y - hs)}L${r2(x + hs)},${r2(y)}L${r2(x)},${r2(y + hs)}L${r2(x - hs)},${r2(y)}Z`
        } else {
          // rectangle-based shapes are drawn in grid space and rotated by the screen angle
          const quads: [number, number][] =
            shape === 'square' ? [[hs, hs]]
            : shape === 'line' ? [[cell / 2, hs / 2]]
            : [[hs, hs / 4], [hs / 4, hs]]
          for (const [a, b] of quads) {
            const pts: [number, number][] = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([px, py]) => [
              x + px * cos - py * sin,
              y + px * sin + py * cos,
            ])
            d += `M${pts.map(([px, py]) => `${r2(px)},${r2(py)}`).join('L')}Z`
          }
        }
        paths[ci] += d
      }
    }
    return rect(w, h, bg) + paths.map((d, i) => (d ? `<path fill="${inks[i]}" d="${d}"/>` : '')).join('')
  },
}
