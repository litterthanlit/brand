import { boxBlur } from '../lib/blur'
import { hexToRgb } from '../lib/color'
import type { Noise } from '../lib/noise'
import { createRng, type Rng } from '../lib/random'
import { num, pal, str, type CanvasTool } from './types'

let mask: HTMLCanvasElement | null = null
let work: HTMLCanvasElement | null = null
let fibreCache: { key: string; data: Float32Array } | null = null

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

type Mark =
  | { kind: 'blot'; ink: number; x: number; y: number; r: number; o: number }
  | { kind: 'splat'; ink: number; x: number; y: number; r: number; o: number }
  | { kind: 'sweep'; ink: number; x: number; y: number; len: number; a: number; o: number }

/** Lay out the scene in artwork units. Pure rng, so the composition is stable across frames. */
function compose(rng: Rng, w: number, h: number, inks: number, scene: string, count: number, size: number): Mark[] {
  const m = Math.min(w, h)
  const marks: Mark[] = []
  const order = rng.shuffle(Array.from({ length: inks }, (_, i) => i))
  // circles that blots keep clear of: the big gestures, plus a clearing for type
  const keepOut: { x: number; y: number; r: number }[] = [{ x: w / 2, y: h / 2, r: m * 0.13 }]

  if (scene !== 'blots') {
    const sweeps = scene === 'strokes' ? rng.int(2, 3) : 1
    for (let i = 0; i < sweeps; i++) {
      const x = w * (scene === 'strokes' ? rng.range(0.08, 0.2) : rng.range(0.4, 0.48))
      const y = scene === 'strokes' ? h * (0.3 + (i / sweeps) * 0.55) + rng.range(-0.04, 0.04) * h : h * rng.range(0.7, 0.78)
      const len = Math.min(w * 0.88 - x, w * size * (scene === 'strokes' ? rng.range(0.6, 0.72) : rng.range(0.44, 0.55)))
      const a = rng.range(-0.1, 0.06)
      marks.push({ kind: 'sweep', ink: order[(inks - 1 - i + inks) % inks], x, y, len, a, o: rng.range(0, 100) })
      for (let s = 0.15; s <= 1; s += 0.2) keepOut.push({ x: x + Math.cos(a) * len * s, y: y - len * 0.07 * s, r: len * (0.08 + s * 0.14) })
    }
  }
  if (scene === 'mixed') {
    const r = m * size * rng.range(0.17, 0.21)
    const x = w * rng.range(0.2, 0.26)
    const y = h - r * rng.range(0.95, 1.25)
    marks.push({ kind: 'splat', ink: order[0], x, y, r, o: rng.range(0, 100) })
    keepOut.push({ x, y, r: r * 1.35 })
  }

  // blots: rejection-sampled so they kiss and overlap a little but never bury each other
  const blots = scene === 'strokes' ? Math.max(1, Math.round(count / 3)) : count
  for (let i = 0; i < blots; i++) {
    const r = m * size * rng.range(0.055, 0.105) * (i < 2 ? 1.5 : 1)
    let best: { x: number; y: number; score: number } | null = null
    // best of a few candidates: the one furthest from everything spreads blots evenly
    for (let tries = 0; tries < 10; tries++) {
      const x = rng.range(0.12, 0.88) * w
      const y = rng.range(0.12, 0.88) * h
      let score = Infinity
      for (const k of keepOut) score = Math.min(score, Math.hypot(x - k.x, y - k.y) - k.r - r)
      if (!best || score > best.score) best = { x, y, score }
    }
    marks.push({ kind: 'blot', ink: order[(i + 1) % inks], x: best!.x, y: best!.y, r, o: rng.range(0, 100) })
    keepOut.push({ x: best!.x, y: best!.y, r: r * 0.95 })
  }
  // small hot drops: a second ink spotted onto a blot, like the reference's orange flecks
  if (inks > 1) {
    const hosts = marks.filter((mk) => mk.kind === 'blot').slice(0, 3)
    for (const host of hosts) {
      if (host.kind !== 'blot' || !rng.chance(0.6)) continue
      const a = rng.range(0, Math.PI * 2)
      marks.push({
        kind: 'blot', ink: order[0] === host.ink ? order[1 % inks] : order[0],
        x: host.x + Math.cos(a) * host.r * 0.85, y: host.y + Math.sin(a) * host.r * 0.85, r: host.r * rng.range(0.22, 0.32), o: rng.range(0, 100),
      })
    }
  }
  return marks
}

