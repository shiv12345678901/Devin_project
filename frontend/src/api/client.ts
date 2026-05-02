import type {
  CacheStats,
  GenerateResponse,
  GenerateSettings,
  HistoryEntry,
  ListResponse,
  PreflightResponse,
  SseEvent,
  BackendRunStartResponse,
  BackendRunDetail,
  SavedThumbnailTemplate,
  YoutubeVideosResponse,
} from './types'

// Base URL for the Flask backend. Starts from the build-time env var, but can
// be overridden at runtime from the Settings page via `setBackendBaseUrl()` —
// that way users can point the UI at a different host without a rebuild.
const DEFAULT_API_BASE: string = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? ''
let API_BASE: string = DEFAULT_API_BASE

export function setBackendBaseUrl(url: string): void {
  API_BASE = (url ?? '').trim() || DEFAULT_API_BASE
}

export function getBackendBaseUrl(): string {
  return API_BASE
}

function buildUrl(path: string): string {
  if (!API_BASE) return path
  return `${API_BASE.replace(/\/$/, '')}${path}`
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Invalid JSON response (${res.status}): ${text.slice(0, 200)}`)
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok && res.status === 409) {
    const rejected = tryParseRejection(text)
    if (rejected) throw rejected
  }
  if (!text) {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return {} as T
  }
  let data: T & { error?: string }
  try {
    data = JSON.parse(text) as T & { error?: string }
  } catch {
    throw new Error(`Invalid JSON response (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `${res.status} ${res.statusText}`)
  }
  return data
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(buildUrl(path))
  const data = await parseJson<T & { error?: string }>(res)
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText)
  return data
}

// ─── Preflight cache ───────────────────────────────────────────────────────
// User complaint: "preflight being hit every 2-3s from the UI". Nothing in
// the codebase polls that fast but components fetch preflight on mount,
// so a tab-happy user can easily trigger 5+ calls in a second. Cache the
// response for 30s and coalesce concurrent lookups to a single request.
const PREFLIGHT_CACHE_MS = 30_000
interface PreflightCache {
  value: PreflightResponse | null
  fetchedAt: number
  inFlight: Promise<PreflightResponse> | null
}
let _preflightCache: PreflightCache = { value: null, fetchedAt: 0, inFlight: null }

export function invalidatePreflightCache(): void {
  _preflightCache = { value: null, fetchedAt: 0, inFlight: null }
}

