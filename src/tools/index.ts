import { bauhaus } from './bauhaus'
import { blob } from './blob'
import { dither } from './dither'
import { flowField } from './flowField'
import { halftone } from './halftone'
import { meshGradient } from './meshGradient'
import { rings } from './rings'
import { stamp } from './stamp'
import { sunburst } from './sunburst'
import { topography } from './topography'
import { truchet } from './truchet'
import { typeRepeat } from './typeRepeat'
import type { Category, ToolDef } from './types'
import { waves } from './waves'

/** Order here is the order in the gallery and sidebar. Add new tools to this list. */
export const TOOLS: ToolDef[] = [
  halftone, meshGradient, dither, stamp, bauhaus, flowField, truchet, blob, topography, typeRepeat, sunburst, waves, rings,
]

export const CATEGORIES: Category[] = ['Pattern', 'Shape', 'Texture', 'Type', 'Image']

export const getTool = (id: string) => TOOLS.find((t) => t.id === id)
