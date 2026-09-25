import { r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const rings: SvgTool = {
  id: 'rings',
  name: 'Op-Art Rings',
  category: 'Pattern',
  description: 'Concentric rings from offset centres that interfere into moiré.',
  kind: 'svg',
  animated: true,
  duration: 4,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#FFFFFF', '#000000', '#FF2E63', '#08D9D6'], min: 2, max: 5 },
    { type: 'number', key: 'centres', label: 'Centres', min: 1, max: 4, step: 1, default: 2 },
    { type: 'number', key: 'spacing', label: 'Spacing', min: 0.008, max: 0.1, step: 0.001, default: 0.028 },
    { type: 'number', key: 'weight', label: 'Line ratio', min: 0.05, max: 0.9, step: 0.01, default: 0.45 },
    { type: 'number', key: 'spread', label: 'Spread', min: 0, max: 0.5, step: 0.01, default: 0.18 },
    {
      type: 'select', key: 'blend', label: 'Blend', default: 'multiply',
      options: [{ value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }, { value: 'difference', label: 'Difference' }],
    },
    {
      type: 'select', key: 'motion', label: 'Motion', default: 'out',
      options: [{ value: 'out', label: 'Expand' }, { value: 'in', label: 'Contract' }, { value: 'alt', label: 'Opposed' }],
    },
  ],
  render({ w, h, p, rng, t }) {
    const [bg, ...inks] = pal(p, 'palette')
    const m = Math.min(w, h)
    const count = num(p, 'centres')
    const spacing = num(p, 'spacing') * m
    const sw = spacing * num(p, 'weight')
    const spread = num(p, 'spread') * m
    const blend = str(p, 'blend')
    const motion = str(p, 'motion')
    const maxR = Math.hypot(w, h)
    let out = rect(w, h, bg)
    for (let c = 0; c < count; c++) {
      const a = (c / count) * Math.PI * 2 + rng.range(0, Math.PI)
      const cx = w / 2 + (count > 1 ? Math.cos(a) * spread : 0)
      const cy = h / 2 + (count > 1 ? Math.sin(a) * spread : 0)
      const dir = motion === 'in' ? -1 : motion === 'alt' && c % 2 ? -1 : 1
      const offset = ((((dir * t) % 1) + 1) % 1) * spacing
      let d = ''
      for (let r = offset; r < maxR; r += spacing) {
        if (r < sw / 2) continue
        d += `M${r2(cx - r)},${r2(cy)}a${r2(r)},${r2(r)} 0 1,0 ${r2(2 * r)},0a${r2(r)},${r2(r)} 0 1,0 ${r2(-2 * r)},0`
      }
      const style = blend !== 'normal' ? ` style="mix-blend-mode:${blend}"` : ''
      out += `<path d="${d}" fill="none" stroke="${inks[c % inks.length]}" stroke-width="${r2(sw)}"${style}/>`
    }
    return out
  },
}
