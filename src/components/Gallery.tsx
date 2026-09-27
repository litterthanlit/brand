import { useEffect, useMemo, useState } from 'react'
import { toolHref } from '../hooks/useHashRoute'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { defaultState, stateFromPreset } from '../lib/engine'
import { CATEGORIES, getTool, TOOLS } from '../tools'
import type { Category, Preset, ToolDef } from '../tools/types'
import { Halo } from './Halo'
import { Preview } from './Preview'

const pad = (n: number) => String(n).padStart(2, '0')

export function Gallery() {
  const reducedMotion = useReducedMotion()
  const [filter, setFilter] = useState<Filter>('All')
  const visible = filter === 'All' ? TOOLS : filter === 'Raw' ? TOOLS.filter((t) => t.raw) : TOOLS.filter((t) => t.category === filter)

  useEffect(() => {
    document.title = 'Brand Playground'
  }, [])

  const surprise = () => {
    location.hash = toolHref(TOOLS[Math.floor(Math.random() * TOOLS.length)].id)
  }

  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader />

      <main id="main">
        <section className="mx-auto max-w-[1280px] px-4 pt-20 pb-20 sm:px-8 sm:pt-32 sm:pb-28">
          <h1 className="max-w-[18ch] animate-[rise_1200ms_var(--ease-out-soft)_both] text-[clamp(28px,4vw,44px)] leading-[1.1] font-normal tracking-[-0.025em] text-balance">
            Tiny tools for making brand things.
          </h1>
          <p className="mt-5 max-w-[44ch] animate-[rise_1200ms_150ms_var(--ease-out-soft)_both] text-[15px] leading-[1.6] text-ink-2">
            {TOOLS.length} generators for patterns, gradients, dithers and type. Tweak, then export SVG, PNG or video. Everything runs in your
            browser.
          </p>
          <div className="mt-8 flex animate-[rise_1200ms_300ms_var(--ease-out-soft)_both] items-center gap-6 text-[14px]">
            <a
              href="#tools"
              className="inline-flex h-9 items-center rounded-full bg-ink px-4 font-medium text-paper transition-opacity duration-200 hover:opacity-85"
            >
              Browse the index
            </a>
            <button type="button" onClick={surprise} className="text-ink-2 transition-colors duration-200 hover:text-ink">
              Surprise me
            </button>
          </div>
        </section>

        <FeaturedStrip reducedMotion={reducedMotion} />

        <section id="tools" aria-labelledby="tools-heading" className="mx-auto max-w-[1280px] scroll-mt-16 px-4 pt-32 pb-32 sm:px-8 sm:pt-44">
          <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 id="tools-heading" className="text-[14px] font-normal text-ink">
              Index <span className="ml-1 text-ink-3 tabular-nums">{visible.length}</span>
            </h2>
            <FilterTabs value={filter} onChange={setFilter} />
          </div>
          <ul className="grid gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((tool) => (
              <li key={tool.id}>
                <ToolCard tool={tool} index={TOOLS.indexOf(tool)} reducedMotion={reducedMotion} />
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 bg-paper/70 backdrop-blur-xl">
      <a href="#tools" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to tools
      </a>
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 text-[13px] sm:px-8">
        <a href="#/" className="text-ink">
          Brand Playground
        </a>
        <a href="#tools" className="text-ink-3 transition-colors duration-200 hover:text-ink">
          Index
        </a>
      </div>
    </header>
  )
}

type Filter = Category | 'All' | 'Raw'

