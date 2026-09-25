import { createRng } from './random'

const cache = new Map<number, HTMLCanvasElement>()

/** A seeded 256×256 grey-noise tile, used as a repeating overlay pattern. */
export function grainTile(seed: number) {
  const hit = cache.get(seed)
  if (hit) return hit
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  const rng = createRng(seed)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rng() * 255)
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  if (cache.size > 16) cache.clear()
  cache.set(seed, c)
  return c
}

/** Overlay pixel-true grain across the whole canvas regardless of the current transform. */
export function applyGrain(g: CanvasRenderingContext2D, seed: number, amount: number) {
  if (amount <= 0) return
  const pattern = g.createPattern(grainTile(seed), 'repeat')
  if (!pattern) return
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalAlpha = Math.min(1, amount)
  g.globalCompositeOperation = 'overlay'
  g.fillStyle = pattern
  g.fillRect(0, 0, g.canvas.width, g.canvas.height)
  g.restore()
}
