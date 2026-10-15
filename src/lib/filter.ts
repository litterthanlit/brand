import type { Param, ParamValue, ParamValues } from '../tools/types'
import { luminance } from './color'
import { escapeXml, r2 } from './svg'

/**
 * Global "filter" layer: re-renders any tool's artwork as a screen of glyphs, one mark per cell,
 * sized by the brightness underneath (ticks, dashes, dots, crosses, hatching, ASCII).
 * Sits between the artwork and the grain / type layers.
 */

export const FILTER_STYLES = [
  { value: 'none', label: 'Off' },
  { value: 'ticks', label: 'Ticks' },
  { value: 'dashes', label: 'Dashes' },
  { value: 'dots', label: 'Dots' },
  { value: 'crosses', label: 'Crosses' },
  { value: 'hatch', label: 'Hatch' },
  { value: 'ascii', label: 'ASCII' },
] as const

export type FilterStyle = (typeof FILTER_STYLES)[number]['value']

const on = (p: ParamValues) => p.style !== 'none'

/** Ink and background each mode starts from: marks on a dark room, or dark ink printed on paper. */
const GROUNDS = {
  dark: { ink: '#D9D6CF', background: '#111111' },
  light: { ink: '#1A1A1A', background: '#EDE9E1' },
}
type Ground = keyof typeof GROUNDS

export const FILTER_PARAMS: Param[] = [
  { type: 'select', key: 'style', label: 'Style', default: 'none', options: FILTER_STYLES.map((s) => ({ ...s })) },
  {
    type: 'select', key: 'ground', label: 'Mode', default: 'dark',
    options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
    when: on,
  },
  { type: 'number', key: 'cell', label: 'Cell width', min: 4, max: 48, step: 1, default: 12, unit: 'px', when: on },
  { type: 'number', key: 'aspect', label: 'Cell height', min: 0.4, max: 5, step: 0.05, default: 3, unit: '×', when: on },
  { type: 'number', key: 'weight', label: 'Weight', min: 0.05, max: 1, step: 0.01, default: 0.26, when: (p) => on(p) && p.style !== 'ascii' },
  {
    type: 'select', key: 'anchor', label: 'Anchor', default: 'center',
    options: [{ value: 'center', label: 'Centre' }, { value: 'start', label: 'Baseline' }],
    when: (p) => p.style === 'ticks' || p.style === 'dashes',
  },
  { type: 'boolean', key: 'levels', label: 'Auto levels', default: true, when: on },
  { type: 'number', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, step: 0.01, default: 1, when: on },
  { type: 'number', key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, default: 0, when: on },
  { type: 'number', key: 'steps', label: 'Steps (0 = smooth)', min: 0, max: 12, step: 1, default: 0, when: on },
  { type: 'number', key: 'floor', label: 'Floor', min: 0, max: 0.6, step: 0.01, default: 0.12, when: on },
  {
    type: 'select', key: 'empty', label: 'Empty cells', default: 'dot',
    options: [{ value: 'dot', label: 'Dot' }, { value: 'blank', label: 'Blank' }],
    when: on,
  },
  { type: 'number', key: 'scatter', label: 'Scatter', min: 0, max: 1, step: 0.01, default: 0.5, when: on },
  { type: 'boolean', key: 'invert', label: 'Invert', default: false, when: on },
  {
    type: 'select', key: 'colorMode', label: 'Colour', default: 'mono',
    options: [{ value: 'mono', label: 'Ink' }, { value: 'source', label: 'Source' }],
    when: on,
  },
  { type: 'color', key: 'ink', label: 'Ink', default: GROUNDS.dark.ink, when: (p) => on(p) && p.colorMode === 'mono' },
  { type: 'color', key: 'background', label: 'Background', default: GROUNDS.dark.background, when: on },
]

