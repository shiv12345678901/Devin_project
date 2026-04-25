import { Play, StopCircle, Upload } from 'lucide-react'
import { useState } from 'react'
import ProgressBar from '../components/ProgressBar'
import ScreenshotGallery from '../components/ScreenshotGallery'
import SettingsPanel from '../components/SettingsPanel'
import { useTrackedGenerate } from '../hooks/useTrackedGenerate'
import type { GenerateSettings } from '../api/types'

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
  const { state, generateFromImage, cancel } = useTrackedGenerate('image-to-video')
  const running = state.status === 'running'

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
    await generateFromImage(fd, { files: [file], settings })
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
          <label className="label">Source file</label>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-brand-500/60 dark:hover:bg-brand-900/20">
            <Upload size={28} className="text-slate-400" />
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {file ? (
                <span className="font-medium">{file.name}</span>
              ) : (
                <>
                  <span className="font-medium">Click to upload</span> PNG, JPG, or PDF
                </>
              )}
            </div>
            <input
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={running}
            />
          </label>
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
            <button type="button" className="btn-danger" onClick={cancel}>
              <StopCircle size={16} /> Cancel
            </button>
          )}
          {state.status === 'error' && (
            <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>
          )}
        </div>
      </form>

      {(running || state.status === 'success') && (
        <ProgressBar
          progress={state.progress}
          stage={state.stage}
          message={state.message}
          etaSeconds={state.etaSeconds}
        />
      )}

      {state.result && (
        <ScreenshotGallery
          files={state.result.screenshot_files}
          screenshotFolder={state.result.screenshot_folder}
        />
      )}
    </div>
  )
}
