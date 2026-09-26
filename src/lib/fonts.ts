/**
 * Self-hosted fonts used inside artwork (not the UI).
 * Registered with the FontFace API for live previews, and embedded as base64
 * @font-face rules in exported SVGs so PNG/video/SVG output matches the preview.
 */
import it400 from '@fontsource/inter-tight/files/inter-tight-latin-400-normal.woff2?url'
import it500 from '@fontsource/inter-tight/files/inter-tight-latin-500-normal.woff2?url'
import it600 from '@fontsource/inter-tight/files/inter-tight-latin-600-normal.woff2?url'
import it700 from '@fontsource/inter-tight/files/inter-tight-latin-700-normal.woff2?url'
import it800 from '@fontsource/inter-tight/files/inter-tight-latin-800-normal.woff2?url'
import jb400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url'
import jb500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url'
import jb700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url'
import jb800 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-800-normal.woff2?url'

const FAMILIES: Record<string, Record<number, string>> = {
  'Inter Tight': { 400: it400, 500: it500, 600: it600, 700: it700, 800: it800 },
  'JetBrains Mono': { 400: jb400, 500: jb500, 700: jb700, 800: jb800 },
}

const nearest = (available: number[], w: number) =>
  available.reduce((best, a) => (Math.abs(a - w) < Math.abs(best - w) ? a : best), available[0])

/** Register every artwork font and wait (bounded) for them, so text measurement is accurate from the first render. */
export async function loadArtworkFonts(timeoutMs = 2500) {
  if (typeof FontFace === 'undefined') return
  const loads: Promise<unknown>[] = []
  for (const [family, weights] of Object.entries(FAMILIES)) {
    for (const [weight, url] of Object.entries(weights)) {
      const face = new FontFace(family, `url(${url}) format('woff2')`, { weight, display: 'block' })
      document.fonts.add(face)
      loads.push(face.load().catch(() => undefined))
    }
  }
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeoutMs))])
}

const dataUrlCache = new Map<string, Promise<string>>()
function toDataUrl(url: string) {
  let hit = dataUrlCache.get(url)
  if (!hit) {
    hit = fetch(url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader()
            fr.onload = () => resolve(fr.result as string)
            fr.onerror = () => reject(fr.error)
            fr.readAsDataURL(blob)
          }),
      )
    dataUrlCache.set(url, hit)
  }
  return hit
}

/** Build a <style> block embedding only the families and weights an SVG actually references. */
export async function fontStyleFor(svg: string) {
  const weights = new Set<number>([400])
  for (const m of svg.matchAll(/font-weight="(\d+)"/g)) weights.add(Number(m[1]))
  const rules: string[] = []
  for (const [family, files] of Object.entries(FAMILIES)) {
    if (!svg.includes(family)) continue
    const available = Object.keys(files).map(Number)
    const used = new Set([...weights].map((w) => nearest(available, w)))
    for (const w of used) {
      const data = await toDataUrl(files[w])
      rules.push(`@font-face{font-family:'${family}';font-weight:${w};src:url(${data}) format('woff2');}`)
    }
  }
  return rules.length ? `<style>${rules.join('')}</style>` : ''
}

/** Insert embedded fonts right after the opening <svg> tag. */
export async function withEmbeddedFonts(svg: string) {
  const style = await fontStyleFor(svg)
  if (!style) return svg
  const i = svg.indexOf('>') + 1
  return svg.slice(0, i) + style + svg.slice(i)
}