/** The look each style starts from when picked (cell geometry and stroke). Merged over the current filter values. */
export const FILTER_STYLE_DEFAULTS: Record<FilterStyle, ParamValues> = {
  none: {},
  ticks: { cell: 12, aspect: 3, weight: 0.26 },
  dashes: { cell: 16, aspect: 0.55, weight: 0.28 },
  dots: { cell: 12, aspect: 1, weight: 0.9 },
  crosses: { cell: 14, aspect: 1, weight: 0.14 },
  hatch: { cell: 12, aspect: 1, weight: 0.14 },
  ascii: { cell: 9, aspect: 1.8, weight: 0.26 },
}

export const filterActive = (f: ParamValues | undefined): boolean => !!f && typeof f.style === 'string' && f.style !== 'none'

/** Switch style, applying that style's starting geometry. */
export function withStyle(f: ParamValues, style: string): ParamValues {
  return { ...f, ...(FILTER_STYLE_DEFAULTS[style as FilterStyle] ?? {}), style }
}

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Switch mode, carrying the colours across. Stock colours become the other mode's stock colours.
 * A custom pair keeps its look and is only swapped when the new mode needs it: paper lighter than
 * the ink in Light, a room darker than the ink in Dark. Swapping back therefore restores it exactly.
 */
function withGround(f: ParamValues, value: string): ParamValues {
  const to: Ground = value === 'light' ? 'light' : 'dark'
  const now: Ground = sv(f, 'ground') === 'light' ? 'light' : 'dark'
  // picking the active mode again must not touch a custom pair
  if (to === now) return { ...f, ground: to }
  const from = GROUNDS[now]
  let ink = sv(f, 'ink')
  let background = sv(f, 'background')
  if (sameColor(ink, from.ink) && sameColor(background, from.background)) {
    ink = GROUNDS[to].ink
    background = GROUNDS[to].background
  } else if (to === 'light' ? luminance(background) < luminance(ink) : luminance(background) > luminance(ink)) {
    const paper = ink
    ink = background
    background = paper
  }
  return { ...f, ground: to, ink, background }
}

/** Apply one filter control change. Style and mode carry side effects; everything else is a plain key. */
export function updateFilter(f: ParamValues, key: string, value: ParamValue): ParamValues {
  if (key === 'style') return withStyle(f, value as string)
  if (key === 'ground') return withGround(f, value as string)
  return { ...f, [key]: value }
}

/** The cell grid for a w×h artwork. The grid is centred, so partial cells split evenly between the edges. */
export interface CellLayout {
  cols: number
  rows: number
  /** Cell size in artwork units. */
  cw: number
  ch: number
  /** Top-left of the grid in artwork units. */
  ox: number
  oy: number
}

/** A sampled artwork: one brightness and one average colour per cell. */
export interface CellGrid extends CellLayout {
  /** Row-major, cols × rows, in [0, 1] after levels / contrast / brightness / flip / steps. 1 is the heaviest mark. */
  lum: Float32Array
  /** Row-major average sRGB colour, 3 bytes per cell. */
  rgb: Uint8ClampedArray
}

// Params arrive from URLs and old links, so anything missing falls back to its declared default.
const PARAM_DEFAULTS: ParamValues = Object.fromEntries(FILTER_PARAMS.map((p) => [p.key, p.default]))
const nv = (f: ParamValues, k: string) => (typeof f[k] === 'number' ? f[k] : PARAM_DEFAULTS[k]) as number
const sv = (f: ParamValues, k: string) => (typeof f[k] === 'string' ? f[k] : PARAM_DEFAULTS[k]) as string
const bv = (f: ParamValues, k: string) => (typeof f[k] === 'boolean' ? f[k] : PARAM_DEFAULTS[k]) as boolean
const isLight = (f: ParamValues) => sv(f, 'ground') === 'light'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const TAU = Math.PI * 2

export function cellLayout(f: ParamValues, w: number, h: number): CellLayout {
  const cw = Math.max(1, nv(f, 'cell'))
  const ch = Math.max(1, cw * nv(f, 'aspect'))
  // the epsilon keeps an exact fit (1080 / 9) from floor()ing to one cell short
  const cols = Math.max(1, Math.floor(w / cw + 1e-6))
  const rows = Math.max(1, Math.floor(h / ch + 1e-6))
  return { cols, rows, cw, ch, ox: (w - cols * cw) / 2, oy: (h - rows * ch) / 2 }
}

