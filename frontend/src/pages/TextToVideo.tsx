import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  Wand2,
  Trash2,
  Copy as CopyIcon,
  Eye,
  EyeOff,
  Sparkles,
  Layers,
  Lock,
  Unlock,
  RotateCcw,
} from 'lucide-react'

import PreflightModal from '../components/PreflightModal'
import BackendRejectedBanner from '../components/BackendRejectedBanner'
import Toggle from '../components/Toggle'
import { useTrackedGenerate } from '../hooks/useTrackedGenerate'
import { useBackendCapabilities } from '../hooks/useBackendPlatform'
import { api } from '../api/client'
import { useSettings } from '../store/settings'
import type { GenerateSettings, OutputFormat, SavedThumbnailTemplate } from '../api/types'
import { consumeProcessEditHandoff } from '../lib/processEditHandoff'
import type { ReplacementTargets } from '../lib/processEditHandoff'
import {
  buildAutoThumbnailFile,
  buildAutoThumbnailTemplate,
  renderTemplateToDataUrl,
  duplicateElement,
  nextElementId,
  type ThumbnailElement,
  type ThumbnailShapeType,
} from '../lib/thumbnailBuilder'

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: GenerateSettings = {
  output_format: 'images',
  class_name: 'Class 10',
  subject: 'Nepali',
  model_choice: 'default',
  zoom: 2.1,
  overlap: 15,
  viewport_width: 1920,
  viewport_height: 1080,
  max_screenshots: 50,
  use_cache: true,
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

// New storage key (v2) captures the full wizard state so "Reuse previous
// run" restores everything: text, all GenerateSettings (model choice,
// system prompt, screenshot settings, video settings, thumbnails, …).
// The old v1 key only stored {class_name, subject, title, output_format}
// — we still read it as a fallback so users who ran at least once under
// v1 don't lose the little that was saved.
const LAST_RUN_STORAGE_KEY = 'textbro:text-to-video:last-run:v2'
const HTML_LAST_RUN_STORAGE_KEY = 'textbro:html-to-video:last-run:v1'
const LEGACY_PROJECT_DETAILS_STORAGE_KEY = 'textbro:text-to-video:project-details:v1'
const CLASS_OPTIONS = ['Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12']
const SUBJECT_OPTIONS = ['Nepali', 'English', 'Science', 'Math', 'Social', 'Model Question']
type SourceMode = 'text' | 'html'

type LegacyProjectDetails = Pick<GenerateSettings, 'class_name' | 'subject' | 'title' | 'output_format'>

/** Full snapshot of the wizard — everything needed to restore a prior run. */
interface LastRunSnapshot {
  text: string
  settings: GenerateSettings
}


function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function readLastRunSnapshot(mode: SourceMode = 'text'): LastRunSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(
      mode === 'html' ? HTML_LAST_RUN_STORAGE_KEY : LAST_RUN_STORAGE_KEY,
    )
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed) && isRecord(parsed.settings)) {
        return {
          text: typeof parsed.text === 'string' ? parsed.text : '',
          settings: parsed.settings as GenerateSettings,
        }
      }
    }
    // Fallback — legacy key only had the 4 project-info fields.
    const legacyRaw =
      mode === 'text' ? window.localStorage.getItem(LEGACY_PROJECT_DETAILS_STORAGE_KEY) : null
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as LegacyProjectDetails
      if (isRecord(legacy)) {
        return {
          text: '',
          settings: {
            class_name: typeof legacy.class_name === 'string' ? legacy.class_name : undefined,
            subject: typeof legacy.subject === 'string' ? legacy.subject : undefined,
            title: typeof legacy.title === 'string' ? legacy.title : undefined,
            output_format: legacy.output_format,
          },
        }
      }
    }
    return null
  } catch {
    return null
  }
}

function saveLastRunSnapshot(
  text: string,
  settings: GenerateSettings,
  mode: SourceMode = 'text',
): LastRunSnapshot | null {
  if (typeof window === 'undefined') return null
  const snapshot: LastRunSnapshot = { text, settings }
  try {
    window.localStorage.setItem(
      mode === 'html' ? HTML_LAST_RUN_STORAGE_KEY : LAST_RUN_STORAGE_KEY,
      JSON.stringify(snapshot),
    )
    // Clear the legacy key so the reuse button doesn't surface stale
    // project-info that we've already superseded.
    if (mode === 'text') window.localStorage.removeItem(LEGACY_PROJECT_DETAILS_STORAGE_KEY)
  } catch {
    /* ignore storage failures */
  }
  return snapshot
}

function captureThumbnailTemplateSettings(settings: GenerateSettings): Partial<GenerateSettings> {
  const sideImageUrl = settings.auto_thumbnail_side_image_url
  return {
    auto_thumbnail_chapter_num: settings.auto_thumbnail_chapter_num,
    auto_thumbnail_year: settings.auto_thumbnail_year,
    auto_thumbnail_chapter_prefix: settings.auto_thumbnail_chapter_prefix,
    auto_thumbnail_side_image_url: sideImageUrl?.startsWith('blob:') ? undefined : sideImageUrl,
    auto_thumbnail_image_offset_x: settings.auto_thumbnail_image_offset_x,
    auto_thumbnail_image_offset_y: settings.auto_thumbnail_image_offset_y,
    auto_thumbnail_image_zoom: settings.auto_thumbnail_image_zoom,
    auto_thumbnail_canvas_background: settings.auto_thumbnail_canvas_background,
    auto_thumbnail_overrides: settings.auto_thumbnail_overrides,
    auto_thumbnail_added_elements: settings.auto_thumbnail_added_elements,
    auto_thumbnail_hidden_elements: settings.auto_thumbnail_hidden_elements,
  }
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
  { value: 'video', label: 'MP4 video', desc: 'Rendered to MP4 via PowerPoint (Windows) or MoviePy (Linux/macOS).', icon: Video },
]

// ─── Validation ────────────────────────────────────────────────────────────

type FieldErrors = Record<string, string>

