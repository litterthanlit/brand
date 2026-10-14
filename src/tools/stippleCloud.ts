import { hexToRgb, luminance } from '../lib/color'
import type { Noise } from '../lib/noise'
import type { Rng } from '../lib/random'
import { num, pal, str, type CanvasTool, type ParamValues } from './types'

const TAU = Math.PI * 2
const K = 12 // tone buckets, painted dim → bright
const LN = 1024 // axial lookup resolution
const GX = 128 // turbulence grid per axis: along it (±XM, in arm lengths) × across it (±QM sigmas)
const GY = 40
const XM = 2.4
const QM = 3.4

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const frac = (v: number) => v - Math.floor(v)
// Φ⁻¹(p), Abramowitz & Stegun 26.2.23: turns an even 0…1 spread into a gaussian one
const probit = (p: number) => {
  const q = Math.min(p, 1 - p)
  const s = Math.sqrt(-2 * Math.log(Math.max(q, 1e-4)))
  const z = s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s)
  return p < 0.5 ? -z : z
}

interface Layout {
  n: number
  a0: Float32Array // axial phase: the dot's place in the flow, uniform in [0,1)
  q0: Float32Array // fixed across-the-arm offset, in sigmas
  arm: Uint8Array
  rs: Float32Array // size roll
  rt: Float32Array // lane threshold roll
  el: Float32Array // elongation roll
  ph: Float32Array // twinkle phase
  jt: Float32Array // tone jitter
  /** per arm: cos, sin, length px, width px, widening 1/px, density, bend 1/px, angle, direction, axis */
  armP: Float32Array
  X: Float32Array // axial distance by phase (1 = the arm's 90% mark)
  R: Float32Array // axial density ratio by phase
  F: Float32Array // size envelope by phase: fades at the far tail and re-spawn
  grids: Float32Array[]
  ember: Float32Array // per ember: x, y, size jitters; then the group's rotation
  gapR: number
}

const layouts = new Map<string, Layout>()
let off: HTMLCanvasElement[] | null = null
let fillKey = ''
let fills = new Float32Array(K * 4)
let bufs: ImageData[] = []
let cnt = new Uint32Array(K + 1)
let px = new Float32Array(0)
let py = new Float32Array(0)
let pr = new Float32Array(0)
let pe = new Float32Array(0)
let pa = new Float32Array(0)
let pk = new Uint8Array(0)
let ord = new Uint32Array(0)

/** Axial distribution: x = ((E+e0)^k − e0^k) with E ~ Exp(1) driven by the phase. Soft core, heavy wisps. */
function profile(k: number) {
  const X = new Float32Array(LN + 1)
  const R = new Float32Array(LN + 1)
  const F = new Float32Array(LN + 1)
  const e0 = 0.45
  const g = (E: number) => (E + e0) ** k - e0 ** k
  const g90 = g(Math.log(10))
  let max = 0
  for (let j = 0; j <= LN; j++) {
    const a = Math.min(j / LN, 0.9995)
    const E = -Math.log(1 - a)
    X[j] = g(E) / g90
    R[j] = (1 - a) / (E + e0) ** (k - 1) // pdf = 1 / (dx/da)
    max = Math.max(max, R[j])
    F[j] = smooth(0, 0.006, a) * (1 - smooth(0.96, 0.995, a))
  }
  for (let j = 0; j <= LN; j++) R[j] /= max
  return { X, R, F }
}

