import { ChevronDown, ChevronUp, Image as ImageIcon, Settings, Video } from 'lucide-react'
import { useState } from 'react'
import type { GenerateSettings } from '../api/types'
import Toggle from './Toggle'

interface Props {
  value: GenerateSettings
  onChange: (v: GenerateSettings) => void
  /** Show the "Text to Images" section. */
  showTextToImages?: boolean
  /** Show the "Images to Video" section (PowerPoint / MP4 export). */
  showImagesToVideo?: boolean
  /** Shortcut: hide AI-specific fields (cache / verification / beautify / system prompt / model). */
  showAdvanced?: boolean
}

export default function SettingsPanel({
  value,
  onChange,
  showTextToImages = true,
  showImagesToVideo = false,
  showAdvanced = true,
}: Props) {
  const set = <K extends keyof GenerateSettings>(key: K, v: GenerateSettings[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <div className="space-y-4">
      {showTextToImages && (
        <Section title="Text to Images Settings" icon={Settings} defaultOpen>
          <div className="space-y-4">
            {showAdvanced && (
              <div>
                <label className="label">AI Model</label>
                <select
                  className="input"
                  value={value.model_choice ?? 'default'}
                  onChange={(e) => set('model_choice', e.target.value)}
                >
                  <option value="default">Default Model (highest quality)</option>
                  <option value="fast">Fast (lower latency, smaller model)</option>
                  <option value="quality">Quality (deterministic, highest tokens)</option>
                </select>
              </div>
            )}

            {showAdvanced && (
              <div>
                <label className="label">System Prompt (optional)</label>
                <textarea
                  className="textarea h-24 resize-y"
                  placeholder="Optional: extra instructions for HTML generation…"
                  value={value.system_prompt ?? ''}
                  onChange={(e) => set('system_prompt', e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Zoom">
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={value.zoom ?? 2.1}
                  onChange={(e) => set('zoom', Number(e.target.value))}
                />
              </Field>
              <Field label="Overlap (px)">
                <input
                  type="number"
                  className="input"
                  value={value.overlap ?? 15}
                  onChange={(e) => set('overlap', Number(e.target.value))}
                />
              </Field>
              <Field label="Max Screenshots">
                <input
                  type="number"
                  className="input"
                  value={value.max_screenshots ?? 50}
                  onChange={(e) => set('max_screenshots', Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Viewport Width">
                <input
                  type="number"
                  className="input"
                  value={value.viewport_width ?? 1920}
                  onChange={(e) => set('viewport_width', Number(e.target.value))}
                />
              </Field>
              <Field label="Viewport Height">
                <input
                  type="number"
                  className="input"
                  value={value.viewport_height ?? 1080}
                  onChange={(e) => set('viewport_height', Number(e.target.value))}
                />
              </Field>
            </div>

            {showAdvanced && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Toggle
                  label="Use Cache"
                  description="Reuse AI output if the same input was generated before"
                  checked={value.use_cache ?? true}
                  onChange={(v) => set('use_cache', v)}
                />
                <Toggle
                  label="Beautify HTML"
                  description="Normalize AI HTML for cleaner screenshots"
                  checked={value.beautify_html ?? false}
                  onChange={(v) => set('beautify_html', v)}
                />
                <Toggle
                  label="Verify AI Output"
                  description="Up to 3 verification + revision passes"
                  checked={value.enable_verification ?? true}
                  onChange={(v) => set('enable_verification', v)}
                />
              </div>
            )}
          </div>
        </Section>
      )}

      {showImagesToVideo && (
        <Section title="Images to Video Settings" icon={Video} defaultOpen>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Resolution">
                <select
                  className="input"
                  value={value.resolution ?? '1080p'}
                  onChange={(e) => set('resolution', e.target.value as GenerateSettings['resolution'])}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="1440p">1440p</option>
                  <option value="4k">4K</option>
                </select>
              </Field>
              <Field label="Video Quality">
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input"
                  value={value.video_quality ?? 85}
                  onChange={(e) => set('video_quality', Number(e.target.value))}
                />
              </Field>
              <Field label="FPS">
                <input
                  type="number"
                  className="input"
                  value={value.fps ?? 30}
                  onChange={(e) => set('fps', Number(e.target.value))}
                />
              </Field>
              <Field label="Default Slide Duration (sec)">
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={value.slide_duration_sec ?? 3}
                  onChange={(e) => set('slide_duration_sec', Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Toggle
                label="Close PowerPoint Before Start"
                description="Avoid export conflicts if PowerPoint is already open"
                checked={value.close_powerpoint_before_start ?? true}
                onChange={(v) => set('close_powerpoint_before_start', v)}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
                <Toggle
                  label="Auto Timing for Screenshot Slides"
                  description="Distribute total seconds across inserted screenshot slides"
                  checked={value.auto_timing_screenshot_slides ?? true}
                  onChange={(v) => set('auto_timing_screenshot_slides', v)}
                />
                <Field label="Fixed Seconds Per Screenshot Slide">
                  <input
                    type="number"
                    className="input"
                    value={value.fixed_seconds_per_screenshot_slide ?? 15}
                    onChange={(e) =>
                      set('fixed_seconds_per_screenshot_slide', Number(e.target.value))
                    }
                    disabled={value.auto_timing_screenshot_slides ?? true}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr,auto] sm:items-center">
                <Toggle
                  label="Include thumbnail slide"
                  description="Insert a dedicated thumbnail slide in the generated deck"
                  checked={value.thumbnail_enabled ?? false}
                  onChange={(v) => set('thumbnail_enabled', v)}
                />
                {value.thumbnail_enabled && (
                  <input
                    type="file"
                    accept="image/*"
                    className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-800 hover:file:bg-slate-50 dark:text-slate-300 dark:file:border-white/10 dark:file:bg-white/[0.04] dark:file:text-slate-100"
                    onChange={(e) => set('thumbnail_filename', e.target.files?.[0]?.name ?? '')}
                  />
                )}
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              <ImageIcon size={12} className="mr-1 inline" />
              Video export uses PowerPoint automation — Windows only. On other OSes these
              settings are stored with the run but no MP4 is produced.
            </p>
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: typeof Settings
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card !p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Icon size={16} /> {title}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div className="border-t border-slate-200 px-5 py-4 dark:border-white/10">{children}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}


