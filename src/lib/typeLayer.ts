import type { Param, ParamValues } from '../tools/types'
import { measureText } from './measure'
import { escapeXml, FONT_STACKS, r2 } from './svg'

/** Editorial text layer: title, body, a highlighted label and a mono caption. */
export const TYPE_PARAMS: Param[] = [
  { type: 'boolean', key: 'enabled', label: 'Show type', default: false },
  {
    type: 'select', key: 'layout', label: 'Layout', default: 'br',
    options: [
      { value: 'br', label: 'Bottom right' }, { value: 'bl', label: 'Bottom left' }, { value: 'tl', label: 'Top left' },
      { value: 'center', label: 'Centred' }, { value: 'stack', label: 'Stacked words' },
    ],
  },
  { type: 'text', key: 'title', label: 'Title', default: 'The work begins.', maxLength: 80 },
  { type: 'text', key: 'body', label: 'Body', default: 'Generative systems for brand, motion and print; made in the browser', maxLength: 240 },
  { type: 'text', key: 'label', label: 'Label (highlighted)', default: 'Brand Playground', maxLength: 48 },
  { type: 'text', key: 'caption', label: 'Caption (mono)', default: 'Image 0034, Field study ■ Edition 01', maxLength: 80 },
  {
    type: 'select', key: 'font', label: 'Typeface', default: 'sans',
    options: [{ value: 'sans', label: 'Grotesk' }, { value: 'mono', label: 'Mono' }],
  },
  { type: 'number', key: 'size', label: 'Size', min: 0.5, max: 6, step: 0.05, default: 1 },
  { type: 'number', key: 'measure', label: 'Column width', min: 0.2, max: 0.9, step: 0.01, default: 0.4 },
  { type: 'number', key: 'margin', label: 'Margin', min: 0.02, max: 0.15, step: 0.005, default: 0.055 },
  { type: 'boolean', key: 'uppercase', label: 'Uppercase', default: true },
  { type: 'number', key: 'rough', label: 'Ink bleed', min: 0, max: 1, step: 0.01, default: 0 },
  { type: 'color', key: 'color', label: 'Text colour', default: '#EDEDED' },
  { type: 'color', key: 'labelBg', label: 'Label highlight', default: '#E4E4E4' },
  { type: 'color', key: 'labelInk', label: 'Label text', default: '#111111' },
].map((p) => ({ ...p, randomize: false, when: p.key === 'enabled' ? undefined : (v: ParamValues) => v.enabled === true })) as Param[]