/** Static turbulence for one axis, in (distance, offset) space. Both arms of an axis read the same field, so the core stays seamless. */
function turbGrid(noise: Noise, axis: number, amp: number) {
  const out = new Float32Array(GX * GY * 4)
  const ox = axis * 17.3
  const oy = axis * 9.1
  for (let gy = 0; gy < GY; gy++) {
    const q = -QM + (gy * 2 * QM) / (GY - 1)
    for (let gx = 0; gx < GX; gx++) {
      const x = -XM + (gx * 2 * XM) / (GX - 1)
      const ax = Math.abs(x)
      const damp = amp * 0.15 * smooth(0, 0.2, ax) // keep the core tight
      const calm = smooth(0.05, 0.35, ax) // lanes and ridges fade in away from the core, so the hot centre stays one glow
      const i = (gy * GX + gx) * 4
      // lateral shove: long in x, short across, so it reads as drifting striations
      out[i] = damp * (0.8 * noise.n2(x * 1.5 + ox, q * 0.75 + oy) + 0.3 * noise.n2(x * 3.4 + ox + 31, q * 1.6 + oy + 11))
      out[i + 1] = damp * 0.8 * 4 * noise.n2(x * 1.2 + ox + 57, q * 0.8 + oy + 5)
      // brightness ridges
      out[i + 2] = (0.3 + 0.7 * calm) * (0.7 * noise.n2(x * 1.4 + ox + 91, q * 0.9 + oy + 23) + 0.3 * noise.n2(x * 3.1 + ox + 7, q * 1.9 + oy + 47))
      // lanes: very long in x, narrow across, thin the dots out into striations
      out[i + 3] = calm * (0.75 * noise.n2(x * 0.9 + ox + 13, q * 1.9 + oy + 71) + 0.35 * noise.n2(x * 2.2 + ox + 29, q * 4.1 + oy + 3))
    }
  }
  return out
}

function build(p: ParamValues, w: number, h: number, rng: Rng, noise: Noise, n: number): Layout {
  const shape = str(p, 'shape')
  const D = Math.hypot(w, h)
  const form = clamp01((num(p, 'accumulate') - 0.06) / 0.8) ** 0.9 // 0 = loose scatter, 1 = formed cloud
  const fg = Math.min(1, form * 1.4) // the silhouette forms a little ahead of the shading
  const turb = num(p, 'turbulence')
  const L90 = 0.5 * num(p, 'length') * D * mix(0.8, 1, fg)
  const Wc = mix(0.42 * L90, num(p, 'width') * L90 * 0.55, fg) // sigma across the core
  const base = (num(p, 'angle') * Math.PI) / 180

  // arms: [angle, share of dots, length, core width, widening per L90, bend sign, direction along its axis, axis]
  const side = () => (rng() < 0.5 ? -1 : 1)
  // the arch leans toward the middle of the canvas, so the cloud wraps into the frame instead of sliding out of it
  const lean = (w / 2 - num(p, 'x') * w) * -Math.sin(base) + (h / 2 - num(p, 'y') * h) * Math.cos(base)
  const bs = lean === 0 ? side() : Math.sign(lean)
  let spec: number[][]
  let bendK = 0.5
  if (shape === 'spray') {
    spec = [[base + Math.PI, 0.7, 1.25, 0.9, -0.55, bs, -1, 0], [base, 0.3, 0.5, 1, 1.4, bs, 1, 0]] // a swoosh: tail and head lean opposite ways
    bendK = 0.22
  } else if (shape === 'overlap') {
    const cross = base + (rng.range(64, 76) * Math.PI) / 180
    const bc = side()
    spec = [
      [base, 0.28, 1, 0.25, 0.6, bs, 1, 0], [base + Math.PI, 0.28, 1, 0.25, 0.6, -bs, -1, 0],
      [cross, 0.22, 1, 0.25, 0.6, bc, 1, 1], [cross + Math.PI, 0.22, 1, 0.25, 0.6, -bc, -1, 1],
    ]
    bendK = 0.12
  } else {
    spec = [[base, 0.6, 1.15, 0.8, 0.8, bs, 1, 0], [base + Math.PI, 0.4, 0.85, 0.8, 0.2, -bs, -1, 0]]
  }
  const na = spec.length
  const arms = spec.map(([ang, share, len, b, m, bn, sg, axis]) => ({
    ang, sg, axis,
    share: mix(1 / na, share, fg),
    len: mix(1, len, fg),
    b: mix(1, b, fg),
    m: mix(0.12, m, fg),
    bend: bn * rng.range(0.6, 1) * (0.25 + turb) * form * bendK,
  }))
  const peak = Math.max(...arms.map((a) => a.share / a.len / a.b))
  const armP = new Float32Array(na * 10)
  arms.forEach((a, i) => {
    const o = i * 10
    armP[o] = Math.cos(a.ang)
    armP[o + 1] = Math.sin(a.ang)
    armP[o + 2] = a.len * L90
    armP[o + 3] = Wc * a.b
    armP[o + 4] = a.m / a.b / L90
    armP[o + 5] = a.share / a.len / a.b / peak
    armP[o + 6] = a.bend / L90
    armP[o + 7] = a.ang
    armP[o + 8] = a.sg
    armP[o + 9] = a.axis
  })
  const cum: number[] = []
  arms.reduce((s, a, i) => (cum[i] = s + a.share), 0)

  const k = mix(0.7, 0.55 + 0.6 * num(p, 'concentration'), fg)
  const { X, R, F } = profile(k)
  const amp = turb * form
  const grids = [0, 1].slice(0, shape === 'overlap' ? 2 : 1).map((ax) => turbGrid(noise, ax, amp))

  // Each arm gets its own Roberts R2 low-discrepancy set (+ a little jitter): even, stippled spacing instead of random clumps
  const shift = arms.map(() => [rng(), rng()])
  const s3 = rng()
  const seen = new Array<number>(na).fill(0)
  const L: Layout = {
    n,
    a0: new Float32Array(n), q0: new Float32Array(n), arm: new Uint8Array(n),
    rs: new Float32Array(n), rt: new Float32Array(n), el: new Float32Array(n), ph: new Float32Array(n), jt: new Float32Array(n),
    armP, X, R, F, grids, ember: new Float32Array(28), gapR: shape === 'overlap' ? 0.045 * D : 0,
  }
  for (let i = 0; i < n; i++) {
    const ua = frac(s3 + 0.6180339887 * (i + 1))
    let ai = 0
    while (ai < na - 1 && ua > cum[ai]) ai++
    L.arm[i] = ai
    const c = ++seen[ai]
    const jit = 0.8 / Math.sqrt(Math.max(1, n * arms[ai].share))
    L.a0[i] = Math.min(0.99999, frac(shift[ai][0] + 0.7548776662 * c + (rng() - 0.5) * jit))
    const uq = clamp01(frac(shift[ai][1] + 0.5698402910 * c + (rng() - 0.5) * jit))
    L.q0[i] = Math.max(-QM + 0.05, Math.min(QM - 0.05, probit(uq)))
    L.rs[i] = rng() ** 2.5
    L.rt[i] = rng()
    L.el[i] = rng()
    L.ph[i] = rng()
    L.jt[i] = rng() - 0.5
  }
  for (let i = 0; i < 27; i++) L.ember[i] = rng() - 0.5
  L.ember[27] = rng() * TAU
  return L
}

