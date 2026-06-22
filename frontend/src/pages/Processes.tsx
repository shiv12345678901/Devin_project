import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Film,
  GripVertical,
  ImageIcon,
  ListOrdered,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Search,
  StopCircle,
  Trash2,
  Wand2,
  X,
  XCircle,
} from 'lucide-react'
import { api } from '../api/client'
import type { BackendRunDetail, CacheStats, GenerateSettings, HistoryEntry } from '../api/types'
import { formatRelative, formatRuntime, useRuns } from '../store/runs'
import type { Run, RunStatus, RunTool } from '../store/runs'
import { useToast } from '../store/toast'
import { useConfirm } from '../components/ConfirmDialog'
import AssetPreviewModal from '../components/AssetPreviewModal'
import Banner from '../components/Banner'
import EmptyState from '../components/EmptyState'
import ProgressBar from '../components/ProgressBar'
import RunErrorPanel from '../components/RunErrorPanel'
import { useGenerationQueue } from '../hooks/useTrackedGenerate'
import type { QueueItem } from '../hooks/useTrackedGenerate'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { PROCESS_EDIT_HANDOFF_KEY } from '../lib/processEditHandoff'
import { useSettings } from '../store/settings'
import {
  readSelectedProcessId,
  SELECTED_PROCESS_EVENT,
  writeSelectedProcessId,
} from '../lib/selectedProcess'

type ToolLike = RunTool | 'regenerate' | 'text-to-image' | 'html-to-image' | 'image-to-screenshots' | string | undefined
type EditableProcess = {
  id: string
  title: string
  tool: RunTool
  kind: 'text' | 'html'
  text: string
  settings: GenerateSettings
  mode: 'queue' | 'regenerate'
}
type ContentMatchMetric = {
  coverage_percent?: number
  input_unique_words?: number
  matched_unique_words?: number
  missing_unique_words?: number
  missing_words?: string[]
  missing_sections?: Array<{
    line_number?: number
    text?: string
    missing_words?: string[]
    coverage_percent?: number
  }>
  status?: string
}

function trackedOutputsFromBackendRun(
  run: BackendRunDetail['run'],
  fallbackOperationId: string,
): Partial<Run> {
  const outputs = run.outputs ?? {}
  const rawEta =
    run.settings?.estimated_total_seconds ??
    run.metrics?.estimated_total_seconds ??
    run.metrics?.eta_seconds
  const etaSeconds = typeof rawEta === 'number' ? rawEta : Number(rawEta)
  return {
    htmlFilename: outputs.html_filename ?? outputs.html_file,
    screenshotFiles: outputs.screenshot_files ?? [],
    screenshotFolder: outputs.screenshot_folder,
    presentationFile: outputs.presentation_file ?? outputs.presentation_path,
    videoFile: outputs.video_file ?? outputs.video_path,
    operationId: run.operation_id ?? fallbackOperationId,
    etaSeconds: Number.isFinite(etaSeconds) && etaSeconds > 0 ? etaSeconds : undefined,
    metrics: run.metrics,
  }
}

function contentMatchMetric(run: Run): ContentMatchMetric | null {
  const value = run.metrics?.content_match
  return value && typeof value === 'object' ? value as ContentMatchMetric : null
}

const TOOL_META: Record<string, { label: string; icon: typeof FileText }> = {
  'text-to-video': { label: 'Text → Video', icon: FileText },
  'text-to-image': { label: 'Text → Video', icon: FileText },
  'html-to-video': { label: 'HTML → Video', icon: Code2 },
  'html-to-image': { label: 'HTML → Video', icon: Code2 },
  'image-to-video': { label: 'Image → Screenshots', icon: ImageIcon },
  'image-to-screenshots': { label: 'Image → Screenshots', icon: ImageIcon },
  'screenshots-to-video': { label: 'Screenshots → Video', icon: ImageIcon },
  'youtube-screenshots': { label: 'YouTube → Screenshots', icon: ImageIcon },
  regenerate: { label: 'Regenerate', icon: Wand2 },
}

function toolMeta(tool: ToolLike) {
  return TOOL_META[tool ?? ''] ?? { label: tool ?? 'Run', icon: Activity }
}

const STAGE_STATUS_LABELS: Record<string, string> = {
  queued: 'Waiting in backend queue',
  running: 'Running',
  ai_waiting: 'Waiting for AI slot',
  ai: 'Generating HTML',
  html_saved: 'HTML saved',
  screenshot_waiting: 'Waiting for screenshot slot',
  screenshot: 'Capturing screenshots',
  screenshots_done: 'Screenshots ready',
  export_waiting: 'Waiting for PowerPoint export',
  powerpoint_cleanup: 'Closing PowerPoint',
  powerpoint_resume: 'Exporting from saved PPTX',
  powerpoint: 'Building PowerPoint export',
  pptx_built: 'PowerPoint deck saved',
  video_export: 'Exporting MP4',
  video_export_done: 'MP4 export finished',
  complete: 'Complete',
  cancelling: 'Cancelling',
}

function stageStatusLabel(stage?: string): string {
  if (!stage) return 'Working'
  return STAGE_STATUS_LABELS[stage] ?? stage.replace(/_/g, ' ')
}

function toGenerateSettings(settings: Run['settings'] | GenerateSettings | undefined): GenerateSettings {
  const raw = settings ?? {}
  const { resolution, youtube_quality, ...rest } = raw
  const next: GenerateSettings = { ...rest }
  if (['720p', '1080p', '1440p', '4k'].includes(String(resolution))) {
    next.resolution = resolution as GenerateSettings['resolution']
  }
  if (['720p', '1080p', 'best'].includes(String(youtube_quality))) {
    next.youtube_quality = youtube_quality as GenerateSettings['youtube_quality']
  }
  return next
}

function firstUrl(value: string): string {
  return value.match(/https?:\/\/\S+/)?.[0] ?? ''
}

