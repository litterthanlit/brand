import type { Param, ParamValues, Preset, RenderCtx, ToolDef } from '../tools/types'
import { isHex } from './color'
import { FINISH_PARAMS, renderFinish } from './finish'
import { FORMATS, getFormat } from './formats'
import { createNoise, type Noise } from './noise'
import { PALETTES } from './palettes'
import { createRng, newSeed } from './random'
import { wrapSvg } from './svg'
import { renderTypeLayer, TYPE_PARAMS } from './typeLayer'

export interface DocState {
  seed: number
  format: string
  params: ParamValues
  /** Global grain / vignette layer. */
  finish: ParamValues
  /** Global editorial text layer. */
  type: ParamValues
}

export function defaultsFrom(params: Param[]): ParamValues {
  const out: ParamValues = {}
  for (const param of params) out[param.key] = Array.isArray(param.default) ? [...param.default] : param.default
  return out
}

export const defaultParams = (tool: ToolDef) => defaultsFrom(tool.params)

/** Apply a preset (or a tool's layer defaults) over clean defaults. */
export function stateFromPreset(tool: ToolDef, preset: Omit<Preset, 'name'> = {}, format?: string): DocState {
  const base = tool.defaults ?? {}
  const f = preset.format ?? format ?? base.format ?? 'square'
  return {
    seed: preset.seed ?? base.seed ?? 7,
    format: FORMATS.some((x) => x.id === f) ? f : 'square',
    params: sanitizeParams(tool, preset.params ?? {}),
    finish: sanitizeValues(FINISH_PARAMS, { ...base.finish, ...preset.finish }),
    type: sanitizeValues(TYPE_PARAMS, { ...base.type, ...preset.type }),
  }
}

export function defaultState(tool: ToolDef): DocState {
  return stateFromPreset(tool)
}

function fitPalette(colors: string[], param: Extract<Param, { type: 'palette' }>) {
  const min = param.min ?? 2
  const max = param.max ?? 8
  const out = colors.filter(isHex).slice(0, max)
  if (!out.length) return [...param.default]
  // cycle colours if the palette is too short for this tool
  for (let i = 0; out.length < min; i++) out.push(out[i % out.length])
  return out
}

/** Coerce any (possibly URL-sourced, possibly stale) param values into valid ones. */
export const sanitizeParams = (tool: ToolDef, raw: Partial<ParamValues>) => sanitizeValues(tool.params, raw)

export function sanitizeValues(params: Param[], raw: Partial<ParamValues>): ParamValues {
  const out = defaultsFrom(params)
  for (const param of params) {
    const v = raw[param.key]
    if (v === undefined) continue
    switch (param.type) {
      case 'number':
        if (typeof v === 'number' && Number.isFinite(v)) out[param.key] = Math.max(param.min, Math.min(param.max, v))
        break
      case 'color':
        if (isHex(v)) out[param.key] = v
        break
      case 'boolean':
        if (typeof v === 'boolean') out[param.key] = v
        break
      case 'text':
        if (typeof v === 'string') out[param.key] = v.slice(0, param.maxLength ?? 200)
        break
      case 'select':
        if (param.options.some((o) => o.value === v)) out[param.key] = v
        break
      case 'palette':
        if (Array.isArray(v)) out[param.key] = fitPalette(v as string[], param)
        break
      case 'image':
        if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) out[param.key] = v
        break
    }
  }
  return out
}

const snap = (v: number, step: number, min: number) => Math.round((v - min) / step) * step + min

export function randomizeParams(tool: ToolDef, current: ParamValues, locked: Set<string>): ParamValues {
  const next: ParamValues = { ...current }
  const r = Math.random
  for (const param of tool.params) {
    if (locked.has(param.key) || param.randomize === false) continue
    switch (param.type) {
      case 'number': {
        const [lo, hi] = param.rand ?? [param.min, param.max]
        next[param.key] = +snap(lo + r() * (hi - lo), param.step, param.min).toFixed(4)
        break
      }
      case 'color': {
        const p = PALETTES[Math.floor(r() * PALETTES.length)].colors
        next[param.key] = p[Math.floor(r() * p.length)]
        break
      }
      case 'boolean':
        next[param.key] = r() < 0.5
        break
      case 'select':
        next[param.key] = param.options[Math.floor(r() * param.options.length)].value
        break
      case 'text':
        if (param.suggestions?.length) next[param.key] = param.suggestions[Math.floor(r() * param.suggestions.length)]
        break
      case 'palette':
        next[param.key] = fitPalette(PALETTES[Math.floor(r() * PALETTES.length)].colors, param)
        break
    }
  }
  return next
}

