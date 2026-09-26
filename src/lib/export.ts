import type { ToolDef } from '../tools/types'
import { drawCanvasTool, renderContentSvg, renderLayers, renderSvg, sizeOf, type DocState } from './engine'
import { withEmbeddedFonts } from './fonts'

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

export async function exportSvg(tool: ToolDef, state: DocState) {
  const svg = await withEmbeddedFonts(renderSvg(tool, state))
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase(tool, state)}.svg`)
}

export async function copySvg(tool: ToolDef, state: DocState) {
  await navigator.clipboard.writeText(renderSvg(tool, state))
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not rasterise SVG'))
    }
    img.src = url
  })
}

/** SVG → image with fonts embedded, since images can't see the page's fonts. */
const rasterise = async (svg: string) => loadSvgImage(await withEmbeddedFonts(svg))

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

  return async function frame(canvas: HTMLCanvasElement, t = 0) {
    if (tool.kind === 'canvas') {
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