/** Source pixels per cell along its short side: enough for a fair average, cheap enough to redraw every frame. */
const SOURCE_PER_CELL = 4
/** Budget for the sampled artwork, in pixels (it is redrawn per animation frame). */
const SOURCE_PIXELS = 700_000
/** Budget for the sampling scratch canvas, in pixels. */
const SCRATCH_PIXELS = 1_000_000
const SUBSAMPLE_MAX = 16

/**
 * Artwork → pixel scale at which a canvas tool should be drawn before sampling.
 * Enough resolution for a fair average per cell, and no more (sampling is per frame while playing).
 */
export function sampleScale(f: ParamValues, w: number, h: number): number {
  const { cw, ch } = cellLayout(f, w, h)
  const want = clamp(SOURCE_PER_CELL / Math.min(cw, ch), 0.15, 1)
  return Math.min(want, Math.sqrt(SOURCE_PIXELS / (w * h)))
}

let scratch: HTMLCanvasElement | null = null

const LEVEL_BINS = 1024
/** Share of cells allowed to clip at each end. */
const LEVEL_CLIP = 0.01
/** The narrowest span stretched to full range, which caps the gain at 1 / 0.08. */
const LEVEL_MIN_SPAN = 0.08
const levelHist = new Uint32Array(LEVEL_BINS)

/**
 * Auto levels: the offset and gain that stretch the 1st–99th percentile of `v` (cell luma in [0, 1]) to full range.
 * Binned rather than sorted, since it runs for every animation frame. A near-flat image would turn its
 * noise into texture, so a narrow span is widened around where it sits, which maps a flat image to itself.
 */
function levelsOf(v: Float32Array): [lo: number, gain: number] {
  levelHist.fill(0)
  for (let i = 0; i < v.length; i++) levelHist[Math.min(LEVEL_BINS - 1, Math.floor(v[i] * LEVEL_BINS))]++
  const cut = v.length * LEVEL_CLIP
  let acc = 0
  let a = 0
  while (a < LEVEL_BINS - 1 && (acc += levelHist[a]) < cut) a++
  acc = 0
  let b = LEVEL_BINS - 1
  while (b > a && (acc += levelHist[b]) < cut) b--
  let lo = a / LEVEL_BINS
  let span = (b + 1) / LEVEL_BINS - lo
  if (span < LEVEL_MIN_SPAN) {
    lo *= (1 - LEVEL_MIN_SPAN) / (1 - span)
    span = LEVEL_MIN_SPAN
  }
  return [lo, 1 / span]
}

/**
 * Average a rendered artwork into cells.
 * `source` covers the whole w×h artwork at any resolution: `sourceW` × `sourceH` is its pixel size
 * (a canvas's width/height, or w/h for an SVG image rasterised from a w×h viewBox).
 */
