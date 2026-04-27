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
  inputText?: string
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
  /**
   * True when the queue stopped auto-dispatching after a backend
   * rejection. `resumeQueue()` (or any new `enqueueX` call) clears it.
   */
  paused: boolean
  /** Reason the queue is currently paused, when applicable. */
  pausedReason: 'in_flight' | 'duplicate' | 'unknown' | null
  cancel: () => void
  cancelQueued: (queueId: string) => void
  /** Manually resume auto-dispatch after a 409-induced pause. */
  resumeQueue: () => void
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
  // Set to true in `dispatch()` once we've actually fired the underlying
  // generate call, cleared once the run terminates. Without this flag the
  // auto-dequeue effect can race with `pushOrStart` and pop the just-claimed
  // item before the worker even started.
  const activeStartedRef = useRef(false)
  // When the backend rejects the active run with 409 the next item in the
  // queue would 409 too — pause auto-dispatch and surface a banner so the
  // user can decide. Cleared on `resumeQueue()` or the next manual enqueue.
  const [paused, setPaused] = useState(false)
  const [pausedReason, setPausedReason] = useState<
    'in_flight' | 'duplicate' | 'unknown' | null
  >(null)

  // Connect generation events → runs store. Lifts the "run row" into
  // existence as soon as the SSE stream reports `running`, finishes it on
  // terminal events. We also create the row on a *terminal* state when
  // `pendingRef` is still set — this catches the rare case where the POST
  // 409s before the SSE ever flips to running, so the run still appears
  // in Processes instead of vanishing silently.
  useEffect(() => {
    const s = gen.state

    if (s.status === 'running' && pendingRef.current && !runIdRef.current) {
      runIdRef.current = runs.start(pendingRef.current)
      pendingRef.current = null
      return
    }

    const terminal =
      s.status === 'success' || s.status === 'error' || s.status === 'cancelled'
    if (terminal && pendingRef.current && !runIdRef.current) {
      runIdRef.current = runs.start(pendingRef.current)
      pendingRef.current = null
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
      activeStartedRef.current = true
      if (item.kind === 'text' && item.text !== undefined && item.settings) {
        pendingRef.current = {
          tool: item.tool,
          inputPreview: item.inputPreview,
          inputText: item.inputText ?? item.text,
          settings: item.settings,
        }
        void gen.generate(item.text, item.settings)
      } else if (item.kind === 'html' && item.html !== undefined && item.settings) {
        pendingRef.current = {
          tool: item.tool,
          inputPreview: item.inputPreview,
          inputText: item.inputText ?? item.html,
          settings: item.settings,
        }
        void gen.generateFromHtml(item.html, item.settings)
      } else if (item.kind === 'image' && item.formData) {
        pendingRef.current = {
          tool: item.tool,
          inputPreview: item.inputPreview,
          inputText: item.inputText ?? item.inputPreview,
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
  //
  // Two important guards:
  //   1. `activeStartedRef` — we only act on terminal states that follow a
  //      run we actually dispatched. Without this, a `pushOrStart` claim
  //      committed in the same tick as a previous run's terminal state
  //      (e.g. user submits #2 the instant #1 finishes) gets removed from
  //      the queue here before its dispatch microtask fires.
  //   2. Pause-on-rejection — when the run errored with a backend 409 we
  //      don't auto-fire the next item; doing so would cascade-fail every
  //      queued item with the same reason.
  useEffect(() => {
    const s = gen.state
    if (s.status !== 'success' && s.status !== 'error' && s.status !== 'cancelled') {
      return
    }
    if (!activeStartedRef.current) return
    if (!activeQueueIdRef.current && queue.length === 0) return

    const rejected = s.status === 'error' && s.rejectedReason
    const rejectedReason = s.rejectedReason ?? null

    const timer = window.setTimeout(() => {
      activeStartedRef.current = false
      if (rejected) {
        setPaused(true)
        setPausedReason(rejectedReason ?? 'unknown')
      }
      setQueue((prev) => {
        const finishedId = activeQueueIdRef.current
        const remaining = finishedId ? prev.filter((q) => q.id !== finishedId) : prev
        const next = remaining[0]
        activeQueueIdRef.current = next?.id ?? null
        if (next && !rejected) {
          window.setTimeout(() => dispatch(next), 0)
        }
        return remaining
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [dispatch, gen.state, queue.length])

  const pushOrStart = useCallback(
    (item: QueueItem): EnqueueResult => {
      // Any new manual submission resumes a paused queue — we assume the
      // user has waited out / handled whatever caused the previous 409.
      if (paused) {
        setPaused(false)
        setPausedReason(null)
      }
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
        setQueue((prev) => [...prev, item])
        window.setTimeout(() => dispatch(item), 0)
        return { queueId: item.id, startedImmediately: true }
      }
      setQueue((prev) => [...prev, item])
      return { queueId: item.id, startedImmediately: false }
    },
    [dispatch, gen.state.status, paused],
  )

  const enqueueText = useCallback(
    (tool: RunTool, text: string, settings: GenerateSettings): EnqueueResult =>
      pushOrStart({
        id: nextQueueId(),
        tool,
        kind: 'text',
        inputPreview: text.slice(0, 200),
        inputText: text,
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
        inputText: html,
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
        inputText: meta.files.length ? meta.files.map((f) => f.name).join('\n') : '(image/pdf)',
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

  const resumeQueue = useCallback(() => {
    setPaused(false)
    setPausedReason(null)
    // Pull the next queued item (if any) and fire it. We re-use the
    // dispatch path so all the pendingRef / runIdRef bookkeeping is
    // identical to a fresh submission.
    setQueue((prev) => {
      if (activeQueueIdRef.current) return prev
      const next = prev[0]
      if (!next) return prev
      activeQueueIdRef.current = next.id
      window.setTimeout(() => dispatch(next), 0)
      return prev
    })
  }, [dispatch])

  const value = useMemo<TrackedGenerationContextValue>(
    () => ({
      state: gen.state,
      queue,
      paused,
      pausedReason,
      cancel: gen.cancel,
      cancelQueued,
      resumeQueue,
      reset: gen.reset,
      enqueueText,
      enqueueHtml,
      enqueueImage,
    }),
    [
      gen.state,
      gen.cancel,
      gen.reset,
      queue,
      paused,
      pausedReason,
      cancelQueued,
      resumeQueue,
      enqueueText,
      enqueueHtml,
      enqueueImage,
    ],
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
    paused: ctx.paused,
    pausedReason: ctx.pausedReason,
    resumeQueue: ctx.resumeQueue,
  }
}
