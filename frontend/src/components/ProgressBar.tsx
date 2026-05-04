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
import { Film, LoaderCircle, Presentation, Sparkles } from 'lucide-react'

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
  /** Seconds to wait with no progress change before showing a quiet-step note. */
  stallAfterSec?: number
}

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Starting process',
  init: 'Warming up',
  ai_waiting: 'Waiting for AI slot',
  ai: 'Generating HTML with AI',
  ai_done: 'AI response finalized',
  html_saved: 'HTML saved',
  screenshot_waiting: 'Waiting for screenshot slot',
  screenshot: 'Capturing screenshots',
  export_waiting: 'Waiting for export slot',
  export: 'Exporting video',
  video_export: 'Exporting MP4 video',
  video_complete: 'Video export finalized',
  powerpoint_cleanup: 'Preparing PowerPoint',
  powerpoint: 'Building PowerPoint deck',
  powerpoint_complete: 'PowerPoint deck saved',
  screenshots_done: 'Screenshots ready',
  complete: 'Complete',
}

const ENGAGEMENT_MESSAGES: Record<string, string[]> = {
  queued: ['Waiting for the backend slot...', 'Preparing the run...', 'Keeping your job in line...'],
  running: ['Starting the backend process...', 'Opening the workflow...', 'Preparing the workspace...'],
  init: ['Sending request...', 'Checking settings...', 'Preparing files...'],
  ai_waiting: ['Waiting for another AI phase...', 'Holding this job ready...', 'Watching for an AI slot...'],
  ai: ['Sending request to AI...', 'Analyzing your text...', 'Writing the HTML...', 'Checking content structure...'],
  html_saved: ['Saving generated HTML...', 'Preparing browser render...', 'Moving to screenshots...'],
  screenshot_waiting: ['Waiting for browser lane...', 'Holding generated HTML ready...', 'Preparing screenshot capture...'],
  screenshot: ['Launching browser...', 'Rendering pages...', 'Capturing screenshots...', 'Checking screenshot output...'],
  screenshots_done: ['Screenshots found...', 'Preparing export...', 'Collecting generated files...'],
  export_waiting: ['Waiting for screenshot capture to finish...', 'Holding export until PowerPoint is free...', 'Preparing the deck handoff...'],
  export: ['Opening PowerPoint...', 'Building slides...', 'Exporting video...', 'Waiting for MP4 file...'],
  video_export: ['PowerPoint is encoding...', 'Watching the MP4 grow...', 'Checking export status...', 'Waiting for finalization...'],
  video_complete: ['Verifying MP4 output...', 'Collecting video file...', 'Preparing the final result...'],
  powerpoint_cleanup: ['Closing old PowerPoint sessions...', 'Clearing export conflicts...', 'Preparing PowerPoint...'],
  powerpoint: ['Building presentation...', 'Applying slide timing...', 'Exporting video...', 'Waiting for MP4 file...'],
  powerpoint_complete: ['Deck saved...', 'Preparing video export...', 'Moving to MP4 rendering...'],
}

