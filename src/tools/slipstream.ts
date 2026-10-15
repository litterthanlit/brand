import { boxBlur } from '../lib/blur'
import { hexToRgb, luminance } from '../lib/color'
import type { Noise } from '../lib/noise'
import { createRng, type Rng } from '../lib/random'
import { bool, num, pal, str, type CanvasTool, type ParamValues } from './types'

const TAU = Math.PI * 2
const NV = 384 // band lookup: nodes across the fan (v)…
const NA = 128 // …and along it (fewer bakes a dense wedge into visible facets)
const VM = 1.6 // v runs ±VM; the fan itself is |v| ≤ 1
const A0 = -1.25 // along runs A0…A1 in diagonals: the tail side…
const A1 = 1.65 // …and the front
const DV = (2 * VM) / (NV - 1)
const DA = (A1 - A0) / (NA - 1)
const SH = NA / 2 // table margin that the flow slides the texture through (the shift is up to ~0.9 / DA nodes)
const AX = NA + 2 * SH
const CV = 32 // domain-warp grid
const CA = 14
const BC = 8 // bloom grid: one cell per BC work px
const GT = 256 // film grain tile

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

interface Band {
  /** 0 wash, 1 shadow, 2 specular, 3 light sheet, 4 ember trail, 5 afterglow, 6 haze (a tint that fills one side out to the frame) */
  k: number
  v: number // centre across the fan
  w: number // width (sigma, in v)
  amp: number
  tone: number // wash: 0 deep → 1 signal
  a0: number // where it starts along the flow, in diagonals
  rise: number
  len: number // far fade
  tail: number // reach behind the focus, scaled by the tail param
  ta: number // share of its strength that carries behind the focus
  ph: number
  sw: number // sideways sway, in v
  dir: number // haze: which side it fills; for a shadow, 1 = it can be pinned to the ember
  pv: number // the across-position it takes when pinned
  brk: Float32Array // low-frequency break-up along its length
}

interface Layout {
  bands: Band[]
  sv: Float32Array[] // striations across the fan (static)
  sa: Float32Array[] // how they come and go along it (flows)
}

/** Everything a frame needs from the params, resolved once. */
interface Look {
  fx: number
  fy: number
  dir: number
  spread: number
  bend: number
  curl: number
  tailW: number
  pin: number
  skew: number
  emberOn: boolean
  sweep: boolean
  sheet: number
  rim: number
  shade: number
  specLen: number
  r0: number
  reach: number
  tailAmt: number
  trail: number
  trailLen: number
  soft: number
  focus: number
  minSpec: number
  warp: number
  drift: number
  shift: number // flow, in lookup nodes per loop
  pm: number // 1 = print on a light ground, 0 = light in the dark
  dens: number
  haze: number
  film: number
  emberAt: number
  emberV: number
  emberR: number
  emberLen: number
  hot: number
  bloom: number
  /** ground, shadow, deep, signal, light, ember as 0…1 rgb */
  c: Float32Array
}

const layouts = new Map<string, Layout>()
const LW = new Float32Array(NA * NV * 8) // band weights: deep, signal, shadow, light, trail, glow, haze
const LC = new Float32Array(NA * NV * 3) // composited colour
const LE = new Float32Array(NA * NV * 3) // emitted light (what blooms)
const LK = new Float32Array(NA * NV) // shadow density, so the ember can be darkened and hidden by a wedge
const warp = new Float32Array(CV * CA)
const wrow = new Float32Array(NV)
const win = new Float32Array(NV) // the fan's edge: bands fade out toward ±VM
const vcI = new Uint8Array(NV)
const vcF = new Float32Array(NV)
for (let i = 0; i < NV; i++) {
  const v = -VM + i * DV
  win[i] = 1 - smooth(VM - 0.45, VM, Math.abs(v))
  const f = (i / (NV - 1)) * (CV - 1)
  vcI[i] = Math.min(CV - 2, f | 0)
  vcF[i] = f - vcI[i]
}
let work: HTMLCanvasElement | null = null
let glow: HTMLCanvasElement[] = []
let img: ImageData | null = null
let gimg: ImageData | null = null
let bl: Float32Array[] = [] // coarse bloom grid: emitted r, g, b and the ember's body
let grain: Float32Array | null = null
const paperTiles: HTMLCanvasElement[] = []
let sheet: HTMLCanvasElement | null = null // paper tooth + uneven light, rendered once per size
let sheetKey = ''
let cap = 700 // work-buffer cap while the preview plays; it eases down on a slow machine, back up when there's room
let ema = 0
let frames = 0

/** Seeded 1-D noise along a streak, long enough to slide by the flow shift on either side. */
function table(noise: Noise, f: number, off: number) {
  const a = new Float32Array(AX)
  for (let j = 0; j < AX; j++) a[j] = noise.n2((j - SH) * DA * f + off, off * 0.37 + 11.3)
  return a
}

/** A table at a fractional node, slid by `sh` nodes. */
function slide(tb: Float32Array, j: number, sh: number) {
  const x = j + SH - sh
  const i = x | 0
  return tb[i] + (tb[i + 1] - tb[i]) * (x - i)
}

