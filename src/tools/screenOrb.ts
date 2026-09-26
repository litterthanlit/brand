import { hexToRgb } from '../lib/color'
import { num, pal, str, type CanvasTool } from './types'

let source: HTMLCanvasElement | null = null

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

export const screenOrb: CanvasTool = {
  id: 'screen-orb',
  name: 'Screen Orb',
  category: 'Texture',
  description: 'Soft gradient spheres and horizons, printed through a fine halftone screen.',
  kind: 'canvas',
  raw: true,
  animated: true,
  duration: 10,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (paper, sky, horizon, core, light)', default: ['#F6EEF3', '#2A1606', '#3A62D9', '#FF3A0A', '#F6CFE4'], min: 5, max: 5 },
    {
      type: 'select', key: 'scene', label: 'Scene', default: 'orb',
      options: [{ value: 'orb', label: 'Orb' }, { value: 'eclipse', label: 'Eclipse' }, { value: 'horizon', label: 'Horizon' }],
    },
    { type: 'number', key: 'orbSize', label: 'Orb size', min: 0.2, max: 0.6, step: 0.01, default: 0.43 },
    { type: 'number', key: 'orbY', label: 'Orb height', min: 0.25, max: 0.8, step: 0.01, default: 0.52 },
    { type: 'number', key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.7 },
    { type: 'number', key: 'cell', label: 'Screen size', min: 2, max: 16, step: 0.5, default: 4.5, unit: 'px' },
    { type: 'number', key: 'angle', label: 'Screen angle', min: 0, max: 90, step: 1, default: 45, unit: '°' },
    { type: 'number', key: 'gain', label: 'Dot gain', min: 0.5, max: 1.8, step: 0.01, default: 1.05 },
    {
      type: 'select', key: 'mode', label: 'Dots', default: 'colour',
      options: [{ value: 'colour', label: 'Colour' }, { value: 'mono', label: 'Mono ink' }],
    },
  ],
  defaults: {
    format: 'portrait',
    finish: { grain: 0.3, grainType: 'soft' },
  },
  presets: [
    { name: 'Dusk', format: 'portrait', seed: 7 },
    {
      name: 'Blue hour', format: 'portrait', seed: 7,
      params: { palette: ['#EEF1FA', '#0B1640', '#FF7A3D', '#2E4BFF', '#C9D4FF'], scene: 'eclipse', cell: 3.5 },
      type: { enabled: true, layout: 'center', title: 'After light', body: '', label: '', caption: 'EDITION 02 — 2026', color: '#0B1640' },
    },
    {
      name: 'Riso', format: 'square', seed: 7,
      params: { palette: ['#F6F1E7', '#111111', '#0078BF', '#FF48B0', '#FFE800'], scene: 'horizon', cell: 7, mode: 'colour', gain: 1.25 },
      finish: { grain: 0.5, grainType: 'speckle' },
    },
  ],
  draw({ g, w, h, p, t }) {
    const [paper, sky, horizon, core, light] = pal(p, 'palette')
    const cell = num(p, 'cell') * (Math.min(w, h) / 1080)
    const scene = str(p, 'scene')
    const tau = Math.PI * 2

    // 1. Paint the smooth source image at half resolution.
    const sw = Math.ceil(w / 2)
    const sh = Math.ceil(h / 2)
    source ??= document.createElement('canvas')
    source.width = sw
    source.height = sh
    const s = source.getContext('2d', { willReadFrequently: true })!
    s.setTransform(0.5, 0, 0, 0.5, 0, 0)
    s.fillStyle = paper
    s.fillRect(0, 0, w, h)

    const m = Math.min(w, h)
    const horizonY = h * (scene === 'horizon' ? 0.55 : 0.4)
    const skyGrad = s.createLinearGradient(0, 0, 0, horizonY + h * 0.12)
    skyGrad.addColorStop(0, sky)
    skyGrad.addColorStop(0.62, rgba(sky, 0.92))
    skyGrad.addColorStop(0.8, horizon)
    skyGrad.addColorStop(1, rgba(paper, 0))
    s.fillStyle = skyGrad
    s.fillRect(0, 0, w, horizonY + h * 0.12)

    const drift = Math.sin(tau * t)
    const R = m * num(p, 'orbSize')
    const cx = w / 2
    const cy = h * num(p, 'orbY') + drift * m * 0.015
    const glow = num(p, 'glow')

    if (scene !== 'horizon') {
      // ground glow below the orb
      const gr = s.createRadialGradient(cx, cy + R * 0.9, 0, cx, cy + R * 0.9, R * (1.3 + glow))
      gr.addColorStop(0, rgba(core, 0.85 * glow + 0.1))
      gr.addColorStop(0.5, rgba(light, 0.4))
      gr.addColorStop(1, rgba(paper, 0))
      s.fillStyle = gr
      s.fillRect(0, 0, w, h)

      // the orb: light cap on top, hot core low and off-centre
      s.save()
      s.beginPath()
      s.arc(cx, cy, R, 0, tau)
      s.clip()
      const body = s.createLinearGradient(0, cy - R, 0, cy + R)
      body.addColorStop(0, scene === 'eclipse' ? sky : light)
      body.addColorStop(0.45, scene === 'eclipse' ? horizon : light)
      body.addColorStop(1, core)
      s.fillStyle = body
      s.fillRect(cx - R, cy - R, R * 2, R * 2)
      const hx = cx + Math.cos(tau * t) * R * 0.15
      const hot = s.createRadialGradient(hx, cy + R * 0.5, 0, hx, cy + R * 0.5, R * 1.1)
      hot.addColorStop(0, rgba(core, 1))
      hot.addColorStop(0.6, rgba(core, 0.5))
      hot.addColorStop(1, rgba(core, 0))
      s.fillStyle = hot
      s.fillRect(cx - R, cy - R, R * 2, R * 2)
      s.restore()
    } else {
      // horizon scene: a setting sun cut by the horizon line
      const sun = s.createRadialGradient(cx, horizonY, 0, cx, horizonY, R * 1.6)
      sun.addColorStop(0, rgba(core, 1))
      sun.addColorStop(0.45, rgba(core, 0.8))
      sun.addColorStop(1, rgba(light, 0))
      s.fillStyle = sun
      s.fillRect(0, 0, w, horizonY + drift * m * 0.01)
      const sea = s.createLinearGradient(0, horizonY, 0, h)
      sea.addColorStop(0, horizon)
      sea.addColorStop(1, rgba(light, 0.4))
      s.fillStyle = sea
      s.fillRect(0, horizonY, w, h - horizonY)
    }

    // 2. Re-draw as a halftone dot screen, computed per output pixel.
    //    Each pixel finds its nearest screen cell, samples that cell's tone once,
    //    and gets an anti-aliased disc edge. This is far cheaper than drawing ~70k arcs.
    const data = s.getImageData(0, 0, sw, sh).data
    const pw = g.canvas.width
    const ph = g.canvas.height
    const px = pw / w // device pixels per artwork unit
    const ang = (num(p, 'angle') * Math.PI) / 180
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const gain = num(p, 'gain')
    const mono = str(p, 'mode') === 'mono'
    const ink = hexToRgb(sky)
    const [pr, pg, pb] = hexToRgb(paper)
    const paperL = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255
    const out = g.createImageData(pw, ph)
    const o = out.data
    const hw = w / 2
    const hh = h / 2
    for (let y = 0; y < ph; y++) {
      const Y = (y + 0.5) / px - hh
      for (let x = 0; x < pw; x++) {
        const X = (x + 0.5) / px - hw
        // position in screen-grid space (units of cells)
        const u = (X * cos + Y * sin) / cell
        const v = (-X * sin + Y * cos) / cell
        const iu = Math.round(u)
        const iv = Math.round(v)
        const cx = hw + (iu * cos - iv * sin) * cell
        const cy = hh + (iu * sin + iv * cos) * cell
        const sx = Math.min(sw - 1, Math.max(0, (cx / 2) | 0))
        const sy = Math.min(sh - 1, Math.max(0, (cy / 2) | 0))
        const k = (sy * sw + sx) * 4
        const r = data[k]
        const gg = data[k + 1]
        const b = data[k + 2]
        const L = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255
        const chroma = (Math.max(r, gg, b) - Math.min(r, gg, b)) / 255
        const cover = Math.min(1, Math.max(0, (paperL - L) * 1.1 + chroma * 0.55)) * gain
        const rad = cell * 0.5 * Math.sqrt(cover) * 1.35
        const du = u - iu
        const dv = v - iv
        const d = Math.sqrt(du * du + dv * dv) * cell
        // 1-device-pixel soft edge
        const a = Math.max(0, Math.min(1, (rad - d) * px + 0.5))
        const i4 = (y * pw + x) * 4
        const dr = mono ? ink[0] : r
        const dg = mono ? ink[1] : gg
        const db = mono ? ink[2] : b
        o[i4] = pr + (dr - pr) * a
        o[i4 + 1] = pg + (dg - pg) * a
        o[i4 + 2] = pb + (db - pb) * a
        o[i4 + 3] = 255
      }
    }
    g.putImageData(out, 0, 0)
  },
}
