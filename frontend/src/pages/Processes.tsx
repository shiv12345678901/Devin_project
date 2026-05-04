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
  }
}

const TOOL_META: Record<string, { label: string; icon: typeof FileText }> = {
  'text-to-video': { label: 'Text → Video', icon: FileText },
  'text-to-image': { label: 'Text → Video', icon: FileText },
  'html-to-video': { label: 'HTML → Video', icon: Code2 },
  'html-to-image': { label: 'HTML → Video', icon: Code2 },
  'image-to-video': { label: 'Image → Video', icon: ImageIcon },
  'image-to-screenshots': { label: 'Image → Video', icon: ImageIcon },
  'screenshots-to-video': { label: 'Screenshots → Video', icon: ImageIcon },
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
  const { resolution, ...rest } = raw
  const next: GenerateSettings = { ...rest }
  if (['720p', '1080p', '1440p', '4k'].includes(String(resolution))) {
    next.resolution = resolution as GenerateSettings['resolution']
  }
  return next
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

function RunRow({
  run,
  onRemove,
  onRegenerate,
  onEditRegenerate,
  onSelectRunning,
  selected = false,
  highlight = false,
}: {
  run: Run
  onRemove?: (id: string) => void
  onRegenerate?: (run: Run) => void
  onEditRegenerate?: (run: Run) => void
  onSelectRunning?: (run: Run) => void
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
  const [previewIndex, setPreviewIndex] = useState(0)
  const [copiedInput, setCopiedInput] = useState(false)
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
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-slate-700 dark:text-slate-200">
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
              {run.status === 'error' && run.error && (
                <p className="text-sm text-red-600 dark:text-red-300">{run.error}</p>
              )}
              {run.htmlFilename && (
                <button
                  type="button"
                  onClick={() => setHtmlPreview(true)}
                  className="block max-w-full truncate text-left text-xs text-brand-600 hover:underline dark:text-brand-300"
                  title={run.htmlFilename}
                >
                  HTML · {run.htmlFilename}
                </button>
              )}
              {run.videoFile && (
                <a
                  href={api.downloadUrl(run.videoFile)}
                  className="block truncate text-xs text-brand-600 hover:underline dark:text-brand-300"
                  title={run.videoFile}
                >
                  MP4 - {run.videoFile}
                </a>
              )}
              {run.presentationFile && (
                <a
                  href={api.downloadUrl(run.presentationFile)}
                  className="block truncate text-xs text-brand-600 hover:underline dark:text-brand-300"
                  title={run.presentationFile}
                >
                  PPTX - {run.presentationFile}
                </a>
              )}
              <KV
                label="Screenshots"
                value={`${run.screenshotFiles?.length ?? 0}`}
              />
              {run.operationId && (
                <KV label="Op ID" value={<code className="text-[10px]">{run.operationId}</code>} />
              )}
            </Section>
          </div>

          {(run.videoFile || (hasOutputs && run.screenshotFiles && run.screenshotFiles.length > 0)) && (
            <div className="grid gap-3 lg:grid-cols-2">
          {run.videoFile && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Film size={16} className="shrink-0 text-brand-500" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Video
                    </div>
                    <div className="truncate text-xs text-slate-600 dark:text-slate-300">
                      {run.videoFile}
                    </div>
                  </div>
                </div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setVideoPreview(true)}>
                  Maximize
                </button>
              </div>
              <button
                type="button"
                onClick={() => setVideoPreview(true)}
                className="block aspect-video w-full overflow-hidden rounded-md bg-black"
                title="Open video preview"
              >
                <video
                  src={api.downloadUrl(run.videoFile)}
                  preload="metadata"
                  muted
                  className="h-full w-full object-contain"
                />
              </button>
              <a href={api.downloadUrl(run.videoFile)} className="btn-secondary btn-sm mt-2 w-full">
                <Download size={12} /> Download MP4
              </a>
            </div>
          )}

          {hasOutputs && run.screenshotFiles && run.screenshotFiles.length > 0 && (
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
                    src={selectedScreenshotUrl}
                    alt={selectedScreenshot ?? 'Screenshot'}
                    className="h-full w-full object-contain"
                  />
                </button>
              )}
              <div className="grid grid-cols-6 gap-1">
                {run.screenshotFiles.slice(0, 12).map((f, index) => {
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
        </div>
      )}
    </div>
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
  const now = useNow(Boolean(source))
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
                <option value="default">Default</option>
                <option value="fast">Fast</option>
                <option value="short">Short</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality</option>
                <option value="long">Long context</option>
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
  } = useGenerationQueue()
  const [searchParams] = useSearchParams()
  const highlightOp = searchParams.get('op')
  const highlightQueue = searchParams.get('queue')
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | RunTool>('all')
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
      const c = await api.cacheStats()
      setCache(c)
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

  const runRows = useMemo(() => {
    const filtered = filter === 'all' ? runs : runs.filter((r) => r.tool === filter)
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
    const remainingHistory = ([] as HistoryEntry[])
      .filter((h) => {
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
      .slice()
      .reverse()
    void remainingHistory
    return filtered
  }, [runs, filter])

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
    if (item.kind === 'image') {
      toast.push({ variant: 'info', message: 'Image jobs need their original uploaded file, so edit is unavailable.' })
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
    if (!text.trim()) {
      toast.push({ variant: 'error', message: 'This process has no saved input to regenerate.' })
      return
    }
    if (run.tool === 'html-to-video') {
      enqueueHtml(run.tool, text, settings)
    } else if (run.tool === 'text-to-video') {
      enqueueText(run.tool, text, settings)
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
    const text = run.inputText ?? run.inputPreview ?? ''
    if (!text.trim()) {
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
    window.sessionStorage.setItem(PROCESS_EDIT_HANDOFF_KEY, JSON.stringify({
      tool: run.tool,
      text,
      settings: toGenerateSettings(run.settings),
      replaceTargets: {
        runId: run.id,
        htmlFilename: run.htmlFilename,
        screenshotFiles: run.screenshotFiles ?? [],
        presentationFile: run.presentationFile,
        videoFile: run.videoFile,
      },
    }))
    nav(run.tool === 'html-to-video' ? '/workspace/html' : '/workspace/text')
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
  ]

  const totalRuntime = runs
    .filter((r) => r.endedAt)
    .reduce((sum, r) => sum + (r.endedAt! - r.startedAt), 0)
  const runningRuns = runs.filter((r) => r.status === 'running')
  const currentRun =
    runningRuns.find((r) => r.id === selectedRunId || r.operationId === selectedRunId) ??
    runningRuns[0]

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

      <div className="flex flex-wrap items-center justify-between gap-3">
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
                <span
                  className={
                    'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ' +
                    (active
                      ? 'bg-brand-500/15 text-brand-700 dark:bg-brand-400/20 dark:text-brand-100'
                      : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300')
                  }
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        {runs.length > 0 && (
          <button
            className="btn-ghost text-xs"
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

      {runRows.length === 0 && queue.length === 0 && liveState.status !== 'running' ? (
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
          {runRows.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              onRemove={remove}
              onRegenerate={regenerateRun}
              onEditRegenerate={editRegenerateRun}
              onSelectRunning={selectRunningRun}
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
