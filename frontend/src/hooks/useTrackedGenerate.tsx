/**
 * Tracked-generation context + run queue.
 *
 * The SSE lifecycle (AbortController, event handlers, accumulated result)
 * lives in a React context mounted at the App level. That way navigating
 * between pages — e.g. from Text→Video's "Start Process" to the Processes
 * tab — doesn't unmount the component that owns the stream and doesn't
 * orphan the in-flight request.
 *
 * A FIFO **queue** sits on top of the single-run executor. Wizards call
 * `generate(...)`; if nothing is running it kicks off immediately, otherwise
 * the job is enqueued and the provider auto-dequeues when the current run
 * reaches a terminal state. This gives users "submit more work while the
 * first run is executing" without any extra UI on the wizards.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useGenerate } from './useGenerate'
import type { GenerationState } from './useGenerate'
import { useRuns } from '../store/runs'
import type { Run, RunTool } from '../store/runs'
import type { GenerateSettings } from '../api/types'

type PendingMeta = Omit<Run, 'id' | 'status' | 'startedAt'>

export type QueueItemKind = 'text' | 'html' | 'image'

export interface QueueItem {
  id: string
  tool: RunTool
  kind: QueueItemKind
  inputPreview: string
  queuedAt: number
  settings?: GenerateSettings
  // payload variants — only one of these is populated per item
  text?: string
  html?: string
  formData?: FormData
  files?: File[]
}

export interface EnqueueResult {
  /** Stable queue id — clients can show this in UI or pass to `cancelQueued`. */
  queueId: string
  /** True when this item started executing immediately (queue was empty). */
  startedImmediately: boolean
}

interface TrackedGenerationContextValue {
  state: GenerationState
  queue: QueueItem[]
  cancel: () => void
  cancelQueued: (queueId: string) => void
  reset: () => void
  enqueueText: (tool: RunTool, text: string, settings: GenerateSettings) => EnqueueResult
  enqueueHtml: (tool: RunTool, html: string, settings: GenerateSettings) => EnqueueResult
  enqueueImage: (
    tool: RunTool,
    formData: FormData,
    meta: { files: File[]; settings?: GenerateSettings },
  ) => EnqueueResult
}

const Ctx = createContext<TrackedGenerationContextValue | null>(null)

let queueCounter = 0
function nextQueueId(): string {
  queueCounter += 1
  return `queue-${Date.now().toString(36)}-${queueCounter}`
}

