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
    <span aria-hidden="true" className="flex h-5 w-5 overflow-hidden rounded-full ring-1 ring-black/10">
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

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* Top bar */}
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-paper/80 px-4 backdrop-blur-md sm:px-5">
        <a
          href="#/"
          className="inline-flex h-9 items-center gap-2 rounded-full pr-3 pl-2 text-[13px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <ArrowLeftIcon size={15} />
          <span className="hidden sm:inline">All tools</span>
        </a>
        <span aria-hidden="true" className="h-5 w-px bg-line" />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-[11px] text-ink-3">{String(index + 1).padStart(2, '0')}</span>
          <h1 className="truncate text-[15px] font-medium tracking-[-0.01em]">{tool.name}</h1>
          <span className="hidden font-mono text-[11px] tracking-[0.06em] text-ink-3 uppercase md:inline">{tool.category}</span>
        </div>
        <div className="ml-auto">
          <ExportMenu tool={tool} state={state} notify={notify} onCopyLink={copyLink} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[208px_minmax(0,1fr)_340px]">
        {/* Tool index */}
        <nav aria-label="Tools" className="hidden min-h-0 overflow-y-auto border-r border-line py-4 lg:block">
          <ol>
            {TOOLS.map((t, i) => {
              const active = t.id === tool.id
              return (
                <li key={t.id}>
                  <a
                    href={toolHref(t.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-baseline gap-3 px-5 py-1.5 text-[13px] transition-colors ${active ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
                  >
                    <span className={`font-mono text-[10.5px] ${active ? 'text-accent-ink' : 'text-ink-3'}`}>{String(i + 1).padStart(2, '0')}</span>
                    <span className={active ? 'font-medium' : ''}>{t.name}</span>
                    {active && <span aria-hidden="true" className="ml-auto h-1.5 w-1.5 self-center rounded-full bg-accent" />}
                  </a>
                </li>
              )
            })}
          </ol>
        </nav>

        {/* Stage */}
        <main className="flex min-h-0 flex-col">
          <Toolbar
            animated={!!tool.animated}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            onRandomize={randomize}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
          <Stage tool={tool} state={renderState} playing={playing} phaseRef={phaseRef} />
          <p className="shrink-0 px-5 pb-4 text-center font-mono text-[11px] text-ink-3">
            {sizeOf(state).w} × {sizeOf(state).h} · seed {state.seed}
            {hasImageParam && ' · images stay on your device'}
          </p>
        </main>

        {/* Controls */}
        <aside aria-label={`${tool.name} settings`} className="min-h-0 border-t border-line bg-panel lg:overflow-y-auto lg:border-t-0 lg:border-l">
          {tool.presets && tool.presets.length > 0 && (
            <section aria-labelledby="moods-heading" className="border-b border-line px-5 pt-4 pb-4">
              <h2 id="moods-heading" className="mb-2.5 font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">
                Moods
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {tool.presets.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-line-2 pr-3 pl-1.5 text-[12.5px] text-ink transition-[border-color,transform] duration-150 hover:border-ink active:scale-[0.97]"
                  >
                    <PresetSwatch tool={tool} preset={preset} />
                    {preset.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div role="tablist" aria-label="Settings" className="sticky top-0 z-10 flex gap-1 border-b border-line bg-panel/95 px-3 pt-2 backdrop-blur-md">
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
                  className={`relative h-10 px-3 text-[13px] transition-colors ${active ? 'font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
                >
                  {t.label}
                  {t.id !== 'generator' && layerActive(t.id) && <span aria-label="(on)" className="ml-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-accent" />}
                  {active && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
                </button>
              )
            })}
          </div>

          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pb-8">
            {tab === 'generator' && (
              <>
                <section aria-labelledby="canvas-heading" className="border-b border-line px-5 py-4">
                  <h2 id="canvas-heading" className="mb-3 font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">
                    Canvas
                  </h2>
                  <div role="radiogroup" aria-label="Format" className="grid grid-cols-5 gap-1 rounded-lg bg-paper p-1">
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
                          className={`flex h-12 flex-col items-center justify-center gap-1 rounded-md text-[11.5px] transition-colors ${
                            active ? 'bg-panel font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:text-ink'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`block rounded-[2px] border ${active ? 'border-ink' : 'border-ink-3'}`}
                            style={{ width: (f.w / Math.max(f.w, f.h)) * 16, height: (f.h / Math.max(f.w, f.h)) * 16 }}
                          />
                          {f.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-[12px] text-ink-3">{getFormat(state.format).hint}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <label htmlFor="seed" className="text-[13px] text-ink-2">
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
                      className="no-spinner ml-auto h-8 w-24 rounded-md border border-line bg-panel px-2 text-right font-mono text-[12px] tabular-nums outline-none hover:border-line-2 focus:border-ink"
                    />
                    <IconButton label="New seed" onClick={shuffleSeed}>
                      <DiceIcon size={15} />
                    </IconButton>
                    <IconButton label="Reset to defaults" onClick={reset}>
                      <ResetIcon size={15} />
                    </IconButton>
                  </div>
                </section>
                <section aria-labelledby="params-heading">
                  <div className="flex items-baseline justify-between px-5 pt-4 pb-1">
                    <h2 id="params-heading" className="font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">
                      Parameters
                    </h2>
                    {locked.size > 0 && (
                      <button type="button" onClick={() => setLocked(new Set())} className="text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">
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
                <p className="px-5 pt-4 text-[12.5px] leading-[1.5] text-ink-3">Editorial text set over the artwork. It's embedded in every export, and Randomize never changes it.</p>
                <Controls params={TYPE_PARAMS} values={state.type} locked={NO_LOCKS} showLocks={false} onChange={(k, v) => setLayer('type', k, v)} onToggleLock={() => {}} />
              </section>
            )}
            {tab === 'finish' && (
              <section aria-label="Finish layer">
                <p className="px-5 pt-4 text-[12.5px] leading-[1.5] text-ink-3">Print texture over any tool. Grain is baked into SVG, PNG and video exports.</p>
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
      className="grid h-8 w-8 place-items-center rounded-full text-ink-2 transition-[color,background-color,transform] duration-150 hover:bg-paper-2 hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-35"
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
}

function Toolbar({ animated, playing, onTogglePlay, onRandomize, onUndo, onRedo, canUndo, canRedo }: ToolbarProps) {
  const [spin, setSpin] = useState(0)
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 sm:px-5">
      <div className="flex items-center gap-0.5 rounded-full border border-line bg-panel p-0.5">
        <IconButton label="Previous result (←)" onClick={onUndo} disabled={!canUndo}>
          <UndoIcon size={15} />
        </IconButton>
        <IconButton label="Next result (→)" onClick={onRedo} disabled={!canRedo}>
          <RedoIcon size={15} />
        </IconButton>
      </div>
      <div className="flex items-center gap-2">
        {animated && (
          <button
            type="button"
            onClick={onTogglePlay}
            aria-pressed={playing}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-panel px-3.5 text-[13px] font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-paper-2 active:scale-[0.97]"
          >
            {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
            <span>{playing ? 'Pause' : 'Animate'}</span>
            <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-ink-3 sm:inline">Space</kbd>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setSpin((s) => s + 1)
            onRandomize()
          }}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-medium text-white shadow-[0_6px_16px_-6px_rgba(255,79,18,0.7)] transition-[background-color,transform] duration-150 hover:bg-[#f04408] active:scale-[0.97]"
        >
          <span className="inline-block transition-transform duration-500 ease-out-soft" style={{ transform: `rotate(${spin * 180}deg)` }}>
            <DiceIcon size={15} />
          </span>
          Randomize
          <kbd className="hidden rounded border border-white/40 px-1 font-mono text-[10px] text-white/85 sm:inline">R</kbd>
        </button>
      </div>
    </div>
  )
}

/** Fits the artwork into the available stage area at its true aspect ratio. */
function Stage({ tool, state, playing, phaseRef }: { tool: ToolDef; state: DocState; playing: boolean; phaseRef: React.MutableRefObject<number> }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const { w, h } = sizeOf(state)

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const pad = window.innerWidth < 640 ? 16 : 40
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
    <div ref={areaRef} className="stage-bg relative m-4 h-[62vh] min-h-[320px] overflow-hidden rounded-2xl border border-line sm:m-5 lg:h-auto lg:min-h-0 lg:flex-1">
      <div className="absolute inset-0 grid place-items-center">
        {box.w > 0 && (
          <div
            className="overflow-hidden rounded-[3px] bg-panel shadow-[0_1px_2px_rgba(17,17,17,0.06),0_24px_60px_-20px_rgba(17,17,17,0.28)] ring-1 ring-black/5"
            style={{ width: box.w, height: box.h }}
          >
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
      <label htmlFor="tool-switch" className="mb-2 block font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">
        Switch tool
      </label>
      <select
        id="tool-switch"
        value={current}
        onChange={(e) => {
          location.hash = toolHref(e.target.value)
        }}
        className="h-10 w-full rounded-lg border border-line bg-panel px-3 text-[14px]"
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
