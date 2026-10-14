import type { Noise } from '../lib/noise'
import { HYPHER_ASPECT, HYPHER_BRIDGE, hypherMarkPath, insideHypherMark } from '../lib/marks'
import { rasterizeText } from '../lib/measure'
import type { Rng } from '../lib/random'
import { escapeXml, FONT_STACKS, r2, rect } from '../lib/svg'
import { bool, num, pal, str, type ParamValues, type SvgTool } from './types'

const TAU = Math.PI * 2
const ri = Math.round
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** A pixel-grid rectangle (cells). c: 1 ink, 2 signal. k/f: flicker frequency + phase. s: ±1 = streak anchored at x, growing in that direction. */
interface Blk { x: number; y: number; w: number; h: number; c: number; k: number; f: number; s: number }
/** A radial wedge: angle, inner radius, length, base half-width and the dash segments (fractions of the length) that are drawn. */
interface Ray { ca: number; sa: number; r0: number; len: number; bw: number; segs: [number, number][]; k: number; f: number }
/** A horizontal band of rows displaced by `d` cells while |t - t0| < hw. */
interface Tear { t: number; hw: number; y: number; h: number; d: number }
interface Mark {
  x: number; y: number; w: number; h: number
  hit(px: number, py: number): boolean
  svg(fill: string): string
  bridge: [number, number]
}
interface Layout {
  c: number; gw: number; gh: number
  blocks: Blk[]; rays: Ray[]; tears: Tear[]
  cx: number; cy: number
  mark: Mark | null
  ko: boolean
  /** cell runs [y, x, n] inside the mark (cleared when knocking out) */
  runs: number[][]
  /** cell rect kept clean around the mark when it is drawn in ink */
  hole: [number, number, number, number] | null
  /** cell rects [x, y, w, h] for the ember pixel */
  accent: number[][]
}

let probeCtx: CanvasRenderingContext2D | null = null
/** Ink origin offsets (left bearing, ascent) at the raster size, matching rasterizeText's own measurement. */
function textMetrics(text: string, font: string, fallbackAsc: number): [number, number] {
  try {
    probeCtx ??= document.createElement('canvas').getContext('2d')
    if (!probeCtx) return [0, fallbackAsc]
    probeCtx.font = font
    const m = probeCtx.measureText(text)
    return [Math.ceil(m.actualBoundingBoxLeft || 0), Math.ceil(m.actualBoundingBoxAscent || fallbackAsc)]
  } catch {
    return [0, fallbackAsc]
  }
}

function makeMark(kind: string, text: string, size: number, cx: number, cy: number, W: number, H: number): Mark | null {
  if (kind === 'none') return null
  if (kind === 'text') {
    const txt = text.trim() || 'hypher'
    const font = (s: number) => `800 ${s}px ${FONT_STACKS.sans}`
    const ras = rasterizeText(txt, font, 240)
    const iw = Math.max(1, ras.right - ras.left)
    const ih = Math.max(1, ras.bottom - ras.top)
    const mw = Math.min(size * W, 0.92 * W, (0.5 * H * iw) / ih)
    const k = mw / iw
    const mh = ih * k
    const x = cx - mw / 2
    const y = cy - mh / 2
    const [left, asc] = textMetrics(txt, font(240), ih * 0.8)
    return {
      x, y, w: mw, h: mh, bridge: [cx, cy],
      hit(px, py) {
        const rx = Math.floor(ras.left + (px - x) / k)
        const ry = Math.floor(ras.top + (py - y) / k)
        return rx >= 0 && ry >= 0 && rx < ras.width && ry < ras.height && ras.data[(ry * ras.width + rx) * 4 + 3] > 110
      },
      svg: (fill) =>
        `<text x="${r2(x + left * k)}" y="${r2(y + asc * k)}" font-family="${escapeXml(FONT_STACKS.sans)}" font-weight="800" font-size="${r2(240 * k)}" fill="${fill}">${escapeXml(txt)}</text>`,
    }
  }
  const mw = Math.min(size * W, 0.92 * W, 0.6 * H * HYPHER_ASPECT)
  const mh = mw / HYPHER_ASPECT
  const x = cx - mw / 2
  const y = cy - mh / 2
  return {
    x, y, w: mw, h: mh,
    bridge: [x + HYPHER_BRIDGE.u * mh, y + HYPHER_BRIDGE.v * mh],
    hit: (px, py) => insideHypherMark((px - x) / mh, (py - y) / mh),
    svg: (fill) => `<path d="${hypherMarkPath(x, y, mh)}" fill="${fill}"/>`,
  }
}

