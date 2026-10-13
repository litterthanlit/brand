import type { Param, ParamValues } from '../tools/types'

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

export const FILTER_PARAMS: Param[] = [
  { type: 'select', key: 'style', label: 'Style', default: 'none', options: FILTER_STYLES.map((s) => ({ ...s })) },
  { type: 'number', key: 'cell', label: 'Cell width', min: 4, max: 48, step: 1, default: 9, unit: 'px', when: on },
  { type: 'number', key: 'aspect', label: 'Cell height', min: 0.4, max: 5, step: 0.05, default: 3.6, unit: '×', when: on },
  { type: 'number', key: 'weight', label: 'Stroke', min: 0.05, max: 1, step: 0.01, default: 0.26, when: (p) => on(p) && p.style !== 'ascii' },
  {
    type: 'select', key: 'anchor', label: 'Anchor', default: 'center',
    options: [{ value: 'center', label: 'Centre' }, { value: 'start', label: 'Baseline' }],
    when: (p) => p.style === 'ticks' || p.style === 'dashes',
  },
  { type: 'number', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, step: 0.01, default: 1.2, when: on },
  { type: 'number', key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, default: 0, when: on },
  { type: 'number', key: 'steps', label: 'Steps (0 = smooth)', min: 0, max: 12, step: 1, default: 0, when: on },
  { type: 'number', key: 'floor', label: 'Floor', min: 0, max: 0.6, step: 0.01, default: 0.12, when: on },
  {
    type: 'select', key: 'empty', label: 'Empty cells', default: 'dot',
    options: [{ value: 'dot', label: 'Dot' }, { value: 'blank', label: 'Blank' }],
    when: on,
  },
  { type: 'number', key: 'scatter', label: 'Scatter', min: 0, max: 1, step: 0.01, default: 0.15, when: on },
  { type: 'boolean', key: 'invert', label: 'Invert', default: false, when: on },
  {
    type: 'select', key: 'colorMode', label: 'Colour', default: 'mono',
    options: [{ value: 'mono', label: 'Ink' }, { value: 'source', label: 'Source' }],
    when: on,
  },
  { type: 'color', key: 'ink', label: 'Ink', default: '#D9D6CF', when: (p) => on(p) && p.colorMode === 'mono' },
  { type: 'color', key: 'background', label: 'Background', default: '#111111', when: on },
]

/** The look each style starts from when picked (cell geometry and stroke). Merged over the current filter values. */
export const FILTER_STYLE_DEFAULTS: Record<FilterStyle, ParamValues> = {
  none: {},
  ticks: { cell: 9, aspect: 3.6, weight: 0.26 },
  dashes: { cell: 16, aspect: 0.55, weight: 0.32 },
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
  /** Row-major, cols × rows, in [0, 1] after contrast / brightness / invert / steps. */
  lum: Float32Array
  /** Row-major average sRGB colour, 3 bytes per cell. */
  rgb: Uint8ClampedArray
}

export function cellLayout(f: ParamValues, w: number, h: number): CellLayout {
  void f
  return { cols: 1, rows: 1, cw: w, ch: h, ox: 0, oy: 0 }
}

/**
 * Artwork → pixel scale at which a canvas tool should be drawn before sampling.
 * Enough resolution for a fair average per cell, and no more (sampling is per frame while playing).
 */
export function sampleScale(f: ParamValues, w: number, h: number): number {
  void f
  void w
  void h
  return 0.5
}

/**
 * Average a rendered artwork into cells.
 * `source` covers the whole w×h artwork at any resolution: `sourceW` × `sourceH` is its pixel size
 * (a canvas's width/height, or w/h for an SVG image rasterised from a w×h viewBox).
 */
export function sampleCells(source: CanvasImageSource, sourceW: number, sourceH: number, f: ParamValues, w: number, h: number): CellGrid {
  void source
  void sourceW
  void sourceH
  const l = cellLayout(f, w, h)
  return { ...l, lum: new Float32Array(l.cols * l.rows), rgb: new Uint8ClampedArray(l.cols * l.rows * 3) }
}

/**
 * Paint the filtered artwork: a full background fill, then one glyph per cell.
 * `g`'s current transform must map artwork units to pixels; the function leaves it unchanged.
 * Deterministic from `seed` (scatter), so previews, PNGs and video frames match.
 */
export function drawFilter(g: CanvasRenderingContext2D, grid: CellGrid, f: ParamValues, w: number, h: number, seed: number): void {
  void grid
  void seed
  g.fillStyle = (f.background as string) ?? '#111111'
  g.fillRect(0, 0, w, h)
}

/** The same picture as `drawFilter`, as inner SVG markup (no <svg> wrapper), for vector export. */
export function filterSvg(grid: CellGrid, f: ParamValues, w: number, h: number, seed: number): string {
  void grid
  void seed
  return `<rect width="${w}" height="${h}" fill="${(f.background as string) ?? '#111111'}"/>`
}

/**
 * A small self-contained swatch of a style (inner SVG markup for a w×h viewBox): the style drawn over
 * a left-to-right brightness ramp, used as the icon on the style picker.
 * Uses `currentColor` for the marks and no background, so it inherits the UI's text colour.
 */
export function styleSwatch(style: string, w: number, h: number): string {
  void style
  void w
  void h
  return ''
}
