import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { MAX_RUNS, RunsContext, STORAGE_KEY } from './runs'
import type { Run, RunsContextValue } from './runs'

/** Sanitize a single persisted run.
 *
 * Returns null if the entry is structurally bogus (missing required keys,
 * wrong types). Without this, an arbitrary localStorage payload could
 * crash the Processes / Library / Home views by reaching r.tool.split etc.
 */
function migrateRun(value: unknown): Run | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Partial<Run>
  if (typeof r.id !== 'string' || typeof r.tool !== 'string') return null
  if (!['text-to-video', 'html-to-video', 'image-to-video', 'screenshots-to-video'].includes(r.tool)) return null
  if (typeof r.startedAt !== 'number') return null
  if (!['running', 'success', 'error', 'cancelled'].includes(r.status as string)) {
    r.status = 'error'
  }
  // Backend-owned text runs can be reattached from Processes by operation id.
  // Only local/SSE-only running rows become cancelled after a tab reload.
  if (r.status === 'running' && !r.operationId) {
    r.status = 'cancelled'
    r.endedAt = r.endedAt ?? Date.now()
  }
  if (r.screenshotFiles && !Array.isArray(r.screenshotFiles)) {
    r.screenshotFiles = []
  }
  if (typeof r.inputPreview !== 'string') r.inputPreview = ''
  if (r.inputText != null && typeof r.inputText !== 'string') r.inputText = String(r.inputText)
  return r as Run
}

function load(): Run[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const cleaned: Run[] = []
    for (const entry of parsed) {
      const migrated = migrateRun(entry)
      if (migrated) cleaned.push(migrated)
    }
    return cleaned
  } catch {
    return []
  }
}

function save(runs: Run[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)))
  } catch {
    /* quota or private-mode; ignore */
  }
}

export function RunsProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<Run[]>(() => load())

  useEffect(() => {
    save(runs)
  }, [runs])

  const start = useCallback<RunsContextValue['start']>((meta) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const run: Run = { id, status: 'running', startedAt: Date.now(), ...meta }
    setRuns((prev) => [run, ...prev].slice(0, MAX_RUNS))
    return id
  }, [])

  const finish = useCallback<RunsContextValue['finish']>((id, patch) => {
    setRuns((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              status: patch.status ?? r.status,
              endedAt: Date.now(),
            }
          : r,
      ),
    )
  }, [])

  const update = useCallback<RunsContextValue['update']>((id, patch) => {
    setRuns((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              status: patch.status ?? r.status,
            }
          : r,
      ),
    )
  }, [])

  const clear = useCallback(() => setRuns([]), [])
  const remove = useCallback((id: string) => setRuns((prev) => prev.filter((r) => r.id !== id)), [])

  const value = useMemo<RunsContextValue>(
    () => ({ runs, start, finish, update, clear, remove }),
    [runs, start, finish, update, clear, remove],
  )

  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>
}