export function sampleCells(source: CanvasImageSource, sourceW: number, sourceH: number, f: ParamValues, w: number, h: number): CellGrid {
  const l = cellLayout(f, w, h)
  const { cols, rows, cw, ch } = l
  const cells = cols * rows

  // Sub-samples per cell, roughly square: ~4 along the short side, the long side capped.
  const short = Math.min(cw, ch)
  let sx = clamp(Math.round((SOURCE_PER_CELL * cw) / short), 1, SUBSAMPLE_MAX)
  let sy = clamp(Math.round((SOURCE_PER_CELL * ch) / short), 1, SUBSAMPLE_MAX)
  const over = Math.sqrt(SCRATCH_PIXELS / (cells * sx * sy))
  if (over < 1) {
    sx = Math.max(1, Math.floor(sx * over))
    sy = Math.max(1, Math.floor(sy * over))
  }
  const sw = cols * sx
  const sh = rows * sy

  scratch ??= document.createElement('canvas')
  if (scratch.width !== sw || scratch.height !== sh) {
    scratch.width = sw
    scratch.height = sh
  }
  const g = scratch.getContext('2d', { willReadFrequently: true })!
  // transparent artwork reads as the ground it will sit on: dark in a dark room, blank on paper
  g.fillStyle = isLight(f) ? '#fff' : '#000'
  g.fillRect(0, 0, sw, sh)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  if (sourceW > 0 && sourceH > 0) {
    const kx = sourceW / w
    const ky = sourceH / h
    g.drawImage(source, l.ox * kx, l.oy * ky, cols * cw * kx, rows * ch * ky, 0, 0, sw, sh)
  }
  const px = g.getImageData(0, 0, sw, sh).data

  const sums = new Uint32Array(cells * 3)
  for (let y = 0; y < sh; y++) {
    const row = Math.floor(y / sy) * cols
    let p = y * sw * 4
    for (let c = 0; c < cols; c++) {
      let r = 0
      let gr = 0
      let b = 0
      for (let k = 0; k < sx; k++, p += 4) {
        r += px[p]
        gr += px[p + 1]
        b += px[p + 2]
      }
      const i = (row + c) * 3
      sums[i] += r
      sums[i + 1] += gr
      sums[i + 2] += b
    }
  }

  const contrast = nv(f, 'contrast')
  const brightness = nv(f, 'brightness')
  // marks follow brightness on a dark ground and darkness on paper; invert flips either
  const flip = !!f.invert !== isLight(f)
  const steps = Math.round(nv(f, 'steps'))
  const n = sx * sy
  const lum = new Float32Array(cells)
  const rgb = new Uint8ClampedArray(cells * 3)
  for (let i = 0; i < cells; i++) {
    const r = sums[i * 3] / n
    const gr = sums[i * 3 + 1] / n
    const b = sums[i * 3 + 2] / n
    rgb[i * 3] = r
    rgb[i * 3 + 1] = gr
    rgb[i * 3 + 2] = b
    lum[i] = (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255
  }

  const [lo, gain] = bv(f, 'levels') ? levelsOf(lum) : [0, 1]
  for (let i = 0; i < cells; i++) {
    let v = (lum[i] - lo) * gain
    v = (v - 0.5) * contrast + 0.5 + brightness
    if (flip) v = 1 - v
    v = clamp(v, 0, 1)
    if (steps > 0) v = Math.round(v * steps) / steps
    lum[i] = v
  }
  return { ...l, lum, rgb }
}

// ---------------------------------------------------------------------------------------------
// Marks. One generator decides every glyph; the canvas and SVG backends only say how to paint them,
// so the preview, PNG and vector export cannot drift apart.
// ---------------------------------------------------------------------------------------------

/** Colour key: 0 is the ink, anything else is 1 + a 12-bit (4 bits per channel) source colour. */
type Key = number

interface Sink {
  line(k: Key, x1: number, y1: number, x2: number, y2: number): void
  dot(k: Key, x: number, y: number, r: number): void
  glyph(k: Key, x: number, y: number, c: string): void
}

/** Everything about the marks that is the same for every cell. */
interface Plan {
  style: string
  cw: number
  ch: number
  /** Line width of stroked marks. */
  stroke: number
  /** The cell's short side, for marks that stay square. */
  d: number
  /** Ticks and dashes grow from the cell's bottom / left edge instead of its centre. */
  start: boolean
  /** Dots: radius of an empty-cell speck, of the smallest visible dot, of the biggest. */
  rSpeck: number
  rMin: number
  rMax: number
  fontSize: number
}

const ASCII_FONT = "'JetBrains Mono', monospace"
const ASCII_WEIGHT = 500
// "." is reserved for empty cells, so even the faintest visible glyph is bigger than the speck
const ASCII_RAMP = ':-=+*#%@'
/** Longest tick, as a fraction of the cell, leaving a hair of air between rows. */
const FILL = 0.88

function plan(l: CellLayout, f: ParamValues): Plan {
  const { cw, ch } = l
  const style = sv(f, 'style')
  const weight = nv(f, 'weight')
  const d = Math.min(cw, ch)
  const rMax = (weight * d) / 2
  const rSpeck = Math.min(0.08 * d, 0.3 * rMax)
  return {
    style, cw, ch, d,
    // rounded here so the canvas and the SVG paint exactly the same numbers
    stroke: r2(style === 'ticks' ? weight * cw : style === 'dashes' ? weight * ch : weight * d),
    start: sv(f, 'anchor') === 'start',
    rSpeck, rMin: 1.7 * rSpeck, rMax,
    fontSize: r2(Math.min(ch * 0.95, cw / 0.6)),
  }
}

/** Deterministic [0, 1) hash of (seed, cell), so scatter is stable across frames, sizes and exports. */
function hash(seed: number, i: number) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 0x7f4a7c15, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Brightest channel on paper, past which a source colour is deepened to stay legible. */
const PAPER_CAP = 140

/**
 * Colours must read against the ground, so move the brightest channel and keep the hue.
 * Dark: dim colours would vanish, so lift it to ~230. Near-black cells are lifted from 32 rather than from
 * their own noise, so they stay dim instead of turning white.
 * Light: bright colours would vanish on paper, so deepen anything above ~140. Dim cells are left alone, so near-black stays ink.
 */
function sourceKey(rgb: Uint8ClampedArray, i: number, light: boolean): Key {
  const r = rgb[i * 3]
  const g = rgb[i * 3 + 1]
  const b = rgb[i * 3 + 2]
  const k = (light ? Math.min(1, PAPER_CAP / Math.max(r, g, b, 1)) : 230 / Math.max(r, g, b, 32)) / 17
  return 1 + ((Math.round(r * k) << 8) | (Math.round(g * k) << 4) | Math.round(b * k))
}

const keyColor = (k: Key, ink: string) => (k === 0 ? ink : '#' + (k - 1 + 0x1000).toString(16).slice(1).replace(/./g, '$&$&'))

/** One mark for one cell. `m` is the mark's strength in [0, 1], or -1 for the empty-cell speck. */
function mark(s: Sink, p: Plan, k: Key, x: number, y: number, m: number) {
  const { cw, ch, d, stroke } = p
  const cx = x + cw / 2
  const cy = y + ch / 2
  const speck = m < 0
  switch (p.style) {
    case 'ticks': {
      const len = speck ? stroke : lerp(1.5 * stroke, Math.max(FILL * ch, 1.5 * stroke), m)
      const y1 = p.start ? cy + (FILL / 2) * ch : cy + len / 2
      s.line(k, cx, y1, cx, y1 - len)
      break
    }
    case 'dashes': {
      const len = speck ? stroke : lerp(1.5 * stroke, Math.max(FILL * cw, 1.5 * stroke), m)
      const x1 = p.start ? cx - (FILL / 2) * cw : cx - len / 2
      s.line(k, x1, cy, x1 + len, cy)
      break
    }
    case 'dots':
      s.dot(k, cx, cy, speck ? p.rSpeck : lerp(p.rMin, p.rMax, m))
      break
    case 'crosses':
      if (speck) {
        s.line(k, cx - stroke / 2, cy, cx + stroke / 2, cy)
      } else {
        const a = lerp(1.1 * stroke, Math.max(0.46 * d, 1.1 * stroke), m)
        s.line(k, cx - a, cy, cx + a, cy)
        s.line(k, cx, cy - a, cx, cy + a)
      }
      break
    case 'hatch': {
      if (speck) {
        s.line(k, cx - stroke / 2, cy, cx + stroke / 2, cy)
        break
      }
      // '/', '\', '|', '—' arrive one after another; the newest is partly drawn so density grows smoothly
      const t = m * 4
      const diag = 0.42 * d
      const half = 0.46 * d
      const f0 = (0.3 + 0.7 * Math.min(t, 1)) * diag
      s.line(k, cx - f0, cy + f0, cx + f0, cy - f0)
      const f1 = clamp(t - 1, 0, 1) * diag
      if (f1 > 0) s.line(k, cx - f1, cy - f1, cx + f1, cy + f1)
      const f2 = clamp(t - 2, 0, 1) * half
      if (f2 > 0) s.line(k, cx, cy - f2, cx, cy + f2)
      const f3 = clamp(t - 3, 0, 1) * half
      if (f3 > 0) s.line(k, cx - f3, cy, cx + f3, cy)
      break
    }
    case 'ascii':
      s.glyph(k, cx, cy + p.fontSize * 0.35, speck ? '.' : ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.floor(m * ASCII_RAMP.length))])
      break
  }
}

