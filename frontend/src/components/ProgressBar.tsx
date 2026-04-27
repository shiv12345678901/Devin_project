/**
 * Animated, stall-aware progress bar used by all three wizards (and the
 * Processes detail view). Beyond showing a percentage, it:
 *
 *   - Labels the current stage in human-readable form.
 *   - Shows a live ETA countdown (not the static server-reported estimate).
 *   - Adds a moving shimmer while actively working so the UI doesn't look
 *     frozen when the server is mid-step and not emitting progress events.
 *   - Detects quiet periods: if no progress, stage, or message update arrives
 *     for a while, it shows a calm "still working" hint instead of looking
 *     broken.
 */
import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

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
  queued: 'Queued',
  running: 'Starting process',
  init: 'Warming up',
  ai: 'Generating HTML with AI',
  ai_verify: 'Verifying completeness',
  ai_verify_skip: 'Skipping verification',
  ai_revision: 'Revising missing content',
  ai_done: 'AI response finalized',
  html_saved: 'HTML saved',
  screenshot: 'Capturing screenshots',
  export: 'Exporting video',
  screenshots_done: 'Screenshots ready',
  complete: 'Complete',
}

const ENGAGEMENT_MESSAGES: Record<string, string[]> = {
  queued: ['Waiting for the backend slot...', 'Preparing the run...', 'Keeping your job in line...'],
  running: ['Starting the backend process...', 'Opening the workflow...', 'Preparing the workspace...'],
  init: ['Sending request...', 'Checking settings...', 'Preparing files...'],
  ai: ['Sending request to AI...', 'Analyzing your text...', 'Writing the HTML...', 'Checking content structure...'],
  ai_verify: ['Checking AI output...', 'Looking for missing content...', 'Verifying the lesson flow...'],
  ai_revision: ['Revising the content...', 'Filling missing parts...', 'Polishing the generated HTML...'],
  html_saved: ['Saving generated HTML...', 'Preparing browser render...', 'Moving to screenshots...'],
  screenshot: ['Launching browser...', 'Rendering pages...', 'Capturing screenshots...', 'Checking screenshot output...'],
  screenshots_done: ['Screenshots found...', 'Preparing export...', 'Collecting generated files...'],
  export: ['Opening PowerPoint...', 'Building slides...', 'Exporting video...', 'Waiting for MP4 file...'],
  powerpoint_cleanup: ['Closing old PowerPoint sessions...', 'Clearing export conflicts...', 'Preparing PowerPoint...'],
  powerpoint: ['Building presentation...', 'Applying slide timing...', 'Exporting video...', 'Waiting for MP4 file...'],
}

function progressCeiling(progress: number, stage: string | undefined): number {
  if (progress >= 100) return 100
  if (!stage) return 96
  if (stage === 'queued') return Math.max(progress, 12)
  if (stage === 'ai' || stage.startsWith('ai_')) return Math.max(progress, 34)
  if (stage === 'html_saved') return Math.max(progress, 42)
  if (stage === 'screenshot') return Math.max(progress, 88)
  if (stage === 'screenshots_done') return Math.max(progress, 94)
  if (stage === 'export' || stage.startsWith('powerpoint')) return 99
  return 98
}

function engagementMessage(stage: string | undefined, tick: number): string {
  const messages = ENGAGEMENT_MESSAGES[stage ?? ''] ?? [
    'Working on it...',
    'Checking progress...',
    'Waiting for backend update...',
  ]
  return messages[tick % messages.length]
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

  // Track the last meaningful server update. A long step can keep the same
  // percentage but still update its message, and that should count as alive.
  const [lastUpdate, setLastUpdate] = useState<{
    progress: number
    stage?: string
    message?: string
    at: number
  }>(
    () => ({ progress: clamped, stage, message, at: Date.now() }),
  )
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastUpdate((prev) =>
      Math.abs(clamped - prev.progress) > 0.1 ||
      stage !== prev.stage ||
      message !== prev.message
        ? { progress: clamped, stage, message, at: Date.now() }
        : prev,
    )
  }, [clamped, stage, message])

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
  const engagementTick = Math.floor((now - mountedAt) / 3500)
  const fallbackMessage = useMemo(
    () => engagementMessage(stage, engagementTick),
    [stage, engagementTick],
  )

  // Keep the bar visibly alive between backend events. This is cosmetic only:
  // it is capped per stage and never reaches 100 until the server does.
  const [displayProgress, setDisplayProgress] = useState<number>(() => clamped)
  useEffect(() => {
    setDisplayProgress((prev) => {
      if (!active || clamped >= 100) return clamped
      if (clamped + 8 < prev) return clamped
      if (clamped > prev) return clamped
      return prev
    })
  }, [active, clamped])
  useEffect(() => {
    if (!active || clamped >= 100) return
    const id = window.setInterval(() => {
      setDisplayProgress((prev) => {
        const floor = Math.max(prev, clamped)
        const ceiling = progressCeiling(clamped, stage)
        if (floor >= ceiling) return floor
        return Math.min(ceiling, floor + 1)
      })
    }, 1200)
    return () => window.clearInterval(id)
  }, [active, clamped, stage])
  const shownProgress = Math.max(clamped, Math.min(displayProgress, clamped >= 100 ? 100 : progressCeiling(clamped, stage)))

  const elapsedSinceUpdate = Math.max(0, (now - lastUpdate.at) / 1000)
  const quiet = active && clamped < 99 && elapsedSinceUpdate > stallAfterSec
  const elapsedTotalSec = Math.max(0, (now - mountedAt) / 1000)

  const remainingSec = etaBase
    ? Math.max(0, etaBase.eta - (now - etaBase.at) / 1000)
    : null
  const displayMessage =
    active && clamped < 100 && (quiet || stage === 'queued' || !message)
      ? fallbackMessage
      : message || fallbackMessage

  return (
    <div className="card">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {prettyStage(stage)}
        </div>
        <div className="shrink-0 text-sm tabular-nums text-slate-500">
          {Math.round(shownProgress)}%
        </div>
      </div>
      <div
        className={
          'relative h-2 w-full overflow-hidden rounded-full ' +
          (quiet
            ? 'bg-amber-100 dark:bg-amber-500/10'
            : 'bg-slate-100 dark:bg-white/[0.06]')
        }
      >
        <div
          className={
            'h-full rounded-full transition-[width] duration-500 ease-out ' +
            (quiet
              ? 'bg-amber-500'
              : clamped >= 100
              ? 'bg-emerald-500'
              : 'bg-brand-500')
          }
          style={{ width: `${Math.max(shownProgress, active ? 2 : 0)}%` }}
        />
        {active && !quiet && clamped < 99 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 animate-[shimmer_1.6s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent"
            style={{ width: `${Math.max(shownProgress, 2)}%` }}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
          {displayMessage}
        </div>
        <div className="shrink-0 tabular-nums text-slate-500">
          {remainingSec !== null && remainingSec > 0
            ? `~${formatDuration(remainingSec)} remaining`
            : `${formatDuration(elapsedTotalSec)} elapsed`}
        </div>
      </div>
      {quiet && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" />
          <div>
            <div className="font-semibold">
              Still working for {formatDuration(elapsedSinceUpdate)} without a new update.
            </div>
            <div className="mt-0.5 opacity-90">
              Long AI responses, browser rendering, and PowerPoint export can
              pause between updates. The run is still active unless an error
              message appears.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
