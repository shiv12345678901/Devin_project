/**
 * Wraps useGenerate so every call is recorded in the Runs store — input
 * preview, settings, runtime, outputs. The Processes page reads the store
 * to show a unified timeline of past runs across Text/HTML/Image pages.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useGenerate } from './useGenerate'
import { useRuns } from '../store/runs'
import type { Run, RunTool } from '../store/runs'
import type { GenerateSettings } from '../api/types'

type PendingMeta = Omit<Run, 'id' | 'status' | 'startedAt'>

export function useTrackedGenerate(tool: RunTool) {
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
    (text: string, settings: GenerateSettings) => {
      pendingRef.current = { tool, inputPreview: text.slice(0, 200), settings }
      return gen.generate(text, settings)
    },
    [gen, tool],
  )

  const generateFromHtml = useCallback(
    (html: string, settings: GenerateSettings) => {
      pendingRef.current = { tool, inputPreview: html.slice(0, 200), settings }
      return gen.generateFromHtml(html, settings)
    },
    [gen, tool],
  )

  const generateFromImage = useCallback(
    (formData: FormData, meta?: { files?: File[]; settings?: GenerateSettings }) => {
      const files = meta?.files ?? []
      pendingRef.current = {
        tool,
        inputPreview: files.length ? files.map((f) => f.name).join(', ') : '(image/pdf)',
        inputFiles: files.map((f) => f.name),
        settings: meta?.settings,
      }
      return gen.generateFromImage(formData)
    },
    [gen, tool],
  )

  return {
    state: gen.state,
    cancel: gen.cancel,
    reset: gen.reset,
    generate,
    generateFromHtml,
    generateFromImage,
  }
}
