import { hexToRgb } from '../lib/color'
import { num, pal, str, type CanvasTool } from './types'

let work: HTMLCanvasElement | null = null
let photo: HTMLCanvasElement | null = null

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Long-exposure water. A domain-warped wave field is coloured through a
 * deep → light ramp with foam on the crests, then smeared along a flow field
 * with line integral convolution (LIC). Streaks lengthen toward the bottom of
 * the frame, so the horizon stays crisp and the foreground turns to silk.
 * Photo mode applies the same smear to an uploaded image.
 */
export const longExposure: CanvasTool = {
  id: 'long-exposure',
  name: 'Long Exposure',
  category: 'Texture',
  description: 'Silky, motion-blurred water and light: a slow shutter for any colour field or photo.',
  kind: 'canvas',
  raw: true,
  animated: true,
  duration: 8,
  motionScale: 0.6,
  params: [
    { type: 'image', key: 'image', label: 'Photo (optional)', default: null, onSet: { source: 'image' } },
    {
      type: 'select', key: 'source', label: 'Source', default: 'sea',
      options: [{ value: 'sea', label: 'Sea' }, { value: 'image', label: 'Photo' }],
    },
    { type: 'palette', key: 'palette', label: 'Palette (deep → light, then foam)', default: ['#062A56', '#0A5C9E', '#1C8FC4', '#7CC4DD', '#F2F4F3'], min: 3, max: 6 },
    { type: 'number', key: 'angle', label: 'Motion direction', min: 0, max: 360, step: 1, default: 190, unit: '°' },
    { type: 'number', key: 'streak', label: 'Shutter (streak length)', min: 0, max: 1, step: 0.01, default: 0.55 },
    { type: 'number', key: 'depth', label: 'Depth falloff', min: 0, max: 1, step: 0.01, default: 0.75 },
    { type: 'number', key: 'swirl', label: 'Swirl', min: 0, max: 1, step: 0.01, default: 0.25 },
    { type: 'number', key: 'scale', label: 'Wave scale', min: 0.4, max: 3, step: 0.01, default: 1.2, when: (p) => p.source !== 'image' },
    { type: 'number', key: 'foam', label: 'Foam', min: 0, max: 1, step: 0.01, default: 0.6, when: (p) => p.source !== 'image' },
    { type: 'number', key: 'detail', label: 'Crisp detail', min: 0, max: 1, step: 0.01, default: 0.35 },
    { type: 'number', key: 'contrast', label: 'Contrast', min: 0.6, max: 1.8, step: 0.01, default: 1.08 },
  ],
  defaults: { format: 'portrait', finish: { grain: 0.18, grainType: 'soft' } },
  presets: [
    { name: 'Open water', format: 'portrait', seed: 7 },
    {
      name: 'Silk', format: 'portrait', seed: 12,
      params: { palette: ['#1E2124', '#4A5057', '#8E969C', '#C9CED1', '#F4F4F2'], streak: 0.8, depth: 0.5, swirl: 0.2, foam: 0.45 },
      finish: { grain: 0.3, grainType: 'soft' },
    },
    {
      name: 'Dusk tide', format: 'portrait', seed: 12,
      params: { palette: ['#2B1B3F', '#6B3A6E', '#C0627A', '#F2A07B', '#FFE9D6'], angle: 190, streak: 0.65, foam: 0.5 },
      finish: { grain: 0.25, grainType: 'soft' },
      type: { enabled: true, layout: 'bl', title: 'Low tide', body: 'Studies in slow light', label: '', caption: 'SHUTTER 1/2s', color: '#FFE9D6' },
    },
    {
      name: 'Ink wash', format: 'landscape', seed: 5,
      params: { palette: ['#0A0A0A', '#2A2A2A', '#7A7A7A', '#EDEDED'], angle: 180, streak: 0.9, depth: 0.3, foam: 0.7, contrast: 1.3 },
      finish: { grain: 0.45, grainType: 'speckle' },
      type: { enabled: true, layout: 'tl', title: 'Current', body: '', label: 'Vol. 02', caption: '', color: '#EDEDED', labelBg: '#EDEDED', labelInk: '#0A0A0A' },
    },
  ],
  draw({ g, w, h, p, noise, t }) {
    // Work at ~half the output's device resolution; the smear hides the upscale.
    const q = Math.min(0.5, 540 / Math.max(g.canvas.width, g.canvas.height))
    const lw = Math.max(32, Math.round(g.canvas.width * q))
    const lh = Math.max(32, Math.round(g.canvas.height * q))
    const n = lw * lh
    const m = Math.min(w, h)
    const aspectX = w / m
    const aspectY = h / m

    const R = new Float32Array(n)
    const G = new Float32Array(n)
    const B = new Float32Array(n)

    const colors = pal(p, 'palette').map(hexToRgb)
    const ramp = colors.length > 3 ? colors.slice(0, -1) : colors.slice(0, 2)
    const foamColor = colors[colors.length - 1]
    const image = p.image as ImageBitmap | null
    const usePhoto = str(p, 'source') === 'image' && image

    const theta = (num(p, 'angle') * Math.PI) / 180
    const dirX = Math.cos(theta)
    const dirY = Math.sin(theta)

    // cheap hash noise for per-pixel texture (stable per seed)
    const salt = Math.floor(noise.n2(1.7, 9.3) * 1e6)
    const grainAt = (x: number, y: number) => {
      let hsh = (x * 374761393 + y * 668265263 + salt) | 0
      hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177)
      return ((hsh ^ (hsh >>> 16)) >>> 0) / 4294967296
    }

    if (usePhoto) {
      photo ??= document.createElement('canvas')
      photo.width = lw
      photo.height = lh
      const pg = photo.getContext('2d', { willReadFrequently: true })!
      const k = Math.max(lw / image.width, lh / image.height)
      pg.drawImage(image, (lw - image.width * k) / 2, (lh - image.height * k) / 2, image.width * k, image.height * k)
      const d = pg.getImageData(0, 0, lw, lh).data
      for (let i = 0; i < n; i++) {
        const hair = 1 + (grainAt(i % lw, (i / lw) | 0) - 0.5) * 0.08
        R[i] = d[i * 4] * hair
        G[i] = d[i * 4 + 1] * hair
        B[i] = d[i * 4 + 2] * hair
      }
    }

    // Smooth fields (wave colour and flow) are evaluated on a coarse grid and
    // bilinearly upsampled: noise is the expensive part, and the smear hides the
    // interpolation. Only the hairline texture and the LIC run per pixel.
    const C = 2
    const cw = Math.ceil(lw / C) + 1
    const ch = Math.ceil(lh / C) + 1
    const cn = cw * ch
    const cR = new Float32Array(cn)
    const cG = new Float32Array(cn)
    const cB = new Float32Array(cn)
    const cfx = new Float32Array(cn)
    const cfy = new Float32Array(cn)
    const swirl = num(p, 'swirl')

    // cross-crest axis (crests run along the motion, like a camera panning with the swell)
    const cx = -dirY
    const cy = dirX
    const scale = num(p, 'scale')
    const foam = num(p, 'foam')
    // one or two big breakers in the foreground carry most of the foam
    const breakerX = aspectX * (0.55 + noise.n2(3.3, 7.7) * 0.3)

    for (let gy = 0; gy < ch; gy++) {
      const vy = Math.min(1, (gy * C) / lh)
      const persp = 1 + Math.pow(1 - vy, 1.5) * 2.4 // smaller, busier waves near the horizon
      const s = scale * persp * 2.2
      for (let gx = 0; gx < cw; gx++) {
        const u = Math.min(1, (gx * C) / lw) * aspectX
        const v = vy * aspectY
        const ci = gy * cw + gx

        // 2. Flow field for the smear: near-horizontal at the horizon, diagonal in the
        //    foreground, bent by low-frequency swirl.
        const fa = theta - vy * 0.45 + noise.loop(u * 1.1 + 20, v * 1.1, t, 0.25) * swirl * Math.PI * 0.6
        cfx[ci] = Math.cos(fa)
        cfy[ci] = Math.sin(fa)
        if (usePhoto) continue

        // 1. Wave field: anisotropic, domain-warped noise
        const wx = noise.loop(u * 1.3, v * 1.3, t, 0.35) * 0.16
        const wy = noise.loop(u * 1.3 + 9.1, v * 1.3 + 3.7, t, 0.35) * 0.16
        const uu = u + wx
        const vv = v + wy
        // along-crest / across-crest coordinates, stretched so crests are long
        const a = (uu * dirX + vv * dirY) * s * 0.3
        const b = (uu * cx + vv * cy) * s * 2
        // swell: parallel wave lines, bent and broken up by noise
        const swell = Math.sin(b * 3.4 + noise.n2(a * 0.3, b * 0.25) * 1.3 + t * Math.PI * 2)
        // loop() walks a circle in noise space, so the last frame meets the first
        const chop = noise.loop(a, b, t, 0.3) * 0.6 + noise.loop(a * 2.1 + 5, b * 2.1, t, 0.3) * 0.28 + noise.n3(a * 4.3 + 11, b * 4.3, 3) * 0.12
        const hgt = 0.5 + (swell * 0.45 + chop * 0.55) * 0.62
        // colour ramp, biased toward the deep tones like open water
        const tone = Math.pow(Math.max(0, Math.min(1, hgt)), 1.6)
        const pos = tone * (ramp.length - 1)
        const r0 = Math.min(ramp.length - 2, Math.floor(pos))
        const f = pos - r0
        let r = ramp[r0][0] + (ramp[r0 + 1][0] - ramp[r0][0]) * f
        let gg = ramp[r0][1] + (ramp[r0 + 1][1] - ramp[r0][1]) * f
        let bb = ramp[r0][2] + (ramp[r0 + 1][2] - ramp[r0][2]) * f
        // foam: sparse whitecaps on crests, plus a large breaker that grows toward the foreground
        const spray = noise.n2(u * 14, v * 14) * 0.08
        const breaker = smoothstep(0.35, 1, vy) * smoothstep(0.15, 0.55, 0.5 + noise.loop(u * 0.9 + 40, v * 0.9, t, 0.2) * 0.9 - Math.abs(u - breakerX) * 0.35)
        const th = 0.84 - foam * 0.12 - breaker * foam * 0.55
        const fm = smoothstep(th, th + 0.16 + breaker * 0.18, hgt + spray) * Math.min(1, foam * 1.5)
        r += (foamColor[0] - r) * fm
        gg += (foamColor[1] - gg) * fm
        bb += (foamColor[2] - bb) * fm
        cR[ci] = r
        cG[ci] = gg
        cB[ci] = bb
      }
    }

    // Upsample to the working grid; add per-pixel grain that the LIC turns into hairlines.
    const fx = new Float32Array(n)
    const fy = new Float32Array(n)
    for (let y = 0; y < lh; y++) {
      const gyf = y / C
      const y0 = gyf | 0
      const ty = gyf - y0
      const vy = y / lh
      for (let x = 0; x < lw; x++) {
        const gxf = x / C
        const x0 = gxf | 0
        const tx = gxf - x0
        const a00 = y0 * cw + x0
        const a10 = a00 + 1
        const a01 = a00 + cw
        const a11 = a01 + 1
        const w00 = (1 - tx) * (1 - ty)
        const w10 = tx * (1 - ty)
        const w01 = (1 - tx) * ty
        const w11 = tx * ty
        const i = y * lw + x
        fx[i] = cfx[a00] * w00 + cfx[a10] * w10 + cfx[a01] * w01 + cfx[a11] * w11
        fy[i] = cfy[a00] * w00 + cfy[a10] * w10 + cfy[a01] * w01 + cfy[a11] * w11
        if (usePhoto) continue
        const hair = 1 + (grainAt(x, y) - 0.5) * 0.22 * (0.15 + vy * 0.85)
        R[i] = (cR[a00] * w00 + cR[a10] * w10 + cR[a01] * w01 + cR[a11] * w11) * hair
        G[i] = (cG[a00] * w00 + cG[a10] * w10 + cG[a01] * w01 + cG[a11] * w11) * hair
        B[i] = (cB[a00] * w00 + cB[a10] * w10 + cB[a01] * w01 + cB[a11] * w11) * hair
      }
    }

    // 3. Line integral convolution with depth-dependent shutter length.
    const streak = num(p, 'streak')
    const depth = num(p, 'depth')
    const detail = num(p, 'detail')
    const contrast = num(p, 'contrast')
    const maxLen = lw * 0.16 * streak
    const img = new ImageData(lw, lh)
    const o = img.data
    const MAX_SAMPLES = 12
    for (let y = 0; y < lh; y++) {
      const vy = y / lh
      const len = maxLen * (1 - depth + depth * vy)
      const steps = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(len / 1.2)))
      const stepLen = steps > 1 ? len / steps : 0
      for (let x = 0; x < lw; x++) {
        const i0 = y * lw + x
        let sr = R[i0]
        let sg = G[i0]
        let sb = B[i0]
        let wsum = 1
        if (stepLen > 0) {
          for (let dir = -1; dir <= 1; dir += 2) {
            let px = x + 0.5
            let py = y + 0.5
            for (let s = 1; s <= steps; s++) {
              const k = (py | 0) * lw + (px | 0)
              // clamp to the frame (edge extension) so every pixel gets the same amount of
              // smear; stopping at the border leaves visibly sharper columns along the edges
              px = Math.min(lw - 0.01, Math.max(0, px + fx[k] * stepLen * dir))
              py = Math.min(lh - 0.01, Math.max(0, py + fy[k] * stepLen * dir))
              const j = (py | 0) * lw + (px | 0)
              const wt = 1 - s / (steps + 1) // triangular falloff
              sr += R[j] * wt
              sg += G[j] * wt
              sb += B[j] * wt
              wsum += wt
            }
          }
        }
        // keep some crisp detail, mostly near the top of the frame
        const keep = detail * (1 - vy * 0.8) * 0.6
        let r = (sr / wsum) * (1 - keep) + R[i0] * keep
        let gg = (sg / wsum) * (1 - keep) + G[i0] * keep
        let bb = (sb / wsum) * (1 - keep) + B[i0] * keep
        r = (r - 128) * contrast + 128
        gg = (gg - 128) * contrast + 128
        bb = (bb - 128) * contrast + 128
        const k4 = i0 * 4
        o[k4] = r
        o[k4 + 1] = gg
        o[k4 + 2] = bb
        o[k4 + 3] = 255
      }
    }

    work ??= document.createElement('canvas')
    work.width = lw
    work.height = lh
    work.getContext('2d')!.putImageData(img, 0, 0)
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(work, 0, 0, w, h)
  },
}
