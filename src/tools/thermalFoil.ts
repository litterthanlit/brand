import { boxBlur } from '../lib/blur'
import { byLuminance, hexToRgb } from '../lib/color'
import type { Noise } from '../lib/noise'
import { createRng, type Rng } from '../lib/random'
import { num, pal, str, type CanvasTool } from './types'

const TAU = Math.PI * 2
const LN = 1024 // palette lookup resolution: one full colour cycle
const RN = 2048 // crease profile lookup resolution
const CA = 12 // warp grid cell, in working px: the warp is very smooth, so it is sampled coarsely
const CELL = 12 // detail grid cell in artwork units: only smooth fields are interpolated, |noise| is taken per pixel so creases stay sharp
const SA = 6 // channels per warp-grid point
const SB = 11 // channels per detail-grid point
const STRIP = 1_000_000 // pixels per output strip: bounds the extra memory of a 4× export
const TW = 1024 // grain tile, in grain cells
const TH = 1024
const MAX_PITS = 16
const MAX_SCRATCHES = 28
const MAX_SPECKS = 36

let photo: HTMLCanvasElement | null = null
let photoCache: { bitmap: ImageBitmap; lw: number; lh: number; r: number; data: Float32Array } | null = null
let layoutCache: { key: string; data: Layout } | null = null
let lutCache: { key: string; rgb: Uint8Array; px: Uint32Array } | null = null
let strip: ImageData | null = null
let strip32 = new Uint32Array(0)
// per-frame working buffers, kept between frames so playback doesn't churn the GC
let ga = new Float32Array(0)
let gb = new Float32Array(0)
let rowB = new Float32Array(0)
let rowF = new Float32Array(0)
let hgt = new Float32Array(0)
let eye = new Float32Array(0)
let crs = new Float32Array(0) // crease strength, 0 … 1
let gcx = new Float32Array(0) // analytic slope of the crease cusp, so normals never difference across it
let gcy = new Float32Array(0)
let sdm = new Float32Array(0) // signed distance-ish to the nearest crease, thinning where the crease fades
let fld = new Float32Array(0) // value, glint, eye, crease line: 4 floats per working px
let busy = new Uint8Array(0) // 1 where a working-pixel quad needs the full per-pixel treatment
let tile: Int8Array | null = null
const ridge = new Float32Array(RN + 1)
const dridge = new Float32Array(RN + 1)
const LW0 = 0.0015 // crease line half-width in sdm units, solid → gone
const LW1 = 0.005
const BLEND = 0.12 // width of the smooth max between the two crease families

const grow = (a: Float32Array<ArrayBuffer>, n: number) => (a.length >= n ? a : new Float32Array(n))
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

interface Pit { x: number; y: number; r: number; d: number; ph: number }
/** `runs` is a flat list of y0, y1, alpha: the visible pieces of a broken hairline. */
interface Scratch { x: number; hw: number; tone: number; k: number; ph: number; runs: number[] }
interface Speck { x: number; y: number; r: number; a: number; tone: number }
interface Layout { cross: number; phase: number; pits: Pit[]; scratches: Scratch[]; specks: Speck[] }

/** Everything that doesn't depend on `t`, in artwork units. Always built at full count, so changing a count never reshuffles the rest. */
function layoutFor(w: number, h: number, seed: number, rng: Rng): Layout {
  const key = `${seed}|${w}|${h}`
  if (layoutCache?.key === key) return layoutCache.data
  const m = Math.min(w, h)
  const cross = rng.range(0.35, 0.75) * (rng.chance(0.5) ? 1 : -1) // second crease family leans only a little off the first, so they meet in V pinches
  const phase = rng()
  const pits: Pit[] = []
  for (let i = 0; i < MAX_PITS; i++) {
    pits.push({
      x: rng.range(0.05, 0.95) * w, y: rng.range(0.05, 0.95) * h, r: m * rng.range(0.012, 0.04),
      d: (rng.chance(0.78) ? -1 : 0.55) * rng.range(0.6, 1), ph: rng.range(0, TAU),
    })
  }
  // film damage has its own rng: hairlines and specks never move when the folds are re-rolled
  const sr = createRng(seed ^ 0x51ed270b)
  const scratches: Scratch[] = []
  for (let i = 0; i < MAX_SCRATCHES; i++) {
    const y0 = sr.range(-0.05, 0.75) * h
    const end = Math.min(h, y0 + h * sr.range(0.15, 0.85))
    const runs: number[] = []
    for (let y = y0; y < end; ) {
      const dotted = sr.chance(0.35)
      const len = dotted ? sr.range(1, 4) : sr.range(10, 170) * (m / 1080)
      runs.push(y, Math.min(end, y + len), sr.range(0.3, 0.95))
      y += len + (dotted ? sr.range(3, 16) : sr.range(4, 90)) * (m / 1080)
    }
    scratches.push({ x: sr.range(0.03, 0.97) * w, hw: sr.range(0.3, 0.75), tone: sr(), k: sr.int(1, 3), ph: sr(), runs })
  }
  const specks: Speck[] = []
  for (let i = 0; i < MAX_SPECKS; i++) specks.push({ x: sr.range(0, w), y: sr.range(0, h), r: sr.range(0.6, 2.2), a: sr.range(0.5, 1), tone: sr() })
  const data = { cross, phase, pits, scratches, specks }
  layoutCache = { key, data }
  return data
}

/**
 * The palette as a cyclic ramp: the last stop eases back into the first, so wrapping the bands never shows a seam.
 * Pale, unsaturated stops (lavender, cream, silver) get a narrow share of the cycle, so a light band stays a band;
 * near-black stops get a wider one.
 */
