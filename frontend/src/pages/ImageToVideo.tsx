import { Play, StopCircle, Upload } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type React from 'react'
import BackendRejectedBanner from '../components/BackendRejectedBanner'
import RunErrorPanel from '../components/RunErrorPanel'
import { RunReviewPanel } from '../components/RunReviewPanel'
import { useTrackedGenerate } from '../hooks/useTrackedGenerate'
import type { GenerateSettings } from '../api/types'

const ACCEPTED_MIME = /^(image\/.+|application\/pdf)$/
const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const defaultSettings: GenerateSettings = {
  zoom: 2.1,
  overlap: 20,
  viewport_width: 1920,
  viewport_height: 1080,
  max_screenshots: 75,
}

export default function ImageToVideo() {
  const [file, setFile] = useState<File | null>(null)
  const [instructions, setInstructions] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [settings, setSettings] = useState<GenerateSettings>(defaultSettings)
  const [dragActive, setDragActive] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const { state, generateFromImage, cancel } = useTrackedGenerate('image-to-video')
  const running = state.status === 'running'
  const nav = useNavigate()

  // Drag-and-drop accepts a single image or PDF. The backend processes one
  // source per run, so multi-file drops are rejected with a visible message.
  const onDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    if (running) return
    e.preventDefault()
    setDragActive(true)
  }
  const onDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragActive(false)
  }
  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    if (running) return
    e.preventDefault()
    setDragActive(false)
    setDropError(null)
    const droppedFiles = Array.from(e.dataTransfer?.files ?? [])
    if (droppedFiles.length > 1) {
      setDropError('Drop one image or PDF at a time. This tool processes a single source per run.')
      return
    }
    const dropped = droppedFiles[0]
    if (!dropped) return
    if (!ACCEPTED_MIME.test(dropped.type) && !dropped.name.match(/\.(png|jpe?g|gif|webp|bmp|pdf)$/i)) {
      setDropError(`Unsupported file type: ${dropped.type || dropped.name}. Drop an image or PDF.`)
      return
    }
    setFile(dropped)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    const cleanSettings: GenerateSettings = {
      ...settings,
      zoom: clampNumber(settings.zoom, 2.1, 0.1, 5),
      overlap: clampNumber(settings.overlap, 20, 0, 500),
      viewport_width: clampNumber(settings.viewport_width, 1920, 320, 7680),
      viewport_height: clampNumber(settings.viewport_height, 1080, 240, 4320),
      max_screenshots: Math.round(clampNumber(settings.max_screenshots, 75, 1, 500)),
    }
    const fd = new FormData()
    fd.append('image', file)
    fd.append('instructions', instructions)
    if (systemPrompt) fd.append('system_prompt', systemPrompt)
    fd.append('zoom', String(cleanSettings.zoom))
    fd.append('overlap', String(cleanSettings.overlap))
    fd.append('viewport_width', String(cleanSettings.viewport_width))
    fd.append('viewport_height', String(cleanSettings.viewport_height))
    fd.append('max_screenshots', String(cleanSettings.max_screenshots))
    const { queueId } = generateFromImage(fd, { files: [file], settings: cleanSettings })
    nav(`/processes?queue=${encodeURIComponent(queueId)}`)
  }

  return (
    <div className="container-workbench space-y-6">
      <div>
        <div className="eyebrow">
          <span className="h-1 w-1 rounded-full bg-brand-500" />
          Tool · Image → Screenshots
        </div>
        <h1 className="h-page mt-2">Image / PDF to Screenshots</h1>
        <p className="mt-2 text-sm text-muted">
          Upload a screenshot, photo, or PDF. Vision AI extracts text, formats it as HTML, and
          captures screenshots for the Library.
        </p>
      </div>

      <div className="workbench-grid">
      <form onSubmit={onSubmit} className="min-w-0 space-y-4">
        <div className="card">
          <label className="label" htmlFor="image-file-input">Source file</label>
          <label
            htmlFor="image-file-input"
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
              {file ? (
                <span className="font-medium">{file.name}</span>
              ) : dragActive ? (
                <span className="font-medium text-brand-700 dark:text-brand-200">Drop to upload</span>
              ) : (
                <>
                  <span className="font-medium">Click to upload</span> or drag-and-drop · PNG, JPG, or PDF
                </>
              )}
            </div>
            <input
              id="image-file-input"
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                if (picked.length > 1) {
                  setDropError('Pick one image or PDF at a time. This tool processes a single source per run.')
                  setFile(null)
                  return
                }
                setFile(picked[0] ?? null)
                setDropError(null)
              }}
              disabled={running}
            />
          </label>
          {dropError && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{dropError}</p>
          )}
        </div>

        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="instructions">
              Extraction instructions (optional)
            </label>
            <textarea
              id="instructions"
              className="textarea h-20 resize-y"
              placeholder="e.g., Extract only the code blocks, preserve order…"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={running}
            />
          </div>
          <div>
            <label className="label" htmlFor="system-prompt">
              Custom HTML system prompt (optional)
            </label>
            <textarea
              id="system-prompt"
              className="textarea h-20 resize-y"
              placeholder="Override the default HTML formatting prompt…"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={running}
            />
          </div>
        </div>

        <div className="card space-y-4">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Capture settings
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Zoom" htmlFor="img-zoom">
              <input
                id="img-zoom"
                type="number"
                step="0.1"
                min={0.1}
                max={5}
                className="input"
                value={settings.zoom ?? 2.1}
                onChange={(e) => setSettings({ ...settings, zoom: clampNumber(e.target.value, 2.1, 0.1, 5) })}
                disabled={running}
              />
            </Field>
            <Field label="Overlap (px)" htmlFor="img-overlap">
              <input
                id="img-overlap"
                type="number"
                min={0}
                max={500}
                className="input"
                value={settings.overlap ?? 20}
                onChange={(e) => setSettings({ ...settings, overlap: clampNumber(e.target.value, 20, 0, 500) })}
                disabled={running}
              />
            </Field>
            <Field label="Max screenshots" htmlFor="img-max">
              <input
                id="img-max"
                type="number"
                min={1}
                max={500}
                className="input"
                value={settings.max_screenshots ?? 75}
                onChange={(e) =>
                  setSettings({ ...settings, max_screenshots: Math.round(clampNumber(e.target.value, 75, 1, 500)) })
                }
                disabled={running}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Viewport width" htmlFor="img-vw">
              <input
                id="img-vw"
                type="number"
                min={320}
                max={7680}
                className="input"
                value={settings.viewport_width ?? 1920}
                onChange={(e) =>
                  setSettings({ ...settings, viewport_width: clampNumber(e.target.value, 1920, 320, 7680) })
                }
                disabled={running}
              />
            </Field>
            <Field label="Viewport height" htmlFor="img-vh">
              <input
                id="img-vh"
                type="number"
                min={240}
                max={4320}
                className="input"
                value={settings.viewport_height ?? 1080}
                onChange={(e) =>
                  setSettings({ ...settings, viewport_height: clampNumber(e.target.value, 1080, 240, 4320) })
                }
                disabled={running}
              />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <button type="submit" className="btn-primary" disabled={!file}>
              <Play size={16} /> Generate screenshots
            </button>
          ) : (
            <button type="button" className="btn-danger" onClick={() => cancel()}>
              <StopCircle size={16} /> Cancel
            </button>
          )}
        </div>
        {state.status === 'error' && !state.rejectedReason && (
          <RunErrorPanel
            title="Image/PDF extraction failed"
            message={state.error ?? 'The backend could not generate screenshots.'}
            onRetry={() => {
              const form = document.querySelector('form')
              form?.requestSubmit()
            }}
          />
        )}
        {state.status === 'error' && state.rejectedReason && (
          <BackendRejectedBanner
            reason={state.rejectedReason}
            message={state.error ?? 'Backend rejected the run.'}
          />
        )}
      </form>
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <RunReviewPanel
          title="Review before start"
          source={[
            { label: 'File', value: file?.name ?? 'No file selected' },
            { label: 'Type', value: file?.type || 'Image or PDF' },
          ]}
          output={[
            { label: 'Type', value: 'HTML + screenshots' },
            { label: 'Limit', value: `${settings.max_screenshots ?? 75} screenshots` },
          ]}
          settings={[
            { label: 'Viewport', value: `${settings.viewport_width ?? 1920} x ${settings.viewport_height ?? 1080}` },
            { label: 'Zoom', value: `${settings.zoom ?? 2.1}x` },
            { label: 'Overlap', value: `${settings.overlap ?? 20}px` },
          ]}
          dependencies={[
            { label: 'Vision AI', value: 'Required' },
            { label: 'Browser capture', value: 'Required' },
          ]}
          destination="output/html and output/screenshots"
          estimate="Usually 1-3 minutes depending on source size"
          onStart={() => {
            const form = document.querySelector('form')
            form?.requestSubmit()
          }}
          disabled={!file || running}
          busy={running}
          startLabel="Generate screenshots"
        />
      </aside>
      </div>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  )
}
