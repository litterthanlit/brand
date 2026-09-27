import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toolHref } from '../hooks/useHashRoute'
import { defaultState, randomizeState, sanitizeParams, sanitizeValues, sizeOf, stateFromPreset, type DocState } from '../lib/engine'
import { FINISH_PARAMS } from '../lib/finish'
import { TYPE_PARAMS } from '../lib/typeLayer'
import { FORMATS, getFormat } from '../lib/formats'
import { newSeed } from '../lib/random'
import { decodeState, encodeState } from '../lib/urlState'
import { TOOLS } from '../tools'
import type { ParamValue, Preset, ToolDef } from '../tools/types'
import { Controls } from './Controls'
import { ExportMenu } from './ExportMenu'
import { ArrowLeftIcon, DiceIcon, PauseIcon, PlayIcon, RedoIcon, ResetIcon, UndoIcon } from './Icons'
import { Halo } from './Halo'
import { Preview } from './Preview'
import { Toast, useToast } from './Toast'

const HISTORY_LIMIT = 60

const TABS = [
  { id: 'generator', label: 'Generator' },
  { id: 'type', label: 'Type' },
  { id: 'finish', label: 'Finish' },
] as const
type TabId = (typeof TABS)[number]['id']
const NO_LOCKS = new Set<string>()

function initialState(tool: ToolDef, data: string | null): DocState {
  const base = defaultState(tool)
  const decoded = data ? decodeState(data) : null
  if (!decoded) return base
  return {
    seed: decoded.seed ?? base.seed,
    format: decoded.format && FORMATS.some((f) => f.id === decoded.format) ? decoded.format : base.format,
    params: sanitizeParams(tool, decoded.params ?? {}),
    finish: decoded.finish ? sanitizeValues(FINISH_PARAMS, decoded.finish) : base.finish,
    type: decoded.type ? sanitizeValues(TYPE_PARAMS, decoded.type) : base.type,
  }
}

/** Tiny colour chip for a preset button, from the preset's palette (or the tool's default). */
function PresetSwatch({ tool, preset }: { tool: ToolDef; preset: Preset }) {
  const key = tool.params.find((p) => p.type === 'palette')?.key
  const colors = (key && (preset.params?.[key] as string[] | undefined)) || (key && (tool.params.find((p) => p.key === key)?.default as string[])) || []
  return (
    <span aria-hidden="true" className="flex h-5 w-5 overflow-hidden rounded-full ring-1 ring-white/10">
      {colors.slice(0, 3).map((c, i) => (
        <span key={i} className="flex-1" style={{ background: c }} />
      ))}
    </span>
  )
}

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