function lutFor(colors: string[]) {
  const key = colors.join()
  if (lutCache?.key === key) return lutCache
  const c = colors.map(hexToRgb)
  const n = c.length
  const wt = c.map(([r, g, b]) => {
    const mx = Math.max(r, g, b)
    const sat = mx ? (mx - Math.min(r, g, b)) / mx : 0
    const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
    return Math.max(0.4, 1 - 1.2 * lum * (1 - sat)) * (lum < 0.1 ? 1.35 : 1) // deep stops get a little extra room: valley shadows give the punch
  })
  const total = wt.reduce((a, v) => a + v, 0)
  const at: number[] = [] // where each stop sits in the cycle
  wt.reduce((a, v, i) => ((at[i] = (a + v / 2) / total), a + v), 0)
  const d = new Uint8Array(LN * 3)
  const px = new Uint32Array(LN)
  for (let i = 0; i < LN; i++) {
    let x = (i + 0.5) / LN
    if (x < at[0]) x += 1 // before the first stop: on the wrap back from the last
    let k = n - 1
    while (k > 0 && at[k] > x) k--
    const x0 = at[k]
    const x1 = k < n - 1 ? at[k + 1] : at[0] + 1
    const e = smoothstep(0.22, 0.78, (x - x0) / (x1 - x0)) // each stop dwells for a while, so bands read as colours with sandy transitions
    const c0 = c[k]
    const c1 = c[(k + 1) % n]
    for (let j = 0; j < 3; j++) d[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * e + 0.5
    px[i] = (255 << 24) | (d[i * 3 + 2] << 16) | (d[i * 3 + 1] << 8) | d[i * 3]
  }
  lutCache = { key, rgb: d, px }
  return lutCache
}

/** A fixed tile of triangular-distributed grain, -127 … 127. Rows are offset per seed when sampled, so it never reads as a repeat. */
function grainTile() {
  if (tile) return tile
  tile = new Int8Array(TW * TH)
  let a = 0x2545f491
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), a | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < tile.length; i++) tile[i] = Math.round((rnd() + rnd() - 1) * 127)
  return tile
}

/** Blurred, normalised luminance of the uploaded image, cover-fitted to the working grid. */
function photoLum(image: ImageBitmap, lw: number, lh: number, r: number) {
  if (photoCache && photoCache.bitmap === image && photoCache.lw === lw && photoCache.lh === lh && photoCache.r === r) return photoCache.data
  photo ??= document.createElement('canvas')
  photo.width = lw
  photo.height = lh
  const pg = photo.getContext('2d', { willReadFrequently: true })!
  pg.fillStyle = '#000'
  pg.fillRect(0, 0, lw, lh)
  const k = Math.max(lw / image.width, lh / image.height)
  pg.drawImage(image, (lw - image.width * k) / 2, (lh - image.height * k) / 2, image.width * k, image.height * k)
  const d = pg.getImageData(0, 0, lw, lh).data
  const lum = new Float32Array(lw * lh)
  for (let i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255
  const data = boxBlur(lum, lw, lh, r)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lo) lo = data[i]
    if (data[i] > hi) hi = data[i]
  }
  const s = 1 / Math.max(0.05, hi - lo)
  const out = new Float32Array(data.length)
  for (let i = 0; i < out.length; i++) out[i] = (data[i] - lo) * s
  photoCache = { bitmap: image, lw, lh, r, data: out }
  return out
}

/** What every stage shares for one frame. "Working" px are the coarse grid, device px (W, H) the canvas. */
interface Frame {
  W: number
  H: number
  lw: number
  lh: number
  u: number // working px per artwork unit
  inv: number // working px → noise units (1 = the short side)
  ds: number // device px per artwork unit
  t: number
  sc: number // fold scale
  folds: number
  warp: number // warp amplitude, in noise units
  aw: number // warp grid size
  ah: number
  cb: number // detail grid cell, in working px (≈ CELL artwork units)
  cw: number // detail grid size
  ch: number
  dx1: number // crease family directions
  dy1: number
  dx2: number
  dy2: number
}

/** Crease profile: a cusp at the fold line, falling off faster the sharper the film. */
function profile(sharpness: number) {
  const k = 1.2 + sharpness * 7
  for (let i = 0; i <= RN; i++) {
    const a = Math.max(0, 1 - i / RN)
    ridge[i] = Math.pow(a, k)
    dridge[i] = -k * Math.pow(a, k - 1) // slope of the profile, per unit |s|
  }
}

/**
 * Warp grid: a slow flow that carries the whole pattern (t walks a circle through noise space, so it loops),
 * plus the two crease masks, which are very smooth and so cheaper here than on the detail grid.
 * ch: 0-1 warp, 2 breathing, 3-4 raw masks.
 */
