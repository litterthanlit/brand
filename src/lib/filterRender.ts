import type { ParamValues, ToolDef } from '../tools/types'
import { composeSvg, drawCanvasTool, renderContentSvg, sizeOf, type DocState } from './engine'
import { filterSvg, sampleCells, sampleScale, type CellGrid } from './filter'
import { rasterise } from './raster'

/**
 * The one path from a tool + state + loop phase to the filter's cell grid.
 * Preview, PNG, video and SVG export all go through it, so they sample identically.
 * It is split in two: rendering the artwork (slow, cached) and sampling it into cells (fast, per filter change).
 */

export interface ArtworkSource {
  /** The artwork at sampling resolution, covering the whole w × h document. */
  image: CanvasImageSource
  width: number
  height: number
}

interface Entry {
  key: string
  /** Params are replaced, never mutated, so identity says whether the artwork can have changed. */
  params: ParamValues
  source: ArtworkSource | Promise<ArtworkSource>
}

// A few entries are enough: the artwork being filtered, plus the one the user just stepped away from.
const CACHE_SIZE = 4
const cache: Entry[] = []

// Playback re-renders every frame, so caching it would only churn memory. Frames draw into one
// shared canvas instead, which is safe because they are sampled in the same tick they are drawn.
let scratch: HTMLCanvasElement | null = null

function drawSource(tool: ToolDef, state: DocState, canvas: HTMLCanvasElement, scale: number, t: number): ArtworkSource {
  drawCanvasTool(tool, state, canvas, scale, t)
  return { image: canvas, width: canvas.width, height: canvas.height }
}

async function svgSource(tool: ToolDef, state: DocState, t: number): Promise<ArtworkSource> {
  const { w, h } = sizeOf(state)
  return { image: await rasterise(renderContentSvg(tool, state, t)), width: w, height: h }
}

/**
 * Render a tool's artwork for sampling. Canvas tools come back synchronously, SVG tools after rasterising.
 *
 * Results are cached by tool, params, seed, format, `t` and scale, so dragging a filter control on a
 * heavy static tool only re-samples. Pass `live` when `t` changes every call (playback, video frames):
 * the result is then uncached, and a canvas source is only valid until the next live call.
 */
export function artworkSource(tool: ToolDef, state: DocState, t: number, live = false): ArtworkSource | Promise<ArtworkSource> {
  const { w, h } = sizeOf(state)
  const canvasTool = tool.kind === 'canvas'
  const scale = canvasTool ? sampleScale(state.filter, w, h) : 1

  if (live) {
    if (!canvasTool) return svgSource(tool, state, t)
    scratch ??= document.createElement('canvas')
    const g = scratch.getContext('2d')!
    // a reused canvas keeps the last frame (and its transform), which a tool that doesn't paint every pixel would inherit
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, scratch.width, scratch.height)
    return drawSource(tool, state, scratch, scale, t)
  }

  const key = `${tool.id}|${state.seed}|${state.format}|${t}|${scale}`
  const hit = cache.findIndex((e) => e.key === key && e.params === state.params)
  if (hit >= 0) {
    const [entry] = cache.splice(hit, 1)
    cache.push(entry)
    return entry.source
  }

  // each entry owns its canvas, so a later draw can never repaint a cached source
  const source = canvasTool ? drawSource(tool, state, document.createElement('canvas'), scale, t) : svgSource(tool, state, t)
  const entry: Entry = { key, params: state.params, source }
  cache.push(entry)
  if (cache.length > CACHE_SIZE) cache.shift()
  if (source instanceof Promise) {
    source.catch(() => {
      const i = cache.indexOf(entry)
      if (i >= 0) cache.splice(i, 1)
    })
  }
  return entry.source
}

const sample = (source: ArtworkSource, state: DocState): CellGrid => {
  const { w, h } = sizeOf(state)
  return sampleCells(source.image, source.width, source.height, state.filter, w, h)
}

/** The artwork sampled into the filter's cells. Synchronous for canvas tools, a promise for SVG tools. */
export function filterGrid(tool: ToolDef, state: DocState, t: number, live = false): CellGrid | Promise<CellGrid> {
  const source = artworkSource(tool, state, t, live)
  return source instanceof Promise ? source.then((s) => sample(s, state)) : sample(source, state)
}

/** Complete single-file SVG of the filtered artwork, with grain, vignette and type on top. */
export async function renderFilteredSvg(tool: ToolDef, state: DocState): Promise<string> {
  const { w, h } = sizeOf(state)
  const grid = await filterGrid(tool, state, 0)
  return composeSvg(state, filterSvg(grid, state.filter, w, h, state.seed))
}
