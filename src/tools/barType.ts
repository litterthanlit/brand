import { rasterizeText } from '../lib/measure'
import { escapeXml, FONT_STACKS, r2, rect } from '../lib/svg'
import { bool, num, pal, str, type SvgTool } from './types'

export const barType: SvgTool = {
  id: 'bar-type',
  name: 'Bar Type',
  category: 'Type',
  description: 'Letterforms rebuilt from horizontal bars, plus redaction-style text blocks.',
  kind: 'svg',
  raw: true,
  animated: true,
  duration: 5,
  params: [
    {
      type: 'select', key: 'mode', label: 'Mode', default: 'stripes',
      options: [{ value: 'stripes', label: 'Striped type' }, { value: 'redact', label: 'Redaction' }],
    },
    { type: 'text', key: 'text', label: 'Text', default: 'P', maxLength: 16, suggestions: ['P', 'BP', 'A', 'R', 'ECHO', 'K', '07'], when: (p) => p.mode === 'stripes' },
    { type: 'palette', key: 'palette', label: 'Palette (paper, ink, rules)', default: ['#EDEDED', '#0A0A0A', '#DCDCDC'], min: 3, max: 3 },
    {
      type: 'select', key: 'font', label: 'Typeface', default: 'sans',
      options: [{ value: 'sans', label: 'Grotesk' }, { value: 'mono', label: 'Mono' }, { value: 'serif', label: 'Serif' }],
      when: (p) => p.mode === 'stripes',
    },
    { type: 'number', key: 'rows', label: 'Bars', min: 4, max: 48, step: 1, default: 8, rand: [6, 16] },
    { type: 'number', key: 'gap', label: 'Gap', min: 0, max: 0.85, step: 0.01, default: 0.3 },
    { type: 'number', key: 'scale', label: 'Scale', min: 0.2, max: 1, step: 0.01, default: 0.6 },
    { type: 'number', key: 'minRun', label: 'Min bar', min: 0, max: 0.2, step: 0.005, default: 0.03, when: (p) => p.mode === 'stripes' },
    { type: 'boolean', key: 'rules', label: 'Background rules', default: true },
    { type: 'boolean', key: 'mark', label: '® mark', default: true, when: (p) => p.mode === 'stripes' },
  ],
  defaults: { format: 'landscape', finish: { grain: 0.15, grainType: 'soft' } },
  presets: [
    { name: 'Monogram', format: 'landscape', seed: 7 },
    {
      name: 'Redacted', format: 'landscape', seed: 19,
      params: { mode: 'redact', palette: ['#0A0A0A', '#F2F2F2', '#161616'], rows: 7, gap: 0.3, scale: 0.55, rules: false },
      finish: { grain: 0.3, grainType: 'light' },
    },
    {
      name: 'Signal red', format: 'square', seed: 7,
      params: { text: 'A', palette: ['#FF2A10', '#F1EEE8', '#FF4A33'], rows: 14, gap: 0.5, scale: 0.62 },
      finish: { grain: 0.45, grainType: 'soft' },
    },
  ],
  render({ w, h, p, rng, t }) {
    const [bg, ink, rule] = pal(p, 'palette')
    const rows = num(p, 'rows')
    const gap = num(p, 'gap')
    const scale = num(p, 'scale')
    const m = Math.min(w, h)
    // reveal wave: full at t=0, bars retract right-to-left and return
    const reveal = (row: number) => 1 - 0.3 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * (t - row * 0.04)))
    let bars = ''
    let mark = ''

    if (str(p, 'mode') === 'redact') {
      const blockW = w * scale * 1.4
      const x0 = (w - blockW) / 2
      const lh = (h * scale) / rows
      const y0 = (h - lh * rows) / 2
      for (let i = 0; i < rows; i++) {
        const y = y0 + i * lh
        let x = x0 + (rng.chance(0.3) ? rng.range(0.05, 0.25) * blockW : 0)
        const end = x0 + blockW * rng.range(0.7, 1)
        const k = reveal(i)
        while (x < end) {
          const ww = Math.min(end - x, blockW * rng.range(0.08, 0.32))
          bars += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(ww * k)}" height="${r2(lh * (1 - gap))}"/>`
          x += ww + lh * rng.range(0.4, 0.9)
        }
      }
    } else {
      const text = str(p, 'text').trim() || 'P'
      const family = FONT_STACKS[str(p, 'font')] ?? FONT_STACKS.sans
      const raster = rasterizeText(text, (s) => `800 ${s}px ${family}`, 240)
      const inkH = raster.bottom - raster.top
      const inkW = raster.right - raster.left
      const targetH = h * scale
      const k = Math.min(targetH / inkH, (w * 0.86) / inkW)
      const ox = (w - inkW * k) / 2
      const oy = (h - inkH * k) / 2
      const rowH = (inkH * k) / rows
      const minRun = num(p, 'minRun') * inkW
      for (let r = 0; r < rows; r++) {
        // sample the middle scanline of this band
        const sy = Math.floor(raster.top + ((r + 0.5) / rows) * inkH)
        let start = -1
        const rv = reveal(r)
        for (let x = raster.left; x <= raster.right + 1; x++) {
          const on = x <= raster.right && raster.data[(sy * raster.width + x) * 4 + 3] > 110
          if (on && start < 0) start = x
          if (!on && start >= 0) {
            if (x - start >= minRun) {
              const bx = ox + (start - raster.left) * k
              const bw = (x - start) * k
              bars += `<rect x="${r2(bx)}" y="${r2(oy + r * rowH)}" width="${r2(bw * rv)}" height="${r2(rowH * (1 - gap))}"/>`
            }
            start = -1
          }
        }
      }
      if (bool(p, 'mark')) {
        const ms = m * 0.028
        const mx = ox + inkW * k + ms * 0.9
        const my = oy + inkH * k - ms * 0.2
        mark = `<g transform="translate(${r2(mx)} ${r2(my)})"><circle r="${r2(ms / 2)}" fill="none" stroke="${ink}" stroke-width="${r2(ms * 0.09)}"/>` +
          `<text text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(FONT_STACKS.sans)}" font-weight="700" font-size="${r2(ms * 0.62)}" fill="${ink}">R</text></g>`
      }
    }

    let rules = ''
    if (bool(p, 'rules')) {
      const n = Math.round(h / (m * 0.045))
      let d = ''
      for (let i = 0; i < n; i++) d += `M0,${r2((i + 0.5) * (h / n))}H${w}`
      rules = `<path d="${d}" stroke="${rule}" stroke-width="${r2(m * 0.012)}"/>`
    }
    return rect(w, h, bg) + rules + `<g fill="${ink}">${bars}</g>` + mark
  },
}