function warpGrid(f: Frame, noise: Noise) {
  const { aw, ah, inv, sc, warp, t, dx1, dy1, dx2, dy2 } = f
  ga = grow(ga, aw * ah * SA)
  for (let gy = 0; gy < ah; gy++) {
    for (let gx = 0; gx < aw; gx++) {
      const x = gx * CA * inv * sc
      const y = gy * CA * inv * sc
      const o = (gy * aw + gx) * SA
      const wx = noise.loop(x * 1.0 + 2.1, y * 1.0, t, 0.28) + noise.loop(x * 1.7 + 5, y * 1.7 + 1, t, 0.2) * 0.3
      const wy = noise.loop(x * 1.0 + 9.7, y * 1.0 + 4.3, t, 0.28) + noise.loop(x * 1.7 + 12, y * 1.7 + 7, t, 0.2) * 0.3
      ga[o] = wx
      ga[o + 1] = wy
      ga[o + 2] = noise.loop(x * 0.9 + 30, y * 0.9 + 11, t, 0.35) // the whole sheet slowly breathes
      const mx = x + wx * warp * sc
      const my = y + wy * warp * sc
      // masks are long along their family, so a crease keeps its full length and only fades at the ends of a strip
      ga[o + 3] = noise.n2((mx * dx1 + my * dy1) * 0.1 + 40, (-mx * dy1 + my * dx1) * 0.9 + 13)
      ga[o + 4] = noise.n2((mx * dx2 + my * dy2) * 0.12 + 70, (-mx * dy2 + my * dx2) * 0.9 + 31)
    }
  }
}

/**
 * Detail grid, sampled at warped coordinates: static noise carried by the warp reads as liquid.
 * ch: 0 smooth height, 1-2 signed fold noise, 3-4 fold masks, 5-6 warp in working px,
 * 7-10 gradients of the two fold fields.
 */
function detailGrid(f: Frame, noise: Noise, photo: boolean) {
  const { aw, ah, cb, cw, ch, inv, sc, warp, dx1, dy1, dx2, dy2 } = f
  gb = grow(gb, cw * ch * SB)
  const n2 = noise.n2
  for (let gy = 0; gy < ch; gy++) {
    const ay = (gy * cb) / CA
    const ay0 = Math.min(ah - 2, ay | 0)
    const fy = ay - ay0
    for (let gx = 0; gx < cw; gx++) {
      const ax = (gx * cb) / CA
      const ax0 = Math.min(aw - 2, ax | 0)
      const fx = ax - ax0
      const a00 = (ay0 * aw + ax0) * SA
      const a01 = a00 + aw * SA
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const wx = ga[a00] * w00 + ga[a00 + SA] * w10 + ga[a01] * w01 + ga[a01 + SA] * w11
      const wy = ga[a00 + 1] * w00 + ga[a00 + SA + 1] * w10 + ga[a01 + 1] * w01 + ga[a01 + SA + 1] * w11
      const br = ga[a00 + 2] * w00 + ga[a00 + SA + 2] * w10 + ga[a01 + 2] * w01 + ga[a01 + SA + 2] * w11
      const mr1 = ga[a00 + 3] * w00 + ga[a00 + SA + 3] * w10 + ga[a01 + 3] * w01 + ga[a01 + SA + 3] * w11
      const mr2 = ga[a00 + 4] * w00 + ga[a00 + SA + 4] * w10 + ga[a01 + 4] * w01 + ga[a01 + SA + 4] * w11
      const x = (gx * cb * inv + wx * warp) * sc
      const y = (gy * cb * inv + wy * warp) * sc
      // along / across each crease family: long in one direction, tight in the other
      const a1 = x * dx1 + y * dy1
      const c1 = -x * dy1 + y * dx1
      const a2 = x * dx2 + y * dy2
      const c2 = -x * dy2 + y * dx2
      const o = (gy * cw + gx) * SB
      const body = photo ? 0 : 0.5 + 0.5 * (n2(x * 0.75 + 3.1, y * 0.75) * 0.7 + n2(x * 1.8, y * 1.8 + 9) * 0.3) // low-frequency, so colour bands get room to ring
      gb[o] = body * 0.85 + br * 0.12
      gb[o + 1] = n2(a1 * 0.14, c1 * 1.15) * 0.8 + n2(a1 * 0.4 + 7, c1 * 2.5 + 3) * 0.2
      gb[o + 2] = n2(a2 * 0.18 + 20, c2 * 1.3) * 0.8 + n2(a2 * 0.5 + 27, c2 * 2.8 + 11) * 0.2
      gb[o + 3] = 0.3 + 0.7 * smoothstep(-0.4, 0.45, mr1) // never quite flat, so every seed has some creasing
      gb[o + 4] = smoothstep(0.05, 0.7, mr2) * 0.8 // the second family is sparse
      gb[o + 5] = (wx * warp * 0.45) / inv // the photo is pushed around less than the creases, so it stays readable
      gb[o + 6] = (wy * warp * 0.45) / inv
    }
  }
  // gradients of the two fold fields by central differences between grid points: continuous across cells,
  // so the analytic crease normals never jump at a cell border
  for (let gy = 0; gy < ch; gy++) {
    const y0 = Math.max(0, gy - 1)
    const y1 = Math.min(ch - 1, gy + 1)
    for (let gx = 0; gx < cw; gx++) {
      const x0 = Math.max(0, gx - 1)
      const x1 = Math.min(cw - 1, gx + 1)
      const o = (gy * cw + gx) * SB
      for (let c = 0; c < 2; c++) {
        gb[o + 7 + c * 2] = (gb[(gy * cw + x1) * SB + 1 + c] - gb[(gy * cw + x0) * SB + 1 + c]) / ((x1 - x0) * cb)
        gb[o + 8 + c * 2] = (gb[(y1 * cw + gx) * SB + 1 + c] - gb[(y0 * cw + gx) * SB + 1 + c]) / ((y1 - y0) * cb)
      }
    }
  }
}

/**
 * Height field, per working pixel. The detail grid is interpolated a row at a time, then walked along
 * the row with running sums; |s| is taken here so the creases keep their cusp. The cusp's slope is
 * analytic (profile slope × slope of s), so normals and glints never difference across it.
 */
