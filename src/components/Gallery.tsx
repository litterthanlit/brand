import { useEffect, useMemo, useState } from 'react'
import { toolHref } from '../hooks/useHashRoute'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { defaultState, type DocState } from '../lib/engine'
import { CATEGORIES, getTool, TOOLS } from '../tools'
import type { Category, ParamValues, ToolDef } from '../tools/types'
import { ArrowUpRightIcon, DiceIcon } from './Icons'
import { Preview } from './Preview'

export function Gallery() {
  const reducedMotion = useReducedMotion()
  const [filter, setFilter] = useState<Category | 'All'>('All')
  const visible = filter === 'All' ? TOOLS : TOOLS.filter((t) => t.category === filter)

  useEffect(() => {
    document.title = 'Brand Playground: tiny tools for brand assets'
  }, [])

  const surprise = () => {
    location.hash = toolHref(TOOLS[Math.floor(Math.random() * TOOLS.length)].id)
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main id="main">
        {/* Hero: editorial, asymmetric */}
        <section className="mx-auto max-w-[1440px] px-4 pt-14 pb-12 sm:px-8 sm:pt-20 lg:pt-28">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-8">
              <p className="mb-6 animate-[rise_600ms_var(--ease-out-soft)_both] font-mono text-[11px] tracking-[0.1em] text-ink-3 uppercase">
                ({String(TOOLS.length).padStart(2, '0')}) Generative tools · Free · In-browser
              </p>
              <h1 className="animate-[rise_700ms_80ms_var(--ease-out-soft)_both] text-[clamp(44px,8.2vw,120px)] leading-[0.92] font-medium tracking-[-0.045em] text-balance">
                Tiny tools for <span className="font-serif font-normal tracking-[-0.02em] italic">making</span> brand things
                <span className="text-accent">.</span>
              </h1>
            </div>
            <div className="flex animate-[rise_700ms_160ms_var(--ease-out-soft)_both] flex-col justify-end lg:col-span-4 lg:pb-3">
              <p className="max-w-[40ch] text-[17px] leading-[1.55] text-ink-2">
                Patterns, badges, gradients, dithers and kinetic type, generated in one click. Tweak every parameter, then export
                production-ready SVG, PNG or video loops.
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <a
                  href="#tools"
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white transition-[transform,background-color] duration-150 hover:bg-black active:scale-[0.97]"
                >
                  Browse tools
                </a>
                <button
                  type="button"
                  onClick={surprise}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-line-2 bg-panel px-5 text-[14px] font-medium text-ink transition-[transform,border-color] duration-150 hover:border-ink active:scale-[0.97]"
                >
                  <DiceIcon size={16} />
                  Surprise me
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Featured: large-format live pieces */}
        <FeaturedStrip reducedMotion={reducedMotion} />

        {/* Index */}
        <section id="tools" aria-labelledby="tools-heading" className="mx-auto max-w-[1440px] scroll-mt-4 px-4 pt-20 pb-24 sm:px-8 sm:pt-28">
          <div className="mb-8 flex flex-col gap-5 border-b border-ink pb-5 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="tools-heading" className="text-[32px] leading-none font-medium tracking-[-0.03em] sm:text-[44px]">
              The index
            </h2>
            <FilterChips value={filter} onChange={setFilter} />
          </div>
          <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
    <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/75 backdrop-blur-xl">
      <a href="#tools" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to tools
      </a>
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 sm:px-8">
        <a href="#/" className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em]">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
          Brand Playground
        </a>
        <p className="font-mono text-[11px] tracking-[0.06em] text-ink-3 uppercase">No sign-up · Nothing uploaded</p>
      </div>
    </header>
  )
}