/** The band profile across the fan: washes, a shadow wedge, thin speculars, a sheet of light, the ember trail and its afterglow. */
function build(count: number, mirror: boolean, rng: Rng, noise: Noise, seed: number): Layout {
  const sg = mirror ? -1 : 1
  const bands: Band[] = []
  const add = (o: Partial<Band> & Pick<Band, 'k' | 'v' | 'w' | 'amp'>) =>
    bands.push({
      tone: 0.5, a0: 0, rise: 0.08, len: 1.5, tail: 0.6, ta: 0.5, ph: rng() * TAU, sw: 0.05, dir: 0, pv: 0,
      brk: table(noise, 1.2 + rng() * 1.2, bands.length * 7.7 + (seed % 97)), ...o,
    })
  const nSp = Math.max(1, Math.round(count * 0.3))
  const nSh = Math.max(1, Math.round(count * 0.14))
  const nW = Math.max(1, count - nSp - nSh)
  const side = rng.chance(0.5) ? 1 : -1 // which side the shadow falls on

  // colour sits on one side of the axis (up, unmirrored), light on the other, the shadow between
  add({ k: 6, v: sg * -1.0, w: 0.55, amp: 0.28, tone: 0.75, rise: 0.05, len: 3, sw: 0.02, ta: 0.8, tail: 1.2, dir: sg })
  const whole = new Float32Array(AX).fill(1)
  add({ k: 0, v: sg * rng.range(-0.55, -0.35), w: rng.range(0.45, 0.6), amp: rng.range(0.7, 0.9), tone: 0.62, rise: 0.04, len: 3, sw: 0.03, ta: 0.12, tail: 0.6, brk: whole })
  add({ k: 0, v: sg * rng.range(0.05, 0.25), w: rng.range(0.35, 0.5), amp: 1, tone: 0.8, rise: 0.05, len: 3, sw: 0.04, ta: 0.1, tail: 0.5, brk: whole })
  for (let i = 0; i < nW; i++) {
    const vs = -1.1 + (1.6 * (i + 0.5 + rng.range(-0.4, 0.4))) / nW
    add({
      k: 0, v: sg * vs, w: rng.range(0.07, 0.2), amp: rng.range(0.55, 1), tone: clamp01(1 + 0.7 * vs + rng.range(-0.15, 0.15)),
      a0: rng.range(0, 0.02), rise: rng.range(0.02, 0.08), len: rng.range(1.6, 2.6), tail: rng.range(0.4, 0.8), ta: 0.1, sw: rng.range(0.04, 0.09),
    })
  }
  for (let i = 0; i < nSh; i++) {
    // the first wedge hangs near the axis (and can be pinned to the ember); a second one enters from the far side, on the light's side
    const v = rng.range(0.08, 0.5)
    const w = rng.range(0.13, 0.28)
    const amp = rng.range(0.85, 1)
    const a0 = rng.range(0, 0.02)
    const rise = rng.range(0.03, 0.1)
    const len = rng.range(0.4, 1.3)
    add({
      k: 1, v: i ? sg * (0.1 + v * 0.7) : sg * side * v, pv: sg * -0.2, w: w * (i ? 1.8 : 1), amp,
      a0: i ? 0.4 + a0 * 10 : a0, rise: i ? rise * 3 : rise, len: i ? 2 : len, tail: 0.25, ta: 0.6, sw: 0.03, dir: i ? 0 : 1,
    })
  }
  const hosts = bands.slice(3)
  // a dark rim on the colour side, like ref 3's black arc. Some seeds have it; the Dark rim param adds it (as a fill out to the frame) to the rest
  const rimOn = rng.chance(0.4)
  const rim = { k: 1, v: sg * -1.02, w: 0.3, amp: 0.9, a0: 0, rise: 0.05, len: 2.4, tail: 0.5, ta: 0.7, sw: 0.02, dir: 3, pv: rimOn ? 1 : 0, tone: sg }
  if (rimOn) add({ ...rim, w: rng.range(0.2, 0.38), amp: rng.range(0.7, 1) })
  else bands.push({ ...rim, ph: 0, brk: new Float32Array(AX).fill(1) })
  for (let i = 0; i < nSp; i++) {
    const host = hosts[rng.int(0, hosts.length - 1)]
    const v = host.v + (rng.chance(0.5) ? -1 : 1) * host.w * rng.range(1, 1.7)
    add({
      k: 2, v: Math.max(-1.1, Math.min(1.1, v)), w: rng.range(0.011, 0.03), amp: i ? rng.range(0.55, 1) : 1,
      rise: rng.range(0.04, 0.12), len: i ? rng.range(0.9, 1.9) : 2.2, tail: i ? rng.range(0.1, 0.3) : 0, ta: 0.5, sw: 0.025,
    })
  }
  const lead = bands.find((b) => b.k === 2)!
  add({ k: 3, v: sg * rng.range(0.55, 0.95), w: rng.range(0.25, 0.4), amp: rng.range(0.35, 0.55), rise: 0.14, len: 2.2, tail: 1, ta: 0.9, sw: 0.02 })
  const sheet = bands[bands.length - 1]
  // in a sweep the lead specular and the ember trail ride the outer edge of the light sheet, like ref 2's single streak
  lead.dir = 2
  lead.pv = sheet.v + (sheet.v < 0 ? -1 : 1) * sheet.w * 0.35
  add({ k: 5, v: sg * rng.range(0.05, 0.25), w: 0.3, amp: 0.9, rise: 0.1, len: 0.25, tail: 1, ta: 1, sw: 0.02 })
  add({ k: 4, v: lead.v + (lead.v < 0 ? -1 : 1) * 0.04, pv: lead.pv + (lead.pv < 0 ? -1 : 1) * 0.07, dir: 2, w: 0.014, amp: 1.3, tail: 1, ta: 1, sw: lead.sw, ph: lead.ph })

  return {
    bands,
    sv: [0, 1].map((i) => {
      const a = new Float32Array(NV)
      for (let j = 0; j < NV; j++) a[j] = noise.n2((-VM + j * DV) * (6 + i * 8) + i * 31, 5.5 + i * 7 + (seed % 53))
      return a
    }),
    sa: [table(noise, 1.6, 55 + (seed % 31)), table(noise, 3.1, 77 + (seed % 29))],
  }
}

function layoutFor(seed: number, count: number, mirror: boolean, rng: Rng, noise: Noise) {
  const key = `${seed}|${count}|${mirror}`
  let L = layouts.get(key)
  if (!L) {
    if (layouts.size >= 6) layouts.delete(layouts.keys().next().value as string)
    L = build(count, mirror, rng, noise, seed)
    layouts.set(key, L)
  }
  return L
}

/** How far along the flow a wedge pinned to the ember runs, in diagonals. */
const pinLen = (b: Band) => 0.22 + 0.2 * clamp01((b.len - 0.4) / 0.9)

/** A band's strength at distance `a` along the flow (in diagonals): it starts near the focus, swells, thins with distance and breaks up. */
function env(b: Band, a: number, m: number, k: Look) {
  if (b.k === 6) return a >= 0 ? 1 : 1 - 0.4 * smooth(0, 1.2, -a)
  if (a >= 0) {
    if (b.k === 4) {
      if (!k.sweep) return 0
      const q = 1 - smooth(0, k.trailLen * 1.4, a)
      return q * q * smooth(0, 0.05, a) * m * k.trail
    }
    if (b.k === 5) return 1 - smooth(0, b.len, a) // the afterglow is the ember's: it doesn't follow the streaks
    if (b.k === 1 && b.dir === 1 && k.pin > 0) {
      // pinned to the ember: a lens that swells just off the focus and is gone well inside the frame.
      // It fades over several lookup nodes along the flow; a shorter fade bakes into a stepped, ragged tip.
      const len = pinLen(b)
      return smooth(b.a0, b.a0 + b.rise, a) * (1 - smooth(len * 0.5, len * 1.25, a)) * k.pin + (1 - k.pin) * smooth(b.a0, b.a0 + b.rise, a) * (1 - 0.45 * smooth(b.len * 0.3, b.len, a)) * m
    }
    if (b.k === 2) return smooth(b.a0, b.a0 + b.rise, a) * (1 - smooth(b.len * k.specLen * 0.3, b.len * k.specLen, a)) * m
    return smooth(b.a0, b.a0 + b.rise, a) * (1 - 0.45 * smooth(b.len * 0.3, b.len, a)) * m
  }
  if (b.k === 4 && k.sweep) return 0
  const reach = b.k === 4 ? k.trailLen : b.tail * k.reach
  if (reach < 0.01) return 0
  const q = 1 - smooth(0, reach, -a)
  const e = q * q * smooth(0, 0.05, -a) * m
  return b.k === 4 ? e * k.trail : e * b.ta * k.tailAmt * (b.k === 1 && b.dir === 1 ? 1 - k.pin : 1)
}

/**
 * Bake the bands into two 2-D lookups over (along, v): composited colour and emitted light. The
 * domain warp and the striations live here too, so a pixel only does geometry and one bilinear read.
 * Print (light ground) deepens like dye on paper and lets lights overexpose to white; light (dark ground) adds.
 */
