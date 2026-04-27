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
import { useToast } from '../store/toast'
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
  /**
   * When set, the new submission was a client-side duplicate of an already
   * queued or currently-running item; `queueId` points at that existing
   * item (so callers can still navigate to it) and no new work was
   * enqueued. Wizards show a toast and jump to Processes instead of
   * spawning a second identical run.
   */
  duplicateOf?: 'active' | 'queued'
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
  pauseQueue: () => void
  /** Manually resume auto-dispatch after a 409-induced pause. */
  resumeQueue: () => void
  reorderQueued: (queueId: string, targetQueueId: string) => void
  updateQueued: (queueId: string, patch: Partial<Pick<QueueItem, 'text' | 'html' | 'settings'>>) => void
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

/**
 * Cheap deterministic fingerprint of a queue item's *meaningful* payload.
 * Used to short-circuit client-side duplicates BEFORE the POST reaches the
 * backend — the backend already blocks simultaneous duplicates via the
 * input_fingerprint check, but once the first run finishes the backend
 * happily accepts a second identical submission. A user who
 * re-opens the wizard and clicks Start again (or any transient form of
 * double-dispatch) would otherwise chain a second copy the moment the
 * first completes.
 *
 * djb2 on a normalized payload string. Only needs to be stable within a
 * single browser session, so we don't need crypto.
 */
function fingerprintItem(item: QueueItem): string {
  const settings = item.settings
    ? JSON.stringify(sortedEntries(item.settings as unknown as Record<string, unknown>))
    : ''
  let payload: string
  if (item.kind === 'text') {
    payload = `text|${item.tool}|${(item.text ?? '').trim()}|${settings}`
  } else if (item.kind === 'html') {
    payload = `html|${item.tool}|${(item.html ?? '').trim()}|${settings}`
  } else {
    const fileSig = (item.files ?? [])
      .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
      .join(',')
    payload = `image|${item.tool}|${fileSig}|${settings}`
  }
  let hash = 5381
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}

function sortedEntries(obj: Record<string, unknown>): Array<[string, unknown]> {
  return Object.keys(obj)
    .sort()
    .map((k) => [k, obj[k]] as [string, unknown])
}

