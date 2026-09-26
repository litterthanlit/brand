import { r2, rect } from '../lib/svg'
import { num, pal, type SvgTool } from './types'

export const bauhaus: SvgTool = {
  id: 'bauhaus',
  name: 'Bauhaus Grid',
  category: 'Shape',
  description: 'Modular grids of quarter circles, half moons and blocks: instant brand systems.',
  kind: 'svg',
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#EFE8DA', '#1C1C1C', '#D8352A', '#2A5CAA', '#F2B632'], min: 3, max: 6 },
    { type: 'number', key: 'cols', label: 'Columns', min: 1, max: 16, step: 1, default: 5, rand: [3, 9] },
    { type: 'number', key: 'gap', label: 'Gutter', min: 0, max: 0.25, step: 0.005, default: 0.04 },
    { type: 'number', key: 'layers', label: 'Layering', min: 0, max: 1, step: 0.01, default: 0.45 },
    { type: 'number', key: 'roundness', label: 'Roundness', min: 0, max: 1, step: 0.01, default: 0.7 },
    { type: 'number', key: 'margin', label: 'Margin', min: 0, max: 0.2, step: 0.005, default: 0.06 },
  ],
  render({ w, h, p, rng }) {
    const [bg, ...inks] = pal(p, 'palette')
    const cols = num(p, 'cols')
    const margin = Math.min(w, h) * num(p, 'margin')
    const iw = w - margin * 2
    const cellW = iw / cols
    const rows = Math.max(1, Math.round((h - margin * 2) / cellW))
    const cellH = (h - margin * 2) / rows
    const gap = Math.min(cellW, cellH) * num(p, 'gap') * 2
    const round = num(p, 'roundness')
    const layerP = num(p, 'layers')
    let out = rect(w, h, bg)

    const shape = (x: number, y: number, sw: number, sh: number, color: string) => {
      const curved = rng() < round
      const k = rng.int(0, 3)
      const m = Math.min(sw, sh)
      if (curved) {
        const type = rng.pick(['quarter', 'half', 'circle', 'quarter'])
        if (type === 'circle') {
          const r = m * rng.pick([0.5, 0.36, 0.25])
          return `<circle cx="${r2(x + sw / 2)}" cy="${r2(y + sh / 2)}" r="${r2(r)}" fill="${color}"/>`
        }
        if (type === 'half') {
          // half disc sitting on one edge
          const edges = [
            `M${r2(x)},${r2(y + sh)}A${r2(sw / 2)},${r2(Math.min(sh, sw / 2))} 0 0,1 ${r2(x + sw)},${r2(y + sh)}Z`,
            `M${r2(x)},${r2(y)}A${r2(Math.min(sw, sh / 2))},${r2(sh / 2)} 0 0,1 ${r2(x)},${r2(y + sh)}Z`,
            `M${r2(x + sw)},${r2(y)}A${r2(sw / 2)},${r2(Math.min(sh, sw / 2))} 0 0,1 ${r2(x)},${r2(y)}Z`,
            `M${r2(x + sw)},${r2(y + sh)}A${r2(Math.min(sw, sh / 2))},${r2(sh / 2)} 0 0,1 ${r2(x + sw)},${r2(y)}Z`,
          ]
          return `<path d="${edges[k]}" fill="${color}"/>`
        }
        // quarter disc from a corner
        const corners: [number, number, number, number, number, number][] = [
          [x, y, x + sw, y, x, y + sh],
          [x + sw, y, x + sw, y + sh, x, y],
          [x + sw, y + sh, x, y + sh, x + sw, y],
          [x, y + sh, x, y, x + sw, y + sh],
        ]
        const [ax, ay, bx, by, dx, dy] = corners[k]
        return `<path d="M${r2(ax)},${r2(ay)}L${r2(bx)},${r2(by)}A${r2(sw)},${r2(sh)} 0 0,1 ${r2(dx)},${r2(dy)}Z" fill="${color}"/>`
      }
      const type = rng.pick(['triangle', 'block', 'stripe'])
      if (type === 'triangle') {
        const pts = [[x, y], [x + sw, y], [x + sw, y + sh], [x, y + sh]]
        const tri = [pts[k], pts[(k + 1) % 4], pts[(k + 2) % 4]]
        return `<path d="M${tri.map(([a, b]) => `${r2(a)},${r2(b)}`).join('L')}Z" fill="${color}"/>`
      }
      if (type === 'stripe') {
        const n = rng.int(3, 5)
        let s = ''
        const vertical = rng.chance(0.5)
        for (let i = 0; i < n; i++) {
          if (i % 2) continue
          s += vertical
            ? `<rect x="${r2(x + (i * sw) / n)}" y="${r2(y)}" width="${r2(sw / n)}" height="${r2(sh)}" fill="${color}"/>`
            : `<rect x="${r2(x)}" y="${r2(y + (i * sh) / n)}" width="${r2(sw)}" height="${r2(sh / n)}" fill="${color}"/>`
        }
        return s
      }
      const inset = m * rng.pick([0, 0.2, 0.3])
      return `<rect x="${r2(x + inset)}" y="${r2(y + inset)}" width="${r2(sw - inset * 2)}" height="${r2(sh - inset * 2)}" fill="${color}"/>`
    }

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = margin + i * cellW + gap / 2
        const y = margin + j * cellH + gap / 2
        const sw = cellW - gap
        const sh = cellH - gap
        const [base, fg, fg2] = rng.shuffle(inks.length >= 3 ? inks : [...inks, bg, bg])
        if (rng.chance(0.75)) out += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(sw)}" height="${r2(sh)}" fill="${base}"/>`
        out += shape(x, y, sw, sh, fg)
        if (rng() < layerP) out += shape(x, y, sw, sh, fg2)
      }
    }
    return out
  },
}
