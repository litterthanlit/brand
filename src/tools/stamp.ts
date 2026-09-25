import { escapeXml, FONT_STACKS, r2, rect } from '../lib/svg'
import { bool, num, pal, str, type SvgTool } from './types'

const FONT_OPTIONS = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'condensed', label: 'Condensed' },
]

/** How far each shape's valleys dip inward, as a fraction of its outer radius. */
const INNER: Record<string, number> = { circle: 1, burst: 0.9, scallop: 0.97, star: 0.8 }

function outline(shape: string, cx: number, cy: number, R: number, points: number) {
  if (shape === 'circle') {
    return `M${r2(cx - R)},${r2(cy)}a${r2(R)},${r2(R)} 0 1,0 ${r2(2 * R)},0a${r2(R)},${r2(R)} 0 1,0 ${r2(-2 * R)},0Z`
  }
  const pts: string[] = []
  if (shape === 'scallop') {
    // arcs bulging outward between points on the circle
    const step = (Math.PI * 2) / points
    const chord = 2 * R * Math.sin(step / 2)
    const br = chord * 0.56
    let d = ''
    for (let i = 0; i <= points; i++) {
      const a = i * step - Math.PI / 2
      const x = cx + Math.cos(a) * R
      const y = cy + Math.sin(a) * R
      d += i === 0 ? `M${r2(x)},${r2(y)}` : `A${r2(br)},${r2(br)} 0 0,1 ${r2(x)},${r2(y)}`
    }
    return d + 'Z'
  }
  const inner = INNER[shape] ?? 0.9
  const count = points * 2
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 === 0 ? R : R * inner
    pts.push(`${r2(cx + Math.cos(a) * rr)},${r2(cy + Math.sin(a) * rr)}`)
  }
  return `M${pts.join('L')}Z`
}

export const stamp: SvgTool = {
  id: 'stamp',
  name: 'Stamp',
  category: 'Type',
  description: 'Circular badges and seals with text on a path, for stickers, seals and marks.',
  kind: 'svg',
  animated: true,
  duration: 12,
  params: [
    {
      type: 'text', key: 'text', label: 'Ring text', default: 'BRAND PLAYGROUND ✦ MADE WITH CARE ✦ ', maxLength: 80,
      suggestions: [
        'BRAND PLAYGROUND ✦ MADE WITH CARE ✦ ',
        'FRESHLY BAKED • EVERY DAY • SINCE 2026 • ',
        'CERTIFIED ORIGINAL ★ LIMITED EDITION ★ ',
        'STUDIO • DESIGN • MOTION • TYPE • ',
        'HAND CRAFTED — SMALL BATCH — ',
      ],
    },
    { type: 'text', key: 'center', label: 'Centre mark', default: 'BP', maxLength: 6, suggestions: ['BP', '★', '✦', '26', 'NO.1', '◎', 'A+'] },
    {
      type: 'select', key: 'shape', label: 'Shape', default: 'burst',
      options: [{ value: 'circle', label: 'Circle' }, { value: 'burst', label: 'Burst' }, { value: 'scallop', label: 'Scallop' }, { value: 'star', label: 'Star' }],
    },
    { type: 'number', key: 'points', label: 'Points', min: 6, max: 48, step: 1, default: 24, rand: [12, 32], when: (p) => p.shape !== 'circle' },
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#F4F2EE', '#111111', '#FF4F12'], min: 3, max: 3 },
    { type: 'select', key: 'font', label: 'Typeface', default: 'sans', options: FONT_OPTIONS },
    { type: 'number', key: 'textSize', label: 'Text size', min: 0.06, max: 0.2, step: 0.005, default: 0.11 },
    { type: 'number', key: 'size', label: 'Badge size', min: 0.4, max: 0.95, step: 0.01, default: 0.78 },
    { type: 'boolean', key: 'rings', label: 'Guide rings', default: true },
    { type: 'boolean', key: 'outlineOnly', label: 'Outline only', default: false },
    { type: 'number', key: 'rotation', label: 'Rotation', min: 0, max: 360, step: 1, default: 0, unit: '°' },
  ],
  render({ w, h, p, t, uid }) {
    const [bg, ink, accent] = pal(p, 'palette')
    const cx = w / 2
    const cy = h / 2
    const R = (Math.min(w, h) / 2) * num(p, 'size')
    const fs = R * num(p, 'textSize') * 1.6
    const font = FONT_STACKS[str(p, 'font')] ?? FONT_STACKS.sans
    const outlineOnly = bool(p, 'outlineOnly')
    const shape = str(p, 'shape')
    const stroke = Math.max(1, R * 0.012)
    // keep the text ring (and its guide rings) inside the shape's innermost edge
    const rt = R * (INNER[shape] ?? 0.9) * 0.9 - fs * 0.8
    const text = escapeXml(str(p, 'text') || ' ')
    const center = escapeXml(str(p, 'center'))
    const rot = num(p, 'rotation') + t * 360
    const id = `ring-${uid}`
    const shapeFill = outlineOnly ? 'none' : accent
    const shapeStroke = outlineOnly ? ink : 'none'

    let out = rect(w, h, bg)
    out += `<g transform="rotate(${r2(rot)} ${r2(cx)} ${r2(cy)})">`
    out += `<path d="${outline(shape, cx, cy, R, num(p, 'points'))}" fill="${shapeFill}" stroke="${shapeStroke}" stroke-width="${r2(stroke * 1.5)}" stroke-linejoin="round"/>`
    out += `<path id="${id}" d="M${r2(cx)},${r2(cy - rt)}a${r2(rt)},${r2(rt)} 0 1,1 0,${r2(2 * rt)}a${r2(rt)},${r2(rt)} 0 1,1 0,${r2(-2 * rt)}" fill="none"/>`
    if (bool(p, 'rings')) {
      const outer = rt + fs * 0.95
      const inner = rt - fs * 0.45
      for (const rr of [outer, inner]) {
        out += `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(rr)}" fill="none" stroke="${ink}" stroke-width="${r2(stroke)}"/>`
      }
    }
    out += `<text font-family="${escapeXml(font)}" font-size="${r2(fs)}" font-weight="700" fill="${ink}">`
    out += `<textPath href="#${id}" textLength="${r2(2 * Math.PI * rt - 1)}" lengthAdjust="spacing">${text}</textPath></text>`
    out += '</g>'
    if (center) {
      const cs = (R * 0.62) / Math.max(1.4, [...str(p, 'center')].length * 0.62)
      out += `<text x="${r2(cx)}" y="${r2(cy)}" text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(font)}" font-size="${r2(cs)}" font-weight="700" fill="${ink}">${center}</text>`
    }
    return out
  },
}
