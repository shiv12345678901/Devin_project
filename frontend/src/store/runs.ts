/**
 * Shared types, context, hook, and formatters for the client-side Runs
 * store. The <RunsProvider> lives in ./RunsProvider.tsx so this file stays
 * JSX-free and doesn't upset the react-refresh/only-export-components rule.
 */
import { createContext, useContext } from 'react'

export type RunTool = 'text-to-video' | 'html-to-video' | 'image-to-video'
export type RunStatus = 'running' | 'success' | 'error' | 'cancelled'

export interface RunSettings {
  zoom?: number
  overlap?: number
  viewport_width?: number
  viewport_height?: number
  max_screenshots?: number
  use_cache?: boolean
  model_choice?: string
  enable_verification?: boolean
  class_name?: string
  subject?: string
  title?: string
  output_format?: 'html' | 'images' | 'pptx' | 'video'
  system_prompt?: string
  output_name?: string
  resolution?: string
  fps?: number
  video_quality?: number
  slide_duration_sec?: number
  intro_thumbnail_enabled?: boolean
  outro_thumbnail_enabled?: boolean
}

export interface Run {
  id: string
  tool: RunTool
  status: RunStatus
  startedAt: number
  endedAt?: number
  inputPreview: string
  inputText?: string
  settings?: RunSettings
  /** For image-to-video: original filename(s) the user dropped in. */
  inputFiles?: string[]
  htmlFilename?: string
  screenshotFiles?: string[]
  screenshotFolder?: string
  presentationFile?: string
  videoFile?: string
  operationId?: string
  error?: string
}

export interface RunsContextValue {
  runs: Run[]
  start: (meta: Omit<Run, 'id' | 'status' | 'startedAt'>) => string
  finish: (
    id: string,
    patch: Partial<
      Pick<
        Run,
        | 'status'
        | 'htmlFilename'
        | 'screenshotFiles'
        | 'screenshotFolder'
        | 'presentationFile'
        | 'videoFile'
        | 'operationId'
        | 'error'
      >
    >,
  ) => void
  clear: () => void
  remove: (id: string) => void
}

export const STORAGE_KEY = 'textbro:runs:v1'
export const MAX_RUNS = 100

export const RunsContext = createContext<RunsContextValue | null>(null)

export function useRuns(): RunsContextValue {
  const ctx = useContext(RunsContext)
  if (!ctx) throw new Error('useRuns must be used inside <RunsProvider>')
  return ctx
}

export function formatRuntime(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s - m * 60)
  return `${m}m ${rem}s`
}

export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}
