import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Monitor,
  RotateCw,
  Smartphone,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
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
  const [htmlMode, setHtmlMode] = useState<'desktop' | 'mobile'>('desktop')
  const [htmlZoom, setHtmlZoom] = useState(100)
  const [reloadKey, setReloadKey] = useState(0)
  const [htmlContent, setHtmlContent] = useState('')
  const [htmlLoading, setHtmlLoading] = useState(false)
  const [htmlError, setHtmlError] = useState('')
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

  useEffect(() => {
    if (kind !== 'html') return undefined
    let cancelled = false
    setHtmlLoading(true)
    setHtmlError('')
    fetch(src, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (!cancelled) setHtmlContent(text)
      })
      .catch((e) => {
        if (cancelled) return
        setHtmlContent('')
        const message = e instanceof Error ? e.message : String(e)
        setHtmlError(
          message === 'Failed to fetch'
            ? 'Could not reach the backend HTML server. Restart the backend or check the Backend URL in Settings.'
            : message,
        )
      })
      .finally(() => {
        if (!cancelled) setHtmlLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, reloadKey, src])

  const onCopyHtml = async () => {
    if (kind !== 'html') return
    setCopyState('copying')
    try {
      let text = htmlContent
      if (!text) {
        const res = await fetch(src, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        text = await res.text()
      }
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
  const htmlFrameWidth = htmlMode === 'mobile' ? 390 : 1280

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
            {kind === 'html' && (
              <>
                <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-white/10 dark:bg-white/[0.03]">
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                      htmlMode === 'desktop'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
                    }`}
                    onClick={() => setHtmlMode('desktop')}
                  >
                    <Monitor size={12} /> Desktop
                  </button>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                      htmlMode === 'mobile'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
                    }`}
                    onClick={() => setHtmlMode('mobile')}
                  >
                    <Smartphone size={12} /> Mobile
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setHtmlZoom((value) => Math.max(60, value - 10))}
                  disabled={htmlZoom <= 60}
                >
                  <ZoomOut size={12} />
                </button>
                <span className="min-w-12 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
                  {htmlZoom}%
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setHtmlZoom((value) => Math.min(140, value + 10))}
                  disabled={htmlZoom >= 140}
                >
                  <ZoomIn size={12} />
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  <RotateCw size={12} /> Reload
                </button>
              </>
            )}
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
            <div className="flex h-full min-h-[70vh] w-full items-start justify-center overflow-auto rounded-md bg-slate-200 p-4 dark:bg-slate-900">
              {htmlLoading ? (
                <div className="flex min-h-[70vh] w-full max-w-xl items-center justify-center rounded-md border border-slate-300 bg-white text-sm text-slate-600 shadow-xl dark:border-white/10 dark:bg-slate-950 dark:text-slate-300">
                  Loading HTML preview...
                </div>
              ) : htmlError ? (
                <div className="w-full max-w-xl rounded-md border border-rose-200 bg-white p-5 text-sm text-slate-700 shadow-xl dark:border-rose-500/30 dark:bg-slate-950 dark:text-slate-200">
                  <div className="font-semibold text-rose-700 dark:text-rose-200">Could not load HTML preview.</div>
                  <p className="mt-2 text-slate-600 dark:text-slate-300">{htmlError}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setReloadKey((value) => value + 1)}>
                      <RotateCw size={12} /> Retry
                    </button>
                    <a href={src} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                      <ExternalLink size={12} /> Open URL
                    </a>
                  </div>
                </div>
              ) : (
                <iframe
                  key={reloadKey}
                  srcDoc={htmlContent}
                  title={title}
                  sandbox="allow-same-origin"
                  style={{
                    width: htmlFrameWidth,
                    height: `${10000 / htmlZoom}%`,
                    transform: `scale(${htmlZoom / 100})`,
                    transformOrigin: 'top center',
                  }}
                  className="min-h-[70vh] max-w-none rounded-md border-0 bg-white shadow-xl dark:bg-slate-950"
                />
              )}
            </div>
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