function FilterChips({ value, onChange }: { value: Category | 'All'; onChange: (c: Category | 'All') => void }) {
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c, TOOLS.filter((t) => t.category === c).length])), [])
  const options: (Category | 'All')[] = ['All', ...CATEGORIES]
  return (
    <div role="radiogroup" aria-label="Filter by category" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {options.map((c) => {
        const active = c === value
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors duration-150 ${
              active ? 'border-ink bg-ink text-white' : 'border-line-2 text-ink-2 hover:border-ink hover:text-ink'
            }`}
          >
            {c}
            <span className={`font-mono text-[10.5px] ${active ? 'text-white/70' : 'text-ink-3'}`}>{c === 'All' ? TOOLS.length : counts[c]}</span>
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
      className="group block rounded-2xl focus-visible:outline-offset-4"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <div className="relative overflow-hidden rounded-2xl border border-line bg-panel transition-[transform,box-shadow] duration-300 ease-out-soft group-hover:-translate-y-1 group-hover:shadow-[0_24px_48px_-24px_rgba(17,17,17,0.35)]">
        <Preview tool={tool} state={state} playing={hover && !reducedMotion} lazy className="w-full" label={`${tool.name} example`} />
        {tool.animated && (
          <span className="absolute top-3 left-3 rounded-full bg-panel/85 px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-ink-2 uppercase backdrop-blur-md">
            Motion
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute right-3 bottom-3 grid h-9 w-9 translate-y-2 place-items-center rounded-full bg-ink text-white opacity-0 transition-all duration-300 ease-out-soft group-hover:translate-y-0 group-hover:opacity-100"
        >
          <ArrowUpRightIcon size={16} />
        </span>
      </div>
      <div className="mt-4 flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-ink-3">{String(index + 1).padStart(2, '0')}</span>
        <h3 className="text-[17px] font-medium tracking-[-0.015em]">{tool.name}</h3>
        <span className="ml-auto font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">{tool.category}</span>
      </div>
      <p className="mt-1.5 pl-[30px] text-[14px] leading-[1.5] text-ink-2">{tool.description}</p>
    </a>
  )
}

/** Three large live pieces in an asymmetric magazine grid. */
function FeaturedStrip({ reducedMotion }: { reducedMotion: boolean }) {
  const items = useMemo(() => {
    const mk = (id: string, format: string, params: ParamValues = {}) => {
      const tool = getTool(id)!
      const base = defaultState(tool)
      const state: DocState = { ...base, format, params: { ...base.params, ...params } }
      return { tool, state, n: String(TOOLS.indexOf(tool) + 1).padStart(2, '0') }
    }
    return [
      mk('mesh-gradient', 'landscape'),
      mk('stamp', 'landscape', { palette: ['#111111', '#F4F2EE', '#FF4F12'] }),
      mk('halftone', 'landscape', { palette: ['#FF4F12', '#111111'], field: 'radial', cells: 28 }),
    ]
  }, [])
  const [lead, ...rest] = items
  const play = !reducedMotion
  const tile = 'group relative block overflow-hidden rounded-3xl border border-line bg-panel'
  return (
    <section aria-label="Featured examples" className="mx-auto max-w-[1440px] px-4 sm:px-8">
      <div className="grid gap-4 lg:h-[clamp(440px,42vw,660px)] lg:grid-cols-12">
        <a href={toolHref(lead.tool.id)} className={`${tile} aspect-[16/10] lg:col-span-8 lg:aspect-auto`}>
          <Preview
            tool={lead.tool}
            state={lead.state}
            playing={play}
            cover
            className="absolute inset-0 h-full w-full transition-transform duration-700 ease-out-soft group-hover:scale-[1.015]"
            label={`${lead.tool.name} example`}
          />
          <Caption n={lead.n} name={lead.tool.name} />
        </a>
        <div className="grid grid-cols-2 gap-4 lg:col-span-4 lg:grid-cols-1 lg:grid-rows-2">
          {rest.map((it) => (
            <a key={it.tool.id} href={toolHref(it.tool.id)} className={`${tile} aspect-square lg:aspect-auto`}>
              <Preview
                tool={it.tool}
                state={it.state}
                playing={play}
                cover
                className="absolute inset-0 h-full w-full transition-transform duration-700 ease-out-soft group-hover:scale-[1.015]"
                label={`${it.tool.name} example`}
              />
              <Caption n={it.n} name={it.tool.name} />
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

function Caption({ n, name }: { n: string; name: string }) {
  return (
    <span className="absolute bottom-3 left-3 inline-flex items-baseline gap-2 rounded-full bg-panel/85 px-3 py-1.5 text-[12px] font-medium shadow-sm backdrop-blur-md sm:bottom-4 sm:left-4">
      <span className="font-mono text-[10.5px] text-ink-3">{n}</span>
      {name}
    </span>
  )
}

function SiteFooter() {
  const keys: [string, string][] = [
    ['R', 'Randomize'],
    ['Space', 'Play / pause'],
    ['← →', 'Step through results'],
    ['⌘Z', 'Undo'],
  ]
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-14 sm:px-8 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
            Brand Playground
          </p>
          <p className="mt-3 max-w-[42ch] text-[14px] leading-[1.6] text-ink-2">
            Everything runs in your browser. Images you drop in never leave your device, and every result is a shareable link.
          </p>
        </div>
        <div className="md:col-span-7">
          <h2 className="mb-4 font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">Shortcuts</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {keys.map(([k, v]) => (
              <div key={k}>
                <dt>
                  <kbd className="rounded-md border border-line-2 bg-panel px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd>
                </dt>
                <dd className="mt-1.5 text-[13px] text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </footer>
  )
}
