/**
 * Lightweight toast / notification store.
 *
 * Avoids the alert()-style modal blocking dialogs that the app used to
 * pop for every minor success or failure. Toasts auto-dismiss after a
 * configurable timeout, support all four severity levels, and stack at
 * the top-right of the viewport.
 *
 * The hook is split from the provider so this file stays JSX-free
 * (matches the runs / settings stores).
 */
import { createContext, useContext } from 'react'

export type ToastVariant = 'success' | 'info' | 'warning' | 'error'

export interface Toast {
  id: string
  variant: ToastVariant
  title?: string
  message: string
  /** ms before auto-dismiss; 0 disables auto-dismiss. */
  durationMs?: number
}

export interface ToastContextValue {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return ctx
}
