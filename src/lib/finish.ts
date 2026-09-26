import type { Param, ParamValues } from '../tools/types'
import { r2 } from './svg'

/** Global "finish" controls, applied on top of every tool. */
export const FINISH_PARAMS: Param[] = [
  { type: 'number', key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, default: 0 },
  {
    type: 'select', key: 'grainType', label: 'Grain type', default: 'soft',
    options: [{ value: 'soft', label: 'Soft' }, { value: 'speckle', label: 'Speckle' }, { value: 'light', label: 'Dust' }],
    when: (p) => (p.grain as number) > 0,
  },
  { type: 'number', key: 'grainSize', label: 'Grain size', min: 0.5, max: 4, step: 0.1, default: 1, when: (p) => (p.grain as number) > 0 },
  { type: 'number', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, default: 0 },
]

export interface FinishLayer {
  /** Inner SVG markup for the grain layer, or '' when off. */
  grain: string
  /** How the grain composites onto the artwork (CSS mix-blend-mode / canvas composite op). */
  blend: 'overlay' | 'normal'
  /** Inner SVG markup drawn normally above the artwork (vignette). */
  vignette: string
}

export function renderFinish(f: ParamValues, w: number, h: number, seed: number, uid: string): FinishLayer {
  const amount = (f.grain as number) ?? 0
  const size = (f.grainSize as number) ?? 1
  const kind = (f.grainType as string) ?? 'soft'
  let grain = ''
  let blend: FinishLayer['blend'] = 'overlay'
  if (amount > 0) {
    const id = `grain-${uid}`
    // filter units are artwork pixels, so grain density is identical at every export scale
    const freq = r2(0.8 / size)
    const turb = `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed % 997}" stitchTiles="stitch"/>`
    if (kind === 'soft') {
      grain =
        `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${turb}<feColorMatrix type="saturate" values="0"/></filter>` +
        `<rect width="${w}" height="${h}" filter="url(#${id})" opacity="${r2(Math.min(1, amount * 1.1))}"/>`
    } else {
      // Map noise to sparse opaque specks: alpha = k·(n − threshold)
      blend = 'normal'
      // sparse: roughly 1–6% coverage across the slider, like dust on a print
      const k = 30
      const threshold = 0.76 - amount * 0.09
      const c = kind === 'light' ? 1 : 0
      grain =
        `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${turb}` +
        `<feColorMatrix type="matrix" values="0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 0 ${c} ${k} 0 0 0 ${r2(-k * threshold)}"/></filter>` +
        `<rect width="${w}" height="${h}" filter="url(#${id})" opacity="${r2(0.45 + amount * 0.45)}"/>`
    }
  }
  const v = (f.vignette as number) ?? 0
  let vignette = ''
  if (v > 0) {
    const id = `vig-${uid}`
    vignette =
      `<radialGradient id="${id}" cx="50%" cy="50%" r="75%"><stop offset="${r2(0.55 - v * 0.25)}" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${r2(v * 0.75)}"/></radialGradient>` +
      `<rect width="${w}" height="${h}" fill="url(#${id})"/>`
  }
  return { grain, blend, vignette }
}