function heightPass(f: Frame, lum: Float32Array | null) {
  const { lw, lh, cb, cw, ch, folds } = f
  const n = lw * lh
  const ib = 1 / cb
  hgt = grow(hgt, n)
  crs = grow(crs, n)
  gcx = grow(gcx, n)
  gcy = grow(gcy, n)
  sdm = grow(sdm, n)
  rowB = grow(rowB, cw * SB)
  busy = busy.length >= n ? busy : new Uint8Array(n)
  busy.fill(0, 0, n)
  for (let y = 0; y < lh; y++) {
    const gy = Math.min(ch - 2, (y * ib) | 0)
    const ty = y * ib - gy
    const r0 = gy * cw * SB
    const r1 = r0 + cw * SB
    for (let j = 0; j < cw * SB; j++) rowB[j] = gb[r0 + j] + (gb[r1 + j] - gb[r0 + j]) * ty
    const yw = y * lw
    for (let gx = 0; gx < cw - 1; gx++) {
      const o = gx * SB
      const x0 = gx * cb
      const hs0 = rowB[o]
      const hs1 = (rowB[o + SB] - hs0) * ib
      const s10 = rowB[o + 1]
      const s11 = (rowB[o + SB + 1] - s10) * ib
      const s20 = rowB[o + 2]
      const s21 = (rowB[o + SB + 2] - s20) * ib
      const m10 = rowB[o + 3]
      const m11 = (rowB[o + SB + 3] - m10) * ib
      const m20 = rowB[o + 4]
      const m21 = (rowB[o + SB + 4] - m20) * ib
      const gx10 = rowB[o + 7]
      const gx11 = (rowB[o + SB + 7] - gx10) * ib
      const gy10 = rowB[o + 8]
      const gy11 = (rowB[o + SB + 8] - gy10) * ib
      const gx20 = rowB[o + 9]
      const gx21 = (rowB[o + SB + 9] - gx20) * ib
      const gy20 = rowB[o + 10]
      const gy21 = (rowB[o + SB + 10] - gy20) * ib
      // the cusp's slope flips sign across the crease: ramp the flip over ~a pixel, so shading is smooth at working resolution
      const ie1 = 1 / (1.2 * (Math.abs(gx10) + Math.abs(gy10)) + 1e-4)
      const ie2 = 1 / (1.2 * (Math.abs(gx20) + Math.abs(gy20)) + 1e-4)
      for (let kx = 0; kx < cb; kx++) {
        const x = x0 + kx
        if (x >= lw) break
        const s1 = s10 + s11 * kx
        const s2 = s20 + s21 * kx
        const e1 = s1 < 0 ? -s1 : s1
        const e2 = s2 < 0 ? -s2 : s2
        const i1 = e1 >= 1 ? RN : (e1 * RN) | 0
        const i2 = e2 >= 1 ? RN : (e2 * RN) | 0
        const mm1 = m10 + m11 * kx
        const mm2 = m20 + m21 * kx
        const cr1 = ridge[i1] * mm1
        const cr2 = ridge[i2] * mm2
        let hs = hs0 + hs1 * kx
        if (lum) {
          // photo: the body is the image's luminance, pushed around by the same warp
          const tx = kx * ib
          const sx = Math.max(0, Math.min(lw - 1.001, x + rowB[o + 5] + (rowB[o + SB + 5] - rowB[o + 5]) * tx))
          const sy = Math.max(0, Math.min(lh - 1.001, y + rowB[o + 6] + (rowB[o + SB + 6] - rowB[o + 6]) * tx))
          const ix = sx | 0
          const iy = sy | 0
          const fx = sx - ix
          const fy = sy - iy
          const i = iy * lw + ix
          hs += (lum[i] * (1 - fx) * (1 - fy) + lum[i + 1] * fx * (1 - fy) + lum[i + lw] * (1 - fx) * fy + lum[i + lw + 1] * fx * fy) * 0.9
        }
        const j = yw + x
        // The families hand over through a smooth max, so there is no ruler-straight seam where one takes over. The
        // cusp slope of each (×2 to match a two-pixel difference) is blended with the same weights.
        const sg1 = s1 * ie1
        const sg2 = s2 * ie2
        const c1 = folds * mm1 * dridge[i1] * 2 * (sg1 < -1 ? -1 : sg1 > 1 ? 1 : sg1)
        const c2 = folds * mm2 * dridge[i2] * 2 * (sg2 < -1 ? -1 : sg2 > 1 ? 1 : sg2)
        const dd = cr1 - cr2
        const w1 = dd < -BLEND ? 0 : dd > BLEND ? 1 : 0.5 + (0.5 * dd) / BLEND
        crs[j] = cr2 + (cr1 - cr2) * w1 + BLEND * w1 * (1 - w1)
        gcx[j] = w1 * c1 * (gx10 + gx11 * kx) + (1 - w1) * c2 * (gx20 + gx21 * kx)
        gcy[j] = w1 * c1 * (gy10 + gy11 * kx) + (1 - w1) * c2 * (gy20 + gy21 * kx)
        // The hairline follows whichever family is stronger, and only where that crease is clearly strong:
        // its thickness is scaled by the gate, so it thins to nothing before the crease fades out.
        if (dd > 0) {
          const t1 = (mm1 - 0.55) * 2.9
          const g1 = t1 < 0 ? 0 : t1 > 1 ? 1 : t1
          sdm[j] = s1 / (g1 * g1 + 0.003)
          if (g1 > 0 && e1 < 1.5 * (Math.abs(gx10 + gx11 * kx) + Math.abs(gy10 + gy11 * kx)) + LW1 * (g1 * g1 + 0.003)) mark(j, lw)
        } else {
          const t2 = (mm2 - 0.55) * 2.9
          const g2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2
          sdm[j] = s2 / (g2 * g2 + 0.003)
          if (g2 > 0 && e2 < 1.5 * (Math.abs(gx20 + gx21 * kx) + Math.abs(gy20 + gy21 * kx)) + LW1 * (g2 * g2 + 0.003)) mark(j, lw)
        }
        hgt[j] = hs + s1 * 0.06 + s2 * 0.03
      }
    }
  }
}

