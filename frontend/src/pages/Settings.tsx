import { useState } from 'react'
import {
  AlertCircle,
  Check,
  Code2,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Monitor,
  Moon,
  Paintbrush,
  RefreshCw,
  RotateCcw,
  Server,
  Sun,
  Trash2,
} from 'lucide-react'

import { api } from '../api/client'
import type { HistoryEntry } from '../api/types'
import { useRuns } from '../store/runs'
import {
  BRAND_SWATCHES,
  DEFAULT_CLASS_OPTIONS,
  DEFAULT_SUBJECT_OPTIONS,
  useSettings,
  type ThemeMode,
} from '../store/settings'
import { useToast } from '../store/toast'
import { useConfirm } from '../components/ConfirmDialog'
import SegmentedControl from '../components/SegmentedControl'
import Toggle from '../components/Toggle'
import {
  DEFAULT_YOUTUBE_TEMPLATE,
  readYoutubeTemplate,
  writeYoutubeTemplate,
} from '../lib/youtubePublishTemplate'

export default function Settings() {
  const { settings, update, reset } = useSettings()
  const { clear, runs } = useRuns()
  const confirm = useConfirm()
  const toast = useToast()
  const [pingState, setPingState] = useState<'idle' | 'pinging' | 'ok' | 'error'>('idle')
  const [pingError, setPingError] = useState('')
  const [showBackendHistory, setShowBackendHistory] = useState(false)
  const [backendHistory, setBackendHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [youtubeTemplate, setYoutubeTemplate] = useState(() => readYoutubeTemplate())

  const pingBackend = async () => {
    setPingState('pinging')
    setPingError('')
    try {
      await api.preflight({ fresh: true })
      setPingState('ok')
    } catch (e) {
      setPingState('error')
      setPingError(e instanceof Error ? e.message : String(e))
    }
  }

  const loadBackendHistory = async () => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const rows = await api.history()
      setBackendHistory(Array.isArray(rows) ? rows.slice().reverse() : [])
      setShowBackendHistory(true)
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e))
    } finally {
      setHistoryLoading(false)
    }
  }

  const saveYoutubeTemplate = (value: string) => {
    setYoutubeTemplate(value)
    writeYoutubeTemplate(value)
  }

  return (
    <div className="container-form space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">
            <span className="h-1 w-1 rounded-full bg-brand-500" />
            Preferences
          </div>
          <h1 className="h-page mt-2">Settings</h1>
          <p className="mt-2 text-sm text-muted">
            Appearance, defaults, and backend connection. All changes persist
            to this browser.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            // G3: one-click reset wiped every preference (theme, brand color,
            // backend URL, custom curriculum, …). Wrap with a confirm.
            const ok = await confirm({
              title: 'Reset all settings?',
              message:
                'This clears every preference saved in this browser — theme, brand color, backend URL, custom class/subject lists, and wizard defaults. It cannot be undone.',
              confirmLabel: 'Reset',
              variant: 'danger',
            })
            if (!ok) return
            reset()
            toast.push({ variant: 'success', message: 'Settings reset to defaults.' })
          }}
        >
          <RotateCcw size={14} /> Reset to defaults
        </button>
      </div>

      {/* ─── Appearance ─────────────────────────────────────────────────── */}
      <Section title="Appearance" icon={<Paintbrush size={16} />}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="label">Theme</div>
            <SegmentedControl<ThemeMode>
              ariaLabel="Theme"
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'light', label: 'Light', icon: <Sun size={14} /> },
                { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
                { value: 'system', label: 'System', icon: <Monitor size={14} /> },
              ]}
            />
            <p className="mt-2 text-xs text-muted">
              "System" follows your OS. Changes apply instantly across every page.
            </p>
          </div>

          <div>
            <div className="label">Primary color</div>
            <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
              {BRAND_SWATCHES.map((s) => {
                const active = settings.brandId === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => update({ brandId: s.id })}
                    className={
                      'group relative flex aspect-square items-center justify-center rounded-lg border transition-shadow ' +
                      (active
                        ? 'border-slate-900 shadow-glass dark:border-white'
                        : 'border-slate-200 dark:border-white/10')
                    }
                    title={s.label}
                    aria-label={s.label}
                  >
                    <span
                      className="h-7 w-7 rounded-md shadow-inner"
                      style={{ backgroundColor: s.preview }}
                    />
                    {active && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Check size={14} className="text-white drop-shadow" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Drives every accent in the app — buttons, badges, links, focus rings.
            </p>
          </div>
        </div>
      </Section>

      {/* ─── Defaults ───────────────────────────────────────────────────── */}
      <Section title="Defaults" icon={<Check size={16} />}>
        <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label htmlFor="default-output" className="label">
              Default output format
            </label>
            <select
              id="default-output"
              className="select"
              value={settings.defaultOutputFormat}
              onChange={(e) =>
                update({
                  defaultOutputFormat: e.target.value as
                    | 'html'
                    | 'images'
                    | 'pptx'
                    | 'video',
                })
              }
            >
              <option value="images">Screenshots (PNG)</option>
              <option value="html">HTML file only</option>
              <option value="pptx">PowerPoint deck (.pptx)</option>
              <option value="video">MP4 video</option>
            </select>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Pre-selected on the Text → Video wizard. PowerPoint / MP4 require Windows.
            </p>
          </div>
        </div>
        {/* C4: per-user curriculum overrides for class / subject pickers. */}
        <div className="border-t border-slate-100 pt-5 dark:border-white/5">
          <div className="mb-3">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
              Class &amp; subject options
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Override the defaults shown in the Text → Video wizard. One value per line. Leave empty to use the curated default list.
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="custom-classes" className="label">
                Class options
              </label>
              <textarea
                id="custom-classes"
                className="textarea h-32 resize-y font-mono text-xs"
                placeholder={DEFAULT_CLASS_OPTIONS.slice(0, 5).join('\n') + '\n…'}
                value={settings.customClassOptions.join('\n')}
                onChange={(e) =>
                  update({
                    customClassOptions: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0),
                  })
                }
                spellCheck={false}
              />
              {settings.customClassOptions.length === 0 && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Using {DEFAULT_CLASS_OPTIONS.length} default values.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="custom-subjects" className="label">
                Subject options
              </label>
              <textarea
                id="custom-subjects"
                className="textarea h-32 resize-y font-mono text-xs"
                placeholder={DEFAULT_SUBJECT_OPTIONS.slice(0, 5).join('\n') + '\n…'}
                value={settings.customSubjectOptions.join('\n')}
                onChange={(e) =>
                  update({
                    customSubjectOptions: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0),
                  })
                }
                spellCheck={false}
              />
              {settings.customSubjectOptions.length === 0 && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Using {DEFAULT_SUBJECT_OPTIONS.length} default values.
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 pt-5 dark:border-white/5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-200">
                <ImageIcon size={16} />
              </span>
              <div>
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Auto thumbnail builder
                </div>
                <div className="mt-0.5 max-w-xl text-xs text-slate-500 dark:text-slate-400">
                  Builds an intro thumbnail from the text-to-video class, subject, chapter, and input text when PPT / MP4 export starts.
                </div>
              </div>
            </div>
            <Toggle
              label=""
              checked={settings.autoThumbnailBuilder}
              onChange={(v) => update({ autoThumbnailBuilder: v })}
            />
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                YouTube publish format
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Used by the Publish page to generate titles, descriptions, queries, and tags locally.
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => saveYoutubeTemplate(DEFAULT_YOUTUBE_TEMPLATE)}
            >
              <RotateCcw size={12} /> Reset format
            </button>
          </div>
          <textarea
            className="textarea min-h-72 font-mono text-xs"
            value={youtubeTemplate}
            onChange={(e) => saveYoutubeTemplate(e.target.value)}
            spellCheck={false}
          />
        </div>
        </div>
      </Section>

      {/* ─── Backend ────────────────────────────────────────────────────── */}
      <Section title="Backend" icon={<Server size={16} />}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-200">
                <GitBranch size={16} />
              </span>
              <div>
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Concurrent pipeline runs
                </div>
                <div className="mt-0.5 max-w-xl text-xs text-slate-500 dark:text-slate-400">
                  Starts queued text jobs sooner. AI generation can overlap, while screenshot capture and PowerPoint/video export stay single-lane.
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.concurrentPipelineRuns}
              onClick={() => update({ concurrentPipelineRuns: !settings.concurrentPipelineRuns })}
              className={
                'relative h-7 w-12 rounded-full transition-colors ' +
                (settings.concurrentPipelineRuns
                  ? 'bg-brand-500'
                  : 'bg-slate-300 dark:bg-slate-700')
              }
            >
              <span
                className={
                  'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ' +
                  (settings.concurrentPipelineRuns ? 'translate-x-6' : 'translate-x-1')
                }
              />
            </button>
          </div>

          <label htmlFor="backend-url" className="label">
            Backend URL override
          </label>
          <div className="flex gap-2">
            <input
              id="backend-url"
              type="text"
              className="input flex-1"
              value={settings.backendUrl}
              onChange={(e) => update({ backendUrl: e.target.value.trim() })}
              placeholder="leave blank to use the Vite proxy (recommended)"
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={pingBackend}
              disabled={pingState === 'pinging'}
            >
              Test connection
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Leave blank to use the Vite dev proxy / same-origin Flask build. If
            set, every API call from this browser is redirected to this URL —
            useful when the frontend and backend are on different hosts.
          </p>
          {pingState === 'ok' && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
              <Check size={14} /> Backend responded to /preflight
            </div>
          )}
          {pingState === 'error' && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <AlertCircle size={14} className="mt-0.5" />
              <div>
                <div className="font-medium">Backend unreachable</div>
                <div className="opacity-80">{pingError}</div>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ─── Data ───────────────────────────────────────────────────────── */}
      <Section title="Data" icon={<Trash2 size={16} />}>
        <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <div className="font-medium text-slate-800 dark:text-slate-100">
              Clear process history
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Removes all {runs.length} local entries and clears backend saved
              history. Generated files are not touched.
            </div>
          </div>
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              const ok = await confirm({
                title: 'Clear all process history?',
                message: 'This clears the local Processes log and backend saved history. Generated output files are not affected.',
                confirmLabel: 'Clear',
                variant: 'danger',
              })
              if (!ok) return
              try {
                await api.clearHistory()
                clear()
                toast.push({ variant: 'success', message: 'Process history cleared.' })
              } catch (e) {
                toast.push({
                  variant: 'error',
                  title: 'Clear history failed',
                  message: e instanceof Error ? e.message : String(e),
                })
              }
            }}
          >
            <Trash2 size={14} /> Clear history
          </button>
        </div>
        <div className="border-t border-slate-100 pt-5 dark:border-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <div className="font-medium text-slate-800 dark:text-slate-100">
                Backend history
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Hidden by default. Load it only when you want to inspect backend saved runs.
              </div>
            </div>
            <div className="flex gap-2">
              {showBackendHistory && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowBackendHistory(false)}
                >
                  Hide
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={loadBackendHistory}
                disabled={historyLoading}
              >
                <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
                {showBackendHistory ? 'Refresh' : 'Show backend history'}
              </button>
            </div>
          </div>
          {historyError && (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              {historyError}
            </div>
          )}
          {showBackendHistory && (
            <div className="mt-4 space-y-2">
              {backendHistory.length === 0 && !historyLoading ? (
                <div className="rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                  No backend history found.
                </div>
              ) : (
                backendHistory.slice(0, 50).map((entry, index) => (
                  <BackendHistoryRow
                    key={`${entry.timestamp ?? ''}-${entry.html_file ?? ''}-${index}`}
                    entry={entry}
                  />
                ))
              )}
            </div>
          )}
        </div>
        </div>
      </Section>
    </div>
  )
}