const ACTIVITY_STEPS: Record<string, string[]> = {
  queued: [
    'Preparing your run',
    'Checking the queue',
    'Holding your place',
    'Waiting for the backend slot',
    'Keeping the job ready',
    'Preparing project details',
    'Checking run settings',
    'Getting the workflow ready',
    'Waiting for the current process',
    'Keeping your request warm',
    'Preparing the next task',
    'Watching for an open slot',
    'Organizing the queued job',
    'Checking output preferences',
    'Standing by to start',
    'Preparing the launch step',
    'Keeping files ready',
    'Waiting for processing time',
    'Queue position is being watched',
    'Ready to start soon',
  ],
  running: [
    'Opening the workflow',
    'Checking settings',
    'Starting the backend',
    'Preparing the request',
    'Loading project details',
    'Reading selected class',
    'Reading selected subject',
    'Checking chapter name',
    'Preparing output settings',
    'Checking video options',
    'Preparing browser tools',
    'Preparing AI settings',
    'Checking cache preference',
    'Preparing folders',
    'Starting generation pipeline',
    'Setting up the run',
    'Connecting frontend to backend',
    'Preparing progress stream',
    'Starting background worker',
    'Getting everything ready',
  ],
  init: [
    'Sending request',
    'Preparing prompt',
    'Contacting AI',
    'Packaging your text',
    'Reading the input',
    'Checking text length',
    'Preparing system instructions',
    'Choosing the AI model',
    'Building the generation request',
    'Attaching project metadata',
    'Preparing chapter context',
    'Checking formatting rules',
    'Preparing HTML instructions',
    'Warming up the backend',
    'Opening the AI connection',
    'Preparing response stream',
    'Checking cancellation controls',
    'Starting the AI phase',
    'Preparing content structure',
    'Sending everything to the model',
  ],
  ai_waiting: [
    'Waiting for AI slot',
    'Keeping run ready',
    'Checking active AI jobs',
    'Holding project details',
    'Preparing prompt handoff',
  ],
  ai: [
    'Sending request to AI',
    'Waiting for AI response',
    'Receiving model output',
    'Generating HTML',
    'Structuring the lesson',
    'Reading source text',
    'Finding main sections',
    'Building headings',
    'Arranging explanations',
    'Formatting answers',
    'Creating clean HTML',
    'Adding visual structure',
    'Checking content order',
    'Converting notes to layout',
    'Balancing text blocks',
    'Preparing screenshot-friendly HTML',
    'Keeping long content organized',
    'Following your system prompt',
    'Preserving important details',
    'Writing classroom-ready content',
    'Shaping the page design',
    'Preparing readable sections',
    'Checking generated markup',
    'Waiting for final tokens',
    'Collecting the AI response',
    'Finishing the HTML draft',
    'Keeping the stream alive',
    'Still receiving content',
    'Almost done with AI generation',
  ],
  html_saved: [
    'Saving HTML',
    'Preparing browser',
    'Starting screenshots',
    'Writing HTML file',
    'Checking saved output',
    'Preparing render folder',
    'Passing HTML to browser',
    'Loading page preview',
    'Preparing screenshot engine',
    'Checking viewport settings',
    'Applying zoom settings',
    'Applying overlap settings',
    'Preparing capture plan',
    'Estimating page slices',
    'Opening renderer',
    'Waiting for page layout',
    'Checking generated file',
    'Moving to screenshot phase',
    'Preparing visual output',
    'HTML is ready for capture',
  ],
  screenshot_waiting: [
    'Waiting for screenshot slot',
    'Checking browser lane',
    'Keeping HTML ready',
    'Waiting for browser lane',
    'Watching screenshot resources',
    'Preparing capture settings',
    'Holding until capture is available',
    'Ready to capture next',
  ],
  export: [
    'Preparing video export',
    'Opening PowerPoint',
    'Building slide deck',
    'Adding screenshots to slides',
    'Applying slide duration',
    'Checking video resolution',
    'Setting export quality',
    'Preparing MP4 renderer',
    'Starting video export',
    'PowerPoint is rendering',
    'Waiting for export progress',
    'Watching output file',
    'Checking MP4 file size',
    'Waiting for video finalization',
    'Verifying exported video',
    'Keeping PowerPoint active',
    'Collecting export result',
    'Preparing download link',
    'Finishing MP4 output',
    'Almost ready with video',
  ],
  export_waiting: [
    'Waiting for export slot',
    'Checking PowerPoint lane',
    'Waiting for screenshot capture',
    'Keeping deck settings ready',
    'Preparing export paths',
    'Holding video handoff',
    'Watching shared resources',
    'Ready to export next',
  ],
  video_export: [
    'Starting MP4 export',
    'Handing slides to PowerPoint',
    'Applying saved timings',
    'Checking video resolution',
    'Setting frame rate',
    'Setting export quality',
    'PowerPoint is encoding frames',
    'Waiting for rendered frames',
    'Watching the MP4 file grow',
    'Checking file size',
    'Keeping PowerPoint active',
    'Waiting for CreateVideo status',
    'Checking export health',
    'Finalizing video container',
    'Waiting for file lock release',
    'Verifying MP4 output',
    'Collecting video file',
    'Preparing download link',
    'Almost done exporting',
    'Finishing video step',
  ],
  video_complete: [
    'Video export finished',
    'Verifying final file',
    'Collecting MP4 output',
    'Preparing result summary',
    'Almost ready',
  ],
  powerpoint_cleanup: [
    'Checking PowerPoint sessions',
    'Closing old PowerPoint windows',
    'Clearing export conflicts',
    'Preparing clean export',
    'Releasing locked files',
    'Checking automation state',
    'Getting PowerPoint ready',
    'Preparing deck builder',
    'Waiting for PowerPoint cleanup',
    'Starting export environment',
    'Checking template access',
    'Preparing slide workspace',
    'Resetting PowerPoint state',
    'Preparing video pipeline',
    'Moving to deck creation',
    'Cleaning previous handles',
    'Checking COM automation',
    'Preparing output folders',
    'Opening a fresh session',
    'Ready for presentation build',
  ],
  powerpoint: [
    'Building presentation',
    'Adding images to slides',
    'Applying slide timings',
    'Preparing video frames',
    'Checking template slides',
    'Arranging screenshot slides',
    'Setting playback duration',
    'Preparing export path',
    'Starting MP4 conversion',
    'PowerPoint is encoding video',
    'Waiting for rendered frames',
    'Watching video output grow',
    'Checking export status',
    'Finalizing presentation',
    'Finalizing MP4 file',
    'Verifying video exists',
    'Preparing final output',
    'Collecting presentation file',
    'Collecting video file',
    'Almost done exporting',
  ],
  powerpoint_complete: [
    'Presentation saved',
    'Checking deck output',
    'Preparing export handoff',
    'Getting video renderer ready',
    'Moving to MP4 export',
  ],
}