/** Rasterise one mark as white on the mask canvas. Outlines breathe with `t`, so loops stay seamless. */
function paintMark(g: CanvasRenderingContext2D, mk: Mark, noise: Noise, rng: Rng, t: number) {
  const tau = Math.PI * 2
  g.fillStyle = '#fff'
  g.strokeStyle = '#fff'
  g.lineCap = 'round'
  if (mk.kind === 'blot') {
    // noise-lobed outline; positive lobes are pushed further out into arms
    const N = 120
    g.beginPath()
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * tau
      const c = Math.cos(a)
      const s = Math.sin(a)
      const n1 = noise.loop(c * 0.9 + mk.o, s * 0.9, t, 0.12)
      const n2 = noise.n2(c * 1.8 + mk.o, s * 1.8 + 7)
      const n3 = noise.n2(c * 6 + mk.o + 3, s * 6)
      const arm = Math.pow(Math.max(0, n2), 2) * 0.9
      const rr = mk.r * (0.7 + n1 * 0.32 + arm + n3 * 0.07)
      const x = mk.x + c * rr
      const y = mk.y + s * rr
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.fill()
    // satellite droplets flicked off the edge
    const drops = rng.int(1, 5)
    for (let i = 0; i < drops; i++) {
      const a = rng.range(0, tau)
      const d = mk.r * rng.range(1.15, 1.8)
      g.beginPath()
      g.arc(mk.x + Math.cos(a) * d, mk.y + Math.sin(a) * d, mk.r * rng.range(0.05, 0.16), 0, tau)
      g.fill()
    }
  } else if (mk.kind === 'splat') {
    // a disc, fraying into radial spray
    g.beginPath()
    g.arc(mk.x, mk.y, mk.r * 0.82, 0, tau)
    g.fill()
    const rays = 140
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * tau + rng.range(-0.02, 0.02)
      const reach = mk.r * (0.95 + Math.pow(rng(), 3) * 0.55 + noise.loop(Math.cos(a) + mk.o, Math.sin(a), t, 0.1) * 0.08)
      g.lineWidth = mk.r * rng.range(0.01, 0.045)
      g.beginPath()
      g.moveTo(mk.x + Math.cos(a) * mk.r * 0.7, mk.y + Math.sin(a) * mk.r * 0.7)
      g.lineTo(mk.x + Math.cos(a) * reach, mk.y + Math.sin(a) * reach)
      g.stroke()
    }
  } else {
    // a fan of brush strokes that leave one point and spread as they travel
    const lines = rng.int(5, 7)
    const dx = Math.cos(mk.a)
    const dy = Math.sin(mk.a)
    const nx = -dy
    const ny = dx
    const width = mk.len * 0.042
    const segs = 48
    for (let l = 0; l < lines; l++) {
      const spread = (l - (lines - 1) * 0.3) * mk.len * 0.1
      const bend = -mk.len * rng.range(0.1, 0.16)
      const lw = width * rng.range(0.75, 1.15)
      const reach = rng.range(0.82, 1)
      let px = mk.x
      let py = mk.y
      for (let i = 1; i <= segs; i++) {
        const s = (i / segs) * reach
        const off = spread * Math.pow(s, 1.3) + bend * s * s + noise.loop(s * 2 + mk.o, l, t, 0.1) * mk.len * 0.01
        const x = mk.x + dx * mk.len * s + nx * off
        const y = mk.y + dy * mk.len * s + ny * off
        g.lineWidth = lw * (1 - s * 0.3)
        g.beginPath()
        g.moveTo(px, py)
        g.lineTo(x, y)
        g.stroke()
        px = x
        py = y
      }
    }
  }
}

/**
 * The paper: thousands of short, randomly oriented hairlines. Ink wicks along them,
 * which is what turns a soft edge into a feathered, capillary one.
 */
