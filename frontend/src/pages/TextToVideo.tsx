import { Play, StopCircle, Code2 } from 'lucide-react'
import { useState } from 'react'
import ProgressBar from '../components/ProgressBar'
import ScreenshotGallery from '../components/ScreenshotGallery'
import SettingsPanel from '../components/SettingsPanel'
import { useTrackedGenerate } from '../hooks/useTrackedGenerate'
import type { GenerateSettings } from '../api/types'

const defaultSettings: GenerateSettings = {
  zoom: 2.1,
  overlap: 15,
  viewport_width: 1920,
  viewport_height: 1080,
  max_screenshots: 50,
  use_cache: true,
  enable_verification: true,
  beautify_html: false,
  model_choice: 'default',
  system_prompt: '',
  // Images → MP4 defaults (Windows PowerPoint path)
  resolution: '1080p',
  video_quality: 85,
  fps: 30,
  slide_duration_sec: 3,
  close_powerpoint_before_start: true,
  auto_timing_screenshot_slides: true,
  fixed_seconds_per_screenshot_slide: 15,
  thumbnail_on_slide_2: false,
}

export default function TextToVideo() {
  const [text, setText] = useState('')
  const [outputName, setOutputName] = useState('')
  const [settings, setSettings] = useState<GenerateSettings>(defaultSettings)
  const { state, generate, cancel } = useTrackedGenerate('text-to-video')
  const running = state.status === 'running'

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    await generate(text, { ...settings, output_name: outputName.trim() || undefined })
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">Text to Video</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Paste text → AI generates HTML → Playwright captures screenshots. MP4 export is not
          wired in this build; browse the screenshots in Processes.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="card">
          <label className="label" htmlFor="input-text">
            Text Input
          </label>
          <textarea
            id="input-text"
            className="textarea h-60 resize-y font-mono"
            placeholder="Paste your lesson notes here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={running}
          />
          <div className="mt-2 text-xs text-slate-500">
            ~{Math.round(text.length / 4)} tokens · {text.length} characters
          </div>
        </div>

        <div className="card">
          <label className="label" htmlFor="output-name">
            Output Name
          </label>
          <input
            id="output-name"
            className="input"
            placeholder="Class 8 nepali chapter 1"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            disabled={running}
          />
        </div>

        <SettingsPanel value={settings} onChange={setSettings} />

        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <button type="submit" className="btn-primary" disabled={!text.trim()}>
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
          {state.status === 'cancelled' && (
            <span className="text-sm text-amber-600 dark:text-amber-400">Cancelled</span>
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

      {state.result && state.result.html_filename && (
        <div className="card flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Code2 size={16} />
            <span className="text-slate-700 dark:text-slate-300">Generated HTML:</span>
            <code className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs dark:border-white/10 dark:bg-white/[0.04]">
              {state.result.html_filename}
            </code>
          </div>
          <a
            className="btn-secondary"
            href={`/html/${encodeURIComponent(state.result.html_filename)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open HTML
          </a>
        </div>
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