export const randomizeState = (tool: ToolDef, s: DocState, locked: Set<string>): DocState => ({
  ...s,
  seed: newSeed(),
  params: randomizeParams(tool, s.params, locked),
})

// Noise tables are the only non-trivial setup cost, so reuse them per seed.
const noiseCache = new Map<number, Noise>()
function noiseFor(seed: number) {
  let n = noiseCache.get(seed)
  if (!n) {
    if (noiseCache.size > 32) noiseCache.clear()
    n = createNoise(seed)
    noiseCache.set(seed, n)
  }
  return n
}

let uidCounter = 0

export function makeCtx(state: DocState, t: number, w: number, h: number): RenderCtx {
  return {
    w,
    h,
    p: state.params,
    rng: createRng(state.seed),
    noise: noiseFor(state.seed),
    t,
    seed: state.seed,
    uid: (++uidCounter).toString(36),
  }
}

export function sizeOf(state: DocState) {
  const f = getFormat(state.format)
  return { w: f.w, h: f.h }
}

/** The tool's own artwork as a standalone SVG (no finish or type). */
export function renderContentSvg(tool: ToolDef, state: DocState, t = 0) {
  if (tool.kind !== 'svg') throw new Error(`${tool.id} is not an SVG tool`)
  const { w, h } = sizeOf(state)
  return wrapSvg(w, h, tool.render(makeCtx(state, t, w, h)))
}

export interface Layers {
  /** Grain layer SVG ('' when off) and how it blends onto the artwork. */
  grain: string
  blend: 'overlay' | 'normal'
  /** Vignette + editorial type, drawn normally on top ('' when empty). */
  overlay: string
}

/** Static layers above the artwork. They don't depend on animation time, so previews render them once. */
export function renderLayers(state: DocState): Layers {
  const { w, h } = sizeOf(state)
  const uid = (++uidCounter).toString(36)
  const f = renderFinish(state.finish, w, h, state.seed, uid)
  const type = renderTypeLayer(state.type, w, h)
  return {
    grain: f.grain ? wrapSvg(w, h, f.grain) : '',
    blend: f.blend,
    overlay: f.vignette || type ? wrapSvg(w, h, f.vignette + type) : '',
  }
}

/** Complete single-file SVG (artwork + grain + type) for SVG tools. */
export function renderSvg(tool: ToolDef, state: DocState, t = 0) {
  if (tool.kind !== 'svg') throw new Error(`${tool.id} is not an SVG tool`)
  const { w, h } = sizeOf(state)
  const uid = (++uidCounter).toString(36)
  const f = renderFinish(state.finish, w, h, state.seed, uid)
  const grain = f.grain ? (f.blend === 'overlay' ? `<g style="mix-blend-mode:overlay">${f.grain}</g>` : f.grain) : ''
  return wrapSvg(w, h, tool.render(makeCtx(state, t, w, h)) + grain + f.vignette + renderTypeLayer(state.type, w, h))
}

/** Draw a canvas tool (or rasterised SVG is handled by export) into `canvas` at `scale` px per unit. */
export function drawCanvasTool(tool: ToolDef, state: DocState, canvas: HTMLCanvasElement, scale: number, t = 0) {
  if (tool.kind !== 'canvas') throw new Error(`${tool.id} is not a canvas tool`)
  const { w, h } = sizeOf(state)
  const pw = Math.max(1, Math.round(w * scale))
  const ph = Math.max(1, Math.round(h * scale))
  if (canvas.width !== pw) canvas.width = pw
  if (canvas.height !== ph) canvas.height = ph
  const g = canvas.getContext('2d')!
  g.setTransform(pw / w, 0, 0, ph / h, 0, 0)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
  tool.draw({ ...makeCtx(state, t, w, h), g })
}