/** Returns a map of { fieldId -> errorMessage } for a given step. Empty = valid. */
function validateStep(
  id: StepId,
  settings: GenerateSettings,
  text: string,
  mode: SourceMode = 'text',
  autoThumbnailBuilder = false,
): FieldErrors {
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
      if (!text.trim()) errs.text = mode === 'html' ? 'Paste your HTML here' : 'Paste your source text here'
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
        if (!autoThumbnailBuilder && !(settings.intro_thumbnail_filename ?? '').trim()) {
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

export default function TextToVideo({ sourceMode = 'text' }: { sourceMode?: SourceMode }) {
  const nav = useNavigate()
  const tracked = useTrackedGenerate(sourceMode === 'html' ? 'html-to-video' : 'text-to-video')
  const { state, cancel } = tracked
  const generateSource = sourceMode === 'html' ? tracked.generateFromHtml : tracked.generate
  const running = false
  const [text, setText] = useState('')
  const { settings: appSettings } = useSettings()
  const [settings, setSettings] = useState<GenerateSettings>({
    ...DEFAULT_SETTINGS,
    output_format: sourceMode === 'html' ? 'video' : appSettings.defaultOutputFormat,
  })
  const [lastRunSnapshot, setLastRunSnapshot] = useState<LastRunSnapshot | null>(() =>
    readLastRunSnapshot(sourceMode),
  )
  const [replaceTargets, setReplaceTargets] = useState<ReplacementTargets | null>(null)
  const [stepId, setStepId] = useState<StepId>('project')
  const [showPreflight, setShowPreflight] = useState(false)
  const [autoThumbnailPreviewUrl, setAutoThumbnailPreviewUrl] = useState<string | null>(null)
  const [autoThumbnailError, setAutoThumbnailError] = useState<string | null>(null)
  const [autoThumbnailSaving, setAutoThumbnailSaving] = useState(false)
  const [autoThumbnailEditOpen, setAutoThumbnailEditOpen] = useState(false)
  const preflightProceedingRef = useRef(false)
  /** Step ids whose inline errors should be visible (only populated after the
   * user clicks Next on an invalid step). Silent until then. */
  const [erroredSteps, setErroredSteps] = useState<Set<StepId>>(new Set())

  useEffect(() => {
    const draft = consumeProcessEditHandoff(sourceMode === 'html' ? 'html-to-video' : 'text-to-video')
    if (!draft) return
    setText(draft.text)
    setSettings((prev) => ({ ...prev, ...draft.settings }))
    setReplaceTargets(draft.replaceTargets)
    setStepId('project')
    setErroredSteps(new Set())
  }, [])

  const set = <K extends keyof GenerateSettings>(key: K, v: GenerateSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: v }))
    // Re-validate this step silently so errors clear as the user types.
    // We don't need to; perStepErrors is derived below.
  }

  const shouldAutoBuildThumbnail =
    sourceMode === 'text' &&
    appSettings.autoThumbnailBuilder &&
    (settings.output_format === 'video' || settings.output_format === 'pptx')

  useEffect(() => {
    if (!shouldAutoBuildThumbnail || (settings.intro_thumbnail_filename ?? '').trim()) {
      setAutoThumbnailPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }

    let cancelled = false
    let objectUrl: string | null = null

    buildAutoThumbnailFile(settings, text)
      .then((file) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(file)
        setAutoThumbnailPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return objectUrl
        })
      })
      .catch((err) => {
        if (!cancelled) setAutoThumbnailError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [
    shouldAutoBuildThumbnail,
    settings.class_name,
    settings.subject,
    settings.title,
    settings.auto_thumbnail_side_image_url,
    settings.auto_thumbnail_chapter_num,
    settings.auto_thumbnail_year,
    settings.auto_thumbnail_chapter_prefix,
    settings.auto_thumbnail_image_offset_x,
    settings.auto_thumbnail_image_offset_y,
    settings.auto_thumbnail_image_zoom,
    settings.auto_thumbnail_canvas_background,
    settings.auto_thumbnail_overrides,
    settings.auto_thumbnail_added_elements,
    settings.auto_thumbnail_hidden_elements,
    settings.intro_thumbnail_filename,
    settings,
    text,
  ])

  useEffect(() => {
    return () => {
      const url = settings.auto_thumbnail_side_image_url
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [settings.auto_thumbnail_side_image_url])

  const useAutoThumbnailNow = async () => {
    if (autoThumbnailSaving) return
    setAutoThumbnailSaving(true)
    setAutoThumbnailError(null)
    try {
      const file = await buildAutoThumbnailFile(settings, text)
      const { filename } = await api.uploadThumbnail(file)
      setSettings((prev) => ({
        ...prev,
        intro_thumbnail_enabled: true,
        intro_thumbnail_filename: filename,
        auto_thumbnail_generated: true,
      }))
    } catch (err) {
      setAutoThumbnailError(err instanceof Error ? err.message : String(err))
    } finally {
      setAutoThumbnailSaving(false)
    }
  }

  const setAutoThumbnailSideImage = (file: File | null) => {
    setSettings((prev) => {
      const previousUrl = prev.auto_thumbnail_side_image_url
      if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl)
      return {
        ...prev,
        auto_thumbnail_side_image_url: file ? URL.createObjectURL(file) : undefined,
      }
    })
  }

  const perStepErrors: Record<StepId, FieldErrors> = useMemo(() => ({
    project: validateStep('project', settings, text, sourceMode, shouldAutoBuildThumbnail),
    content: validateStep('content', settings, text, sourceMode, shouldAutoBuildThumbnail),
    screenshot: validateStep('screenshot', settings, text, sourceMode, shouldAutoBuildThumbnail),
    video: validateStep('video', settings, text, sourceMode, shouldAutoBuildThumbnail),
    thumbnail: validateStep('thumbnail', settings, text, sourceMode, shouldAutoBuildThumbnail),
    advanced: validateStep('advanced', settings, text, sourceMode, shouldAutoBuildThumbnail),
  }), [settings, text, sourceMode, shouldAutoBuildThumbnail])

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
    preflightProceedingRef.current = false
    setShowPreflight(true)
  }

  const reuseLastRun = () => {
    if (!lastRunSnapshot) return
    // Full restore: text + every field the previous run set. Start from
    // the current baseline so anything *not* captured in the snapshot
    // (new settings added after the snapshot was saved) keeps its
    // current value instead of becoming `undefined`.
    setSettings((prev) => ({ ...prev, ...lastRunSnapshot.settings }))
    if (typeof lastRunSnapshot.text === 'string') setText(lastRunSnapshot.text)
    // After a restore, land the user back on the first step so they
    // can quickly confirm the restored values before running.
    setStepId('project')
    setErroredSteps(new Set())
  }

  const onPreflightProceed = async () => {
    if (preflightProceedingRef.current) return
    preflightProceedingRef.current = true
    setShowPreflight(false)
    const payload: GenerateSettings = { ...settings }
    payload.class_name = (payload.class_name ?? '').trim() || undefined
    payload.subject = (payload.subject ?? '').trim() || undefined
    payload.title = (payload.title ?? '').trim() || undefined
    payload.concurrent_pipeline_runs = appSettings.concurrentPipelineRuns
    setAutoThumbnailError(null)
    if (shouldAutoBuildThumbnail) {
      const existingIntroThumbnail = (payload.intro_thumbnail_filename ?? '').trim()
      if (existingIntroThumbnail) {
        payload.intro_thumbnail_enabled = true
      } else {
        try {
          const file = await buildAutoThumbnailFile(payload, text)
          const { filename } = await api.uploadThumbnail(file)
          payload.intro_thumbnail_enabled = true
          payload.intro_thumbnail_filename = filename
          payload.auto_thumbnail_generated = true
          setSettings((prev) => ({
            ...prev,
            intro_thumbnail_enabled: true,
            intro_thumbnail_filename: filename,
            auto_thumbnail_generated: true,
          }))
        } catch (err) {
          preflightProceedingRef.current = false
          setAutoThumbnailError(err instanceof Error ? err.message : String(err))
          setStepId('thumbnail')
          return
        }
      }
    }
    // Snapshot the full wizard state (text + settings) so the next
    // session can restore everything via "Reuse previous run".
    setLastRunSnapshot(saveLastRunSnapshot(text, payload, sourceMode))
    // Enqueues and (if idle) kicks off immediately. Navigate right away so
    // the user sees either the running run or the queue entry without
    // staying on the wizard.
    const targets = replaceTargets
    const { queueId } = generateSource(text, payload, targets ? { replaceTargets: targets } : undefined)
    setReplaceTargets(null)
    nav(`/processes?queue=${encodeURIComponent(queueId)}`)
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
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">
          {sourceMode === 'html' ? 'HTML to Video' : 'Text to Video'}
        </h1>
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

      <div
        role="tabpanel"
        id={`wizard-panel-${activeStepId}`}
        aria-labelledby={`wizard-tab-${activeStepId}`}
        tabIndex={0}
        className="card space-y-6"
      >
        {activeStepId === 'project' && (
          <ProjectStep
            settings={settings}
            onChange={set}
            lastRunSnapshot={lastRunSnapshot}
            onReuseLast={reuseLastRun}
            running={running}
            errors={showCurrentErrors ? currentErrors : {}}
            sourceMode={sourceMode}
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
            sourceMode={sourceMode}
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
            text={text}
            onChange={set}
            errors={showCurrentErrors ? currentErrors : {}}
            autoThumbnailBuilder={shouldAutoBuildThumbnail}
            autoThumbnailPreviewUrl={autoThumbnailPreviewUrl}
            autoThumbnailError={autoThumbnailError}
            autoThumbnailSaving={autoThumbnailSaving}
            autoThumbnailEditOpen={autoThumbnailEditOpen}
            onUseAutoThumbnail={useAutoThumbnailNow}
            onToggleAutoThumbnailEdit={() => setAutoThumbnailEditOpen((v) => !v)}
            onAutoThumbnailSideImage={setAutoThumbnailSideImage}
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Roving-tabindex + arrow-key navigation per WAI-ARIA Authoring Practices
  // tablist pattern. Only the active tab is in the tab order; arrows walk
  // siblings, Home/End jump to the ends, Enter/Space activates.
  const focusTab = (idx: number) => {
    const n = steps.length
    const target = ((idx % n) + n) % n
    tabRefs.current[target]?.focus()
  }

  const onKey = (e: React.KeyboardEvent, idx: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusTab(idx + 1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        focusTab(idx - 1)
        break
      case 'Home':
        e.preventDefault()
        focusTab(0)
        break
      case 'End':
        e.preventDefault()
        focusTab(steps.length - 1)
        break
      // Enter / Space fall through to the native button click — no special
      // handling needed, onClick fires either way.
    }
  }

  return (
    <ol role="tablist" aria-label="Wizard steps" className="flex w-full flex-wrap items-center gap-1">
      {steps.map((s, i) => {
        const active = s.id === currentId
        const isDone = i < currentIndex && stepValid(s.id)
        const reachable = canNavigateTo(s.id)
        return (
          <li key={s.id} role="presentation" className="flex min-w-0 flex-1 items-center gap-1">
            <button
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`wizard-tab-${s.id}`}
              aria-selected={active}
              aria-controls={`wizard-panel-${s.id}`}
              aria-disabled={!reachable || undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => onPick(s.id)}
              onKeyDown={(e) => onKey(e, i)}
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
  lastRunSnapshot,
  onReuseLast,
  running,
  errors,
  sourceMode,
}: {
  settings: GenerateSettings
  onChange: Setter
  lastRunSnapshot: LastRunSnapshot | null
  onReuseLast: () => void
  running: boolean
  errors: FieldErrors
  sourceMode: SourceMode
}) {
  // "Reuse previous run" is offered whenever we have any captured
  // signal from last time — project info, typed text, or non-default
  // advanced settings. This is broader than the previous
  // project-only gate.
  const canReuse = Boolean(
    lastRunSnapshot &&
      (lastRunSnapshot.text?.trim() ||
        lastRunSnapshot.settings?.class_name ||
        lastRunSnapshot.settings?.subject ||
        lastRunSnapshot.settings?.title ||
        lastRunSnapshot.settings?.output_format ||
        lastRunSnapshot.settings?.model_choice),
  )
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <StepHeader
          title="Project info"
          subtitle="Enter class, subject, and chapter title before adding content. The chapter title is also used by the auto thumbnail builder."
        />
        {canReuse && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onReuseLast}
            disabled={running}
            title="Restore the text, project info, and all settings from your last run"
          >
            Reuse previous run
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class" required error={errors.class_name}>
          <select
            id={fieldId('project', 'class_name')}
            className={inputCls(errors.class_name)}
            value={settings.class_name ?? 'Class 10'}
            onChange={(e) => onChange('class_name', e.target.value)}
            disabled={running}
          >
            {CLASS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject" required error={errors.subject}>
          <select
            id={fieldId('project', 'subject')}
            className={inputCls(errors.subject)}
            value={settings.subject ?? 'Nepali'}
            onChange={(e) => onChange('subject', e.target.value)}
            disabled={running}
          >
            {SUBJECT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chapter title for video and thumbnail" required className="sm:col-span-2" error={errors.title}>
          <input
            id={fieldId('project', 'title')}
            className={inputCls(errors.title)}
            placeholder="Chapter 2 - स्वाद"
            value={settings.title ?? ''}
            onChange={(e) => onChange('title', e.target.value)}
            disabled={running}
          />
        </Field>
      </div>

      <OutputFormatPicker
        value={settings.output_format ?? 'images'}
        onChange={(v) => onChange('output_format', v)}
        running={running}
        error={errors.output_format}
        sourceMode={sourceMode}
      />
    </>
  )
}

/** Output-format selector with Windows-only options disabled upstream
 *  when the backend platform isn't Windows. We still show a heads-up
 *  for Windows hosts so users know the preflight will verify PPT. */
function OutputFormatPicker({
  value,
  onChange,
  running,
  error,
  sourceMode,
}: {
  value: OutputFormat
  onChange: (v: OutputFormat) => void
  running: boolean
  error?: string
  sourceMode: SourceMode
}) {
  const { platform, videoEngineReady, pptxReady } = useBackendCapabilities()
  const engineOnly = (v: OutputFormat) => v === 'pptx' || v === 'video'
  return (
    <div id={fieldId('project', 'output_format')}>
      <div className="label">Output format</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {OUTPUT_OPTIONS.filter((o) => sourceMode === 'text' || o.value !== 'html').map((o) => {
          const Icon = o.icon
          const active = value === o.value
          // Gate engine-dependent outputs on the new preflight
          // ``video_engine`` capability so the MoviePy branch unlocks
          // MP4 export on Linux. PPTX still needs PowerPoint COM.
          const pptxBlocked =
            o.value === 'pptx' && platform !== 'unknown' && !pptxReady
          const videoBlocked =
            o.value === 'video' && platform !== 'unknown' && !videoEngineReady
          const disabledByPlatform = pptxBlocked || videoBlocked
          const disabled = running || disabledByPlatform
          const tooltip = pptxBlocked
            ? 'PowerPoint deck export requires a Windows host with PowerPoint installed — this backend reports a non-Windows OS.'
            : videoBlocked
              ? 'No video engine available — install MoviePy (pip install moviepy) or run on Windows with PowerPoint.'
              : undefined
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => !disabled && onChange(o.value)}
              disabled={disabled}
              aria-disabled={disabled}
              title={tooltip}
              className={
                'flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors ' +
                (active
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03]') +
                (disabledByPlatform ? ' cursor-not-allowed opacity-60 hover:border-slate-200' : '')
              }
            >
              <Icon
                size={18}
                className={active ? 'mt-0.5 text-brand-600' : 'mt-0.5 text-slate-400'}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                    {o.label}
                  </span>
                  {o.value === 'pptx' && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:bg-white/10 dark:text-slate-300">
                      Windows
                    </span>
                  )}
                  {o.value === 'video' && engineOnly(o.value) && videoEngineReady && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {platform === 'windows' ? 'PowerPoint' : 'MoviePy'}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {pptxBlocked
                    ? 'Unavailable — backend isn’t Windows.'
                    : videoBlocked
                      ? 'Unavailable — install MoviePy or run on Windows.'
                      : o.desc}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {error && <FieldError message={error} />}
      <WindowsOnlyWarning outputFormat={value} />
    </div>
  )
}

function WindowsOnlyWarning({ outputFormat }: { outputFormat: OutputFormat }) {
  const { platform, videoEngineReady, pptxReady } = useBackendCapabilities()
  const needsEngine = outputFormat === 'pptx' || outputFormat === 'video'
  if (!needsEngine) return null
  if (outputFormat === 'pptx' && !pptxReady && platform !== 'unknown') {
    return (
      <p className="mt-2 rounded-md border border-rose-300/60 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <strong>PowerPoint deck</strong> export won't work on this backend — it requires a Windows
        host with PowerPoint installed. Pick <em>MP4 video</em>, <em>Screenshots</em>, or{' '}
        <em>HTML file</em> to avoid surprise output.
      </p>
    )
  }
  if (outputFormat === 'video' && !videoEngineReady && platform !== 'unknown') {
    return (
      <p className="mt-2 rounded-md border border-rose-300/60 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <strong>MP4 video</strong> export won't work — no video engine is available on this
        backend. Install MoviePy (<code>pip install moviepy</code>) or run on a Windows host
        with PowerPoint installed.
      </p>
    )
  }
  if (outputFormat === 'video' && platform !== 'windows') {
    return (
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        MP4 export will use the <strong>MoviePy</strong> engine (libx264 ultrafast, 4K @ 30 fps).
      </p>
    )
  }
  return null
}

function ContentStep({
  text,
  onText,
  settings,
  onChange,
  running,
  errors,
  sourceMode,
}: {
  text: string
  onText: (s: string) => void
  settings: GenerateSettings
  onChange: Setter
  running: boolean
  errors: FieldErrors
  sourceMode: SourceMode
}) {
  const isHtml = sourceMode === 'html'
  const onFile = async (file: File) => {
    onText(await file.text())
  }
  const beautify = async () => {
    if (!text.trim()) return
    const res = await api.beautify(text)
    onText(res.html)
  }
  const minify = async () => {
    if (!text.trim()) return
    const res = await api.minify(text)
    onText(res.html)
  }

  return (
    <>
      <StepHeader
        title={isHtml ? 'HTML input' : 'AI & text'}
        subtitle={
          isHtml
            ? 'Paste or upload the HTML you already generated. The workflow continues from screenshots onward.'
            : 'Pick the model, paste the source text, and (optionally) override the system prompt.'
        }
      />

      {!isHtml && <Field label="AI Model">
        <select
          id={fieldId('content', 'model_choice')}
          className="input"
          value={settings.model_choice ?? 'default'}
          onChange={(e) => onChange('model_choice', e.target.value)}
          disabled={running}
        >
          <option value="default">Default — Qwen 3.5 122B</option>
          <option value="fast">Fast — DeepSeek V4 Flash (1M ctx)</option>
          <option value="short">Short &amp; fastest — Llama 3.1 8B</option>
          <option value="balanced">Balanced — GLM 4.7</option>
          <option value="quality">Quality — DeepSeek V3.2</option>
          <option value="long">Long context — DeepSeek V4 Pro (1M ctx)</option>
        </select>
      </Field>}

      {isHtml && (
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary cursor-pointer">
            <Upload size={14} /> Upload .html
            <input
              type="file"
              accept=".html,text/html"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
              disabled={running}
            />
          </label>
          <button type="button" className="btn-secondary" onClick={() => void beautify()} disabled={running || !text.trim()}>
            Beautify
          </button>
          <button type="button" className="btn-secondary" onClick={() => void minify()} disabled={running || !text.trim()}>
            Minify
          </button>
        </div>
      )}

      <Field label={isHtml ? 'HTML input' : 'Text input'} required error={errors.text}>
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

      {!isHtml && <Field label="System prompt (optional)">
        <textarea
          className="textarea h-24 resize-y"
          placeholder="Optional extra instructions for HTML generation…"
          value={settings.system_prompt ?? ''}
          onChange={(e) => onChange('system_prompt', e.target.value)}
          disabled={running}
        />
      </Field>}
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
  text,
  onChange,
  errors,
  autoThumbnailBuilder,
  autoThumbnailPreviewUrl,
  autoThumbnailError,
  autoThumbnailSaving,
  autoThumbnailEditOpen,
  onUseAutoThumbnail,
  onToggleAutoThumbnailEdit,
  onAutoThumbnailSideImage,
}: {
  settings: GenerateSettings
  text: string
  onChange: Setter
  errors: FieldErrors
  autoThumbnailBuilder: boolean
  autoThumbnailPreviewUrl: string | null
  autoThumbnailError: string | null
  autoThumbnailSaving: boolean
  autoThumbnailEditOpen: boolean
  onUseAutoThumbnail: () => void
  onToggleAutoThumbnailEdit: () => void
  onAutoThumbnailSideImage: (file: File | null) => void
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
          position={autoThumbnailBuilder ? 'Auto-built from project info unless replaced' : 'Inserted on slide 2'}
          enabled={autoThumbnailBuilder || (settings.intro_thumbnail_enabled ?? false)}
          filename={settings.intro_thumbnail_filename ?? ''}
          generatedPreviewUrl={autoThumbnailPreviewUrl}
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
          generatedPreviewUrl={null}
          durationSec={settings.outro_thumbnail_duration_sec}
          onEnabledChange={(v) => onChange('outro_thumbnail_enabled', v)}
          onFilenameChange={(v) => onChange('outro_thumbnail_filename', v)}
          onDurationChange={(v) => onChange('outro_thumbnail_duration_sec', v)}
          filenameError={errors.outro_thumbnail_filename}
          durationError={errors.outro_thumbnail_duration_sec}
        />
      </div>

      {autoThumbnailBuilder && (
        <AutoThumbnailPanel
          settings={settings}
          text={text}
          onChange={onChange}
          autoThumbnailError={autoThumbnailError}
          autoThumbnailSaving={autoThumbnailSaving}
          autoThumbnailEditOpen={autoThumbnailEditOpen}
          onUseAutoThumbnail={onUseAutoThumbnail}
          onToggleAutoThumbnailEdit={onToggleAutoThumbnailEdit}
          onAutoThumbnailSideImage={onAutoThumbnailSideImage}
        />
      )}
    </>
  )
}

function AutoThumbnailPanel({
  settings,
  text,
  onChange,
  autoThumbnailError,
  autoThumbnailSaving,
  autoThumbnailEditOpen,
  onUseAutoThumbnail,
  onToggleAutoThumbnailEdit,
  onAutoThumbnailSideImage,
}: {
  settings: GenerateSettings
  text: string
  onChange: Setter
  autoThumbnailError: string | null
  autoThumbnailSaving: boolean
  autoThumbnailEditOpen: boolean
  onUseAutoThumbnail: () => void
  onToggleAutoThumbnailEdit: () => void
  onAutoThumbnailSideImage: (file: File | null) => void
}) {
  const hasSavedIntro = Boolean((settings.intro_thumbnail_filename ?? '').trim())
  const [templateVersion, setTemplateVersion] = useState(0)
  const [savedTemplates, setSavedTemplates] = useState<SavedThumbnailTemplate[]>([])
  const [templateSaveStatus, setTemplateSaveStatus] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState(
    `${settings.class_name ?? 'Class'} ${settings.subject ?? 'Subject'}`.trim(),
  )

  useEffect(() => {
    setTemplateName(`${settings.class_name ?? 'Class'} ${settings.subject ?? 'Subject'}`.trim())
  }, [settings.class_name, settings.subject])

  useEffect(() => {
    let cancelled = false
    api.listThumbnailTemplates(settings.class_name, settings.subject)
      .then((res) => { if (!cancelled) setSavedTemplates(res.templates ?? []) })
      .catch(() => { if (!cancelled) setSavedTemplates([]) })
    return () => { cancelled = true }
  }, [settings.class_name, settings.subject, templateVersion])

  const saveCurrentTemplate = async () => {
    const className = (settings.class_name ?? '').trim()
    const subject = (settings.subject ?? '').trim()
    if (!className || !subject) {
      setTemplateSaveStatus('Class and subject are required before saving.')
      return
    }
    const name = templateName.trim() || `${className} ${subject}`
    setTemplateSaveStatus('Saving...')
    try {
      await api.saveThumbnailTemplate({
        name,
        className,
        subject,
        settings: captureThumbnailTemplateSettings(settings),
      })
      setTemplateSaveStatus('Saved.')
      setTemplateVersion((v) => v + 1)
    } catch (err) {
      setTemplateSaveStatus(err instanceof Error ? err.message : 'Could not save template.')
    }
  }

  const loadSavedTemplate = (id: string) => {
    const match = savedTemplates.find((item) => item.id === id)
    if (!match) return
    Object.entries(match.settings).forEach(([key, value]) => {
      onChange(key as keyof GenerateSettings, value as GenerateSettings[keyof GenerateSettings])
    })
  }

  const deleteSavedTemplate = async (id: string) => {
    await api.deleteThumbnailTemplate(id)
    setTemplateVersion((v) => v + 1)
  }

  // Mini preview rendered from the same template the run uses, so the user
  // sees the actual output (not a CSS approximation) before pressing "Use it".
  const template = useMemo(
    () => buildAutoThumbnailTemplate(settings, text),
    [settings, text],
  )
  const [miniPreview, setMiniPreview] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    renderTemplateToDataUrl(template, 0.6)
      .then((url) => { if (!cancelled) setMiniPreview(url) })
      .catch(() => { if (!cancelled) setMiniPreview(null) })
    return () => { cancelled = true }
  }, [template])

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
      {/* ── Header strip ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white p-5 dark:border-white/10 dark:from-brand-500/10 dark:to-transparent">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm">
          <Wand2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-slate-900 dark:text-slate-50">
            Auto thumbnail builder
          </div>
          <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
            We compose a clean Education Classic intro from your class, subject and chapter title — drop in a photo and tweak any element to taste.
          </div>
          {autoThumbnailError && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
              <AlertCircle size={13} className="mt-px shrink-0" /> {autoThumbnailError}
            </div>
          )}
        </div>
      </div>

      {/* ── Mini preview + actions ───────────────────────────────── */}
      <div className="grid gap-5 p-5 sm:grid-cols-[260px,1fr] sm:items-center">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner dark:border-white/10 dark:bg-slate-900">
          <div
            className="relative w-full"
            style={{
              aspectRatio: `${template.canvasWidth} / ${template.canvasHeight}`,
              backgroundColor: template.canvasBackground,
            }}
          >
            {miniPreview ? (
              <img
                src={miniPreview}
                alt="Auto thumbnail preview"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                Rendering preview…
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {hasSavedIntro ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Check size={11} /> Using as intro thumbnail
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                <Sparkles size={11} /> Not saved yet
              </span>
            )}
            <span className="text-slate-500 dark:text-slate-400">
              {template.canvasWidth} × {template.canvasHeight} · PNG
            </span>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              Saved templates for {settings.class_name ?? 'Class'} {settings.subject ?? ''}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                className="input h-9 min-w-[180px] flex-1"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name"
              />
              <button type="button" className="btn-secondary btn-sm" onClick={saveCurrentTemplate}>
                Save template
              </button>
            </div>
            {savedTemplates.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {savedTemplates.map((item) => (
                  <span key={item.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5">
                    <button type="button" className="font-medium text-brand-700 dark:text-brand-300" onClick={() => loadSavedTemplate(item.id)}>
                      {item.name}
                    </button>
                    <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => deleteSavedTemplate(item.id)} title="Delete saved template">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {templateSaveStatus && (
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {templateSaveStatus}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={onUseAutoThumbnail}
              disabled={autoThumbnailSaving || hasSavedIntro}
            >
              <Check size={13} /> {autoThumbnailSaving ? 'Saving…' : hasSavedIntro ? 'Already saved' : 'Use this thumbnail'}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={onToggleAutoThumbnailEdit}
            >
              <FileText size={13} /> {autoThumbnailEditOpen ? 'Close editor' : 'Edit'}
            </button>
            <label className="btn-ghost btn-sm cursor-pointer">
              <Upload size={13} /> Replace with upload
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onAutoThumbnailSideImage(file)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Tip: edit the green canvas, the yellow header bar, the chapter pill, or drop in your own image — everything updates the preview live.
          </div>
        </div>
      </div>

      {/* ── Visual editor ────────────────────────────────────────── */}
      {autoThumbnailEditOpen && (
        <div className="border-t border-slate-200 dark:border-white/10">
          <ThumbnailVisualEditor
            settings={settings}
            text={text}
            onChange={onChange}
            onAutoThumbnailSideImage={onAutoThumbnailSideImage}
          />
        </div>
      )}
    </div>
  )
}

const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type InspectorTab = 'content' | 'style' | 'layout' | 'layers'

const PRESET_LABELS: Record<string, string> = {
  leftPanel: 'Left panel',
  rightPanel: 'Right image background',
  title: 'Header bar - class & subject',
  chapterLabel: 'Chapter label (पाठ N)',
  chapterLine1: 'Chapter title - line 1',
  chapterLine2: 'Chapter title - line 2',
  chapterLine3: 'Chapter title - line 3',
  labelNew: 'New badge',
  labelChapter: 'Chapter badge',
  rightImage: 'Right image',
  badgeYear: 'Year starburst',
  badgeNew: 'New starburst',
}

function ThumbnailVisualEditor({
  settings,
  text,
  onChange,
  onAutoThumbnailSideImage,
}: {
  settings: GenerateSettings
  text: string
  onChange: Setter
  onAutoThumbnailSideImage: (file: File | null) => void
}) {
  const template = useMemo(
    () => buildAutoThumbnailTemplate(settings, text),
    [settings, text],
  )
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return template.elements.chapterLine1?.id ?? null
  })
  const tab = 'content' as InspectorTab
  const [canvasScale, setCanvasScale] = useState(1)
  const frameRef = useRef<HTMLDivElement | null>(null)

  // Render the canvas-derived preview every time the template changes — the
  // <img> *is* the real output, so the editor matches the saved PNG exactly.
  const selected = selectedId ? template.elements[selectedId] : undefined
  const overrides = settings.auto_thumbnail_overrides ?? {}
  const added = settings.auto_thumbnail_added_elements ?? {}
  const hidden = settings.auto_thumbnail_hidden_elements ?? []

  const isAddedElement = (id: string) => Boolean(added[id])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const updateScale = () => {
      const rect = frame.getBoundingClientRect()
      setCanvasScale(rect.width > 0 ? rect.width / template.canvasWidth : 1)
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [template.canvasWidth])

  const patchElement = (id: string, patch: Partial<ThumbnailElement>) => {
    onChange('auto_thumbnail_overrides', {
      ...overrides,
      [id]: { ...((overrides[id] as Partial<ThumbnailElement>) ?? {}), ...patch },
    })
  }

  const patchSelected = (patch: Partial<ThumbnailElement>) => {
    if (!selected) return
    patchElement(selected.id, patch)
  }

  const clearSelectedOverride = () => {
    if (!selected) return
    if (isAddedElement(selected.id)) return
    const next = { ...overrides }
    delete next[selected.id]
    onChange('auto_thumbnail_overrides', next)
  }

  const removeSelected = () => {
    if (!selected) return
    if (isAddedElement(selected.id)) {
      const next = { ...added }
      delete next[selected.id]
      onChange('auto_thumbnail_added_elements', next)
      setSelectedId(null)
      return
    }
    if (!hidden.includes(selected.id)) {
      onChange('auto_thumbnail_hidden_elements', [...hidden, selected.id])
    }
    setSelectedId(null)
  }

  const restoreElement = (id: string) => {
    if (!hidden.includes(id)) return
    onChange('auto_thumbnail_hidden_elements', hidden.filter((x) => x !== id))
  }

  const duplicateSelected = () => {
    if (!selected) return
    const id = nextElementId('copy')
    const copy = duplicateElement(selected, id)
    onChange('auto_thumbnail_added_elements', {
      ...added,
      [id]: copy as unknown as Record<string, unknown>,
    })
    setSelectedId(id)
  }

  const bringToFront = () => {
    const maxZ = Math.max(0, ...Object.values(template.elements).map((e) => e.zIndex ?? 5))
    patchSelected({ zIndex: maxZ + 1 })
  }

  const sendToBack = () => {
    const minZ = Math.min(0, ...Object.values(template.elements).map((e) => e.zIndex ?? 5))
    patchSelected({ zIndex: minZ - 1 })
  }

  const resetAllOverrides = () => {
    onChange('auto_thumbnail_overrides', undefined)
    onChange('auto_thumbnail_added_elements', undefined)
    onChange('auto_thumbnail_hidden_elements', undefined)
    onChange('auto_thumbnail_canvas_background', undefined)
  }

  const startDrag = (
    e: React.PointerEvent<HTMLElement>,
    element: ThumbnailElement,
    mode: 'move' | ResizeHandle,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(element.id)
    if (element.locked) return
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const sx = template.canvasWidth / rect.width
    const sy = template.canvasHeight / rect.height
    const startX = (e.clientX - rect.left) * sx
    const startY = (e.clientY - rect.top) * sy
    const start = {
      posX: element.posX,
      posY: element.posY,
      width: element.width ?? 120,
      height: element.height ?? 80,
    }
    const onMove = (event: PointerEvent) => {
      const x = (event.clientX - rect.left) * sx
      const y = (event.clientY - rect.top) * sy
      const dx = x - startX
      const dy = y - startY
      if (mode === 'move') {
        patchElement(element.id, {
          posX: Math.round(start.posX + dx),
          posY: Math.round(start.posY + dy),
        })
      } else {
        const next = { ...start }
        if (mode.includes('e')) next.width = Math.max(20, Math.round(start.width + dx))
        if (mode.includes('s')) next.height = Math.max(20, Math.round(start.height + dy))
        if (mode.includes('w')) {
          const newW = Math.max(20, Math.round(start.width - dx))
          next.posX = Math.round(start.posX + (start.width - newW))
          next.width = newW
        }
        if (mode.includes('n')) {
          const newH = Math.max(20, Math.round(start.height - dy))
          next.posY = Math.round(start.posY + (start.height - newH))
          next.height = newH
        }
        patchElement(element.id, next)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selected || selected.locked) return
    if (NUDGE_KEYS[e.key]) {
      e.preventDefault()
      const [dx, dy] = NUDGE_KEYS[e.key]
      const step = e.shiftKey ? 10 : 1
      patchSelected({
        posX: selected.posX + dx * step,
        posY: selected.posY + dy * step,
      })
    } else if (e.key === 'Escape') {
      setSelectedId(null)
    }
  }

  const orderedElements = Object.values(template.elements)
    .filter((el) => el.visible !== false)
    .sort((a, b) => (a.zIndex ?? 5) - (b.zIndex ?? 5))

  const allElements = Object.values(template.elements).sort(
    (a, b) => (b.zIndex ?? 5) - (a.zIndex ?? 5),
  )

  return (
    <div className="bg-slate-50 dark:bg-slate-950/30">
      {/* ── Project metadata bar ─────────────────────────────────── */}
      <div className="hidden">
        <Field label="Chapter #">
          <input
            className="input h-9"
            style={{ width: 70 }}
            value={settings.auto_thumbnail_chapter_num ?? ''}
            onChange={(e) => onChange('auto_thumbnail_chapter_num', e.target.value)}
            placeholder="2"
          />
        </Field>
        <Field label="Year">
          <input
            className="input h-9"
            style={{ width: 90 }}
            value={settings.auto_thumbnail_year ?? '2083'}
            onChange={(e) => onChange('auto_thumbnail_year', e.target.value)}
            placeholder="2083"
          />
        </Field>
        <Field label="Chapter prefix">
          <input
            className="input h-9"
            style={{ width: 110 }}
            value={settings.auto_thumbnail_chapter_prefix ?? ''}
            onChange={(e) => onChange('auto_thumbnail_chapter_prefix', e.target.value)}
            placeholder="पाठ"
          />
        </Field>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label="Canvas background">
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-12 rounded-md border border-slate-200 bg-white"
                value={asHexColor(settings.auto_thumbnail_canvas_background ?? template.canvasBackground, '#4caf50')}
                onChange={(e) => onChange('auto_thumbnail_canvas_background', e.target.value)}
              />
              {settings.auto_thumbnail_canvas_background && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => onChange('auto_thumbnail_canvas_background', undefined)}
                  title="Reset canvas background"
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
          </Field>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={resetAllOverrides}
            title="Reset every customisation back to the defaults"
          >
            <RotateCcw size={12} /> Reset all
          </button>
        </div>
      </div>

      {/* ── Workspace ────────────────────────────────────────────── */}
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr),360px]">
        {/* — Canvas + add bar — */}
        <div className="min-w-0">
          <div className="grid grid-cols-[32px_minmax(0,1fr)] grid-rows-[24px_auto] gap-0 rounded-xl bg-slate-100 p-2 dark:bg-slate-900/40">
            <div />
            <ThumbnailRuler orientation="horizontal" />
            <ThumbnailRuler orientation="vertical" />
          <div
            ref={frameRef}
            data-thumbnail-frame="true"
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="relative w-full overflow-hidden rounded-xl border border-slate-300 bg-slate-200 shadow-sm outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/10 dark:bg-slate-900"
            style={{
              aspectRatio: `${template.canvasWidth} / ${template.canvasHeight}`,
              backgroundColor: template.canvasBackground,
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null)
            }}
          >
            {orderedElements.map((el) => (
              <ThumbnailEditableElement
                key={el.id}
                element={el}
                selected={selectedId === el.id}
                canvasWidth={template.canvasWidth}
                canvasHeight={template.canvasHeight}
                canvasScale={canvasScale}
                onPointerDown={(event, mode) => startDrag(event, el, mode)}
                onSelect={() => setSelectedId(el.id)}
              />
            ))}
          </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-slate-950/40">
            <span className="px-1 text-xs text-slate-500 dark:text-slate-400">
              Select a box to edit. Drag to move, use corner handles to resize, arrow keys nudge position.
            </span>
            <span className="hidden">
              Drag to move · Shift+arrows = 10px · ⌘D duplicates · Del removes
            </span>
          </div>
        </div>

        {/* — Inspector — */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/40">
          {/* Selected element header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {selected ? 'Editing' : 'Inspector'}
              </div>
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                {selected ? elementDisplayName(selected) : 'Click anything on the canvas to edit it'}
              </div>
            </div>
            {selected && (
              <button
                type="button"
                className="btn-ghost btn-sm shrink-0"
                onClick={() => setSelectedId(null)}
                title="Deselect"
              >
                ×
              </button>
            )}
          </div>

          {/* Tab strip */}
          <div className="hidden" />

          {/* Tab body */}
          <div className="p-4 text-sm">
            {tab === 'layers' ? (
              <LayersPanel
                allElements={allElements}
                selectedId={selectedId}
                hidden={hidden}
                added={added}
                onSelect={setSelectedId}
                onToggleVisibility={(el) => {
                  if (isAddedElement(el.id)) {
                    patchElement(el.id, { visible: !(el.visible !== false) })
                    return
                  }
                  if (hidden.includes(el.id)) restoreElement(el.id)
                  else onChange('auto_thumbnail_hidden_elements', [...hidden, el.id])
                }}
                onToggleLock={(el) => patchElement(el.id, { locked: !el.locked })}
                onBringFront={(el) => patchElement(el.id, {
                  zIndex: Math.max(0, ...Object.values(template.elements).map((e) => e.zIndex ?? 5)) + 1,
                })}
                onSendBack={(el) => patchElement(el.id, {
                  zIndex: Math.min(0, ...Object.values(template.elements).map((e) => e.zIndex ?? 5)) - 1,
                })}
                onRemove={(el) => {
                  setSelectedId(el.id)
                  removeSelected()
                }}
              />
            ) : !selected ? (
              <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                <Sparkles size={14} className="text-brand-500" />
                <div>
                  Click any element on the preview — the header bar, the chapter title, the side photo — to edit it here. Or use the toolbar below the canvas to add new text, shapes and badges.
                </div>
              </div>
            ) : tab === 'content' ? (
              <ContentTab
                selected={selected}
                settings={settings}
                patchSelected={patchSelected}
                onAutoThumbnailSideImage={onAutoThumbnailSideImage}
                onReset={clearSelectedOverride}
              />
            ) : tab === 'style' ? (
              <StyleTab selected={selected} patchSelected={patchSelected} />
            ) : (
              <LayoutTab
                selected={selected}
                patchSelected={patchSelected}
                duplicateSelected={duplicateSelected}
                bringToFront={bringToFront}
                sendToBack={sendToBack}
                clearSelectedOverride={clearSelectedOverride}
                removeSelected={removeSelected}
                isCustom={isAddedElement(selected.id)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Inspector tabs ────────────────────────── */

function ContentTab({
  selected,
  settings,
  patchSelected,
  onAutoThumbnailSideImage,
  onReset,
}: {
  selected: ThumbnailElement
  settings: GenerateSettings
  patchSelected: (patch: Partial<ThumbnailElement>) => void
  onAutoThumbnailSideImage: (file: File | null) => void
  onReset: () => void
}) {
  if (selected.type === 'image') {
    return (
      <div className="space-y-3">
        <Field label="Image">
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-secondary btn-sm cursor-pointer">
              <Upload size={12} /> {settings.auto_thumbnail_side_image_url ? 'Replace' : 'Upload'} image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onAutoThumbnailSideImage(file)
                  e.target.value = ''
                }}
              />
            </label>
            {settings.auto_thumbnail_side_image_url && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => onAutoThumbnailSideImage(null)}
              >
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
        </Field>
        <button type="button" className="btn-ghost btn-sm" onClick={onReset}>
          <RotateCcw size={12} /> Reset selected
        </button>
      </div>
    )
  }

  const isText = selected.type !== 'panel' && selected.type !== 'shape'

  return (
    <div className="space-y-4">
      {isText && (
        <>
          <Field label="Text">
            <textarea
              className="textarea h-24"
              value={selected.text}
              onChange={(e) => patchSelected({ text: e.target.value })}
            />
          </Field>
          <Field label={`Font size (${selected.fontSize}px)`}>
            <input
              type="range"
              min={12}
              max={120}
              className="w-full"
              value={selected.fontSize}
              onChange={(e) => patchSelected({ fontSize: Number(e.target.value) })}
            />
          </Field>
          <Field label="Text colour">
            <input
              type="color"
              className="h-10 w-full rounded-md border border-slate-200 bg-white"
              value={asHexColor(selected.color, '#000000')}
              onChange={(e) => patchSelected({ color: e.target.value })}
            />
          </Field>
        </>
      )}
      <Field label="Box colour">
        <input
          type="color"
          className="h-10 w-full rounded-md border border-slate-200 bg-white"
          value={asHexColor(selected.backgroundColor, '#ffffff')}
          onChange={(e) => patchSelected({ backgroundColor: e.target.value })}
        />
      </Field>
      <button type="button" className="btn-ghost btn-sm" onClick={onReset}>
        <RotateCcw size={12} /> Reset selected
      </button>
    </div>
  )
}

function StyleTab({
  selected,
  patchSelected,
}: {
  selected: ThumbnailElement
  patchSelected: (patch: Partial<ThumbnailElement>) => void
}) {
  const isText = selected.type !== 'panel' && selected.type !== 'shape' && selected.type !== 'image'
  return (
    <div className="space-y-4">
      {isText && (
        <div className="grid grid-cols-2 gap-3">
          <NumField
            step="thumbnail" name="selected_font_size" label="Font size"
            value={selected.fontSize}
            onChange={(v) => patchSelected({ fontSize: Math.max(8, v) })}
          />
          <Field label="Weight">
            <select
              className="input h-9"
              value={selected.fontWeight}
              onChange={(e) => patchSelected({ fontWeight: e.target.value })}
            >
              <option value="400">Regular</option>
              <option value="500">Medium</option>
              <option value="600">Semibold</option>
              <option value="700">Bold</option>
              <option value="800">Extra-bold</option>
              <option value="900">Black</option>
            </select>
          </Field>
          <Field label="Align">
            <select
              className="input h-9"
              value={selected.textAlign ?? 'center'}
              onChange={(e) =>
                patchSelected({ textAlign: e.target.value as ThumbnailElement['textAlign'] })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Field>
          <NumField
            step="thumbnail" name="sel_letter" label="Letter spacing"
            value={selected.letterSpacing ?? 0}
            onChange={(v) => patchSelected({ letterSpacing: v })}
          />
          <Field label="Text colour">
            <input
              type="color"
              className="h-9 w-full rounded-md border border-slate-200 bg-white"
              value={asHexColor(selected.color, '#000000')}
              onChange={(e) => patchSelected({ color: e.target.value })}
            />
          </Field>
          <NumField
            step="thumbnail" name="sel_shadow_blur" label="Text shadow"
            value={selected.shadowBlur ?? 0}
            onChange={(v) => patchSelected({ shadowBlur: Math.max(0, v) })}
          />
          <NumField
            step="thumbnail" name="sel_stroke" label="Outline width"
            value={selected.strokeWidth ?? 0}
            onChange={(v) => patchSelected({ strokeWidth: Math.max(0, v) })}
          />
          {(selected.strokeWidth ?? 0) > 0 && (
            <Field label="Outline colour">
              <input
                type="color"
                className="h-9 w-full rounded-md border border-slate-200 bg-white"
                value={asHexColor(selected.strokeColor ?? '#000000', '#000000')}
                onChange={(e) => patchSelected({ strokeColor: e.target.value })}
              />
            </Field>
          )}
        </div>
      )}
      {selected.type !== 'image' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fill">
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-12 rounded-md border border-slate-200 bg-white"
                value={asHexColor(selected.backgroundColor, '#ffffff')}
                onChange={(e) => patchSelected({ backgroundColor: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => patchSelected({ backgroundColor: 'transparent' })}
                title="Make fill transparent"
              >
                Clear
              </button>
            </div>
          </Field>
          <NumField
            step="thumbnail" name="sel_radius" label="Corner radius"
            value={selected.borderRadius}
            onChange={(v) => patchSelected({ borderRadius: Math.max(0, v) })}
          />
        </div>
      )}
      {selected.type === 'shape' && (
        <Field label="Shape">
          <select
            className="input h-9"
            value={selected.shapeType ?? 'rectangle'}
            onChange={(e) => patchSelected({ shapeType: e.target.value as ThumbnailShapeType })}
          >
            <option value="rectangle">Rectangle</option>
            <option value="pill">Pill</option>
            <option value="circle">Circle</option>
            <option value="line">Line</option>
          </select>
        </Field>
      )}
      <NumField
        step="thumbnail" name="sel_opacity" label="Opacity (%)"
        value={selected.opacity ?? 100}
        onChange={(v) => patchSelected({ opacity: Math.max(0, Math.min(100, v)) })}
      />
    </div>
  )
}

function LayoutTab({
  selected,
  patchSelected,
  duplicateSelected,
  bringToFront,
  sendToBack,
  clearSelectedOverride,
  removeSelected,
  isCustom,
}: {
  selected: ThumbnailElement
  patchSelected: (patch: Partial<ThumbnailElement>) => void
  duplicateSelected: () => void
  bringToFront: () => void
  sendToBack: () => void
  clearSelectedOverride: () => void
  removeSelected: () => void
  isCustom: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <NumField step="thumbnail" name="sel_x" label="X" value={selected.posX} onChange={(v) => patchSelected({ posX: v })} />
        <NumField step="thumbnail" name="sel_y" label="Y" value={selected.posY} onChange={(v) => patchSelected({ posY: v })} />
        <NumField step="thumbnail" name="sel_w" label="Width" value={selected.width ?? 0} onChange={(v) => patchSelected({ width: Math.max(20, v) })} />
        <NumField step="thumbnail" name="sel_h" label="Height" value={selected.height ?? 0} onChange={(v) => patchSelected({ height: Math.max(20, v) })} />
        <NumField step="thumbnail" name="sel_rot" label="Rotation°" value={selected.rotation ?? 0} onChange={(v) => patchSelected({ rotation: v })} />
        <NumField step="thumbnail" name="sel_z" label="Z-index" value={selected.zIndex ?? 5} onChange={(v) => patchSelected({ zIndex: v })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={duplicateSelected}>
          <CopyIcon size={12} /> Duplicate
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={bringToFront} title="Bring to front">
          <Layers size={12} /> Front
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={sendToBack} title="Send to back">
          <Layers size={12} /> Back
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => patchSelected({ locked: !selected.locked })}
        >
          {selected.locked ? <Unlock size={12} /> : <Lock size={12} />}
          {selected.locked ? 'Unlock' : 'Lock'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => patchSelected({ visible: !(selected.visible !== false) })}
        >
          {selected.visible !== false ? <EyeOff size={12} /> : <Eye size={12} />}
          {selected.visible !== false ? 'Hide' : 'Show'}
        </button>
        {!isCustom && (
          <button type="button" className="btn-ghost btn-sm" onClick={clearSelectedOverride} title="Reset overrides for this element">
            <RotateCcw size={12} /> Reset
          </button>
        )}
        <button type="button" className="btn-ghost btn-sm text-rose-600 dark:text-rose-300" onClick={removeSelected}>
          <Trash2 size={12} /> Remove
        </button>
      </div>
    </div>
  )
}

function LayersPanel({
  allElements,
  selectedId,
  hidden,
  added,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onBringFront,
  onSendBack,
  onRemove,
}: {
  allElements: ThumbnailElement[]
  selectedId: string | null
  hidden: string[]
  added: NonNullable<GenerateSettings['auto_thumbnail_added_elements']>
  onSelect: (id: string) => void
  onToggleVisibility: (el: ThumbnailElement) => void
  onToggleLock: (el: ThumbnailElement) => void
  onBringFront: (el: ThumbnailElement) => void
  onSendBack: (el: ThumbnailElement) => void
  onRemove: (el: ThumbnailElement) => void
}) {
  return (
    <div className="space-y-1">
      {allElements.map((el) => {
        const isHidden = el.visible === false || hidden.includes(el.id)
        const isCustom = Boolean(added[el.id])
        const isSelected = selectedId === el.id
        return (
          <div
            key={el.id}
            className={
              'flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors ' +
              (isSelected
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                : 'border-transparent hover:bg-slate-50 dark:hover:bg-white/5')
            }
            onClick={() => onSelect(el.id)}
          >
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
              onClick={(e) => { e.stopPropagation(); onToggleVisibility(el) }}
              title={isHidden ? 'Show' : 'Hide'}
            >
              {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
              onClick={(e) => { e.stopPropagation(); onToggleLock(el) }}
              title={el.locked ? 'Unlock' : 'Lock'}
            >
              {el.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            <span className="ml-1 min-w-0 flex-1 truncate">
              {elementDisplayName(el)}
              {isCustom && <span className="ml-1 text-[10px] uppercase text-brand-600">+ added</span>}
            </span>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              onClick={(e) => { e.stopPropagation(); onBringFront(el) }}
              title="Bring forward"
            >
              ▲
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              onClick={(e) => { e.stopPropagation(); onSendBack(el) }}
              title="Send back"
            >
              ▼
            </button>
            <button
              type="button"
              className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              onClick={(e) => { e.stopPropagation(); onRemove(el) }}
              title="Remove / hide"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function elementDisplayName(el: ThumbnailElement): string {
  const friendly = PRESET_LABELS[el.id]
  if (friendly) return friendly
  const text = (el.text || '').replace(/\s+/g, ' ').trim().slice(0, 32)
  if (text) return text
  if (el.type === 'shape') return `Shape (${el.shapeType ?? 'rectangle'})`
  if (el.type === 'image') return 'Image'
  if (el.type === 'badge') return 'Badge'
  return el.type
}

function ThumbnailRuler({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const ticks = Array.from({ length: 9 }, (_, index) => index)
  const horizontal = orientation === 'horizontal'
  return (
    <div
      className={
        'relative overflow-hidden bg-slate-200 text-[9px] text-slate-500 dark:bg-slate-800 dark:text-slate-400 ' +
        (horizontal ? 'h-6 rounded-t-md border-b border-slate-300 dark:border-white/10' : 'w-8 rounded-l-md border-r border-slate-300 dark:border-white/10')
      }
    >
      {ticks.map((tick) => {
        const pct = (tick / (ticks.length - 1)) * 100
        return (
          <span
            key={tick}
            className="absolute bg-slate-400 dark:bg-slate-500"
            style={
              horizontal
                ? { left: `${pct}%`, bottom: 0, width: 1, height: tick % 2 === 0 ? 12 : 7 }
                : { top: `${pct}%`, right: 0, width: tick % 2 === 0 ? 12 : 7, height: 1 }
            }
          />
        )
      })}
      {ticks.filter((tick) => tick % 2 === 0).map((tick) => {
        const pct = (tick / (ticks.length - 1)) * 100
        return (
          <span
            key={`label-${tick}`}
            className="absolute leading-none"
            style={
              horizontal
                ? { left: `calc(${pct}% + 3px)`, top: 3 }
                : { top: `calc(${pct}% + 3px)`, left: 3 }
            }
          >
            {tick * 10}
          </span>
        )
      })}
    </div>
  )
}

function ThumbnailEditableElement({
  element,
  selected,
  canvasWidth,
  canvasHeight,
  canvasScale,
  onPointerDown,
  onSelect,
}: {
  element: ThumbnailElement
  selected: boolean
  canvasWidth: number
  canvasHeight: number
  canvasScale: number
  onPointerDown: (event: React.PointerEvent<HTMLElement>, mode: 'move' | ResizeHandle) => void
  onSelect: () => void
}) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${(element.posX / canvasWidth) * 100}%`,
    top: `${(element.posY / canvasHeight) * 100}%`,
    width: `${((element.width ?? 120) / canvasWidth) * 100}%`,
    height: `${((element.height ?? 80) / canvasHeight) * 100}%`,
    zIndex: (element.zIndex ?? 5) + 100,
    cursor: element.locked ? 'default' : 'move',
    userSelect: 'none',
    border: selected
      ? '2px solid rgb(var(--brand-500))'
      : '1px dashed rgba(148, 163, 184, 0.0)',
    background: 'transparent',
    boxShadow: selected ? '0 0 0 2px rgba(var(--brand-500), 0.18)' : undefined,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    transformOrigin: 'center',
  }
  const isText = element.type !== 'panel' && element.type !== 'shape' && element.type !== 'image'
  const fill = element.backgroundColor && element.backgroundColor !== 'transparent'
    ? element.backgroundColor
    : 'transparent'
  const liveStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      (element.textAlign ?? 'center') === 'left'
        ? 'flex-start'
        : (element.textAlign ?? 'center') === 'right'
          ? 'flex-end'
          : 'center',
    overflow: 'hidden',
    padding: `${(element.paddingY ?? 0) * canvasScale}px ${(element.paddingX ?? 0) * canvasScale}px`,
    borderRadius: element.borderRadius * canvasScale,
    backgroundColor: fill,
    color: element.color,
    fontFamily: element.fontFamily,
    fontSize: `${element.fontSize * canvasScale}px`,
    fontWeight: element.fontWeight as React.CSSProperties['fontWeight'],
    textAlign: element.textAlign ?? 'center',
    lineHeight: 1.08,
    whiteSpace: 'pre-line',
    pointerEvents: 'none',
  }
  if (element.type === 'badge' && !element.borderRadius) {
    liveStyle.clipPath = 'polygon(50% 0%, 58% 14%, 73% 7%, 76% 24%, 93% 27%, 86% 42%, 100% 50%, 86% 58%, 93% 73%, 76% 76%, 73% 93%, 58% 86%, 50% 100%, 42% 86%, 27% 93%, 24% 76%, 7% 73%, 14% 58%, 0% 50%, 14% 42%, 7% 27%, 24% 24%, 27% 7%, 42% 14%)'
  }
  if (element.type === 'image') {
    liveStyle.backgroundColor = element.backgroundColor || '#111111'
    liveStyle.backgroundImage = element.imageUrl ? `url("${element.imageUrl}")` : undefined
    liveStyle.backgroundSize = element.imageZoom ? `${element.imageZoom}% auto` : 'cover'
    liveStyle.backgroundPosition = `${element.imageOffsetX ?? 50}% ${element.imageOffsetY ?? 50}%`
    liveStyle.backgroundRepeat = 'no-repeat'
  }

  return (
    <div
      style={style}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.border = '1px dashed rgba(148, 163, 184, 0.65)'
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.border = '1px dashed rgba(148, 163, 184, 0)'
      }}
    >
      <div style={liveStyle}>
        {isText ? element.text : element.type === 'image' && !element.imageUrl ? '' : null}
      </div>
      {selected && !element.locked && (
        <>
          {(['nw', 'ne', 'sw', 'se'] as ResizeHandle[]).map((h) => (
            <span
              key={h}
              className="absolute h-3 w-3 rounded-full bg-white shadow ring-2 ring-brand-500"
              style={{
                top: h.includes('n') ? -6 : undefined,
                bottom: h.includes('s') ? -6 : undefined,
                left: h.includes('w') ? -6 : undefined,
                right: h.includes('e') ? -6 : undefined,
                cursor:
                  h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize',
              }}
              onPointerDown={(e) => onPointerDown(e, h)}
            />
          ))}
          {(['n', 's', 'e', 'w'] as ResizeHandle[]).map((h) => (
            <span
              key={h}
              className="absolute h-2.5 w-2.5 rounded-sm bg-white shadow ring-2 ring-brand-500"
              style={{
                top: h === 'n' ? -5 : h === 's' ? undefined : '50%',
                bottom: h === 's' ? -5 : undefined,
                left: h === 'w' ? -5 : h === 'e' ? undefined : '50%',
                right: h === 'e' ? -5 : undefined,
                transform:
                  h === 'n' || h === 's' ? 'translateX(-50%)' : 'translateY(-50%)',
                cursor: h === 'n' || h === 's' ? 'ns-resize' : 'ew-resize',
              }}
              onPointerDown={(e) => onPointerDown(e, h)}
            />
          ))}
        </>
      )}
    </div>
  )
}

function asHexColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function ThumbnailSlot({
  kind,
  title,
  position,
  enabled,
  filename,
  generatedPreviewUrl,
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
  generatedPreviewUrl: string | null
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
  const previewSrc = trimmed ? api.thumbnailUrl(trimmed) : generatedPreviewUrl

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
                {uploading
                  ? 'Uploading...'
                  : trimmed || generatedPreviewUrl
                    ? 'Replace image'
                    : 'Upload image'}
                <input
                  id={fieldId('thumbnail', fileFieldName)}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  className="hidden"
                  onChange={onPickFile}
                  disabled={uploading}
                />
              </label>
              {previewSrc && (
                <div className="rounded-md border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-white/[0.03]">
                  <img
                    src={previewSrc}
                    alt={`${title} preview`}
                    className="aspect-video w-full rounded object-cover"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                        {trimmed || 'Auto-generated preview'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {trimmed ? 'Stored on backend' : 'Will be uploaded when the run starts'}
                      </div>
                    </div>
                    {trimmed && (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => onFilenameChange('')}
                      >
                        Remove
                      </button>
                    )}
                  </div>
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
          description="Distribute at least 500 seconds across inserted screenshot slides for video exports."
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
        {state.status === 'error' && !state.rejectedReason && (
          <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>
        )}
        {state.status === 'cancelled' && (
          <span className="text-sm text-amber-600 dark:text-amber-400">Cancelled</span>
        )}
      </div>
      {state.status === 'error' && state.rejectedReason && (
        <BackendRejectedBanner
          reason={state.rejectedReason}
          message={state.error ?? 'Backend rejected the run.'}
        />
      )}
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
        {required && <span className="ml-1 text-rose-500 dark:text-rose-400">*</span>}
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
