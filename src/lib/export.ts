import type { ToolDef } from '../tools/types'
import { drawCanvasTool, renderContentSvg, renderLayers, renderSvg, sizeOf, type DocState } from './engine'
import { drawFilter, filterActive } from './filter'
import { filterGrid, renderFilteredSvg } from './filterRender'
import { withEmbeddedFonts } from './fonts'
import { loadSvgImage, rasterise } from './raster'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const fileBase = (tool: ToolDef, state: DocState) => `${tool.id}-${state.seed}`

/** The standalone SVG: the tool's own vector artwork, or the filter's marks when one is on (any tool kind). */
const vectorSvg = (tool: ToolDef, state: DocState) => (filterActive(state.filter) ? renderFilteredSvg(tool, state) : renderSvg(tool, state))

export async function exportSvg(tool: ToolDef, state: DocState) {
  const svg = await withEmbeddedFonts(await vectorSvg(tool, state))
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase(tool, state)}.svg`)
}

export async function copySvg(tool: ToolDef, state: DocState) {
  const svg = Promise.resolve().then(() => vectorSvg(tool, state))
  // Handing the clipboard a pending blob keeps the click's user gesture alive across the render; Safari rejects writeText after an await
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': svg.then((s) => new Blob([s], { type: 'text/plain' })) })])
      return
    } catch {
      // fall through to writeText
    }
  }
  await navigator.clipboard.writeText(await svg)
}

/**
 * Renders frames of a tool with its grain and type layers into a canvas.
 * The static layers are rasterised once and reused for every frame.
 */
export async function createCompositor(tool: ToolDef, state: DocState, scale: number) {
  const { w, h } = sizeOf(state)
  const layers = renderLayers(state)
  const grain = layers.grain ? await loadSvgImage(layers.grain) : null
  const overlay = layers.overlay ? await rasterise(layers.overlay) : null
  const pw = Math.round(w * scale)
  const ph = Math.round(h * scale)
  const filtered = filterActive(state.filter)

  return async function frame(canvas: HTMLCanvasElement, t = 0) {
    if (filtered) {
      // the same grid as the preview; static tools reuse its cached render, animated ones render per frame
      const grid = await filterGrid(tool, state, t, !!tool.animated)
      canvas.width = pw
      canvas.height = ph
      const g = canvas.getContext('2d')!
      g.setTransform(pw / w, 0, 0, ph / h, 0, 0)
      drawFilter(g, grid, state.filter, w, h, state.seed)
    } else if (tool.kind === 'canvas') {
      drawCanvasTool(tool, state, canvas, scale, t)
    } else {
      canvas.width = pw
      canvas.height = ph
      const img = await rasterise(renderContentSvg(tool, state, t))
      canvas.getContext('2d')!.drawImage(img, 0, 0, pw, ph)
    }
    const g = canvas.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    if (grain) {
      g.globalCompositeOperation = layers.blend === 'overlay' ? 'overlay' : 'source-over'
      g.drawImage(grain, 0, 0, pw, ph)
      g.globalCompositeOperation = 'source-over'
    }
    if (overlay) g.drawImage(overlay, 0, 0, pw, ph)
  }
}

export async function exportPng(tool: ToolDef, state: DocState, scale: number) {
  const canvas = document.createElement('canvas')
  const frame = await createCompositor(tool, state, scale)
  await frame(canvas, 0)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed')
  downloadBlob(blob, `${fileBase(tool, state)}${scale === 1 ? '' : `@${scale}x`}.png`)
}

export const canRecordVideo = () =>
  typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'

function pickMime() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

/**
 * Record one seamless loop of an animated tool as video.
 * Frames are rendered ahead of time, then played into the recorder in real time.
 */
export async function recordVideo(tool: ToolDef, state: DocState, onProgress?: (p: number) => void) {
  const fps = 30
  const seconds = tool.duration ?? 6
  const frames = Math.round(fps * seconds)
  const { w, h } = sizeOf(state)
  // keep the long side ≤ 1080 so encoding stays smooth on laptops
  const scale = Math.min(1, 1080 / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const g = canvas.getContext('2d')!

  const buffer: ImageBitmap[] = []
  const frameCanvas = document.createElement('canvas')
  const frame = await createCompositor(tool, state, scale)
  for (let i = 0; i < frames; i++) {
    await frame(frameCanvas, i / frames)
    buffer.push(await createImageBitmap(frameCanvas))
    onProgress?.((i / frames) * 0.5)
    // yield a task between frames so the page stays responsive and progress repaints
    await new Promise((r) => setTimeout(r, 0))
  }

  const mimeType = pickMime()
  const stream = canvas.captureStream(fps)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<void>((res) => (recorder.onstop = () => res()))
  g.drawImage(buffer[0], 0, 0)
  recorder.start()
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const tick = () => {
      const i = Math.floor(((performance.now() - start) / 1000) * fps)
      if (i >= frames) return resolve()
      g.drawImage(buffer[i], 0, 0)
      onProgress?.(0.5 + (i / frames) * 0.5)
      requestAnimationFrame(tick)
    }
    tick()
  })
  recorder.stop()
  await done
  buffer.forEach((b) => b.close())
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
  downloadBlob(new Blob(chunks, { type: mimeType || 'video/webm' }), `${fileBase(tool, state)}.${ext}`)
}
