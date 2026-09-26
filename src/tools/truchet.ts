import { r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const truchet: SvgTool = {
  id: 'truchet',
  name: 'Truchet',
  category: 'Pattern',
  description: 'Randomly rotated tiles that snap into maze-like, endlessly repeatable patterns.',
  kind: 'svg',
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#F2EFE9', '#002FA7', '#0A0A0A'], min: 2, max: 5 },
    {
      type: 'select', key: 'tile', label: 'Tile', default: 'arcs',
      options: [
        { value: 'arcs', label: 'Arcs' }, { value: 'diagonal', label: 'Diagonal' },
        { value: 'triangle', label: 'Triangle' }, { value: 'quarter', label: 'Quarter' }, { value: 'mixed', label: 'Mixed' },
      ],
    },
    { type: 'number', key: 'cells', label: 'Tiles across', min: 3, max: 40, step: 1, default: 10, rand: [5, 24] },
    {
      type: 'number', key: 'weight', label: 'Stroke weight', min: 0.03, max: 0.5, step: 0.01, default: 0.18,
      when: (p) => ['arcs', 'diagonal', 'mixed'].includes(p.tile as string),
    },
    {
      type: 'select', key: 'colorMode', label: 'Colour', default: 'single',
      options: [{ value: 'single', label: 'Single' }, { value: 'random', label: 'Random' }, { value: 'checker', label: 'Checker' }],
    },
  ],
  render({ w, h, p, rng }) {
    const [bg, ...inks] = pal(p, 'palette')
    const cols = num(p, 'cells')
    const s = w / cols
    const rows = Math.ceil(h / s)
    const oy = (h - rows * s) / 2
    const weight = num(p, 'weight') * s
    const tile = str(p, 'tile')
    const mode = str(p, 'colorMode')
    const strokes: string[] = inks.map(() => '')
    const fills: string[] = inks.map(() => '')
    const kinds = ['arcs', 'diagonal', 'triangle', 'quarter']

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * s
        const y = oy + j * s
        const flip = rng.int(0, 3)
        const kind = tile === 'mixed' ? rng.pick(kinds) : tile
        const colorRoll = rng()
        const ci = mode === 'random' ? Math.floor(colorRoll * inks.length) : mode === 'checker' ? (i + j) % inks.length : 0
        const hs = s / 2
        // corners in rotation order: TL, TR, BR, BL
        const corners: [number, number][] = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
        const c = (k: number) => corners[(k + flip) % 4]
        if (kind === 'arcs') {
          const [ax, ay] = c(0)
          const [bx, by] = c(2)
          const arc = (cx: number, cy: number) => {
            // arc from the midpoint of one adjacent edge to the other, centred at a corner
            const sweep = (cx === x) === (cy === y) ? 1 : 0
            return `M${r2(x + hs)},${r2(cy)}A${r2(hs)},${r2(hs)} 0 0,${sweep} ${r2(cx)},${r2(y + hs)}`
          }
          strokes[ci] += arc(ax, ay) + arc(bx, by)
        } else if (kind === 'diagonal') {
          const [ax, ay] = c(0)
          const [bx, by] = c(2)
          strokes[ci] += `M${r2(ax)},${r2(ay)}L${r2(bx)},${r2(by)}`
        } else if (kind === 'triangle') {
          const [ax, ay] = c(0)
          const [bx, by] = c(1)
          const [dx, dy] = c(3)
          fills[ci] += `M${r2(ax)},${r2(ay)}L${r2(bx)},${r2(by)}L${r2(dx)},${r2(dy)}Z`
        } else {
          const [ax, ay] = c(0)
          const [bx, by] = c(1)
          const [dx, dy] = c(3)
          // quarter disc anchored at corner a, radius = tile size
          fills[ci] += `M${r2(ax)},${r2(ay)}L${r2(bx)},${r2(by)}A${r2(s)},${r2(s)} 0 0,1 ${r2(dx)},${r2(dy)}Z`
        }
      }
    }
    let out = rect(w, h, bg)
    inks.forEach((ink, i) => {
      if (fills[i]) out += `<path fill="${ink}" d="${fills[i]}"/>`
      if (strokes[i]) out += `<path fill="none" stroke="${ink}" stroke-width="${r2(weight)}" stroke-linecap="round" d="${strokes[i]}"/>`
    })
    return out
  },
}