function bake(L: Layout, k: Look, noise: Noise, t: number) {
  const { bands, sv, sa } = L
  const [G, S, D, N, Li, E] = [0, 3, 6, 9, 12, 15].map((o) => k.c.subarray(o, o + 3))
  const WM = k.warp * 1.3
  LW.fill(0)
  if (k.warp > 0) for (let j = 0; j < CA; j++) for (let i = 0; i < CV; i++) warp[j * CV + i] = k.warp * noise.loop(i * 0.24 + 3.1, j * 0.26 + 7.7, t, 0.35)
  const dense = k.pm > 0.001
  const lit = k.pm < 0.999

  for (let aj = 0; aj < NA; aj++) {
    const a = A0 + aj * DA
    const sg = a / Math.sqrt(a * a + 0.0036) // the flow leaves the focus both ways
    const s1 = k.shift * sg * t
    const s2 = k.shift * sg * (t - 1) // a second layer one loop behind: frame 0 and frame 1 are the same for any flow
    if (k.warp > 0) {
      const fa = (aj / (NA - 1)) * (CA - 1)
      const r = Math.min(CA - 2, fa | 0)
      const rf = fa - r
      for (let i = 0; i < NV; i++) {
        const c = vcI[i]
        const f = vcF[i]
        const o = r * CV + c
        wrow[i] = (warp[o] * (1 - f) + warp[o + 1] * f) * (1 - rf) + (warp[o + CV] * (1 - f) + warp[o + CV + 1] * f) * rf
      }
    }
    const o0 = aj * NV * 8
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi]
      const n = slide(b.brk, aj, s1) * (1 - t) + slide(b.brk, aj, s2) * t
      const e = env(b, a, b.k === 1 && b.dir === 1 && k.pin > 0 ? 1 : 0.45 + 0.55 * smooth(-0.8, 0.45, n), k)
      let amp = b.amp * e
      const rimBand = b.dir === 3
      if (rimBand) {
        if (k.rim > 0) amp *= Math.max(k.rim, b.pv)
        else if (!b.pv) continue
      }
      if (amp < 0.003) continue
      const pinned = b.k === 1 && b.dir === 1 && k.pin > 0 // a wedge pinned to the ember: nearer the axis, thick at the ember and thinning away
      let c = pinned ? b.v + (b.pv - b.v) * k.pin : b.dir === 2 && k.sweep ? b.pv : rimBand && k.rim > 0 ? b.v + b.tone * (0.17 + 0.2 * k.rim) : b.v
      if (b.sw) c += k.drift * b.sw * 1.8 * Math.sin(TAU * t + b.ph - a * 2.6)
      if (b.k === 6) amp *= k.haze
      if (b.k === 3) amp *= k.sheet * (0.45 + 0.55 * k.pm) // the broad sheet of light stays quiet in the dark
      if (b.k === 2 && b.dir !== 2 && k.sweep) amp *= 0.35
      if (b.k === 2 || b.k === 4) amp *= 1 + 0.14 * Math.sin(TAU * 2 * t + b.ph * 1.7 + a * 8)
      // a pinned wedge is a flat lens: its width swells off the focus and closes again at its far end
      const lens = pinned ? 1 + k.pin * (0.4 * (0.28 + 0.72 * Math.sin(Math.PI * smooth(0, pinLen(b) * 1.25, a))) - 1) : 1
      const R = (b.k === 2 ? Math.max(b.w * k.soft, k.minSpec) : b.k === 4 ? k.minSpec * (k.sweep ? 0.8 : 1.6) : b.w * k.soft * lens * (pinned ? 1.45 : b.k === 1 && !rimBand ? k.shade : 1)) * 2.2
      const iR = 1 / R
      const haze = b.k === 6 || (rimBand && k.rim > 0)
      const lo = haze ? 0 : Math.max(0, Math.floor((c - R - WM + VM) / DV))
      const hi = haze ? NV - 1 : Math.min(NV - 1, Math.ceil((c + R + WM + VM) / DV))
      const dye = b.k === 0
      const ch = dye ? 0 : b.k === 1 ? 2 : b.k === 2 || b.k === 3 ? 3 : b.k === 4 ? 4 : b.k === 5 ? 5 : 6
      const w0 = dye ? 1 - b.tone : 1
      const w1 = dye ? b.tone : 0
      const ch1 = dye ? 1 : ch
      for (let i = lo; i <= hi; i++) {
        const v = -VM + i * DV + (k.warp > 0 ? wrow[i] : 0)
        let u: number
        if (haze) u = (1 - smooth(-b.w, b.w, (b.k === 6 ? b.dir : b.tone) * (v - c))) * amp
        else {
          const d = (v - c) * iR
          const q = d * d
          if (q >= 1) continue
          u = (1 - q) * (1 - q) * amp * win[i]
        }
        const o = o0 + i * 8
        LW[o + ch] += u * w0
        LW[o + ch1] += u * w1
      }
    }

    // flow the striations, then composite the row
    const st0 = slide(sa[0], aj, s1) * (1 - t) + slide(sa[0], aj, s2) * t
    const st1 = slide(sa[1], aj, s1) * (1 - t) + slide(sa[1], aj, s2) * t
    const tk = a < 0 ? smooth(0, 0.25, -a) : 0 // washed out behind the focus
    const near = (0.18 + 0.12 * k.pm) * smooth(0.04, 0.4, Math.abs(a)) // streaks fade out toward the focus, or they'd read as spokes
    const sd = 0.55 + 0.45 * (1 - tk)
    for (let i = 0; i < NV; i++) {
      const o = o0 + i * 8
      const m = 1 + near * (sv[0][i] * st0 + sv[1][i] * st1)
      const wt = (LW[o] + LW[o + 1]) * m
      const tone = wt > 1e-5 ? LW[o + 1] / (LW[o] + LW[o + 1]) : 0.5
      const ks = smooth(0.12, 0.55, LW[o + 2]) // shadows don't take the striations: they'd speckle. They go to full density, so print inks reach true black
      const p = Math.min(1, LW[o + 3] * (1 + 0.4 * (m - 1)))
      const tr = Math.min(1, LW[o + 4] * m)
      const gl = Math.min(1, LW[o + 5] * m) * (1 - 0.85 * ks) // the afterglow doesn't light up a shadow
      const hz = LW[o + 6] // the haze takes no striations: a sky is smooth
      const xp = wt * k.dens * (1 - 0.92 * tk)
      const po = 1 - 1 / (1 + 1.8 * xp + 0.8 * xp * xp) // dye opacity on paper: saturates softly, so streak edges stay soft
      const ph = Math.min(1, hz * k.dens * 1.3)
      const xd = wt * k.dens * sd
      const dop = 1 - 1 / (1 + 1.4 * xd + 0.6 * xd * xd)
      const dk = 1 - ks * 0.85
      const oc = (aj * NV + i) * 3
      LK[aj * NV + i] = ks
      for (let c = 0; c < 3; c++) {
        const glc = Li[c] + (E[c] - Li[c]) * 0.32 // print: warm, from the ember
        const gld = Li[c] + (N[c] - Li[c]) * 0.3 // light: cool, from the signal
        const dye = D[c] + (N[c] - D[c]) * tone
        const haze = c ? N[c] + ((N[1] + N[2]) * 0.5 - N[c]) * 0.7 : N[0] * 0.75 + D[0] * 0.25 // a cyan-leaning veil: the red drops, green and blue nearly level
        let rp = 0
        let rd = 0
        if (dense) {
          rp = G[c] * (1 - ph * (1 - haze)) * (1 - po * (1 - dye))
          rp *= 1 - ks * (1 - S[c])
          rp += (glc - rp) * gl
          rp += (Li[c] - rp) * p
          rp += (E[c] - rp) * tr
        }
        if (lit) {
          rd = G[c] + (S[c] - G[c]) * ks * 0.6
          rd = 1 - (1 - rd) * (1 - haze * hz * 0.55) * (1 - dye * dop * dk)
          rd = 1 - (1 - rd) * (1 - gld * gl * 0.55)
          rd = 1 - (1 - rd) * (1 - Li[c] * p)
          rd += (E[c] - rd) * tr // the trail is a lit thing in its own right: it covers the light behind it rather than adding to it
        }
        LC[oc + c] = rd + (rp - rd) * k.pm
        LE[oc + c] = Math.min(1, Li[c] * p + E[c] * tr + (gld + (glc - gld) * k.pm) * gl * 0.35)
      }
    }
  }
}

