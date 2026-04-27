import { useCallback, useRef, useState } from 'react'
import { api, streamSse, streamSseGet } from '../api/client'
import type { GenerateSettings, SseEvent } from '../api/types'

export interface GenerationResult {
  html_filename?: string
  html_content?: string
  screenshot_files: string[]
  screenshot_folder?: string
  presentation_file?: string
  video_file?: string
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
          result.presentation_file = ev.presentation_file
          result.video_file = ev.video_file
          result.operation_id = ev.operation_id ?? opId
          setState({
            status: 'success',
            progress: 100,
            stage: 'complete',
            message: ev.message ?? `Generated ${result.screenshot_files.length} screenshot(s)`,
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
  void runSseJson

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
          result.presentation_file = ev.presentation_file
          result.video_file = ev.video_file
          result.operation_id = ev.operation_id ?? opId
          setState({
            status: 'success',
            progress: 100,
            stage: 'complete',
            message: ev.message ?? `Generated ${result.screenshot_files.length} screenshot(s)`,
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

  const runBackendTextRun = useCallback(
    async (text: string, settings: GenerateSettings): Promise<GenerationResult | null> => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      setState({ status: 'running', progress: 0, message: 'Creating backend run...', stage: 'queued' })

      let started
      try {
        started = await api.startTextToVideoRun(text, settings)
      } catch (err) {
        setState({
          status: 'error',
          progress: 100,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }

      const runId = started.run_id
      const opId = started.operation_id
      opIdRef.current = opId
      const result: GenerationResult = { screenshot_files: [], operation_id: opId }
      setState({
        status: 'running',
        progress: 0,
        stage: 'queued',
        message: started.queue_position ? `Queued at position ${started.queue_position}` : 'Queued',
        operationId: opId,
      })

      const handle = (ev: SseEvent) => {
        if (ev.type === 'queued') {
          setState((s) => ({
            ...s,
            stage: 'queued',
            message: ev.message,
            progress: ev.progress ?? s.progress,
            operationId: ev.operation_id ?? s.operationId,
          }))
        } else if (ev.type === 'started') {
          opIdRef.current = ev.operation_id ?? opId
          setState((s) => ({
            ...s,
            operationId: ev.operation_id ?? opId,
            stage: ev.stage ?? 'running',
            message: ev.message ?? 'Process started',
            etaSeconds: ev.estimated_total_seconds,
            progress: ev.progress ?? s.progress,
          }))
        } else if (ev.type === 'progress') {
          setState((s) => ({
            ...s,
            stage: ev.stage,
            message: ev.message,
            progress: ev.progress,
            operationId: ev.operation_id ?? s.operationId,
            etaSeconds: ev.eta_seconds ?? s.etaSeconds,
          }))
        } else if (ev.type === 'complete') {
          const data = ev.data ?? {}
          result.html_filename = ev.html_filename ?? data.html_filename ?? data.html_file ?? result.html_filename
          result.html_content = ev.html_content ?? result.html_content
          result.screenshot_files = ev.screenshot_files ?? data.screenshot_files ?? result.screenshot_files
          result.screenshot_folder = ev.screenshot_folder ?? data.screenshot_folder
          result.presentation_file = ev.presentation_file ?? data.presentation_file ?? data.presentation_path
          result.video_file = ev.video_file ?? data.video_file ?? data.video_path
          result.operation_id = ev.operation_id ?? opId
          setState({
            status: 'success',
            progress: 100,
            stage: 'complete',
            message: ev.message ?? data.message ?? `Generated ${result.screenshot_files.length} screenshot(s)`,
            result,
            operationId: result.operation_id,
          })
        } else if (ev.type === 'error') {
          setState({ status: 'error', progress: 100, error: ev.message, operationId: opId })
        } else if (ev.type === 'cancelled') {
          setState({ status: 'cancelled', progress: 100, message: ev.message, operationId: opId })
        }
      }

      try {
        await streamSseGet(`/runs/${encodeURIComponent(runId)}/events`, {
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
      return result
    },
    [],
  )

  const generate = useCallback(
    (text: string, settings: GenerateSettings) => runBackendTextRun(text, settings),
    [runBackendTextRun],
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
          presentation_file: res.presentation_file,
          video_file: res.video_file,
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
        await api.cancelRun(opId).catch(() => api.cancel(opId))
      } catch {
        /* ignore — backend may already have finished */
      }
    }
    op?.abort()
  }, [])

  return { state, generate, generateFromHtml, generateFromImage, cancel, reset }
}
