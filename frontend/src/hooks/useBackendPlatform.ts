import { useEffect, useState } from 'react'
import { api } from '../api/client'

export type BackendPlatform = 'windows' | 'non-windows' | 'unknown'

export interface BackendCapabilities {
  platform: BackendPlatform
  /**
   * True when the backend reports a usable video engine (PowerPoint COM
   * on Windows *or* MoviePy on Linux/macOS). Controls the MP4 output
   * option in the wizard.
   */
  videoEngineReady: boolean
  /**
   * True when the backend can emit .pptx decks — still requires a
   * Windows host with PowerPoint COM automation, since the MoviePy
   * engine only produces MP4.
   */
  pptxReady: boolean
}

/**
 * Peek at the backend's platform + video engine capabilities via the
 * (cached) preflight response.
 *
 * Used to gate MP4 / PowerPoint output. The MP4 gate now opens when
 * *either* engine is available so a Linux backend with MoviePy can
 * export video even though PowerPoint COM is Windows-only.
 */
export function useBackendPlatform(): BackendPlatform {
  return useBackendCapabilities().platform
}

export function useBackendCapabilities(): BackendCapabilities {
  const [caps, setCaps] = useState<BackendCapabilities>({
    platform: 'unknown',
    videoEngineReady: false,
    pptxReady: false,
  })

  useEffect(() => {
    let cancelled = false
    api
      .preflight()
      .then((r) => {
        if (cancelled) return
        const detail = (r.checks.platform?.detail ?? '').toLowerCase()
        const platform: BackendPlatform = detail.startsWith('windows')
          ? 'windows'
          : detail
            ? 'non-windows'
            : 'unknown'
        const pptxReady = r.checks.powerpoint?.ok === true
        const videoEngineReady =
          r.checks.video_engine?.ok === true || pptxReady
        setCaps({ platform, videoEngineReady, pptxReady })
      })
      .catch(() => {
        if (!cancelled) {
          setCaps({
            platform: 'unknown',
            videoEngineReady: false,
            pptxReady: false,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return caps
}