export function TrackedGenerationProvider({ children }: { children: ReactNode }) {
  const gen = useGenerate()
  const runs = useRuns()
  const runIdRef = useRef<string | null>(null)
  const pendingRef = useRef<PendingMeta | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  // Tracks which queue item (if any) is currently executing so we can pop
  // it when the run terminates. A ref rather than state because the pop
  // happens inside the terminal-state effect and we don't want re-renders
  // to re-trigger it.
  const activeQueueIdRef = useRef<string | null>(null)

  // Connect generation events → runs store. Lifts the "run row" into
  // existence as soon as the SSE stream reports `running`, finishes it on
  // terminal events.
  useEffect(() => {
    const s = gen.state

    if (s.status === 'running' && pendingRef.current && !runIdRef.current) {
      runIdRef.current = runs.start(pendingRef.current)
      pendingRef.current = null
      return
    }

    if (!runIdRef.current) return

    if (s.status === 'success') {
      runs.finish(runIdRef.current, {
        status: 'success',
        htmlFilename: s.result?.html_filename,
        screenshotFiles: s.result?.screenshot_files,
        screenshotFolder: s.result?.screenshot_folder,
        presentationFile: s.result?.presentation_file,
        videoFile: s.result?.video_file,
        operationId: s.result?.operation_id ?? s.operationId,
      })
      runIdRef.current = null
    } else if (s.status === 'error') {
      runs.finish(runIdRef.current, { status: 'error', error: s.error })
      runIdRef.current = null
    } else if (s.status === 'cancelled') {
      runs.finish(runIdRef.current, { status: 'cancelled' })
      runIdRef.current = null
    }
  }, [gen.state, runs])

  // Dispatcher — starts a queue item's generate call. Safe to call with
  // any item kind; chooses the right hook under the hood.
  const dispatch = useCallback(
    (item: QueueItem) => {
      activeQueueIdRef.current = item.id
      if (item.kind === 'text' && item.text !== undefined && item.settings) {
        pendingRef.current = { tool: item.tool, inputPreview: item.inputPreview, settings: item.settings }
        void gen.generate(item.text, item.settings)
      } else if (item.kind === 'html' && item.html !== undefined && item.settings) {
        pendingRef.current = { tool: item.tool, inputPreview: item.inputPreview, settings: item.settings }
        void gen.generateFromHtml(item.html, item.settings)
      } else if (item.kind === 'image' && item.formData) {
        pendingRef.current = {
          tool: item.tool,
          inputPreview: item.inputPreview,
          inputFiles: item.files?.map((f) => f.name),
          settings: item.settings,
        }
        void gen.generateFromImage(item.formData)
      }
    },
    [gen],
  )

  // Auto-dequeue: when the current run terminates, pop the next queue
  // item and kick it off. The short delay gives React a tick to render the
  // "success"/"error" state before we flip back to "running" for the next
  // item — otherwise the UI never flashes the completion state for a run
  // whose successor is queued behind it.
  useEffect(() => {
    const s = gen.state
    if (s.status !== 'success' && s.status !== 'error' && s.status !== 'cancelled') {
      return
    }
    if (!activeQueueIdRef.current && queue.length === 0) return

    const timer = window.setTimeout(() => {
      setQueue((prev) => {
        const finishedId = activeQueueIdRef.current
        activeQueueIdRef.current = null
        if (finishedId) {
          return prev.filter((q) => q.id !== finishedId)
        }
        return prev
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [gen.state, queue.length])

  const pushOrStart = useCallback(
    (item: QueueItem): EnqueueResult => {
      const idleNow =
        gen.state.status === 'idle' ||
        gen.state.status === 'success' ||
        gen.state.status === 'error' ||
        gen.state.status === 'cancelled'
      if (idleNow && !activeQueueIdRef.current) {
        // Claim the active slot *synchronously* so a rapid second submission
        // in the same tick doesn't also see `activeQueueIdRef` as empty and
        // race to dispatch. The real work still defers one tick so React
        // has time to commit the new queue state.
        activeQueueIdRef.current = item.id
        window.setTimeout(() => dispatch(item), 0)
        return { queueId: item.id, startedImmediately: true }
      }
      console.warn('A generation is already running; ignoring duplicate start request.')
      return { queueId: item.id, startedImmediately: false }
    },
    [dispatch, gen.state.status],
  )

  const enqueueText = useCallback(
    (tool: RunTool, text: string, settings: GenerateSettings): EnqueueResult =>
      pushOrStart({
        id: nextQueueId(),
        tool,
        kind: 'text',
        inputPreview: text.slice(0, 200),
        queuedAt: Date.now(),
        text,
        settings,
      }),
    [pushOrStart],
  )

  const enqueueHtml = useCallback(
    (tool: RunTool, html: string, settings: GenerateSettings): EnqueueResult =>
      pushOrStart({
        id: nextQueueId(),
        tool,
        kind: 'html',
        inputPreview: html.slice(0, 200),
        queuedAt: Date.now(),
        html,
        settings,
      }),
    [pushOrStart],
  )

  const enqueueImage = useCallback(
    (
      tool: RunTool,
      formData: FormData,
      meta: { files: File[]; settings?: GenerateSettings },
    ): EnqueueResult =>
      pushOrStart({
        id: nextQueueId(),
        tool,
        kind: 'image',
        inputPreview: meta.files.length ? meta.files.map((f) => f.name).join(', ') : '(image/pdf)',
        queuedAt: Date.now(),
        formData,
        files: meta.files,
        settings: meta.settings,
      }),
    [pushOrStart],
  )

  const cancelQueued = useCallback((queueId: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== queueId || q.id === activeQueueIdRef.current))
  }, [])

  const value = useMemo<TrackedGenerationContextValue>(
    () => ({
      state: gen.state,
      queue,
      cancel: gen.cancel,
      cancelQueued,
      reset: gen.reset,
      enqueueText,
      enqueueHtml,
      enqueueImage,
    }),
    [gen.state, gen.cancel, gen.reset, queue, cancelQueued, enqueueText, enqueueHtml, enqueueImage],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTrackedGenerate(tool: RunTool) {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useTrackedGenerate must be used inside <TrackedGenerationProvider>')
  }
  return useMemo(
    () => ({
      state: ctx.state,
      queue: ctx.queue,
      cancel: ctx.cancel,
      cancelQueued: ctx.cancelQueued,
      reset: ctx.reset,
      // Back-compat aliases so existing wizards keep working verbatim: all
      // three are now enqueues and return void (ignored by old callers).
      generate: (text: string, settings: GenerateSettings) => ctx.enqueueText(tool, text, settings),
      generateFromHtml: (html: string, settings: GenerateSettings) =>
        ctx.enqueueHtml(tool, html, settings),
      generateFromImage: (
        fd: FormData,
        meta?: { files?: File[]; settings?: GenerateSettings },
      ) => ctx.enqueueImage(tool, fd, { files: meta?.files ?? [], settings: meta?.settings }),
    }),
    [ctx, tool],
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGenerationQueue() {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useGenerationQueue must be used inside <TrackedGenerationProvider>')
  }
  return {
    queue: ctx.queue,
    cancelQueued: ctx.cancelQueued,
    cancel: ctx.cancel,
    state: ctx.state,
  }
}
