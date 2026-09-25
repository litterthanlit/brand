/** Seeded PRNG (mulberry32). Every tool is deterministic from its seed. */
export interface Rng {
  (): number
  range(min: number, max: number): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  chance(p: number): boolean
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  next.range = (min, max) => min + next() * (max - min)
  next.int = (min, max) => Math.floor(next.range(min, max + 1))
  next.pick = (items) => items[Math.floor(next() * items.length)]
  next.chance = (p) => next() < p
  next.shuffle = (items) => {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return next
}

export const newSeed = () => Math.floor(Math.random() * 1_000_000)