function FilterTabs({ value, onChange }: { value: Filter; onChange: (c: Filter) => void }) {
  const options: Filter[] = ['All', 'Raw', ...CATEGORIES]
  return (
    <div role="radiogroup" aria-label="Filter by category" className="-mx-2 flex overflow-x-auto">
      {options.map((c) => {
        const active = c === value
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c)}
            className={`h-8 shrink-0 px-2 text-[13px] transition-colors duration-200 ${active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
          >
            {c}
          </button>
        )
      })}
    </div>
  )
}

function ToolCard({ tool, index, reducedMotion }: { tool: ToolDef; index: number; reducedMotion: boolean }) {
  const [hover, setHover] = useState(false)
  const state = useMemo(() => defaultState(tool), [tool])
  return (
    <a
      href={toolHref(tool.id)}
      className="group block rounded-lg focus-visible:outline-offset-8"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <div className="relative">
        {/* The halo only exists while lit, so a grid of cards costs no blur */}
        {hover && !reducedMotion && <Halo tool={tool} state={state} className="animate-[dawn_900ms_var(--ease-out-soft)]" />}
        <div className="relative overflow-hidden rounded-md">
          <Preview tool={tool} state={state} playing={hover && !reducedMotion} lazy className="w-full" label={`${tool.name} example`} />
        </div>
      </div>
      <div className="mt-5 flex items-baseline gap-3 text-[14px]">
        <span className="text-ink-3 tabular-nums">{pad(index + 1)}</span>
        <h3 className="font-normal text-ink">{tool.name}</h3>
        <span className="ml-auto text-[13px] text-ink-3">{tool.category}</span>
      </div>
      <p className="mt-1 line-clamp-2 pl-[30px] text-[13px] leading-[1.55] text-ink-3 transition-colors duration-300 group-hover:text-ink-2">{tool.description}</p>
    </a>
  )
}

/** Three live pieces, each glowing into the room like an aperture. */
function FeaturedStrip({ reducedMotion }: { reducedMotion: boolean }) {
  const items = useMemo(() => {
    const mk = (id: string, preset: Omit<Preset, 'name'>) => {
      const tool = getTool(id)!
      const base = tool.defaults ?? {}
      const state = stateFromPreset(tool, { ...preset, finish: { ...base.finish, ...preset.finish }, type: { ...base.type, ...preset.type } })
      return { tool, state, n: pad(TOOLS.indexOf(tool) + 1) }
    }
    return [
      mk('line-sweep', { format: 'landscape', seed: 7, type: { enabled: false } }),
      mk('blur-echo', { format: 'landscape', seed: 7, type: { enabled: false } }),
      mk('particle-stream', { format: 'landscape', seed: 7, type: { enabled: false } }),
    ]
  }, [])
  const [lead, ...rest] = items
  const play = !reducedMotion

  const piece = (it: (typeof items)[number], className: string) => (
    <a key={it.tool.id} href={toolHref(it.tool.id)} className={`group relative block ${className}`}>
      <Halo tool={it.tool} state={it.state} className="opacity-25 group-hover:opacity-45" />
      <div className="absolute inset-0 overflow-hidden rounded-md">
        <Preview
          tool={it.tool}
          state={it.state}
          playing={play}
          cover
          className="absolute inset-0 h-full w-full transition-transform duration-[1200ms] ease-out-soft group-hover:scale-[1.01]"
          label={`${it.tool.name} example`}
        />
      </div>
      <span className="absolute -bottom-8 left-0 flex gap-3 text-[13px] text-ink-3 transition-colors duration-300 group-hover:text-ink-2">
        <span className="tabular-nums">{it.n}</span>
        {it.tool.name}
      </span>
    </a>
  )

  return (
    <section aria-label="Featured examples" className="mx-auto max-w-[1280px] animate-[dawn_2000ms_400ms_var(--ease-out-soft)_both] px-4 sm:px-8">
      <div className="grid gap-x-8 gap-y-16 lg:h-[clamp(420px,40vw,600px)] lg:grid-cols-12">
        {piece(lead, 'aspect-[16/10] lg:col-span-8 lg:aspect-auto')}
        <div className="grid grid-cols-2 gap-x-8 gap-y-16 lg:col-span-4 lg:grid-cols-1 lg:grid-rows-2">{rest.map((it) => piece(it, 'aspect-square lg:aspect-auto'))}</div>
      </div>
    </section>
  )
}

function SiteFooter() {
  const keys: [string, string][] = [
    ['R', 'Randomize'],
    ['Space', 'Play'],
    ['← →', 'History'],
  ]
  return (
    <footer>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-12 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>Runs in your browser. Nothing is uploaded.</p>
        <dl className="flex gap-6">
          {keys.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2">
              <dt>
                <kbd className="font-sans text-ink-2">{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </footer>
  )
}
