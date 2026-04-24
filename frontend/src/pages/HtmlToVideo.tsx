import { Play, Sparkles, Minimize2 } from 'lucide-react'
import { useState } from 'react'
import ProgressBar from '../components/ProgressBar'
import ScreenshotGallery from '../components/ScreenshotGallery'
import SettingsPanel from '../components/SettingsPanel'
import { api } from '../api/client'
import { useGenerate } from '../hooks/useGenerate'
import type { GenerateSettings } from '../api/types'

const defaultSettings: GenerateSettings = {
  zoom: 2.1,
  overlap: 15,
  viewport_width: 1920,
  viewport_height: 1080,
  max_screenshots: 50,
}

export default function HtmlToVideo() {
  const [html, setHtml] = useState('')
  const [settings, setSettings] = useState<GenerateSettings>(defaultSettings)
  const { state, generateFromHtml } = useGenerate()
  const running = state.status === 'running'

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!html.trim()) return
    await generateFromHtml(html, settings)
  }

  const beautify = async () => {
    try {
      const { html: pretty } = await api.beautify(html)
      setHtml(pretty)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const minify = async () => {
    try {
      const { html: mini } = await api.minify(html)
      setHtml(mini)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const onFile = async (file: File) => {
    const text = await file.text()
    setHtml(text)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">HTML to Video</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Paste HTML directly — skip the AI step and render it to screenshots.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="label mb-0" htmlFor="html-input">
              HTML
            </label>
            <div className="flex gap-2">
              <label className="btn-secondary cursor-pointer">
                Upload .html
                <input
                  type="file"
                  accept=".html,text/html"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onFile(f)
                  }}
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                onClick={beautify}
                disabled={!html.trim()}
              >
                <Sparkles size={14} /> Beautify
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={minify}
                disabled={!html.trim()}
              >
                <Minimize2 size={14} /> Minify
              </button>
            </div>
          </div>
          <textarea
            id="html-input"
            className="input h-96 resize-y font-mono text-xs"
            placeholder="<!DOCTYPE html>..."
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            disabled={running}
          />
          <div className="mt-1 text-xs text-slate-500">{html.length} characters</div>
        </div>

        <SettingsPanel value={settings} onChange={setSettings} showAdvanced={false} />

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={!html.trim() || running}>
            <Play size={16} /> Generate screenshots
          </button>
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