function fibres(lw: number, lh: number, unit: number, length: number, seed: number): Float32Array {
  const key = `${seed}|${lw}|${lh}|${length}`
  if (fibreCache?.key === key) return fibreCache.data
  const c = document.createElement('canvas')
  c.width = lw
  c.height = lh
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#000'
  g.fillRect(0, 0, lw, lh)
  g.globalCompositeOperation = 'lighter'
  g.lineCap = 'round'
  // fibre rng is separate from the scene's, so fibres never shift the composition
  let s = (seed ^ 0x5bd1e995) >>> 0
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let x = Math.imul(s ^ (s >>> 15), s | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const count = Math.round((lw * lh) / 55)
  const len = unit * (6 + length * 26)
  for (let i = 0; i < count; i++) {
    const x = rnd() * lw
    const y = rnd() * lh
    const a = rnd() * Math.PI * 2
    const l = len * (0.3 + rnd())
    const bend = (rnd() - 0.5) * l * 0.5
    const ex = x + Math.cos(a) * l
    const ey = y + Math.sin(a) * l
    g.strokeStyle = `rgba(255,255,255,${(0.18 + rnd() * 0.35).toFixed(3)})`
    g.lineWidth = Math.max(0.6, unit * (0.5 + rnd() * 0.9))
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo((x + ex) / 2 - Math.sin(a) * bend, (y + ey) / 2 + Math.cos(a) * bend, ex, ey)
    g.stroke()
  }
  const d = g.getImageData(0, 0, lw, lh).data
  const out = new Float32Array(lw * lh)
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, d[i * 4] / 255)
  fibreCache = { key, data: out }
  return out
}

/**
 * Ink bleed. Each ink's marks are rasterised to a mask and blurred into a soft
 * density field; the edge is then cut at a threshold that the paper's fibres
 * lower locally, so the ink feathers out along them. Dense interiors turn to a
 * "thermal" core: warm inks run hot, cool inks run deep. A pale wet halo and a
 * dried edge ring finish the pigment.
 */