export function TrackedGenerationProvider({ children }: { children: ReactNode }) {
  const gen = useGenerate()
  const runs = useRuns()
  const toast = useToast()
  const runIdRef = useRef<string | null>(null)
  const pendingRef = useRef<PendingMeta | null>(null)
  // Queue holds ONLY pending items (never the currently-executing one).
  // The active item is tracked separately via `activeQueueIdRef` /
  // `activeFingerprintRef`. Previously queue[0] was "the running one" and
  // the completion effect filtered it out by id — that created two racing
  // sources of truth (the ref claim in pushOrStart and the filter in the
  // terminal-state effect) and, together with React 19's concurrent
  // rendering, could let the same id get dispatched twice when the first
  // run finished. Keeping the active item out of the queue entirely
  // eliminates that class of races.
  const [queue, setQueue] = useState<QueueItem[]>([])
  const activeQueueIdRef = useRef<string | null>(null)
  // Fingerprint of the currently-executing item, set by `dispatch` and
  // cleared on terminal-state. Used by pushOrStart to client-side-dedupe
  // "user resubmits the same content" before we ever POST.
  const activeFingerprintRef = useRef<string | null>(null)
  // Guards against accidentally dispatching the same queue id twice
  // (StrictMode re-invoking effects, duplicate auto-dequeue firings, etc).
  const dispatchedIdsRef = useRef<Set<string>>(new Set())
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

  useEffect(() => {
    if (gen.state.status !== 'running') return
    let cancelled = false
    let wakeLock: { release: () => Promise<void> } | null = null

    const requestWakeLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
        }
        if (!nav.wakeLock) return
        wakeLock = await nav.wakeLock.request('screen')
        if (cancelled) {
          await wakeLock.release().catch(() => undefined)
          wakeLock = null
        }
      } catch {
        /* Best effort: browser/OS can deny wake lock. */
      }
    }

    void requestWakeLock()
    return () => {
      cancelled = true
      void wakeLock?.release().catch(() => undefined)
    }
  }, [gen.state.status])

  // Dispatcher — starts a queue item's generate call. Safe to call with
  // any item kind; chooses the right hook under the hood. Idempotent: if
  // called twice with the same item id we silently ignore the second call,
  // which defends against double-dispatch from StrictMode / re-render
  // races without changing steady-state behaviour.
  const dispatch = useCallback(
    (item: QueueItem) => {
      if (dispatchedIdsRef.current.has(item.id)) return
      dispatchedIdsRef.current.add(item.id)
      activeQueueIdRef.current = item.id
      activeFingerprintRef.current = fingerprintItem(item)
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
  // Guards:
  //   1. `activeStartedRef` — we only act on terminal states that follow a
  //      run we actually dispatched. Without this, a fresh `pushOrStart`
  //      committed in the same tick as a previous run's terminal state
  //      can be clobbered here.
  //   2. Pause-on-rejection — when the run errored with a backend 409 we
  //      don't auto-fire the next item; doing so would cascade-fail every
  //      queued item with the same reason.
  //
  // Because `queue` now only contains pending items (the running one is
  // tracked separately via `activeQueueIdRef`), we no longer need to
  // filter the completed id out — `queue[0]` IS the next pending item.
  useEffect(() => {
    const s = gen.state
    if (s.status !== 'success' && s.status !== 'error' && s.status !== 'cancelled') {
      return
    }
    if (!activeStartedRef.current) return

    const rejected = s.status === 'error' && s.rejectedReason
    const rejectedReason = s.rejectedReason ?? null

    const timer = window.setTimeout(() => {
      activeStartedRef.current = false
      activeQueueIdRef.current = null
      activeFingerprintRef.current = null
      if (paused) return
      if (rejected) {
        setPaused(true)
        setPausedReason(rejectedReason ?? 'unknown')
        return
      }
      setQueue((prev) => {
        if (prev.length === 0) return prev
        const [next, ...rest] = prev
        activeQueueIdRef.current = next.id
        activeFingerprintRef.current = fingerprintItem(next)
        window.setTimeout(() => dispatch(next), 0)
        return rest
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [dispatch, gen.state, paused])

  const pushOrStart = useCallback(
    (item: QueueItem): EnqueueResult => {
      // Any new manual submission resumes a paused queue — we assume the
      // user has waited out / handled whatever caused the previous 409.
      if (paused) {
        setPaused(false)
        setPausedReason(null)
      }

      // Client-side duplicate guard. Blocks the common "user resubmits the
      // same content while it's already running/queued" path so we don't
      // silently chain a second identical run the moment the first
      // completes. Match against both the active fingerprint and every
      // pending queue entry.
      const fp = fingerprintItem(item)
      if (activeFingerprintRef.current === fp && activeQueueIdRef.current) {
        toast.push({
          variant: 'info',
          title: 'Already running',
          message: 'This exact content is already being processed — opening its progress view.',
        })
        return {
          queueId: activeQueueIdRef.current,
          startedImmediately: false,
          duplicateOf: 'active',
        }
      }
      const existing = queue.find((q) => fingerprintItem(q) === fp)
      if (existing) {
        toast.push({
          variant: 'info',
          title: 'Already queued',
          message: 'This exact content is already queued — opening its entry in Processes.',
        })
        return {
          queueId: existing.id,
          startedImmediately: false,
          duplicateOf: 'queued',
        }
      }

      const idleNow =
        gen.state.status === 'idle' ||
        gen.state.status === 'success' ||
        gen.state.status === 'error' ||
        gen.state.status === 'cancelled'
      if (idleNow && !activeQueueIdRef.current) {
        // Claim the active slot *synchronously* so a rapid second submission
        // in the same tick doesn't also see `activeQueueIdRef` as empty and
        // race to dispatch. The item is NOT appended to `queue` — queue is
        // for pending-only items now; the running one lives in the refs.
        activeQueueIdRef.current = item.id
        activeFingerprintRef.current = fp
        window.setTimeout(() => dispatch(item), 0)
        return { queueId: item.id, startedImmediately: true }
      }
      setQueue((prev) => [...prev, item])
      return { queueId: item.id, startedImmediately: false }
    },
    [dispatch, gen.state.status, paused, queue, toast],
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
    // `queue` only contains pending items now, so a plain filter is safe —
    // no risk of accidentally yanking the in-flight item out of under the
    // dispatcher.
    setQueue((prev) => prev.filter((q) => q.id !== queueId))
  }, [])

  const pauseQueue = useCallback(() => {
    setPaused(true)
    setPausedReason(null)
  }, [])

  const resumeQueue = useCallback(() => {
    setPaused(false)
    setPausedReason(null)
    // Pull the next queued item (if any) and fire it. We re-use the
    // dispatch path so all the pendingRef / runIdRef bookkeeping is
    // identical to a fresh submission.
    setQueue((prev) => {
      if (activeQueueIdRef.current) return prev
      if (prev.length === 0) return prev
      const [next, ...rest] = prev
      activeQueueIdRef.current = next.id
      activeFingerprintRef.current = fingerprintItem(next)
      window.setTimeout(() => dispatch(next), 0)
      return rest
    })
  }, [dispatch])

  const reorderQueued = useCallback((queueId: string, targetQueueId: string) => {
    if (queueId === targetQueueId) return
    setQueue((prev) => {
      const from = prev.findIndex((q) => q.id === queueId)
      const to = prev.findIndex((q) => q.id === targetQueueId)
      if (from < 0 || to < 0) return prev
      const next = prev.slice()
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const updateQueued = useCallback(
    (queueId: string, patch: Partial<Pick<QueueItem, 'text' | 'html' | 'settings'>>) => {
      setQueue((prev) =>
        prev.map((item) => {
          if (item.id !== queueId) return item
          const text = patch.text ?? item.text
          const html = patch.html ?? item.html
          return {
            ...item,
            ...patch,
            inputText: item.kind === 'html' ? html ?? item.inputText : text ?? item.inputText,
            inputPreview:
              item.kind === 'html'
                ? (html ?? item.inputPreview).slice(0, 200)
                : (text ?? item.inputPreview).slice(0, 200),
          }
        }),
      )
    },
    [],
  )

  const value = useMemo<TrackedGenerationContextValue>(
    () => ({
      state: gen.state,
      queue,
      paused,
      pausedReason,
      cancel: gen.cancel,
      cancelQueued,
      pauseQueue,
      resumeQueue,
      reorderQueued,
      updateQueued,
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
      pauseQueue,
      resumeQueue,
      reorderQueued,
      updateQueued,
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
      pauseQueue: ctx.pauseQueue,
      resumeQueue: ctx.resumeQueue,
      reorderQueued: ctx.reorderQueued,
      updateQueued: ctx.updateQueued,
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
    pauseQueue: ctx.pauseQueue,
    state: ctx.state,
    paused: ctx.paused,
    pausedReason: ctx.pausedReason,
    resumeQueue: ctx.resumeQueue,
    reorderQueued: ctx.reorderQueued,
    updateQueued: ctx.updateQueued,
    enqueueText: ctx.enqueueText,
    enqueueHtml: ctx.enqueueHtml,
  }
}
