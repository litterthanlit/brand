import { useCallback, useEffect, useRef, useState } from 'react'

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const notify = useCallback((msg: string) => {
    setMessage(msg)
    setKey((k) => k + 1)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 2400)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { message, key, notify }
}

export function Toast({ message, id }: { message: string | null; id: number }) {
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      {message && (
        <div
          key={id}
          className="animate-[toast-in_200ms_var(--ease-out-soft)] rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]"
        >
          {message}
        </div>
      )}
    </div>
  )
}