function formatYoutubeSeconds(value: number): string {
  const total = Math.max(0, Math.round(value))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function youtubeTimestampText(settings: GenerateSettings, fallback: string): string {
  const timestamps = Array.isArray(settings.youtube_timestamps)
    ? settings.youtube_timestamps.filter((value): value is number => Number.isFinite(value))
    : []
  if (timestamps.length > 0) return timestamps.map(formatYoutubeSeconds).join(', ')
  const match = fallback.match(/Timestamps:\s*([\s\S]+)/i)
  return match?.[1]?.trim() ?? ''
}

function editWizardPath(tool: RunTool): string {
  if (tool === 'html-to-video') return '/workspace/html'
  if (tool === 'youtube-to-video') return '/workspace/youtube'
  return '/workspace/text'
}

function processSearchText(run: Run): string {
  return [
    run.id,
    run.operationId,
    run.tool,
    toolMeta(run.tool).label,
    run.status,
    run.stage,
    run.message,
    run.inputPreview,
    run.inputText,
    run.htmlFilename,
    run.presentationFile,
    run.videoFile,
    ...(run.screenshotFiles ?? []),
    run.settings?.class_name,
    run.settings?.subject,
    run.settings?.title,
    run.settings?.model_choice,
    run.settings?.output_format,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function historySearchText(entry: HistoryEntry): string {
  return [
    entry.operation_id,
    entry.input_preview,
    entry.html_file,
    entry.video_file,
    entry.presentation_file,
    entry.tool,
    entry.screenshot_folder,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function StatusBadge({ status }: { status: RunStatus | 'completed' }) {
  if (status === 'running') {
    return (
      <span className="badge-running">
        <Loader2 size={12} className="animate-spin" /> Running
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="badge-error">
        <XCircle size={12} /> Failed
      </span>
    )
  }
  if (status === 'cancelled') {
    return (
      <span className="badge-warning">
        <XCircle size={12} /> Cancelled
      </span>
    )
  }
  return (
    <span className="badge-success">
      <CheckCircle2 size={12} /> Done
    </span>
  )
}

function useNow(enabled: boolean, tickMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [enabled, tickMs])
  return now
}

/**
 * D6: 5-segment stage strip — AI → Render → Screenshot → PPTX → MP4. Each
 * segment lights up as the run reaches that pipeline phase. Compact
 * enough to sit on the row above the progress bar.
 */
type StageSegment = {
  key: 'ai' | 'render' | 'screenshot' | 'pptx' | 'mp4'
  label: string
}
const PIPELINE_SEGMENTS: StageSegment[] = [
  { key: 'ai', label: 'AI' },
  { key: 'render', label: 'Render' },
  { key: 'screenshot', label: 'Screenshot' },
  { key: 'pptx', label: 'PPTX' },
  { key: 'mp4', label: 'MP4' },
]
function stageToSegmentIndex(stage: string | undefined): number {
  if (!stage) return -1
  const s = stage.toLowerCase()
  if (s.startsWith('ai')) return 0
  if (s === 'init' || s === 'queued' || s === 'running') return 0
  if (s === 'html_saved') return 1
  if (s.startsWith('screenshot')) return 2
  if (s.startsWith('powerpoint') || s === 'pptx' || s.startsWith('export')) return 3
  if (s.startsWith('video') || s === 'mp4') return 4
  if (s === 'complete' || s === 'screenshots_done') return 4
  return -1
}
function StageStrip({
  stage,
  status,
  outputFormat,
}: {
  stage: string | undefined
  status: Run['status']
  outputFormat: string | undefined
}) {
  const reached = stageToSegmentIndex(stage)
  // Trim segments that the run won't ever reach so the strip doesn't
  // pretend to have progress past the user's chosen output. ('html' caps
  // at Render; 'images' caps at Screenshot; 'pptx' caps at PPTX.)
  const cap = (() => {
    switch ((outputFormat ?? '').toLowerCase()) {
      case 'html': return 1
      case 'images': return 2
      case 'pptx': return 3
      default: return 4
    }
  })()
  const segments = PIPELINE_SEGMENTS.slice(0, cap + 1)
  return (
    <div className="mt-1.5 flex items-center gap-1" aria-label="Pipeline stages">
      {segments.map((seg, i) => {
        const done =
          status === 'success' || status === 'cancelled'
            ? i <= reached || status === 'success'
            : i < reached
        const active = status === 'running' && i === reached
        const failed = status === 'error' && i === reached
        return (
          <div
            key={seg.key}
            title={seg.label}
            className={
              'flex h-1.5 min-w-0 flex-1 items-center justify-center rounded-full transition-colors ' +
              (failed
                ? 'bg-rose-500/80'
                : active
                ? 'bg-brand-500 animate-pulse'
                : done
                ? 'bg-brand-500/70'
                : 'bg-slate-200 dark:bg-white/[0.08]')
            }
          />
        )
      })}
    </div>
  )
}

type OutputFileKind = 'html' | 'image' | 'pptx' | 'video'

function outputIcon(kind: OutputFileKind) {
  switch (kind) {
    case 'html':
      return FileText
    case 'image':
      return ImageIcon
    case 'pptx':
      return Database
    case 'video':
      return Film
  }
}

function OutputFileActions({
  kind,
  label,
  filename,
  previewLabel = 'Preview',
  onPreview,
  openHref,
  downloadHref,
}: {
  kind: OutputFileKind
  label: string
  filename: string
  previewLabel?: string
  onPreview?: () => void
  openHref?: string
  downloadHref?: string
}) {
  const Icon = outputIcon(kind)
  const toast = useToast()
  const [moreOpen, setMoreOpen] = useState(false)

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(filename)
      toast.push({ variant: 'success', message: 'File path copied.' })
    } catch (e) {
      toast.push({
        variant: 'error',
        title: 'Copy failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <div className="relative rounded-md border border-slate-200 bg-slate-50 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex min-w-0 items-center gap-2">
        <Icon size={15} className="shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </div>
          <div className="truncate text-xs text-slate-700 dark:text-slate-200" title={filename}>
            {filename}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {onPreview ? (
            <button
              type="button"
              className="rounded border border-brand-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100 dark:hover:bg-brand-500/20"
              onClick={onPreview}
            >
              {previewLabel}
            </button>
          ) : openHref ? (
            <a
              href={openHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-brand-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100 dark:hover:bg-brand-500/20"
            >
              <ExternalLink size={11} /> Open
            </a>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
          onClick={() => setMoreOpen((value) => !value)}
          aria-expanded={moreOpen}
        >
          More
        </button>
      </div>
      {moreOpen && (
        <div className="absolute right-2 top-[calc(100%-0.25rem)] z-10 w-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-white/10 dark:bg-slate-900">
          {openHref && onPreview && (
            <a
              href={openHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/10"
              onClick={() => setMoreOpen(false)}
            >
              <ExternalLink size={12} /> Open
            </a>
          )}
          {downloadHref && (
            <a
              href={downloadHref}
              download={filename.split(/[\\/]/).pop() ?? filename}
              className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/10"
              onClick={() => setMoreOpen(false)}
            >
              <Download size={12} /> Download
            </a>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/10"
            onClick={() => {
              setMoreOpen(false)
              void copyPath()
            }}
          >
            <Copy size={12} /> Copy path
          </button>
        </div>
      )}
    </div>
  )
}

function InlineHtmlPreview({
  src,
  title,
  onOpen,
}: {
  src: string
  title: string
  onOpen: () => void
}) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(src, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (!cancelled) setHtml(text)
      })
      .catch((e) => {
        if (cancelled) return
        setHtml('')
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey, src])

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={16} className="shrink-0 text-brand-500" />
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              HTML preview
            </div>
            <div className="truncate text-xs text-slate-600 dark:text-slate-300" title={title}>
              {title}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setReloadKey((value) => value + 1)}>
            <RefreshCw size={12} /> Reload
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={onOpen}>
            Maximize
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="block aspect-video w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left dark:border-white/10 dark:bg-slate-950"
        title="Open HTML preview"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Loading HTML preview...
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-rose-600 dark:text-rose-300">
            Could not load HTML preview: {error}
          </div>
        ) : (
          <iframe
            key={reloadKey}
            srcDoc={html}
            title={title}
            sandbox="allow-same-origin"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </button>
    </div>
  )
}

function RunRow({
  run,
  onRemove,
  onRegenerate,
  onEditRegenerate,
  onSelectRunning,
  onBackendRunUpdated,
  selected = false,
  highlight = false,
}: {
  run: Run
  onRemove?: (id: string) => void
  onRegenerate?: (run: Run) => void
  onEditRegenerate?: (run: Run) => void
  onSelectRunning?: (run: Run) => void
  onBackendRunUpdated?: (localRun: Run, backendRun: BackendRunDetail['run']) => void
  selected?: boolean
  highlight?: boolean
}) {
  const meta = toolMeta(run.tool)
  const Icon = meta.icon
  const now = useNow(!run.endedAt)
  const runtime = (run.endedAt ?? now) - run.startedAt
  const etaRemainingMs =
    run.status === 'running' && typeof run.etaSeconds === 'number' && run.etaSeconds > 0
      ? Math.max(0, (run.etaSeconds * 1000) - runtime)
      : null
  const [userOpen, setUserOpen] = useState(false)
  // Derive `open` from (user click || highlight prop) so we don't need to
  // setState from an effect just because the prop flipped.
  const open = userOpen || highlight
  const progress = Math.max(0, Math.min(100, run.progress ?? 0))
  const [preview, setPreview] = useState<string | null>(null)
  const [videoPreview, setVideoPreview] = useState(false)
  const [htmlPreview, setHtmlPreview] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [contentMatchOpen, setContentMatchOpen] = useState(false)
  const [pptxPreviewOpen, setPptxPreviewOpen] = useState(false)
  const [pptxPreviewLoading, setPptxPreviewLoading] = useState(false)
  const [pptxPreviewError, setPptxPreviewError] = useState('')
  const [pptxPreviewSlides, setPptxPreviewSlides] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [copiedInput, setCopiedInput] = useState(false)
  const [inputExpanded, setInputExpanded] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchError, setMatchError] = useState('')
  const toast = useToast()
  const scrolled = useRef(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (highlight && rowRef.current && !scrolled.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      scrolled.current = true
    }
  }, [highlight])
  const hasOutputs =
    (run.screenshotFiles?.length ?? 0) > 0 ||
    !!run.htmlFilename ||
    !!run.presentationFile ||
    !!run.videoFile
  const inputText = run.inputText || run.inputPreview || ''
  const canRegenerate =
    run.status !== 'running' &&
    run.tool !== 'image-to-video' &&
    run.tool !== 'screenshots-to-video' &&
    inputText.trim().length > 0
  const screenshots = run.screenshotFiles ?? []
  const selectedScreenshot = screenshots[previewIndex]
  const selectedScreenshotUrl = selectedScreenshot ? api.screenshotUrl(selectedScreenshot) : null
  const canLoadLogs = Boolean(run.operationId)
  const match = contentMatchMetric(run)
  const outputBadges = [
    run.htmlFilename ? 'HTML' : null,
    screenshots.length > 0 ? `${screenshots.length} shots` : null,
    run.presentationFile ? 'PPTX' : null,
    run.videoFile ? 'MP4' : null,
  ].filter((value): value is string => Boolean(value))

  const copyInput = async (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!inputText) return
    try {
      await navigator.clipboard.writeText(inputText)
      setCopiedInput(true)
      toast.push({ variant: 'success', message: 'Input copied to clipboard.' })
      window.setTimeout(() => setCopiedInput(false), 1500)
    } catch (e) {
      toast.push({
        variant: 'error',
        title: 'Copy failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const openScreenshot = (index: number) => {
    setPreviewIndex(index)
    setPreview(api.screenshotUrl(screenshots[index]))
  }

  const movePreview = (direction: -1 | 1) => {
    if (screenshots.length === 0) return
    const next = (previewIndex + direction + screenshots.length) % screenshots.length
    setPreviewIndex(next)
    setPreview(api.screenshotUrl(screenshots[next]))
  }

  const loadLogs = useCallback(async (silent = false) => {
    if (!run.operationId) return
    setLogsOpen(true)
    if (!silent) setLogsLoading(true)
    setLogsError('')
    try {
      const response = await api.logTail(run.operationId, 200)
      setLogLines(response.lines ?? [])
    } catch (e) {
      setLogLines([])
      setLogsError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!silent) setLogsLoading(false)
    }
  }, [run.operationId])

  const runMatcherForOldProcess = async () => {
    const runId = run.operationId || run.id
    setMatchLoading(true)
    setMatchError('')
    try {
      const response = await api.runContentMatch(runId)
      if (response.run) onBackendRunUpdated?.(run, response.run)
      toast.push({ variant: 'success', message: 'Content matcher completed.' })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const message = raw === 'Failed to fetch'
        ? 'Could not reach the backend. Check Settings > Backend URL, or restart the app so the frontend points to http://127.0.0.1:5055.'
        : raw
      setMatchError(message)
      toast.push({ variant: 'error', title: 'Content matcher failed', message })
    } finally {
      setMatchLoading(false)
    }
  }

  const openPptxPreview = async () => {
    if (!run.presentationFile) return
    setPptxPreviewOpen(true)
    setPptxPreviewLoading(true)
    setPptxPreviewError('')
    try {
      const response = await api.pptxPreview(run.presentationFile)
      if (response.error) throw new Error(response.error)
      setPptxPreviewSlides(response.slides ?? [])
    } catch (e) {
      setPptxPreviewSlides([])
      setPptxPreviewError(e instanceof Error ? e.message : String(e))
    } finally {
      setPptxPreviewLoading(false)
    }
  }

  return (
    <div
      ref={rowRef}
      className={
        selected
          ? 'glass overflow-hidden !p-0 ring-2 ring-brand-400 dark:ring-brand-500/60'
          : highlight
          ? 'glass overflow-hidden !p-0 ring-2 ring-brand-400 dark:ring-brand-500/60'
          : 'glass overflow-hidden !p-0'
      }
    >
      <button
        type="button"
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
        onClick={() => {
          if (run.status === 'running') onSelectRunning?.(run)
          setUserOpen((o) => !o)
        }}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          <Icon size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
              {meta.label}
            </span>
            <StatusBadge status={run.status} />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatRelative(run.startedAt, now)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
            {run.inputPreview || '(no input)'}
          </p>
          {outputBadges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {outputBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
          {run.status === 'running' && (
            <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span className="min-w-0 flex-1 truncate">
                {stageStatusLabel(run.stage)}
                {run.message ? ` - ${run.message}` : ''}
              </span>
              <span className="shrink-0 tabular-nums">
                {Math.round(progress)}%
              </span>
            </div>
          )}
          <StageStrip
            stage={run.stage}
            status={run.status}
            outputFormat={run.settings?.output_format}
          />
        </div>

        <div className="hidden w-40 shrink-0 text-right sm:block">
          <div className="flex items-center justify-end gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Clock size={14} /> {formatRuntime(runtime)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {etaRemainingMs != null
              ? `~${formatRuntime(etaRemainingMs)} remaining`
              : `${run.screenshotFiles?.length ?? 0} screenshot${run.screenshotFiles?.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-200 px-5 py-4 dark:border-white/10">
          <div className="grid gap-4 md:grid-cols-3">
            <Section title="Input">
              <div className="rounded-md border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                    {inputText.length.toLocaleString()} characters
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setInputExpanded((value) => !value)}
                      disabled={!inputText}
                    >
                      {inputExpanded ? 'Collapse' : 'Expand'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={copyInput}
                      disabled={!inputText}
                    >
                      {copiedInput ? <Check size={12} /> : <Copy size={12} />}
                      {copiedInput ? 'Copied' : 'Copy all'}
                    </button>
                  </div>
                </div>
                <pre
                  className={
                    'overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-200 ' +
                    (inputExpanded ? 'max-h-80' : 'max-h-28')
                  }
                >
                  {inputText || '(empty)'}
                </pre>
              </div>
              {run.inputFiles && run.inputFiles.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {run.inputFiles.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Runtime">
              <KV label="Started" value={new Date(run.startedAt).toLocaleString()} />
              <KV
                label="Ended"
                value={run.endedAt ? new Date(run.endedAt).toLocaleString() : '—'}
              />
              {run.status === 'running' && run.message && (
                <KV label="Current" value={run.message} />
              )}
              {run.status === 'running' && (
                <KV label="Stage" value={stageStatusLabel(run.stage)} />
              )}
              {run.status === 'running' && run.progress != null && (
                <KV label="Progress" value={`${Math.round(run.progress)}%`} />
              )}
              {etaRemainingMs != null && (
                <KV label="Estimated left" value={`~${formatRuntime(etaRemainingMs)}`} />
              )}
              <KV label="Duration" value={formatRuntime(runtime)} />
              {run.settings?.model_choice && (
                <KV label="Model" value={run.settings.model_choice} />
              )}
              {run.settings?.output_format && (
                <KV label="Output format" value={String(run.settings.output_format)} />
              )}
              {(run.settings?.class_name || run.settings?.subject || run.settings?.title) && (
                <KV
                  label="Project"
                  value={[run.settings?.class_name, run.settings?.subject, run.settings?.title]
                    .filter(Boolean)
                    .join(' · ')}
                />
              )}
              {run.settings && (
                <KV
                  label="Viewport"
                  value={`${run.settings.viewport_width ?? '—'}×${run.settings.viewport_height ?? '—'}`}
                />
              )}
              {run.settings?.zoom != null && <KV label="Zoom" value={`${run.settings.zoom}×`} />}
            </Section>

            <Section title="Output">
              {match && (
                <ContentMatchPanel match={match} onDetails={() => setContentMatchOpen(true)} />
              )}
              {!match && run.status === 'success' && run.htmlFilename && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                  <div className="min-w-0 truncate">Content match not checked yet.</div>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
                    onClick={() => void runMatcherForOldProcess()}
                    disabled={matchLoading}
                  >
                    {matchLoading ? 'Checking...' : 'Check'}
                  </button>
                  {matchError && <div className="basis-full text-rose-600 dark:text-rose-300">{matchError}</div>}
                </div>
              )}
              {run.status === 'error' && run.error && (
                <RunErrorPanel
                  message={run.error}
                  onRetry={canRegenerate ? () => onRegenerate?.(run) : undefined}
                  onOpenLogs={canLoadLogs ? () => void loadLogs() : undefined}
                />
              )}
              {run.videoFile && (
                <OutputFileActions
                  kind="video"
                  label="MP4 video"
                  filename={run.videoFile}
                  onPreview={() => setVideoPreview(true)}
                  openHref={api.downloadUrl(run.videoFile)}
                  downloadHref={api.downloadUrl(run.videoFile)}
                />
              )}
              {run.presentationFile && (
                <OutputFileActions
                  kind="pptx"
                  label="PowerPoint"
                  filename={run.presentationFile}
                  onPreview={() => void openPptxPreview()}
                  openHref={api.downloadUrl(run.presentationFile)}
                  downloadHref={api.downloadUrl(run.presentationFile)}
                />
              )}
              {run.operationId && (
                <KV label="Op ID" value={<code className="text-[10px]">{run.operationId}</code>} />
              )}
            </Section>
          </div>

          {(run.htmlFilename || screenshots.length > 0) && (
            <div className="grid gap-3 lg:grid-cols-2">
              {run.htmlFilename && (
                <InlineHtmlPreview
                  src={api.htmlUrl(run.htmlFilename)}
                  title={run.htmlFilename}
                  onOpen={() => setHtmlPreview(true)}
                />
              )}

              {screenshots.length > 0 && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ImageIcon size={16} className="shrink-0 text-brand-500" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Screenshots
                        </div>
                        <div className="truncate text-xs text-slate-600 dark:text-slate-300">
                          {screenshots.length} captured
                        </div>
                      </div>
                    </div>
                    {selectedScreenshotUrl && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setPreview(selectedScreenshotUrl)}
                      >
                        Preview
                      </button>
                    )}
                  </div>
                  {selectedScreenshotUrl && (
                    <button
                      type="button"
                      onClick={() => setPreview(selectedScreenshotUrl)}
                      className="mb-3 block aspect-video w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left dark:border-white/10 dark:bg-slate-950"
                      title="Open screenshot preview"
                    >
                      <img
                        src={selectedScreenshotUrl}
                        alt={selectedScreenshot ?? 'Screenshot'}
                        className="h-full w-full object-contain"
                      />
                    </button>
                  )}
                  <div className="grid grid-cols-6 gap-1">
                    {screenshots.slice(0, 12).map((f, index) => {
                      const url = api.screenshotUrl(f)
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => openScreenshot(index)}
                          className={
                            index === previewIndex
                              ? 'block aspect-video overflow-hidden rounded border border-brand-400 bg-brand-50 text-left ring-1 ring-brand-400 dark:border-brand-400 dark:bg-brand-500/10'
                              : 'block aspect-video overflow-hidden rounded border border-slate-200 bg-slate-50 text-left dark:border-white/10 dark:bg-white/[0.03]'
                          }
                          title={`Preview ${f.split('/').pop() ?? f}`}
                        >
                          <img src={url} alt={f} loading="lazy" className="h-full w-full object-cover" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {false && screenshots.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">

          {hasOutputs && screenshots.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Screenshots
                </div>
                {selectedScreenshotUrl && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPreview(selectedScreenshotUrl)}
                  >
                    Preview
                  </button>
                )}
              </div>
              {selectedScreenshotUrl && (
                <button
                  type="button"
                  onClick={() => setPreview(selectedScreenshotUrl)}
                  className="mb-3 block aspect-video w-full overflow-hidden rounded-md border border-slate-200 bg-white text-left dark:border-white/10 dark:bg-slate-950"
                  title="Open screenshot preview"
                >
                  <img
                    src={selectedScreenshotUrl!}
                    alt={selectedScreenshot ?? 'Screenshot'}
                    className="h-full w-full object-contain"
                  />
                </button>
              )}
              <div className="grid grid-cols-6 gap-1">
                {screenshots.slice(0, 12).map((f, index) => {
                  // `f` is already a path relative to OUTPUT_FOLDER
                  // (e.g. "5(1).png" or "batch 3/5(1).png"). Do NOT prepend
                  // screenshotFolder — that double-prefixed the path and
                  // silently fell back to a basename walk that could pick
                  // the wrong batch.
                  const url = api.screenshotUrl(f)
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => openScreenshot(index)}
                      className={
                        index === previewIndex
                          ? 'block aspect-video overflow-hidden rounded border border-brand-400 bg-brand-50 text-left ring-1 ring-brand-400 dark:border-brand-400 dark:bg-brand-500/10'
                          : 'block aspect-video overflow-hidden rounded border border-slate-200 bg-slate-50 text-left dark:border-white/10 dark:bg-white/[0.03]'
                      }
                      title={`Preview ${f.split('/').pop() ?? f}`}
                    >
                      <img src={url} alt={f} loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  )
                })}
              </div>
            </div>
          )}
            </div>
          )}

          {preview && selectedScreenshotUrl && (
            <AssetPreviewModal
              kind="image"
              src={preview}
              title={selectedScreenshot?.split('/').pop() ?? 'Screenshot'}
              subtitle={`${previewIndex + 1} of ${screenshots.length}`}
              onClose={() => setPreview(null)}
              onPrevious={screenshots.length > 1 ? () => movePreview(-1) : undefined}
              onNext={screenshots.length > 1 ? () => movePreview(1) : undefined}
            />
          )}

          {htmlPreview && run.htmlFilename && (
            <AssetPreviewModal
              kind="html"
              src={api.htmlUrl(run.htmlFilename)}
              title={run.htmlFilename.split('/').pop() ?? run.htmlFilename}
              subtitle="HTML file"
              onClose={() => setHtmlPreview(false)}
            />
          )}

          {contentMatchOpen && match && (
            <ContentMatchModal
              match={match}
              inputText={inputText}
              htmlFilename={run.htmlFilename}
              onClose={() => setContentMatchOpen(false)}
            />
          )}

          {pptxPreviewOpen && run.presentationFile && (
            <PptxPreviewModal
              title={run.presentationFile.split(/[\\/]/).pop() ?? 'PowerPoint preview'}
              slides={pptxPreviewSlides}
              loading={pptxPreviewLoading}
              error={pptxPreviewError}
              onClose={() => setPptxPreviewOpen(false)}
            />
          )}

          {videoPreview && run.videoFile && (
            <AssetPreviewModal
              kind="video"
              src={api.downloadUrl(run.videoFile)}
              title={run.videoFile.split('/').pop() ?? 'Video'}
              onClose={() => setVideoPreview(false)}
            />
          )}

          {onRemove && (
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setDetailsOpen(true)}>
                <ExternalLink size={12} /> Details
              </button>
              {canLoadLogs && (
                <button className="btn-secondary btn-sm" onClick={() => void loadLogs()}>
                  <ListOrdered size={12} /> {logsOpen ? 'Refresh logs' : 'Backend logs'}
                </button>
              )}
              {canRegenerate && (
                <>
                  <button className="btn-secondary btn-sm" onClick={() => onEditRegenerate?.(run)}>
                    <Pencil size={12} /> Edit
                  </button>
                  <button className="btn-primary btn-sm" onClick={() => onRegenerate?.(run)}>
                    <RefreshCw size={12} /> Regenerate
                  </button>
                </>
              )}
              <button className="btn-ghost text-xs" onClick={() => onRemove(run.id)}>
                <Trash2 size={12} /> Remove from log
              </button>
            </div>
          )}

          {logsOpen && (
            <LiveLogModal
              title={run.inputPreview || meta.label}
              operationId={run.operationId ?? run.id}
              running={run.status === 'running'}
              loading={logsLoading}
              error={logsError}
              lines={logLines}
              onRefresh={loadLogs}
              onClose={() => setLogsOpen(false)}
            />
          )}

          {detailsOpen && (
            <RunDetailDrawer
              run={run}
              runtime={runtime}
              canRegenerate={canRegenerate}
              onClose={() => setDetailsOpen(false)}
              onPreviewHtml={run.htmlFilename ? () => setHtmlPreview(true) : undefined}
              onPreviewVideo={run.videoFile ? () => setVideoPreview(true) : undefined}
              onPreviewPptx={run.presentationFile ? () => void openPptxPreview() : undefined}
              onPreviewScreenshot={screenshots[0] ? () => openScreenshot(0) : undefined}
              onOpenLogs={canLoadLogs ? () => void loadLogs() : undefined}
              onEdit={canRegenerate ? () => onEditRegenerate?.(run) : undefined}
              onRegenerate={canRegenerate ? () => onRegenerate?.(run) : undefined}
            />
          )}
        </div>
      )}
    </div>
  )
}

function LiveLogModal({
  title,
  operationId,
  running,
  loading,
  error,
  lines,
  onRefresh,
  onClose,
}: {
  title: string
  operationId: string
  running: boolean
  loading: boolean
  error: string
  lines: string[]
  onRefresh: (silent?: boolean) => void
  onClose: () => void
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  useEffect(() => {
    if (!running) return undefined
    const id = window.setInterval(() => onRefresh(true), 2500)
    return () => window.clearInterval(id)
  }, [onRefresh, running])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Backend logs"
        tabIndex={-1}
        className="flex h-full max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-slate-900 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              <span>Live backend logs</span>
              {running && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-200">Auto-refreshing</span>}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-white">{title}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{operationId}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => onRefresh(false)}>
              <RefreshCw size={12} /> Refresh
            </button>
            <button type="button" className="btn-ghost btn-sm text-slate-200" onClick={onClose}>
              <X size={14} /> Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-950">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-300">
              <Loader2 size={16} className="animate-spin" /> Loading logs...
            </div>
          ) : error ? (
            <div className="m-4 rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
              {error}
            </div>
          ) : lines.length === 0 ? (
            <div className="px-4 py-5 text-sm text-slate-400">No log lines found for this run.</div>
          ) : (
            <pre className="min-h-full whitespace-pre-wrap break-words px-4 py-4 font-mono text-[11px] leading-relaxed text-slate-200">
              {lines.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function RunDetailDrawer({
  run,
  runtime,
  canRegenerate,
  onClose,
  onPreviewHtml,
  onPreviewVideo,
  onPreviewPptx,
  onPreviewScreenshot,
  onOpenLogs,
  onEdit,
  onRegenerate,
}: {
  run: Run
  runtime: number
  canRegenerate: boolean
  onClose: () => void
  onPreviewHtml?: () => void
  onPreviewVideo?: () => void
  onPreviewPptx?: () => void
  onPreviewScreenshot?: () => void
  onOpenLogs?: () => void
  onEdit?: () => void
  onRegenerate?: () => void
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  const firstScreenshot = run.screenshotFiles?.[0]
  const firstScreenshotUrl = firstScreenshot ? api.screenshotUrl(firstScreenshot) : undefined

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close details" onClick={onClose} />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Run details"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Process details
            </div>
            <h2 className="mt-1 truncate font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
              {toolMeta(run.tool).label}
            </h2>
            <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
              {run.inputPreview || '(no input)'}
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            <X size={14} /> Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
          <Section title="Status">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={run.status} />
              <span className="text-sm text-slate-600 dark:text-slate-300">{stageStatusLabel(run.stage)}</span>
            </div>
            <div className="mt-3 space-y-1">
              <KV label="Started" value={new Date(run.startedAt).toLocaleString()} />
              <KV label="Ended" value={run.endedAt ? new Date(run.endedAt).toLocaleString() : 'Still running'} />
              <KV label="Duration" value={formatRuntime(runtime)} />
              {run.progress != null && <KV label="Progress" value={`${Math.round(run.progress)}%`} />}
              {run.operationId && <KV label="Operation ID" value={<code className="text-[10px]">{run.operationId}</code>} />}
            </div>
          </Section>

          <Section title="Outputs">
            {run.htmlFilename && (
              <OutputFileActions
                kind="html"
                label="HTML"
                filename={run.htmlFilename}
                onPreview={onPreviewHtml}
                openHref={api.htmlUrl(run.htmlFilename)}
                downloadHref={api.htmlUrl(run.htmlFilename)}
              />
            )}
            {firstScreenshot && firstScreenshotUrl && (
              <OutputFileActions
                kind="image"
                label={`Screenshots (${run.screenshotFiles?.length ?? 0})`}
                filename={firstScreenshot}
                previewLabel="Preview first"
                onPreview={onPreviewScreenshot}
                openHref={firstScreenshotUrl}
                downloadHref={firstScreenshotUrl}
              />
            )}
            {run.presentationFile && (
              <OutputFileActions
                kind="pptx"
                label="PowerPoint"
                filename={run.presentationFile}
                onPreview={onPreviewPptx}
                openHref={api.downloadUrl(run.presentationFile)}
                downloadHref={api.downloadUrl(run.presentationFile)}
              />
            )}
            {run.videoFile && (
              <OutputFileActions
                kind="video"
                label="MP4 video"
                filename={run.videoFile}
                onPreview={onPreviewVideo}
                openHref={api.downloadUrl(run.videoFile)}
                downloadHref={api.downloadUrl(run.videoFile)}
              />
            )}
            {!run.htmlFilename && !firstScreenshot && !run.presentationFile && !run.videoFile && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                No output files recorded yet.
              </div>
            )}
          </Section>

          <Section title="Input">
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
              {run.inputText || run.inputPreview || '(empty)'}
            </pre>
          </Section>

          {run.settings && (
            <Section title="Settings">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                {JSON.stringify(run.settings, null, 2)}
              </pre>
            </Section>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-white/10">
          {onOpenLogs && (
            <button type="button" className="btn-secondary btn-sm" onClick={onOpenLogs}>
              <ListOrdered size={12} /> Live logs
            </button>
          )}
          {canRegenerate && onEdit && (
            <button type="button" className="btn-secondary btn-sm" onClick={onEdit}>
              <Pencil size={12} /> Edit
            </button>
          )}
          {canRegenerate && onRegenerate && (
            <button type="button" className="btn-primary btn-sm" onClick={onRegenerate}>
              <RefreshCw size={12} /> Regenerate
            </button>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function formatHistoryTimestamp(ts: number | string | undefined): string {
  if (ts == null) return ''
  const num = typeof ts === 'number' ? ts : Number(ts)
  if (Number.isFinite(num)) {
    return new Date(num * 1000).toLocaleString()
  }
  return String(ts)
}

export function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const meta = toolMeta(entry.tool)
  const Icon = meta.icon
  return (
    <div className="glass flex items-center gap-4 !py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-white/[0.05] dark:text-slate-300">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
            {meta.label}
          </span>
          <StatusBadge status="completed" />
          {(entry.datetime || entry.timestamp) && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {entry.datetime ?? formatHistoryTimestamp(entry.timestamp)}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
          {entry.input_preview || '(no input recorded)'}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {entry.screenshot_count ?? 0} screenshots · {entry.html_file ?? '—'}
        </p>
      </div>
      {entry.html_file && (
        <a
          href={api.htmlUrl(entry.html_file)}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary hidden shrink-0 sm:inline-flex"
        >
          <Code2 size={14} /> HTML
        </a>
      )}
      {entry.video_file && (
        <a
          href={api.downloadUrl(entry.video_file)}
          className="btn-secondary hidden shrink-0 sm:inline-flex"
        >
          MP4
        </a>
      )}
      {entry.presentation_file && (
        <a
          href={api.downloadUrl(entry.presentation_file)}
          className="btn-secondary hidden shrink-0 sm:inline-flex"
        >
          PPTX
        </a>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  )
}

function ContentMatchPanel({
  match,
  onDetails,
}: {
  match: ContentMatchMetric
  onDetails: () => void
}) {
  const coverage = typeof match.coverage_percent === 'number' ? match.coverage_percent : null
  const review = coverage != null && coverage < 95
  const missingCount = Array.isArray(match.missing_words) ? match.missing_words.length : 0
  const missingSections = Array.isArray(match.missing_sections) ? match.missing_sections.length : 0
  return (
    <div
      className={
        'flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-xs ' +
        (review
          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100')
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">Content match</span>
          <span className="rounded-full bg-current/10 px-1.5 py-0.5 text-[11px] tabular-nums">
            {coverage == null ? '-' : `${coverage.toFixed(1)}%`}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] opacity-85">
          {match.matched_unique_words ?? 0}/{match.input_unique_words ?? 0} words found
          {missingCount > 0 ? ` - ${missingCount} missing` : ''}
          {missingSections > 0 ? ` - ${missingSections} lines need review` : ''}
        </div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded border border-current/20 px-2 py-1 text-[11px] font-medium hover:bg-white/40 dark:hover:bg-white/10"
        onClick={onDetails}
      >
        Details
      </button>
    </div>
  )
}

function stripHtmlForCompare(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function ContentMatchModal({
  match,
  inputText,
  htmlFilename,
  onClose,
}: {
  match: ContentMatchMetric
  inputText: string
  htmlFilename?: string
  onClose: () => void
}) {
  const [htmlText, setHtmlText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const coverage = typeof match.coverage_percent === 'number' ? match.coverage_percent : null
  const sections = Array.isArray(match.missing_sections) ? match.missing_sections : []
  const missing = Array.isArray(match.missing_words) ? match.missing_words : []

  useEffect(() => {
    let cancelled = false
    if (!htmlFilename) return
    setLoading(true)
    setError('')
    fetch(api.htmlUrl(htmlFilename))
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.text()
      })
      .then((text) => {
        if (!cancelled) setHtmlText(stripHtmlForCompare(text))
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [htmlFilename])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Content Matcher
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
              Input vs Generated HTML
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Only user input words are compared. HTML tags, CSS, comments, and generated markup are ignored.
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            <X size={14} /> Close
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-200 px-5 py-3 text-sm dark:border-white/10 md:grid-cols-4">
          <KV label="Coverage" value={coverage == null ? '-' : `${coverage.toFixed(1)}%`} />
          <KV label="Matched words" value={`${match.matched_unique_words ?? 0}/${match.input_unique_words ?? 0}`} />
          <KV label="Missing words" value={`${match.missing_unique_words ?? 0}`} />
          <KV label="Status" value={match.status ?? 'review'} />
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-[1fr_1fr]">
          <div className="min-h-0">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              User Input
            </div>
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100">
              {inputText || '(no input text saved)'}
            </pre>
          </div>
          <div className="min-h-0">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Generated HTML Text
            </div>
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100">
              {loading ? 'Loading HTML...' : error ? `Could not load HTML: ${error}` : htmlText || '(HTML text unavailable)'}
            </pre>
          </div>
        </div>

        <div className="max-h-64 overflow-auto border-t border-slate-200 px-5 py-4 dark:border-white/10">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Missing Lines / Sections
          </div>
          {sections.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
              No missing input lines were detected.
            </div>
          ) : (
            <div className="space-y-2">
              {sections.map((section, index) => (
                <div key={`${section.line_number ?? index}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  <div className="font-medium">
                    Line {section.line_number ?? '-'} - {typeof section.coverage_percent === 'number' ? `${section.coverage_percent.toFixed(1)}% matched` : 'review'}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-xs">{section.text}</div>
                  {Array.isArray(section.missing_words) && section.missing_words.length > 0 && (
                    <div className="mt-1 text-xs opacity-85">Missing words: {section.missing_words.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {missing.length > 0 && (
            <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
              Missing word sample: {missing.join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PptxPreviewModal({
  title,
  slides,
  loading,
  error,
  onClose,
}: {
  title: string
  slides: string[]
  loading: boolean
  error: string
  onClose: () => void
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex h-dvh items-center justify-center overflow-hidden bg-slate-950/90 p-3 backdrop-blur-md sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="PowerPoint preview"
        className="flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950 shadow-2xl sm:max-h-[94dvh]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-slate-900 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              <span>PowerPoint Preview</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-200">
                {loading ? 'Loading' : `${slides.length} slides`}
              </span>
            </div>
            <h2 className="mt-1 truncate font-display text-lg font-semibold text-white">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Converted to slide images and cached for fast re-open.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
            onClick={onClose}
          >
            <X size={14} /> Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-950">
          {loading ? (
            <div className="m-4 flex min-h-96 items-center justify-center rounded-lg border border-white/10 bg-slate-900 text-sm text-slate-300">
              <Loader2 size={16} className="mr-2 animate-spin" />
              Converting PPTX to slide images...
            </div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-5 text-sm text-rose-100">
              <div className="font-medium">Could not preview this PowerPoint file.</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : slides.length === 0 ? (
            <div className="m-4 rounded-lg border border-white/10 bg-slate-900 p-5 text-sm text-slate-300">
              No preview slides were generated.
            </div>
          ) : (
            <div className="grid h-full min-h-0 lg:grid-cols-[136px_1fr]">
              <aside className="hidden min-h-0 overflow-auto border-r border-white/10 bg-slate-900/90 p-3 lg:block">
                <div className="space-y-2">
                  {slides.map((slide, index) => (
                    <a
                      key={slide}
                      href={`#pptx-slide-${index + 1}`}
                      className="block overflow-hidden rounded-md border border-white/10 bg-white/5 p-1 transition hover:border-brand-300/60 hover:bg-white/10"
                    >
                      <img
                        src={api.pptxPreviewUrl(slide)}
                        alt={`Slide ${index + 1} thumbnail`}
                        loading="lazy"
                        className="aspect-video w-full rounded-sm bg-white object-contain"
                      />
                      <div className="px-1 pt-1 text-center text-[11px] font-medium text-slate-300">
                        {index + 1}
                      </div>
                    </a>
                  ))}
                </div>
              </aside>
              <div className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_34%),linear-gradient(180deg,_#111827_0%,_#020617_100%)] p-4 sm:p-6">
                <div className="mx-auto max-w-6xl space-y-6">
                  {slides.map((slide, index) => (
                    <figure
                      key={slide}
                      id={`pptx-slide-${index + 1}`}
                      className="scroll-mt-6 overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl shadow-slate-950/60"
                    >
                      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
                        <span>Slide {index + 1}</span>
                        <span>{index + 1} of {slides.length}</span>
                      </div>
                      <img
                        src={api.pptxPreviewUrl(slide)}
                        alt={`Slide ${index + 1}`}
                        loading="lazy"
                        className="w-full bg-white object-contain"
                      />
                    </figure>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="truncate text-right text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  )
}

function LiveRunCard({
  liveState,
  trackedRun,
  onCancel,
}: {
  liveState: ReturnType<typeof useGenerationQueue>['state']
  trackedRun?: Run
  onCancel: () => void
}) {
  const hasLiveState = liveState.status === 'running'
  const source = trackedRun ?? (hasLiveState ? liveState : undefined)
  const now = useNow(Boolean(source))
  if (!source) return null
  // The cancel button used to be gated on the SSE `liveState` matching the
  // tracked run's operationId. That hid the button whenever the user opened
  // the page after a run had already started (because liveState only fires
  // when the SSE channel attaches). The cancel handler itself already falls
  // back to the REST `cancelRun` endpoint when liveState doesn't match, so
  // we can show the button whenever there is an active run to cancel.
  const isRunning = (trackedRun?.status ?? liveState.status) === 'running'
  const operationId = trackedRun?.operationId ?? liveState.operationId
  const progress = trackedRun?.progress ?? liveState.progress ?? 0
  const stage = trackedRun?.stage ?? liveState.stage
  const message = trackedRun?.message ?? liveState.message
  const trackedRemainingSeconds =
    trackedRun && typeof trackedRun.etaSeconds === 'number' && trackedRun.etaSeconds > 0
      ? Math.max(0, trackedRun.etaSeconds - ((trackedRun.endedAt ?? now) - trackedRun.startedAt) / 1000)
      : undefined
  // Only use the SSE `liveState.etaSeconds` if it actually corresponds to
  // the run we're displaying. Otherwise its ETA is for a different run.
  const liveMatchesTracked =
    hasLiveState && (!trackedRun || trackedRun.operationId === liveState.operationId)
  const etaSeconds = trackedRemainingSeconds ?? (liveMatchesTracked ? liveState.etaSeconds : undefined)

  return (
    <div className="card ring-2 ring-brand-400/40 dark:ring-brand-500/40">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500"></span>
          </span>
          <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
            Running
          </div>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">
            {stageStatusLabel(stage)}
          </span>
          {operationId && (
            <code className="text-[10px] text-slate-500 dark:text-slate-400">
              {operationId}
            </code>
          )}
        </div>
        {isRunning && (
          <button type="button" className="btn-danger" onClick={onCancel}>
            <StopCircle size={14} /> Cancel run
          </button>
        )}
      </div>
      <ProgressBar
        progress={progress ?? 0}
        stage={stage}
        message={message}
        etaSeconds={etaSeconds}
        active
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>Current step: {stageStatusLabel(stage)}</span>
        <span>You can leave this page; the run stays visible here.</span>
      </div>
    </div>
  )
}

type SoftCancelMode = 'after_html' | 'after_screenshots' | 'after_pptx' | 'after_video'

function softCancelOption(stage?: string): { mode: SoftCancelMode; label: string; detail: string } {
  const s = String(stage || '').toLowerCase()
  if (s.includes('video_export') || s === 'powerpoint_resume') {
    return {
      mode: 'after_video',
      label: 'Cancel after MP4 export finishes',
      detail: 'The current PowerPoint video export will be allowed to finish.',
    }
  }
  if (s.includes('screenshot') || s === 'html_saved') {
    return {
      mode: 'after_screenshots',
      label: 'Cancel after screenshots finish',
      detail: 'The HTML and captured screenshot files will be kept.',
    }
  }
  if (s.includes('powerpoint') || s.includes('export_waiting')) {
    return {
      mode: 'after_pptx',
      label: 'Cancel after PPTX is made',
      detail: 'The PowerPoint file will be kept and MP4 export will not start.',
    }
  }
  return {
    mode: 'after_html',
    label: 'Cancel after HTML finishes',
    detail: 'The generated HTML file will be kept.',
  }
}

function CancelRunDialog({
  run,
  onClose,
  onCancelNow,
  onCancelAfterStep,
}: {
  run: Run
  onClose: () => void
  onCancelNow: (deleteOutputs: boolean) => void
  onCancelAfterStep: (mode: SoftCancelMode) => void
}) {
  const [deleteOutputs, setDeleteOutputs] = useState(false)
  const soft = softCancelOption(run.stage)
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Cancel process?</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Choose whether to stop immediately or let the current step finish first.
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
          <div className="font-medium text-slate-800 dark:text-slate-100">{run.inputPreview || run.id}</div>
          <div className="mt-1">{stageStatusLabel(run.stage)}{run.message ? ` - ${run.message}` : ''}</div>
        </div>
        <div className="mt-4 space-y-3">
          <button
            type="button"
            className="btn-secondary w-full justify-start"
            onClick={() => onCancelAfterStep(soft.mode)}
          >
            <FileText size={14} /> {soft.label}
          </button>
          <p className="-mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">{soft.detail}</p>
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
            <button
              type="button"
              className="btn-danger w-full justify-start"
              onClick={() => onCancelNow(deleteOutputs)}
            >
              <StopCircle size={14} /> Cancel now
            </button>
            <button
              type="button"
              className="mt-2 flex items-center gap-2 text-left text-xs font-medium text-rose-800 dark:text-rose-100"
              onClick={() => setDeleteOutputs((v) => !v)}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${deleteOutputs ? 'border-rose-600 bg-rose-600 text-white' : 'border-rose-300 bg-white dark:bg-slate-950'}`}>
                {deleteOutputs && <Check size={12} />}
              </span>
              Delete all generated data for this process
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function QueueCard({
  items,
  paused,
  onPause,
  onResume,
  onCancelQueued,
  onEditQueued,
  onReorderQueued,
}: {
  items: QueueItem[]
  paused: boolean
  onPause: () => void
  onResume: () => void
  onCancelQueued: (id: string) => void
  onEditQueued: (item: QueueItem) => void
  onReorderQueued: (sourceId: string, targetId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListOrdered size={16} className="text-slate-500" />
          <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
            Queue
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
            {items.length} pending
          </span>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={paused ? onResume : onPause}>
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((q, idx) => {
          const meta = toolMeta(q.tool)
          const Icon = meta.icon
          return (
            <li
              key={q.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', q.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId = event.dataTransfer.getData('text/plain')
                if (sourceId) onReorderQueued(sourceId, q.id)
              }}
              className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]"
            >
              <GripVertical size={14} className="shrink-0 cursor-grab text-slate-400" />
              <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                {idx === 0 ? 'Next' : `Position ${idx + 1}`}
              </span>
              <Icon size={14} className="shrink-0 text-slate-500" />
              <span className="shrink-0 text-xs font-medium text-slate-700 dark:text-slate-200">
                {meta.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                {q.inputPreview || '(no preview)'}
              </span>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => onEditQueued(q)}
                title="Edit queued item"
                disabled={q.kind === 'image'}
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => onCancelQueued(q.id)}
                title="Remove from queue"
              >
                <X size={12} /> Remove
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ProcessEditModal({
  process,
  onClose,
  onSave,
}: {
  process: EditableProcess
  onClose: () => void
  onSave: (process: EditableProcess) => void
}) {
  const [text, setText] = useState(process.text)
  const [settings, setSettings] = useState<GenerateSettings>(process.settings)
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const set = <K extends keyof GenerateSettings>(key: K, value: GenerateSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }
  const numberValue = (value: unknown): number | undefined => {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={process.title}
        className="glass-strong relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              {process.title}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {toolMeta(process.tool).label}
            </div>
          </div>
          <button type="button" className="btn-ghost !px-2" onClick={onClose} aria-label="Close editor">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 overflow-auto p-4">
          <label className="block">
            <span className="label">Input</span>
            <textarea
              className="textarea h-56 resize-y font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Class</span>
              <input className="input" value={settings.class_name ?? ''} onChange={(e) => set('class_name', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Subject</span>
              <input className="input" value={settings.subject ?? ''} onChange={(e) => set('subject', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Title</span>
              <input className="input" value={settings.title ?? ''} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Output</span>
              <select className="select" value={settings.output_format ?? 'images'} onChange={(e) => set('output_format', e.target.value as GenerateSettings['output_format'])}>
                <option value="html">HTML</option>
                <option value="images">Screenshots</option>
                <option value="pptx">PowerPoint</option>
                <option value="video">MP4 video</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Model</span>
              <select className="select" value={settings.model_choice ?? 'default'} onChange={(e) => set('model_choice', e.target.value)}>
                <option value="default">Qwen 122B default</option>
                <option value="fast">Fast - DeepSeek V4 Flash</option>
                <option value="balanced">Balanced - GLM-5.1</option>
                <option value="quality">Powerful - Nemotron 3 Super 120B</option>
                <option value="long">Long input - DeepSeek V4 Pro</option>
                <option value="short">Small / fastest - Llama 3.1 Nemotron Nano 8B</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Zoom</span>
              <input className="input" type="number" step={0.1} value={settings.zoom ?? ''} onChange={(e) => set('zoom', numberValue(e.target.value))} />
            </label>
            <label className="block">
              <span className="label">Width</span>
              <input className="input" type="number" value={settings.viewport_width ?? ''} onChange={(e) => set('viewport_width', numberValue(e.target.value))} />
            </label>
            <label className="block">
              <span className="label">Height</span>
              <input className="input" type="number" value={settings.viewport_height ?? ''} onChange={(e) => set('viewport_height', numberValue(e.target.value))} />
            </label>
            <label className="block">
              <span className="label">Max screenshots</span>
              <input className="input" type="number" value={settings.max_screenshots ?? ''} onChange={(e) => set('max_screenshots', numberValue(e.target.value))} />
            </label>
          </div>
          <label className="block">
            <span className="label">System prompt</span>
            <textarea
              className="textarea h-24 resize-y"
              value={settings.system_prompt ?? ''}
              onChange={(e) => set('system_prompt', e.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-white/10">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onSave({ ...process, text, settings })}
            disabled={!text.trim()}
          >
            {process.mode === 'queue' ? <Check size={14} /> : <RefreshCw size={14} />}
            {process.mode === 'queue' ? 'Save changes' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function Processes() {
  const nav = useNavigate()
  const { runs, clear, remove, update, finish } = useRuns()
  const { settings: appSettings } = useSettings()
  const {
    queue,
    cancelQueued,
    cancel: cancelLive,
    state: liveState,
    paused: queuePaused,
    pausedReason: queuePausedReason,
    queueModeNotice,
    dismissQueueModeNotice,
    pauseQueue,
    resumeQueue,
    reorderQueued,
    updateQueued,
    enqueueText,
    enqueueHtml,
    enqueueYoutube,
  } = useGenerationQueue()
  const [searchParams] = useSearchParams()
  const highlightOp = searchParams.get('op')
  const highlightQueue = searchParams.get('queue')
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [backendHistory, setBackendHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | RunTool>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'failed' | 'done' | 'cancelled'>('all')
  const [processQuery, setProcessQuery] = useState('')
  const [editingProcess, setEditingProcess] = useState<EditableProcess | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Run | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => readSelectedProcessId())
  const toast = useToast()
  const confirmDialog = useConfirm()
  const runsRef = useRef(runs)
  const recoveredTerminalRefs = useRef<Set<string>>(new Set())

  useEffect(() => {
    runsRef.current = runs
  }, [runs])

  useEffect(() => {
    const syncSelected = () => setSelectedRunId(readSelectedProcessId())
    window.addEventListener(SELECTED_PROCESS_EVENT, syncSelected)
    window.addEventListener('storage', syncSelected)
    return () => {
      window.removeEventListener(SELECTED_PROCESS_EVENT, syncSelected)
      window.removeEventListener('storage', syncSelected)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [c, history] = await Promise.all([
        api.cacheStats(),
        api.history().catch(() => [] as HistoryEntry[]),
      ])
      setCache(c)
      setBackendHistory(Array.isArray(history) ? history : [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh()
    }, 0)
    return () => clearTimeout(t)
  }, [refresh])

  // D1: Server-Sent Events drive backend state in real-time. We subscribe
  // to /runs/<id>/events for every active operationId we know about and
  // mirror events into the local runs store. A low-frequency fallback poll
  // keeps stale terminal rows in sync (e.g. after an app restart, when
  // events were missed entirely).
  const sseHandlesRef = useRef(new Map<string, AbortController>())
  useEffect(() => {
    let stopped = false

    const applyBackendDetail = (
      localRun: Run,
      backendRun: BackendRunDetail['run'],
      nextOperationId: string,
    ) => {
      const backendStatus = String(backendRun.status ?? '')
      if (backendStatus === 'completed') {
        recoveredTerminalRefs.current.add(localRun.id)
        finish(localRun.id, {
          status: 'success',
          ...trackedOutputsFromBackendRun(backendRun, nextOperationId),
          stage: 'complete',
          message: backendRun.message,
          progress: 100,
        })
      } else if (backendStatus === 'failed') {
        recoveredTerminalRefs.current.add(localRun.id)
        finish(localRun.id, {
          status: 'error',
          error: backendRun.message ?? 'Process failed',
          operationId: nextOperationId,
          stage: backendRun.stage,
          message: backendRun.message,
          progress: backendRun.progress ?? 100,
        })
      } else if (backendStatus === 'cancelled') {
        recoveredTerminalRefs.current.add(localRun.id)
        finish(localRun.id, {
          status: 'cancelled',
          operationId: nextOperationId,
          stage: backendRun.stage ?? 'cancelled',
          message: backendRun.message ?? 'Cancelled',
          progress: backendRun.progress ?? 100,
        })
      } else if (backendStatus === 'queued' || backendStatus === 'running') {
        update(localRun.id, {
          status: 'running',
          operationId: nextOperationId,
          stage: backendRun.stage,
          message: backendRun.message,
          progress: backendRun.progress,
          etaSeconds: trackedOutputsFromBackendRun(backendRun, nextOperationId).etaSeconds,
        })
      }
    }

    const subscribeToRun = (localRunId: string, operationId: string) => {
      // Already subscribed?
      if (sseHandlesRef.current.has(operationId)) return
      const ctrl = new AbortController()
      sseHandlesRef.current.set(operationId, ctrl)
      void api
        .streamRunEvents(operationId, {
          signal: ctrl.signal,
          onEvent: (ev) => {
            if (stopped) return
            switch (ev.type) {
              case 'queued':
                update(localRunId, {
                  status: 'running',
                  stage: 'queued',
                  message: ev.message,
                  progress: ev.progress ?? 0,
                })
                break
              case 'started':
              case 'progress':
                update(localRunId, {
                  status: 'running',
                  stage: ev.type === 'progress' ? ev.stage : ev.stage ?? 'running',
                  message: ev.message,
                  progress:
                    ev.type === 'progress' ? ev.progress : ev.progress ?? 0,
                  etaSeconds:
                    ev.type === 'progress' ? ev.eta_seconds : ev.estimated_total_seconds,
                })
                break
              case 'complete':
              case 'error':
              case 'cancelled':
                // SSE only carries summary fields. Fall back to one detail
                // fetch so we capture all output filenames.
                void (async () => {
                  try {
                    const detail = await api.getRun(operationId)
                    if (stopped) return
                    const localRun = runsRef.current.find((r) => r.id === localRunId)
                    if (localRun) {
                      applyBackendDetail(localRun, detail.run, detail.run.operation_id ?? operationId)
                    }
                  } catch {
                    // ignore — fallback poll will cover it
                  }
                })()
                break
              default:
                break
            }
          },
        })
        .catch(() => {
          // Network drop / abort — let the fallback poll re-establish on next tick.
        })
        .finally(() => {
          sseHandlesRef.current.delete(operationId)
        })
    }

    const reconcileSubscriptions = () => {
      const wanted = new Set<string>()
      const now = Date.now()
      for (const r of runsRef.current) {
        if (!r.operationId) continue
        if (r.status === 'running') {
          wanted.add(r.operationId)
          subscribeToRun(r.id, r.operationId)
        } else if (
          (r.status === 'cancelled' || r.status === 'error') &&
          !recoveredTerminalRefs.current.has(r.id) &&
          now - r.startedAt < 2 * 60 * 60_000
        ) {
          wanted.add(r.operationId)
          subscribeToRun(r.id, r.operationId)
        }
      }
      // Cancel any subscriptions for ops we no longer care about.
      for (const [opId, ctrl] of sseHandlesRef.current) {
        if (!wanted.has(opId)) {
          ctrl.abort()
          sseHandlesRef.current.delete(opId)
        }
      }
    }

    // Slow fallback poll (15s) so stale terminal-but-recoverable rows still
    // get caught even if the SSE stream drops or the run finished before we
    // managed to subscribe.
    const fallbackSync = async () => {
      const now = Date.now()
      const candidates = runsRef.current.filter((r) => {
        if (!r.operationId) return false
        if (r.status === 'running') return true
        if (recoveredTerminalRefs.current.has(r.id)) return false
        return (
          (r.status === 'cancelled' || r.status === 'error') &&
          now - r.startedAt < 2 * 60 * 60_000
        )
      })
      await Promise.all(
        candidates.map(async (localRun) => {
          const operationId = localRun.operationId
          if (!operationId) return
          try {
            const detail = await api.getRun(operationId)
            if (stopped) return
            applyBackendDetail(
              localRun,
              detail.run,
              detail.run.operation_id ?? operationId,
            )
          } catch {
            // Try again on the next tick.
          }
        }),
      )
    }

    reconcileSubscriptions()
    void fallbackSync()
    const reconcileId = window.setInterval(reconcileSubscriptions, 2_000)
    const fallbackId = window.setInterval(fallbackSync, 15_000)

    const handles = sseHandlesRef.current
    return () => {
      stopped = true
      window.clearInterval(reconcileId)
      window.clearInterval(fallbackId)
      for (const [, ctrl] of handles) ctrl.abort()
      handles.clear()
    }
  }, [finish, update])

  const matchesStatusFilter = useCallback(
    (run: Run) => {
      if (statusFilter === 'all') return true
      if (statusFilter === 'failed') return run.status === 'error'
      if (statusFilter === 'done') return run.status === 'success'
      return run.status === statusFilter
    },
    [statusFilter],
  )

  const runRows = useMemo(() => {
    const query = processQuery.trim().toLowerCase()
    const byTool = filter === 'all' ? runs : runs.filter((r) => r.tool === filter)
    return byTool
      .filter(matchesStatusFilter)
      .filter((r) => !query || processSearchText(r).includes(query))
  }, [runs, filter, matchesStatusFilter, processQuery])

  const applyBackendRunUpdate = useCallback((localRun: Run, backendRun: BackendRunDetail['run']) => {
    update(localRun.id, {
      ...trackedOutputsFromBackendRun(backendRun, localRun.operationId || localRun.id),
      stage: backendRun.stage,
      message: backendRun.message,
      progress: backendRun.progress,
    })
  }, [update])

  const remainingHistory = useMemo(() => {
    const query = processQuery.trim().toLowerCase()
    // Dedupe history entries against the tracked runs. Match on any of
    // (operation_id, html_file, or input_preview + tight time window) —
    // the backend now emits operation_id on history entries (primary key)
    // but older entries only have html_file, and a very recently completed
    // run may briefly have neither populated on the tracked side. The
    // input+timestamp fuzzy match is the fallback that was missing in #7.
    const runSeenOpIds = new Set(
      runs.map((r) => r.operationId).filter(Boolean) as string[],
    )
    const runSeenHtml = new Set(runs.map((r) => r.htmlFilename).filter(Boolean) as string[])
    const runFingerprints = runs
      .map((r) => ({
        preview: (r.inputPreview || '').slice(0, 120),
        endedAt: r.endedAt ?? r.startedAt,
      }))
      .filter((r) => r.preview)
    return backendHistory
      .filter((h) => {
        if (statusFilter !== 'all' && statusFilter !== 'done') return false
        if (h.operation_id && runSeenOpIds.has(h.operation_id)) return false
        if (h.html_file && runSeenHtml.has(h.html_file)) return false
        if (h.input_preview && h.timestamp) {
          const hPreview = String(h.input_preview).slice(0, 120)
          const hTsMs = typeof h.timestamp === 'number'
            ? h.timestamp * 1000
            : Date.parse(String(h.timestamp))
          if (!Number.isNaN(hTsMs)) {
            const match = runFingerprints.find(
              (rf) => rf.preview === hPreview && Math.abs(rf.endedAt - hTsMs) < 5 * 60_000,
            )
            if (match) return false
          }
        }
        return true
      })
      .filter((h) => {
        if (filter === 'all') return true
        const t = h.tool
        // Accept both the legacy backend labels (`text-to-image`) and the
        // newer ones (`text-to-video`) so history entries show up under
        // their matching filter regardless of which codepath produced them.
        if (filter === 'text-to-video') return t === 'text-to-image' || t === 'text-to-video'
        if (filter === 'html-to-video') return t === 'html-to-image' || t === 'html-to-video'
        if (filter === 'image-to-video') return t === 'image-to-screenshots' || t === 'image-to-video'
        if (filter === 'screenshots-to-video') return t === 'screenshots-to-video'
        return false
      })
      .filter((h) => !query || historySearchText(h).includes(query))
      .slice()
      .reverse()
  }, [backendHistory, filter, processQuery, runs, statusFilter])

  const clearCache = async () => {
    const ok = await confirmDialog({
      title: 'Clear the AI response cache?',
      message: 'Subsequent generations will hit the AI provider again until the cache warms up.',
      confirmLabel: 'Clear cache',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.clearCache()
      await refresh()
      toast.push({ variant: 'success', message: 'AI response cache cleared.' })
    } catch (e) {
      toast.push({
        variant: 'error',
        title: 'Clear cache failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const queueEditorForItem = (item: QueueItem) => {
    if (item.kind === 'image' || item.kind === 'youtube') {
      toast.push({ variant: 'info', message: 'This queued job cannot be edited from Processes. Open the wizard to submit a new one.' })
      return
    }
    setEditingProcess({
      id: item.id,
      title: 'Edit queued process',
      tool: item.tool,
      kind: item.kind,
      text: item.kind === 'html' ? item.html ?? item.inputText ?? '' : item.text ?? item.inputText ?? '',
      settings: item.settings ?? {},
      mode: 'queue',
    })
  }

  const regenerateRun = (run: Run, override?: { text: string; settings: GenerateSettings }) => {
    const text = override?.text ?? run.inputText ?? run.inputPreview ?? ''
    const settings = toGenerateSettings(override?.settings ?? run.settings)
    if (!text.trim() && run.tool !== 'youtube-to-video') {
      toast.push({ variant: 'error', message: 'This process has no saved input to regenerate.' })
      return
    }
    if (run.tool === 'html-to-video') {
      enqueueHtml(run.tool, text, settings)
    } else if (run.tool === 'text-to-video') {
      enqueueText(run.tool, text, settings)
    } else if (run.tool === 'youtube-to-video') {
      settings.youtube_url = (settings.youtube_url ?? firstUrl(text)).trim()
      settings.youtube_timestamps = settings.youtube_timestamps ?? []
      if (!settings.youtube_url) {
        toast.push({ variant: 'error', message: 'This YouTube process has no saved URL to regenerate.' })
        return
      }
      enqueueYoutube(run.tool, settings)
    } else if (run.tool === 'screenshots-to-video') {
      toast.push({ variant: 'error', message: 'Screenshots → Video processes need their original uploads, so regenerate is unavailable.' })
      return
    } else {
      toast.push({ variant: 'error', message: 'Image processes cannot be regenerated after the original file is gone.' })
      return
    }
    toast.push({ variant: 'success', message: 'Process queued for regeneration.' })
  }

  const editRegenerateRun = (run: Run) => {
    const sourceText = run.inputText ?? run.inputPreview ?? ''
    const settings = toGenerateSettings(run.settings)
    const text = run.tool === 'youtube-to-video'
      ? youtubeTimestampText(settings, sourceText)
      : sourceText
    if (!sourceText.trim() && !text.trim()) {
      toast.push({ variant: 'error', message: 'This process has no saved input to edit.' })
      return
    }
    if (run.tool === 'image-to-video') {
      toast.push({ variant: 'error', message: 'Image processes cannot be edited after the original file is gone.' })
      return
    }
    if (run.tool === 'screenshots-to-video') {
      toast.push({ variant: 'error', message: 'Screenshots → Video processes cannot be edited after the originals are gone.' })
      return
    }
    if (run.tool === 'youtube-screenshots') {
      toast.push({ variant: 'error', message: 'YouTube screenshot processes cannot be edited from this wizard yet.' })
      return
    }
    if (run.tool === 'youtube-to-video') {
      settings.youtube_url = (settings.youtube_url ?? firstUrl(sourceText)).trim()
      settings.youtube_timestamps = settings.youtube_timestamps ?? []
      if (!settings.youtube_url) {
        toast.push({ variant: 'error', message: 'This YouTube process has no saved URL to edit.' })
        return
      }
    }
    window.sessionStorage.setItem(PROCESS_EDIT_HANDOFF_KEY, JSON.stringify({
      tool: run.tool,
      text,
      settings,
      replaceTargets: {
        runId: run.id,
        htmlFilename: run.htmlFilename,
        screenshotFiles: run.screenshotFiles ?? [],
        presentationFile: run.presentationFile,
        videoFile: run.videoFile,
      },
    }))
    nav(editWizardPath(run.tool))
  }

  const saveEditedProcess = (process: EditableProcess) => {
    if (process.mode === 'queue') {
      updateQueued(process.id, {
        text: process.kind === 'text' ? process.text : undefined,
        html: process.kind === 'html' ? process.text : undefined,
        settings: process.settings,
      })
      toast.push({ variant: 'success', message: 'Queued process updated.' })
    } else {
      regenerateRun(
        {
          id: process.id,
          tool: process.tool,
          status: 'success',
          startedAt: Date.now(),
          inputPreview: process.text.slice(0, 200),
          inputText: process.text,
          settings: process.settings,
        },
        { text: process.text, settings: process.settings },
      )
    }
    setEditingProcess(null)
  }

  // D9: per-tool count badges so the user can see distribution at a glance.
  const filterCounts = useMemo(() => {
    const counts: Record<'all' | RunTool, number> = {
      all: runs.length,
      'text-to-video': 0,
      'html-to-video': 0,
      'image-to-video': 0,
      'screenshots-to-video': 0,
      'youtube-to-video': 0,
      'youtube-screenshots': 0,
    }
    for (const r of runs) counts[r.tool] += 1
    return counts
  }, [runs])
  const filters: Array<{ key: 'all' | RunTool; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'text-to-video', label: 'Text' },
    { key: 'html-to-video', label: 'HTML' },
    { key: 'image-to-video', label: 'Image' },
    { key: 'screenshots-to-video', label: 'Screenshots' },
    { key: 'youtube-to-video', label: 'YouTube video' },
    { key: 'youtube-screenshots', label: 'YT shots' },
  ]
  const statusCounts = useMemo(() => ({
    all: runs.length,
    running: runs.filter((r) => r.status === 'running').length,
    failed: runs.filter((r) => r.status === 'error').length,
    done: runs.filter((r) => r.status === 'success').length,
    cancelled: runs.filter((r) => r.status === 'cancelled').length,
  }), [runs])
  const statusFilters: Array<{ key: typeof statusFilter; label: string }> = [
    { key: 'all', label: 'All statuses' },
    { key: 'running', label: 'Running' },
    { key: 'failed', label: 'Failed' },
    { key: 'done', label: 'Done' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  const totalRuntime = runs
    .filter((r) => r.endedAt)
    .reduce((sum, r) => sum + (r.endedAt! - r.startedAt), 0)
  const runningRuns = runs.filter((r) => r.status === 'running')
  const currentRun =
    runningRuns.find((r) => r.id === selectedRunId || r.operationId === selectedRunId) ??
    runningRuns[0]
  const visibleProcessCount = runRows.length + remainingHistory.length
  const totalProcessCount = runs.length + backendHistory.length
  const hasActiveFilters = filter !== 'all' || statusFilter !== 'all' || processQuery.trim().length > 0

  const selectRunningRun = (run: Run) => {
    writeSelectedProcessId(run.id)
    setSelectedRunId(run.id)
  }

  const requestCancelRun = async (mode: 'now' | SoftCancelMode, deleteOutputs = false) => {
    const run = cancelTarget ?? currentRun
    if (!run) return
    setCancelTarget(null)
    const targetId = run.operationId ?? run.id
    update(run.id, {
      status: 'running',
      stage: 'cancelling',
      message:
        mode !== 'now'
          ? 'Cancellation requested. Waiting for the current step to finish...'
          : 'Cancellation requested. Waiting for the running step to stop.',
    })
    try {
      if (liveState.status === 'running' && run.operationId && run.operationId === liveState.operationId) {
        cancelLive({ mode, delete_outputs: deleteOutputs })
      } else {
        await api.cancelRun(targetId, { mode, delete_outputs: deleteOutputs })
      }
      toast.push({
        variant: 'success',
        message: mode !== 'now' ? 'Process will stop after the current step finishes.' : 'Cancellation requested.',
      })
    } catch (e) {
      toast.push({
        variant: 'error',
        title: 'Cancel failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <div className="container-page space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">
            <span className="h-1 w-1 rounded-full bg-brand-500" />
            Activity
          </div>
          <h1 className="h-page mt-2">Processes</h1>
          <p className="mt-2 text-sm text-muted">
            Every generation run, its input, how long it took, and the files it produced — all
            in one place.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="btn-secondary" onClick={clearCache}>
            <Database size={16} /> Clear AI cache
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tracked runs" value={runs.length} />
        <Stat
          label="Succeeded"
          value={runs.filter((r) => r.status === 'success').length}
        />
        <Stat
          label="Total runtime"
          value={totalRuntime > 0 ? formatRuntime(totalRuntime) : '—'}
        />
        <Stat
          label="Cache entries"
          value={
            typeof cache?.total_entries === 'number'
              ? String(cache.total_entries)
              : typeof cache?.active_entries === 'number'
              ? String(cache.active_entries)
              : '—'
          }
        />
      </div>

      <LiveRunCard
        liveState={liveState}
        trackedRun={currentRun}
        onCancel={() => currentRun && setCancelTarget(currentRun)}
      />

      {cancelTarget && (
        <CancelRunDialog
          run={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelAfterStep={(mode) => void requestCancelRun(mode)}
          onCancelNow={(deleteOutputs) => void requestCancelRun('now', deleteOutputs)}
        />
      )}

      <div className="glass !p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input h-10 w-full pl-9"
              value={processQuery}
              onChange={(event) => setProcessQuery(event.target.value)}
              placeholder="Search input, file, operation id, model, or subject"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200">
              Showing {visibleProcessCount.toLocaleString()} of {totalProcessCount.toLocaleString()}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setFilter('all')
                  setStatusFilter('all')
                  setProcessQuery('')
                }}
              >
                <X size={12} /> Reset
              </button>
            )}
            {runs.length > 0 && (
              <button
                className="btn-ghost btn-sm"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Clear the local process log?',
                    message: 'Only your browser-local list of runs is cleared. Backend history is not affected.',
                    confirmLabel: 'Clear log',
                  })
                  if (ok) clear()
                }}
              >
                <Trash2 size={12} /> Clear log
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Type
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filters.map((f) => {
                const count = filterCounts[f.key]
                const active = filter === f.key
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                      (active
                        ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300')
                    }
                    aria-label={`${f.label} (${count})`}
                  >
                    <span>{f.label}</span>
                    <span className="tabular-nums text-[10px] opacity-80">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Status
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusFilters.map((f) => {
                const count = statusCounts[f.key]
                const active = statusFilter === f.key
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setStatusFilter(f.key)}
                    className={
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                      (active
                        ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300')
                    }
                  >
                    <span>{f.label}</span>
                    <span className="tabular-nums text-[10px] opacity-80">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {err && <div className="card text-sm text-red-600 dark:text-red-300">{err}</div>}

      {(queueModeNotice || queue.length > 0) && (
        <Banner
          tone="info"
          icon={<Activity size={16} />}
          title={appSettings.concurrentPipelineRuns ? 'Concurrent queue mode' : 'Serial queue mode'}
          actions={
            queueModeNotice && (
              <button
                type="button"
                className="btn-ghost btn-sm shrink-0 self-center"
                onClick={dismissQueueModeNotice}
              >
                <X size={12} /> Dismiss
              </button>
            )
          }
        >
          {queueModeNotice ??
            (appSettings.concurrentPipelineRuns
              ? 'Pending Text -> Video jobs can start in parallel; screenshot and PowerPoint stages still wait for their slots.'
              : 'Pending jobs will run one at a time in the visible queue order.')}
        </Banner>
      )}

      {queuePaused && (
        <Banner
          tone="warning"
          icon={<Pause size={16} />}
          title="Queue paused"
          actions={
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0 self-center"
              onClick={resumeQueue}
              disabled={queue.length === 0}
            >
              Resume queue
            </button>
          }
        >
          {queuePausedReason === 'in_flight'
            ? 'The previous run was rejected because another run is already in progress on the backend. Resuming would just hit the same 409 — wait for the active run to finish, then resume.'
            : queuePausedReason === 'duplicate'
            ? 'The previous run was rejected as a duplicate of a recent submission. Tweak the input or wait a few seconds before resuming.'
            : queuePausedReason === 'unknown'
            ? 'The previous run was rejected by the backend. Investigate before resuming.'
            : 'Pending jobs will wait here until you resume the queue.'}
        </Banner>
      )}
      {/* `queue` now contains pending-only items (the currently-executing
          run is tracked separately and appears as a tracked run row above),
          so we render the full queue rather than `slice(1)`. */}
      <QueueCard
        items={queue}
        paused={queuePaused}
        onPause={pauseQueue}
        onResume={resumeQueue}
        onCancelQueued={cancelQueued}
        onEditQueued={queueEditorForItem}
        onReorderQueued={reorderQueued}
      />

      {runRows.length === 0 && remainingHistory.length === 0 && queue.length === 0 && liveState.status !== 'running' ? (
        <EmptyState
          icon={<Activity size={20} />}
          title="No runs yet"
          description="Generated jobs land here with input, runtime, and outputs side-by-side."
          action={
            <a className="btn-primary btn-sm" href="/workspace">
              Start your first run
            </a>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Process timeline</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Recent tracked runs first, followed by backend history that is not already tracked locally.
              </p>
            </div>
          </div>
          {visibleProcessCount === 0 && (
            <div className="glass text-sm text-slate-600 dark:text-slate-300">
              No processes match the current search and filters.
            </div>
          )}
          {runRows.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              onRemove={remove}
              onRegenerate={regenerateRun}
              onEditRegenerate={editRegenerateRun}
              onSelectRunning={selectRunningRun}
              onBackendRunUpdated={applyBackendRunUpdate}
              selected={
                r.status === 'running' &&
                !!currentRun &&
                (r.id === currentRun.id || r.operationId === currentRun.operationId)
              }
              highlight={
                (!!highlightOp &&
                  (r.operationId === highlightOp || r.id === highlightOp)) ||
                // Highlight the newest running row when we landed via
                // /processes?queue=… — the queue id is transient, so we key
                // off status+recency instead of a direct match.
                (!!highlightQueue &&
                  r.status === 'running' &&
                  r === runRows.find((x) => x.status === 'running'))
              }
            />
          ))}
          {remainingHistory.map((entry, index) => (
            <HistoryRow
              key={`${entry.operation_id ?? entry.html_file ?? entry.timestamp ?? index}`}
              entry={entry}
            />
          ))}
        </div>
      )}
      {editingProcess && (
        <ProcessEditModal
          process={editingProcess}
          onClose={() => setEditingProcess(null)}
          onSave={saveEditedProcess}
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass !p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-slate-900 dark:text-slate-50">
        {value}
      </div>
    </div>
  )
}
