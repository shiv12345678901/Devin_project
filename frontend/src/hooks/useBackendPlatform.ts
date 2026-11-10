import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useSettings } from '../store/settings'

export type BackendPlatform = 'windows' | 'non-windows' | 'unknown'

export interface BackendCapabilities {
  platform: BackendPlatform
  /**
   * True when the backend reports the selected video engine, or any usable
   * engine in Auto mode. PowerPoint remains the Windows MP4 path.
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
 * Used to gate MP4 / PowerPoint output. Explicit engine preferences only
 * open the MP4 gate when that engine is actually available.
 */
export function useBackendPlatform(): BackendPlatform {
  return useBackendCapabilities().platform
}

export function useBackendCapabilities(): BackendCapabilities {
  const { settings } = useSettings()
  const selectedEngine = settings.videoEngine
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
        const availableEngines = r.checks.video_engine?.engines ?? []
        const videoEngineReady = pptxReady || (selectedEngine === 'auto'
          ? r.checks.video_engine?.ok === true
          : availableEngines.includes(selectedEngine))
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
  }, [selectedEngine])

  return caps
}
