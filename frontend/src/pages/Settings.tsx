import { useState } from 'react'
import {
  AlertCircle,
  Check,
  Monitor,
  Moon,
  Paintbrush,
  RotateCcw,
  Server,
  Sun,
  Trash2,
} from 'lucide-react'

import { api } from '../api/client'
import { useRuns } from '../store/runs'
import { BRAND_SWATCHES, useSettings, type ThemeMode } from '../store/settings'

export default function Settings() {
  const { settings, update, reset } = useSettings()
  const { clear, runs } = useRuns()
  const [pingState, setPingState] = useState<'idle' | 'pinging' | 'ok' | 'error'>('idle')
  const [pingError, setPingError] = useState('')

  const pingBackend = async () => {
    setPingState('pinging')
    setPingError('')
    try {
      await api.preflight()
      setPingState('ok')
    } catch (e) {
      setPingState('error')
      setPingError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Settings
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Appearance, defaults, and backend connection. All changes persist
            to this browser.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={reset}>
          <RotateCcw size={14} /> Reset to defaults
        </button>
      </div>

      {/* ─── Appearance ─────────────────────────────────────────────────── */}
      <Section title="Appearance" icon={<Paintbrush size={16} />}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="label">Theme</div>
            <div className="flex gap-2">
              {(
                [
                  { id: 'light', label: 'Light', icon: Sun },
                  { id: 'dark', label: 'Dark', icon: Moon },
                  { id: 'system', label: 'System', icon: Monitor },
                ] as const
              ).map((t) => {
                const active = settings.theme === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => update({ theme: t.id as ThemeMode })}
                    className={
                      'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' +
                      (active
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-200'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06]')
                    }
                  >
                    <t.icon size={14} />
                    {t.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
      </Section>

      {/* ─── Backend ────────────────────────────────────────────────────── */}
      <Section title="Backend" icon={<Server size={16} />}>
        <div>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <div className="font-medium text-slate-800 dark:text-slate-100">
              Clear local run history
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Removes all {runs.length} entries from the Processes tab. Server
              files are not touched.
            </div>
          </div>
          <button
            type="button"
            className="btn-danger"
            disabled={runs.length === 0}
            onClick={() => {
              if (confirm(`Remove all ${runs.length} local run entries?`)) clear()
            }}
          >
            <Trash2 size={14} /> Clear history
          </button>
        </div>
      </Section>
    </div>
  )
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
