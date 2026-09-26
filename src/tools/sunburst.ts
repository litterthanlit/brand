import { r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const sunburst: SvgTool = {
  id: 'sunburst',
  name: 'Sunburst',
  category: 'Pattern',
  description: 'Radiating rays with twist and wobble, for retro posters, packaging and loud backdrops.',
  kind: 'svg',
  animated: true,
  duration: 8,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#FFFBEA', '#FF6B00', '#FFD000'], min: 2, max: 6 },
    { type: 'number', key: 'rays', label: 'Rays', min: 4, max: 120, step: 2, default: 32, rand: [12, 64] },
    { type: 'number', key: 'twist', label: 'Twist', min: -1, max: 1, step: 0.01, default: 0 },
    { type: 'number', key: 'taper', label: 'Taper', min: 0, max: 1, step: 0.01, default: 0 },
    { type: 'number', key: 'cx', label: 'Centre X', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { type: 'number', key: 'cy', label: 'Centre Y', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { type: 'number', key: 'core', label: 'Core', min: 0, max: 0.5, step: 0.01, default: 0.12 },
    {
      type: 'select', key: 'colorMode', label: 'Colour', default: 'cycle',
      options: [{ value: 'cycle', label: 'Cycle' }, { value: 'alternate', label: 'Alternate' }, { value: 'random', label: 'Random' }],
    },
  ],
  render({ w, h, p, rng, t }) {
    const [bg, ...inks] = pal(p, 'palette')
    const n = num(p, 'rays')
    const cx = w / 2 + num(p, 'cx') * w
    const cy = h / 2 + num(p, 'cy') * h
    const R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.05
    const twist = num(p, 'twist') * Math.PI * 0.75
    const taper = num(p, 'taper')
    const mode = str(p, 'colorMode')
    const step = (Math.PI * 2) / n
    // rotating by one full colour period keeps the loop seamless
    const period = mode === 'alternate' ? 2 : mode === 'cycle' ? inks.length : n
    const rot = t * step * period
    const paths = inks.map(() => '')
    for (let i = 0; i < n; i++) {
      const ci = mode === 'alternate' ? (i % 2 === 0 ? 0 : -1) : mode === 'cycle' ? i % inks.length : Math.floor(rng() * inks.length)
      if (ci < 0) continue
      const a0 = i * step + rot
      const half = (step / 2) * (1 - taper * 0.8)
      const mid = a0 + step / 2
      const a1 = mid - half
      const a2 = mid + half
      const pt = (a: number, r: number) => `${r2(cx + Math.cos(a) * r)},${r2(cy + Math.sin(a) * r)}`
      if (twist === 0) {
        paths[ci] += `M${r2(cx)},${r2(cy)}L${pt(a1, R)}L${pt(a2, R)}Z`
      } else {
        paths[ci] += `M${r2(cx)},${r2(cy)}Q${pt(a1 + twist, R * 0.5)} ${pt(a1 + twist * 1.6, R)}L${pt(a2 + twist * 1.6, R)}Q${pt(a2 + twist, R * 0.5)} ${r2(cx)},${r2(cy)}Z`
      }
    }
    let out = rect(w, h, bg) + paths.map((d, i) => (d ? `<path fill="${inks[i]}" d="${d}"/>` : '')).join('')
    const core = num(p, 'core') * Math.min(w, h)
    if (core > 0) out += `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(core)}" fill="${bg}"/>`
    return out
  },
}
