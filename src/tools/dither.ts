import { byLuminance, hexToRgb } from '../lib/color'
import { bool, num, pal, str, type CanvasTool } from './types'

const BAYER2 = [[0, 2], [3, 1]]
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
function bayer8() {
  const m: number[][] = []
  for (let y = 0; y < 8; y++) {
    m.push([])
    for (let x = 0; x < 8; x++) {
      const b4 = BAYER4[y % 4][x % 4]
      const q = (y >> 2) * 2 + (x >> 2)
      m[y].push(4 * b4 + [0, 2, 3, 1][q])
    }
  }
  return m
}
const BAYER8 = bayer8()

// [dx, dy, weight] kernels for error diffusion
const KERNELS: Record<string, { taps: [number, number, number][]; div: number }> = {
  floyd: { taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]], div: 16 },
  atkinson: { taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]], div: 8 },
  stucki: {
    taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
    div: 42,
  },
}

let scratch: HTMLCanvasElement | null = null
const getScratch = (w: number, h: number) => {
  scratch ??= document.createElement('canvas')
  scratch.width = w
  scratch.height = h
  return scratch
}

export const dither: CanvasTool = {
  id: 'dither',
  name: 'Dither',
  category: 'Image',
  description: 'Crunch photos or generated forms into 1-bit and limited-palette dithers.',
  kind: 'canvas',
  params: [
    { type: 'image', key: 'image', label: 'Image', default: null, onSet: { source: 'image' } },
    {
      type: 'select', key: 'source', label: 'Source', default: 'orb',
      options: [
        { value: 'image', label: 'Image' }, { value: 'orb', label: 'Orb' },
        { value: 'gradient', label: 'Gradient' }, { value: 'noise', label: 'Noise' },
      ],
    },
    {
      type: 'select', key: 'algo', label: 'Algorithm', default: 'bayer4',
      options: [
        { value: 'bayer2', label: 'Bayer 2×2' }, { value: 'bayer4', label: 'Bayer 4×4' }, { value: 'bayer8', label: 'Bayer 8×8' },
        { value: 'floyd', label: 'Floyd–Steinberg' }, { value: 'atkinson', label: 'Atkinson' }, { value: 'stucki', label: 'Stucki' },
        { value: 'threshold', label: 'Threshold' },
      ],
    },
    { type: 'palette', key: 'palette', label: 'Palette (dark → light)', default: ['#111111', '#F4F2EE'], min: 2, max: 6 },
    { type: 'number', key: 'pixel', label: 'Pixel size', min: 1, max: 24, step: 1, default: 5, rand: [2, 10], unit: 'px' },
    { type: 'number', key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { type: 'number', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { type: 'boolean', key: 'invert', label: 'Invert', default: false },
    {
      type: 'select', key: 'fit', label: 'Fit', default: 'cover',
      options: [{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }],
      when: (p) => p.source === 'image',
    },
  ],
  draw({ g, w, h, p, rng, noise }) {
    const px = Math.max(1, num(p, 'pixel'))
    const lw = Math.ceil(w / px)
    const lh = Math.ceil(h / px)
    const off = getScratch(lw, lh)
    const og = off.getContext('2d', { willReadFrequently: true })!
    const colors = byLuminance(pal(p, 'palette'))
    const rgb = colors.map(hexToRgb)
    const image = p.image as ImageBitmap | null
    const source = str(p, 'source') === 'image' && !image ? 'orb' : str(p, 'source')

    // 1. Paint the greyscale source at low resolution
    og.fillStyle = colors[0]
    og.fillRect(0, 0, lw, lh)
    if (source === 'image' && image) {
      const s = str(p, 'fit') === 'contain' ? Math.min(lw / image.width, lh / image.height) : Math.max(lw / image.width, lh / image.height)
      const iw = image.width * s
      const ih = image.height * s
      og.fillStyle = '#fff'
      og.fillRect(0, 0, lw, lh)
      og.drawImage(image, (lw - iw) / 2, (lh - ih) / 2, iw, ih)
    } else if (source === 'orb') {
      const m = Math.min(lw, lh)
      const cx = lw * rng.range(0.4, 0.6)
      const cy = lh * rng.range(0.4, 0.6)
      const r = m * rng.range(0.3, 0.42)
      const bgGrad = og.createLinearGradient(0, 0, 0, lh)
      bgGrad.addColorStop(0, '#2a2a2a')
      bgGrad.addColorStop(1, '#000')
      og.fillStyle = bgGrad
      og.fillRect(0, 0, lw, lh)
      const lx = cx - r * rng.range(0.2, 0.5)
      const ly = cy - r * rng.range(0.3, 0.55)
      const grad = og.createRadialGradient(lx, ly, r * 0.05, cx, cy, r)
      grad.addColorStop(0, '#fff')
      grad.addColorStop(0.55, '#8a8a8a')
      grad.addColorStop(1, '#0c0c0c')
      og.fillStyle = grad
      og.beginPath()
      og.arc(cx, cy, r, 0, Math.PI * 2)
      og.fill()
    } else if (source === 'gradient') {
      const a = rng.range(0, Math.PI * 2)
      const len = Math.hypot(lw, lh) / 2
      const grad = og.createLinearGradient(
        lw / 2 - Math.cos(a) * len, lh / 2 - Math.sin(a) * len,
        lw / 2 + Math.cos(a) * len, lh / 2 + Math.sin(a) * len,
      )
      grad.addColorStop(0, '#000')
      grad.addColorStop(1, '#fff')
      og.fillStyle = grad
      og.fillRect(0, 0, lw, lh)
    } else {
      const img = og.createImageData(lw, lh)
      const s = 3 / Math.max(lw, lh)
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const v = 0.5 + 0.5 * (0.7 * noise.n2(x * s, y * s) + 0.3 * noise.n2(x * s * 3, y * s * 3))
          const i = (y * lw + x) * 4
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255
          img.data[i + 3] = 255
        }
      }
      og.putImageData(img, 0, 0)
    }

    // 2. Convert to adjusted luminance
    const data = og.getImageData(0, 0, lw, lh)
    const d = data.data
    const lum = new Float32Array(lw * lh)
    const bright = num(p, 'brightness')
    const contrast = num(p, 'contrast')
    const inv = bool(p, 'invert')
    for (let i = 0; i < lum.length; i++) {
      let v = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255
      v = (v - 0.5) * contrast + 0.5 + bright
      if (inv) v = 1 - v
      lum[i] = v
    }

    // 3. Quantise to palette levels
    const levels = rgb.length - 1
    const algo = str(p, 'algo')
    const out = new Uint8Array(lw * lh)
    const clampIdx = (v: number) => Math.max(0, Math.min(levels, v))
    if (algo in KERNELS) {
      const { taps, div } = KERNELS[algo]
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x
          const v = Math.max(0, Math.min(1, lum[i]))
          const q = clampIdx(Math.round(v * levels))
          out[i] = q
          const err = v - q / levels
          for (const [dx, dy, wt] of taps) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && nx < lw && ny < lh) lum[ny * lw + nx] += (err * wt) / div
          }
        }
      }
    } else {
      const matrix = algo === 'bayer2' ? BAYER2 : algo === 'bayer8' ? BAYER8 : BAYER4
      const size = matrix.length
      const n = size * size
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x
          const v = Math.max(0, Math.min(1, lum[i])) * levels
          const base = Math.floor(v)
          const threshold = algo === 'threshold' ? 0.5 : (matrix[y % size][x % size] + 0.5) / n
          out[i] = clampIdx(base + (v - base > threshold ? 1 : 0))
        }
      }
    }

    // 4. Write palette colours and upscale with hard pixels
    for (let i = 0; i < out.length; i++) {
      const c = rgb[out[i]]
      d[i * 4] = c[0]
      d[i * 4 + 1] = c[1]
      d[i * 4 + 2] = c[2]
      d[i * 4 + 3] = 255
    }
    og.putImageData(data, 0, 0)
    g.imageSmoothingEnabled = false
    g.drawImage(off, 0, 0, lw * px, lh * px)
    g.imageSmoothingEnabled = true
  },
}