function layoutFor(p: ParamValues, w: number, h: number, seed: number, rng: Rng, noise: Noise) {
  const n = Math.max(40, Math.round(num(p, 'dots') * num(p, 'accumulate') ** 1.5)) // loose stages are properly sparse
  const key = [seed, w, h, n, str(p, 'shape'), num(p, 'x'), num(p, 'y'), num(p, 'accumulate'), num(p, 'angle'), num(p, 'length'), num(p, 'width'), num(p, 'concentration'), num(p, 'turbulence')].join('|')
  let L = layouts.get(key)
  if (!L) {
    if (layouts.size >= 6) layouts.delete(layouts.keys().next().value as string)
    L = build(p, w, h, rng, noise, n)
    layouts.set(key, L)
  }
  return L
}

/** The ink, lifted in lightness but kept saturated: the mid-stop of the ramp, so the body glows blue instead of going chalky. */
function lift([r, g, b]: number[]): number[] {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  const h = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  const l2 = Math.min(0.8, l + 0.18)
  const c = (1 - Math.abs(2 * l2 - 1)) * Math.min(1, s + 0.1)
  const x = c * (1 - Math.abs((h % 2) - 1))
  const m = l2 - c / 2
  const q = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  return q.map((v) => (v + m) * 255)
}

/** Quantised ink → core ramp, as r,g,b,a per tone bucket: alpha 0.62 at the sparse edge → 1 in the core. A darker core (light fields) shades straight across. */
function toneFills(ink: string, core: string) {
  const key = ink + core
  if (key === fillKey) return fills
  const c0 = hexToRgb(ink)
  const c2 = hexToRgb(core)
  const dark = luminance(core) < luminance(ink)
  const c1 = dark ? c0 : lift(c0)
  fills = new Float32Array(K * 4)
  for (let b = 0; b < K; b++) {
    const tt = (b + 0.5) / K
    const [lo, hi, f] = dark || tt > 0.42 ? [c1, c2, dark ? tt * 0.8 : (tt - 0.42) / 0.58] : [c0, c1, tt / 0.42]
    for (let i = 0; i < 3; i++) fills[b * 4 + i] = mix(lo[i], hi[i], f)
    fills[b * 4 + 3] = 0.62 + 0.38 * Math.min(1, tt * 3.5)
  }
  fillKey = key
  return fills
}