function progressCeiling(progress: number, stage: string | undefined): number {
  if (progress >= 100) return 100
  if (!stage) return 96
  if (stage === 'queued') return Math.max(progress, 12)
  if (stage === 'ai_waiting') return Math.max(progress, 8)
  if (stage === 'ai' || stage.startsWith('ai_')) return Math.max(progress, 34)
  if (stage === 'html_saved') return Math.max(progress, 42)
  if (stage === 'screenshot_waiting') return Math.max(progress, 34)
  if (stage === 'screenshot') return Math.max(progress, 88)
  if (stage === 'screenshots_done') return Math.max(progress, 94)
  if (stage === 'export_waiting' || stage === 'export' || stage.startsWith('powerpoint') || stage.startsWith('video_')) return 99
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

function activitySteps(stage: string | undefined): string[] {
  if (!stage) return ACTIVITY_STEPS.running
  return ACTIVITY_STEPS[stage] ?? []
}

function isExportStage(stage: string | undefined): boolean {
  return (
    stage === 'export' ||
    stage === 'export_waiting' ||
    stage === 'powerpoint_cleanup' ||
    stage === 'powerpoint' ||
    stage === 'powerpoint_complete' ||
    stage === 'video_export' ||
    stage === 'video_complete'
  )
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
  stallAfterSec = 90,
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
  // Engagement messages now rotate every ~6s (was 3.5s) so they don't
  // distract the eye when the server is silent. The server-provided
  // `message` always wins below — see `displayMessage`.
  const engagementTick = Math.floor((now - mountedAt) / 6000)
  const fallbackMessage = useMemo(
    () => engagementMessage(stage, engagementTick),
    [stage, engagementTick],
  )
  const steps = useMemo(() => activitySteps(stage), [stage])
  const exportStage = isExportStage(stage)

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

  // J5: surface the rounded progress to screen readers, but only step the
  // announced bucket every 10% so JAWS/NVDA don't speak every tick. The
  // visible percent stays smooth — this is a parallel low-resolution string
  // for the live region only.
  const announcedBucket = Math.min(100, Math.max(0, Math.round(shownProgress / 10) * 10))
  const liveAnnouncement = active
    ? clamped >= 100
      ? 'Run complete.'
      : `${announcedBucket} percent complete. ${prettyStage(stage)}.`
    : ''

  const elapsedSinceUpdate = Math.max(0, (now - lastUpdate.at) / 1000)
  const quiet = active && !exportStage && clamped < 99 && elapsedSinceUpdate > stallAfterSec
  const elapsedTotalSec = Math.max(0, (now - mountedAt) / 1000)
  const activeStepIndex = steps.length ? Math.floor(elapsedTotalSec / 4) % steps.length : -1
  const activeStepLabel = activeStepIndex >= 0 ? steps[activeStepIndex] : ''

  const remainingSec = etaBase
    ? Math.max(0, etaBase.eta - (now - etaBase.at) / 1000)
    : null
  // Prefer the server's message whenever it's present and we're actively
  // running. Only fall back to the engagement copy when the server is
  // silent (no message yet, queued, or stalled past `stallAfterSec`).
  const displayMessage = !active
    ? message || fallbackMessage
    : message && !quiet && stage !== 'queued'
    ? message
    : fallbackMessage

  return (
    <div className="card">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shownProgress)}
        aria-valuetext={liveAnnouncement || `${Math.round(shownProgress)} percent`}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveAnnouncement}
      </div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {prettyStage(stage)}
        </div>
        <div className="shrink-0 text-sm tabular-nums text-slate-500" aria-hidden="true">
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
      {active && (clamped < 60 || exportStage) && activeStepLabel && (
        <div
          className={
            'relative mt-3 overflow-hidden rounded-md border px-3 py-3 shadow-sm ' +
            (exportStage
              ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-sky-50 text-emerald-800 dark:border-emerald-500/30 dark:from-emerald-500/10 dark:via-white/[0.04] dark:to-sky-500/10 dark:text-emerald-100'
              : 'border-brand-200 bg-gradient-to-r from-brand-50 via-white to-brand-50 text-brand-800 dark:border-brand-500/30 dark:from-brand-500/10 dark:via-white/[0.04] dark:to-brand-500/10 dark:text-brand-100')
          }
        >
          <div
            aria-hidden="true"
            className={
              'pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-[shimmer_1.8s_linear_infinite] bg-gradient-to-r from-transparent to-transparent ' +
              (exportStage ? 'via-emerald-200/70 dark:via-emerald-300/20' : 'via-brand-200/60 dark:via-brand-300/20')
            }
          />
          <div className="relative flex min-w-0 items-center gap-3">
            {exportStage ? (
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white shadow-sm dark:bg-emerald-500">
                <Film size={18} className="animate-pulse" />
                <Sparkles size={10} className="absolute right-1 top-1 animate-ping" />
              </div>
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-end justify-center gap-0.5 rounded-md bg-brand-600 px-2 py-2 text-white shadow-sm dark:bg-brand-500">
                <span className="h-2 w-1 animate-pulse rounded-sm bg-white/80" />
                <span className="h-4 w-1 animate-pulse rounded-sm bg-white" style={{ animationDelay: '120ms' }} />
                <span className="h-3 w-1 animate-pulse rounded-sm bg-white/90" style={{ animationDelay: '240ms' }} />
                <span className="h-5 w-1 animate-pulse rounded-sm bg-white" style={{ animationDelay: '360ms' }} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div
                className={
                  'mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ' +
                  (exportStage ? 'text-emerald-600 dark:text-emerald-200' : 'text-brand-500 dark:text-brand-200')
                }
              >
                <span>{exportStage ? 'Deck' : 'Request'}</span>
                <span className="h-1 w-1 rounded-full bg-current opacity-50" />
                <span>{exportStage ? 'PowerPoint' : 'AI'}</span>
                <span className="h-1 w-1 rounded-full bg-current opacity-50" />
                <span>{exportStage ? 'MP4' : 'HTML'}</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <LoaderCircle size={13} className="shrink-0 animate-spin" />
                <span className="shrink-0 font-medium">Now working:</span>
                <span className="min-w-0 truncate">{activeStepLabel}</span>
              </div>
            </div>
            <div className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden="true">
              {exportStage && <Presentation size={15} className="mr-1 animate-pulse" />}
              <span className={(exportStage ? 'bg-emerald-500' : 'bg-brand-500') + ' h-1.5 w-1.5 animate-pulse rounded-full'} />
              <span className={(exportStage ? 'bg-sky-400' : 'bg-brand-400') + ' h-1.5 w-1.5 animate-pulse rounded-full'} style={{ animationDelay: '160ms' }} />
              <span className={(exportStage ? 'bg-emerald-300' : 'bg-brand-300') + ' h-1.5 w-1.5 animate-pulse rounded-full'} style={{ animationDelay: '320ms' }} />
            </div>
          </div>
        </div>
      )}
      {quiet && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" />
          <div>
            <div className="font-semibold">
              Backend still active for {formatDuration(elapsedSinceUpdate)} without a new update.
            </div>
            <div className="mt-0.5 opacity-90">
              Long AI responses, browser rendering, and PowerPoint export can
              pause between updates. This is normal while the backend is still
              running.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
