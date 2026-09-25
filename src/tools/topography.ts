import { r2, rect } from '../lib/svg'
import { num, pal, type SvgTool } from './types'

export const topography: SvgTool = {
  id: 'topography',
  name: 'Topography',
  category: 'Texture',
  description: 'Contour-line maps traced from noise terrain, for outdoorsy or technical textures.',
  kind: 'svg',
  animated: true,
  duration: 10,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#E8EDE4', '#1F3D2B', '#F2C14E'], min: 2, max: 3 },
    { type: 'number', key: 'levels', label: 'Contours', min: 4, max: 48, step: 1, default: 18 },
    { type: 'number', key: 'scale', label: 'Terrain scale', min: 0.4, max: 5, step: 0.05, default: 1.4 },
    { type: 'number', key: 'octaves', label: 'Detail', min: 1, max: 4, step: 1, default: 2 },
    { type: 'number', key: 'res', label: 'Resolution', min: 30, max: 180, step: 5, default: 110, randomize: false },
    { type: 'number', key: 'weight', label: 'Stroke weight', min: 0.3, max: 8, step: 0.1, default: 1.6, unit: 'px' },
    { type: 'number', key: 'major', label: 'Index every', min: 0, max: 10, step: 1, default: 5 },
  ],
  render({ w, h, p, noise, t }) {
    const [bg, ink, accent = ink] = pal(p, 'palette')
    const m = Math.min(w, h)
    const res = num(p, 'res')
    const cols = Math.round((res * w) / m)
    const rows = Math.round((res * h) / m)
    const cw = w / cols
    const ch = h / rows
    const sc = num(p, 'scale')
    const oct = num(p, 'octaves')
    const field = new Float32Array((cols + 1) * (rows + 1))
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const u = (i * cw) / m
        const v = (j * ch) / m
        let val = 0
        let amp = 1
        let freq = sc
        let norm = 0
        for (let o = 0; o < oct; o++) {
          val += amp * noise.loop(u * freq + o * 5.3, v * freq, t, 0.3)
          norm += amp
          amp *= 0.5
          freq *= 2
        }
        field[j * (cols + 1) + i] = val / norm
      }
    }
    const levels = num(p, 'levels')
    const major = num(p, 'major')
    const sw = num(p, 'weight') * (m / 1080)
    let out = rect(w, h, bg)
    for (let l = 1; l <= levels; l++) {
      const iso = -0.75 + (1.5 * l) / (levels + 1)
      let d = ''
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const a = field[j * (cols + 1) + i]
          const b = field[j * (cols + 1) + i + 1]
          const c = field[(j + 1) * (cols + 1) + i + 1]
          const e = field[(j + 1) * (cols + 1) + i]
          const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (e > iso ? 1 : 0)
          if (idx === 0 || idx === 15) continue
          const x = i * cw
          const y = j * ch
          const lerp = (p0: number, p1: number) => (iso - p0) / (p1 - p0)
          const top: [number, number] = [x + cw * lerp(a, b), y]
          const right: [number, number] = [x + cw, y + ch * lerp(b, c)]
          const bottom: [number, number] = [x + cw * lerp(e, c), y + ch]
          const left: [number, number] = [x, y + ch * lerp(a, e)]
          const seg = (p0: [number, number], p1: [number, number]) => {
            d += `M${r2(p0[0])},${r2(p0[1])}L${r2(p1[0])},${r2(p1[1])}`
          }
          switch (idx) {
            case 1: case 14: seg(left, bottom); break
            case 2: case 13: seg(bottom, right); break
            case 3: case 12: seg(left, right); break
            case 4: case 11: seg(top, right); break
            case 5: seg(left, top); seg(bottom, right); break
            case 6: case 9: seg(top, bottom); break
            case 7: case 8: seg(left, top); break
            case 10: seg(left, bottom); seg(top, right); break
          }
        }
      }
      if (!d) continue
      const isMajor = major > 0 && l % major === 0
      out += `<path d="${d}" fill="none" stroke="${isMajor ? accent : ink}" stroke-width="${r2(isMajor ? sw * 2 : sw)}" stroke-linecap="round"/>`
    }
    return out
  },
}