/** Dimples: gaussian wells (a few bumps) that breathe a little. Their cores also feed the dark "eyes". */
function pitPass(f: Frame, pits: Pit[], count: number) {
  const { lw, lh, u, t } = f
  eye = grow(eye, lw * lh)
  eye.fill(0, 0, lw * lh)
  for (let i = 0; i < count; i++) {
    const pit = pits[i]
    const s = pit.r * u * (1 + 0.1 * Math.sin(TAU * t + pit.ph))
    const cx = pit.x * u
    const cy = pit.y * u
    const depth = pit.d * 0.2 * (1 + 0.15 * Math.cos(TAU * t + pit.ph))
    const x0 = Math.max(0, Math.floor(cx - s * 3))
    const x1 = Math.min(lw - 1, Math.ceil(cx + s * 3))
    const y0 = Math.max(0, Math.floor(cy - s * 3))
    const y1 = Math.min(lh - 1, Math.ceil(cy + s * 3))
    const k2 = -0.5 / (s * s)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        const dy = y - cy
        const gs = Math.exp((dx * dx + dy * dy) * k2)
        hgt[y * lw + x] += depth * gs
        if (depth < 0) eye[y * lw + x] += gs * gs * gs
      }
    }
  }
}

/** Light and shade. Slopes are taken in noise units, so the look doesn't depend on the working resolution. */
function shadePass(f: Frame, photo: boolean, lightDeg: number, chrome: number) {
  const { lw, lh, inv, t, folds } = f
  const n = lw * lh
  const lr = (lightDeg * Math.PI) / 180 + Math.sin(TAU * t) * 0.3 // the light sways, so glints glide along the folds
  const el = 0.66
  const lx = Math.cos(lr) * Math.cos(el)
  const ly = Math.sin(lr) * Math.cos(el)
  const lz = Math.sin(el)
  // Mirror directions: the key light and two fills around the sheet, so more creases have a flank that throws a glint.
  const tilt = 0.3 // how far a facet must lean to reflect the light at us
  const sT = Math.sin(tilt)
  const cT = Math.cos(tilt)
  const h1x = Math.cos(lr) * sT
  const h1y = Math.sin(lr) * sT
  const h2x = Math.cos(lr + 2.1) * sT
  const h2y = Math.sin(lr + 2.1) * sT
  const h3x = Math.cos(lr + 4.2) * sT
  const h3y = Math.sin(lr + 4.2) * sT
  const gk = 0.12 / (2 * inv)
  const beta = 0.04 + chrome * 0.1 // how far a facet may stray from the mirror angle and still glint
  const cosB = Math.cos(beta)
  const sk = 1 / (1 - cosB)
  const gain = 0.4 + chrome * 1.2
  // flatter than this can't reach the mirror angle: skip the specular maths (the mirror reads a quarter of the slope)
  const gmin = Math.tan(Math.max(0, tilt - beta)) / 0.25
  const gmin2 = gmin * gmin
  fld = grow(fld, n * 4)
  for (let y = 0; y < lh; y++) {
    const up = y > 0 ? -lw : 0
    const dn = y < lh - 1 ? lw : 0
    for (let x = 0; x < lw; x++) {
      const i = y * lw + x
      const gx = (hgt[i + (x < lw - 1 ? 1 : 0)] - hgt[i - (x > 0 ? 1 : 0)] + gcx[i]) * gk
      const gy = (hgt[i + dn] - hgt[i + up] + gcy[i]) * gk
      const g2 = gx * gx + gy * gy
      const diff = (-gx * lx - gy * ly + lz) / Math.sqrt(g2 + 1)
      let gl = 0
      if (g2 > gmin2) {
        // the mirror reads a flatter surface than the diffuse term: the glint then sits right on the cusp, not out on the flank
        const sx = gx * 0.25
        const sy = gy * 0.25
        const is = 1 / Math.sqrt(sx * sx + sy * sy + 1)
        const sp = Math.max(
          lobe((-sx * h1x - sy * h1y + cT) * is, cosB, sk),
          lobe((-sx * h2x - sy * h2y + cT) * is, cosB, sk) * 0.8,
          lobe((-sx * h3x - sy * h3y + cT) * is, cosB, sk) * 0.8,
        )
        // glints live on the creases: the mirror angle picks the flank, the crease strength keeps them thin
        gl = sp * sp * gain * (photo ? 1 : smoothstep(0.1, 0.4, crs[i]))
      }
      const e = eye[i] > 1 ? 1 : eye[i]
      const o = i * 4
      fld[o] = (hgt[i] + folds * crs[i]) * 0.5 + (diff > 0 ? diff : 0) * 0.55
      fld[o + 1] = gl
      fld[o + 2] = e
      fld[o + 3] = sdm[i]
      // the paint pass only does the expensive per-pixel work near a glint, an eye or a crease line
      if (gl > 0.01 || e > 0.02) mark(i, lw)
    }
  }
}

/** How strongly a facet whose normal·mirror-direction is `ndh` reflects the light: 0 beyond the tolerance, 1 dead on. */
const lobe = (ndh: number, cosB: number, sk: number) => (ndh > cosB ? (ndh - cosB) * sk : 0)