function build(w: number, h: number, p: ParamValues, rng: Rng, noise: Noise): Layout {
  const field = str(p, 'field')
  // debris vocabulary is designed on a 5px grid; `vs` rescales it so Pixel only sets how coarsely everything snaps
  const vs = 5 / num(p, 'cell')
  const bs = num(p, 'blockSize') * vs
  const N = num(p, 'density')
  const streaks = num(p, 'streaks')
  const m = Math.min(w, h)
  const c = num(p, 'cell') * (m / 1080)
  const gw = Math.ceil(w / c)
  const gh = Math.ceil(h / c)

  // composition: centre sits low-right of the headline area; smear shifts right like a hero
  const wide = w / h > 1.3
  let cxp = w * (wide && field === 'cloud' ? 0.56 : 0.5)
  let cyp = h * (w / h > 2.5 ? 0.5 : wide ? 0.6 : 0.45)
  if (field === 'smear' && wide) cxp = w * 0.62
  if (field === 'burst') cyp = h * (wide ? 0.56 : 0.6)
  const mark = makeMark(str(p, 'mark'), str(p, 'text'), num(p, 'markSize'), cxp, cyp, w, h)
  const ko = bool(p, 'knockout') && !!mark
  const plated = ko && field !== 'scatter'
  const cx = cxp / c
  const cy = cyp / c
  const spread = num(p, 'spread')
  const syP = spread * 0.16 * m
  const sxP = Math.min(syP * num(p, 'stretch'), w * 0.48 * spread)
  const sx = sxP / c
  const sy = syP / c
  // mark box in cells (degenerate at the centre when there is no mark)
  const bx0 = mark ? mark.x / c : cx
  const bx1 = mark ? (mark.x + mark.w) / c : cx
  const by0 = mark ? mark.y / c : cy
  const by1 = mark ? (mark.y + mark.h) / c : cy
  const mw = bx1 - bx0
  const mh = by1 - by0

  // headline-safe corner: debris is truncated at a ragged, blocky edge and thins out just beyond it (mark and plate are exempt)
  const clear = str(p, 'clear')
  const tl = clear === 'tl'
  const zone = clear === 'tl' || clear === 'bl'
  const zx = (tl ? (wide ? 0.5 : 0.68) : wide ? 0.3 : 0.36) * gw
  const zh = (tl ? (wide ? 0.4 : (0.28 * m) / h) : wide ? 0.2 : (0.2 * m) / h) * gh
  const ex: number[] = [] // right edge per row
  const ey: number[] = [] // vertical edge per column
  if (zone) {
    for (let y = 0; y <= gh; y++) ex.push(zx + ri(noise.n2(7.3, Math.floor(y / 3) * 0.55) * 0.07 * zx))
    for (let x = 0; x <= gw; x++) ey.push((tl ? zh : gh - zh) + ri(noise.n2(Math.floor(x / 6) * 0.45, 3.9) * 0.1 * zh))
  }
  const hash = (x: number, y: number) => {
    let n = Math.imul((x * 374761393 + y * 668265263) | 0, 1274126177)
    n = Math.imul(n ^ (n >>> 13), 1103515245)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
  let free = false

  const blocks: Blk[] = []
  const rays: Ray[] = []
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng())

  // `hole`: debris is skipped here (and the frame clears it when the mark is inked); `anch`: streaks start outside it
  const pad = Math.max(0.42 * mh, 4)
  const hole: [number, number, number, number] | null = !mark ? null : plated ? [bx0 - 0.08 * mw, by0 - 0.25 * mh, bx1 + 0.08 * mw, by1 + 0.25 * mh] : ko ? [bx0, by0, bx1, by1] : [bx0 - pad, by0 - pad * 0.85, bx1 + pad, by1 + pad * 0.85]
  const anch: [number, number, number, number] | null = !mark ? null : plated ? [bx0 - 0.22 * mw, by0 - 0.55 * mh, bx1 + 0.22 * mw, by1 + 0.55 * mh] : hole
  const inRect = (x: number, y: number, r: number[] | null) => !!r && x > r[0] && x < r[2] && y > r[1] && y < r[3]

  const flick = (fl: number): [number, number] => [rng() < fl ? rng.pick([1, 2, 3, 5]) : 0, rng()]
  const add = (x: number, y: number, bw: number, bh: number, col = 1, fl = 0.3, s = 0, kf = flick(fl)) => {
    x = ri(x)
    y = ri(y)
    if (y >= gh || y + bh <= 0 || (s > 0 ? x >= gw : s < 0 ? x <= 0 : x >= gw || x + bw <= 0)) return
    if (zone && !free) {
      // bars crossing the zone are cut at its edge (streaks keep running out of it); loose pieces just outside it thin out
      let a = s < 0 ? x - bw : x
      const b = a + bw
      const ym = clamp(y + (bh >> 1), 0, gh - 1)
      const xm = clamp((a + b) >> 1, 0, gw)
      const vin = tl ? ym < ey[xm] : ym > ey[xm]
      if (vin) {
        if (a < ex[ym]) {
          a = Math.max(a, ex[ym])
          if (b - a < 1) return
          x = a
          bw = b - a
          if (s < 0) s = 0
        }
      } else if (!s) {
        const dx = Math.max(0, xm - ex[ym]) / (0.22 * zx)
        const dy = Math.max(0, tl ? ym - ey[xm] : ey[xm] - ym) / (0.25 * zh)
        const dn = Math.hypot(dx, dy)
        if (dn < 1 && hash(x, y) < (1 - dn) ** 1.3) return
      }
    }
    blocks.push({ x, y, w: bw, h: bh, c: col, k: kf[0], f: kf[1], s })
  }
  /** Pixel sprite: a block with notched corners and the odd bite out of its sides, like a thresholded square. */
  const blob = (x: number, y: number, bw: number, bh: number) => {
    const kf = flick(0.3)
    const e = Math.min(bw, bh) >= 8 ? ri(2 * vs) || 1 : Math.max(1, ri(vs))
    const cut = [0, 1, 2, 3].map(() => (rng() < 0.6 ? (rng() < 0.7 ? 1 : e) : 0))
    for (let j = 0; j < bh; j++) {
      let l = j === 0 ? cut[0] : j === bh - 1 ? cut[2] : rng() < 0.08 ? 1 : 0
      let r = j === 0 ? cut[1] : j === bh - 1 ? cut[3] : rng() < 0.08 ? 1 : 0
      if (j === 1 && cut[0] === 2) l = 1
      if (j === 1 && cut[1] === 2) r = 1
      if (j === bh - 2 && cut[2] === 2) l = 1
      if (j === bh - 2 && cut[3] === 2) r = 1
      if (bw - l - r > 0) add(x + l, y + j, bw - l - r, 1, 1, 0, 0, kf)
    }
  }
  /** Horizontal bar growing outward from `x`; its anchor is pushed out of the mark so streaks run away from it. */
  const streak = (x: number, y: number, len: number, hh: number, dir: number, col = 1) => {
    if (anch && y + hh > anch[1] && y < anch[3]) x = dir > 0 ? Math.max(x, anch[2] + rng.int(-2, 8)) : Math.min(x, anch[0] - rng.int(-2, 8))
    add(x, y, clamp(ri(len * vs), 1, gw), ri(hh * vs), col, 0.2, dir)
  }
  const tall = () => {
    const q = rng()
    return q < 0.5 ? 1 : q < 0.88 ? 2 : 3
  }

  // clumps and voids, fine row banding like scanlines, and extra thinning towards a top-left headline
  const clump = (x: number, y: number) => {
    const X = (x * c) / m
    const Y = (y * c) / m
    const corner = tl ? clamp(Math.hypot((0.9 * x) / gw, (1.3 * y) / gh) / 0.55, 0.1, 1) ** 1.3 : 1
    return clamp(0.8 + 0.95 * noise.n2(X * 2.6, Y * 3.6) + 0.25 * noise.n2(X * 9 + 11, Y * 11) + 0.2 * noise.n2(31.7, Y * 60), 0.05, 1.3) * corner
  }

  /** One speck of debris: notched squares (most at mid range), dust, short dashes, the odd plus shape. */
  const blockAt = (x: number, y: number) => {
    const r = Math.hypot((x - cx) / sx, (y - cy) / sy)
    const s = Math.min(1, r / 2.4)
    const q = rng()
    const sq = 0.18 + 0.3 * Math.exp(-(((s - 0.55) / 0.3) ** 2))
    if (q < sq) {
      const z = Math.max(2, ri(bs * rng.range(3, 8) * (1.15 - 0.5 * s)))
      const zh = Math.max(2, ri(z * rng.range(0.6, 1)))
      blob(ri(x - z / 2), ri(y - zh / 2), z, zh)
    } else if (q < sq + 0.4) {
      const z = Math.max(1, ri(bs * [1, 1, 2, 2, 2, 3][rng.int(0, 5)]))
      add(x - z / 2, y - z / 2, z, z)
    } else if (q < sq + 0.4 + 0.04 * s) {
      const z = Math.max(1, ri(bs * rng.range(1, 2)))
      add(x - z * 1.5, y - z * 0.5, 3 * z, z)
      add(x - z * 0.5, y - z * 1.5, z, 3 * z)
    } else {
      const bw = clamp(ri(Math.exp(Math.log(lerp(8, 4, s)) + gauss() * 0.6) * bs), 2, 20)
      add(x - bw / 2, y, bw, Math.max(1, ri((rng() < 0.6 ? 1 : 2) * bs)))
    }
  }

  /** Local ink density: a wide plateau around the core that rolls off steeply, broken up by clumps. */
  const dens = (x: number, y: number) => {
    const r = Math.hypot((x - cx) / sx, (y - cy) / sy)
    return (1 / (1 + (r / 1.8) ** 4)) * clump(x, y)
  }

  /**
   * Pixel-sorted rows: bands of quantised thickness cut into variable-length segments that switch on where the density
   * is high. Neighbouring rows often repeat the same cuts, so segments stack into square-ish blocks; thick near the core,
   * thin far out.
   */
  const rows = (kD: number, wx: number) => {
    const A = (N / 2600) ** 0.8 * kD * 1.7
    const xa = Math.max(0, cx - wx * sx)
    const xb = Math.min(gw, cx + wx * sx)
    let prev: number[][] | null = null
    for (let y = Math.max(0, cy - 2.8 * sy), y1 = Math.min(gh, cy + 2.8 * sy); y < y1; ) {
      const sr = Math.min(1, Math.abs(y - cy) / (2.4 * sy))
      const rh = clamp(ri(lerp(9, 2, sr ** 0.8) * Math.exp(gauss() * 0.35) * bs), 1, 14)
      let segs: number[][]
      if (prev && rng() < 0.35) segs = prev
      else {
        segs = []
        for (let x = xa - rng.int(0, 12) * vs; x < xb; ) {
          const s = Math.min(1, Math.hypot((x - cx) / sx, (y - cy) / sy) / 2.4)
          const l = clamp(ri(Math.max(rh * rng.range(0.9, 1.5), Math.exp(Math.log(lerp(11, 4, s)) + gauss() * 0.6) * bs)), 2, 34)
          segs.push([x, l])
          x += l
        }
      }
      prev = segs
      for (const [x, l] of segs) {
        const mx = x + l / 2
        if (inRect(mx, y + rh / 2, hole) || rng() > dens(mx, y + rh / 2) * A) continue
        const bw = Math.max(1, l - (l > 3 ? rng.int(1, 2) : 0))
        const hh = Math.max(1, Math.min(ri(rh * (1.1 - 0.4 * Math.min(1, Math.abs(mx - cx) / (2.4 * sx))) * rng.range(0.7, 1)), Math.max(2, ri(bw * 1.25))))
        if (bw >= 3 && hh >= 3) blob(x, y, bw, hh)
        else add(x, y, bw, hh)
      }
      y += rh + ri((rng() < 0.45 ? 1 : rng() < 0.55 ? 0 : 2) * vs)
    }
  }

  /** Gaussian core + exponential tail around the cloud centre, thinned by clumps. */
  const cloud = (n: number, ssx: number, ssy: number) => {
    for (let i = 0, tries = 0; i < n && tries < n * 12; tries++) {
      let dx: number
      let dy: number
      if (rng() < 0.45) {
        dx = gauss() * 0.7
        dy = gauss() * 0.7
      } else {
        const r = -Math.log((1 - rng()) * (1 - rng())) * (rng() < 0.8 - 0.3 * Math.min(1, streaks * 3) ? 0.75 : 1.4 + Math.min(1, streaks * 3)) // Gamma(2): finite density at the centre
        const a = rng() * TAU
        dx = Math.cos(a) * r
        dy = Math.sin(a) * r
      }
      const x = cx + dx * ssx
      const y = cy + dy * ssy
      if (x < 0 || y < 0 || x >= gw || y >= gh || inRect(x, y, hole) || rng() > clump(x, y)) continue
      blockAt(x, y)
      i++
    }
  }

  /** Dense ragged ink plate under the mark: stepped per-row and per-column extents, chamfered corners, a few cut lines. */
  const plate = (fx: [number, number], fy: [number, number]) => {
    free = true
    const mx = Math.ceil(fx[1] * mw)
    const my = Math.ceil(fy[1] * mh)
    const x0 = Math.floor(bx0) - mx
    const x1 = Math.ceil(bx1) + mx
    const y0 = Math.floor(by0) - my
    const y1 = Math.ceil(by1) + my
    const stepped = (n: number, a: number, b: number, lo: number, hi: number) => {
      const out: number[] = []
      while (out.length < n) {
        const v = rng.range(lo, hi)
        for (let i = ri(rng.int(a, b) * vs); i > 0 && out.length < n; i--) out.push(v)
      }
      return out
    }
    const hl = stepped(y1 - y0 + 1, 1, 5, fx[0] * mw, fx[1] * mw)
    const hr = stepped(y1 - y0 + 1, 1, 5, fx[0] * mw, fx[1] * mw)
    const vt = stepped(x1 - x0 + 1, 2, 10, fy[0] * mh, fy[1] * mh)
    const vb = stepped(x1 - x0 + 1, 2, 10, fy[0] * mh, fy[1] * mh)
    const midX = (bx0 + bx1) / 2
    const midY = (by0 + by1) / 2
    for (let y = y0; y <= y1; y++) {
      let start = -1
      let segEnd = x0
      let on = true
      const cut = rng() < 0.12 ? rng.int(x0, x1) : -1
      const cutEnd = cut + ri(rng.int(3, 24) * vs)
      for (let x = x0; x <= x1 + 1; x++) {
        let inside = false
        if (x <= x1) {
          const dxo = Math.max(bx0 - x, x - bx1, 0)
          const dyo = Math.max(by0 - y, y - by1, 0)
          const he = (x < midX ? hl : hr)[y - y0]
          const ve = (y < midY ? vt : vb)[x - x0]
          const k = dxo / he + dyo / ve
          inside = dxo <= he && dyo <= ve && k <= 1.55
          if (inside && k > 0.7) {
            // ragged rim: short segments flip on and off
            if (x >= segEnd) {
              segEnd = x + ri(rng.int(2, 7) * vs)
              on = rng() < 0.9 - 0.5 * (k - 0.7)
            }
            inside = on
          }
          if (x >= cut && x < cutEnd && k > 0) inside = false
        }
        if (inside && start < 0) start = x
        else if (!inside && start >= 0) {
          add(start, y, x - start, 1, 1, 0)
          start = -1
        }
      }
    }
    free = false
  }

  // --- fields ---
  if (field === 'cloud' || field === 'burst') {
    if (plated) plate(field === 'cloud' ? [0.03, 0.14] : [0.15, 0.45], field === 'cloud' ? [0.12, 0.5] : [0.5, 1.3])
    const k = field === 'burst' ? 0.4 : 1
    rows(k * clamp(streaks * 2.3, 0, 1.2), 4.2)
    cloud(ri(N * clamp(0.35 + 0.7 * (1 - bs / vs) + 0.4 * (1 - Math.min(1, streaks * 3)), 0.3, 1.2) * k), sx, sy)
    if (plated) cloud(ri(N * 0.08), 0.4 * mw, 0.9 * mh) // halo hugging the plate: densest right at the mark
    const ns = ri(N * 0.08 * streaks * k)
    for (let i = 0; i < ns; i++) {
      const dir = rng() < 0.55 ? 1 : -1
      const y = cy + gauss() * sy * 0.8
      const x = cx + dir * Math.abs(gauss()) * sx * 0.7
      const len = Math.exp(Math.log(10 + 55 * streaks) + gauss() * 0.8)
      streak(x, y, len, tall(), dir)
      if (rng() < 0.35) streak(x + dir * (len + rng.int(2, 8)), y, len * rng.range(0.2, 0.6), 1, dir)
    }
  } else if (field === 'smear') {
    // pixel-sorted rows stacked like text lines, dashes shrinking and thinning out away from the mark
    if (plated) plate([0.04, 0.14], [0.12, 0.4])
    const reach = (0.5 + 1.5 * streaks) * sx * 1.5
    const gk = (2600 / N) ** 0.7
    for (let y = cy - 2.4 * sy; y < cy + 2.4 * sy; ) {
      const q = rng()
      const hh = q < 0.25 ? 1 : q < 0.65 ? 2 : q < 0.92 ? 3 : 4
      const dyn = Math.abs(y - cy) / sy
      if (rng() > Math.min(0.9, 1.1 - 0.3 * dyn)) {
        y += ri((hh + 1) * vs)
        continue
      }
      const fall = Math.exp(-0.5 * (dyn / 1.1) ** 2)
      for (const dir of [1, -1]) {
        const R = reach * fall * Math.exp(gauss() * 0.5) * (dir > 0 ? 1 : wide ? 0.5 : 0.75)
        let x = cx + dir * Math.abs(gauss()) * 0.15 * sx
        // rows level with the mark start at the plate edge, so each dash keeps its own place along the row
        if (anch && y + hh > anch[1] && y < anch[3]) x = dir > 0 ? anch[2] + rng.int(0, 6) : anch[0] - rng.int(0, 6)
        for (let d = 0; d < R; ) {
          const prog = d / R
          const seg = Math.max(1, ri((6 + 24 * streaks) * (1 - 0.7 * prog) * Math.exp(gauss() * 0.8)))
          streak(x, y, seg, hh, dir)
          const gap = Math.max(1, ri((1 + rng() * (2 + 9 * prog)) * gk * vs))
          x += dir * (seg + gap)
          d += seg + gap
        }
      }
      y += ri(hh * vs) + ri((rng() < 0.6 ? 1 : rng() < 0.5 ? 0 : 2) * vs)
    }
    rows(0.25, 2.5)
    cloud(ri(N * 0.15), sx * 0.7, sy * 0.7)
  } else {
    // scatter: a loose, fine sprinkle of 1-3 cell pixels and short 1-cell dashes, with very few chunks
    const n = ri(N * 0.14)
    const nc = hole ? 0 : ri(n * 0.1) // no mark: keep the centre populated
    for (let i = 0, tries = 0; i < n && tries < n * 12; tries++) {
      let dx: number
      let dy: number
      const core = i < nc
      if (core) {
        dx = gauss() * 0.3
        dy = gauss() * 0.3
      } else if (rng() < 0.65) {
        const r = Math.sqrt(rng()) * 1.9
        const a = rng() * TAU
        dx = Math.cos(a) * r
        dy = Math.sin(a) * r
      } else {
        dx = gauss() * 0.8
        dy = gauss() * 0.8
      }
      const x = cx + dx * sx
      const y = cy + dy * sy
      if (x < 0 || y < 0 || x >= gw || y >= gh || inRect(x, y, hole) || (!core && rng() > clump(x, y) + 0.3)) continue
      i++
      const q = rng()
      const z = Math.max(1, ri(Math.exp(Math.log(2.2) + gauss() * 0.4) * bs))
      if (q < 0.4) add(x, y, Math.max(1, ri(bs * rng.int(1, 2))), Math.max(1, ri(bs * rng.int(1, 2))))
      else if (q < 0.6) add(x - z / 2, y - z / 2, z, z)
      else if (q < 0.92) add(x - 1, y, Math.max(2, ri(rng.range(2, 6) * bs)), Math.max(1, ri(bs * (rng() < 0.85 ? 1 : 2))))
      else if (q < 0.97) {
        add(x - 1.5, y - 0.5, 3, 1)
        add(x - 0.5, y - 1.5, 1, 3)
      } else add(x - z, y - z, Math.min(z * 2, 4), Math.min(z * 2, 4))
    }
  }

  // --- burst rays: tapering wedges from the mark outward, stretched like the cloud ---
  if (field === 'burst') {
    const nr = ri(N / 12)
    const st = Math.min(num(p, 'stretch'), 2.6)
    const Lb = (spread * 0.62 * m) / c
    const hx = mark ? mw / 2 + 0.25 * mw : 6
    const hy = mark ? mh / 2 + 0.7 * mh : 4
    for (let i = 0, tries = 0; i < nr && tries < nr * 4; tries++) {
      const a = rng() * TAU
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      if (rng() > 0.3 + 0.7 * (0.5 + 0.5 * noise.n2(ca * 1.7 + 3, sa * 1.7))) continue
      i++
      const er = 1 / Math.hypot(ca / st, sa)
      const rho = Math.min(hx / Math.max(1e-3, Math.abs(ca)), hy / Math.max(1e-3, Math.abs(sa)))
      // dashed along its length: 1-5 pieces with random gaps
      const segs: [number, number][] = []
      const np = rng() < 0.35 ? 1 : rng.int(2, 5)
      for (let u = 0, j = 0; j < np && u < 1; j++) {
        const e = j === np - 1 ? 1 : Math.min(1, u + rng.range(0.15, 0.5) / np * 2)
        segs.push([u, e])
        u = e + rng.range(0.03, 0.12)
      }
      const r0 = rho * rng.range(0.7, 1.05)
      let len = Lb * er * (0.06 + 0.94 * rng() ** 2) * 1.1
      const rbw = (0.8 + 3.2 * rng() ** 2) * Math.max(0.6, bs)
      if (zone) {
        // rays stop short of the headline zone (with room for the length pulse)
        const pad = rbw + 1
        for (let rad = r0; rad < r0 + len; rad += 2) {
          const px = cx + ca * rad
          const py = cy + sa * rad
          if (px < zx + pad && (tl ? py < zh + pad : py > gh - zh - pad)) {
            len = (rad - r0) / 1.3
            break
          }
        }
        if (len < 4) continue
      }
      rays.push({ ca, sa, r0, len, bw: rbw, segs, k: rng() < 0.3 ? rng.int(1, 3) : 0, f: rng() })
    }
  }

  // --- signal blocks: a seeded glitch cluster in one region ---
  const K = ri(num(p, 'signal') * N * 0.9)
  if (K > 0) {
    let east = rng() < 0.8 ? 1 : -1
    const north = rng() < 0.8 ? -1 : 1
    if (zone && east < 0 && (north < 0) === tl) east = 1 // never the corner the headline sits in
    const ax = field === 'burst' ? (east > 0 ? 0.87 : 0.13) * gw : clamp(cx + east * 0.95 * sx, 0.1 * gw, 0.9 * gw)
    const ay = field === 'burst' ? (north < 0 ? (tl ? 0.25 : 0.16) : 0.84) * gh : clamp(cy + north * 1.0 * sy, 0.1 * gh, 0.9 * gh)
    for (let i = 0; i < K; i++) {
      const bw = clamp(ri(Math.exp(Math.log(8) + gauss() * 0.75) * bs), 1, 40)
      const q = rng()
      const bh = Math.max(1, ri((q < 0.6 ? 1 : q < 0.88 ? 2 : rng.int(3, 6)) * bs))
      add(ax + gauss() * (field === 'burst' ? 0.075 : 0.11) * gw - bw / 2, Math.round((ay + gauss() * 0.08 * gh) / 2) * 2, bw, bh, 2, 0.3)
    }
  }

  // --- tears: row bands that slip sideways for a moment (clear of the mark rows) ---
  const tears: Tear[] = []
  const times = [0.18, 0.41, 0.63, 0.87]
  for (const t0 of times) {
    for (let b = rng.int(2, 4); b > 0; b--) {
      for (let tries = 0; tries < 8; tries++) {
        const th = ri(rng.int(3, 12) * vs)
        const y = ri(cy + gauss() * sy * 0.9 - th / 2)
        if (mark && y < by1 + 2 && y + th > by0 - 2) continue
        if (zone && (tl ? y < zh + 2 : y + th > gh - zh - 2)) continue
        tears.push({ t: t0, hw: rng.range(0.016, 0.03), y, h: th, d: ri(rng.int(3, 18) * vs) * (rng() < 0.5 ? -1 : 1) })
        break
      }
    }
  }

  // --- mark cells (knockout) and ember pixel ---
  const runs: number[][] = []
  if (ko && mark) {
    for (let y = Math.floor(by0); y <= Math.ceil(by1); y++) {
      let start = -1
      for (let x = Math.floor(bx0); x <= Math.ceil(bx1) + 1; x++) {
        const on = x <= Math.ceil(bx1) && mark.hit((x + 0.5) * c, (y + 0.5) * c)
        if (on && start < 0) start = x
        else if (!on && start >= 0) {
          runs.push([y, start, x - start])
          start = -1
        }
      }
    }
  }
  const accent: number[][] = []
  if (bool(p, 'accent')) {
    const [ex, ey] = mark ? mark.bridge : [cxp, cyp]
    const hyp = str(p, 'mark') === 'hypher'
    const aw = hyp ? Math.max(1, ri(0.22 * mh)) : clamp(ri((0.013 * m) / c), 2, 8)
    const ah = hyp ? Math.max(1, ri(0.3 * mh)) : aw
    const ax = ri(ex / c - aw / 2)
    const ay = ri(ey / c - ah / 2)
    accent.push([ax, ay, aw, ah])
    if (rng() < 0.6) accent.push([ax - 1 - rng.int(0, 2), ay + ri(ah * rng.range(0.3, 0.9)), 1, 1])
  }

  return { c, gw, gh, blocks, rays, tears, cx, cy, mark, ko, runs, hole: ko ? null : hole, accent }
}

