import { Play, StopCircle, Upload } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type React from 'react'
import SettingsPanel from '../components/SettingsPanel'
import BackendRejectedBanner from '../components/BackendRejectedBanner'
import { useTrackedGenerate } from '../hooks/useTrackedGenerate'
import type { GenerateSettings } from '../api/types'

const ACCEPTED_MIME = /^(image\/.+|application\/pdf)$/

const defaultSettings: GenerateSettings = {
  zoom: 2.1,
  overlap: 20,
  viewport_width: 1920,
  viewport_height: 1080,
  max_screenshots: 50,
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

  // Drag-and-drop — accepts the first dropped file that matches an image
  // or a PDF. Mirrors the accept="image/*,application/pdf" rule on the
  // <input>. We deliberately ignore drops of multiple files; the backend
  // only processes a single source per run.
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
    const dropped = e.dataTransfer?.files?.[0]
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
    const fd = new FormData()
    fd.append('image', file)
    fd.append('instructions', instructions)
    if (systemPrompt) fd.append('system_prompt', systemPrompt)
    fd.append('zoom', String(settings.zoom ?? 2.1))
    fd.append('overlap', String(settings.overlap ?? 20))
    fd.append('viewport_width', String(settings.viewport_width ?? 1920))
    fd.append('viewport_height', String(settings.viewport_height ?? 1080))
    fd.append('max_screenshots', String(settings.max_screenshots ?? 50))
    const { queueId } = generateFromImage(fd, { files: [file], settings })
    nav(`/processes?queue=${encodeURIComponent(queueId)}`)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">
          Image / PDF to Video
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Upload a screenshot, photo, or PDF. Vision AI extracts text, formats it as HTML, and
          captures screenshots.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
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
                setFile(e.target.files?.[0] ?? null)
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

        <SettingsPanel value={settings} onChange={setSettings} showAdvanced={false} />

        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <button type="submit" className="btn-primary" disabled={!file}>
              <Play size={16} /> Generate
            </button>
          ) : (
            <button type="button" className="btn-danger" onClick={() => cancel()}>
              <StopCircle size={16} /> Cancel
            </button>
          )}
          {state.status === 'error' && !state.rejectedReason && (
            <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>
          )}
        </div>
        {state.status === 'error' && state.rejectedReason && (
          <BackendRejectedBanner
            reason={state.rejectedReason}
            message={state.error ?? 'Backend rejected the run.'}
          />
        )}
      </form>

    </div>
  )
}
