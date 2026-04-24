import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Image as ImageIcon,
  Play,
  Presentation,
  StopCircle,
  Video,
} from 'lucide-react'
import PreflightModal from '../components/PreflightModal'
import ProgressBar from '../components/ProgressBar'
import ScreenshotGallery from '../components/ScreenshotGallery'
import Toggle from '../components/Toggle'
import { useTrackedGenerate } from '../hooks/useTrackedGenerate'
import type { GenerateSettings, OutputFormat } from '../api/types'

/**
 * Text-to-Video wizard. Six ordered steps that gather every parameter the
 * backend and the optional PowerPoint export path can consume, with a
 * pre-flight modal before kickoff. Tabs are keyboard-navigable (Back/Next
 * buttons + clickable headers) and the Start Process button is only
 * rendered on the final tab once all required fields are set.
 */

const DEFAULT_SETTINGS: GenerateSettings = {
  class_name: '',
  subject: '',
  title: '',
  output_format: 'images',
  model_choice: 'default',
  system_prompt: '',
  zoom: 2.1,
  overlap: 15,
  viewport_width: 1920,
  viewport_height: 1080,
  max_screenshots: 50,
  use_cache: true,
  enable_verification: true,
  beautify_html: false,
  resolution: '1080p',
  video_quality: 85,
  fps: 30,
  slide_duration_sec: 3,
  close_powerpoint_before_start: true,
  auto_timing_screenshot_slides: true,
  fixed_seconds_per_screenshot_slide: 15,
  thumbnail_on_slide_2: false,
  thumbnail_filename: '',
}

type StepId = 'project' | 'content' | 'screenshot' | 'video' | 'thumbnail' | 'advanced'

interface StepDef {
  id: StepId
  label: string
  shortLabel: string
  hiddenFor?: OutputFormat[]
}

const STEP_DEFS: StepDef[] = [
  { id: 'project', label: 'Project info', shortLabel: 'Project' },
  { id: 'content', label: 'AI & text', shortLabel: 'Content' },
  { id: 'screenshot', label: 'Screenshot settings', shortLabel: 'Screenshots' },
  { id: 'video', label: 'Video settings', shortLabel: 'Video', hiddenFor: ['html', 'images'] },
  { id: 'thumbnail', label: 'Thumbnail', shortLabel: 'Thumbnail', hiddenFor: ['html', 'images'] },
  { id: 'advanced', label: 'Advanced & start', shortLabel: 'Advanced' },
]

const OUTPUT_OPTIONS: { value: OutputFormat; label: string; desc: string; icon: typeof FileText }[] = [
  { value: 'html', label: 'HTML file', desc: 'Raw AI-generated HTML only', icon: FileText },
  { value: 'images', label: 'Screenshots', desc: 'HTML rendered to PNG images (default)', icon: ImageIcon },
  { value: 'pptx', label: 'PowerPoint', desc: 'Images packed into a .pptx (Windows only)', icon: Presentation },
  { value: 'video', label: 'MP4 video', desc: 'PowerPoint exported to MP4 (Windows only)', icon: Video },
]