function BackendHistoryRow({ entry }: { entry: HistoryEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-200">
        <FileText size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {historyToolLabel(entry.tool)}
          </span>
          {(entry.datetime || entry.timestamp) && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {entry.datetime ?? formatHistoryTimestamp(entry.timestamp)}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
          {entry.input_preview || '(no input recorded)'}
        </div>
      </div>
      {entry.html_file && (
        <a
          href={api.htmlUrl(entry.html_file)}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary btn-sm hidden shrink-0 sm:inline-flex"
        >
          <Code2 size={12} /> HTML
        </a>
      )}
      {entry.video_file && (
        <a href={api.downloadUrl(entry.video_file)} className="btn-secondary btn-sm hidden shrink-0 sm:inline-flex">
          MP4
        </a>
      )}
      {entry.presentation_file && (
        <a href={api.downloadUrl(entry.presentation_file)} className="btn-secondary btn-sm hidden shrink-0 sm:inline-flex">
          PPTX
        </a>
      )}
    </div>
  )
}

function historyToolLabel(tool: string | undefined): string {
  if (tool === 'html-to-video' || tool === 'html-to-image') return 'HTML to Video'
  if (tool === 'image-to-video' || tool === 'image-to-screenshots') return 'Image to Video'
  if (tool === 'screenshots-to-video') return 'Screenshots to Video'
  return 'Text to Video'
}

function formatHistoryTimestamp(ts: number | string | undefined): string {
  if (ts == null) return ''
  const num = typeof ts === 'number' ? ts : Number(ts)
  if (Number.isFinite(num)) return new Date(num * 1000).toLocaleString()
  return String(ts)
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card">
      <div className="mb-5 flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-white/5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
          {icon}
        </span>
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}