const geo = { ux: 1, uy: 0, fx: 0, fy: 0, bend: 0, curl: 0, r0: 0, sp: 1, spT: 1, iL: 1, i: 0, ta: 0, tv: 0 }
const em = { x: 0, y: 0, ux: 1, uy: 0, iSc: 1, iLf: 1, iLt: 1, hc: 0, iH: 1, rad: 0, t: 0, u: 0, body: 0, core: 0 }
let cI = new Int32Array(0) // per pixel: lookup node and bilinear fractions. The fan never moves while it plays, so these are cached
let cTa = new Float32Array(0)
let cTv = new Float32Array(0)
let cKey = ''

/** How far a ribbon has lifted off the axis at distance `sa` (in diagonals): the square of it. */
const lift = (sa: number) => (sa < 0 ? -0.35 : 1) * geo.bend * sa * (sa < 0 ? -sa : sa) // (the tail bends less than the front)

/** Across-the-fan scale at signed distance `a` (px): linear with distance (perspective), and with `curl` it relaxes toward the far end, so the ribbons start steep and flatten out, an S. */
const den = (a: number) => ((a >= 0 ? geo.sp : geo.spT) * (a < 0 ? -a : a)) / (1 + geo.curl * 2.2 * (a < 0 ? -a : a) * geo.iL) + geo.r0

/** Where a point lands in the baked bands: fan coordinates around the focus (rotate, bend, perspective), as a lookup node and fractions. */
function locate(x: number, y: number) {
  const dx = x - geo.fx
  const dy = y - geo.fy
  const a = dx * geo.ux + dy * geo.uy
  const v = (dy * geo.ux - dx * geo.uy - lift(a * geo.iL)) / den(a)
  let fa = (a * geo.iL - A0) * (1 / DA)
  let fv = (v + VM) * (1 / DV)
  fa = fa < 0 ? 0 : fa > NA - 1.001 ? NA - 1.001 : fa
  fv = fv < 0 ? 0 : fv > NV - 1.001 ? NV - 1.001 : fv
  const ja = fa | 0
  const jv = fv | 0
  geo.i = (ja * NV + jv) * 3
  geo.ta = fa - ja
  geo.tv = fv - jv
}

const gauss = (q: number) => 1 / (1 + q * (1 + q * (0.5 + q * 0.1667))) // ≈ exp(-q), without the exp

/**
 * The ember: molten light smeared along the flow, a teardrop. Its width tapers to a point at the head (toward the fan)
 * and thins into a long tail behind; the profile is a gaussian with no plateau. `t` is the falloff, `u` the position along
 * it (-1 tail … +1 head), `body` the opacity, `core` a small hotter spot pulled toward the head.
 */
function ember(x: number, y: number) {
  const dx = x - em.x
  const dy = y - em.y
  const ax = dx * em.ux + dy * em.uy
  const qa = ax * (ax >= 0 ? em.iLf : em.iLt)
  const cx = (dy * em.ux - dx * em.uy) * em.iSc * (1 + (ax >= 0 ? 0.5 * Math.min(1, qa * qa) : 0.7 * Math.min(1, -qa)))
  const q = qa * qa + cx * cx
  if (q >= 9) {
    em.body = 0
    return
  }
  em.t = gauss(q)
  em.u = ax >= 0 ? Math.min(1, qa) : Math.max(-1, qa)
  // a little internal streaking along the flow
  const st = 1 + 0.07 * Math.sin(cx * 4.1 + 1.3) + 0.05 * Math.sin(cx * 9.7 + 0.4)
  em.body = Math.min(1, 1.12 * em.t * st)
  const hx = (ax - em.hc) * em.iH
  em.core = gauss(hx * hx + cx * cx * 2.2)
}

function frame(lw: number, lh: number, k: Look, t: number) {
  const L = Math.hypot(lw, lh)
  geo.ux = Math.cos(k.dir)
  geo.uy = Math.sin(k.dir)
  geo.fx = k.fx * lw
  geo.fy = k.fy * lh
  geo.bend = k.bend * 0.9 * L
  geo.curl = k.curl
  geo.r0 = k.spread * k.r0 * L
  geo.sp = k.spread
  geo.spT = k.spread * k.tailW
  geo.iL = 1 / L
  const breathe = 1 + 0.05 * Math.sin(TAU * t)
  const lb = k.emberLen * L * breathe
  const lf = lb * Math.max(0.55, 1 - 0.45 * k.skew) // the head, toward the fan: short and dense…
  const lt = lb * Math.max(0.5, 1 + 1.1 * k.skew) // …and the tail behind it, long and thin
  const ea = k.emberAt * 1.5 * L
  const eb = lift(ea * geo.iL) + k.emberV * den(ea)
  em.x = geo.fx + geo.ux * ea - geo.uy * eb
  em.y = geo.fy + geo.uy * ea + geo.ux * eb
  em.ux = geo.ux
  em.uy = geo.uy
  em.iSc = 1 / (k.emberR * L * breathe)
  em.iLf = 1 / lf
  em.iLt = 1 / lt
  em.hc = (k.skew < 0 ? -1 : 1) * (0.1 + 0.22 * Math.abs(k.skew)) * lb
  em.iH = 1 / (0.4 * lb)
  em.rad = k.emberOn ? 3.1 * Math.max(lf, lt, k.emberR * L) : -1
  const key = [lw, lh, k.fx, k.fy, k.dir, k.spread, k.tailW, k.bend, k.curl, k.r0].join('|')
  if (key === cKey) return
  const n = lw * lh
  if (cI.length < n) {
    cI = new Int32Array(n)
    cTa = new Float32Array(n)
    cTv = new Float32Array(n)
  }
  for (let y = 0, i = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++, i++) {
      locate(x + 0.5, y + 0.5)
      cI[i] = geo.i
      cTa[i] = geo.ta
      cTv[i] = geo.tv
    }
  }
  cKey = key
}

