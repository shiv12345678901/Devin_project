/**
 * Tracked-generation context.
 *
 * The SSE lifecycle (AbortController, event handlers, accumulated result)
 * lives in a React context mounted at the App level. That way navigating
 * between pages — e.g. from Text→Video's "Start Process" to the Processes
 * tab — doesn't unmount the component that owns the stream and doesn't
 * orphan the in-flight request.
 *
 * Consumers still call `useTrackedGenerate('text-to-video')` per page and
 * receive a bound `generate(text, settings)` style API; the only real
 * change is that the underlying state is shared.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useGenerate } from './useGenerate'
import type { GenerationState } from './useGenerate'
import { useRuns } from '../store/runs'
import type { Run, RunTool } from '../store/runs'
import type { GenerateSettings } from '../api/types'

type PendingMeta = Omit<Run, 'id' | 'status' | 'startedAt'>

interface TrackedGenerationContextValue {
  state: GenerationState
  cancel: () => void
  reset: () => void
  generate: (tool: RunTool, text: string, settings: GenerateSettings) => Promise<unknown>
  generateFromHtml: (tool: RunTool, html: string, settings: GenerateSettings) => Promise<unknown>
  generateFromImage: (
    tool: RunTool,
    formData: FormData,
    meta?: { files?: File[]; settings?: GenerateSettings },
  ) => Promise<unknown>
}

const Ctx = createContext<TrackedGenerationContextValue | null>(null)

export function TrackedGenerationProvider({ children }: { children: ReactNode }) {
  const gen = useGenerate()
  const runs = useRuns()
  const runIdRef = useRef<string | null>(null)
  const pendingRef = useRef<PendingMeta | null>(null)

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

  const generate = useCallback(
    (tool: RunTool, text: string, settings: GenerateSettings) => {
      pendingRef.current = { tool, inputPreview: text.slice(0, 200), settings }
      return gen.generate(text, settings)
    },
    [gen],
  )

  const generateFromHtml = useCallback(
    (tool: RunTool, html: string, settings: GenerateSettings) => {
      pendingRef.current = { tool, inputPreview: html.slice(0, 200), settings }
      return gen.generateFromHtml(html, settings)
    },
    [gen],
  )

  const generateFromImage = useCallback(
    (
      tool: RunTool,
      formData: FormData,
      meta?: { files?: File[]; settings?: GenerateSettings },
    ) => {
      const files = meta?.files ?? []
      pendingRef.current = {
        tool,
        inputPreview: files.length ? files.map((f) => f.name).join(', ') : '(image/pdf)',
        inputFiles: files.map((f) => f.name),
        settings: meta?.settings,
      }
      return gen.generateFromImage(formData)
    },
    [gen],
  )

  const value = useMemo<TrackedGenerationContextValue>(
    () => ({
      state: gen.state,
      cancel: gen.cancel,
      reset: gen.reset,
      generate,
      generateFromHtml,
      generateFromImage,
    }),
    [gen.state, gen.cancel, gen.reset, generate, generateFromHtml, generateFromImage],
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
      cancel: ctx.cancel,
      reset: ctx.reset,
      generate: (text: string, settings: GenerateSettings) => ctx.generate(tool, text, settings),
      generateFromHtml: (html: string, settings: GenerateSettings) =>
        ctx.generateFromHtml(tool, html, settings),
      generateFromImage: (
        fd: FormData,
        meta?: { files?: File[]; settings?: GenerateSettings },
      ) => ctx.generateFromImage(tool, fd, meta),
    }),
    [ctx, tool],
  )
}
