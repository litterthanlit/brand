import { useId, useState, type ReactNode } from 'react'
import { PALETTES } from '../lib/palettes'
import type { Param, ParamValue, ParamValues } from '../tools/types'
import { CloseIcon, ImageIcon, LockIcon, PlusIcon, UnlockIcon } from './Icons'

interface ControlsProps {
  params: Param[]
  values: ParamValues
  locked: Set<string>
  onChange: (key: string, value: ParamValue) => void
  onToggleLock: (key: string) => void
  showLocks?: boolean
}

export function Controls({ params, values, locked, onChange, onToggleLock, showLocks = true }: ControlsProps) {
  return (
    <div className="pt-1">
      {params
        .filter((param) => !param.when || param.when(values))
        .map((param) => (
          <ControlRow
            key={param.key}
            param={param}
            value={values[param.key]}
            locked={locked.has(param.key)}
            showLock={showLocks}
            onChange={(v) => onChange(param.key, v)}
            onToggleLock={() => onToggleLock(param.key)}
          />
        ))}
    </div>
  )
}

interface RowProps {
  param: Param
  value: ParamValue
  locked: boolean
  showLock: boolean
  onChange: (v: ParamValue) => void
  onToggleLock: () => void
}

function ControlRow({ param, value, locked, showLock, onChange, onToggleLock }: RowProps) {
  const id = useId()
  const lockable = showLock && param.type !== 'image' && param.randomize !== false
  const labelId = `${id}-label`

  let body: ReactNode
  let aside: ReactNode = null
  // Native inputs get a real <label for>; composite widgets are named via aria-labelledby.
  let nativeLabel = false
  switch (param.type) {
    case 'number': {
      const v = value as number
      const fill = ((v - param.min) / (param.max - param.min)) * 100
      const decimals = Math.max(0, (param.step.toString().split('.')[1] ?? '').length)
      aside = (
        <span className="flex items-baseline gap-0.5 text-[12.5px] text-ink-2">
          <input
            type="number"
            aria-label={`${param.label} value`}
            className="no-spinner w-14 rounded-md bg-transparent px-1 py-0.5 text-right tabular-nums outline-none hover:bg-paper-2 hover:text-ink focus:bg-paper-2 focus:text-ink"
            min={param.min}
            max={param.max}
            step={param.step}
            value={Number(v.toFixed(decimals))}
            onChange={(e) => {
              const n = e.target.valueAsNumber
              if (Number.isFinite(n)) onChange(Math.max(param.min, Math.min(param.max, n)))
            }}
          />
          {param.unit && <span className="text-ink-3">{param.unit}</span>}
        </span>
      )
      nativeLabel = true
      body = (
        <input
          id={id}
          type="range"
          className="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={v}
          style={{ ['--fill' as string]: `${fill}%` }}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
      )
      break
    }
    case 'select': {
      const short = param.options.length <= 4 && param.options.reduce((n, o) => n + o.label.length, 0) <= 26
      nativeLabel = !short
      body = short ? (
        <div role="radiogroup" aria-labelledby={labelId} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${param.options.length}, minmax(0, 1fr))` }}>
          {param.options.map((o) => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(o.value)}
                className={`h-7 truncate rounded-md px-2 text-[12.5px] transition-colors duration-200 ${active ? 'bg-paper-2 text-ink' : 'text-ink-3 hover:text-ink-2'}`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="relative">
          <select
            id={id}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full appearance-none rounded-md bg-paper-2 pr-8 pl-2.5 text-[13px] text-ink transition-colors hover:bg-line-2"
          >
            {param.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <svg aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3" width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )
      break
    }
    case 'boolean': {
      const on = value as boolean
      aside = (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          onClick={() => onChange(!on)}
          className={`relative h-4 w-7 rounded-full transition-colors duration-200 ${on ? 'bg-ink' : 'bg-line-2'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full transition-[transform,background-color] duration-200 ease-out-soft ${on ? 'translate-x-3 bg-paper' : 'bg-ink-3'}`}
          />
        </button>
      )
      break
    }
    case 'text':
      nativeLabel = true
      body = (
        <input
          id={id}
          type="text"
          value={value as string}
          maxLength={param.maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full rounded-md bg-paper-2 px-2.5 text-[13px] text-ink transition-colors outline-none hover:bg-line-2 focus:bg-line-2"
        />
      )
      break
    case 'color':
      body = <ColorSwatch label={param.label} value={value as string} onChange={onChange} />
      break
    case 'palette':
      body = <PaletteEditor param={param} value={value as string[]} onChange={onChange} />
      break
    case 'image':
      body = <ImageInput value={value as ImageBitmap | null} onChange={onChange} />
      break
  }

  return (
    <div className="group px-5 py-2.5">
      <div className={`flex min-h-6 items-center justify-between gap-3 ${body ? 'mb-2' : ''}`}>
        {nativeLabel ? (
          <label id={labelId} htmlFor={id} className="text-[13px] text-ink-2">
            {param.label}
          </label>
        ) : (
          <span id={labelId} className="text-[13px] text-ink-2">
            {param.label}
          </span>
        )}
        <div className="flex items-center gap-1">
          {aside}
          {lockable && (
            <button
              type="button"
              onClick={onToggleLock}
              aria-pressed={locked}
              aria-label={`${locked ? 'Unlock' : 'Lock'} ${param.label} when randomising`}
              title={locked ? 'Locked: Randomize keeps this' : 'Lock to keep when randomising'}
              className={`grid h-6 w-6 place-items-center rounded-md transition-all duration-150 hover:bg-paper-2 ${
                locked ? 'text-accent-ink opacity-100' : 'text-ink-3 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
              }`}
            >
              {locked ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
            </button>
          )}
        </div>
      </div>
      {body}
    </div>
  )
}

function ColorSwatch({ label, value, onChange, onRemove }: { label: string; value: string; onChange: (v: string) => void; onRemove?: () => void }) {
  return (
    <div className="group/sw relative">
      <label
        className="relative block h-8 w-8 cursor-pointer overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-transform duration-200 hover:scale-105 focus-within:ring-1 focus-within:ring-ink focus-within:ring-offset-2 focus-within:ring-offset-paper"
        style={{ background: value }}
        title={value.toUpperCase()}
      >
        <span className="sr-only">
          {label} {value}
        </span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="absolute -top-1 -right-1 hidden h-4 w-4 place-items-center rounded-full bg-ink text-paper group-hover/sw:grid focus-visible:grid"
        >
          <CloseIcon size={9} strokeWidth={3} />
        </button>
      )}
    </div>
  )
}

function PaletteEditor({ param, value, onChange }: { param: Extract<Param, { type: 'palette' }>; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const min = param.min ?? 2
  const max = param.max ?? 8
  const fit = (colors: string[]) => {
    const out = colors.slice(0, max)
    for (let i = 0; out.length < min; i++) out.push(out[i % out.length])
    return out
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((c, i) => (
          <ColorSwatch
            key={i}
            label={i === 0 ? 'Background colour' : `Colour ${i + 1}`}
            value={c}
            onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))}
            onRemove={value.length > min ? () => onChange(value.filter((_, j) => j !== i)) : undefined}
          />
        ))}
        {value.length < max && (
          <button
            type="button"
            onClick={() => onChange([...value, value[value.length - 1]])}
            aria-label="Add colour"
            className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-line-2 text-ink-3 transition-colors hover:border-ink-3 hover:text-ink"
          >
            <PlusIcon size={14} />
          </button>
        )}
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-3 text-[12px] text-ink-3 transition-colors hover:text-ink"
      >
        {open ? 'Hide presets' : `Browse ${PALETTES.length} presets`}
      </button>
      {open && (
        <ul className="mt-3 grid grid-cols-2 gap-2" aria-label="Palette presets">
          {PALETTES.map((pl) => (
            <li key={pl.name}>
              <button
                type="button"
                onClick={() => onChange(fit(pl.colors))}
                className="group/p w-full rounded-md p-1.5 text-left transition-colors hover:bg-paper-2"
              >
                <span className="flex h-5 overflow-hidden rounded-sm">
                  {pl.colors.map((c, i) => (
                    <span key={i} className="flex-1" style={{ background: c }} />
                  ))}
                </span>
                <span className="mt-1 block truncate px-0.5 text-[11.5px] text-ink-3 group-hover/p:text-ink-2">{pl.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ImageInput({ value, onChange }: { value: ImageBitmap | null; onChange: (v: ImageBitmap | null) => void }) {
  const id = useId()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.')
      return
    }
    try {
      setError(null)
      onChange(await createImageBitmap(file))
    } catch {
      setError('Could not read that image.')
    }
  }
  return (
    <div>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          load(e.dataTransfer.files[0])
        }}
        className={`flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-3 py-3 text-[13px] transition-colors focus-within:border-ink-3 ${
          dragging ? 'border-ink-2 bg-paper-2' : 'border-line-2 hover:border-ink-3'
        }`}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-paper-2 text-ink-2">
          <ImageIcon size={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-ink">{value ? `Image loaded · ${value.width}×${value.height}` : 'Drop or choose an image'}</span>
          <span className="block text-[12px] text-ink-3">Stays on your device, never uploaded</span>
        </span>
        <input id={id} type="file" accept="image/*" className="sr-only" onChange={(e) => load(e.target.files?.[0])} />
      </label>
      {value && (
        <button type="button" onClick={() => onChange(null)} className="mt-2 text-[12px] text-ink-3 transition-colors hover:text-ink">
          Remove image
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-accent-ink">
          {error}
        </p>
      )}
    </div>
  )
}
