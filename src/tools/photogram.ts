import { boxBlur } from '../lib/blur'
import { byLuminance, hexToRgb } from '../lib/color'
import type { Rng } from '../lib/random'
import { num, pal, str, type CanvasTool } from './types'

let scratch: HTMLCanvasElement | null = null

/** A generative stem with leaves, blossoms or berries, painted as a white silhouette. */
function paintBotanical(g: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  const m = Math.min(w, h)
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = '#fff'
  g.fillStyle = '#fff'
  g.lineCap = 'round'
  const kind = rng.pick(['blossom', 'berry', 'leaf'])

  const blossom = (x: number, y: number, r: number) => {
    const petals = rng.int(4, 6)
    const a0 = rng.range(0, Math.PI)
    for (let i = 0; i < petals; i++) {
      const a = a0 + (i / petals) * Math.PI * 2
      g.save()
      g.translate(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55)
      g.rotate(a)
      g.globalAlpha = rng.range(0.7, 0.95)
      g.beginPath()
      g.ellipse(0, 0, r * 0.62, r * 0.42, 0, 0, Math.PI * 2)
      g.fill()
      g.restore()
    }
    g.globalAlpha = 1
  }
  const tip = (x: number, y: number, a: number, size: number) => {
    if (kind === 'blossom') blossom(x, y, size)
    else if (kind === 'berry') {
      for (let i = 0; i < rng.int(3, 7); i++) {
        g.beginPath()
        g.arc(x + rng.range(-1, 1) * size * 0.7, y + rng.range(-1, 1) * size * 0.7, size * rng.range(0.25, 0.42), 0, Math.PI * 2)
        g.fill()
      }
    } else {
      g.save()
      g.translate(x, y)
      g.rotate(a)
      g.globalAlpha = 0.9
      g.beginPath()
      g.ellipse(size * 0.8, 0, size * 1.1, size * 0.38, 0, 0, Math.PI * 2)
      g.fill()
      g.restore()
      g.globalAlpha = 1
    }
  }
  const branch = (x: number, y: number, a: number, len: number, width: number, depth: number) => {
    const bend = rng.range(-0.5, 0.5)
    const segs = 8
    let px = x
    let py = y
    let pa = a
    for (let i = 0; i < segs; i++) {
      pa += bend / segs
      const nx = px + Math.cos(pa) * (len / segs)
      const ny = py + Math.sin(pa) * (len / segs)
      g.lineWidth = width * (1 - (i / segs) * 0.5)
      g.beginPath()
      g.moveTo(px, py)
      g.lineTo(nx, ny)
      g.stroke()
      if (depth > 0 && i > 2 && rng.chance(0.28)) {
        branch(nx, ny, pa + rng.pick([-1, 1]) * rng.range(0.45, 1.1), len * rng.range(0.35, 0.6), width * 0.6, depth - 1)
      }
      px = nx
      py = ny
    }
    tip(px, py, pa, m * (depth === 0 ? 0.04 : 0.075) * rng.range(0.8, 1.3))
  }
  branch(w * rng.range(0.35, 0.65), h * 1.02, -Math.PI / 2 + rng.range(-0.35, 0.35), h * rng.range(0.55, 0.8), m * 0.014, 3)
}