export default function TextToVideo() {
  const nav = useNavigate()
  const { state, generate, cancel } = useTrackedGenerate('text-to-video')
  const running = state.status === 'running'
  const [text, setText] = useState('')
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [stepId, setStepId] = useState<StepId>('project')
  const [showPreflight, setShowPreflight] = useState(false)

  const set = <K extends keyof GenerateSettings>(key: K, v: GenerateSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: v }))

  const visibleSteps = useMemo(
    () => STEP_DEFS.filter((s) => !s.hiddenFor?.includes(settings.output_format ?? 'images')),
    [settings.output_format],
  )
  // If the user toggled output_format and the current step got hidden, fall
  // back to the project step. Compute the fallback here (not in an effect)
  // so React doesn't need to re-render twice.
  const activeStepId: StepId = visibleSteps.some((s) => s.id === stepId) ? stepId : 'project'
  const stepIndex = Math.max(0, visibleSteps.findIndex((s) => s.id === activeStepId))

  const projectOk = Boolean(
    (settings.class_name ?? '').trim() &&
      (settings.subject ?? '').trim() &&
      (settings.title ?? '').trim(),
  )
  const contentOk = text.trim().length > 0
  const canFinish = projectOk && contentOk

  // Redirect to Processes as soon as the backend accepts the request and we
  // have an operation_id. The existing state machine keeps streaming there.
  useEffect(() => {
    if (state.status === 'running' && state.operationId) {
      nav(`/processes?op=${encodeURIComponent(state.operationId)}`, { replace: true })
    }
  }, [state.status, state.operationId, nav])

  const onStart = () => {
    if (!canFinish) return
    setShowPreflight(true)
  }

  const onPreflightProceed = async () => {
    setShowPreflight(false)
    const payload: GenerateSettings = { ...settings }
    // Trim whitespace in metadata so the history log is clean.
    payload.class_name = (payload.class_name ?? '').trim() || undefined
    payload.subject = (payload.subject ?? '').trim() || undefined
    payload.title = (payload.title ?? '').trim() || undefined
    await generate(text, payload)
  }

  const goNext = () => {
    const i = visibleSteps.findIndex((s) => s.id === activeStepId)
    if (i >= 0 && i < visibleSteps.length - 1) setStepId(visibleSteps[i + 1].id)
  }
  const goPrev = () => {
    const i = visibleSteps.findIndex((s) => s.id === activeStepId)
    if (i > 0) setStepId(visibleSteps[i - 1].id)
  }

  const canGoNext =
    (activeStepId === 'project' && projectOk) ||
    (activeStepId === 'content' && contentOk) ||
    (activeStepId !== 'project' && activeStepId !== 'content')

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">Text to Video</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Step through the wizard to configure the run. Nothing starts until you hit{' '}
          <span className="font-medium">Start Process</span> on the last step.
        </p>
      </div>

      <Tabs steps={visibleSteps} currentIndex={stepIndex} onPick={(id) => setStepId(id)} />

      <div className="card space-y-6">
        {activeStepId === 'project' && (
          <ProjectStep settings={settings} onChange={set} running={running} />
        )}

        {activeStepId === 'content' && (
          <ContentStep
            text={text}
            onText={setText}
            settings={settings}
            onChange={set}
            running={running}
          />
        )}

        {activeStepId === 'screenshot' && <ScreenshotStep settings={settings} onChange={set} />}

        {activeStepId === 'video' && <VideoStep settings={settings} onChange={set} />}

        {activeStepId === 'thumbnail' && <ThumbnailStep settings={settings} onChange={set} />}

        {activeStepId === 'advanced' && (
          <AdvancedStep
            settings={settings}
            onChange={set}
            canFinish={canFinish}
            onStart={onStart}
            running={running}
            state={state}
            cancel={cancel}
          />
        )}
      </div>

      {/* Back / Next */}
      {activeStepId !== 'advanced' && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="btn-secondary"
            onClick={goPrev}
            disabled={stepIndex === 0 || running}
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={goNext}
            disabled={!canGoNext || running}
          >
            Next <ArrowRight size={14} />
          </button>
        </div>
      )}
      {activeStepId === 'advanced' && (
        <div>
          <button
            type="button"
            className="btn-secondary"
            onClick={goPrev}
            disabled={running}
          >
            <ArrowLeft size={14} /> Back
          </button>
        </div>
      )}

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

      {showPreflight && (
        <PreflightModal
          outputFormat={settings.output_format ?? 'images'}
          onCancel={() => setShowPreflight(false)}
          onProceed={onPreflightProceed}
        />
      )}
    </div>
  )
}

// ─── Tabs ──────────────────────────────────────────────────────────────────

