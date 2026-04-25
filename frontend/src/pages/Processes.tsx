import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Activity,
  CheckCircle2,
  Clock,
  Code2,
  Database,
  FileText,
  ImageIcon,
  ListOrdered,
  Loader2,
  RefreshCw,
  StopCircle,
  Trash2,
  Wand2,
  X,
  XCircle,
} from 'lucide-react'
import { api } from '../api/client'
import type { CacheStats, HistoryEntry } from '../api/types'
import { formatRelative, formatRuntime, useRuns } from '../store/runs'
import type { Run, RunStatus, RunTool } from '../store/runs'
import { useToast } from '../store/toast'
import { useConfirm } from '../components/ConfirmDialog'
import HtmlPreviewModal from '../components/HtmlPreviewModal'
import ProgressBar from '../components/ProgressBar'
import { useGenerationQueue } from '../hooks/useTrackedGenerate'
import type { QueueItem } from '../hooks/useTrackedGenerate'

type ToolLike = RunTool | 'regenerate' | 'text-to-image' | 'html-to-image' | 'image-to-screenshots' | string | undefined

const TOOL_META: Record<string, { label: string; icon: typeof FileText }> = {
  'text-to-video': { label: 'Text → Video', icon: FileText },
  'text-to-image': { label: 'Text → Video', icon: FileText },
  'html-to-video': { label: 'HTML → Video', icon: Code2 },
  'html-to-image': { label: 'HTML → Video', icon: Code2 },
  'image-to-video': { label: 'Image → Video', icon: ImageIcon },
  'image-to-screenshots': { label: 'Image → Video', icon: ImageIcon },
  regenerate: { label: 'Regenerate', icon: Wand2 },
}