function wrap(text: string, font: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && measureText(next, font) > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

interface Block {
  h: number
  draw: (x: number, top: number, anchor: 'start' | 'middle' | 'end') => string
}

/**
 * Ragged, soaked-in letter edges: fine turbulence roughens the outline, then a blur
 * re-thresholded through the alpha channel swells it like ink wicking into paper.
 * The id is derived from the inputs, so identical filters in one document can share it.
 */
function inkFilter(rough: number, u: number) {
  const id = `ink-type-${Math.round(rough * 100)}-${Math.round(u * 1000)}`
  const def =
    `<filter id="${id}" x="-5%" y="-20%" width="110%" height="140%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${r2(0.22 / u)}" numOctaves="3" seed="3" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="${r2((1.5 + rough * 7) * u)}" xChannelSelector="R" yChannelSelector="G" result="d"/>` +
    `<feGaussianBlur in="d" stdDeviation="${r2((0.4 + rough * 1.4) * u)}"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="${r2(2.2 + rough * 1.5)}" intercept="${r2(-0.45 - rough * 0.2)}"/></feComponentTransfer>` +
    `</filter>`
  return { id, def }
}

/** Inner SVG markup for the text layer ('' when disabled). */
export function renderTypeLayer(p: ParamValues, w: number, h: number) {
  if (!p.enabled) return ''
  const markup = renderText(p, w, h)
  const rough = (p.rough as number) ?? 0
  if (rough <= 0) return markup
  const f = inkFilter(rough, Math.min(w, h) / 1080)
  return `${f.def}<g filter="url(#${f.id})">${markup}</g>`
}

function renderText(p: ParamValues, w: number, h: number) {
  const u = Math.min(w, h) / 1080
  const scale = (p.size as number) ?? 1
  const upper = p.uppercase !== false
  const tx = (s: unknown) => {
    const v = String(s ?? '').trim()
    return upper ? v.toUpperCase() : v
  }
  const mono = p.font === 'mono'
  const family = mono ? FONT_STACKS.mono : FONT_STACKS.sans
  const monoFamily = FONT_STACKS.mono
  const color = String(p.color ?? '#EDEDED')
  const margin = Math.min(w, h) * ((p.margin as number) ?? 0.055)
  const layout = String(p.layout ?? 'br')
  const colW = Math.max(w * ((p.measure as number) ?? 0.4), 120 * u)
  const fs = 34 * u * scale
  const lh = fs * 1.12
  const weight = mono ? 400 : 500
  const font = `${weight} ${fs}px ${family}`
  const familyAttr = `font-family="${escapeXml(family)}"`

  const textBlock = (raw: string): Block | null => {
    if (!raw) return null
    const lines = wrap(raw, font, colW)
    return {
      h: lines.length * lh,
      draw: (x, top, anchor) =>
        `<text ${familyAttr} font-size="${r2(fs)}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">` +
        lines.map((l, i) => `<tspan x="${r2(x)}" y="${r2(top + fs * 0.86 + i * lh)}">${escapeXml(l)}</tspan>`).join('') +
        '</text>',
    }
  }
  const labelBlock = (raw: string): Block | null => {
    if (!raw) return null
    const lfs = fs * 1.05
    const lw = measureText(raw, `${weight} ${lfs}px ${family}`)
    const padX = lfs * 0.08
    const boxH = lfs * 1.12
    return {
      h: boxH,
      draw: (x, top, anchor) => {
        const left = anchor === 'start' ? x : anchor === 'end' ? x - lw : x - lw / 2
        return (
          `<rect x="${r2(left - padX)}" y="${r2(top)}" width="${r2(lw + padX * 2)}" height="${r2(boxH)}" fill="${String(p.labelBg ?? '#E4E4E4')}"/>` +
          `<text ${familyAttr} font-size="${r2(lfs)}" font-weight="${weight}" fill="${String(p.labelInk ?? '#111')}" x="${r2(left)}" y="${r2(top + lfs * 0.86)}">${escapeXml(raw)}</text>`
        )
      },
    }
  }

  const title = tx(p.title)
  const body = tx(p.body)
  const label = tx(p.label)
  const caption = tx(p.caption)
  // captions stop growing at poster sizes, so a huge title can keep a small colophon
  const cfs = 15 * u * Math.min(scale, 2.5)
  const captionMarkup = (x: number, y: number, anchor: string) =>
    caption
      ? `<text font-family="${escapeXml(monoFamily)}" font-size="${r2(cfs)}" font-weight="400" fill="${color}" text-anchor="${anchor}" x="${r2(x)}" y="${r2(y)}" letter-spacing="${r2(cfs * 0.04)}">${escapeXml(caption)}</text>`
      : ''

  if (layout === 'stack') {
    // One word per step down the centre line, spread over the full height.
    const words = `${title} ${body}`.split(/\s+/).filter(Boolean)
    const sfs = 26 * u * scale
    const top = margin + sfs
    const bottom = h - margin - (label ? sfs * 2 : 0)
    const step = words.length > 1 ? (bottom - top) / (words.length - 1) : 0
    let out = words
      .map((word, i) => `<text ${familyAttr} font-size="${r2(sfs)}" font-weight="${weight}" fill="${color}" text-anchor="middle" x="${r2(w / 2)}" y="${r2(top + i * step)}">${escapeXml(word)}</text>`)
      .join('')
    const lb = labelBlock(label)
    if (lb) out += lb.draw(w / 2, h - margin - lb.h, 'middle')
    return `<g>${out}${captionMarkup(margin, margin + cfs, 'start')}</g>`
  }

  // Title, body and label stack with generous gaps, like an editorial colophon.
  const gap = lh * 1.9
  const blocks = [textBlock(title), textBlock(body), labelBlock(label)].filter((b): b is Block => !!b)
  const total = blocks.reduce((s, b) => s + b.h, 0) + gap * Math.max(0, blocks.length - 1)

  let x: number
  let top: number
  let anchor: 'start' | 'middle' | 'end' = 'start'
  let cap = ''
  if (layout === 'tl') {
    x = margin
    top = margin
    cap = captionMarkup(w - margin, h - margin, 'end')
  } else if (layout === 'bl') {
    x = margin
    top = h - margin - total
    cap = captionMarkup(w - margin, margin + cfs, 'end')
  } else if (layout === 'center') {
    x = w / 2
    anchor = 'middle'
    top = (h - total) / 2
    cap = captionMarkup(w / 2, h - margin, 'middle')
  } else {
    x = Math.max(margin, w - margin - colW)
    top = h - margin - total
    cap = captionMarkup(margin, margin + cfs, 'start')
  }
  let out = ''
  for (const b of blocks) {
    out += b.draw(x, top, anchor)
    top += b.h + gap
  }
  return `<g>${out}${cap}</g>`
}
