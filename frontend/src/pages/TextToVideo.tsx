import React, { useEffect, useMemo, useState } from 'react'
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
  AlertCircle,
  Upload,
} from 'lucide-react'

import ProgressBar from '../components/ProgressBar'
import ScreenshotGallery from '../components/ScreenshotGallery'
import PreflightModal from '../components/PreflightModal'
import Toggle from '../components/Toggle'
import { useTrackedGenerate } from '../hooks/useTrackedGenerate'
import { api } from '../api/client'
import { useSettings } from '../store/settings'
import type { GenerateSettings, OutputFormat } from '../api/types'

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: GenerateSettings = {
  output_format: 'images',
  model_choice: 'default',
  zoom: 2.1,
  overlap: 15,
  viewport_width: 1920,
  viewport_height: 1080,
  max_screenshots: 50,
  use_cache: true,
  enable_verification: true,
  beautify_html: false,
  close_powerpoint_before_start: true,
  auto_timing_screenshot_slides: true,
  fixed_seconds_per_screenshot_slide: 5,
  resolution: '1080p',
  video_quality: 85,
  fps: 30,
  slide_duration_sec: 5,
  intro_thumbnail_enabled: false,
  intro_thumbnail_duration_sec: 5,
  outro_thumbnail_enabled: false,
  outro_thumbnail_duration_sec: 5,
}

type StepId = 'project' | 'content' | 'screenshot' | 'video' | 'thumbnail' | 'advanced'

interface StepDef {
  id: StepId
  label: string
  shortLabel: string
  /** Output formats for which this step is irrelevant and should be hidden. */
  hiddenFor?: OutputFormat[]
}

const STEP_DEFS: StepDef[] = [
  { id: 'project', label: 'Project info', shortLabel: 'Project' },
  { id: 'content', label: 'AI & text', shortLabel: 'Content' },
  // Screenshots only matter once HTML has to be rendered to images.
  { id: 'screenshot', label: 'Screenshot settings', shortLabel: 'Screenshots', hiddenFor: ['html'] },
  // Video + thumbnail only matter for PowerPoint/MP4 export.
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

// ─── Validation ────────────────────────────────────────────────────────────

type FieldErrors = Record<string, string>

/** Returns a map of { fieldId -> errorMessage } for a given step. Empty = valid. */
function validateStep(id: StepId, settings: GenerateSettings, text: string): FieldErrors {
  const errs: FieldErrors = {}
  const num = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  switch (id) {
    case 'project': {
      if (!(settings.class_name ?? '').trim()) errs.class_name = 'Required'
      if (!(settings.subject ?? '').trim()) errs.subject = 'Required'
      if (!(settings.title ?? '').trim()) errs.title = 'Required'
      if (!settings.output_format) errs.output_format = 'Pick an output format'
      return errs
    }
    case 'content': {
      if (!text.trim()) errs.text = 'Paste your source text here'
      return errs
    }
    case 'screenshot': {
      const zoom = num(settings.zoom)
      if (zoom === null || zoom <= 0 || zoom > 10) errs.zoom = 'Zoom must be between 0.1 and 10'
      const overlap = num(settings.overlap)
      if (overlap === null || overlap < 0) errs.overlap = 'Overlap must be 0 or more'
      const vw = num(settings.viewport_width)
      if (vw === null || vw < 320) errs.viewport_width = 'Width must be at least 320px'
      const vh = num(settings.viewport_height)
      if (vh === null || vh < 240) errs.viewport_height = 'Height must be at least 240px'
      if (overlap !== null && vh !== null && overlap >= vh) {
        errs.overlap = 'Overlap must be less than viewport height'
      }
      const mx = num(settings.max_screenshots)
      if (mx === null || mx < 1) errs.max_screenshots = 'At least 1'
      return errs
    }
    case 'video': {
      if (!settings.resolution) errs.resolution = 'Pick a resolution'
      const q = num(settings.video_quality)
      if (q === null || q < 1 || q > 100) errs.video_quality = 'Between 1 and 100'
      const fps = num(settings.fps)
      if (fps === null || fps < 1 || fps > 120) errs.fps = 'Between 1 and 120'
      const sd = num(settings.slide_duration_sec)
      if (sd === null || sd <= 0) errs.slide_duration_sec = 'Must be greater than 0'
      return errs
    }
    case 'thumbnail': {
      if (settings.intro_thumbnail_enabled) {
        if (!(settings.intro_thumbnail_filename ?? '').trim()) {
          errs.intro_thumbnail_filename = 'Upload an image first'
        }
        const d = num(settings.intro_thumbnail_duration_sec)
        if (d === null || d <= 0) {
          errs.intro_thumbnail_duration_sec = 'Duration must be greater than 0'
        }
      }
      if (settings.outro_thumbnail_enabled) {
        if (!(settings.outro_thumbnail_filename ?? '').trim()) {
          errs.outro_thumbnail_filename = 'Upload an image first'
        }
        const d = num(settings.outro_thumbnail_duration_sec)
        if (d === null || d <= 0) {
          errs.outro_thumbnail_duration_sec = 'Duration must be greater than 0'
        }
      }
      return errs
    }
    case 'advanced': {
      if (!settings.auto_timing_screenshot_slides) {
        const f = num(settings.fixed_seconds_per_screenshot_slide)
        if (f === null || f <= 0) {
          errs.fixed_seconds_per_screenshot_slide = 'Seconds must be greater than 0'
        }
      }
      return errs
    }
  }
}

/** Scroll the first error field on a step into view and focus it. */
function focusFirstError(stepId: StepId, errs: FieldErrors) {
  const first = Object.keys(errs)[0]
  if (!first) return
  // Defer so the inline error nodes have rendered.
  setTimeout(() => {
    const el = document.getElementById(fieldId(stepId, first))
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.focus({ preventScroll: true })
      }
    }
  }, 0)
}