export const api = {
  generate: (text: string, settings: GenerateSettings = {}) =>
    postJson<GenerateResponse>('/generate', { text, ...settings }),

  startTextToVideoRun: (text: string, settings: GenerateSettings = {}) =>
    postJson<BackendRunStartResponse>('/runs/text-to-video', { text, ...settings }),

  startHtmlToVideoRun: (html: string, settings: GenerateSettings = {}) =>
    postJson<BackendRunStartResponse>('/runs/html-to-video', { html, ...settings }),

  /**
   * Submit pre-captured screenshots to the same MP4/PPTX export pipeline
   * used by Text → Video. The screenshots are uploaded as
   * ``screenshots[]`` parts; ``settings`` (resolution, fps, project info,
   * thumbnails, …) ride along as form fields so the backend can apply
   * the canonical ``class_X_subject_chapter_Y_exercise_<year>`` filename
   * scheme used everywhere else.
   */
  startScreenshotsToVideoRun: async (
    screenshots: File[],
    settings: GenerateSettings = {},
  ): Promise<BackendRunStartResponse> => {
    const fd = new FormData()
    for (const f of screenshots) fd.append('screenshots[]', f, f.name)
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined || value === null) continue
      if (typeof value === 'boolean') fd.append(key, value ? '1' : '0')
      else fd.append(key, String(value))
    }
    const res = await fetch(buildUrl('/runs/screenshots-to-video'), {
      method: 'POST',
      body: fd,
    })
    const text = await res.text()
    if (!res.ok && res.status === 409) {
      const rejected = tryParseRejection(text)
      if (rejected) throw rejected
    }
    if (!text) {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return {} as BackendRunStartResponse
    }
    let data: BackendRunStartResponse & { error?: string }
    try {
      data = JSON.parse(text) as BackendRunStartResponse & { error?: string }
    } catch {
      throw new Error(`Invalid JSON response (${res.status}): ${text.slice(0, 200)}`)
    }
    if (!res.ok || data.error) {
      throw new Error(data.error || `${res.status} ${res.statusText}`)
    }
    return data
  },

  getRun: (runId: string) =>
    getJson<BackendRunDetail>(`/runs/${encodeURIComponent(runId)}`),

  generateHtml: (html: string, settings: GenerateSettings = {}) =>
    postJson<GenerateResponse>('/generate-html', { html, ...settings }),

  cancel: (operationId: string) =>
    postJson<{ success: boolean; message: string }>(`/cancel/${encodeURIComponent(operationId)}`, {}),

  cancelRun: (runId: string) =>
    postJson<{ success: boolean; message: string }>(`/runs/${encodeURIComponent(runId)}/cancel`, {}),

  beautify: (html: string) => postJson<{ html: string; validation: unknown }>('/beautify', { html }),
  minify: (html: string) =>
    postJson<{ html: string; original_size: number; minified_size: number; reduction_percent: number }>(
      '/minify',
      { html },
    ),

  regenerate: (htmlFilename: string, settings: GenerateSettings = {}) =>
    postJson<GenerateResponse>('/regenerate', { html_filename: htmlFilename, ...settings }),

  list: () => getJson<ListResponse>('/list'),
  history: () => getJson<HistoryEntry[]>('/history'),
  youtubeVideos: () => getJson<YoutubeVideosResponse>('/youtube/videos'),
  clearHistory: () => postJson<{ success: boolean; message: string }>('/history/clear', {}),
  deleteFile: async (type: 'screenshot' | 'html' | 'presentation' | 'video', filename: string) => {
    // Encode each path segment separately. encodeURIComponent would escape
    // `/` as `%2F`, which Werkzeug's dev server does NOT decode back to `/`
    // in PATH_INFO — so the <path:filename> converter would get a literal
    // `%2F` and fail to match any file on disk. Screenshots inside batch
    // subfolders (e.g. `batch 3/5(1).png`) rely on the split-and-join
    // treatment.
    const encoded = filename.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(buildUrl(`/delete/${type}/${encoded}`), {
      method: 'DELETE',
    })
    return parseJson<{ success?: boolean; error?: string }>(res)
  },

  /**
   * Preflight probes are expensive on Windows (they spawn POWERPNT.EXE to
   * verify COM availability). A single client cache with a 30s TTL stops
   * us from hammering the backend every time a component mounts.
   *
   * Pass `{ fresh: true }` to bypass the cache — the "Refresh" button on
   * the Home preflight tile uses this, and the Settings page's "Ping"
   * button does too.
   */
  preflight: (opts?: { fresh?: boolean }): Promise<PreflightResponse> => {
    // Cached path — reuse a recent response without hitting the network.
    if (!opts?.fresh) {
      const now = Date.now()
      if (
        _preflightCache.value &&
        now - _preflightCache.fetchedAt < PREFLIGHT_CACHE_MS
      ) {
        return Promise.resolve(_preflightCache.value)
      }
    }
    // Always coalesce concurrent callers onto the same in-flight request,
    // even when one of them passed `fresh: true`. A fresh probe is still
    // a newer-than-cache result, so a cached waiter is perfectly happy
    // with it — we just had to stop the previous "fresh bypasses the
    // in-flight check" branch, which could issue 4 parallel
    // POWERPNT-spawning probes if four components mounted together asked
    // for fresh data at once.
    if (_preflightCache.inFlight) return _preflightCache.inFlight

    const p = getJson<PreflightResponse>(opts?.fresh ? '/preflight?fresh=1' : '/preflight')
      .then((r) => {
        _preflightCache = { value: r, fetchedAt: Date.now(), inFlight: null }
        return r
      })
      .catch((e) => {
        _preflightCache = { ..._preflightCache, inFlight: null }
        throw e
      })
    _preflightCache = { ..._preflightCache, inFlight: p }
    return p
  },

  cacheStats: () => getJson<CacheStats>('/cache/stats'),
  clearCache: () => postJson<{ success: boolean; message: string }>('/cache/clear', {}),

  screenshotUrl: (filename: string) =>
    buildUrl(`/screenshots/${filename.split('/').map(encodeURIComponent).join('/')}`),
  htmlUrl: (filename: string) => buildUrl(`/html/${encodeURIComponent(filename)}`),
  downloadUrl: (filepath: string) =>
    buildUrl(`/download/${filepath.split(/[\\/]/).map(encodeURIComponent).join('/')}`),
  thumbnailUrl: (filename: string) =>
    buildUrl(`/thumbnails/${encodeURIComponent(filename)}`),

  listThumbnailTemplates: (className?: string, subject?: string) => {
    const params = new URLSearchParams()
    if (className) params.set('className', className)
    if (subject) params.set('subject', subject)
    const qs = params.toString()
    return getJson<{ success: boolean; templates: SavedThumbnailTemplate[] }>(
      `/thumbnail-templates${qs ? `?${qs}` : ''}`,
    )
  },

  saveThumbnailTemplate: (template: Omit<SavedThumbnailTemplate, 'id' | 'createdAt' | 'updatedAt'>) =>
    postJson<{ success: boolean; template: SavedThumbnailTemplate }>('/thumbnail-templates', template),

  deleteThumbnailTemplate: (id: string) =>
    fetch(buildUrl(`/thumbnail-templates/${encodeURIComponent(id)}`), { method: 'DELETE' })
      .then((res) => parseJson<{ success?: boolean; error?: string }>(res)),

  uploadThumbnail: async (
    file: File,
  ): Promise<{ success: boolean; filename: string; url: string; size_bytes: number }> => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(buildUrl('/upload-thumbnail'), { method: 'POST', body: fd })
    if (!r.ok) {
      const msg = await r.text()
      throw new Error(`Upload failed (${r.status}): ${msg}`)
    }
    return r.json()
  },

  downloadZip: async (files: string[], name = 'screenshots'): Promise<Blob> => {
    const res = await fetch(buildUrl('/download-zip'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, name }),
    })
    if (!res.ok) throw new Error(`Failed to download ZIP: ${res.status}`)
    return res.blob()
  },
}

