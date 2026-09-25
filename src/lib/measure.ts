let ctx: CanvasRenderingContext2D | null = null

/** Measure text width with the browser's font engine (same fallback chain the SVG will use). */
export function measureText(text: string, font: string) {
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * 10
  ctx.font = font
  return ctx.measureText(text).width
}