function toolMeta(tool: ToolLike) {
  return TOOL_META[tool ?? ''] ?? { label: tool ?? 'Run', icon: Activity }
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
      <span className="badge-neutral">
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

function RunRow({
  run,
  onRemove,
  highlight = false,
}: {
  run: Run
  onRemove?: (id: string) => void
  highlight?: boolean
}) {
  const meta = toolMeta(run.tool)
  const Icon = meta.icon
  const now = useNow(!run.endedAt)
  const runtime = (run.endedAt ?? now) - run.startedAt
  const [userOpen, setUserOpen] = useState(false)
  // Derive `open` from (user click || highlight prop) so we don't need to
  // setState from an effect just because the prop flipped.
  const open = userOpen || highlight
  const [preview, setPreview] = useState<string | null>(null)
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

  return (
    <div
      ref={rowRef}
      className={
        highlight
          ? 'glass overflow-hidden !p-0 ring-2 ring-brand-400 dark:ring-brand-500/60'
          : 'glass overflow-hidden !p-0'
      }
    >
      <button
        type="button"
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
        onClick={() => setUserOpen((o) => !o)}
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
        </div>

        <div className="hidden w-40 shrink-0 text-right sm:block">
          <div className="flex items-center justify-end gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Clock size={14} /> {formatRuntime(runtime)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {run.screenshotFiles?.length ?? 0} screenshot{run.screenshotFiles?.length === 1 ? '' : 's'}
          </div>
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-200 px-5 py-4 dark:border-white/10">
          <div className="grid gap-4 md:grid-cols-3">
            <Section title="Input">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
                {run.inputPreview || '(empty)'}
              </pre>
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
                <a
                  href={api.htmlUrl(run.htmlFilename)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-brand-600 hover:underline dark:text-brand-300"
                  title={run.htmlFilename}
                >
                  HTML · {run.htmlFilename}
                </a>
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

          {hasOutputs && run.screenshotFiles && run.screenshotFiles.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Screenshot preview ({run.screenshotFiles.length})
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {run.screenshotFiles.slice(0, 12).map((f) => {
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
                      onClick={() => setPreview(url)}
                      className="block aspect-video overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-left transition-shadow hover:shadow-glass-lg dark:border-white/10 dark:bg-white/[0.03]"
                      title={`Preview ${f.split('/').pop() ?? f}`}
                    >
                      <img src={url} alt={f} loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {preview && (
            <HtmlPreviewModal
              kind="image"
              src={preview}
              title={preview.split('/').pop() ?? 'Screenshot'}
              onClose={() => setPreview(null)}
            />
          )}

          {onRemove && (
            <div className="flex justify-end">
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
    // Backend writes `time.time()` which is seconds since epoch; Date takes ms.
    return new Date(num * 1000).toLocaleString()
  }
  return String(ts)
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
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

function LiveRunCard({ onCancel }: { onCancel: () => void }) {
  const { state } = useGenerationQueue()
  if (state.status !== 'running') return null
  return (
    <div className="card ring-2 ring-brand-400/40 dark:ring-brand-500/40">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500"></span>
          </span>
          <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
            Live run
          </div>
          {state.operationId && (
            <code className="text-[10px] text-slate-500 dark:text-slate-400">
              {state.operationId}
            </code>
          )}
        </div>
        <button type="button" className="btn-danger" onClick={onCancel}>
          <StopCircle size={14} /> Cancel run
        </button>
      </div>
      <ProgressBar
        progress={state.progress ?? 0}
        stage={state.stage}
        message={state.message}
        etaSeconds={state.etaSeconds}
        active
      />
    </div>
  )
}

function QueueCard({
  items,
  onCancelQueued,
}: {
  items: QueueItem[]
  onCancelQueued: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <ListOrdered size={16} className="text-slate-500" />
        <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
          Queue
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
          {items.length} pending
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((q, idx) => {
          const meta = toolMeta(q.tool)
          const Icon = meta.icon
          return (
            <li
              key={q.id}
              className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]"
            >
              <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                #{idx + 1}
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

export default function Processes() {
  const { runs, clear, remove } = useRuns()
  const { queue, cancelQueued, cancel: cancelLive, state: liveState } = useGenerationQueue()
  const [searchParams] = useSearchParams()
  const highlightOp = searchParams.get('op')
  const highlightQueue = searchParams.get('queue')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | RunTool>('all')
  const toast = useToast()
  const confirmDialog = useConfirm()

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [h, c] = await Promise.all([api.history(), api.cacheStats()])
      setHistory(Array.isArray(h) ? h : [])
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

  const { runRows, historyRows } = useMemo(() => {
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
    const remainingHistory = history
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
        return false
      })
      .slice()
      .reverse()
    return { runRows: filtered, historyRows: remainingHistory }
  }, [runs, history, filter])

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

  const filters: Array<{ key: 'all' | RunTool; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'text-to-video', label: 'Text' },
    { key: 'html-to-video', label: 'HTML' },
    { key: 'image-to-video', label: 'Image' },
  ]

  const totalRuntime = runs
    .filter((r) => r.endedAt)
    .reduce((sum, r) => sum + (r.endedAt! - r.startedAt), 0)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">Processes</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                filter === f.key
                  ? 'rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                  : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300'
              }
            >
              {f.label}
            </button>
          ))}
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

      <LiveRunCard onCancel={cancelLive} />
      <QueueCard items={queue.slice(1)} onCancelQueued={cancelQueued} />

      {runRows.length === 0 && historyRows.length === 0 && queue.length === 0 && liveState.status !== 'running' ? (
        <div className="card text-center text-sm text-slate-500">
          No runs yet. Head over to Text / HTML / Image to Video to generate your first one —
          it'll show up here with input, runtime, and outputs side-by-side.
        </div>
      ) : (
        <div className="space-y-3">
          {runRows.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              onRemove={remove}
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
          {historyRows.length > 0 && (
            <>
              <div className="pt-4 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                From backend history
              </div>
              {historyRows.slice(0, 50).map((h, i) => (
                <HistoryRow key={`${h.timestamp ?? ''}-${h.html_file ?? ''}-${i}`} entry={h} />
              ))}
            </>
          )}
        </div>
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
