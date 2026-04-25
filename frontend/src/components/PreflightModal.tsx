/**
 * Runs the /preflight sequence in front of the user before a wizard run
 * actually starts. Three checks + one soft-fail (PowerPoint) gated on the
 * chosen output format.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Server, Cpu, Sparkles, Presentation, XCircle, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'
import type { OutputFormat, PreflightResponse } from '../api/types'
import { useFocusTrap } from '../hooks/useFocusTrap'

type CheckStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn'

interface CheckRow {
  key: keyof PreflightResponse['checks']
  label: string
  icon: typeof Server
}

const ROWS: CheckRow[] = [
  { key: 'platform', label: 'Platform', icon: Cpu },
  { key: 'backend', label: 'Backend connection', icon: Server },
  { key: 'ai_config', label: 'AI configuration', icon: Sparkles },
  { key: 'powerpoint', label: 'PowerPoint availability', icon: Presentation },
]

function statusDot(s: CheckStatus) {
  if (s === 'running') return <Loader2 size={16} className="animate-spin text-slate-400" />
  if (s === 'pass') return <CheckCircle2 size={16} className="text-brand-600" />
  if (s === 'warn') return <AlertTriangle size={16} className="text-amber-500" />
  if (s === 'fail') return <XCircle size={16} className="text-rose-500" />
  return <span className="inline-block h-4 w-4 rounded-full border border-slate-300 dark:border-white/15" />
}

interface PreflightModalProps {
  outputFormat: OutputFormat
  onCancel: () => void
  onProceed: () => void
}

const OUTPUT_LABELS: Record<OutputFormat, string> = {
  html: 'HTML file',
  images: 'screenshots',
  pptx: 'PowerPoint deck',
  video: 'MP4 video',
}

export default function PreflightModal({ outputFormat, onCancel, onProceed }: PreflightModalProps) {
  const [data, setData] = useState<PreflightResponse | null>(null)
  const [loadingKey, setLoadingKey] = useState<keyof PreflightResponse['checks'] | null>('platform')
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Walk through the visual rows so the user sees each one light up in
        // sequence, even though the backend reports them all at once.
        // Always request fresh — the user is gating a run behind this
        // modal and needs the actual current state of the backend, not a
        // 30-second-stale cached result.
        const res = await api.preflight({ fresh: true })
        if (cancelled) return
        for (const row of ROWS) {
          setLoadingKey(row.key)
          await new Promise((r) => setTimeout(r, 350))
          if (cancelled) return
        }
        setLoadingKey(null)
        setData(res)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoadingKey(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Escape key closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const needsPpt = outputFormat === 'pptx' || outputFormat === 'video'
  const pptOk = data?.checks.powerpoint.ok ?? false
  const aiOk = data?.checks.ai_config.ok ?? false
  const backendOk = !!data
  const blocked = !data
    ? false
    : !backendOk || !aiOk || (needsPpt && !pptOk)

  const rowStatus = (key: keyof PreflightResponse['checks']): CheckStatus => {
    if (!data) {
      if (loadingKey === key) return 'running'
      const idx = ROWS.findIndex((r) => r.key === loadingKey)
      const myIdx = ROWS.findIndex((r) => r.key === key)
      if (idx >= 0 && myIdx < idx) return 'pass'
      return 'idle'
    }
    const c = data.checks[key]
    if (c.ok) return 'pass'
    if (key === 'powerpoint' && !needsPpt) return 'warn'
    return 'fail'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preflight-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-900"
      >
        <h2
          id="preflight-title"
          className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50"
        >
          Pre-flight checks
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Verifying the runtime can actually produce{' '}
          <span className="font-medium">{OUTPUT_LABELS[outputFormat]}</span>.
        </p>

        <ul className="mt-5 space-y-3">
          {ROWS.map((row) => {
            const s = rowStatus(row.key)
            const detail = data?.checks[row.key].detail ?? ''
            const Icon = row.icon
            return (
              <li key={row.key} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 items-center justify-center">{statusDot(s)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className="text-slate-400" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {row.label}
                    </span>
                    {row.key === 'powerpoint' && !needsPpt && (
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">
                        optional for {OUTPUT_LABELS[outputFormat]}
                      </span>
                    )}
                  </div>
                  {detail && (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {error && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            Preflight request failed: {error}
          </div>
        )}

        {data && blocked && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {!aiOk && <p>AI config is missing — edit <code>backend/config/config.py</code> and restart the backend.</p>}
            {needsPpt && !pptOk && (
              <p className="mt-1">
                Output is <strong>{OUTPUT_LABELS[outputFormat]}</strong> but PowerPoint isn't
                available. Go back to step 1 and pick <em>HTML file</em> or{' '}
                <em>screenshots</em>, or install PowerPoint on a Windows host.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!data || blocked}
            onClick={onProceed}
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  )
}
