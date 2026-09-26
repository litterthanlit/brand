/** Seeded 2D/3D simplex noise (after Stefan Gustavson). Output range ≈ [-1, 1]. */
import { createRng } from './random'

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
]

export interface Noise {
  n2(x: number, y: number): number
  n3(x: number, y: number, z: number): number
  /** Seamlessly looping 2D noise: t in [0,1) walks a circle of `radius` through the third axis pair. */
  loop(x: number, y: number, t: number, radius?: number): number
}

export function createNoise(seed: number): Noise {
  const rng = createRng(seed ^ 0x9e3779b9)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  const perm = new Uint8Array(512)
  const permMod12 = new Uint8Array(512)
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]
    permMod12[i] = perm[i] % 12
  }

  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  const F3 = 1 / 3
  const G3 = 1 / 6

  function n2(xin: number, yin: number) {
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let n = 0
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 > 0) {
      const g = GRAD3[permMod12[ii + perm[jj]]]
      t0 *= t0
      n += t0 * t0 * (g[0] * x0 + g[1] * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 > 0) {
      const g = GRAD3[permMod12[ii + i1 + perm[jj + j1]]]
      t1 *= t1
      n += t1 * t1 * (g[0] * x1 + g[1] * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 > 0) {
      const g = GRAD3[permMod12[ii + 1 + perm[jj + 1]]]
      t2 *= t2
      n += t2 * t2 * (g[0] * x2 + g[1] * y2)
    }
    return 70 * n
  }

  function n3(xin: number, yin: number, zin: number) {
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const z0 = zin - (k - t)
    let i1, j1, k1, i2, j2, k2
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3
    const ii = i & 255, jj = j & 255, kk = k & 255
    const corners: [number, number, number, number][] = [
      [x0, y0, z0, permMod12[ii + perm[jj + perm[kk]]]],
      [x1, y1, z1, permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]],
      [x2, y2, z2, permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]],
      [x3, y3, z3, permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]],
    ]
    let n = 0
    for (const [x, y, z, gi] of corners) {
      let tt = 0.6 - x * x - y * y - z * z
      if (tt > 0) {
        const g = GRAD3[gi]
        tt *= tt
        n += tt * tt * (g[0] * x + g[1] * y + g[2] * z)
      }
    }
    return 32 * n
  }

  return {
    n2,
    n3,
    loop(x, y, t, radius = 0.6) {
      const a = t * Math.PI * 2
      return n3(x + Math.cos(a) * radius, y + Math.sin(a) * radius, Math.sin(a) * radius * 0.5)
    },
  }
}
