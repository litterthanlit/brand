import { useEffect, useMemo, useRef, useState } from 'react'
import { drawCanvasTool, renderContentSvg, renderLayers, sizeOf, type DocState } from '../lib/engine'
import type { ToolDef } from '../tools/types'

interface PreviewProps {
  tool: ToolDef
  state: DocState
  playing?: boolean
  /** Defer the first render until the element scrolls into view. */
  lazy?: boolean
  className?: string
  label?: string
  /** Receives the current loop phase, so a paused preview resumes where it stopped. */
  phaseRef?: React.MutableRefObject<number>
  /** Fill the parent box and crop (like object-fit: cover) instead of keeping the format's aspect ratio. */
  cover?: boolean
}

const SVG_FPS = 30

/**
 * Renders any tool, static or animated, plus its grain and type layers.
 * Only the artwork re-renders per frame; the layers above it are static.
 */
export function Preview({ tool, state, playing = false, lazy = false, className = '', label, phaseRef, cover = false }: PreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const localPhase = useRef(0)
  const phase = phaseRef ?? localPhase
  const [visible, setVisible] = useState(!lazy)
  const [display, setDisplay] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!lazy || visible) return
    const el = hostRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [lazy, visible])

  // Canvas tools render at display resolution, so track the box size.
  useEffect(() => {
    if (tool.kind !== 'canvas') return
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setDisplay({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [tool.kind])

  useEffect(() => {
    if (!visible) return
    const { w, h } = sizeOf(state)
    const draw = (t: number) => {
      if (tool.kind === 'svg') {
        const el = artRef.current
        if (!el) return
        el.innerHTML = renderContentSvg(tool, state, t)
        if (cover) el.firstElementChild?.setAttribute('preserveAspectRatio', 'xMidYMid slice')
      } else if (canvasRef.current && display.w > 0) {
        const fit = cover ? Math.max(display.w / w, display.h / h) : display.w / w
        const scale = Math.min(2, fit * Math.min(2, devicePixelRatio || 1))
        drawCanvasTool(tool, state, canvasRef.current, scale, t)
      }
    }
    draw(phase.current)
    if (!playing || !tool.animated) return

    const duration = (tool.duration ?? 6) * 1000
    const minFrame = tool.kind === 'svg' ? 1000 / SVG_FPS : 0
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    const loop = (now: number) => {
      // rAF timestamps can precede the performance.now() taken above, so never step backwards
      phase.current = (phase.current + Math.max(0, now - last) / duration) % 1
      last = now
      if (now - lastDraw >= minFrame) {
        lastDraw = now
        draw(phase.current)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [tool, state, playing, visible, display, phase, cover])

  const layers = useMemo(() => {
    if (!visible) return null
    const l = renderLayers(state)
    const fit = (svg: string) => (cover && svg ? svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ') : svg)
    return { ...l, grain: fit(l.grain), overlay: fit(l.overlay) }
  }, [state, visible, cover])

  const { w, h } = sizeOf(state)
  const layerClass = 'pointer-events-none absolute inset-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full'
  return (
    <div ref={hostRef} role="img" aria-label={label ?? `${tool.name} preview`} className={className} style={cover ? undefined : { aspectRatio: `${w} / ${h}` }}>
      {/* isolate: grain blends with the artwork only, never with the page */}
      <div className="relative isolate h-full w-full overflow-hidden">
        {tool.kind === 'canvas' ? (
          <canvas ref={canvasRef} className="block h-full w-full object-cover" />
        ) : (
          <div ref={artRef} className="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full" />
        )}
        {layers?.grain && (
          <div className={layerClass} style={{ mixBlendMode: layers.blend === 'overlay' ? 'overlay' : 'normal' }} dangerouslySetInnerHTML={{ __html: layers.grain }} />
        )}
        {layers?.overlay && <div className={layerClass} dangerouslySetInnerHTML={{ __html: layers.overlay }} />}
      </div>
    </div>
  )
}
