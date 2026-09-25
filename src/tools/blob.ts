import { r2, rect, smoothClosedPath } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const blob: SvgTool = {
  id: 'blob',
  name: 'Blob',
  category: 'Shape',
  description: 'Organic, layered shapes that wobble: stickers, avatars and playful accents.',
  kind: 'svg',
  animated: true,
  duration: 8,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#EDE9FE', '#6D28D9', '#F472B6', '#1E1B4B'], min: 2, max: 6 },
    { type: 'number', key: 'layers', label: 'Layers', min: 1, max: 10, step: 1, default: 4 },
    { type: 'number', key: 'points', label: 'Points', min: 4, max: 20, step: 1, default: 8 },
    { type: 'number', key: 'wobble', label: 'Wobble', min: 0, max: 0.8, step: 0.01, default: 0.32 },
    { type: 'number', key: 'size', label: 'Size', min: 0.2, max: 1, step: 0.01, default: 0.72 },
    { type: 'number', key: 'shrink', label: 'Layer step', min: 0.05, max: 0.3, step: 0.01, default: 0.14 },
    { type: 'number', key: 'drift', label: 'Offset', min: 0, max: 0.3, step: 0.01, default: 0.06 },
    {
      type: 'select', key: 'style', label: 'Style', default: 'solid',
      options: [{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }, { value: 'multiply', label: 'Multiply' }],
    },
  ],
  render({ w, h, p, rng, noise, t }) {
    const [bg, ...inks] = pal(p, 'palette')
    const m = Math.min(w, h)
    const layers = num(p, 'layers')
    const n = num(p, 'points')
    const wob = num(p, 'wobble')
    const R0 = (m / 2) * num(p, 'size')
    const shrink = num(p, 'shrink')
    const drift = num(p, 'drift') * m
    const style = str(p, 'style')
    let out = rect(w, h, bg)
    for (let l = 0; l < layers; l++) {
      const R = R0 * Math.max(0.05, 1 - l * shrink)
      const ox = w / 2 + rng.range(-1, 1) * drift
      const oy = h / 2 + rng.range(-1, 1) * drift
      const pts: [number, number][] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const k = noise.loop(Math.cos(a) * 0.9 + l * 3.1, Math.sin(a) * 0.9 + l * 1.7, t, 0.45)
        const rr = R * (1 + wob * k)
        pts.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr])
      }
      const d = smoothClosedPath(pts)
      const color = inks[l % inks.length]
      if (style === 'outline') {
        out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r2(m * 0.006)}"/>`
      } else {
        out += `<path d="${d}" fill="${color}"${style === 'multiply' ? ' style="mix-blend-mode:multiply"' : ''}/>`
      }
    }
    return out
  },
}