function frame(L: Layout, w: number, h: number, t: number, g: number, col: string[]) {
  const { gw, gh, c } = L
  const [paper, ink, sig, acc] = col
  const grid = new Uint8Array(gw * gh)
  const lo = new Int32Array(gh).fill(gw)
  const hi = new Int32Array(gh).fill(-1)
  const fill = (x: number, y: number, bw: number, bh: number, v: number) => {
    const x0 = Math.max(0, x)
    const x1 = Math.min(gw, x + bw)
    if (x1 <= x0) return
    for (let j = Math.max(0, y); j < Math.min(gh, y + bh); j++) {
      grid.fill(v, j * gw + x0, j * gw + x1)
      if (x0 < lo[j]) lo[j] = x0
      if (x1 > hi[j]) hi[j] = x1
    }
  }

  // blocks: flicker, and streak lengths pulsing on the loop
  const rate = 0.2 * g
  for (const b of L.blocks) {
    if (b.k && (b.k * t + b.f) % 1 < rate) continue
    let x = b.x
    let bw = b.w
    if (b.s) {
      bw = Math.max(1, ri(b.w * (1 + 0.3 * g * Math.sin(TAU * (t + b.f)))))
      if (b.s < 0) x -= bw
    }
    fill(x, b.y, bw, b.h, b.c)
  }

  // tears
  for (const e of L.tears) {
    let dt = t - e.t
    dt -= Math.round(dt)
    if (Math.abs(dt) > e.hw) continue
    const d = ri((dt < 0 ? e.d : -e.d * 0.6) * g * 2)
    if (!d || Math.abs(d) >= gw) continue
    for (let j = Math.max(0, e.y); j < Math.min(gh, e.y + e.h); j++) {
      if (hi[j] <= lo[j]) continue
      const base = j * gw
      if (d > 0) {
        grid.copyWithin(base + d, base, base + gw - d)
        grid.fill(0, base, base + d)
      } else {
        grid.copyWithin(base, base - d, base + gw)
        grid.fill(0, base + gw + d, base + gw)
      }
      lo[j] = Math.max(0, Math.min(lo[j], lo[j] + d))
      hi[j] = Math.min(gw, Math.max(hi[j], hi[j] + d))
    }
  }

  // keep the mark clean: knock it out of the debris, or hold a margin around it
  for (const [y, x, n] of L.runs) if (y >= 0 && y < gh) grid.fill(0, y * gw + clamp(x, 0, gw), y * gw + clamp(x + n, 0, gw))
  if (L.hole) {
    const [x0, y0, x1, y1] = L.hole
    for (let j = Math.max(0, Math.floor(y0)); j < Math.min(gh, Math.ceil(y1)); j++) grid.fill(0, j * gw + clamp(Math.floor(x0), 0, gw), j * gw + clamp(Math.ceil(x1), 0, gw))
  }

  // runs of equal cells, merged vertically when the same run repeats on the next row
  const rs: number[][] = [[], []]
  let prev = [new Map<number, number>(), new Map<number, number>()]
  let cur = [new Map<number, number>(), new Map<number, number>()]
  for (let j = 0; j < gh; j++) {
    cur[0].clear()
    cur[1].clear()
    const base = j * gw
    for (let x = Math.max(0, lo[j]), end = Math.min(gw, hi[j]); x < end; ) {
      const v = grid[base + x]
      if (!v) {
        x++
        continue
      }
      let e = x + 1
      while (e < end && grid[base + e] === v) e++
      const key = x * 8192 + (e - x)
      const hit = prev[v - 1].get(key)
      if (hit !== undefined) {
        rs[v - 1][hit + 3]++
        cur[v - 1].set(key, hit)
      } else {
        cur[v - 1].set(key, rs[v - 1].length)
        rs[v - 1].push(x, j, e - x, 1)
      }
      x = e
    }
    ;[prev, cur] = [cur, prev]
  }
  const d = rs.map((a) => {
    let s = ''
    for (let i = 0; i < a.length; i += 4) s += `M${a[i]},${a[i + 1]}h${a[i + 2]}v${a[i + 3]}h${-a[i + 2]}Z`
    return s
  })

  // rays (cell units, one-decimal precision)
  const q = (v: number) => Math.round(v * 10) / 10
  let rd = ''
  for (const r of L.rays) {
    if (r.k && (r.k * t + r.f) % 1 < rate) continue
    const len = r.len * (1 + 0.25 * g * Math.sin(TAU * (t + r.f)))
    const nx = -r.sa
    const ny = r.ca
    for (const [sa, sb] of r.segs) {
      const ra = r.r0 + len * sa
      const rb = r.r0 + len * sb
      const wa = r.bw * (1 - sa)
      const wb = r.bw * (1 - sb)
      const P = (rad: number, wd: number) => `${q(L.cx + r.ca * rad + nx * wd)},${q(L.cy + r.sa * rad + ny * wd)}`
      rd += `M${P(ra, -wa)}L${P(rb, -wb)}L${P(rb, wb)}L${P(ra, wa)}Z`
    }
  }

  const grp = `<g transform="scale(${+c.toFixed(4)})">${d[0] || rd ? `<path d="${d[0]}${rd}" fill="${ink}"/>` : ''}${d[1] ? `<path d="${d[1]}" fill="${sig}"/>` : ''}</g>`
  const mark = L.mark ? L.mark.svg(L.ko ? paper : ink) : ''
  let ember = ''
  if ((2 * t + 0.3) % 1 >= 0.07 * g) {
    for (const [x, y, aw, ah] of L.accent) ember += `M${r2(x * c)},${r2(y * c)}h${r2(aw * c)}v${r2(ah * c)}h${r2(-aw * c)}Z`
  }
  return rect(w, h, paper) + grp + mark + (ember ? `<path d="${ember}" fill="${acc}"/>` : '')
}