/** Walk the grid and hand every mark to `s`. Marks are strength-sized by brightness above the floor. */
function eachMark(grid: CellGrid, f: ParamValues, p: Plan, seed: number, s: Sink) {
  const { cols, rows, cw, ch, ox, oy, lum, rgb } = grid
  const floor = nv(f, 'floor')
  const stray = nv(f, 'scatter') * 0.06
  const dot = sv(f, 'empty') === 'dot'
  const source = sv(f, 'colorMode') === 'source'
  const light = isLight(f)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const v = lum[i]
      let m: number
      if (v >= floor) {
        m = floor < 1 ? (v - floor) / (1 - floor) : 1
      } else {
        // the same draw both picks the strays and sizes them, so a given seed always scatters the same way
        const u = stray > 0 ? hash(seed, i) : 1
        if (u < stray) m = 0.08 + 0.37 * (u / stray)
        else if (dot) m = -1
        else continue
      }
      mark(s, p, source ? sourceKey(rgb, i, light) : 0, ox + c * cw, oy + r * ch, m)
    }
  }
}

/**
 * Paint the filtered artwork: a full background fill, then one glyph per cell.
 * `g`'s current transform must map artwork units to pixels; the function leaves it unchanged.
 * Deterministic from `seed` (scatter), so previews, PNGs and video frames match.
 */
