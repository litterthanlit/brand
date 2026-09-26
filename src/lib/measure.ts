let ctx: CanvasRenderingContext2D | null = null

/** Measure text width with the browser's font engine (same fallback chain the SVG will use). */
export function measureText(text: string, font: string) {
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * 10
  ctx.font = font
  return ctx.measureText(text).width
}

export interface TextRaster {
  data: Uint8ClampedArray
  width: number
  height: number
  /** Ink bounds within the raster. */
  top: number
  bottom: number
  left: number
  right: number
}

const rasterCache = new Map<string, TextRaster>()

/** Rasterise text in white on transparent at `size` px; used to rebuild letterforms from bars. */
export function rasterizeText(text: string, font: (size: number) => string, size: number): TextRaster {
  const key = `${text}|${font(size)}`
  const hit = rasterCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.font = font(size)
  const m = g.measureText(text)
  const pad = Math.ceil(size * 0.2)
  const asc = Math.ceil(m.actualBoundingBoxAscent || size * 0.8)
  const desc = Math.ceil(m.actualBoundingBoxDescent || size * 0.2)
  const left = Math.ceil(m.actualBoundingBoxLeft || 0)
  const right = Math.ceil(m.actualBoundingBoxRight || m.width)
  c.width = left + right + pad * 2
  c.height = asc + desc + pad * 2
  g.font = font(size)
  g.fillStyle = '#fff'
  g.textBaseline = 'alphabetic'
  g.fillText(text, pad + left, pad + asc)
  const out: TextRaster = {
    data: g.getImageData(0, 0, c.width, c.height).data,
    width: c.width,
    height: c.height,
    top: pad,
    bottom: pad + asc + desc,
    left: pad,
    right: pad + left + right,
  }
  if (rasterCache.size > 40) rasterCache.clear()
  rasterCache.set(key, out)
  return out
}