/** Flag a working pixel as busy, and every 2×2 quad (identified by its top-left corner) that it is a corner of. */
function mark(i: number, lw: number) {
  busy[i] = 1
  if (i % lw > 0) busy[i - 1] = 1
  if (i >= lw) {
    busy[i - lw] = 1
    if (i % lw > 0) busy[i - lw - 1] = 1
  }
}

interface Look {
  bands: number
  phase: number
  grain: number // band dither, in cycles
  seed: number
  lut: { rgb: Uint8Array; px: Uint32Array }
  glint: number[]
  rim: number[]
  dark: number[]
}

/** Final pass at device resolution, in strips. The dither goes in before the banding, which is what makes band edges sandy. */
function paintPass(g: CanvasRenderingContext2D, f: Frame, look: Look) {
  const { W, H, lw, lh, ds } = f
  const { bands, phase, lut: { rgb: lut, px: lutPx }, glint: [hr, hg, hb], rim: [rr, rg, rb], dark: [er, eg, eb] } = look
  const cell = Math.max(1, Math.round(ds * 1.15)) // grain cell ≈ 1 artwork unit, never finer than a device pixel
  // A device pixel that covers several cells shows their average, whose spread shrinks by the number across: small previews look like the export, shrunk.
  const avg = Math.max(0.4, Math.min(1, ds * 1.15))
  const grain = (look.grain * avg) / 127 // the tile holds -127 … 127
  const noise = grainTile()
  const rows = Math.max(8, Math.floor(STRIP / W))
  if (!strip || strip.width !== W || strip.height < Math.min(rows, H)) {
    strip = new ImageData(W, Math.min(rows, H))
    strip32 = new Uint32Array(strip.data.buffer)
  }
  const out = strip32
  rowF = grow(rowF, lw)
  // per-column tables: working column, its fraction, and the grain cell; per-tile-row offsets decorrelate the rows
  const xi = new Int32Array(W)
  const xt = new Float32Array(W)
  const xc = new Int32Array(W)
  for (let X = 0; X < W; X++) {
    const fx = Math.max(0, Math.min(lw - 1.001, (X + 0.5) * (lw / W) - 0.5))
    xi[X] = fx | 0
    xt[X] = fx - (fx | 0)
    xc[X] = (X / cell) | 0
  }
  const rowOff = new Int32Array(TH)
  for (let j = 0; j < TH; j++) {
    let hs = Math.imul(j + 1, 374761393) + Math.imul(look.seed, 668265263)
    hs = Math.imul(hs ^ (hs >>> 13), 1274126177)
    rowOff[j] = (hs ^ (hs >>> 16)) & (TW - 1)
  }
  for (let Y0 = 0; Y0 < H; Y0 += rows) {
    const nr = Math.min(rows, H - Y0)
    for (let yy = 0; yy < nr; yy++) {
      const Y = Y0 + yy
      const fy = Math.max(0, Math.min(lh - 1.001, (Y + 0.5) * (lh / H) - 0.5))
      const iy = fy | 0
      const ty = fy - iy
      const r0 = iy * lw
      const r1 = r0 + lw
      for (let j = 0; j < lw; j++) rowF[j] = fld[j * 4 + r0 * 4] + (fld[j * 4 + r1 * 4] - fld[j * 4 + r0 * 4]) * ty
      const yc = ((Y / cell) | 0) & (TH - 1)
      const tr = yc * TW
      const to = rowOff[yc]
      let k = yy * W
      for (let X = 0; X < W; X++, k++) {
        const ix = xi[X]
        const tx = xt[X]
        const dn = noise[tr + ((xc[X] + to) & (TW - 1))]
        let v = (rowF[ix] + (rowF[ix + 1] - rowF[ix]) * tx) * bands + phase + dn * grain
        v -= Math.floor(v)
        const li = (v * LN) | 0
        if (busy[r0 + ix] === 0) {
          out[k] = lutPx[li]
          continue
        }
        // near a glint, an eye or a crease line: bilinear sample of everything at this pixel
        const a = (r0 + ix) * 4
        const c = a + lw * 4
        const w00 = (1 - tx) * (1 - ty)
        const w10 = tx * (1 - ty)
        const w01 = (1 - tx) * ty
        const w11 = tx * ty
        const sp = fld[a + 1] * w00 + fld[a + 5] * w10 + fld[c + 1] * w01 + fld[c + 5] * w11
        const ey = fld[a + 2] * w00 + fld[a + 6] * w10 + fld[c + 2] * w01 + fld[c + 6] * w11
        const cs = fld[a + 3] * w00 + fld[a + 7] * w10 + fld[c + 3] * w01 + fld[c + 7] * w11
        const d2 = noise[tr + ((xc[X] + to + 311) & (TW - 1))] * (avg / 254) // a second, unrelated grain value, ±0.5
        let r = lut[li * 3]
        let gg = lut[li * 3 + 1]
        let b = lut[li * 3 + 2]
        if (ey > 0.02) {
          const e = smoothstep(0.3, 0.62, ey + d2 * 0.5) * 0.92
          r += (er - r) * e
          gg += (eg - gg) * e
          b += (eb - b) * e
        }
        const ac = cs < 0 ? -cs : cs
        if (ac < LW1) {
          // the crease itself: a thin dark line down the cusp, found at device resolution
          const cl = (1 - smoothstep(LW0, LW1, ac)) * 0.5
          r += (rr - r) * cl
          gg += (rg - gg) * cl
          b += (rb - b) * cl
        }
        if (sp > 0.01) {
          // glint: a faint dark rim at its outer edge, a pale halo, then the icy core
          const s = sp + d2 * 0.06
          const ra = smoothstep(0.01, 0.04, s) * (1 - smoothstep(0.05, 0.12, s)) * 0.85
          r += (rr - r) * ra
          gg += (rg - gg) * ra
          b += (rb - b) * ra
          const ha = Math.max(smoothstep(0.08, 0.3, s) * 0.3, smoothstep(0.25, 0.55, s))
          r += (hr - r) * ha
          gg += (hg - gg) * ha
          b += (hb - b) * ha
        }
        out[k] = (255 << 24) | (((b + 0.5) | 0) << 16) | (((gg + 0.5) | 0) << 8) | ((r + 0.5) | 0)
      }
    }
    g.putImageData(strip, 0, Y0, 0, 0, W, nr)
  }
}