export const photogram: CanvasTool = {
  id: 'photogram',
  name: 'Photogram',
  category: 'Image',
  description: 'Darkroom treatments for images: negatives, glow, threshold and duotone. Or grow a botanical.',
  kind: 'canvas',
  raw: true,
  params: [
    { type: 'image', key: 'image', label: 'Image', default: null, onSet: { source: 'image' } },
    {
      type: 'select', key: 'source', label: 'Source', default: 'botanical',
      options: [{ value: 'image', label: 'Image' }, { value: 'botanical', label: 'Botanical' }],
    },
    {
      type: 'select', key: 'mode', label: 'Treatment', default: 'glow',
      options: [
        { value: 'glow', label: 'Glow' }, { value: 'negative', label: 'Negative' }, { value: 'threshold', label: 'Threshold' },
        { value: 'posterize', label: 'Posterise' }, { value: 'positive', label: 'Positive' },
      ],
    },
    { type: 'palette', key: 'palette', label: 'Tones (dark → light)', default: ['#0B0B0B', '#EFEFEF'], min: 2, max: 4 },
    { type: 'number', key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.25 },
    { type: 'number', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, step: 0.01, default: 1.3 },
    { type: 'number', key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { type: 'number', key: 'threshold', label: 'Threshold', min: 0.05, max: 0.95, step: 0.01, default: 0.5, when: (p) => p.mode === 'threshold' },
    { type: 'number', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, default: 4, when: (p) => p.mode === 'posterize' },
    {
      type: 'select', key: 'fit', label: 'Fit', default: 'cover',
      options: [{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }],
      when: (p) => p.source === 'image',
    },
  ],
  defaults: {
    format: 'portrait',
    finish: { grain: 0.4, grainType: 'soft' },
  },
  presets: [
    { name: 'Glow', format: 'portrait', seed: 7 },
    {
      name: 'Negative', format: 'portrait', seed: 11,
      params: { mode: 'negative', softness: 0.1, contrast: 1.5, palette: ['#111111', '#EDEAE3'] },
      type: { enabled: true, layout: 'tl', title: 'Cultivated', body: 'from legacy', label: 'Culture', caption: 'IMAGE 0034 ■ ORCHARD', font: 'mono', color: '#111111', labelBg: '#111111', labelInk: '#EDEAE3' },
    },
    {
      name: 'Rust', format: 'square', seed: 5,
      params: { mode: 'posterize', levels: 3, palette: ['#2A120A', '#9C3B1B', '#E9D9C4'] },
      finish: { grain: 0.5, grainType: 'speckle' },
    },
  ],
  draw({ g, w, h, p, rng }) {
    const lw = Math.ceil(w / 2)
    const lh = Math.ceil(h / 2)
    scratch ??= document.createElement('canvas')
    scratch.width = lw
    scratch.height = lh
    const s = scratch.getContext('2d', { willReadFrequently: true })!
    const image = p.image as ImageBitmap | null
    if (str(p, 'source') === 'image' && image) {
      const fit = str(p, 'fit') === 'contain' ? Math.min : Math.max
      const k = fit(lw / image.width, lh / image.height)
      s.fillStyle = '#000'
      s.fillRect(0, 0, lw, lh)
      s.drawImage(image, (lw - image.width * k) / 2, (lh - image.height * k) / 2, image.width * k, image.height * k)
    } else {
      s.save()
      s.scale(0.5, 0.5)
      paintBotanical(s, w, h, rng)
      s.restore()
    }

    const img = s.getImageData(0, 0, lw, lh)
    const d = img.data
    let lum: Float32Array = new Float32Array(lw * lh)
    for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255

    const mode = str(p, 'mode')
    const soft = num(p, 'softness')
    const blurred = boxBlur(lum, lw, lh, Math.round(soft * Math.min(lw, lh) * 0.03))
    if (mode === 'glow') {
      // photogram glow: blurred halo screened behind the crisp form
      const halo = boxBlur(lum, lw, lh, Math.round(Math.min(lw, lh) * (0.01 + soft * 0.04)))
      for (let i = 0; i < lum.length; i++) lum[i] = 1 - (1 - blurred[i]) * (1 - halo[i] * 0.65)
    } else lum = blurred

    const contrast = num(p, 'contrast')
    const bright = num(p, 'brightness')
    const tones = byLuminance(pal(p, 'palette')).map(hexToRgb)
    const th = num(p, 'threshold')
    const levels = num(p, 'levels')
    for (let i = 0; i < lum.length; i++) {
      let v = (lum[i] - 0.5) * contrast + 0.5 + bright
      if (mode === 'negative') v = 1 - v
      else if (mode === 'threshold') v = v > th ? 1 : 0
      else if (mode === 'posterize') v = Math.round(Math.max(0, Math.min(1, v)) * (levels - 1)) / (levels - 1)
      v = Math.max(0, Math.min(1, v))
      // map through the tone ramp
      const pos = v * (tones.length - 1)
      const a = Math.floor(pos)
      const b = Math.min(tones.length - 1, a + 1)
      const f = pos - a
      d[i * 4] = tones[a][0] + (tones[b][0] - tones[a][0]) * f
      d[i * 4 + 1] = tones[a][1] + (tones[b][1] - tones[a][1]) * f
      d[i * 4 + 2] = tones[a][2] + (tones[b][2] - tones[a][2]) * f
      d[i * 4 + 3] = 255
    }
    s.putImageData(img, 0, 0)
    g.imageSmoothingEnabled = true
    g.drawImage(scratch, 0, 0, w, h)
  },
}