export function drawFilter(g: CanvasRenderingContext2D, grid: CellGrid, f: ParamValues, w: number, h: number, seed: number): void {
  const p = plan(grid, f)
  const ink = sv(f, 'ink')
  g.save()
  g.fillStyle = sv(f, 'background')
  g.fillRect(0, 0, w, h)
  if (p.style === 'ascii') {
    g.font = `${ASCII_WEIGHT} ${p.fontSize}px ${ASCII_FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
  }

  // Strokes and fills are batched into one path per colour: thousands of tiny stroke() calls would crawl
  const paths = new Map<Key, { lines: Path2D; dots: Path2D }>()
  let lastKey = -1
  let last: { lines: Path2D; dots: Path2D }
  const bucket = (k: Key) => {
    if (k !== lastKey) {
      lastKey = k
      let b = paths.get(k)
      if (!b) paths.set(k, (b = { lines: new Path2D(), dots: new Path2D() }))
      last = b
    }
    return last
  }
  let filled = -1
  eachMark(grid, f, p, seed, {
    line(k, x1, y1, x2, y2) {
      const l = bucket(k).lines
      l.moveTo(x1, y1)
      l.lineTo(x2, y2)
    },
    dot(k, x, y, r) {
      const d = bucket(k).dots
      d.moveTo(x + r, y)
      d.arc(x, y, r, 0, TAU)
    },
    glyph(k, x, y, c) {
      if (k !== filled) {
        filled = k
        g.fillStyle = keyColor(k, ink)
      }
      g.fillText(c, x, y)
    },
  })

  g.lineWidth = p.stroke
  g.lineCap = 'butt'
  for (const [k, b] of paths) {
    const color = keyColor(k, ink)
    g.strokeStyle = color
    g.stroke(b.lines)
    g.fillStyle = color
    g.fill(b.dots)
  }
  g.restore()
}

/** Inner SVG for the marks alone, without a background. */
function marksSvg(grid: CellGrid, f: ParamValues, seed: number): string {
  const p = plan(grid, f)
  const ink = escapeXml(sv(f, 'ink'))
  const buckets = new Map<Key, { d: string; dots: string; text: string }>()
  let lastKey = -1
  let last: { d: string; dots: string; text: string }
  const bucket = (k: Key) => {
    if (k !== lastKey) {
      lastKey = k
      let b = buckets.get(k)
      if (!b) buckets.set(k, (b = { d: '', dots: '', text: '' }))
      last = b
    }
    return last
  }
  eachMark(grid, f, p, seed, {
    line(k, x1, y1, x2, y2) {
      // vertical and horizontal runs, nearly all of them, shed a coordinate
      const end = x1 === x2 ? `V${r2(y2)}` : y1 === y2 ? `H${r2(x2)}` : `L${r2(x2)},${r2(y2)}`
      bucket(k).d += `M${r2(x1)},${r2(y1)}${end}`
    },
    dot(k, x, y, r) {
      bucket(k).dots += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}"/>`
    },
    glyph(k, x, y, c) {
      bucket(k).text += `<text x="${r2(x)}" y="${r2(y)}">${c}</text>`
    },
  })

  let lines = ''
  let dots = ''
  let text = ''
  for (const [k, b] of buckets) {
    const color = keyColor(k, ink)
    if (b.d) lines += `<path d="${b.d}" stroke="${color}"/>`
    if (b.dots) dots += `<g fill="${color}">${b.dots}</g>`
    if (b.text) text += `<g fill="${color}">${b.text}</g>`
  }
  return (
    (lines ? `<g fill="none" stroke-width="${p.stroke}">${lines}</g>` : '') +
    dots +
    (text ? `<g font-family="${ASCII_FONT}" font-weight="${ASCII_WEIGHT}" font-size="${p.fontSize}" text-anchor="middle">${text}</g>` : '')
  )
}