/** The print: one bilinear read of the baked bands per pixel, the ember on top, then dye-cloud film grain. */
function paint(d: Uint8ClampedArray, lw: number, lh: number, k: Look, gx: number, gy: number) {
  const [Li, E] = [12, 15].map((o) => k.c.subarray(o, o + 3))
  const { rad } = em
  const T = LC
  const hot = k.hot
  const warm = clamp01((E[0] - E[2]) * 1.5)
  for (let yy = 0, i = 0, o = 0; yy < lh; yy++) {
    const y = yy + 0.5
    const eRow = Math.abs(y - em.y) < rad
    const gr = ((yy + gy) & (GT - 1)) << 8
    for (let xx = 0; xx < lw; xx++, i++, o += 4) {
      const ta = cTa[i]
      const tv = cTv[i]
      const i0 = cI[i]
      const i1 = i0 + NV * 3
      const w00 = (1 - ta) * (1 - tv)
      const w01 = (1 - ta) * tv
      const w10 = ta * (1 - tv)
      const w11 = ta * tv
      let r = T[i0] * w00 + T[i0 + 3] * w01 + T[i1] * w10 + T[i1 + 3] * w11
      let g = T[i0 + 1] * w00 + T[i0 + 4] * w01 + T[i1 + 1] * w10 + T[i1 + 4] * w11
      let b = T[i0 + 2] * w00 + T[i0 + 5] * w01 + T[i1 + 2] * w10 + T[i1 + 5] * w11
      if (eRow && Math.abs(xx + 0.5 - em.x) < rad) {
        ember(xx + 0.5, y)
        if (em.body > 0) {
          // the shadow wedge crosses the ember: it darkens and partly hides it
          const j0 = i0 / 3
          const ks = LK[j0] * w00 + LK[j0 + 1] * w01 + LK[j0 + NV] * w10 + LK[j0 + NV + 1] * w11
          const head = smooth(-0.5, 0.2, em.u * (k.skew >= 0 ? 1 : -1)) // only the head is crossed by a wedge; a shadow lobe behind the focus doesn't eat the tail
          const ks2 = ks * head * (0.3 + 0.7 * k.pm) // and in the dark a shadow barely hides light
          const op = em.body * (1 - 0.85 * ks2)
          const tail = smooth(0, 1, -em.u * (k.skew >= 0 ? 1 : -1)) // the tail washes out into pale pink…
          const bleed = Math.min(0.85, 0.45 * (1 - smooth(0, 0.5, em.t)) + 0.5 * tail)
          const deep = (1 - 0.12 * smooth(0.15, 0.5, em.t) * (1 - smooth(0.5, 0.95, em.t))) * (1 - 0.55 * ks2) // …saturation peaks in the mid zone…
          r += ((E[0] + (Li[0] - E[0]) * bleed) * deep - r) * op
          g += ((E[1] + (Li[1] - E[1]) * bleed) * deep - g) * op
          b += ((E[2] + (Li[2] - E[2]) * bleed) * deep - b) * op
          // …and a small hot core in the head, warm rather than white (a cream that leans yellow for a red ember)
          const core = em.core * hot * (1 - ks2)
          const cr = (Li[0] * 0.6 + E[0] * 0.4)
          const cg = (Li[1] * 0.6 + E[1] * 0.4)
          r += (cr - r) * core
          g += (cg + (cr - cg) * 0.3 * warm - g) * core
          b += ((Li[2] * 0.6 + E[2] * 0.4) - b) * core
        }
      }
      // dye-cloud grain: strongest in the mid-tones, nearly gone in pure white and black
      const y1 = 0.3 * r + 0.59 * g + 0.11 * b
      const amp = k.film * (0.2 + 3.2 * y1 * (1 - y1)) * 0.05
      const gi = (gr | ((xx + gx) & (GT - 1))) * 3
      d[o] = (r + grain![gi] * amp) * 255
      d[o + 1] = (g + grain![gi + 1] * amp) * 255
      d[o + 2] = (b + grain![gi + 2] * amp) * 255
      d[o + 3] = 255
    }
  }
}

/** What blooms: emitted light (and the ember) gathered on the coarse grid. */
function gather(cw: number, ch: number, k: Look) {
  const [Li, E] = [12, 15].map((o) => k.c.subarray(o, o + 3))
  for (let yy = 0, o = 0; yy < ch; yy++) {
    const y = (yy + 0.5) * BC
    for (let xx = 0; xx < cw; xx++, o++) {
      const x = (xx + 0.5) * BC
      locate(x, y)
      const ta = geo.ta
      const tv = geo.tv
      const i0 = geo.i
      const i1 = i0 + NV * 3
      const w00 = (1 - ta) * (1 - tv)
      const w01 = (1 - ta) * tv
      const w10 = ta * (1 - tv)
      const w11 = ta * tv
      let r = LE[i0] * w00 + LE[i0 + 3] * w01 + LE[i1] * w10 + LE[i1 + 3] * w11
      let g = LE[i0 + 1] * w00 + LE[i0 + 4] * w01 + LE[i1 + 1] * w10 + LE[i1 + 4] * w11
      let b = LE[i0 + 2] * w00 + LE[i0 + 5] * w01 + LE[i1 + 2] * w10 + LE[i1 + 5] * w11
      let body = 0
      if (k.emberOn) {
        ember(x, y)
        body = em.body
        const core = em.core * k.hot
        if (body > 0) {
          r += E[0] * body * 0.2 + Li[0] * core * 0.15
          g += E[1] * body * 0.2 + Li[1] * core * 0.15
          b += E[2] * body * 0.2 + Li[2] * core * 0.15
        }
      }
      bl[0][o] = r
      bl[1][o] = g
      bl[2][o] = b
      bl[3][o] = body
    }
  }
}

/** Chromatic film grain, tileable: fine silver plus soft dye clouds, partly shared between channels. Unit variance. */
function grainTile() {
  if (grain) return grain
  const rng = createRng(0x5171)
  const n = GT * GT
  const white = () => {
    const a = new Float32Array(n)
    for (let i = 0; i < n; i++) a[i] = rng() + rng() + rng() - 1.5
    return a
  }
  const blur = (src: Float32Array) => {
    const o = new Float32Array(n)
    const t = new Float32Array(n)
    for (let y = 0; y < GT; y++) for (let x = 0; x < GT; x++) t[y * GT + x] = (src[y * GT + ((x - 1) & 255)] + 2 * src[y * GT + x] + src[y * GT + ((x + 1) & 255)]) / 4
    for (let y = 0; y < GT; y++) for (let x = 0; x < GT; x++) o[y * GT + x] = (t[((y - 1) & 255) * GT + x] + 2 * t[y * GT + x] + t[((y + 1) & 255) * GT + x]) / 4
    return o
  }
  const mixed = () => {
    const fine = blur(white())
    const cloud = blur(blur(blur(white())))
    const o = new Float32Array(n)
    for (let i = 0; i < n; i++) o[i] = fine[i] * 1.6 + cloud[i] * 3.2
    return o
  }
  const shared = mixed()
  const ch = [mixed(), mixed(), mixed()]
  grain = new Float32Array(n * 3)
  let s = 0
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
    const v = ch[c][i] * 0.7 + shared[i] * 0.55
    grain[i * 3 + c] = v
    s += v * v
  }
  const k = 1 / Math.sqrt(s / (n * 3))
  for (let i = 0; i < grain.length; i++) grain[i] *= k
  return grain
}

