import { measureText } from '../lib/measure'
import { escapeXml, FONT_STACKS, r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const typeRepeat: SvgTool = {
  id: 'type-repeat',
  name: 'Type Repeat',
  category: 'Type',
  description: 'A word repeated into kinetic rows, perfect for posters, merch and marquees.',
  kind: 'svg',
  animated: true,
  duration: 6,
  params: [
    {
      type: 'text', key: 'text', label: 'Text', default: 'PLAYGROUND', maxLength: 40,
      suggestions: ['PLAYGROUND', 'MAKE THINGS', 'HELLO', 'STUDIO', 'NEW DROP', 'OPEN LATE', 'FUTURE'],
    },
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#F4F2EE', '#111111', '#FF4F12'], min: 2, max: 4 },
    {
      type: 'select', key: 'font', label: 'Typeface', default: 'condensed',
      options: [{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }, { value: 'condensed', label: 'Condensed' }],
    },
    {
      type: 'select', key: 'weight', label: 'Weight', default: '800',
      options: [{ value: '400', label: 'Regular' }, { value: '600', label: 'Semibold' }, { value: '800', label: 'Heavy' }],
    },
    { type: 'number', key: 'rows', label: 'Rows', min: 2, max: 30, step: 1, default: 9, rand: [4, 14] },
    { type: 'number', key: 'leading', label: 'Leading', min: 0.7, max: 1.6, step: 0.01, default: 0.95 },
    { type: 'number', key: 'gap', label: 'Word gap', min: 0, max: 2, step: 0.05, default: 0.4 },
    { type: 'number', key: 'stagger', label: 'Stagger', min: 0, max: 1, step: 0.01, default: 0.35 },
    {
      type: 'select', key: 'style', label: 'Style', default: 'alternate',
      options: [{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }, { value: 'alternate', label: 'Alternate' }],
    },
    { type: 'number', key: 'skew', label: 'Slant', min: -20, max: 20, step: 1, default: 0, unit: '°' },
  ],
  render({ w, h, p, rng, t }) {
    const [bg, ink, ...accents] = pal(p, 'palette')
    const rows = num(p, 'rows')
    const leading = num(p, 'leading')
    const rowH = h / rows
    const fs = rowH / leading
    const family = FONT_STACKS[str(p, 'font')] ?? FONT_STACKS.sans
    const weight = str(p, 'weight')
    const raw = str(p, 'text').trim() || ' '
    const text = escapeXml(raw)
    const wordW = Math.max(fs * 0.5, measureText(raw, `${weight} ${fs}px ${family}`))
    const unit = wordW + num(p, 'gap') * fs
    const copies = Math.ceil(w / unit) + 2
    const stagger = num(p, 'stagger')
    const style = str(p, 'style')
    const accentRow = accents.length ? rng.int(0, rows - 1) : -1
    const sw = Math.max(1, fs * 0.025)

    let out = rect(w, h, bg)
    out += `<g transform="translate(${r2(w / 2)} ${r2(h / 2)}) skewX(${-num(p, 'skew')}) translate(${r2(-w / 2)} ${r2(-h / 2)})" font-family="${escapeXml(family)}" font-weight="${weight}" font-size="${r2(fs)}">`
    for (let i = 0; i < rows; i++) {
      const dir = i % 2 === 0 ? 1 : -1
      const phase = (((i * stagger + dir * t) % 1) + 1) % 1
      const x0 = -unit * (1 + phase)
      const y = rowH * (i + 0.5)
      const outlined = style === 'outline' || (style === 'alternate' && i % 2 === 1)
      const color = i === accentRow ? accents[i % accents.length] : ink
      const paint = outlined ? `fill="none" stroke="${color}" stroke-width="${r2(sw)}"` : `fill="${color}"`
      let row = ''
      for (let k = 0; k < copies; k++) {
        row += `<text x="${r2(x0 + k * unit)}" y="${r2(y)}" dominant-baseline="central" textLength="${r2(wordW)}" lengthAdjust="spacingAndGlyphs">${text}</text>`
      }
      out += `<g ${paint}>${row}</g>`
    }
    return out + '</g>'
  },
}
