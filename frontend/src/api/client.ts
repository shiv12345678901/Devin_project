import type {
  CacheStats,
  GenerateResponse,
  GenerateSettings,
  HistoryEntry,
  ListResponse,
  PreflightResponse,
  SseEvent,
} from './types'

// Base URL for the Flask backend. Starts from the build-time env var, but can
// be overridden at runtime from the Settings page via `setBackendBaseUrl()` —
// that way users can point the UI at a different host without a rebuild.
let API_BASE: string = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? ''

export function setBackendBaseUrl(url: string): void {
  API_BASE = (url ?? '').trim()
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
  const data = await parseJson<T & { error?: string }>(res)
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

export const api = {
  generate: (text: string, settings: GenerateSettings = {}) =>
    postJson<GenerateResponse>('/generate', { text, ...settings }),

  generateHtml: (html: string, settings: GenerateSettings = {}) =>
    postJson<GenerateResponse>('/generate-html', { html, ...settings }),

  cancel: (operationId: string) =>
    postJson<{ success: boolean; message: string }>(`/cancel/${encodeURIComponent(operationId)}`, {}),

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
  deleteFile: async (type: 'screenshot' | 'html', filename: string) => {
    const res = await fetch(buildUrl(`/delete/${type}/${encodeURIComponent(filename)}`), {
      method: 'DELETE',
    })
    return parseJson<{ success?: boolean; error?: string }>(res)
  },

  preflight: () => getJson<PreflightResponse>('/preflight'),

  cacheStats: () => getJson<CacheStats>('/cache/stats'),
  clearCache: () => postJson<{ success: boolean; message: string }>('/cache/clear', {}),

  screenshotUrl: (filename: string) =>
    buildUrl(`/screenshots/${filename.split('/').map(encodeURIComponent).join('/')}`),
  htmlUrl: (filename: string) => buildUrl(`/html/${encodeURIComponent(filename)}`),
  thumbnailUrl: (filename: string) =>
    buildUrl(`/thumbnails/${encodeURIComponent(filename)}`),

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

export async function streamSse(path: string, opts: SseStreamOptions): Promise<void> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { Accept: 'text/event-stream', ...(opts.headers ?? {}) },
    body: opts.body,
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