/** A paper-tooth tile: speckle, soft mottling and short fibres, carried in the alpha channel (dark ink on light paper, light on dark). */
function paperTile(light: boolean) {
  const i = light ? 1 : 0
  if (paperTiles[i]) return paperTiles[i]
  const S = 512
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const g = c.getContext('2d')!
  const rng = createRng(0x9a9e7)
  const im = g.createImageData(S, S)
  const px = new Uint32Array(im.data.buffer)
  const base = light ? 0x00000000 : 0x00ffffff
  for (let k = 0; k < S * S; k++) {
    const a = (rng() + rng() + rng()) / 3
    const v = Math.max(0, (a - 0.42) * 2.4)
    px[k] = (base | (Math.round(Math.min(1, v * v) * 16) << 24)) >>> 0
  }
  g.putImageData(im, 0, 0)
  g.lineCap = 'round'
  for (let k = 0; k < 1800; k++) {
    const x = rng() * S
    const y = rng() * S
    const a = rng() * TAU
    const len = 3 + rng() * rng() * 22
    g.strokeStyle = light ? `rgba(70,60,40,${0.02 + rng() * 0.04})` : `rgba(255,255,255,${0.02 + rng() * 0.04})`
    g.lineWidth = 0.5 + rng() * 0.8
    for (const [ox, oy] of [[0, 0], [S, 0], [0, S], [-S, 0], [0, -S]]) {
      g.beginPath()
      g.moveTo(x + ox, y + oy)
      g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len)
      g.stroke()
    }
  }
  return (paperTiles[i] = c)
}

/** Resolve the params for one frame. */
function lookFrom(p: ParamValues): Look {
  const c = new Float32Array(18)
  pal(p, 'palette').slice(0, 6).forEach((hex, i) => c.set(hexToRgb(hex).map((v) => v / 255), i * 3))
  const soft = num(p, 'focus')
  const ember = num(p, 'ember')
  const lum = luminance(pal(p, 'palette')[0])
  const [er, , eb] = hexToRgb(pal(p, 'palette')[5])
  const warmth = clamp01((er - eb) / 128 + 0.5)
  return {
    fx: num(p, 'x'),
    fy: num(p, 'y'),
    dir: (num(p, 'angle') * Math.PI) / 180,
    spread: num(p, 'spread'),
    bend: num(p, 'bend'),
    curl: num(p, 'curl'),
    tailW: num(p, 'tailW'),
    pin: num(p, 'pin'),
    skew: num(p, 'skew'),
    emberOn: ember > 0.005,
    sweep: bool(p, 'sweep'),
    sheet: num(p, 'sheet'),
    rim: num(p, 'rim'),
    shade: num(p, 'shade'),
    specLen: num(p, 'specLen'),
    r0: 0.03 + 0.04 * ember,
    reach: 0.2 + 1.1 * num(p, 'tail'),
    tailAmt: (0.25 + 0.75 * num(p, 'tail')) * (1 + 3 * (1 - smooth(0.05, 0.3, lum))), // in the dark the tail spills light; on paper it washes out
    trail: num(p, 'trail'),
    trailLen: 0.1 + 0.8 * num(p, 'trail'),
    soft: 0.75 + 0.7 * soft,
    focus: soft,
    minSpec: 0.011 + 0.014 * soft,
    warp: 0.03 + 0.09 * soft,
    drift: num(p, 'drift'),
    shift: (num(p, 'flow') * 0.9) / DA,
    pm: smooth(0.05, 0.3, lum),
    dens: num(p, 'exposure'),
    haze: num(p, 'haze'),
    film: num(p, 'film'),
    emberAt: num(p, 'emberAt'),
    emberV: num(p, 'emberV'),
    emberR: 0.02 + 0.034 * ember,
    emberLen: 0.04 + 0.085 * ember,
    hot: (0.55 + 0.4 * ember) * (0.35 + 0.65 * warmth), // a cool ember has a soft core, a warm one a hot core
    bloom: num(p, 'bloom'),
    c,
  }
}

