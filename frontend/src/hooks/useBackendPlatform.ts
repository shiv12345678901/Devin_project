import { useEffect, useState } from 'react'
import { api } from '../api/client'

export type BackendPlatform = 'windows' | 'non-windows' | 'unknown'

/**
 * Peek at the backend's platform via the (cached) preflight response.
 *
 * Used to gate MP4 / PowerPoint output — the /generate-sse endpoint
 * silently produced screenshots when those formats were selected on a
 * non-Windows host, and users didn't know until after the run finished.
 *
 * Uses the client-side preflight cache (30s), so calling this from each
 * wizard is cheap — there's one shared fetch behind it.
 */
export function useBackendPlatform(): BackendPlatform {
  const [platform, setPlatform] = useState<BackendPlatform>('unknown')

  useEffect(() => {
    let cancelled = false
    api
      .preflight()
      .then((r) => {
        if (cancelled) return
        // `checks.platform.detail` starts with the OS name ("Linux 6.1 · …",
        // "Windows 10 · …"). Falling back to 'unknown' if the string doesn't
        // match either prefix keeps us from accidentally blocking users when
        // the preflight shape changes.
        const detail = (r.checks.platform?.detail ?? '').toLowerCase()
        if (detail.startsWith('windows')) setPlatform('windows')
        else if (detail) setPlatform('non-windows')
        else setPlatform('unknown')
      })
      .catch(() => {
        if (!cancelled) setPlatform('unknown')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return platform
}