export const inkBleed: CanvasTool = {
  id: 'ink-bleed',
  name: 'Ink Bleed',
  category: 'Texture',
  description: 'Saturated ink blooming into paper: feathered fibrous edges and hot, thermal cores.',
  kind: 'canvas',
  raw: true,
  animated: true,
  duration: 8,
  motionScale: 0.6,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (paper, then inks)', default: ['#F4F4F2', '#FF2A14', '#1C6BFF', '#2EE05A'], min: 2, max: 6 },
    { type: 'color', key: 'hot', label: 'Hot core (warm inks)', default: '#FFC61A' },
    { type: 'color', key: 'deep', label: 'Deep core (cool inks)', default: '#0B2440' },
    {
      type: 'select', key: 'scene', label: 'Scene', default: 'mixed',
      options: [{ value: 'mixed', label: 'Mixed' }, { value: 'blots', label: 'Blots' }, { value: 'strokes', label: 'Strokes' }],
    },
    { type: 'number', key: 'count', label: 'Blots', min: 1, max: 12, step: 1, default: 6, rand: [3, 9] },
    { type: 'number', key: 'size', label: 'Size', min: 0.5, max: 1.6, step: 0.01, default: 1, rand: [0.8, 1.3] },
    { type: 'number', key: 'bleed', label: 'Bleed', min: 0, max: 1, step: 0.01, default: 0.5 },
    { type: 'number', key: 'feather', label: 'Feathering', min: 0, max: 1, step: 0.01, default: 0.65 },
    { type: 'number', key: 'fibre', label: 'Fibre length', min: 0, max: 1, step: 0.01, default: 0.4 },
    { type: 'number', key: 'core', label: 'Core heat', min: 0, max: 1, step: 0.01, default: 0.6 },
    { type: 'number', key: 'halo', label: 'Wet halo', min: 0, max: 1, step: 0.01, default: 0.4 },
    { type: 'number', key: 'ring', label: 'Edge ring', min: 0, max: 1, step: 0.01, default: 0.2 },
  ],
  defaults: { format: 'square', finish: { grain: 0.14, grainType: 'soft' } },
  presets: [
    {
      name: 'Deluxe', format: 'square', seed: 7,
      type: { enabled: true, layout: 'center', title: 'Ink', body: '', label: '', caption: 'Deluxe', color: '#0B2440', size: 5, measure: 0.9, rough: 0.6 },
    },
    {
      name: 'Blue bloom', format: 'portrait', seed: 21,
      params: { palette: ['#F2F4F7', '#1C6BFF', '#27B5FF', '#FF7A1A'], scene: 'blots', count: 7, size: 1.25, bleed: 0.7, feather: 0.8, core: 0.7, halo: 0.6 },
    },
    {
      name: 'Sumi', format: 'portrait', seed: 3,
      params: { palette: ['#EFEBE3', '#141414', '#3A3A3A'], hot: '#8C1C13', deep: '#000000', scene: 'strokes', bleed: 0.35, feather: 0.9, fibre: 0.7, core: 0.3, halo: 0.55, ring: 0.5 },
      finish: { grain: 0.35, grainType: 'speckle' },
    },
    {
      name: 'Riso', format: 'square', seed: 12,
      params: { palette: ['#F6F1E7', '#FF48B0', '#0078BF', '#FFE800'], hot: '#FFE800', deep: '#1B1464', feather: 0.5, core: 0.45, ring: 0.35 },
      finish: { grain: 0.45, grainType: 'speckle' },
    },
  ],
  draw({ g, w, h, p, rng, noise, t, seed }) {
    // Work at up to ~720px on the long side; the smooth upscale suits soft ink.
    const q = Math.min(1, 720 / Math.max(g.canvas.width, g.canvas.height))
    const lw = Math.max(32, Math.round(g.canvas.width * q))
    const lh = Math.max(32, Math.round(g.canvas.height * q))
    const n = lw * lh
    const unit = lw / w // working px per artwork unit
    const m = Math.min(w, h)

    const [paperHex, ...inkHex] = pal(p, 'palette')
    const paper = hexToRgb(paperHex)
    const inks = (inkHex.length ? inkHex : ['#111111']).map(hexToRgb)
    const hot = hexToRgb(str(p, 'hot'))
    const deep = hexToRgb(str(p, 'deep'))
    const bleed = num(p, 'bleed')
    const feather = num(p, 'feather')
    const core = num(p, 'core')
    const halo = num(p, 'halo')
    const ring = num(p, 'ring')

    const marks = compose(rng, w, h, inks.length, str(p, 'scene'), num(p, 'count'), num(p, 'size'))
    const fib = fibres(lw, lh, unit * (m / 1080), num(p, 'fibre'), seed)

    // Low-frequency mottle, on a coarse grid: wanders the edge and marbles the cores.
    const C = 4
    const cw = Math.ceil(lw / C) + 1
    const ch = Math.ceil(lh / C) + 1
    const cm = new Float32Array(cw * ch)
    for (let gy = 0; gy < ch; gy++) {
      for (let gx = 0; gx < cw; gx++) {
        const u = (gx * C) / unit / m
        const v = (gy * C) / unit / m
        cm[gy * cw + gx] = noise.loop(u * 5, v * 5, t, 0.3) * 0.65 + noise.n2(u * 13 + 40, v * 13) * 0.35
      }
    }
    const mottle = new Float32Array(n)
    for (let y = 0; y < lh; y++) {
      const fy = y / C
      const y0 = fy | 0
      const ty = fy - y0
      for (let x = 0; x < lw; x++) {
        const fx = x / C
        const x0 = fx | 0
        const tx = fx - x0
        const a = y0 * cw + x0
        mottle[y * lw + x] =
          cm[a] * (1 - tx) * (1 - ty) + cm[a + 1] * tx * (1 - ty) + cm[a + cw] * (1 - tx) * ty + cm[a + cw + 1] * tx * ty
      }
    }

    // cheap per-pixel hash for pigment granulation (stable per seed)
    const grainAt = (i: number) => {
      let hsh = (i * 374761393 + seed * 668265263) | 0
      hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177)
      return ((hsh ^ (hsh >>> 16)) >>> 0) / 4294967296
    }

    const R = new Float32Array(n).fill(paper[0])
    const G = new Float32Array(n).fill(paper[1])
    const B = new Float32Array(n).fill(paper[2])

    mask ??= document.createElement('canvas')
    mask.width = lw
    mask.height = lh
    const mg = mask.getContext('2d', { willReadFrequently: true })!
    const blurR = Math.max(1, Math.round(unit * m * (0.003 + bleed * 0.012)))
    // a much wider blur approximates distance from the edge: how thick the ink pooled
    const poolR = Math.max(2, Math.round(unit * m * 0.03))
    const breathe = Math.sin(t * Math.PI * 2) * 0.015
    const th = 0.5 - bleed * 0.14 + breathe
    const haloTh = th * 0.3

    for (let k = 0; k < inks.length; k++) {
      const own = marks.filter((mk) => mk.ink === k)
      if (!own.length) continue
      mg.setTransform(1, 0, 0, 1, 0, 0)
      mg.fillStyle = '#000'
      mg.fillRect(0, 0, lw, lh)
      mg.setTransform(unit, 0, 0, lh / h, 0, 0)
      // each mark gets its own rng so droplets and rays don't depend on paint order
      for (const mk of own) paintMark(mg, mk, noise, createRng(seed + Math.floor(mk.o * 1e4)), t)
      const md = mg.getImageData(0, 0, lw, lh).data
      const raw = new Float32Array(n)
      for (let i = 0; i < n; i++) raw[i] = md[i * 4] / 255
      const S = boxBlur(raw, lw, lh, blurR)
      // the pool field is very smooth, so blur it on the coarse grid and sample bilinearly
      const coarse = new Float32Array(cw * ch)
      for (let gy = 0; gy < ch; gy++) {
        const row = Math.min(lh - 1, gy * C) * lw
        for (let gx = 0; gx < cw; gx++) coarse[gy * cw + gx] = S[row + Math.min(lw - 1, gx * C)]
      }
      const P = boxBlur(coarse, cw, ch, Math.max(1, Math.round(poolR / C)))

      const [ir, ig, ib] = inks[k]
      // warm inks run hot, cool inks run deep: a thermal read of the density
      const K = ir > ib ? hot : deep
      // a dark core reads much heavier than a bright one, so hold it back
      const coreCap = ir > ib ? 1 : 0.8
      for (let i = 0; i < n; i++) {
        const s = S[i]
        if (s < 0.01) continue
        const mo = mottle[i]
        const f = fib[i]
        // ink wicks along fibres, and a fine spray of speckle roughens what's left
        const v = s + (f - 0.12) * feather * 0.6 + (grainAt(i) - 0.5) * feather * 0.14 + mo * 0.05
        const body = smoothstep(th - 0.05, th + 0.05, v)
        const wet = smoothstep(haloTh - 0.04, haloTh + 0.06, s + f * feather * 0.45) * halo * 0.3
        const a = Math.max(body, wet)
        if (a <= 0) continue
        // thermal tone: thin edges run pale, pooled ink runs to the core colour, marbled by mottle
        const px = (i % lw) / C
        const py = ((i / lw) | 0) / C
        const x0 = px | 0
        const y0 = py | 0
        const tx = px - x0
        const ty = py - y0
        const pa = y0 * cw + x0
        const pool = P[pa] * (1 - tx) * (1 - ty) + P[pa + 1] * tx * (1 - ty) + P[pa + cw] * (1 - tx) * ty + P[pa + cw + 1] * tx * ty
        const tone = Math.max(0, Math.min(1, pool * s * 0.95 + mo * 0.55))
        const tint = (1 - smoothstep(0.05, 0.4, tone)) * 0.4 + (1 - body) * 0.3
        let r = ir + (255 - ir) * tint
        let gg = ig + (255 - ig) * tint
        let b = ib + (255 - ib) * tint
        const c = smoothstep(1 - core * 0.35, 1.12 - core * 0.3, tone) * Math.min(1, core * 1.5) * coreCap
        r += (K[0] - r) * c
        gg += (K[1] - gg) * c
        b += (K[2] - b) * c
        // pigment gathers where the wet edge dried
        const e = body * (1 - smoothstep(th, th + 0.22, s)) * ring * 0.55
        r *= 1 - e
        gg *= 1 - e
        b *= 1 - e
        const gr = 1 + (grainAt(i) - 0.5) * 0.08 * body
        R[i] += (r * gr - R[i]) * a
        G[i] += (gg * gr - G[i]) * a
        B[i] += (b * gr - B[i]) * a
      }
    }

    const img = new ImageData(lw, lh)
    const o = img.data
    for (let i = 0; i < n; i++) {
      o[i * 4] = R[i]
      o[i * 4 + 1] = G[i]
      o[i * 4 + 2] = B[i]
      o[i * 4 + 3] = 255
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
