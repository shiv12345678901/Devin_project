import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'
import { ToastContext, type Toast, type ToastContextValue } from './toast'

const DEFAULT_DURATION = 4000

const ICONS: Record<Toast['variant'], typeof Info> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
}

const COLORS: Record<Toast['variant'], string> = {
  success: 'border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  info: 'border-slate-300/60 bg-white text-slate-800 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100',
  warning: 'border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200',
  error: 'border-rose-300/60 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback<ToastContextValue['push']>(
    (toast) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const next: Toast = { id, ...toast }
      setToasts((prev) => [...prev, next])
      const duration = toast.durationMs ?? DEFAULT_DURATION
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration)
        timers.current.set(id, timer)
      }
      return id
    },
    [dismiss],
  )

  const clear = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current.clear()
    setToasts([])
  }, [])

  // Cleanup on unmount. Snapshot the current Map so the cleanup function
  // doesn't reach back into the (possibly-different) ref at unmount time.
  useEffect(() => {
    const snapshot = timers.current
    return () => {
      snapshot.forEach((t) => clearTimeout(t))
      snapshot.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss, clear }),
    [toasts, push, dismiss, clear],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.variant]
          return (
            <div
              key={t.id}
              role={t.variant === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-md ${COLORS[t.variant]}`}
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 text-sm">
                {t.title && <div className="font-medium">{t.title}</div>}
                <div className="mt-0.5 break-words">{t.message}</div>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-mr-1 -mt-1 rounded p-1 text-current/70 hover:text-current focus:outline-none focus:ring-2 focus:ring-current"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