export const glitchField: SvgTool = {
  id: 'glitch-field',
  name: 'Glitch Field',
  category: 'Texture',
  description: 'Pixel debris, pixel-sorted streaks and radial bursts gathering around a reversed-out mark.',
  kind: 'svg',
  raw: true,
  animated: true,
  duration: 4,
  params: [
    { type: 'palette', key: 'palette', label: 'Palette (paper, ink, signal, accent)', default: ['#FAF9F6', '#000000', '#0066FF', '#FF5A00'], min: 4, max: 4 },
    {
      type: 'select', key: 'field', label: 'Field', default: 'cloud',
      options: [{ value: 'cloud', label: 'Cloud' }, { value: 'scatter', label: 'Scatter' }, { value: 'smear', label: 'Smear' }, { value: 'burst', label: 'Burst' }],
    },
    {
      type: 'select', key: 'mark', label: 'Mark', default: 'hypher',
      options: [{ value: 'hypher', label: 'Hypher' }, { value: 'text', label: 'Text' }, { value: 'none', label: 'None' }],
    },
    { type: 'text', key: 'text', label: 'Mark text', default: 'hypher', maxLength: 16, suggestions: ['hypher', 'H', 'ctx', '07', 'memory'], when: (p) => p.mark === 'text' },
    { type: 'number', key: 'markSize', label: 'Mark size', min: 0.08, max: 0.6, step: 0.01, default: 0.3, rand: [0.2, 0.4], when: (p) => p.mark !== 'none' },
    { type: 'number', key: 'density', label: 'Density', min: 200, max: 6000, step: 50, default: 2600, rand: [1400, 3800] },
    { type: 'number', key: 'spread', label: 'Spread', min: 0.2, max: 1.4, step: 0.01, default: 0.9, rand: [0.6, 1.2] },
    { type: 'number', key: 'stretch', label: 'Stretch', min: 1, max: 5, step: 0.05, default: 2.4, rand: [1.5, 3.2] },
    { type: 'number', key: 'blockSize', label: 'Block size', min: 0.5, max: 3, step: 0.05, default: 1, rand: [0.7, 1.6] },
    { type: 'number', key: 'cell', label: 'Pixel', min: 1, max: 12, step: 0.5, default: 4, unit: 'px', rand: [3, 7] },
    { type: 'number', key: 'streaks', label: 'Streaks', min: 0, max: 1, step: 0.01, default: 0.35, rand: [0.15, 0.6], when: (p) => p.field !== 'scatter' },
    { type: 'number', key: 'signal', label: 'Signal', min: 0, max: 0.3, step: 0.005, default: 0.015, rand: [0, 0.06] },
    { type: 'boolean', key: 'accent', label: 'Ember pixel', default: true },
    { type: 'boolean', key: 'knockout', label: 'Knockout', default: true, when: (p) => p.mark !== 'none' },
    {
      type: 'select', key: 'clear', label: 'Keep clear', default: 'tl', randomize: false,
      options: [{ value: 'none', label: 'Off' }, { value: 'tl', label: 'Top left' }, { value: 'bl', label: 'Bottom left' }],
    },
    { type: 'number', key: 'glitch', label: 'Glitch', min: 0, max: 1, step: 0.01, default: 0.5, rand: [0.3, 0.8] },
  ],
  defaults: {
    format: 'landscape',
    seed: 9,
    finish: { grain: 0.15, grainType: 'soft' },
    type: { enabled: true, layout: 'tl', title: 'new agent. same project.', body: '', label: '', caption: '', uppercase: false, weight: '700', color: '#000000', size: 3.8, measure: 0.5, margin: 0.045 },
  },
  presets: [
    { name: 'Same project', format: 'landscape', seed: 9, params: { clear: 'tl' } },
    {
      name: 'Signal', format: 'landscape', seed: 6,
      params: { palette: ['#000000', '#FAF9F6', '#0066FF', '#FF5A00'], field: 'smear', clear: 'tl', density: 2800, signal: 0.02 },
      type: { enabled: true, layout: 'tl', title: 'hypher', body: 'Project memory for coding agents.', weight: '500', color: '#FAF9F6', size: 2.2, measure: 0.4, uppercase: false },
    },
    {
      name: 'Capture', format: 'square', seed: 2,
      params: { field: 'scatter', mark: 'none', clear: 'bl', density: 3000, spread: 1.05, stretch: 1.3, blockSize: 0.6, cell: 4, signal: 0 },
      type: { enabled: true, layout: 'bl', title: 'capture', body: '', caption: 'NEW INFORMATION ENTERS THE PROJECT.', weight: '500', color: '#000000', size: 1.5, uppercase: false },
    },
    {
      name: 'Retain', format: 'square', seed: 3,
      params: { field: 'cloud', clear: 'bl', density: 4800, spread: 0.35, stretch: 1.35, markSize: 0.42, cell: 4, blockSize: 0.9, streaks: 0.05, signal: 0 },
      type: { enabled: true, layout: 'bl', title: 'retain', body: '', caption: 'CONTEXT ACCUMULATES AND SOLIDIFIES.', weight: '500', color: '#000000', size: 1.5, uppercase: false },
    },
    {
      name: 'Resume', format: 'square', seed: 2,
      params: { field: 'smear', clear: 'bl', density: 3200, spread: 0.6, stretch: 1.5, markSize: 0.42, cell: 4, streaks: 0.3, signal: 0 },
      type: { enabled: true, layout: 'bl', title: 'resume', body: '', caption: 'A NEW AGENT CONTINUES WITH FULL CONTEXT.', weight: '500', color: '#000000', size: 1.5, uppercase: false },
    },
    {
      name: 'Decisions stay', format: 'portrait', seed: 5,
      params: { palette: ['#000000', '#FAF9F6', '#0066FF', '#FF5A00'], field: 'burst', clear: 'tl', density: 2600, spread: 0.8, stretch: 2, signal: 0.08, accent: false },
      type: { enabled: true, layout: 'tl', title: 'The decisions stay.', body: '', caption: '', weight: '700', color: '#FAF9F6', size: 3, measure: 0.8, uppercase: false },
    },
  ],
  render({ w, h, p, rng, noise, t }) {
    return frame(build(w, h, p, rng, noise), w, h, t, num(p, 'glitch'), pal(p, 'palette'))
  },
}
