import { useCallback, useRef, useState } from 'react'
import { api, streamSse } from '../api/client'
import type { GenerateSettings, SseEvent } from '../api/types'

export interface GenerationResult {
  html_filename?: string
  html_content?: string
  screenshot_files: string[]
  screenshot_folder?: string
  operation_id?: string
}

export interface GenerationState {
  status: 'idle' | 'running' | 'success' | 'error' | 'cancelled'
  stage?: string
  message?: string
  progress: number
  etaSeconds?: number
  error?: string
  result?: GenerationResult
  operationId?: string
}

const initialState: GenerationState = { status: 'idle', progress: 0 }

export function useGenerate() {
  const [state, setState] = useState<GenerationState>(initialState)
  const abortRef = useRef<AbortController | null>(null)
  // Track the live operation id in a ref so cancel() can read it without
  // closing over potentially-stale state. The previous version captured
  // state.operationId via useCallback deps, which meant a Cancel click in
  // the same render that emitted `started` would still cancel `undefined`.
  const opIdRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    opIdRef.current = null
    setState(initialState)
  }, [])

  const runSseJson = useCallback(
    async (
      path: '/generate-sse',
      payload: unknown,
    ): Promise<GenerationResult | null> => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      setState({ status: 'running', progress: 0, message: 'Starting…', stage: 'init' })

      let opId: string | undefined
      opIdRef.current = null
      const result: GenerationResult = { screenshot_files: [] }

      const handle = (ev: SseEvent) => {
        if (ev.type === 'started') {
          opId = ev.operation_id
          opIdRef.current = ev.operation_id ?? null
          setState((s) => ({
            ...s,
            operationId: ev.operation_id,
            etaSeconds: ev.estimated_total_seconds,
            progress: ev.progress ?? s.progress,
          }))
        } else if (ev.type === 'progress') {
          setState((s) => ({
            ...s,
            stage: ev.stage,
            message: ev.message,
            progress: ev.progress,
            etaSeconds: ev.eta_seconds ?? s.etaSeconds,
          }))
        } else if (ev.type === 'html_generated') {
          result.html_filename = ev.html_filename
          result.html_content = ev.html_content
        } else if (ev.type === 'screenshot') {
          result.screenshot_files.push(ev.filename)
          setState((s) => ({
            ...s,
            stage: 'screenshot',
            message: `Captured ${ev.index}/${ev.total}`,
            progress: ev.progress,
          }))
        } else if (ev.type === 'complete') {
          result.html_filename = ev.html_filename ?? result.html_filename
          result.html_content = ev.html_content ?? result.html_content
          result.screenshot_files = ev.screenshot_files ?? result.screenshot_files
          result.screenshot_folder = ev.screenshot_folder
          result.operation_id = ev.operation_id ?? opId
          setState({
            status: 'success',
            progress: 100,
            stage: 'complete',
            message: `Generated ${result.screenshot_files.length} screenshot(s)`,
            result,
            operationId: result.operation_id,
          })
        } else if (ev.type === 'error') {
          setState({ status: 'error', progress: 100, error: ev.message })
        } else if (ev.type === 'cancelled') {
          setState({ status: 'cancelled', progress: 100, message: ev.message })
        }
      }

      try {
        await streamSse(path, {
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
          signal: ctl.signal,
          onEvent: handle,
        })
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setState((s) => ({
            ...s,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }))
        }
        return null
      }
      return result.screenshot_files.length > 0 ? result : null
    },
    [],
  )

  const runSseForm = useCallback(
    async (path: '/image-to-screenshots-sse', formData: FormData): Promise<GenerationResult | null> => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      setState({ status: 'running', progress: 0, message: 'Starting…', stage: 'init' })

      let opId: string | undefined
      opIdRef.current = null
      const result: GenerationResult = { screenshot_files: [] }

      const handle = (ev: SseEvent) => {
        if (ev.type === 'started') {
          opId = ev.operation_id
          opIdRef.current = ev.operation_id ?? null
          setState((s) => ({ ...s, operationId: ev.operation_id, progress: ev.progress ?? s.progress }))
        } else if (ev.type === 'progress') {
          setState((s) => ({ ...s, stage: ev.stage, message: ev.message, progress: ev.progress }))
        } else if (ev.type === 'html_generated') {
          result.html_filename = ev.html_filename
          result.html_content = ev.html_content
        } else if (ev.type === 'screenshot') {
          result.screenshot_files.push(ev.filename)
          setState((s) => ({
            ...s,
            stage: 'screenshot',
            message: `Captured ${ev.index}/${ev.total}`,
            progress: ev.progress,
          }))
        } else if (ev.type === 'complete') {
          result.html_filename = ev.html_filename ?? result.html_filename
          result.screenshot_files = ev.screenshot_files ?? result.screenshot_files
          result.screenshot_folder = ev.screenshot_folder
          result.operation_id = ev.operation_id ?? opId
          setState({
            status: 'success',
            progress: 100,
            stage: 'complete',
            message: `Generated ${result.screenshot_files.length} screenshot(s)`,
            result,
            operationId: result.operation_id,
          })
        } else if (ev.type === 'error') {
          setState({ status: 'error', progress: 100, error: ev.message })
        } else if (ev.type === 'cancelled') {
          setState({ status: 'cancelled', progress: 100, message: ev.message })
        }
      }

      try {
        await streamSse(path, {
          body: formData,
          signal: ctl.signal,
          onEvent: handle,
        })
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setState((s) => ({
            ...s,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }))
        }
        return null
      }
      return result.screenshot_files.length > 0 ? result : null
    },
    [],
  )

  const generate = useCallback(
    (text: string, settings: GenerateSettings) =>
      runSseJson('/generate-sse', { text, ...settings }),
    [runSseJson],
  )

  const generateFromHtml = useCallback(
    async (html: string, settings: GenerateSettings): Promise<GenerationResult | null> => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      setState({ status: 'running', progress: 20, message: 'Rendering screenshots…', stage: 'screenshot' })
      try {
        const res = await api.generateHtml(html, settings)
        const result: GenerationResult = {
          html_filename: res.html_filename,
          screenshot_files: res.screenshot_files ?? [],
          screenshot_folder: res.screenshot_folder,
        }
        setState({
          status: 'success',
          progress: 100,
          stage: 'complete',
          message: res.message ?? `Generated ${result.screenshot_files.length} screenshot(s)`,
          result,
        })
        return result
      } catch (err) {
        setState({
          status: 'error',
          progress: 100,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    },
    [],
  )

  const generateFromImage = useCallback(
    (formData: FormData) => runSseForm('/image-to-screenshots-sse', formData),
    [runSseForm],
  )

  const cancel = useCallback(async () => {
    const op = abortRef.current
    const opId = opIdRef.current
    if (opId) {
      try {
        await api.cancel(opId)
      } catch {
        /* ignore — backend may already have finished */
      }
    }
    op?.abort()
  }, [])

  return { state, generate, generateFromHtml, generateFromImage, cancel, reset }
}
