import { r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const flowField: SvgTool = {
  id: 'flow-field',
  name: 'Flow Field',
  category: 'Texture',
  description: 'Thousands of strokes steered by noise, like wind, hair or topographic flow.',
  kind: 'svg',
  animated: true,
  duration: 8,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#0B1026', '#F3E9D2', '#E94F37', '#39A0ED'], min: 2, max: 6 },
    { type: 'number', key: 'count', label: 'Lines', min: 50, max: 2500, step: 10, default: 700, rand: [300, 1200] },
    { type: 'number', key: 'steps', label: 'Length', min: 4, max: 120, step: 1, default: 36, rand: [12, 60] },
    { type: 'number', key: 'scale', label: 'Noise scale', min: 0.3, max: 6, step: 0.05, default: 1.6 },
    { type: 'number', key: 'turbulence', label: 'Turbulence', min: 0.5, max: 6, step: 0.05, default: 2 },
    { type: 'number', key: 'weight', label: 'Stroke weight', min: 0.2, max: 12, step: 0.1, default: 2.2, unit: 'px' },
    { type: 'number', key: 'opacity', label: 'Opacity', min: 0.1, max: 1, step: 0.01, default: 0.85 },
    {
      type: 'select', key: 'cap', label: 'Ends', default: 'round',
      options: [{ value: 'round', label: 'Round' }, { value: 'butt', label: 'Flat' }],
    },
    {
      type: 'select', key: 'colorMode', label: 'Colour', default: 'random',
      options: [{ value: 'random', label: 'Random' }, { value: 'angle', label: 'By angle' }, { value: 'band', label: 'Bands' }],
    },
  ],
  presets: [
    {
      name: 'Signal',
      format: 'portrait',
      params: { palette: ['#0B2DF5', '#F4F4FF', '#FF9FD8'], count: 500, steps: 40, weight: 1.6, opacity: 0.9, cap: 'round' },
      finish: { grain: 0.3, grainType: 'soft' },
      type: { enabled: true, layout: 'tl', title: 'Field Study', body: 'Currents', label: '', caption: '', color: '#F4F4FF', size: 1.6, measure: 0.7 },
    },
    {
      name: 'Graphite',
      format: 'landscape',
      params: { palette: ['#EDEAE3', '#161616'], count: 1400, steps: 28, weight: 0.8, opacity: 0.7 },
      finish: { grain: 0.4, grainType: 'speckle' },
    },
  ],
  render({ w, h, p, rng, noise, t }) {
    const [bg, ...inks] = pal(p, 'palette')
    const m = Math.min(w, h)
    const count = num(p, 'count')
    const steps = num(p, 'steps')
    const scale = num(p, 'scale') / m
    const turb = num(p, 'turbulence')
    const stepLen = m * 0.006
    const mode = str(p, 'colorMode')
    const paths = inks.map(() => '')
    for (let k = 0; k < count; k++) {
      let x = rng.range(-0.05, 1.05) * w
      let y = rng.range(-0.05, 1.05) * h
      const roll = rng()
      let d = `M${r2(x)},${r2(y)}`
      let a0 = 0
      for (let s = 0; s < steps; s++) {
        const a = noise.loop(x * scale, y * scale, t, 0.35) * Math.PI * turb
        if (s === 0) a0 = a
        x += Math.cos(a) * stepLen
        y += Math.sin(a) * stepLen
        d += `L${r2(x)},${r2(y)}`
      }
      let ci = Math.floor(roll * inks.length)
      if (mode === 'angle') ci = Math.floor((((a0 / (Math.PI * 2)) % 1) + 1) % 1 * inks.length)
      else if (mode === 'band') ci = Math.min(inks.length - 1, Math.floor((y / h) * inks.length + 0.5 * roll) % inks.length)
      paths[Math.max(0, Math.min(inks.length - 1, ci))] += d
    }
    const common = `fill="none" stroke-width="${r2(num(p, 'weight') * (m / 1080))}" stroke-linecap="${str(p, 'cap')}" stroke-linejoin="round" stroke-opacity="${num(p, 'opacity')}"`
    return rect(w, h, bg) + paths.map((d, i) => (d ? `<path stroke="${inks[i]}" ${common} d="${d}"/>` : '')).join('')
  },
}
