import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { MAX_RUNS, RunsContext, STORAGE_KEY } from './runs'
import type { Run, RunsContextValue } from './runs'

function load(): Run[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Run[]
    return Array.isArray(parsed) ? parsed : []
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

  const clear = useCallback(() => setRuns([]), [])
  const remove = useCallback((id: string) => setRuns((prev) => prev.filter((r) => r.id !== id)), [])

  const value = useMemo<RunsContextValue>(
    () => ({ runs, start, finish, clear, remove }),
    [runs, start, finish, clear, remove],
  )

  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>
}