const fieldId = (step: StepId, name: string) => `field-${step}-${name}`

// ─── Page ──────────────────────────────────────────────────────────────────

export default function TextToVideo() {
  const nav = useNavigate()
  const { state, generate, cancel } = useTrackedGenerate('text-to-video')
  const running = state.status === 'running'
  const [text, setText] = useState('')
  const { settings: appSettings } = useSettings()
  const [settings, setSettings] = useState<GenerateSettings>({
    ...DEFAULT_SETTINGS,
    output_format: appSettings.defaultOutputFormat,
  })
  const [stepId, setStepId] = useState<StepId>('project')
  const [showPreflight, setShowPreflight] = useState(false)
  /** Step ids whose inline errors should be visible (only populated after the
   * user clicks Next on an invalid step). Silent until then. */
  const [erroredSteps, setErroredSteps] = useState<Set<StepId>>(new Set())

  const set = <K extends keyof GenerateSettings>(key: K, v: GenerateSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: v }))
    // Re-validate this step silently so errors clear as the user types.
    // We don't need to; perStepErrors is derived below.
  }

  const perStepErrors: Record<StepId, FieldErrors> = useMemo(() => ({
    project: validateStep('project', settings, text),
    content: validateStep('content', settings, text),
    screenshot: validateStep('screenshot', settings, text),
    video: validateStep('video', settings, text),
    thumbnail: validateStep('thumbnail', settings, text),
    advanced: validateStep('advanced', settings, text),
  }), [settings, text])

  const stepValid = (id: StepId) => Object.keys(perStepErrors[id]).length === 0

  // Visible steps depend on the chosen output format — irrelevant steps
  // (e.g. Video / Thumbnail for html / images output) are hidden so the user
  // doesn't fill fields that will never be used.
  const outputFormat: OutputFormat = settings.output_format ?? 'images'
  const visibleSteps = useMemo(
    () => STEP_DEFS.filter((s) => !s.hiddenFor?.includes(outputFormat)),
    [outputFormat],
  )
  // If the user toggled output_format and hid the currently-selected step,
  // fall back to the project step *derived* (no effect, no cascading render).
  const activeStepId: StepId = visibleSteps.some((s) => s.id === stepId) ? stepId : 'project'
  const stepIndex = visibleSteps.findIndex((s) => s.id === activeStepId)
  const currentErrors = perStepErrors[activeStepId]
  // Errors are shown after the user first attempted to leave an invalid step.
  // Once shown, they stay live — the Field border flips red/green as the user
  // types — which is the normal "touched-then-validate-on-change" pattern.
  const showCurrentErrors =
    erroredSteps.has(activeStepId) && Object.keys(currentErrors).length > 0

  /** A step (in the visible list) is reachable if every earlier visible step is valid. */
  const canNavigateTo = (target: StepId): boolean => {
    const targetIdx = visibleSteps.findIndex((s) => s.id === target)
    if (targetIdx <= stepIndex) return true
    for (let i = 0; i < targetIdx; i++) {
      if (!stepValid(visibleSteps[i].id)) return false
    }
    return true
  }

  // Redirect to Processes as soon as the backend accepts the request and we
  // have an operation_id.
  useEffect(() => {
    if (state.status === 'running' && state.operationId) {
      nav(`/processes?op=${encodeURIComponent(state.operationId)}`, { replace: true })
    }
  }, [state.status, state.operationId, nav])

  // Only the *visible* steps participate in the final validation.
  const allValid = visibleSteps.every((s) => stepValid(s.id))

  const onStart = () => {
    // Surface every outstanding error at once and jump to the first broken step.
    if (!allValid) {
      const broken = visibleSteps.find((s) => !stepValid(s.id))!
      setErroredSteps(new Set(visibleSteps.filter((s) => !stepValid(s.id)).map((s) => s.id)))
      setStepId(broken.id)
      focusFirstError(broken.id, perStepErrors[broken.id])
      return
    }
    setShowPreflight(true)
  }

  const onPreflightProceed = async () => {
    setShowPreflight(false)
    const payload: GenerateSettings = { ...settings }
    payload.class_name = (payload.class_name ?? '').trim() || undefined
    payload.subject = (payload.subject ?? '').trim() || undefined
    payload.title = (payload.title ?? '').trim() || undefined
    await generate(text, payload)
  }

  const goNext = () => {
    if (!stepValid(activeStepId)) {
      setErroredSteps((prev) => new Set(prev).add(activeStepId))
      focusFirstError(activeStepId, currentErrors)
      return
    }
    if (stepIndex >= 0 && stepIndex < visibleSteps.length - 1) {
      setStepId(visibleSteps[stepIndex + 1].id)
    }
  }
  const goPrev = () => {
    if (stepIndex > 0) setStepId(visibleSteps[stepIndex - 1].id)
  }

  const onPickTab = (target: StepId) => {
    const targetIdx = visibleSteps.findIndex((s) => s.id === target)
    if (targetIdx <= stepIndex) {
      // Going backward — always allowed.
      setStepId(target)
      return
    }
    // Going forward — every visible step up to (and including) the current
    // step must be valid. Surface the first broken step's errors.
    for (let i = 0; i < targetIdx; i++) {
      const s = visibleSteps[i]
      if (!stepValid(s.id)) {
        setErroredSteps((prev) => new Set(prev).add(s.id))
        setStepId(s.id)
        focusFirstError(s.id, perStepErrors[s.id])
        return
      }
    }
    setStepId(target)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">Text to Video</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Step through the wizard to configure the run. Nothing starts until you hit{' '}
          <span className="font-medium">Start Process</span> on the last step.
        </p>
      </div>

      <Tabs
        steps={visibleSteps}
        currentId={activeStepId}
        onPick={onPickTab}
        canNavigateTo={canNavigateTo}
        stepValid={stepValid}
      />

      <div className="card space-y-6">
        {activeStepId === 'project' && (
          <ProjectStep
            settings={settings}
            onChange={set}
            running={running}
            errors={showCurrentErrors ? currentErrors : {}}
          />
        )}

        {activeStepId === 'content' && (
          <ContentStep
            text={text}
            onText={setText}
            settings={settings}
            onChange={set}
            running={running}
            errors={showCurrentErrors ? currentErrors : {}}
          />
        )}

        {activeStepId === 'screenshot' && (
          <ScreenshotStep
            settings={settings}
            onChange={set}
            errors={showCurrentErrors ? currentErrors : {}}
          />
        )}

        {activeStepId === 'video' && (
          <VideoStep
            settings={settings}
            onChange={set}
            errors={showCurrentErrors ? currentErrors : {}}
          />
        )}

        {activeStepId === 'thumbnail' && (
          <ThumbnailStep
            settings={settings}
            onChange={set}
            errors={showCurrentErrors ? currentErrors : {}}
          />
        )}

        {activeStepId === 'advanced' && (
          <AdvancedStep
            settings={settings}
            onChange={set}
            canFinish={allValid}
            onStart={onStart}
            running={running}
            state={state}
            cancel={cancel}
            errors={showCurrentErrors ? currentErrors : {}}
          />
        )}

        {showCurrentErrors && Object.keys(currentErrors).length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div>
              Fix {Object.keys(currentErrors).length} issue
              {Object.keys(currentErrors).length === 1 ? '' : 's'} on this step before continuing.
            </div>
          </div>
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
            disabled={running}
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
  currentId,
  onPick,
  canNavigateTo,
  stepValid,
}: {
  steps: StepDef[]
  currentId: StepId
  onPick: (id: StepId) => void
  canNavigateTo: (id: StepId) => boolean
  stepValid: (id: StepId) => boolean
}) {
  const currentIndex = steps.findIndex((s) => s.id === currentId)
  return (
    <ol className="flex w-full flex-wrap items-center gap-1">
      {steps.map((s, i) => {
        const active = s.id === currentId
        const isDone = i < currentIndex && stepValid(s.id)
        const reachable = canNavigateTo(s.id)
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => onPick(s.id)}
              title={!reachable ? 'Fill earlier steps first' : s.label}
              className={
                'flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ' +
                (active
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-200'
                  : isDone
                  ? 'border-brand-200 bg-brand-50/60 text-brand-600 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                  : reachable
                  ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-slate-100'
                  : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-500')
              }
            >
              <span
                className={
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ' +
                  (active
                    ? 'bg-brand-500 text-white'
                    : isDone
                    ? 'bg-brand-500/80 text-white'
                    : reachable
                    ? 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300'
                    : 'bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500')
                }
              >
                {isDone ? <Check size={12} /> : i + 1}
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
  errors,
}: {
  settings: GenerateSettings
  onChange: Setter
  running: boolean
  errors: FieldErrors
}) {
  return (
    <>
      <StepHeader
        title="Project info"
        subtitle="Metadata for this run — used as the output folder/file prefix and shown in Processes."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class name" required error={errors.class_name}>
          <input
            id={fieldId('project', 'class_name')}
            className={inputCls(errors.class_name)}
            placeholder="Class 8"
            value={settings.class_name ?? ''}
            onChange={(e) => onChange('class_name', e.target.value)}
            disabled={running}
          />
        </Field>
        <Field label="Subject" required error={errors.subject}>
          <input
            id={fieldId('project', 'subject')}
            className={inputCls(errors.subject)}
            placeholder="Nepali"
            value={settings.subject ?? ''}
            onChange={(e) => onChange('subject', e.target.value)}
            disabled={running}
          />
        </Field>
        <Field label="Title" required className="sm:col-span-2" error={errors.title}>
          <input
            id={fieldId('project', 'title')}
            className={inputCls(errors.title)}
            placeholder="Chapter 1 — Introduction"
            value={settings.title ?? ''}
            onChange={(e) => onChange('title', e.target.value)}
            disabled={running}
          />
        </Field>
      </div>

      <div id={fieldId('project', 'output_format')}>
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
        {errors.output_format && <FieldError message={errors.output_format} />}
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
  errors,
}: {
  text: string
  onText: (s: string) => void
  settings: GenerateSettings
  onChange: Setter
  running: boolean
  errors: FieldErrors
}) {
  return (
    <>
      <StepHeader
        title="AI & text"
        subtitle="Pick the model, paste the source text, and (optionally) override the system prompt."
      />

      <Field label="AI Model">
        <select
          id={fieldId('content', 'model_choice')}
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

      <Field label="Text input" required error={errors.text}>
        <textarea
          id={fieldId('content', 'text')}
          className={inputCls(errors.text) + ' textarea h-60 resize-y font-mono'}
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
  errors,
}: {
  settings: GenerateSettings
  onChange: Setter
  errors: FieldErrors
}) {
  return (
    <>
      <StepHeader
        title="Screenshot settings"
        subtitle="How Playwright captures the rendered HTML."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <NumField
          step="screenshot"
          name="zoom"
          label="Zoom"
          numStep={0.1}
          value={settings.zoom}
          onChange={(v) => onChange('zoom', v)}
          error={errors.zoom}
        />
        <NumField
          step="screenshot"
          name="overlap"
          label="Overlap (px)"
          value={settings.overlap}
          onChange={(v) => onChange('overlap', v)}
          error={errors.overlap}
        />
        <NumField
          step="screenshot"
          name="max_screenshots"
          label="Max screenshots"
          value={settings.max_screenshots}
          onChange={(v) => onChange('max_screenshots', v)}
          error={errors.max_screenshots}
        />
        <NumField
          step="screenshot"
          name="viewport_width"
          label="Viewport width"
          value={settings.viewport_width}
          onChange={(v) => onChange('viewport_width', v)}
          error={errors.viewport_width}
        />
        <NumField
          step="screenshot"
          name="viewport_height"
          label="Viewport height"
          value={settings.viewport_height}
          onChange={(v) => onChange('viewport_height', v)}
          error={errors.viewport_height}
        />
      </div>
    </>
  )
}

function VideoStep({
  settings,
  onChange,
  errors,
}: {
  settings: GenerateSettings
  onChange: Setter
  errors: FieldErrors
}) {
  return (
    <>
      <StepHeader
        title="Video settings"
        subtitle="Rendering parameters for PowerPoint / MP4 export. Only applied when output is PowerPoint or MP4."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Resolution" error={errors.resolution}>
          <select
            id={fieldId('video', 'resolution')}
            className={inputCls(errors.resolution)}
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
          step="video"
          name="video_quality"
          label="Video quality (1-100)"
          value={settings.video_quality}
          onChange={(v) => onChange('video_quality', v)}
          error={errors.video_quality}
        />
        <NumField
          step="video"
          name="fps"
          label="FPS"
          value={settings.fps}
          onChange={(v) => onChange('fps', v)}
          error={errors.fps}
        />
        <NumField
          step="video"
          name="slide_duration_sec"
          label="Default slide duration (sec)"
          value={settings.slide_duration_sec}
          onChange={(v) => onChange('slide_duration_sec', v)}
          error={errors.slide_duration_sec}
        />
      </div>
    </>
  )
}

function ThumbnailStep({
  settings,
  onChange,
  errors,
}: {
  settings: GenerateSettings
  onChange: Setter
  errors: FieldErrors
}) {
  return (
    <>
      <StepHeader
        title="Thumbnails"
        subtitle="Two optional thumbnail slots: intro (slide 2) and outro (2nd-to-last slide). Both are inserted into the final PPT / MP4."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ThumbnailSlot
          kind="intro"
          title="Intro thumbnail"
          position="Inserted on slide 2"
          enabled={settings.intro_thumbnail_enabled ?? false}
          filename={settings.intro_thumbnail_filename ?? ''}
          durationSec={settings.intro_thumbnail_duration_sec}
          onEnabledChange={(v) => onChange('intro_thumbnail_enabled', v)}
          onFilenameChange={(v) => onChange('intro_thumbnail_filename', v)}
          onDurationChange={(v) => onChange('intro_thumbnail_duration_sec', v)}
          filenameError={errors.intro_thumbnail_filename}
          durationError={errors.intro_thumbnail_duration_sec}
        />
        <ThumbnailSlot
          kind="outro"
          title="Outro thumbnail"
          position="Inserted on the 2nd-to-last slide"
          enabled={settings.outro_thumbnail_enabled ?? false}
          filename={settings.outro_thumbnail_filename ?? ''}
          durationSec={settings.outro_thumbnail_duration_sec}
          onEnabledChange={(v) => onChange('outro_thumbnail_enabled', v)}
          onFilenameChange={(v) => onChange('outro_thumbnail_filename', v)}
          onDurationChange={(v) => onChange('outro_thumbnail_duration_sec', v)}
          filenameError={errors.outro_thumbnail_filename}
          durationError={errors.outro_thumbnail_duration_sec}
        />
      </div>
    </>
  )
}

function ThumbnailSlot({
  kind,
  title,
  position,
  enabled,
  filename,
  durationSec,
  onEnabledChange,
  onFilenameChange,
  onDurationChange,
  filenameError,
  durationError,
}: {
  kind: 'intro' | 'outro'
  title: string
  position: string
  enabled: boolean
  filename: string
  durationSec: number | undefined
  onEnabledChange: (v: boolean) => void
  onFilenameChange: (v: string) => void
  onDurationChange: (v: number) => void
  filenameError?: string
  durationError?: string
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const fileFieldName = `${kind}_thumbnail_filename`
  const durFieldName = `${kind}_thumbnail_duration_sec`
  const trimmed = filename.trim()

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadErr(null)
    try {
      const { filename: stored } = await api.uploadThumbnail(file)
      onFilenameChange(stored)
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-50">{title}</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{position}</div>
        </div>
        <Toggle label="" checked={enabled} onChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="space-y-3">
          <Field label="Image" required error={filenameError}>
            <div className="flex flex-col gap-3">
              <label
                className={
                  'flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-5 text-sm transition-colors ' +
                  (filenameError
                    ? 'border-rose-400 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200'
                    : 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300')
                }
              >
                <Upload size={16} />
                {uploading ? 'Uploading…' : trimmed ? 'Replace image' : 'Upload image'}
                <input
                  id={fieldId('thumbnail', fileFieldName)}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  className="hidden"
                  onChange={onPickFile}
                  disabled={uploading}
                />
              </label>
              {trimmed && (
                <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-white/[0.03]">
                  <img
                    src={api.thumbnailUrl(trimmed)}
                    alt={`${title} preview`}
                    className="h-14 w-20 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                      {trimmed}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Stored on backend
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => onFilenameChange('')}
                  >
                    Remove
                  </button>
                </div>
              )}
              {uploadErr && <FieldError message={uploadErr} />}
            </div>
          </Field>

          <Field label="Duration (seconds)" error={durationError}>
            <input
              id={fieldId('thumbnail', durFieldName)}
              type="number"
              step={0.5}
              className={inputCls(durationError)}
              value={durationSec ?? ''}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isNaN(v)) onDurationChange(v)
              }}
            />
          </Field>
        </div>
      )}
    </div>
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
  errors,
}: {
  settings: GenerateSettings
  onChange: Setter
  canFinish: boolean
  onStart: () => void
  running: boolean
  state: ReturnType<typeof useTrackedGenerate>['state']
  cancel: () => void
  errors: FieldErrors
}) {
  const autoTiming = settings.auto_timing_screenshot_slides ?? true
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
          checked={autoTiming}
          onChange={(v) => onChange('auto_timing_screenshot_slides', v)}
        />
        {!autoTiming && (
          <div className="pl-4">
            <NumField
              step="advanced"
              name="fixed_seconds_per_screenshot_slide"
              label="Fixed seconds per screenshot slide"
              numStep={0.5}
              value={settings.fixed_seconds_per_screenshot_slide}
              onChange={(v) => onChange('fixed_seconds_per_screenshot_slide', v)}
              error={errors.fixed_seconds_per_screenshot_slide}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-white/10">
        {!running ? (
          <button type="button" className="btn-primary" onClick={onStart}>
            <Play size={16} /> Start Process
          </button>
        ) : (
          <button type="button" className="btn-danger" onClick={cancel}>
            <StopCircle size={16} /> Cancel
          </button>
        )}
        {!canFinish && !running && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Fix the outstanding step errors — click Start Process to jump to the first one.
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
  error,
}: {
  label: string
  children: React.ReactNode
  required?: boolean
  className?: string
  error?: string
}) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {children}
      {error && <FieldError message={error} />}
    </div>
  )
}

function FieldError({ message }: { message: string }) {
  return (
    <div className="mt-1 flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
      <AlertCircle size={12} />
      {message}
    </div>
  )
}

function NumField({
  step,
  name,
  label,
  value,
  onChange,
  numStep,
  error,
}: {
  step: StepId
  name: string
  label: string
  value: number | undefined
  onChange: (v: number) => void
  numStep?: number
  error?: string
}) {
  return (
    <Field label={label} error={error}>
      <input
        id={fieldId(step, name)}
        type="number"
        step={numStep}
        className={inputCls(error)}
        value={value ?? ''}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
    </Field>
  )
}

function inputCls(error?: string) {
  return error
    ? 'input border-rose-400 focus:border-rose-500 focus:ring-rose-500 dark:border-rose-500/60'
    : 'input'
}
