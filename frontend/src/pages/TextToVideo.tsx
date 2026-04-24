import { Play, StopCircle, Code2 } from 'lucide-react'
import { useState } from 'react'
import ProgressBar from '../components/ProgressBar'
import ScreenshotGallery from '../components/ScreenshotGallery'
import SettingsPanel from '../components/SettingsPanel'
import { useGenerate } from '../hooks/useGenerate'
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
}

export default function TextToVideo() {
  const [text, setText] = useState('')
  const [settings, setSettings] = useState<GenerateSettings>(defaultSettings)
  const { state, generate, cancel } = useGenerate()
  const running = state.status === 'running'

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    await generate(text, settings)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Text to Video</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Paste any text. The AI converts it into formatted HTML, captures it as screenshots, and
          you can string those together as a video presentation.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="card">
          <label className="label" htmlFor="input-text">
            Input text
          </label>
          <textarea
            id="input-text"
            className="input h-60 resize-y font-mono"
            placeholder="Paste the text you want to turn into a video…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={running}
          />
          <div className="mt-2 text-xs text-slate-500">
            ~{Math.round(text.length / 4)} tokens · {text.length} characters
          </div>
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
            <code className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
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