/**
 * Software raster of the tone-sorted dots: antialiased discs (pills when stretched) blended over an opaque buffer.
 * Thousands of tiny canvas paths are the slow part of a frame; this costs a few ms and looks the same.
 */
function splat(d: Uint8ClampedArray, W: number, H: number, sx: number, sy: number, ox: number, oy: number, rgba: Float32Array, stride = 1) {
  const grow = Math.sqrt(stride) // skipped dots hand their area to the ones drawn
  for (let b = 0; b < K; b++) {
    const cr = rgba[b * 4]
    const cg = rgba[b * 4 + 1]
    const cb = rgba[b * 4 + 2]
    const ca = rgba[b * 4 + 3]
    for (let q = cnt[b]; q < cnt[b + 1]; q += stride) {
      const i = ord[q]
      const x = px[i] * sx + ox
      const y = py[i] * sy + oy
      let r = Math.max(0.45, pr[i] * sx * grow)
      const e = pe[i]
      let hl = 0
      let ux = 1
      let uy = 0
      if (e >= 0.1) {
        hl = r * e * 0.9
        ux = Math.cos(pa[i])
        uy = Math.sin(pa[i])
        r *= 1 - 0.15 * e
      }
      const ex = Math.abs(ux) * hl + r + 1
      const ey = Math.abs(uy) * hl + r + 1
      const x0 = Math.max(0, Math.floor(x - ex))
      const x1 = Math.min(W - 1, Math.ceil(x + ex))
      const y0 = Math.max(0, Math.floor(y - ey))
      const y1 = Math.min(H - 1, Math.ceil(y + ey))
      const inner = r > 0.5 ? (r - 0.5) * (r - 0.5) : -1 // fully covered inside, antialiased only on the rim (saves the sqrt)
      const outer = (r + 0.5) * (r + 0.5)
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + 0.5 - y
        let k = (yy * W + x0) * 4
        for (let xx = x0; xx <= x1; xx++, k += 4) {
          const dx = xx + 0.5 - x
          let a = ca
          if (hl) {
            const pj = Math.max(-hl, Math.min(hl, dx * ux + dy * uy))
            const qx = dx - pj * ux
            const qy = dy - pj * uy
            const c = r + 0.5 - Math.sqrt(qx * qx + qy * qy)
            if (c <= 0) continue
            if (c < 1) a *= c
          } else {
            const d2 = dx * dx + dy * dy
            if (d2 >= outer) continue
            if (d2 > inner) a *= r + 0.5 - Math.sqrt(d2)
          }
          d[k] += (cr - d[k]) * a
          d[k + 1] += (cg - d[k + 1]) * a
          d[k + 2] += (cb - d[k + 2]) * a
        }
      }
    }
  }
}

