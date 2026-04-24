import { ChevronDown, ChevronUp, Settings } from 'lucide-react'
import { useState } from 'react'
import type { GenerateSettings } from '../api/types'

interface Props {
  value: GenerateSettings
  onChange: (v: GenerateSettings) => void
  showAdvanced?: boolean
}

export default function SettingsPanel({ value, onChange, showAdvanced = true }: Props) {
  const [open, setOpen] = useState(false)
  const set = <K extends keyof GenerateSettings>(key: K, v: GenerateSettings[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Settings size={16} /> Generation settings
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Viewport width (px)</label>
            <input
              type="number"
              className="input"
              value={value.viewport_width ?? 1920}
              onChange={(e) => set('viewport_width', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Viewport height (px)</label>
            <input
              type="number"
              className="input"
              value={value.viewport_height ?? 1080}
              onChange={(e) => set('viewport_height', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Zoom</label>
            <input
              type="number"
              step="0.1"
              className="input"
              value={value.zoom ?? 2.1}
              onChange={(e) => set('zoom', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Overlap (px)</label>
            <input
              type="number"
              className="input"
              value={value.overlap ?? 15}
              onChange={(e) => set('overlap', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Max screenshots</label>
            <input
              type="number"
              className="input"
              value={value.max_screenshots ?? 50}
              onChange={(e) => set('max_screenshots', Number(e.target.value))}
            />
          </div>
          {showAdvanced && (
            <div>
              <label className="label">Model choice</label>
              <select
                className="input"
                value={value.model_choice ?? 'default'}
                onChange={(e) => set('model_choice', e.target.value)}
              >
                <option value="default">Default</option>
                <option value="fast">Fast</option>
                <option value="quality">Quality</option>
              </select>
            </div>
          )}

          {showAdvanced && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="use_cache"
                type="checkbox"
                className="h-4 w-4"
                checked={value.use_cache ?? true}
                onChange={(e) => set('use_cache', e.target.checked)}
              />
              <label htmlFor="use_cache" className="text-sm text-slate-700 dark:text-slate-300">
                Use AI response cache
              </label>
            </div>
          )}
          {showAdvanced && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="verify"
                type="checkbox"
                className="h-4 w-4"
                checked={value.enable_verification ?? true}
                onChange={(e) => set('enable_verification', e.target.checked)}
              />
              <label htmlFor="verify" className="text-sm text-slate-700 dark:text-slate-300">
                Verify AI output (up to 3 revision passes)
              </label>
            </div>
          )}
          {showAdvanced && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="beautify"
                type="checkbox"
                className="h-4 w-4"
                checked={value.beautify_html ?? false}
                onChange={(e) => set('beautify_html', e.target.checked)}
              />
              <label htmlFor="beautify" className="text-sm text-slate-700 dark:text-slate-300">
                Beautify generated HTML
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
