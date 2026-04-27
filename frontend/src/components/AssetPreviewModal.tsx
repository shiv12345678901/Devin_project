import { Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useToast } from '../store/toast'

interface Props {
  kind: 'html' | 'image' | 'video'
  src: string
  title: string
  subtitle?: string
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
}

export default function AssetPreviewModal({
  kind,
  src,
  title,
  subtitle,
  onClose,
  onPrevious,
  onNext,
}: Props) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'ok'>('idle')
  const toast = useToast()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (kind === 'image' && e.key === 'ArrowLeft') onPrevious?.()
      if (kind === 'image' && e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [kind, onClose, onNext, onPrevious])

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
      window.setTimeout(() => setCopyState('idle'), 1500)
    } catch (e) {
      setCopyState('idle')
      toast.push({
        variant: 'error',
        title: 'Copy failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const downloadName = title.split('/').pop() ?? title

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="glass-strong relative flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-white/10">
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
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {kind === 'image' && onPrevious && (
              <button type="button" className="btn-secondary btn-sm" onClick={onPrevious}>
                <ChevronLeft size={12} /> Previous
              </button>
            )}
            {kind === 'image' && onNext && (
              <button type="button" className="btn-secondary btn-sm" onClick={onNext}>
                Next <ChevronRight size={12} />
              </button>
            )}
            {kind === 'html' && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={onCopyHtml}
                disabled={copyState === 'copying'}
              >
                {copyState === 'ok' ? <Check size={14} /> : <Copy size={14} />}
                {copyState === 'ok' ? 'Copied' : copyState === 'copying' ? 'Copying...' : 'Copy HTML'}
              </button>
            )}
            <a href={src} download={downloadName} className="btn-secondary btn-sm">
              <Download size={14} /> Download
            </a>
            <a href={src} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
              <ExternalLink size={14} /> Open
            </a>
            <button type="button" className="btn-ghost !px-2" onClick={onClose} aria-label="Close preview">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-50 p-4 dark:bg-slate-950/40">
          {kind === 'html' ? (
            <iframe
              src={src}
              title={title}
              sandbox="allow-same-origin allow-scripts allow-forms"
              className="h-full min-h-[70vh] w-full rounded-md border-0 bg-white dark:bg-slate-950"
            />
          ) : kind === 'video' ? (
            <video src={src} controls autoPlay className="max-h-full max-w-full rounded-md bg-black" />
          ) : (
            <img src={src} alt={title} className="max-h-full max-w-full rounded-md object-contain shadow-lg" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
