import { hexToRgb } from '../lib/color'
import { applyGrain } from '../lib/grain'
import { num, pal, str, type CanvasTool } from './types'

export const meshGradient: CanvasTool = {
  id: 'mesh-gradient',
  name: 'Mesh Gradient',
  category: 'Texture',
  description: 'Soft, grainy colour fields for backgrounds, covers and hero sections.',
  kind: 'canvas',
  animated: true,
  duration: 10,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#FFF4EC', '#FF8A5B', '#FFC857', '#7AD3C0', '#3B3355'], min: 2, max: 6 },
    { type: 'number', key: 'blobs', label: 'Blobs', min: 2, max: 12, step: 1, default: 6 },
    { type: 'number', key: 'size', label: 'Blob size', min: 0.3, max: 1.4, step: 0.01, default: 0.8 },
    { type: 'number', key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.7 },
    { type: 'number', key: 'drift', label: 'Drift', min: 0, max: 0.4, step: 0.01, default: 0.14 },
    { type: 'number', key: 'grain', label: 'Grain', min: 0, max: 0.8, step: 0.01, default: 0.28 },
    {
      type: 'select', key: 'blend', label: 'Blend', default: 'source-over',
      options: [{ value: 'source-over', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }],
    },
  ],
  draw({ g, w, h, p, rng, t, seed }) {
    const [bg, ...inks] = pal(p, 'palette')
    const m = Math.max(w, h)
    const size = num(p, 'size')
    const soft = num(p, 'softness')
    const drift = num(p, 'drift')
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = str(p, 'blend') as GlobalCompositeOperation
    const count = num(p, 'blobs')
    const tau = Math.PI * 2
    for (let i = 0; i < count; i++) {
      const color = inks[i % inks.length]
      const bx = rng.range(-0.1, 1.1)
      const by = rng.range(-0.1, 1.1)
      const r = m * size * rng.range(0.35, 0.75)
      const phase = rng()
      const dir = rng.chance(0.5) ? 1 : -1
      const orbit = drift * m * rng.range(0.5, 1)
      const a = tau * (t * dir + phase)
      const x = bx * w + Math.cos(a) * orbit
      const y = by * h + Math.sin(a) * orbit * 0.8
      const [cr, cg, cb] = hexToRgb(color)
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`)
      grad.addColorStop(Math.max(0.01, 1 - soft) * 0.9, `rgba(${cr},${cg},${cb},${soft > 0.02 ? 0.85 : 1})`)
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
      g.fillStyle = grad
      g.fillRect(0, 0, w, h)
    }
    g.globalCompositeOperation = 'source-over'
    applyGrain(g, seed, num(p, 'grain'))
  },
}
