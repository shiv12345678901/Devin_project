/**
 * Promise-based confirmation dialog (replacement for `window.confirm`).
 *
 * Use the imperative `useConfirm()` hook to show a dialog and await the
 * user's choice. Internally rendered through a portal so it works above
 * any other content.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}

type Resolver = (value: boolean) => void

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx.confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<Resolver | null>(null)
  const dialogRef = useFocusTrap<HTMLDivElement>(opts !== null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setOpts(options)
    })
  }, [])

  const close = (result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setOpts(null)
  }

  const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {opts !== null &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
              onClick={() => close(false)}
              aria-hidden
            />
            <div
              ref={dialogRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              tabIndex={-1}
              className="relative w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-lg dark:border-white/10 dark:bg-slate-900"
              onKeyDown={(e) => {
                if (e.key === 'Escape') close(false)
                if (e.key === 'Enter') close(true)
              }}
            >
              <h2
                id="confirm-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-slate-50"
              >
                {opts.title}
              </h2>
              {opts.message && (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {opts.message}
                </div>
              )}
              <div className="mt-5 flex items-center justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => close(false)}>
                  {opts.cancelLabel ?? 'Cancel'}
                </button>
                <button
                  type="button"
                  className={
                    opts.variant === 'danger'
                      ? 'btn-primary !bg-rose-600 hover:!bg-rose-700 focus:!ring-rose-500'
                      : 'btn-primary'
                  }
                  onClick={() => close(true)}
                  autoFocus
                >
                  {opts.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </ConfirmContext.Provider>
  )
}
