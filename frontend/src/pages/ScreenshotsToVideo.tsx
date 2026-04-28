import { Play, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type React from 'react'

import { api } from '../api/client'
import { useToast } from '../store/toast'
import { useRuns } from '../store/runs'
import type { GenerateSettings, OutputFormat } from '../api/types'

const ACCEPTED_MIME = /^image\/.+$/
const ACCEPTED_EXT = /\.(png|jpe?g|webp|bmp)$/i

const CLASS_OPTIONS = ['Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12']
const SUBJECT_OPTIONS = ['Nepali', 'English', 'Science', 'Math', 'Social', 'Model Question']
const RESOLUTION_OPTIONS: Array<NonNullable<GenerateSettings['resolution']>> = ['720p', '1080p', '1440p', '4k']

const DEFAULT_SETTINGS: GenerateSettings = {
  output_format: 'video',
  class_name: 'Class 10',
  subject: 'Nepali',
  resolution: '1080p',
  fps: 30,
  video_quality: 85,
  auto_timing_screenshot_slides: true,
  fixed_seconds_per_screenshot_slide: 5,
  close_powerpoint_before_start: true,
  intro_thumbnail_enabled: false,
  intro_thumbnail_duration_sec: 5,
  outro_thumbnail_enabled: false,
  outro_thumbnail_duration_sec: 5,
  concurrent_pipeline_runs: false,
}

interface ScreenshotEntry {
  file: File
  url: string
  key: string
}

export default function ScreenshotsToVideo() {
  const [entries, setEntries] = useState<ScreenshotEntry[]>([])
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reorderDragKey, setReorderDragKey] = useState<string | null>(null)
  const [reorderOverKey, setReorderOverKey] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const toast = useToast()
  const runs = useRuns()
  const nav = useNavigate()

  useEffect(() => {
    if (!previewKey) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPreviewKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewKey])

  const totalBytes = useMemo(() => entries.reduce((s, e) => s + e.file.size, 0), [entries])

  const acceptFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return
    const list = Array.from(incoming)
    const filtered = list.filter(
      (f) => ACCEPTED_MIME.test(f.type) || ACCEPTED_EXT.test(f.name),
    )
    if (filtered.length !== list.length) {
      toast.push({
        variant: 'error',
        title: 'Some files were skipped',
        message: 'Only PNG, JPG, WEBP, or BMP screenshots are supported.',
      })
    }
    setEntries((prev) => [
      ...prev,
      ...filtered.map((file, idx) => ({
        file,
        url: URL.createObjectURL(file),
        key: `${Date.now()}-${prev.length + idx}-${file.name}`,
      })),
    ])
  }

  const moveEntry = (key: string, direction: -1 | 1) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.key === key)
      if (idx === -1) return prev
      const target = idx + direction
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      const [item] = next.splice(idx, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const reorderTo = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return
    setEntries((prev) => {
      const from = prev.findIndex((e) => e.key === sourceKey)
      const to = prev.findIndex((e) => e.key === targetKey)
      if (from === -1 || to === -1) return prev
      const next = prev.slice()
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const removeEntry = (key: string) => {
    setEntries((prev) => {
      const found = prev.find((e) => e.key === key)
      if (found) URL.revokeObjectURL(found.url)
      return prev.filter((e) => e.key !== key)
    })
  }

  const onDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    if (submitting) return
    e.preventDefault()
    setDragActive(true)
  }
  const onDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragActive(false)
  }
  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    if (submitting) return
    e.preventDefault()
    setDragActive(false)
    acceptFiles(e.dataTransfer?.files ?? null)
  }

  const set = <K extends keyof GenerateSettings>(key: K, value: GenerateSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (entries.length === 0) {
      toast.push({ variant: 'error', message: 'Add at least one screenshot.' })
      return
    }
    if (!settings.title?.trim()) {
      toast.push({
        variant: 'error',
        title: 'Chapter title required',
        message: 'Provide the chapter title so the canonical filename is correct.',
      })
      return
    }
    setSubmitting(true)
    try {
      const files = entries.map((e) => e.file)
      const response = await api.startScreenshotsToVideoRun(files, settings)
      // Mirror the text-to-video flow: drop a "running" row into the
      // local Runs store so the user sees the new process show up
      // immediately on the Processes tab without waiting for the next
      // /runs poll.
      runs.start({
        tool: 'screenshots-to-video',
        inputPreview: `${entries.length} screenshots`,
        inputText: `[${entries.length} screenshots]`,
        settings: {
          class_name: settings.class_name,
          subject: settings.subject,
          title: settings.title,
          output_format: settings.output_format,
          resolution: settings.resolution,
          fps: settings.fps,
          video_quality: settings.video_quality,
        },
        operationId: response.operation_id,
        inputFiles: entries.map((e) => e.file.name),
      })
      toast.push({
        variant: 'success',
        message: `Run queued (#${response.queue_position ?? 1}). Watch progress on the Processes tab.`,
      })
      nav(`/processes?run=${encodeURIComponent(response.run_id)}`)
    } catch (err) {
      toast.push({
        variant: 'error',
        title: 'Could not start run',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">
          Screenshots → Video
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Skip the AI step and the screenshot capture entirely. Upload PNG / JPG screenshots you
          already have, fill in the project info, and run the same MP4 / PPTX export pipeline used
          by Text → Video. Outputs use the canonical
          <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-white/10">
            class_X_subject_chapter_Y_exercise_&lt;year&gt;
          </code>
          filename so the Process tab, Publish tab, and Library all line up.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="card">
          <label className="label" htmlFor="screenshots-input">
            Screenshots ({entries.length})
            {entries.length > 0 && (
              <span className="ml-2 text-xs text-slate-500">
                {(totalBytes / 1024 / 1024).toFixed(1)} MB total
              </span>
            )}
          </label>
          <label
            htmlFor="screenshots-input"
            onDragOver={onDragOver}
            onDragEnter={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ' +
              (dragActive
                ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/30'
                : 'border-slate-200 bg-slate-50 hover:border-brand-400 hover:bg-brand-50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-brand-500/60 dark:hover:bg-brand-900/20')
            }
          >
            <Upload size={28} className={dragActive ? 'text-brand-500' : 'text-slate-400'} />
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Click to upload</span> or drag-and-drop multiple
              PNG / JPG / WEBP screenshots
            </div>
            <input
              id="screenshots-input"
              type="file"
              multiple
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                acceptFiles(e.target.files)
                e.target.value = ''
              }}
              disabled={submitting}
            />
          </label>

          {entries.length > 0 && (
            <>
              <div className="mt-3 text-[11px] text-muted">
                Drag tiles to reorder. Double-click any tile to preview at full size.
              </div>
              <ol className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {entries.map((entry, index) => (
                <li
                  key={entry.key}
                  draggable={!submitting}
                  onDragStart={(e) => {
                    if (submitting) return
                    setReorderDragKey(entry.key)
                    e.dataTransfer.effectAllowed = 'move'
                    try {
                      e.dataTransfer.setData('text/plain', entry.key)
                    } catch {
                      /* some browsers throw on certain drag types */
                    }
                  }}
                  onDragOver={(e) => {
                    if (!reorderDragKey) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (reorderOverKey !== entry.key) setReorderOverKey(entry.key)
                  }}
                  onDragLeave={() => {
                    if (reorderOverKey === entry.key) setReorderOverKey(null)
                  }}
                  onDrop={(e) => {
                    if (!reorderDragKey) return
                    e.preventDefault()
                    e.stopPropagation()
                    reorderTo(reorderDragKey, entry.key)
                    setReorderDragKey(null)
                    setReorderOverKey(null)
                  }}
                  onDragEnd={() => {
                    setReorderDragKey(null)
                    setReorderOverKey(null)
                  }}
                  className={
                    'group relative overflow-hidden rounded-md border bg-white shadow-sm transition dark:bg-white/5 ' +
                    (reorderOverKey === entry.key && reorderDragKey && reorderDragKey !== entry.key
                      ? 'border-brand-500 ring-2 ring-brand-400/50 '
                      : 'border-slate-200 dark:border-white/10 ') +
                    (reorderDragKey === entry.key ? 'opacity-50 ' : '') +
                    (submitting ? '' : 'cursor-grab active:cursor-grabbing')
                  }
                >
                  <img
                    src={entry.url}
                    alt={entry.file.name}
                    className="h-24 w-full cursor-zoom-in object-cover"
                    onDoubleClick={() => setPreviewKey(entry.key)}
                    title="Double-click to preview"
                  />
                  <div className="px-2 pb-1 pt-1 text-xs">
                    <div className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {index + 1}. {entry.file.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {(entry.file.size / 1024).toFixed(0)} KB
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="btn-secondary !px-2 !py-0.5 text-[11px]"
                        onClick={() => moveEntry(entry.key, -1)}
                        disabled={index === 0 || submitting}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-secondary !px-2 !py-0.5 text-[11px]"
                        onClick={() => moveEntry(entry.key, 1)}
                        disabled={index === entries.length - 1 || submitting}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-secondary !px-2 !py-0.5 text-[11px]"
                        onClick={() => removeEntry(entry.key)}
                        disabled={submitting}
                        aria-label={`Remove ${entry.file.name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              </ol>
            </>
          )}
        </div>

        <ThumbnailSlot
          kind="intro"
          title="Intro thumbnail"
          position="Inserted on slide 2"
          enabled={settings.intro_thumbnail_enabled ?? false}
          filename={settings.intro_thumbnail_filename ?? ''}
          durationSec={settings.intro_thumbnail_duration_sec}
          onEnabledChange={(v) => set('intro_thumbnail_enabled', v)}
          onFilenameChange={(v) => set('intro_thumbnail_filename', v)}
          onDurationChange={(v) => set('intro_thumbnail_duration_sec', v)}
        />
        <ThumbnailSlot
          kind="outro"
          title="Outro thumbnail"
          position="Inserted on the 2nd-to-last slide"
          enabled={settings.outro_thumbnail_enabled ?? false}
          filename={settings.outro_thumbnail_filename ?? ''}
          durationSec={settings.outro_thumbnail_duration_sec}
          onEnabledChange={(v) => set('outro_thumbnail_enabled', v)}
          onFilenameChange={(v) => set('outro_thumbnail_filename', v)}
          onDurationChange={(v) => set('outro_thumbnail_duration_sec', v)}
        />

        <div className="card grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="s2v-class">Class</label>
            <select
              id="s2v-class"
              className="input"
              value={settings.class_name ?? ''}
              onChange={(e) => set('class_name', e.target.value)}
            >
              {CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s2v-subject">Subject</label>
            <select
              id="s2v-subject"
              className="input"
              value={settings.subject ?? ''}
              onChange={(e) => set('subject', e.target.value)}
            >
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s2v-title">Chapter title</label>
            <input
              id="s2v-title"
              className="input"
              placeholder="e.g. Chapter 1 — सनीदेव वा सानी रानी"
              value={settings.title ?? ''}
              onChange={(e) => set('title', e.target.value)}
            />
            <div className="mt-1 text-[11px] text-muted">
              Used to compute the canonical
              <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-white/10">chapter_N</code>
              segment of the output filename.
            </div>
          </div>
        </div>

        <div className="card grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="s2v-output-format">Output</label>
            <select
              id="s2v-output-format"
              className="input"
              value={(settings.output_format as OutputFormat) ?? 'video'}
              onChange={(e) => set('output_format', e.target.value as OutputFormat)}
            >
              <option value="video">MP4 video</option>
              <option value="pptx">PPTX deck only</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s2v-resolution">Resolution</label>
            <select
              id="s2v-resolution"
              className="input"
              value={settings.resolution ?? '1080p'}
              onChange={(e) =>
                set('resolution', e.target.value as GenerateSettings['resolution'])
              }
              disabled={settings.output_format !== 'video'}
            >
              {RESOLUTION_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s2v-fps">Frame rate</label>
            <input
              id="s2v-fps"
              type="number"
              className="input"
              min={1}
              max={120}
              value={settings.fps ?? 30}
              onChange={(e) => set('fps', Number(e.target.value))}
              disabled={settings.output_format !== 'video'}
            />
          </div>
        </div>

        <div className="card grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="s2v-quality">Video quality (1–100)</label>
            <input
              id="s2v-quality"
              type="number"
              className="input"
              min={1}
              max={100}
              value={settings.video_quality ?? 85}
              onChange={(e) => set('video_quality', Number(e.target.value))}
              disabled={settings.output_format !== 'video'}
            />
          </div>
          <div>
            <label className="label" htmlFor="s2v-fixed-seconds">Seconds per slide</label>
            <input
              id="s2v-fixed-seconds"
              type="number"
              className="input"
              min={1}
              step={0.5}
              value={settings.fixed_seconds_per_screenshot_slide ?? 5}
              onChange={(e) =>
                set('fixed_seconds_per_screenshot_slide', Number(e.target.value))
              }
              disabled={Boolean(settings.auto_timing_screenshot_slides)}
            />
          </div>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(settings.auto_timing_screenshot_slides)}
                onChange={(e) => set('auto_timing_screenshot_slides', e.target.checked)}
              />
              Auto-pace slides for ≥500s total
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(settings.close_powerpoint_before_start)}
                onChange={(e) => set('close_powerpoint_before_start', e.target.checked)}
              />
              Close existing PowerPoint instances first
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(settings.concurrent_pipeline_runs)}
                onChange={(e) => set('concurrent_pipeline_runs', e.target.checked)}
              />
              Allow this run to overlap with other exports
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="btn-primary"
            disabled={entries.length === 0 || submitting}
          >
            <Play size={16} />
            {submitting ? 'Submitting…' : 'Start export'}
          </button>
          <span className="text-xs text-muted">
            Runs go through the same queue as Text → Video — track progress in the Processes tab.
          </span>
        </div>
      </form>

      {previewKey && (() => {
        const entry = entries.find((e) => e.key === previewKey)
        if (!entry) return null
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${entry.file.name}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setPreviewKey(null)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setPreviewKey(null)
              }}
              className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              aria-label="Close preview"
            >
              <X size={20} />
            </button>
            <div
              className="flex max-h-full max-w-full flex-col items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={entry.url}
                alt={entry.file.name}
                className="max-h-[85vh] max-w-[90vw] rounded-md object-contain shadow-2xl"
              />
              <div className="truncate text-sm text-white/90">{entry.file.name}</div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function ThumbnailSlot({
  kind,
  title,
  position,
  enabled,
  filename,
  durationSec,
  onEnabledChange,
  onFilenameChange,
  onDurationChange,
}: {
  kind: 'intro' | 'outro'
  title: string
  position: string
  enabled: boolean
  filename: string
  durationSec: number | undefined
  onEnabledChange: (v: boolean) => void
  onFilenameChange: (v: string) => void
  onDurationChange: (v: number) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const trimmed = filename.trim()

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadErr(null)
    try {
      const { filename: stored } = await api.uploadThumbnail(file)
      onFilenameChange(stored)
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-50">{title}</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{position}</div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      {enabled && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Image</label>
            <label
              className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300"
            >
              <Upload size={16} />
              {uploading ? 'Uploading…' : trimmed ? 'Replace image' : 'Upload image'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                className="hidden"
                onChange={onPickFile}
                disabled={uploading}
              />
            </label>
            {trimmed && (
              <div className="mt-2 flex items-center gap-3 rounded-md border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-white/[0.03]">
                <img
                  src={api.thumbnailUrl(trimmed)}
                  alt={`${title} preview`}
                  className="h-14 w-20 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                    {trimmed}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Stored on backend
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary !px-2 !py-1 text-xs"
                  onClick={() => onFilenameChange('')}
                >
                  Remove
                </button>
              </div>
            )}
            {uploadErr && (
              <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{uploadErr}</div>
            )}
          </div>

          <div>
            <label className="label" htmlFor={`s2v-${kind}-duration`}>
              Duration (seconds)
            </label>
            <input
              id={`s2v-${kind}-duration`}
              type="number"
              step={0.5}
              min={0.5}
              className="input"
              value={durationSec ?? ''}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isNaN(v)) onDurationChange(v)
              }}
            />
            <div className="mt-1 text-[11px] text-muted">
              How long this {kind === 'intro' ? 'intro' : 'outro'} thumbnail stays on screen.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