/**
 * Stream Server-Sent Events from a POST endpoint. Flask's `/generate-sse` and
 * `/image-to-screenshots-sse` accept a POST body and stream `data: {...}\n\n`
 * lines — `EventSource` only supports GET, so we drive this manually with fetch
 * + ReadableStream.
 */
export interface SseStreamOptions {
  body: BodyInit
  headers?: Record<string, string>
  signal?: AbortSignal
  onEvent: (ev: SseEvent) => void
}

/**
 * Thrown when the backend rejects a run because another one is in flight or
 * the same payload was just submitted within the dedup window. The 409 body
 * shape comes from `src/utils/run_guard.py::RunRejected`.
 */
export class RunRejectedError extends Error {
  reason: 'in_flight' | 'duplicate' | 'unknown'
  operationId: string | null
  constructor(reason: 'in_flight' | 'duplicate' | 'unknown', message: string, operationId: string | null = null) {
    super(message)
    this.name = 'RunRejectedError'
    this.reason = reason
    this.operationId = operationId
  }
}

function tryParseRejection(text: string): RunRejectedError | null {
  try {
    const data = JSON.parse(text) as {
      reason?: string
      error?: string
      message?: string
      operation_id?: string
    }
    const reasonRaw = (data.reason ?? '').toLowerCase()
    const reason: RunRejectedError['reason'] =
      reasonRaw === 'in_flight' || reasonRaw === 'duplicate' ? reasonRaw : 'unknown'
    const message = data.error || data.message || 'Run rejected by backend'
    return new RunRejectedError(reason, message, data.operation_id ?? null)
  } catch {
    return null
  }
}

export async function streamSse(path: string, opts: SseStreamOptions): Promise<void> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { Accept: 'text/event-stream', ...(opts.headers ?? {}) },
    body: opts.body,
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = !res.ok ? await res.text().catch(() => '') : ''
    if (res.status === 409) {
      const rejected = tryParseRejection(text)
      if (rejected) throw rejected
    }
    throw new Error(`SSE request failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE messages are separated by blank lines.
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const dataLines = part
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
      if (dataLines.length === 0) continue
      const raw = dataLines.join('\n')
      try {
        const parsed = JSON.parse(raw) as SseEvent
        opts.onEvent(parsed)
      } catch {
        // Ignore non-JSON keepalives / comments.
      }
    }
  }
}

export async function streamSseGet(
  path: string,
  opts: Pick<SseStreamOptions, 'signal' | 'onEvent'>,
): Promise<void> {
  const res = await fetch(buildUrl(path), {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = !res.ok ? await res.text().catch(() => '') : ''
    throw new Error(`SSE request failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const dataLines = part
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
      if (dataLines.length === 0) continue
      const raw = dataLines.join('\n')
      try {
        opts.onEvent(JSON.parse(raw) as SseEvent)
      } catch {
        // Ignore non-JSON keepalives / comments.
      }
    }
  }
}