/** The same picture as `drawFilter`, as inner SVG markup (no <svg> wrapper), for vector export. */
export function filterSvg(grid: CellGrid, f: ParamValues, w: number, h: number, seed: number): string {
  return `<rect width="${w}" height="${h}" fill="${escapeXml(sv(f, 'background'))}"/>` + marksSvg(grid, f, seed)
}

/** Swatch geometry per style: columns, rows and stroke weight, sized to read at icon scale. */
const SWATCH: Record<string, [number, number, number]> = {
  ticks: [11, 2, 0.32],
  dashes: [5, 5, 0.34],
  dots: [8, 4, 0.9],
  crosses: [6, 3, 0.16],
  hatch: [7, 3, 0.16],
  ascii: [9, 3, 0.26],
}

/**
 * A small self-contained swatch of a style (inner SVG markup for a w×h viewBox): the style drawn over
 * a left-to-right brightness ramp, used as the icon on the style picker.
 * Uses `currentColor` for the marks and no background, so it inherits the UI's text colour.
 */
export function styleSwatch(style: string, w: number, h: number): string {
  const spec = SWATCH[style]
  if (!spec) {
    // "off" has nothing to draw, so a quiet slash
    return `<path d="M${r2(w * 0.32)},${r2(h * 0.78)}L${r2(w * 0.68)},${r2(h * 0.22)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>`
  }
  const [cols, rows, weight] = spec
  const pad = Math.min(w, h) * 0.08
  const cw = (w - 2 * pad) / cols
  const ch = (h - 2 * pad) / rows
  const lum = new Float32Array(cols * rows)
  for (let i = 0; i < lum.length; i++) lum[i] = (i % cols) / (cols - 1)
  const grid: CellGrid = { cols, rows, cw, ch, ox: pad, oy: pad, lum, rgb: new Uint8ClampedArray(cols * rows * 3) }
  const f: ParamValues = { style, weight, anchor: 'center', floor: 0.06, empty: 'dot', scatter: 0, colorMode: 'mono', ink: 'currentColor' }
  return marksSvg(grid, f, 0)
}
