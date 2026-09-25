import { useEffect, useRef, useState } from 'react'
import { drawCanvasTool, renderSvg, sizeOf, type DocState } from '../lib/engine'
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

/** Renders any tool, static or animated, into a box that fills its parent. */
export function Preview({ tool, state, playing = false, lazy = false, className = '', label, phaseRef, cover = false }: PreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const localPhase = useRef(0)
  const phase = phaseRef ?? localPhase
  const [visible, setVisible] = useState(!lazy)
  const [display, setDisplay] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!lazy || visible) return
    const el = hostRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setVisible(true),
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lazy, visible])

  // Canvas tools render at display resolution, so track the box width.
  useEffect(() => {
    if (tool.kind !== 'canvas') return
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) =>
      setDisplay({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [tool.kind])

  useEffect(() => {
    if (!visible) return
    const { w, h } = sizeOf(state)
    const draw = (t: number) => {
      if (tool.kind === 'svg') {
        const host = hostRef.current
        if (!host) return
        host.innerHTML = renderSvg(tool, state, t)
        if (cover) host.firstElementChild?.setAttribute('preserveAspectRatio', 'xMidYMid slice')
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
      phase.current = (phase.current + (now - last) / duration) % 1
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

  const { w, h } = sizeOf(state)
  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label ?? `${tool.name} preview`}
      className={`[&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      style={cover ? undefined : { aspectRatio: `${w} / ${h}` }}
    >
      {tool.kind === 'canvas' && <canvas ref={canvasRef} className="block h-full w-full object-cover" />}
    </div>
  )
}