export const slipstream: CanvasTool = {
  id: 'slipstream',
  name: 'Slipstream',
  category: 'Texture',
  description: 'Light at speed: soft streaks of colour converging on an ember, printed on paper or lit in the dark.',
  kind: 'canvas',
  raw: true,
  animated: true,
  duration: 8,
  motionScale: 0.5,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (ground, shadow, deep, signal, light, ember)', default: ['#E8F1F2', '#0F1A14', '#245DA0', '#4A8CC4', '#FFFFFF', '#E63E22'], min: 6, max: 6, randomize: false },
    { type: 'number', key: 'x', label: 'Focus X', min: -0.6, max: 1.6, step: 0.01, default: 0.52, rand: [0.25, 0.75] },
    { type: 'number', key: 'y', label: 'Focus Y', min: -0.6, max: 1.6, step: 0.01, default: 0.58, rand: [0.35, 0.7] },
    { type: 'number', key: 'angle', label: 'Direction', min: -180, max: 180, step: 1, default: -8, unit: '°', rand: [-30, 30] },
    { type: 'number', key: 'spread', label: 'Spread', min: 0.15, max: 1.4, step: 0.01, default: 0.8, rand: [0.4, 1] },
    { type: 'number', key: 'bend', label: 'Bend', min: -1, max: 1, step: 0.01, default: -0.5, rand: [-0.8, 0.8] },
    { type: 'number', key: 'curl', label: 'S-curve', min: 0, max: 1, step: 0.01, default: 1, rand: [0, 1] },
    { type: 'number', key: 'tail', label: 'Tail', min: 0, max: 1, step: 0.01, default: 0.65, rand: [0.3, 0.9] },
    { type: 'number', key: 'tailW', label: 'Tail width', min: 0.4, max: 4, step: 0.01, default: 1, rand: [0.8, 1.6] },
    { type: 'number', key: 'streaks', label: 'Streaks', min: 3, max: 24, step: 1, default: 9, rand: [6, 14] },
    { type: 'number', key: 'pin', label: 'Wedge at ember', min: 0, max: 1, step: 0.01, default: 1, rand: [0, 1] },
    { type: 'number', key: 'focus', label: 'Soft focus', min: 0, max: 1, step: 0.01, default: 0.7, rand: [0.35, 0.8] },
    { type: 'number', key: 'ember', label: 'Ember', min: 0, max: 1, step: 0.01, default: 0.55, rand: [0.3, 0.8] },
    { type: 'number', key: 'skew', label: 'Ember smear', min: -1, max: 1, step: 0.01, default: 0.5, rand: [0.3, 0.8] },
    { type: 'number', key: 'emberAt', label: 'Ember along', min: 0, max: 1, step: 0.01, default: 0, rand: [0, 0.08] },
    { type: 'number', key: 'emberV', label: 'Ember across', min: -1, max: 1, step: 0.01, default: 0, rand: [-0.08, 0.08] },
    { type: 'number', key: 'trail', label: 'Ember trail', min: 0, max: 1, step: 0.01, default: 0.2, rand: [0, 0.7] },
    { type: 'boolean', key: 'sweep', label: 'Sweep: one streak, trail alongside', default: false },
    { type: 'number', key: 'sheet', label: 'Light sheet', min: 0, max: 5, step: 0.01, default: 1, rand: [0.7, 1.4] },
    { type: 'number', key: 'specLen', label: 'Speculars reach', min: 0.15, max: 1.6, step: 0.01, default: 1, rand: [0.7, 1.3] },
    { type: 'number', key: 'shade', label: 'Shadow width', min: 0.2, max: 1.6, step: 0.01, default: 1, rand: [0.8, 1.2] },
    { type: 'number', key: 'rim', label: 'Dark rim', min: 0, max: 1, step: 0.01, default: 0, rand: [0, 0] },
    { type: 'number', key: 'haze', label: 'Haze', min: 0, max: 1, step: 0.01, default: 0.6, rand: [0.3, 0.8] },
    { type: 'number', key: 'bloom', label: 'Bloom', min: 0, max: 1, step: 0.01, default: 0.5, rand: [0.3, 0.8] },
    { type: 'number', key: 'film', label: 'Film grain', min: 0, max: 1, step: 0.01, default: 0.2, rand: [0.15, 0.5] },
    { type: 'number', key: 'exposure', label: 'Exposure', min: 0.5, max: 1.6, step: 0.01, default: 1, rand: [0.8, 1.25] },
    { type: 'number', key: 'flow', label: 'Flow', min: 0, max: 1, step: 0.01, default: 0.5, rand: [0.3, 0.8] },
    { type: 'number', key: 'drift', label: 'Drift', min: 0, max: 1, step: 0.01, default: 0.35, rand: [0.15, 0.6] },
    { type: 'boolean', key: 'mirror', label: 'Mirror', default: false },
    {
      type: 'select', key: 'mount', label: 'Mount', default: 'mat', randomize: false,
      options: [{ value: 'none', label: 'Full bleed' }, { value: 'mat', label: 'Mat' }, { value: 'band', label: 'Band' }],
    },
    { type: 'color', key: 'paper', label: 'Paper', default: '#FCFDFD', randomize: false, when: (p) => str(p, 'mount') !== 'none' },
    { type: 'number', key: 'margin', label: 'Margin', min: 0, max: 0.2, step: 0.005, default: 0.05, rand: [0.03, 0.08], when: (p) => str(p, 'mount') !== 'none' },
  ],
  defaults: { format: 'landscape', seed: 7, finish: { grain: 0.1, grainType: 'soft' } },
  presets: [
    { name: 'Daylight', format: 'landscape', seed: 7 },
    {
      // the dark of ref 2: a thin red trail running back along a specular, light on a green-black ground, in a panoramic strip
      name: 'Night run', format: 'landscape', seed: 3,
      params: {
        palette: ['#101A14', '#050907', '#2A5C95', '#5A93CC', '#EAF1F8', '#E0562E'], mount: 'band', paper: '#DCDCDD', margin: 0,
        mirror: true, sweep: true, curl: 0, pin: 0, x: 1, y: 0.3, angle: 170, spread: 0.3, bend: 0.1, tail: 0, streaks: 5, focus: 0.7, ember: 0, trail: 1, haze: 0.15, sheet: 1.9, specLen: 0.6, bloom: 0.55, film: 0.25, exposure: 0.8,
      },
    },
    {
      // ref 3: the vanishing point is off the frame to the left, so the bands run almost parallel under a black-brown arc (the dark rim), with a black wedge entering from the right and a salmon ember on the wedge's lower edge
      name: 'Arc', format: 'landscape', seed: 9,
      params: {
        palette: ['#E4E7EB', '#15130E', '#2F6FB5', '#4E9AD0', '#F6F5F4', '#EE7A58'], mount: 'mat', paper: '#F4F5F7', margin: 0.03,
        curl: 0, pin: 0, rim: 1, shade: 0.7, skew: 0.7, x: -0.2, y: 0.52, angle: 0, spread: 0.3, bend: -0.15, tail: 0.3, streaks: 14, focus: 0.45, ember: 0.42, emberAt: 0.55, emberV: 0.5, trail: 0, haze: 0.4, bloom: 0.7, film: 0.3,
      },
    },
    {
      // litt.md on paper: cool neutrals, one blue accent, the hot core goes white-blue
      name: 'Litt, light', format: 'portrait', seed: 6,
      params: {
        palette: ['#FAFBFC', '#0E0F11', '#0961BB', '#1A73D5', '#FFFFFF', '#E1F0FF'], mount: 'mat', paper: '#F0F2F5', margin: 0.06,
        curl: 0, pin: 0, shade: 0.5, skew: 0.3, x: 0.3, y: 0.8, angle: -52, spread: 0.6, bend: -0.25, tail: 0.5, streaks: 9, focus: 0.6, ember: 0.6, trail: 0, haze: 0.15, bloom: 0.5, film: 0.15, exposure: 0.42,
      },
    },
    {
      // litt.md lit in the dark, full bleed
      name: 'Litt, dark', format: 'landscape', seed: 2,
      params: {
        palette: ['#08090A', '#161719', '#0E2440', '#4C9FFF', '#F7F8F9', '#6BB3FF'], mount: 'none',
        curl: 0, pin: 0, skew: 0.3, x: 0.42, y: 0.56, angle: -14, spread: 0.42, bend: -0.25, tail: 0.45, streaks: 8, focus: 0.6, ember: 0.5, trail: 0.3, haze: 0.3, bloom: 0.6, film: 0.2, exposure: 0.7,
      },
    },
    {
      // a comet falling through a story: the streaks trail upward from the head
      name: 'Comet', format: 'story', seed: 4,
      params: {
        palette: ['#05070B', '#030405', '#16356B', '#3F86E0', '#EAF3FF', '#FF8A4C'], mount: 'none',
        curl: 0, pin: 0, skew: -0.8, x: 0.5, y: 0.72, angle: -90, spread: 0.3, bend: -0.2, tail: 0.5, streaks: 10, focus: 0.55, ember: 1, trail: 0.2, haze: 0.4, bloom: 0.65, film: 0.3, exposure: 0.9,
      },
    },
  ],
  draw({ g, w, h, p, rng, noise, t, seed }) {
    const cv = g.canvas
    const W = cv.width
    const H = cv.height
    const T = g.getTransform()
    const mount = str(p, 'mount')
    const paper = str(p, 'paper')
    // the photo's rectangle in artwork units: full bleed, on a mat (bottom a touch deeper, like a print), or a panoramic strip
    const m = num(p, 'margin') * Math.min(w, h)
    let rx = 0
    let ry = 0
    let rw = w
    let rh = h
    if (mount === 'mat') {
      rx = m
      ry = m
      rw = w - 2 * m
      rh = h - 2.35 * m
    } else if (mount === 'band') {
      rx = m
      rw = w - 2 * m
      rh = Math.min(rw / 2.55, h - 2 * m)
      ry = (h - rh) / 2
    }
    // snap to whole device pixels so the print's edge is crisp
    const x0 = Math.round(rx * T.a)
    const y0 = Math.round(ry * T.d)
    const dw = Math.max(1, Math.round((rx + rw) * T.a) - x0)
    const dh = Math.max(1, Math.round((ry + rh) * T.d) - y0)

    // work at the display's resolution, capped: ~700 px while the preview plays (less if frames run long), ~1400 for stills and exports
    const css = cv.clientWidth
    const live = css > 0 && W < css * (window.devicePixelRatio || 1) * 0.7
    const t0 = performance.now()
    const q = Math.min(1, (live ? cap : 1400) / Math.max(dw, dh))
    const lw = Math.max(48, Math.round(dw * q))
    const lh = Math.max(48, Math.round(dh * q))
    const cw = Math.ceil(lw / BC)
    const ch = Math.ceil(lh / BC)

    const k = lookFrom(p)
    const L = layoutFor(seed, num(p, 'streaks'), bool(p, 'mirror'), rng, noise)
    bake(L, k, noise, t)

    if (!img || img.width !== lw || img.height !== lh) img = new ImageData(lw, lh)
    if (!bl.length || bl[0].length < cw * ch) bl = [0, 1, 2, 3].map(() => new Float32Array(cw * ch))
    grainTile()
    frame(lw, lh, k, t)
    paint(img.data, lw, lh, k, (seed * 37) & 255, (seed * 91) & 255)
    if (lw * lh > 1_000_000) {
      // big stills aren't replayed: don't hold their cache
      cI = new Int32Array(0)
      cTa = new Float32Array(0)
      cTv = new Float32Array(0)
      cKey = ''
    }
    work ??= document.createElement('canvas')
    work.width = lw
    work.height = lh
    work.getContext('2d')!.putImageData(img, 0, 0)

    // lens bloom: emitted light on a coarse grid, blurred tight and wide. It is added back over the print,
    // and the ember also gets a halation tint (film's red glow around a hot highlight) that reads on pale grounds too
    if (k.bloom > 0.01) {
      gather(cw, ch, k)
      const r1 = Math.max(1, Math.round(((0.012 + 0.03 * k.bloom) * Math.hypot(lw, lh)) / BC))
      const blur = bl.map((b, j) => {
        const src = b.subarray(0, cw * ch)
        const tight = boxBlur(boxBlur(src, cw, ch, r1), cw, ch, r1) // four box passes ≈ a gaussian: two make a plus-shaped halo around a bright point
        const wide = boxBlur(boxBlur(src, cw, ch, r1 * 2), cw, ch, r1 * 3)
        const o = new Float32Array(cw * ch)
        const [a, c] = j === 3 ? [0.5, 1.4] : [0.48, 0.88]
        for (let i = 0; i < o.length; i++) o[i] = (tight[i] * a + wide[i] * c) * k.bloom
        return o
      })
      if (!gimg || gimg.width !== cw || gimg.height !== ch) gimg = new ImageData(cw, ch)
      const gd = gimg.data
      const tint = [0, 1, 2].map((c) => k.c[15 + c] + (k.c[12 + c] - k.c[15 + c]) * 0.3) // the halation: the ember's colour, a little paler
      // both layers stay opaque (a low alpha would premultiply the tint into visible hue steps): the light is added,
      // and on paper the ember's halo is multiplied in, tinting the white pink over a wide area
      for (let pass = 0; pass < 2; pass++) {
        let sd = seed + 1 + pass
        for (let i = 0; i < cw * ch; i++) {
          sd = (Math.imul(sd, 1664525) + 1013904223) | 0 // a little noise so the faint halo doesn't band
          const dither = ((sd >>> 8) / 16777216 - 0.5) * 1.2
          const hb = blur[3][i]
          for (let c = 0; c < 3; c++) {
            gd[i * 4 + c] = pass ? 255 - Math.min(1, hb * 1.3 * k.pm) * (1 - tint[c]) * 255 + dither : (blur[c][i] + hb * tint[c] * 0.5 * (1 - k.pm)) * 255 + dither
          }
          gd[i * 4 + 3] = 255
        }
        if (pass && k.pm < 0.02) break
        glow[pass] ??= document.createElement('canvas')
        glow[pass].width = cw
        glow[pass].height = ch
        glow[pass].getContext('2d')!.putImageData(gimg, 0, 0)
      }
    }

    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    if (mount !== 'none') {
      g.fillStyle = paper
      g.fillRect(0, 0, W, H)
    }
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(work, 0, 0, lw, lh, x0, y0, dw, dh)
    if (k.bloom > 0.01) {
      g.imageSmoothingQuality = 'low'
      if (k.pm >= 0.02) {
        g.globalCompositeOperation = 'multiply'
        g.drawImage(glow[1], 0, 0, cw, ch, x0, y0, dw, dh)
      }
      g.globalCompositeOperation = 'lighter'
      g.drawImage(glow[0], 0, 0, cw, ch, x0, y0, dw, dh)
      g.globalCompositeOperation = 'source-over'
    }
    if (mount !== 'none') {
      // paper tooth over the whole sheet, a little uneven light, and the print's clean edge
      const light = luminance(paper) > 0.3
      const key = `${W}|${H}|${T.a}|${light}`
      const big = W * H > 6_000_000 // exports: draw the sheet straight on, rather than caching a huge canvas
      if (big || !sheet || sheetKey !== key) {
        const sg = big ? g : (sheet ??= document.createElement('canvas')).getContext('2d')!
        if (!big) {
          sheet!.width = W
          sheet!.height = H
        }
        const pat = sg.createPattern(paperTile(light), 'repeat')!
        pat.setTransform(new DOMMatrix().scale(T.a))
        sg.fillStyle = pat
        sg.fillRect(0, 0, W, H)
        const vg = sg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.hypot(W, H) * 0.6)
        vg.addColorStop(0, 'rgba(60,50,30,0)')
        vg.addColorStop(1, 'rgba(60,50,30,0.035)')
        sg.fillStyle = vg
        sg.fillRect(0, 0, W, H)
        sheetKey = big ? '' : key
      }
      if (!big) g.drawImage(sheet!, 0, 0)
      g.strokeStyle = 'rgba(20,24,28,0.12)'
      const hw = Math.max(1, T.a * 0.5)
      g.lineWidth = hw
      g.strokeRect(x0 + hw / 2, y0 + hw / 2, dw - hw, dh - hw)
    }
    g.restore()

    if (live) {
      // hold the frame rate: if draws average over ~22 ms, trade a little resolution for it (the softness hides it)
      ema = ema ? ema * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0
      if (++frames % 24 === 0) cap = ema > 22 ? Math.max(420, cap * 0.9) : ema < 12 ? Math.min(700, cap * 1.08) : cap
    }
  },
}
