import { r2, rect } from '../lib/svg'
import { bool, num, pal, type SvgTool } from './types'

export const waves: SvgTool = {
  id: 'waves',
  name: 'Wave Lines',
  category: 'Pattern',
  description: 'Stacked lines displaced by noise, in the spirit of classic pulsar-plot covers.',
  kind: 'svg',
  animated: true,
  duration: 8,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#111111', '#F4F2EE', '#FF4F12'], min: 2, max: 4 },
    { type: 'number', key: 'lines', label: 'Lines', min: 6, max: 140, step: 1, default: 48, rand: [20, 80] },
    { type: 'number', key: 'amp', label: 'Amplitude', min: 0, max: 0.4, step: 0.005, default: 0.12 },
    { type: 'number', key: 'freq', label: 'Frequency', min: 0.5, max: 12, step: 0.1, default: 3.5 },
    { type: 'number', key: 'weight', label: 'Stroke weight', min: 0.5, max: 10, step: 0.1, default: 2.4, unit: 'px' },
    { type: 'number', key: 'margin', label: 'Margin', min: 0, max: 0.3, step: 0.01, default: 0.14 },
    { type: 'boolean', key: 'envelope', label: 'Centre peak', default: true },
    { type: 'boolean', key: 'occlude', label: 'Occlude', default: true },
    { type: 'number', key: 'accentEvery', label: 'Accent every', min: 0, max: 20, step: 1, default: 0 },
  ],
  render({ w, h, p, noise, t }) {
    const [bg, ink, ...accents] = pal(p, 'palette')
    const m = Math.min(w, h)
    const n = num(p, 'lines')
    const margin = m * num(p, 'margin')
    const amp = num(p, 'amp') * m
    const freq = num(p, 'freq')
    const env = bool(p, 'envelope')
    const occlude = bool(p, 'occlude')
    const accentEvery = num(p, 'accentEvery')
    const sw = num(p, 'weight') * (m / 1080)
    const x0 = margin
    const x1 = w - margin
    const top = margin + amp
    const bottom = h - margin
    const gap = n > 1 ? (bottom - top) / (n - 1) : 0
    const samples = 120
    let out = rect(w, h, bg)
    for (let i = 0; i < n; i++) {
      const y0 = top + i * gap
      const pts: string[] = []
      for (let s = 0; s <= samples; s++) {
        const u = s / samples
        const x = x0 + (x1 - x0) * u
        const e = env ? Math.pow(Math.sin(Math.PI * u), 3) : 1
        const k = 0.5 + 0.5 * noise.loop(u * freq, i * 0.18, t, 0.4)
        pts.push(`${r2(x)},${r2(y0 - amp * e * k)}`)
      }
      const color = accentEvery > 0 && accents.length && i % accentEvery === accentEvery - 1 ? accents[(i / accentEvery) % accents.length | 0] : ink
      const line = `M${pts.join('L')}`
      if (occlude) out += `<path d="${line}L${r2(x1)},${r2(y0 + gap)}L${r2(x0)},${r2(y0 + gap)}Z" fill="${bg}"/>`
      out += `<path d="${line}" fill="none" stroke="${color}" stroke-width="${r2(sw)}" stroke-linejoin="round" stroke-linecap="round"/>`
    }
    return out
  },
}