function Tabs({
  steps,
  currentIndex,
  onPick,
}: {
  steps: StepDef[]
  currentIndex: number
  onPick: (id: StepId) => void
}) {
  return (
    <ol className="flex w-full flex-wrap items-center gap-1">
      {steps.map((s, i) => {
        const active = i === currentIndex
        const done = i < currentIndex
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => onPick(s.id)}
              className={
                'flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ' +
                (active
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-200'
                  : done
                  ? 'border-brand-200 bg-brand-50/60 text-brand-600 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-slate-100')
              }
            >
              <span
                className={
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ' +
                  (active
                    ? 'bg-brand-500 text-white'
                    : done
                    ? 'bg-brand-500/80 text-white'
                    : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300')
                }
              >
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className="truncate">{s.shortLabel}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ─── Step bodies ───────────────────────────────────────────────────────────

type Setter = <K extends keyof GenerateSettings>(k: K, v: GenerateSettings[K]) => void

function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
      )}
    </div>
  )
}

function ProjectStep({
  settings,
  onChange,
  running,
}: {
  settings: GenerateSettings
  onChange: Setter
  running: boolean
}) {
  return (
    <>
      <StepHeader
        title="Project info"
        subtitle="Metadata for this run — used as the output folder/file prefix and shown in Processes."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class name" required>
          <input
            className="input"
            placeholder="Class 8"
            value={settings.class_name ?? ''}
            onChange={(e) => onChange('class_name', e.target.value)}
            disabled={running}
          />
        </Field>
        <Field label="Subject" required>
          <input
            className="input"
            placeholder="Nepali"
            value={settings.subject ?? ''}
            onChange={(e) => onChange('subject', e.target.value)}
            disabled={running}
          />
        </Field>
        <Field label="Title" required className="sm:col-span-2">
          <input
            className="input"
            placeholder="Chapter 1 — Introduction"
            value={settings.title ?? ''}
            onChange={(e) => onChange('title', e.target.value)}
            disabled={running}
          />
        </Field>
      </div>

      <div>
        <div className="label">Output format</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {OUTPUT_OPTIONS.map((o) => {
            const Icon = o.icon
            const active = settings.output_format === o.value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange('output_format', o.value)}
                disabled={running}
                className={
                  'flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors ' +
                  (active
                    ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03]')
                }
              >
                <Icon
                  size={18}
                  className={active ? 'mt-0.5 text-brand-600' : 'mt-0.5 text-slate-400'}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-50">
                    {o.label}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {o.desc}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        {(settings.output_format === 'pptx' || settings.output_format === 'video') && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Heads up: PowerPoint / MP4 export needs a Windows host with PowerPoint installed — the
            preflight check will verify this before the run starts.
          </p>
        )}
      </div>
    </>
  )
}

function ContentStep({
  text,
  onText,
  settings,
  onChange,
  running,
}: {
  text: string
  onText: (s: string) => void
  settings: GenerateSettings
  onChange: Setter
  running: boolean
}) {
  return (
    <>
      <StepHeader
        title="AI & text"
        subtitle="Pick the model, paste the source text, and (optionally) override the system prompt."
      />

      <Field label="AI Model">
        <select
          className="input"
          value={settings.model_choice ?? 'default'}
          onChange={(e) => onChange('model_choice', e.target.value)}
          disabled={running}
        >
          <option value="default">Default Model (highest quality)</option>
          <option value="fast">Fast (lower latency)</option>
          <option value="quality">Quality (deterministic, highest tokens)</option>
        </select>
      </Field>

      <Field label="Text input" required>
        <textarea
          className="textarea h-60 resize-y font-mono"
          placeholder="Paste your lesson notes here…"
          value={text}
          onChange={(e) => onText(e.target.value)}
          disabled={running}
        />
        <div className="mt-1 text-xs text-slate-500">
          ~{Math.round(text.length / 4)} tokens · {text.length} characters
        </div>
      </Field>

      <Field label="System prompt (optional)">
        <textarea
          className="textarea h-24 resize-y"
          placeholder="Optional extra instructions for HTML generation…"
          value={settings.system_prompt ?? ''}
          onChange={(e) => onChange('system_prompt', e.target.value)}
          disabled={running}
        />
      </Field>
    </>
  )
}

function ScreenshotStep({
  settings,
  onChange,
}: {
  settings: GenerateSettings
  onChange: Setter
}) {
  return (
    <>
      <StepHeader
        title="Screenshot settings"
        subtitle="How Playwright captures the rendered HTML."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <NumField label="Zoom" step={0.1} value={settings.zoom} onChange={(v) => onChange('zoom', v)} />
        <NumField label="Overlap (px)" value={settings.overlap} onChange={(v) => onChange('overlap', v)} />
        <NumField
          label="Max screenshots"
          value={settings.max_screenshots}
          onChange={(v) => onChange('max_screenshots', v)}
        />
        <NumField
          label="Viewport width"
          value={settings.viewport_width}
          onChange={(v) => onChange('viewport_width', v)}
        />
        <NumField
          label="Viewport height"
          value={settings.viewport_height}
          onChange={(v) => onChange('viewport_height', v)}
        />
      </div>
    </>
  )
}

function VideoStep({
  settings,
  onChange,
}: {
  settings: GenerateSettings
  onChange: Setter
}) {
  return (
    <>
      <StepHeader
        title="Video settings"
        subtitle="Rendering parameters for PowerPoint / MP4 export. Applied only if the backend has PowerPoint COM."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Resolution">
          <select
            className="input"
            value={settings.resolution ?? '1080p'}
            onChange={(e) =>
              onChange('resolution', e.target.value as GenerateSettings['resolution'])
            }
          >
            <option value="720p">720p (HD)</option>
            <option value="1080p">1080p (Full HD)</option>
            <option value="1440p">1440p (2K)</option>
            <option value="4k">4K (UHD)</option>
          </select>
        </Field>
        <NumField
          label="Video quality (1-100)"
          value={settings.video_quality}
          onChange={(v) => onChange('video_quality', v)}
        />
        <NumField label="FPS" value={settings.fps} onChange={(v) => onChange('fps', v)} />
        <NumField
          label="Default slide duration (sec)"
          value={settings.slide_duration_sec}
          onChange={(v) => onChange('slide_duration_sec', v)}
        />
      </div>
    </>
  )
}

function ThumbnailStep({
  settings,
  onChange,
}: {
  settings: GenerateSettings
  onChange: Setter
}) {
  return (
    <>
      <StepHeader
        title="Thumbnail"
        subtitle="Optional thumbnail that gets inserted on slide 2 of the final deck."
      />
      <Toggle
        label="Thumbnail on slide 2"
        description="If enabled, inserts the chosen image on slide 2 of the output presentation."
        checked={settings.thumbnail_on_slide_2 ?? false}
        onChange={(v) => onChange('thumbnail_on_slide_2', v)}
      />
      {settings.thumbnail_on_slide_2 && (
        <Field label="Thumbnail filename">
          <input
            className="input"
            placeholder="thumbnail.png (in backend's local path)"
            value={settings.thumbnail_filename ?? ''}
            onChange={(e) => onChange('thumbnail_filename', e.target.value)}
          />
        </Field>
      )}
    </>
  )
}

function AdvancedStep({
  settings,
  onChange,
  canFinish,
  onStart,
  running,
  state,
  cancel,
}: {
  settings: GenerateSettings
  onChange: Setter
  canFinish: boolean
  onStart: () => void
  running: boolean
  state: ReturnType<typeof useTrackedGenerate>['state']
  cancel: () => void
}) {
  return (
    <>
      <StepHeader
        title="Advanced settings"
        subtitle="Final checks. Hit Start Process when you're ready — preflight will run first."
      />
      <div className="space-y-2">
        <Toggle
          label="Use cache"
          description="Reuse AI output if the same input (+ model + system prompt) was generated before."
          checked={settings.use_cache ?? true}
          onChange={(v) => onChange('use_cache', v)}
        />
        <Toggle
          label="Verify AI output"
          description="Up to 3 verification + revision passes."
          checked={settings.enable_verification ?? true}
          onChange={(v) => onChange('enable_verification', v)}
        />
        <Toggle
          label="Beautify HTML"
          description="Normalize AI HTML for cleaner screenshots."
          checked={settings.beautify_html ?? false}
          onChange={(v) => onChange('beautify_html', v)}
        />
        <Toggle
          label="Close PowerPoint before start"
          description="Avoid export conflicts if PowerPoint is already open."
          checked={settings.close_powerpoint_before_start ?? true}
          onChange={(v) => onChange('close_powerpoint_before_start', v)}
        />
        <Toggle
          label="Auto timing for screenshot slides"
          description="Distribute total seconds across inserted screenshot slides."
          checked={settings.auto_timing_screenshot_slides ?? true}
          onChange={(v) => onChange('auto_timing_screenshot_slides', v)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-white/10">
        {!running ? (
          <button type="button" className="btn-primary" disabled={!canFinish} onClick={onStart}>
            <Play size={16} /> Start Process
          </button>
        ) : (
          <button type="button" className="btn-danger" onClick={cancel}>
            <StopCircle size={16} /> Cancel
          </button>
        )}
        {!canFinish && !running && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Fill project info (Step 1) and text (Step 2) before starting.
          </span>
        )}
        {state.status === 'error' && (
          <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>
        )}
        {state.status === 'cancelled' && (
          <span className="text-sm text-amber-600 dark:text-amber-400">Cancelled</span>
        )}
      </div>
    </>
  )
}

// ─── Small primitives ──────────────────────────────────────────────────────

function Field({
  label,
  children,
  required,
  className,
}: {
  label: string
  children: React.ReactNode
  required?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  step,
}: {
  label: string
  value: number | undefined
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        step={step}
        className="input"
        value={value ?? ''}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
    </Field>
  )
}