/** Film damage, drawn as vectors in artwork units so it stays crisp at any export size: broken hairline scratches and a few specks. */
function filmDamage(g: CanvasRenderingContext2D, f: Frame, L: Layout, amount: number, look: Look, accent: number[]) {
  const { t, ds } = f
  const [hr, hg, hb] = look.glint
  const [rr, rg, rb] = look.rim
  const lut = look.lut.rgb
  const pale = `rgb(${hr},${hg},${hb})`
  const lavender = `rgb(${(hr + accent[0]) >> 1},${(hg + accent[1]) >> 1},${(hb + accent[2]) >> 1})`
  const mid = `rgb(${lut[(LN / 2) * 3]},${lut[(LN / 2) * 3 + 1]},${lut[(LN / 2) * 3 + 2]})`
  g.save()
  const nScratch = Math.round(amount * MAX_SCRATCHES)
  for (let i = 0; i < nScratch; i++) {
    const s = L.scratches[i]
    g.fillStyle = s.tone < 0.55 ? pale : lavender
    const flicker = 0.7 + 0.3 * Math.cos(TAU * (s.k * t + s.ph)) // whole cycles per loop
    const hw = Math.max(s.hw, 0.55 / ds) // never thinner than a device pixel, or the preview loses them
    for (let j = 0; j < s.runs.length; j += 3) {
      g.globalAlpha = s.runs[j + 2] * flicker
      g.fillRect(s.x - hw, s.runs[j], hw * 2, s.runs[j + 1] - s.runs[j])
    }
  }
  const nSpecks = Math.round(amount * MAX_SPECKS)
  for (let i = 0; i < nSpecks; i++) {
    const s = L.specks[i]
    g.globalAlpha = s.a * (0.75 + 0.25 * Math.cos(TAU * (t + s.tone * 7)))
    g.fillStyle = s.tone < 0.45 ? pale : s.tone < 0.75 ? mid : `rgb(${rr},${rg},${rb})`
    g.beginPath()
    g.arc(s.x, s.y, s.r, 0, TAU)
    g.fill()
  }
  g.restore()
}

/**
 * Thermal foil. A height field of crumpled film (a domain-warped body, two families of
 * long creases cut with a ridge profile, a handful of dimples) is lit for diffuse and
 * specular, then read through a cyclic false-colour ramp: the value wraps through
 * several colour bands, so every bump grows rings. The coarse fields run on a small
 * working grid; the banding itself happens per device pixel, after a hash dither is
 * added to the value, which is what makes the band edges sandy. Glints, a dark rim and
 * the film scratches are laid on last, in artwork units, so exports stay crisp.
 */