const buffer = (i: number, W: number, H: number, hex: string) => {
  let b = bufs[i]
  if (!b || b.width !== W || b.height !== H) b = bufs[i] = new ImageData(W, H)
  const [r, g, bl] = hexToRgb(hex)
  new Uint32Array(b.data.buffer).fill(((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0)
  return b
}

/** Ember group in units of one ember's diameter: a dice-like cluster with tiny gaps. */
function emberPts(ne: number) {
  const pts: [number, number][] = []
  if (ne === 1) pts.push([0, 0])
  else if (ne === 2) pts.push([-0.78, 0], [0.78, 0])
  else if (ne === 3) for (let i = 0; i < 3; i++) pts.push([Math.cos((i * TAU) / 3 - 1.2) * 0.9, Math.sin((i * TAU) / 3 - 1.2) * 0.9])
  else if (ne === 4) pts.push([-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78])
  else {
    pts.push([0, 0]) // quincunx for 5, ring + centre beyond
    const ring = Math.max(1.3, ((ne - 1) * 1.15) / TAU)
    for (let i = 0; i < ne - 1; i++) pts.push([Math.cos((i * TAU) / (ne - 1) + 0.785) * ring, Math.sin((i * TAU) / (ne - 1) + 0.785) * ring])
  }
  return pts
}

export const stippleCloud: CanvasTool = {
  id: 'stipple-cloud',
  name: 'Stipple Cloud',
  category: 'Texture',
  description: 'A galaxy of stippled dots condensing around an ember core: context gathering where sessions overlap.',
  kind: 'canvas',
  raw: true,
  animated: true,
  duration: 12,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (field, ink, core, ember)', default: ['#171A1B', '#1689D4', '#F3F1EA', '#F48254'], min: 4, max: 4 },
    {
      type: 'select', key: 'shape', label: 'Shape', default: 'galaxy',
      options: [{ value: 'galaxy', label: 'Galaxy' }, { value: 'spray', label: 'Spray' }, { value: 'overlap', label: 'Overlap' }],
    },
    { type: 'number', key: 'dots', label: 'Dots', min: 1000, max: 40000, step: 500, default: 16000, rand: [9000, 24000] },
    { type: 'number', key: 'accumulate', label: 'Accumulate', min: 0.05, max: 1, step: 0.01, default: 1, rand: [0.7, 1] },
    { type: 'number', key: 'x', label: 'Core x', min: 0, max: 1, step: 0.01, default: 0.62, rand: [0.4, 0.62] },
    { type: 'number', key: 'y', label: 'Core y', min: 0, max: 1, step: 0.01, default: 0.7, rand: [0.42, 0.7] },
    { type: 'number', key: 'angle', label: 'Angle', min: -90, max: 90, step: 1, default: -24, unit: '°', rand: [-50, 20] },
    { type: 'number', key: 'length', label: 'Length', min: 0.3, max: 1.8, step: 0.01, default: 1, rand: [0.7, 1.4] },
    { type: 'number', key: 'width', label: 'Width', min: 0.05, max: 0.7, step: 0.01, default: 0.26, rand: [0.18, 0.4] },
    { type: 'number', key: 'concentration', label: 'Concentration', min: 0.5, max: 3, step: 0.01, default: 1.1, rand: [0.9, 2.2] },
    { type: 'number', key: 'size', label: 'Dot size', min: 0.5, max: 14, step: 0.1, default: 3.8, unit: 'px', rand: [1.8, 5] },
    { type: 'number', key: 'sizeVar', label: 'Size variation', min: 0, max: 1, step: 0.01, default: 0.5, rand: [0.3, 0.9] },
    { type: 'number', key: 'stretch', label: 'Stretch', min: 0, max: 1, step: 0.01, default: 0.25, rand: [0, 0.6] },
    { type: 'number', key: 'turbulence', label: 'Turbulence', min: 0, max: 1, step: 0.01, default: 0.45, rand: [0.15, 0.7] },
    { type: 'number', key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.9, rand: [0.45, 0.95] },
    { type: 'number', key: 'soft', label: 'Soft', min: 0, max: 1, step: 0.01, default: 0, rand: [0, 0.3] },
    { type: 'number', key: 'embers', label: 'Embers', min: 0, max: 9, step: 1, default: 4, rand: [3, 6] },
    { type: 'number', key: 'emberSize', label: 'Ember size', min: 2, max: 24, step: 0.5, default: 16, unit: 'px', rand: [7, 16] },
    {
      type: 'select', key: 'motion', label: 'Motion', default: 'stream',
      options: [{ value: 'stream', label: 'Stream' }, { value: 'shimmer', label: 'Shimmer' }],
    },
  ],
  defaults: {
    format: 'landscape',
    finish: { grain: 0.2, grainType: 'soft' },
    type: { enabled: true, layout: 'tl', title: 'new agent, same project', body: '', label: '', caption: '', uppercase: false, weight: '500', color: '#F3F1EA', size: 5.6, measure: 0.6, margin: 0.045 },
  },
  presets: [
    {
      name: 'Common Ground', format: 'landscape', seed: 7,
      params: { dots: 24000, size: 4.4, y: 0.72, emberSize: 20 },
    },
    {
      name: 'Context stays', format: 'portrait', seed: 21,
      params: { dots: 5500, size: 14, sizeVar: 0.45, length: 1.6, width: 0.3, angle: 60, x: 0.36, y: 0.34, concentration: 0.6, turbulence: 0.5, stretch: 0.3, embers: 4, emberSize: 24 },
      type: { enabled: true, layout: 'bl', title: 'Context stays.', size: 3.6, measure: 0.8, margin: 0.06 },
    },
    {
      name: 'Ivory', format: 'landscape', seed: 5,
      params: { palette: ['#F3F1EA', '#1689D4', '#0B4F8A', '#F48254'], shape: 'spray', dots: 22000, size: 3.6, angle: -8, x: 0.68, y: 0.62, emberSize: 16 },
      finish: { grain: 0.15, grainType: 'soft' },
      type: { enabled: true, layout: 'tl', title: 'You don’t explain the project again.', size: 2.6, measure: 0.4, color: '#171A1B' },
    },
    {
      name: 'Overlap', format: 'portrait', seed: 12,
      params: { palette: ['#F3F1EA', '#1689D4', '#0B4F8A', '#F48254'], shape: 'overlap', dots: 26000, size: 10.5, angle: 40, x: 0.5, y: 0.5, width: 0.36, turbulence: 0.25, glow: 1, soft: 0.85 },
      finish: { grain: 0.55, grainType: 'soft', grainSize: 0.8 },
      type: { enabled: false },
    },
    {
      name: 'Capture', format: 'square', seed: 3,
      params: { accumulate: 0.08, dots: 9000, size: 5, length: 0.5, width: 0.3, turbulence: 0.15, glow: 1, angle: -10, x: 0.48, y: 0.4, embers: 4, emberSize: 14 },
      type: { enabled: true, layout: 'bl', title: 'capture', caption: 'DIFFERENT SESSIONS BRING THEIR OWN CONTEXT.', size: 1.5, measure: 0.8 },
    },
    {
      name: 'Retain', format: 'square', seed: 3,
      params: { accumulate: 0.4, dots: 9000, size: 5, length: 0.5, width: 0.3, turbulence: 0.15, glow: 1, angle: -10, x: 0.48, y: 0.4, embers: 4, emberSize: 14 },
      type: { enabled: true, layout: 'bl', title: 'retain', caption: 'SHARED CONTEXT ACCUMULATES.', size: 1.5, measure: 0.8 },
    },
    {
      name: 'Resume', format: 'square', seed: 3,
      params: { accumulate: 0.85, dots: 9000, size: 5, length: 0.5, width: 0.3, turbulence: 0.15, glow: 1, angle: -10, x: 0.48, y: 0.4, embers: 4, emberSize: 14 },
      type: { enabled: true, layout: 'bl', title: 'resume', caption: 'A NEW SESSION. THE SAME PROJECT.', size: 1.5, measure: 0.8 },
    },
  ],
  draw({ g, w, h, p, rng, noise, t, seed }) {
    const [field, ink, core, ember] = pal(p, 'palette')
    const u = Math.min(w, h) / 1080
    const L = layoutFor(p, w, h, seed, rng, noise)
    const { n, a0, q0, arm, rs, rt, el, ph, jt, armP, X, R, F, grids } = L
    const stream = str(p, 'motion') !== 'shimmer'
    const sizeBase = 0.5 * num(p, 'size') * u
    const sv = num(p, 'sizeVar')
    const stretch = num(p, 'stretch')
    const form = clamp01((num(p, 'accumulate') - 0.06) / 0.8) ** 0.9
    const darkCore = luminance(core) < luminance(ink) // light fields shade ink → navy, and need less density to read it
    const toneK = num(p, 'glow') * (darkCore ? 1.7 : 1.25) * mix(0.2, 1, form ** 0.8)
    const wspK = 0.9 * num(p, 'turbulence') * form
    const laneK = 2 * num(p, 'turbulence') * form
    const ne = Math.round(num(p, 'embers'))
    const emberD = num(p, 'emberSize') * u
    // the dots thin out around the ember group so it always reads as the crisp focus
    const clearR = ne > 0 ? Math.max(0.5, ...emberPts(ne).map(([a, b]) => Math.hypot(a, b) + 0.5)) * emberD + 3 * u : 0
    const cx = num(p, 'x') * w
    const cy = num(p, 'y') * h

    // soft pass: blurred copy of the dots, mixed with the sharp ones
    const soft = num(p, 'soft')
    const T = g.getTransform()
    const ds = T.a // device px per artwork unit
    const blur = 'filter' in g && soft > 0.01 ? soft * 20 * u * ds : 0
    const mg = Math.ceil(blur * 3) // margin so the blur doesn't thin out at the canvas edge
    const pad = 24 * u + mg / ds

    if (px.length < n) {
      px = new Float32Array(n); py = new Float32Array(n); pr = new Float32Array(n)
      pe = new Float32Array(n); pa = new Float32Array(n); pk = new Uint8Array(n); ord = new Uint32Array(n)
    }
    cnt.fill(0)
    let m = 0
    const gxs = (GX - 1) / (2 * XM)
    const gys = (GY - 1) / (2 * QM)
    for (let i = 0; i < n; i++) {
      let a = a0[i]
      if (stream) {
        a += t
        a -= Math.floor(a)
      }
      const f = a * LN
      const j = f | 0
      const fr = f - j
      const fd = F[j] + (F[j + 1] - F[j]) * fr
      if (fd < 0.02) continue
      const xs = X[j] + (X[j + 1] - X[j]) * fr
      const rho = R[j] + (R[j + 1] - R[j]) * fr
      const ai = arm[i]
      const o = ai * 10
      const sg = armP[o + 8]
      const s0 = armP[o + 2] * xs
      // turbulence lookup, bilinear
      const gu = (Math.min(xs, XM - 0.01) * sg + XM) * gxs
      const gv = (q0[i] * sg + QM) * gys
      const x0 = gu | 0
      const y0 = gv | 0
      const fx = gu - x0
      const fy = gv - y0
      const gd = grids[armP[o + 9]]
      const b0 = (y0 * GX + x0) * 4
      const b1 = b0 + GX * 4
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const dq = sg * (gd[b0] * w00 + gd[b0 + 4] * w10 + gd[b1] * w01 + gd[b1 + 4] * w11)
      const dsv = sg * (gd[b0 + 1] * w00 + gd[b0 + 5] * w10 + gd[b1 + 1] * w01 + gd[b1 + 5] * w11)
      const wsp = gd[b0 + 2] * w00 + gd[b0 + 6] * w10 + gd[b1 + 2] * w01 + gd[b1 + 6] * w11
      const lane = gd[b0 + 3] * w00 + gd[b0 + 7] * w10 + gd[b1 + 3] * w01 + gd[b1 + 7] * w11

      const qn = q0[i] + dq
      const widen = Math.max(0.12, 1 + armP[o + 4] * s0)
      const W = armP[o + 3] * widen
      const along = s0 + dsv * W * 0.7
      const lat = qn * W + armP[o + 6] * s0 * s0
      const ca = armP[o]
      const sa = armP[o + 1]
      const x = cx + ca * along - sa * lat
      const y = cy + sa * along + ca * lat
      if (x < -pad || x > w + pad || y < -pad || y > h + pad) continue

      // analytic density at the dot: axial profile × cone widening × gaussian across
      const d = (rho * armP[o + 5] * Math.exp(-0.5 * qn * qn)) / Math.max(0.6, widen)
      const sd = Math.sqrt(d)
      let tone = (darkCore ? sd : sd * Math.sqrt(sd)) * toneK + wsp * wspK + jt[i] * 0.16
      // striations: each dot lives while the lane field beats its own threshold, shrinking smoothly otherwise
      let rm = fd * (1 + wsp * wspK * 0.8) * clamp01((1 + lane * laneK - rt[i]) / 0.25 + 1)
      if (L.gapR) rm *= smooth(0.3 * L.gapR, L.gapR, s0)
      if (clearR) rm *= smooth(0.7 * clearR, 1.3 * clearR, Math.hypot(x - cx, y - cy))
      if (!stream) {
        const tw = Math.sin(TAU * (t * (1 + (i & 1)) + ph[i]))
        tone += 0.12 * tw
        rm *= 1 + 0.3 * tw
      }
      tone = clamp01(tone)
      const r = sizeBase * ((1 - 0.55 * sv) + 1.5 * sv * rs[i]) * rm * (blur ? 1 + 0.6 * tone : 1 - 0.18 * tone)
      if (r < 0.2 * u) continue
      const b = Math.min(K - 1, (tone * K) | 0)
      px[m] = x
      py[m] = y
      pr[m] = r
      pe[m] = stretch * el[i]
      pa[m] = armP[o + 7]
      pk[m] = b
      cnt[b + 1]++
      m++
    }
    for (let b = 0; b < K; b++) cnt[b + 1] += cnt[b]
    const at = cnt.slice(0, K) // tone-sorted order, so the brightest dots always land on top
    for (let i = 0; i < m; i++) ord[at[pk[i]]++] = i

    const colours = toneFills(ink, core)
    const W = g.canvas.width
    const H = g.canvas.height
    const sw = blur > 0 ? clamp01(1 - soft / 0.85) : 1 // weight of the sharp layer: gone by soft 0.85, which also skips its cost
    if (sw > 0.02) {
      const img = buffer(0, W, H, field)
      splat(img.data, W, H, T.a, T.d, T.e, T.f, colours)
      g.putImageData(img, 0, 0)
    } else {
      g.fillStyle = field
      g.fillRect(0, 0, w, h)
    }
    if (sw < 1) {
      // the blur is heavy, so dots go to a small buffer, blur there, then scale up over the sharp ones
      const lf = Math.min(1, Math.max(0.12, 4 / blur))
      const lw = Math.ceil((W + mg * 2) * lf)
      const lh = Math.ceil((H + mg * 2) * lf)
      const img = buffer(1, lw, lh, field)
      splat(img.data, lw, lh, T.a * lf, T.d * lf, (T.e + mg) * lf, (T.f + mg) * lf, colours)
      off ??= [document.createElement('canvas'), document.createElement('canvas')]
      for (const c of off) {
        if (c.width !== lw) c.width = lw
        if (c.height !== lh) c.height = lh
      }
      const ob = off[1].getContext('2d')!
      off[0].getContext('2d')!.putImageData(img, 0, 0)
      ob.clearRect(0, 0, lw, lh)
      ob.filter = `blur(${(blur * lf).toFixed(2)}px)`
      ob.drawImage(off[0], 0, 0)
      ob.filter = 'none'
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.imageSmoothingQuality = 'high'
      g.globalAlpha = 1 - sw
      g.drawImage(off[1], -mg, -mg, lw / lf, lh / lf)
      g.restore()
    }

    // embers: a tight group on the density peak, never blurred
    if (ne > 0) {
      const breathe = 1 + 0.06 * Math.sin(TAU * t)
      const D = emberD * breathe
      const rot = L.ember[27]
      const cr = Math.cos(rot)
      const sr = Math.sin(rot)
      g.fillStyle = ember
      g.beginPath()
      emberPts(ne).forEach(([ex, ey], i) => {
        const jx = ex + L.ember[i * 3] * 0.16
        const jy = ey + L.ember[i * 3 + 1] * 0.16
        const X0 = cx + (jx * cr - jy * sr) * D
        const Y0 = cy + (jx * sr + jy * cr) * D
        const r = 0.5 * D * (1 + L.ember[i * 3 + 2] * 0.14)
        g.moveTo(X0 + r, Y0)
        g.arc(X0, Y0, r, 0, TAU)
      })
      g.fill()
    }
  },
}
