import { Check, Copy, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useToast } from '../store/toast'

interface Props {
  /** What kind of asset to preview — controls the rendered body. */
  kind: 'html' | 'image'
  /** Absolute URL of the asset (served by the backend). */
  src: string
  /** Caption shown at the top of the modal. */
  title: string
  /** Extra text rendered next to the title (e.g. size, timestamp). */
  subtitle?: string
  onClose: () => void
}

export default function HtmlPreviewModal({ kind, src, title, subtitle, onClose }: Props) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'ok'>('idle')
  const toast = useToast()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Lock scroll on the document while the modal is open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // "Copy HTML" fetches the underlying document (cross-origin to the
  // backend, but served same-origin in dev via the Vite proxy) and writes
  // it to the clipboard. On failure we surface a toast — clipboard denial
  // from insecure contexts is the most common reason.
  const onCopyHtml = async () => {
    if (kind !== 'html') return
    setCopyState('copying')
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopyState('ok')
      toast.push({ variant: 'success', message: 'HTML copied to clipboard.' })
      setTimeout(() => setCopyState('idle'), 1500)
    } catch (e) {
      setCopyState('idle')
      toast.push({
        variant: 'error',
        title: 'Copy failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="glass-strong relative flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3 dark:border-white/10">
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
              {title}
            </div>
            {subtitle && (
              <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {kind === 'html' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={onCopyHtml}
                disabled={copyState === 'copying'}
                title="Copy the document body to the clipboard"
              >
                {copyState === 'ok' ? <Check size={14} /> : <Copy size={14} />}
                {copyState === 'ok' ? 'Copied' : copyState === 'copying' ? 'Copying…' : 'Copy HTML'}
              </button>
            )}
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <ExternalLink size={14} /> Open in new tab
            </a>
            <button
              type="button"
              className="btn-ghost !px-2"
              onClick={onClose}
              aria-label="Close preview"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950/40">
          {kind === 'html' ? (
            <iframe
              src={src}
              title={title}
              sandbox="allow-same-origin allow-scripts allow-forms"
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
              <img
                src={src}
                alt={title}
                className="max-h-full max-w-full rounded-md object-contain shadow-lg"
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
