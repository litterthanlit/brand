import { useEffect, useRef, useState } from 'react'
import type { DocState } from '../lib/engine'
import { sizeOf } from '../lib/engine'
import { canRecordVideo, copySvg, exportPng, exportSvg, recordVideo } from '../lib/export'
import type { ToolDef } from '../tools/types'
import { DownloadIcon } from './Icons'

interface ExportMenuProps {
  tool: ToolDef
  state: DocState
  notify: (msg: string) => void
  onCopyLink: () => void
}

interface Item {
  label: string
  hint: string
  run: () => Promise<void> | void
}

export function ExportMenu({ tool, state, notify, onCopyLink }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { w, h } = sizeOf(state)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    // move focus into the menu for keyboard users
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups: { title: string; items: Item[] }[] = []
  if (tool.kind === 'svg') {
    groups.push({
      title: 'Vector',
      items: [
        { label: 'SVG', hint: 'Editable in Figma, Illustrator', run: () => exportSvg(tool, state) },
        {
          label: 'Copy SVG code',
          hint: 'Paste straight into Figma',
          run: async () => {
            await copySvg(tool, state)
            notify('SVG copied to clipboard')
          },
        },
      ],
    })
  }
  groups.push({
    title: 'Image',
    items: [1, 2, 4].map((s) => ({
      label: `PNG ${s}×`,
      hint: `${w * s} × ${h * s}`,
      run: () => exportPng(tool, state, s),
    })),
  })
  if (tool.animated && canRecordVideo()) {
    groups.push({
      title: 'Motion',
      items: [
        {
          label: 'Video loop',
          hint: `${tool.duration ?? 6}s seamless WebM`,
          run: async () => {
            notify('Recording loop…')
            await recordVideo(tool, state, (p) => setBusy(`Recording ${Math.round(p * 100)}%`))
            notify('Video saved')
          },
        },
      ],
    })
  }
  groups.push({ title: 'Share', items: [{ label: 'Copy link', hint: 'Reopens this exact result', run: onCopyLink }] })

  const run = async (item: Item) => {
    setOpen(false)
    setBusy(item.label)
    try {
      await item.run()
    } catch (err) {
      console.error(err)
      notify(`Export failed: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!!busy}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition-[transform,background-color] duration-150 hover:bg-black active:scale-[0.97] disabled:opacity-70"
      >
        <DownloadIcon size={15} />
        <span aria-live="polite">{busy ?? 'Export'}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Export options"
          onKeyDown={onMenuKey}
          className="absolute top-[calc(100%+8px)] right-0 z-30 w-72 origin-top-right animate-[menu-in_160ms_var(--ease-out-soft)] rounded-2xl border border-line bg-panel/95 p-1.5 shadow-[0_24px_48px_-12px_rgba(17,17,17,0.18),0_2px_6px_rgba(17,17,17,0.06)] backdrop-blur-xl"
        >
          {groups.map((g, gi) => (
            <div key={g.title} className={gi ? 'mt-1 border-t border-line pt-1' : ''}>
              <p className="px-3 pt-2 pb-1 font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">{g.title}</p>
              {g.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => run(item)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none"
                >
                  <span className="font-medium text-ink">{item.label}</span>
                  <span className="truncate font-mono text-[11px] text-ink-3">{item.hint}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