export function Studio({ tool, data }: { tool: ToolDef; data: string | null }) {
  const [hist, setHist] = useState(() => ({ stack: [initialState(tool, data)], index: 0 }))
  const [locked, setLocked] = useState<Set<string>>(() => new Set())
  const [tab, setTab] = useState<TabId>('generator')
  const [playing, setPlaying] = useState(() => !!tool.animated && !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const phaseRef = useRef(0)
  const { message, key: toastKey, notify } = useToast()

  const state = hist.stack[hist.index]
  // Keep typing and dragging responsive; heavy tools re-render in the background.
  const renderState = useDeferredValue(state)
  const canUndo = hist.index > 0
  const canRedo = hist.index < hist.stack.length - 1

  const replace = useCallback((fn: (s: DocState) => DocState) => {
    setHist((h) => {
      const stack = h.stack.slice()
      stack[h.index] = fn(stack[h.index])
      return { stack, index: h.index }
    })
  }, [])

  const push = useCallback((fn: (s: DocState) => DocState) => {
    setHist((h) => {
      const stack = [...h.stack.slice(0, h.index + 1), fn(h.stack[h.index])].slice(-HISTORY_LIMIT)
      return { stack, index: stack.length - 1 }
    })
  }, [])

  const randomize = useCallback(() => push((s) => randomizeState(tool, s, locked)), [push, tool, locked])
  const shuffleSeed = useCallback(() => push((s) => ({ ...s, seed: newSeed() })), [push])
  const reset = useCallback(() => push((s) => ({ ...defaultState(tool), format: s.format, type: s.type })), [push, tool])
  const applyPreset = useCallback(
    (preset: Preset) =>
      push((s) => {
        const next = stateFromPreset(tool, preset, s.format)
        // keep any uploaded images; presets only describe the look
        for (const p of tool.params) if (p.type === 'image') next.params[p.key] = s.params[p.key]
        return next
      }),
    [push, tool],
  )
  const setLayer = useCallback(
    (layer: 'finish' | 'type', key: string, value: ParamValue) => replace((s) => ({ ...s, [layer]: { ...s[layer], [key]: value } })),
    [replace],
  )
  const layerActive = (id: string) => (id === 'type' ? state.type.enabled === true : (state.finish.grain as number) > 0 || (state.finish.vignette as number) > 0)
  const undo = useCallback(() => setHist((h) => ({ ...h, index: Math.max(0, h.index - 1) })), [])
  const redo = useCallback(() => setHist((h) => ({ ...h, index: Math.min(h.stack.length - 1, h.index + 1) })), [])

  const setParam = useCallback(
    (key: string, value: ParamValue) => {
      const param = tool.params.find((p) => p.key === key)
      const extra = param?.type === 'image' && value ? param.onSet : undefined
      replace((s) => ({ ...s, params: { ...s.params, ...extra, [key]: value } }))
    },
    [replace, tool],
  )
  const toggleLock = useCallback((key: string) => {
    setLocked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Mirror state into the URL so every result is a shareable link.
  useEffect(() => {
    const id = window.setTimeout(() => {
      history.replaceState(null, '', toolHref(tool.id, encodeState(state)))
    }, 250)
    return () => window.clearTimeout(id)
  }, [state, tool.id])

  useEffect(() => {
    document.title = `${tool.name} · Brand Playground`
  }, [tool.name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        randomize()
      } else if (e.key === ' ' && tool.animated) {
        if (e.target instanceof HTMLButtonElement) return
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowLeft') undo()
      else if (e.key === 'ArrowRight') redo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [randomize, undo, redo, tool.animated])

  const copyLink = useCallback(async () => {
    const url = `${location.origin}${location.pathname}${toolHref(tool.id, encodeState(state))}`
    try {
      await navigator.clipboard.writeText(url)
      notify('Link copied. It reopens this exact result.')
    } catch {
      notify('Could not access the clipboard')
    }
  }, [state, tool.id, notify])


  const index = TOOLS.findIndex((t) => t.id === tool.id)
  const hasImageParam = tool.params.some((p) => p.type === 'image')
  const { w, h } = sizeOf(state)

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-4 px-4 text-[13px] sm:px-5">
        <a href="#/" className="inline-flex items-center gap-1.5 text-ink-3 transition-colors duration-200 hover:text-ink">
          <ArrowLeftIcon size={14} />
          <span className="hidden sm:inline">Index</span>
        </a>
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-ink-3 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
          <h1 className="truncate font-normal text-ink">{tool.name}</h1>
        </div>
        <div className="ml-auto">
          <ExportMenu tool={tool} state={state} notify={notify} onCopyLink={copyLink} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
        <nav aria-label="Tools" className="hidden min-h-0 overflow-y-auto py-3 lg:block">
          <ol>
            {TOOLS.map((t, i) => {
              const active = t.id === tool.id
              return (
                <li key={t.id}>
                  <a
                    href={toolHref(t.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-baseline gap-3 px-5 py-1 text-[13px] transition-colors duration-200 ${active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
                  >
                    <span className="w-4 text-[12px] tabular-nums opacity-70">{String(i + 1).padStart(2, '0')}</span>
                    <span className="truncate">{t.name}</span>
                  </a>
                </li>
              )
            })}
          </ol>
        </nav>

        <main className="flex min-h-0 flex-col">
          <Stage tool={tool} state={renderState} playing={playing} phaseRef={phaseRef} />
          <Toolbar
            animated={!!tool.animated}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            onRandomize={randomize}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            meta={`${w} × ${h} · seed ${state.seed}${hasImageParam ? ' · stays on your device' : ''}`}
          />
        </main>

        <aside aria-label={`${tool.name} settings`} className="min-h-0 border-t border-line lg:overflow-y-auto lg:border-t-0 lg:border-l">
          {tool.presets && tool.presets.length > 0 && (
            <section aria-labelledby="moods-heading" className="px-5 pt-5 pb-4">
              <h2 id="moods-heading" className="mb-3 text-[12px] font-normal text-ink-3">
                Moods
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {tool.presets.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="inline-flex h-7 items-center gap-2 rounded-full bg-paper-2 pr-3 pl-1 text-[12.5px] text-ink-2 transition-colors duration-200 hover:bg-line-2 hover:text-ink"
                  >
                    <PresetSwatch tool={tool} preset={preset} />
                    {preset.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div role="tablist" aria-label="Settings" className="sticky top-0 z-10 flex gap-5 border-b border-line bg-paper/90 px-5 backdrop-blur-xl">
            {TABS.map((t) => {
              const active = t.id === tab
              return (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                    e.preventDefault()
                    e.stopPropagation()
                    const i = TABS.findIndex((x) => x.id === tab)
                    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
                    setTab(next.id)
                    document.getElementById(`tab-${next.id}`)?.focus()
                  }}
                  className={`relative h-10 text-[13px] transition-colors duration-200 ${active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
                >
                  {t.label}
                  {t.id !== 'generator' && layerActive(t.id) && <span aria-label="(on)" className="ml-1.5 inline-block h-1 w-1 -translate-y-0.5 rounded-full bg-accent" />}
                  {active && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-px bg-ink" />}
                </button>
              )
            })}
          </div>

          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pb-10">
            {tab === 'generator' && (
              <>
                <section aria-labelledby="canvas-heading" className="px-5 pt-5 pb-3">
                  <h2 id="canvas-heading" className="mb-3 text-[12px] font-normal text-ink-3">
                    Format
                  </h2>
                  <div role="radiogroup" aria-label="Format" className="grid grid-cols-5 gap-1">
                    {FORMATS.map((f) => {
                      const active = f.id === state.format
                      return (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          title={`${f.hint} · ${f.w}×${f.h}`}
                          onClick={() => replace((s) => ({ ...s, format: f.id }))}
                          className={`flex h-11 flex-col items-center justify-center gap-1.5 rounded-md text-[11.5px] transition-colors duration-200 ${
                            active ? 'bg-paper-2 text-ink' : 'text-ink-3 hover:text-ink-2'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="block rounded-[1.5px] border border-current"
                            style={{ width: (f.w / Math.max(f.w, f.h)) * 14, height: (f.h / Math.max(f.w, f.h)) * 14 }}
                          />
                          {f.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-[12px] text-ink-3">{getFormat(state.format).hint}</p>
                  <div className="mt-4 flex items-center gap-1">
                    <label htmlFor="seed" className="mr-auto text-[13px] text-ink-2">
                      Seed
                    </label>
                    <input
                      id="seed"
                      type="number"
                      value={state.seed}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber
                        if (Number.isFinite(n)) replace((s) => ({ ...s, seed: Math.max(0, Math.floor(n)) }))
                      }}
                      className="no-spinner h-7 w-20 rounded-md bg-transparent px-1.5 text-right text-[13px] text-ink tabular-nums outline-none hover:bg-paper-2 focus:bg-paper-2"
                    />
                    <IconButton label="New seed" onClick={shuffleSeed}>
                      <DiceIcon size={14} />
                    </IconButton>
                    <IconButton label="Reset to defaults" onClick={reset}>
                      <ResetIcon size={14} />
                    </IconButton>
                  </div>
                </section>
                <section aria-labelledby="params-heading" className="mt-2 border-t border-line">
                  <div className="flex items-baseline justify-between px-5 pt-5 pb-1">
                    <h2 id="params-heading" className="text-[12px] font-normal text-ink-3">
                      Parameters
                    </h2>
                    {locked.size > 0 && (
                      <button type="button" onClick={() => setLocked(new Set())} className="text-[12px] text-ink-3 transition-colors hover:text-ink">
                        Unlock all ({locked.size})
                      </button>
                    )}
                  </div>
                  <Controls params={tool.params} values={state.params} locked={locked} onChange={setParam} onToggleLock={toggleLock} />
                </section>
              </>
            )}
            {tab === 'type' && (
              <section aria-label="Type layer">
                <p className="px-5 pt-5 pb-1 text-[12.5px] leading-[1.55] text-ink-3">Text set over the artwork. Included in every export; Randomize leaves it alone.</p>
                <Controls params={TYPE_PARAMS} values={state.type} locked={NO_LOCKS} showLocks={false} onChange={(k, v) => setLayer('type', k, v)} onToggleLock={() => {}} />
              </section>
            )}
            {tab === 'finish' && (
              <section aria-label="Finish layer">
                <p className="px-5 pt-5 pb-1 text-[12.5px] leading-[1.55] text-ink-3">Grain and vignette over any tool, baked into every export.</p>
                <Controls params={FINISH_PARAMS} values={state.finish} locked={NO_LOCKS} showLocks={false} onChange={(k, v) => setLayer('finish', k, v)} onToggleLock={() => {}} />
              </section>
            )}
          </div>
          <MobileToolSwitcher current={tool.id} />
        </aside>
      </div>
      <Toast message={message} id={toastKey} />
    </div>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full text-ink-3 transition-[color,background-color] duration-200 hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

interface ToolbarProps {
  animated: boolean
  playing: boolean
  onTogglePlay: () => void
  onRandomize: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  meta: string
}

/** One quiet row under the artwork: history, the essentials, and the file's facts. */
function Toolbar({ animated, playing, onTogglePlay, onRandomize, onUndo, onRedo, canUndo, canRedo, meta }: ToolbarProps) {
  const [spin, setSpin] = useState(0)
  return (
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-1 pb-4 sm:px-5 sm:pb-5">
      <div className="flex items-center">
        <IconButton label="Previous result (←)" onClick={onUndo} disabled={!canUndo}>
          <UndoIcon size={14} />
        </IconButton>
        <IconButton label="Next result (→)" onClick={onRedo} disabled={!canRedo}>
          <RedoIcon size={14} />
        </IconButton>
      </div>
      <div className="flex items-center gap-1">
        {animated && (
          <IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={onTogglePlay}>
            {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
          </IconButton>
        )}
        <button
          type="button"
          title="Randomize (R)"
          onClick={() => {
            setSpin((s) => s + 1)
            onRandomize()
          }}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-ink px-3.5 text-[13px] font-medium text-paper transition-opacity duration-200 hover:opacity-85"
        >
          <span className="inline-block transition-transform duration-700 ease-out-soft" style={{ transform: `rotate(${spin * 180}deg)` }}>
            <DiceIcon size={14} />
          </span>
          Randomize
        </button>
      </div>
      <p className="hidden truncate text-right text-[12px] text-ink-3 tabular-nums sm:block">{meta}</p>
    </div>
  )
}

/** The artwork hangs in a dark room, lit only by itself. */
function Stage({ tool, state, playing, phaseRef }: { tool: ToolDef; state: DocState; playing: boolean; phaseRef: React.MutableRefObject<number> }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const { w, h } = sizeOf(state)

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const pad = window.innerWidth < 640 ? 24 : 64
      const aw = Math.max(0, r.width - pad * 2)
      const ah = Math.max(0, r.height - pad * 2)
      const s = Math.min(aw / w, ah / h)
      setBox({ w: Math.floor(w * s), h: Math.floor(h * s) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [w, h])

  const preview = useMemo(
    () => <Preview tool={tool} state={state} playing={playing} phaseRef={phaseRef} label={`${tool.name} artwork, ${w} by ${h} pixels`} className="h-full w-full" />,
    [tool, state, playing, phaseRef, w, h],
  )

  return (
    <div ref={areaRef} className="relative h-[62vh] min-h-[320px] overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
      {/* The glow fills the room and fades out before the walls, so it never shows an edge */}
      <Halo tool={tool} state={state} className="inset-0 opacity-50 [mask-image:radial-gradient(closest-side,#000_35%,transparent)]" />
      <div className="absolute inset-0 grid place-items-center">
        {box.w > 0 && (
          <div className="relative animate-[dawn_1400ms_var(--ease-out-soft)] overflow-hidden rounded-[2px]" style={{ width: box.w, height: box.h }}>
            {preview}
          </div>
        )}
      </div>
    </div>
  )
}

function MobileToolSwitcher({ current }: { current: string }) {
  return (
    <div className="border-t border-line px-5 py-5 lg:hidden">
      <label htmlFor="tool-switch" className="mb-2 block text-[12px] text-ink-3">
        Switch tool
      </label>
      <select
        id="tool-switch"
        value={current}
        onChange={(e) => {
          location.hash = toolHref(e.target.value)
        }}
        className="h-10 w-full rounded-md border border-line-2 bg-paper-2 px-3 text-[14px] text-ink"
      >
        {TOOLS.map((t, i) => (
          <option key={t.id} value={t.id}>
            {String(i + 1).padStart(2, '0')} · {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}
