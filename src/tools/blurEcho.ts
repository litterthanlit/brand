import { hexToRgb } from '../lib/color'
import { r2, rect } from '../lib/svg'
import { num, pal, str, type SvgTool } from './types'

export const blurEcho: SvgTool = {
  id: 'blur-echo',
  name: 'Blur Echo',
  category: 'Shape',
  description: 'Forms that soften row by row, sliced into refracting strips like reeded glass.',
  kind: 'svg',
  raw: true,
  animated: true,
  duration: 8,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (paper, ink, ink 2)', default: ['#F1EEE8', '#FF2A10'], min: 2, max: 3 },
    {
      type: 'select', key: 'shape', label: 'Form', default: 'disc',
      options: [{ value: 'disc', label: 'Disc' }, { value: 'pill', label: 'Pill' }, { value: 'square', label: 'Square' }],
    },
    { type: 'number', key: 'rows', label: 'Rows', min: 1, max: 9, step: 1, default: 5 },
    { type: 'number', key: 'size', label: 'Form size', min: 0.4, max: 1.3, step: 0.01, default: 0.92 },
    { type: 'number', key: 'blurStart', label: 'Blur start', min: 0, max: 1, step: 0.01, default: 0 },
    { type: 'number', key: 'blurEnd', label: 'Blur end', min: 0, max: 1, step: 0.01, default: 0.95 },
    { type: 'number', key: 'strips', label: 'Strips', min: 1, max: 11, step: 2, default: 7 },
    { type: 'number', key: 'gap', label: 'Strip gap', min: 0, max: 0.06, step: 0.001, default: 0.012 },
    { type: 'number', key: 'shift', label: 'Refraction', min: 0, max: 1.5, step: 0.01, default: 0.55 },
    { type: 'number', key: 'falloff', label: 'Strip falloff', min: 0, max: 0.3, step: 0.01, default: 0.1 },
    { type: 'number', key: 'offsetY', label: 'Vertical offset', min: -0.5, max: 0.5, step: 0.01, default: -0.5 },
  ],
  defaults: {
    format: 'portrait',
    finish: { grain: 0.6, grainType: 'soft', grainSize: 0.9 },
    type: { enabled: true, layout: 'stack', title: 'Be a voice', body: 'not an echo', label: '', caption: '', color: '#141414', size: 1 },
  },
  presets: [
    { name: 'Echo', format: 'portrait', seed: 7 },
    {
      name: 'Night lens', format: 'portrait', seed: 7,
      params: { palette: ['#0B0B0C', '#3D5BFF', '#FF6BD6'], shape: 'pill', rows: 4, strips: 9, shift: 0.9 },
      finish: { grain: 0.5, grainType: 'soft' },
      type: { enabled: true, layout: 'stack', title: 'Signal', body: 'over noise', color: '#EDEDED' },
    },
    {
      name: 'Tablet', format: 'landscape', seed: 3,
      params: { palette: ['#E9E4D8', '#1F3D2B', '#E4572E'], shape: 'square', rows: 3, strips: 5, falloff: 0.18 },
      finish: { grain: 0.55, grainType: 'speckle' },
      type: { enabled: true, layout: 'bl', title: 'Slow form', body: 'Studies in softness', label: '', caption: 'NO. 12', color: '#1F3D2B' },
    },
  ],
  render({ w, h, p, t, uid }) {
    const [bg, ink, ink2] = pal(p, 'palette')
    const rows = num(p, 'rows')
    const strips = num(p, 'strips')
    const shape = str(p, 'shape')
    const b0 = num(p, 'blurStart')
    const b1 = num(p, 'blurEnd')
    const pitch = h / rows
    const R = Math.min(pitch, w * 0.34) * 0.5 * num(p, 'size')
    const oy = num(p, 'offsetY') * pitch

    // Pattern: one column of forms at x = w/2, softness rising down the page.
    let defs = ''
    let pattern = ''
    for (let i = 0; i <= rows; i++) {
      const k = rows > 1 ? Math.min(1, i / (rows - 1)) : 0
      const b = b0 + (b1 - b0) * k
      const color = ink2 && i % 2 === 1 ? ink2 : ink
      const [cr, cg, cb] = hexToRgb(color)
      const cy = pitch * (i + 0.5) + oy
      const outer = R * (1 + b * 0.55)
      const solid = Math.max(0, (R * (1 - b * 0.85)) / outer)
      const gid = `be-${uid}-${i}`
      defs +=
        `<radialGradient id="${gid}" cx="50%" cy="50%" r="50%">` +
        `<stop offset="${r2(solid)}" stop-color="rgb(${cr},${cg},${cb})" stop-opacity="1"/>` +
        `<stop offset="${r2(solid + (1 - solid) * 0.45)}" stop-color="rgb(${cr},${cg},${cb})" stop-opacity="0.55"/>` +
        `<stop offset="1" stop-color="rgb(${cr},${cg},${cb})" stop-opacity="0"/></radialGradient>`
      if (shape === 'square') {
        pattern += `<rect x="${r2(w / 2 - outer)}" y="${r2(cy - outer)}" width="${r2(outer * 2)}" height="${r2(outer * 2)}" rx="${r2(outer * b * 0.9)}" fill="url(#${gid})"/>`
      } else if (shape === 'pill') {
        pattern += `<ellipse cx="${r2(w / 2)}" cy="${r2(cy)}" rx="${r2(outer * 1.35)}" ry="${r2(outer * 0.8)}" fill="url(#${gid})"/>`
      } else {
        pattern += `<circle cx="${r2(w / 2)}" cy="${r2(cy)}" r="${r2(outer)}" fill="url(#${gid})"/>`
      }
    }
    defs += `<g id="be-pat-${uid}">${pattern}</g>`

    // Strips: widest in the centre, narrowing outwards like a cylinder lens.
    const mid = (strips - 1) / 2
    const weights = Array.from({ length: strips }, (_, j) => Math.pow(Math.cos(((j - mid) / (mid + 1)) * (Math.PI / 2)), 0.9) + 0.08)
    const total = weights.reduce((a, b) => a + b, 0)
    const gap = w * num(p, 'gap')
    const usable = w - gap * (strips - 1)
    const shift = num(p, 'shift')
    const falloff = num(p, 'falloff')
    const wobble = Math.cos(Math.PI * 2 * t)
    let body = ''
    let x = 0
    for (let j = 0; j < strips; j++) {
      const sw = (usable * weights[j]) / total
      const k = j - mid
      const cid = `be-clip-${uid}-${j}`
      const s = Math.max(0.2, 1 - Math.abs(k) * falloff)
      // each strip shows the column displaced toward its own centre, scaled down with distance
      const stripCentre = x + sw / 2
      const dx = (stripCentre - w / 2) * (1 - shift * 0.5 * (1 + 0.15 * wobble)) * (strips > 1 ? 1 : 0)
      defs += `<clipPath id="${cid}"><rect x="${r2(x)}" y="0" width="${r2(sw)}" height="${h}"/></clipPath>`
      body +=
        `<g clip-path="url(#${cid})"><use href="#be-pat-${uid}" transform="translate(${r2(dx + (w / 2) * (1 - s))} ${r2((h / 2) * (1 - s))}) scale(${r2(s)})"/></g>`
      x += sw + gap
    }
    return rect(w, h, bg) + `<defs>${defs}</defs>` + body
  },
}
