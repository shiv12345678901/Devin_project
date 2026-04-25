/**
 * Animated, stall-aware progress bar used by all three wizards (and the
 * Processes detail view). Beyond showing a percentage, it:
 *
 *   - Labels the current stage in human-readable form.
 *   - Shows a live ETA countdown (not the static server-reported estimate).
 *   - Adds a moving shimmer while actively working so the UI doesn't look
 *     frozen when the server is mid-step and not emitting progress events.
 *   - Detects stalls: if the reported progress hasn't changed for a while,
 *     the bar switches into a warning state and surfaces a hint to check
 *     the backend (the #1 reason runs look "stuck at 0%").
 */
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  progress: number
  stage?: string
  message?: string
  etaSeconds?: number
  /**
   * When false the bar stops animating and hides the stall warning — used
   * by callers that want to render a frozen summary of a finished run.
   */
  active?: boolean
  /** Seconds to wait with no progress change before flagging a stall. */
  stallAfterSec?: number
}

const STAGE_LABELS: Record<string, string> = {
  init: 'Warming up',
  ai: 'Generating HTML with AI',
  ai_verify: 'Verifying completeness',
  ai_verify_skip: 'Skipping verification',
  ai_revision: 'Revising missing content',
  ai_done: 'AI response finalized',
  html_saved: 'HTML saved',
  screenshot: 'Capturing screenshots',
  screenshots_done: 'Screenshots ready',
  complete: 'Complete',
}

function prettyStage(stage: string | undefined): string {
  if (!stage) return 'Working…'
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ')
}

function formatDuration(sec: number): string {
  if (sec <= 0) return 'less than 1s'
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec - m * 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

/** Wall-clock value in ms that re-renders every `tickMs` while enabled. */
function useNow(enabled: boolean, tickMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setNow(Date.now()), tickMs)
    return () => window.clearInterval(id)
  }, [enabled, tickMs])
  return now
}

export default function ProgressBar({
  progress,
  stage,
  message,
  etaSeconds,
  active = true,
  stallAfterSec = 20,
}: Props) {
  const clamped = Math.max(0, Math.min(100, progress))
  const [mountedAt] = useState<number>(() => Date.now())

  // `lastProgress` tracks the most recent server-reported value and when
  // we saw it. `lastProgress.value` is compared against the incoming
  // `clamped` to decide whether to reset the stall timer.
  const [lastProgress, setLastProgress] = useState<{ value: number; at: number }>(
    () => ({ value: clamped, at: Date.now() }),
  )
  // Track when the server-reported progress last *actually* changed. The
  // lint rule against setState-in-effect doesn't fit this case (derive
  // timing of external-prop changes), so disable it for the setState call.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastProgress((prev) =>
      Math.abs(clamped - prev.value) > 0.1 ? { value: clamped, at: Date.now() } : prev,
    )
  }, [clamped])

  // Rebase the ETA countdown on each new server estimate so the "remaining"
  // label starts at the server value and counts down locally.
  const [etaBase, setEtaBase] = useState<{ at: number; eta: number } | null>(
    () =>
      typeof etaSeconds === 'number' && etaSeconds > 0
        ? { at: Date.now(), eta: etaSeconds }
        : null,
  )
  useEffect(() => {
    if (typeof etaSeconds === 'number' && etaSeconds > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEtaBase({ at: Date.now(), eta: etaSeconds })
    }
  }, [etaSeconds])

  const now = useNow(active)

  const elapsedSinceChange = Math.max(0, (now - lastProgress.at) / 1000)
  const stalled = active && clamped < 99 && elapsedSinceChange > stallAfterSec
  const elapsedTotalSec = Math.max(0, (now - mountedAt) / 1000)

  const remainingSec = etaBase
    ? Math.max(0, etaBase.eta - (now - etaBase.at) / 1000)
    : null

  return (
    <div className="card">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {prettyStage(stage)}
        </div>
        <div className="shrink-0 text-sm tabular-nums text-slate-500">
          {Math.round(clamped)}%
        </div>
      </div>
      <div
        className={
          'relative h-2 w-full overflow-hidden rounded-full ' +
          (stalled
            ? 'bg-amber-100 dark:bg-amber-500/10'
            : 'bg-slate-100 dark:bg-white/[0.06]')
        }
      >
        <div
          className={
            'h-full rounded-full transition-[width] duration-500 ease-out ' +
            (stalled
              ? 'bg-amber-500'
              : clamped >= 100
              ? 'bg-emerald-500'
              : 'bg-brand-500')
          }
          style={{ width: `${Math.max(clamped, active ? 2 : 0)}%` }}
        />
        {active && !stalled && clamped < 99 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 animate-[shimmer_1.6s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent"
            style={{ width: `${Math.max(clamped, 2)}%` }}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
          {message ?? ' '}
        </div>
        <div className="shrink-0 tabular-nums text-slate-500">
          {remainingSec !== null && remainingSec > 0
            ? `~${formatDuration(remainingSec)} remaining`
            : `${formatDuration(elapsedTotalSec)} elapsed`}
        </div>
      </div>
      {stalled && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">
              No progress for {formatDuration(elapsedSinceChange)}.
            </div>
            <div className="mt-0.5 opacity-90">
              The backend may be blocked on a slow AI response, an unreachable
              model endpoint, or a missing / invalid <code>API_KEY</code>. Check
              <code> /preflight</code>, the backend terminal, and
              <code> backend/config/config.py</code>.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