export const thermalFoil: CanvasTool = {
  id: 'thermal-foil',
  name: 'Thermal Foil',
  category: 'Texture',
  description: 'Crumpled liquid foil read through a false-colour heat map: banded rings, icy glints, sandy grain, film scratches.',
  kind: 'canvas',
  raw: true,
  animated: true,
  duration: 9,
  motionScale: 0.7,
  params: [
    { type: 'image', key: 'image', label: 'Photo (optional)', default: null, onSet: { source: 'image' } },
    {
      type: 'select', key: 'source', label: 'Source', default: 'foil',
      options: [{ value: 'foil', label: 'Foil' }, { value: 'image', label: 'Photo' }],
    },
    { type: 'palette', key: 'palette', label: 'Bands (cyclic colour ramp)', default: ['#07030F', '#14231B', '#7C8A1C', '#F6A21E', '#5B2BFF', '#BCB2FF', '#1C1580'], min: 3, max: 7 },
    { type: 'color', key: 'highlight', label: 'Glint', default: '#E4F4FF' },
    { type: 'color', key: 'rim', label: 'Rim', default: '#1C0A44' },
    { type: 'number', key: 'scale', label: 'Fold scale', min: 0.5, max: 2, step: 0.01, default: 1, rand: [0.8, 1.5] },
    { type: 'number', key: 'folds', label: 'Creases', min: 0, max: 1.5, step: 0.01, default: 1.1, rand: [0.7, 1.3] },
    { type: 'number', key: 'sharpness', label: 'Sharpness', min: 0, max: 1, step: 0.01, default: 0.6, rand: [0.35, 0.85] },
    { type: 'number', key: 'angle', label: 'Crease angle', min: -90, max: 90, step: 1, default: -68, unit: '°', rand: [-85, 85] },
    { type: 'number', key: 'warp', label: 'Warp', min: 0, max: 1, step: 0.01, default: 0.4, rand: [0.2, 0.7] },
    { type: 'number', key: 'pits', label: 'Dimples', min: 0, max: 16, step: 1, default: 5, rand: [2, 9], when: (p) => p.source !== 'image' },
    { type: 'number', key: 'bands', label: 'Bands', min: 1, max: 8, step: 0.1, default: 3, rand: [1.8, 4.2] },
    { type: 'number', key: 'chrome', label: 'Chrome', min: 0, max: 1, step: 0.01, default: 0.6, rand: [0.35, 0.9] },
    { type: 'number', key: 'light', label: 'Light', min: 0, max: 360, step: 1, default: 215, unit: '°', rand: [0, 360] },
    { type: 'number', key: 'dither', label: 'Band grain', min: 0, max: 1, step: 0.01, default: 0.45, rand: [0.25, 0.7] },
    { type: 'number', key: 'scratches', label: 'Scratches', min: 0, max: 1, step: 0.01, default: 0.5, rand: [0.2, 0.8] },
  ],
  defaults: { format: 'portrait', finish: { grain: 0.12, grainType: 'soft' } },
  presets: [
    { name: 'Solar', format: 'portrait', seed: 7 },
    {
      name: 'Infrared', format: 'portrait', seed: 12,
      params: {
        palette: ['#05000D', '#2B0B73', '#B0137A', '#F25A1C', '#FFD43B', '#FFF4D2'], highlight: '#FFFFFF', rim: '#240A52',
        bands: 2.6, chrome: 0.5, dither: 0.45, folds: 0.75, warp: 0.65,
      },
      finish: { grain: 0.18, grainType: 'soft' },
    },
    {
      name: 'Acid', format: 'portrait', seed: 21,
      params: {
        palette: ['#050505', '#0B5A22', '#C6FF1A', '#FF29C4'], highlight: '#F4FFD6', rim: '#2B003A',
        bands: 3.8, chrome: 0.7, dither: 0.7, angle: -48, scratches: 0.6,
      },
      finish: { grain: 0.22, grainType: 'speckle' },
    },
    {
      name: 'Chrome', format: 'portrait', seed: 5,
      params: {
        palette: ['#0A0B0D', '#3F444C', '#9AA1AA', '#E9ECEF', '#FF4A1C'], highlight: '#FFFFFF', rim: '#0A0B0D',
        bands: 2.2, chrome: 0.95, dither: 0.35, folds: 1.1, sharpness: 0.75, warp: 0.45, scratches: 0.7,
      },
      finish: { grain: 0.1, grainType: 'soft' },
    },
    {
      name: 'Afterimage', format: 'story', seed: 31,
      params: {
        palette: ['#08031C', '#2B1580', '#7A3CFF', '#27B5FF', '#DDF3FF'], highlight: '#FFFFFF', rim: '#12063A',
        bands: 2.8, angle: -74, scale: 1.2, dither: 0.6,
      },
      finish: { grain: 0.16, grainType: 'soft' },
      type: { enabled: true, layout: 'bl', title: 'After image', body: '', label: '', caption: 'THERMAL FOIL ■ STUDY 04', color: '#F1ECFF', size: 4.2, measure: 0.8, margin: 0.06 },
    },
  ],
  draw({ g, w, h, p, rng, noise, t, seed }) {
    const W = g.canvas.width
    const H = g.canvas.height
    // The coarse fields live on a smaller working grid; the banding is per device pixel, so it stays crisp.
    // Big outputs (static 2×, exports) get a finer grid so the thinnest glints and rims stay clean.
    const q = Math.min(0.75, (Math.max(W, H) > 1500 ? 1400 : 720) / Math.max(W, H))
    const lw = Math.max(32, Math.round(W * q))
    const lh = Math.max(32, Math.round(H * q))
    const u = lw / w
    const m = Math.min(w, h)
    const cb = Math.max(4, Math.min(10, Math.round(CELL * u)))
    const L = layoutFor(w, h, seed, rng)
    const image = p.image as ImageBitmap | null
    const lum = str(p, 'source') === 'image' && image ? photoLum(image, lw, lh, Math.max(2, Math.round(u * m * 0.008))) : null
    const theta = (num(p, 'angle') * Math.PI) / 180
    const th2 = theta + L.cross
    const f: Frame = {
      W, H, lw, lh, u, inv: 1 / (m * u), ds: W / w, t,
      sc: num(p, 'scale'), folds: num(p, 'folds') * (lum ? 0.6 : 1), warp: num(p, 'warp') * 0.3,
      aw: Math.ceil(lw / CA) + 1, ah: Math.ceil(lh / CA) + 1, cb, cw: Math.ceil(lw / cb) + 1, ch: Math.ceil(lh / cb) + 1,
      dx1: Math.cos(theta), dy1: Math.sin(theta), dx2: Math.cos(th2), dy2: Math.sin(th2),
    }

    profile(num(p, 'sharpness'))
    warpGrid(f, noise)
    detailGrid(f, noise, !!lum)
    heightPass(f, lum)
    pitPass(f, L.pits, lum ? 0 : Math.round(num(p, 'pits')))
    shadePass(f, !!lum, num(p, 'light'), num(p, 'chrome'))

    const colors = pal(p, 'palette')
    const look: Look = {
      bands: num(p, 'bands'),
      phase: L.phase + t, // whole cycles per loop: the bands crawl across the folds and meet themselves at t = 1
      grain: num(p, 'dither') * 0.3,
      seed,
      lut: lutFor(colors),
      glint: hexToRgb(str(p, 'highlight')),
      rim: hexToRgb(str(p, 'rim')),
      dark: hexToRgb(byLuminance(colors)[0]),
    }
    paintPass(g, f, look)
    filmDamage(g, f, L, num(p, 'scratches'), look, hexToRgb(colors[colors.length - 1]))
  },
}
