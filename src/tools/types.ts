import type { Noise } from '../lib/noise'
import type { Rng } from '../lib/random'

interface BaseParam {
  key: string
  label: string
  /** Set false to keep this param fixed when the user hits Randomize. */
  randomize?: boolean
  /** Hide this control unless the predicate passes. */
  when?: (p: ParamValues) => boolean
}

export interface NumberParam extends BaseParam {
  type: 'number'
  min: number
  max: number
  step: number
  default: number
  unit?: string
  /** Narrower range used by Randomize, so random results stay tasteful. */
  rand?: [number, number]
}
export interface ColorParam extends BaseParam {
  type: 'color'
  default: string
}
export interface BooleanParam extends BaseParam {
  type: 'boolean'
  default: boolean
}
export interface TextParam extends BaseParam {
  type: 'text'
  default: string
  maxLength?: number
  /** Pool of values Randomize picks from. */
  suggestions?: string[]
}
export interface SelectParam extends BaseParam {
  type: 'select'
  options: { value: string; label: string }[]
  default: string
}
export interface PaletteParam extends BaseParam {
  type: 'palette'
  default: string[]
  /** Number of colours this tool uses (UI shows exactly these swatches). */
  min?: number
  max?: number
}
export interface ImageParam extends BaseParam {
  type: 'image'
  default: null
  /** Extra params applied when an image is added (e.g. switch the source to "image"). */
  onSet?: ParamValues
}

export type Param = NumberParam | ColorParam | BooleanParam | TextParam | SelectParam | PaletteParam | ImageParam

export type ParamValue = number | string | boolean | string[] | ImageBitmap | null
export type ParamValues = Record<string, ParamValue>

export interface RenderCtx {
  w: number
  h: number
  /** Params, typed loosely: tools read with the helpers below. */
  p: ParamValues
  rng: Rng
  noise: Noise
  /** Loop phase in [0, 1). Always 0 for static renders. */
  t: number
  seed: number
  /** Unique per render; use it to namespace SVG ids (gradients, paths) so previews never collide. */
  uid: string
}

export type Category = 'Pattern' | 'Shape' | 'Texture' | 'Type' | 'Image'

interface BaseTool {
  id: string
  name: string
  category: Category
  description: string
  params: Param[]
  animated?: boolean
  /** Loop length in seconds when animated. */
  duration?: number
}

export interface SvgTool extends BaseTool {
  kind: 'svg'
  /** Returns inner SVG markup (no <svg> wrapper). */
  render(ctx: RenderCtx): string
}

export interface CanvasTool extends BaseTool {
  kind: 'canvas'
  draw(ctx: RenderCtx & { g: CanvasRenderingContext2D }): void
}

export type ToolDef = SvgTool | CanvasTool

// Typed param readers. Tools are the only consumers, so defaults are enforced upstream.
export const num = (p: ParamValues, k: string) => p[k] as number
export const str = (p: ParamValues, k: string) => p[k] as string
export const bool = (p: ParamValues, k: string) => p[k] as boolean
export const pal = (p: ParamValues, k: string) => p[k] as string[]
