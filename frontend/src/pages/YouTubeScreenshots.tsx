/**
 * YouTube → Screenshots page — isolated, removable tool.
 *
 * To remove this tool entirely:
 *   1. Delete this file
 *   2. Remove the route in App.tsx
 *   3. Remove the card in Workspace.tsx
 *   4. Delete backend/routes/youtube_screenshots.py
 *   5. Remove the register_blueprint block in backend/app.py
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Camera,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Play,
  StopCircle,
  Trash2,
} from 'lucide-react'

import AssetPreviewModal from '../components/AssetPreviewModal'
import { useToast } from '../store/toast'

// ─── Types ─────────────────────────────────────────────────────────────────

interface SsePayload {
  type: string
  stage?: string
  message?: string
  percent?: number
  title?: string
  duration?: number
  folder?: string
  files?: string[]
  screenshot_count?: number
  operation_id?: string
}

interface ExtractionResult {
  folder: string
  files: string[]
  title: string
  duration: number
}

interface SavedFolder {
  name: string
  path?: string
  screenshot_count: number
  files: string[]
  modified_at?: string
}

interface CookieDiagnostics {
  path: string
  exists: boolean
  size_bytes: number
  last_modified: string | null
  netscape_header: boolean
  valid_rows: number
  youtube_rows: number
  status: string
}

interface CheckResponse {
  available: boolean
  error?: string
  has_cookies?: boolean
  cookies?: CookieDiagnostics
  yt_dlp_version?: string | null
}

interface FolderListResponse {
  folders: SavedFolder[]
  page: number
  size: number
  total: number
  has_more: boolean
}

const ytScreenshotUrl = (folder: string, file: string) =>
  `/youtube-screenshots/file/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`

const ytFolderUrl = (path: string, folder: string) =>
  `/youtube-screenshots/${path}/${encodeURIComponent(folder)}`

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function YouTubeScreenshots() {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [timestampsRaw, setTimestampsRaw] = useState('')

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error' | 'cancelled'>('idle')
  const [progress, setProgress] = useState<SsePayload | null>(null)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [error, setError] = useState('')
  const [operationId, setOperationId] = useState('')

  const [available, setAvailable] = useState<boolean | null>(null)
  const [availError, setAvailError] = useState('')
  const [hasCookies, setHasCookies] = useState(false)
  const [cookies, setCookies] = useState<CookieDiagnostics | null>(null)
  const [ytDlpVersion, setYtDlpVersion] = useState<string | null>(null)

  const [folders, setFolders] = useState<SavedFolder[]>([])
  const [folderPage, setFolderPage] = useState(1)
  const [folderTotal, setFolderTotal] = useState(0)
  const [folderHasMore, setFolderHasMore] = useState(false)
  const folderPageSize = 20

  // Image preview modal — holds the folder + file list + current index
  const [preview, setPreview] = useState<{ folder: string; files: string[]; index: number } | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Check if tool is available on mount
  useEffect(() => {
    fetch('/youtube-screenshots/check')
      .then((r) => r.json())
      .then((d: CheckResponse) => {
        setAvailable(d.available)
        setHasCookies(Boolean(d.has_cookies))
        setCookies(d.cookies ?? null)
        setYtDlpVersion(d.yt_dlp_version ?? null)
        if (!d.available) setAvailError(d.error || 'Dependencies not installed')
      })
      .catch(() => {
        setAvailable(false)
        setAvailError('Could not reach backend')
      })
  }, [])

  // Load saved folders
  const loadFolders = useCallback((page = folderPage) => {
    fetch(`/youtube-screenshots/list?page=${page}&size=${folderPageSize}`)
      .then((r) => r.json())
      .then((d: FolderListResponse) => {
        setFolders(d.folders || [])
        setFolderPage(d.page || page)
        setFolderTotal(d.total || 0)
        setFolderHasMore(Boolean(d.has_more))
      })
      .catch(() => {})
  }, [folderPage])

  useEffect(() => { loadFolders() }, [loadFolders])

  // Parse timestamps from text input (supports "0:30, 1:15, 2:00" or "30, 75, 120")
  const parseTimestamps = (raw: string): number[] => {
    return raw.split(/[,\n]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => {
        const parts = s.split(':').map(Number)
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
        if (parts.length === 2) return parts[0] * 60 + parts[1]
        return Number(s)
      })
      .filter(n => !isNaN(n) && n >= 0)
  }

  const handleEvent = useCallback((payload: SsePayload) => {
    switch (payload.type) {
      case 'started':
        setOperationId(payload.operation_id || '')
        break
      case 'progress':
        setProgress(payload)
        if (payload.stage === 'complete' && payload.folder && payload.files) {
          setResult({
            folder: payload.folder,
            files: payload.files,
            title: payload.title || '',
            duration: payload.duration || 0,
          })
          setStatus('done')
          loadFolders(1)
        }
        break
      case 'error':
        setError(payload.message || 'Extraction failed')
        setStatus('error')
        break
      case 'cancelled':
        setStatus('cancelled')
        break
      case 'complete':
        setStatus((s) => s === 'running' ? 'done' : s)
        loadFolders(1)
        break
    }
  }, [loadFolders])

  // Start extraction
  const startExtraction = useCallback(() => {
    if (!url.trim()) return
    const timestamps = parseTimestamps(timestampsRaw)
    if (timestamps.length === 0) return

    setStatus('running')
    setProgress(null)
    setResult(null)
    setError('')

    const abort = new AbortController()
    abortRef.current = abort

    fetch('/youtube-screenshots/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url.trim(),
        timestamps,
      }),
      signal: abort.signal,
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((d) => { throw new Error(d.error || 'Request failed') })
        }

        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        function read(): Promise<void> {
          if (!reader) return Promise.resolve()
          return reader.read().then(({ done, value }) => {
            if (done) {
              setStatus((s) => s === 'running' ? 'done' : s)
              loadFolders(1)
              return
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const payload: SsePayload = JSON.parse(line.slice(6))
                  handleEvent(payload)
                } catch { /* ignore parse errors */ }
              }
            }

            return read()
          })
        }

        return read()
      })
      .catch((e) => {
        if (e.name === 'AbortError') {
          setStatus('cancelled')
        } else {
          setError(e.message || 'Unknown error')
          setStatus('error')
        }
      })
  }, [url, timestampsRaw, loadFolders, handleEvent])

  // Cancel
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    if (operationId) {
      fetch(`/youtube-screenshots/cancel/${encodeURIComponent(operationId)}`, { method: 'POST' }).catch(() => {})
    }
    setStatus('cancelled')
  }, [operationId])

  // Delete folder
  const deleteFolder = useCallback((name: string) => {
    if (!confirm(`Delete "${name}" and all its screenshots?`)) return
    fetch(ytFolderUrl('delete', name), { method: 'DELETE' })
      .then(() => {
        toast.push({ variant: 'success', message: 'Extraction deleted.' })
        loadFolders()
      })
      .catch(() => toast.push({ variant: 'error', message: 'Could not delete extraction.' }))
  }, [loadFolders, toast])

  const downloadFolder = useCallback((folder: SavedFolder) => {
    fetch(ytFolderUrl('download-zip', folder.name))
      .then((r) => {
        if (!r.ok) throw new Error('Download failed')
        return r.blob()
      })
      .then((blob) => {
        downloadBlob(blob, `${folder.name}.zip`)
        toast.push({ variant: 'success', message: 'ZIP download started.' })
      })
      .catch(() => toast.push({ variant: 'error', message: 'Could not download ZIP.' }))
  }, [toast])

  const copyFolderPath = useCallback(async (folder: SavedFolder) => {
    const value = folder.path || folder.name
    try {
      await navigator.clipboard.writeText(value)
      toast.push({ variant: 'success', message: 'Folder path copied.' })
    } catch {
      toast.push({ variant: 'error', message: 'Could not copy folder path.' })
    }
  }, [toast])

  // ─── Render ────────────────────────────────────────────────────────────

  // Not available — show dependency error
  if (available === false) {
    return (
      <div className="container-form space-y-6">
        <header>
          <div className="eyebrow"><span className="h-1 w-1 rounded-full bg-rose-500" />YouTube Screenshots</div>
          <h1 className="h-page mt-2">YouTube → Screenshots</h1>
        </header>
        <div className="surface p-6 flex items-start gap-3">
          <AlertCircle size={20} className="text-rose-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-[rgb(var(--text-strong))]">Dependencies not installed</p>
            <p className="mt-1 text-sm text-muted">{availError}</p>
            <code className="mt-3 block rounded bg-[rgb(var(--bg-muted))] px-3 py-2 text-xs">
              pip install yt-dlp opencv-python numpy
            </code>
          </div>
        </div>
      </div>
    )
  }

  // Loading state
  if (available === null) {
    return (
      <div className="container-form flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    )
  }

  return (
    <div className="container-form space-y-8">
      {/* Header */}
      <header>
        <div className="eyebrow">
          <span className="h-1 w-1 rounded-full bg-rose-500" />
          Workspace
        </div>
        <h1 className="h-page mt-2">YouTube → Screenshots</h1>
        <p className="mt-2 text-sm text-muted">
          Paste a YouTube URL and enter timestamps. A screenshot will be captured at each timestamp.
        </p>
      </header>

      {/* Input form */}
      <div className="surface p-6 space-y-5">
        {!hasCookies && (
          <div className="rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
            YouTube may require sign-in on this machine. If capture fails, export cookies to backend/config/cookies.txt.
          </div>
        )}
        <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
          <div>
            yt-dlp: <span className="text-[rgb(var(--text-strong))]">{ytDlpVersion || 'unknown'}</span>
          </div>
          {cookies && (
            <div>
              Cookies: <span className="text-[rgb(var(--text-strong))]">{cookies.status}</span>
              {cookies.exists && (
                <span> ({cookies.youtube_rows} YouTube rows, {Math.round(cookies.size_bytes / 1024)} KB)</span>
              )}
            </div>
          )}
        </div>

        {/* URL */}
        <div>
          <label className="label">YouTube URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              className="input flex-1"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={status === 'running'}
            />
          </div>
        </div>

        {/* Timestamps */}
        <div>
          <label className="label">Timestamps to capture</label>
          <textarea
            className="textarea"
            rows={3}
            placeholder="Enter timestamps separated by commas or new lines. Examples: 0:30, 1:15, 2:00 or 30, 75, 120 (in seconds)"
            value={timestampsRaw}
            onChange={(e) => setTimestampsRaw(e.target.value)}
            disabled={status === 'running'}
          />
          <p className="mt-1 text-[11px] text-faint">
            Supports M:SS, H:MM:SS, or plain seconds. Separate with commas or new lines.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {status !== 'running' ? (
            <button
              className="btn-primary"
              onClick={startExtraction}
              disabled={!url.trim() || !timestampsRaw.trim()}
            >
              <Play size={16} />
              Capture Screenshots
            </button>
          ) : (
            <button className="btn-danger" onClick={cancel}>
              <StopCircle size={16} />
              Cancel
            </button>
          )}

          {status === 'done' && result && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
              ✓ {result.files.length} screenshots captured
            </span>
          )}
          {status === 'cancelled' && (
            <span className="text-sm text-amber-600 dark:text-amber-400">Cancelled</span>
          )}
        </div>
      </div>

      {/* Progress */}
      {status === 'running' && progress && (
        <div className="surface p-5 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-brand-500" />
            <span className="text-sm font-medium text-[rgb(var(--text-strong))]">
              {progress.message || 'Working...'}
            </span>
          </div>
          {typeof progress.percent === 'number' && (
            <div className="h-2 rounded-full bg-[rgb(var(--bg-muted))] overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-300"
                style={{ width: `${Math.min(progress.percent, 100)}%` }}
              />
            </div>
          )}
          {progress.title && (
            <p className="text-xs text-muted">Video: {progress.title}</p>
          )}
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="surface border-rose-200 dark:border-rose-500/30 p-5 flex items-start gap-3">
          <AlertCircle size={18} className="text-rose-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Extraction failed</p>
            <p className="mt-1 text-sm text-muted">{error}</p>
          </div>
        </div>
      )}

      {/* Result */}
      {status === 'done' && result && (
        <div className="surface p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="h-section">{result.title}</h2>
              <p className="text-sm text-muted mt-1">
                {result.files.length} screenshots • {Math.round(result.duration)}s video
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {result.files.map((file, idx) => (
              <button
                key={file}
                type="button"
                onClick={() => setPreview({ folder: result.folder, files: result.files, index: idx })}
                className="group relative aspect-video overflow-hidden rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--bg-muted))]"
              >
                <img
                  src={ytScreenshotUrl(result.folder, file)}
                  alt={file}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                  <ExternalLink size={18} className="text-white" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Previous extractions */}
      {folders.length > 0 && (
        <div className="space-y-4">
          <h2 className="h-section">Previous Extractions</h2>
          <p className="text-xs text-muted">
            Showing page {folderPage} of {Math.max(1, Math.ceil(folderTotal / folderPageSize))} ({folderTotal} folders)
          </p>
          <div className="space-y-2">
            {folders.map((folder) => (
              <div key={folder.name} className="surface flex items-center justify-between p-4">
                <button
                  type="button"
                  className="flex items-center gap-3 min-w-0 text-left flex-1"
                  onClick={() => folder.files.length > 0 && setPreview({ folder: folder.name, files: folder.files, index: 0 })}
                  disabled={folder.files.length === 0}
                >
                  {folder.files.length > 0 ? (
                    <img
                      src={ytScreenshotUrl(folder.name, folder.files[0])}
                      alt=""
                      className="h-10 w-16 shrink-0 rounded object-cover border border-[rgb(var(--line))]"
                      loading="lazy"
                    />
                  ) : (
                    <Camera size={18} className="text-muted shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[rgb(var(--text-strong))] truncate">
                      {folder.name}
                    </p>
                    <p className="text-xs text-muted">{folder.screenshot_count} screenshots</p>
                    {folder.modified_at && (
                      <p className="text-[11px] text-faint">{folder.modified_at}</p>
                    )}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => folder.files.length > 0 && setPreview({ folder: folder.name, files: folder.files, index: 0 })}
                    disabled={folder.files.length === 0}
                    title="Open gallery"
                  >
                    <ExternalLink size={14} />
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => downloadFolder(folder)}
                    disabled={folder.files.length === 0}
                    title="Download ZIP"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => void copyFolderPath(folder)}
                    title="Copy folder path"
                  >
                    <Copy size={14} />
                  </button>
                <button
                  className="btn-ghost btn-sm text-rose-500 hover:text-rose-600"
                  onClick={() => deleteFolder(folder.name)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              className="btn-secondary btn-sm"
              disabled={folderPage <= 1}
              onClick={() => loadFolders(folderPage - 1)}
            >
              Previous
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={!folderHasMore}
              onClick={() => loadFolders(folderPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Image preview modal — reuses the shared AssetPreviewModal */}
      {preview && (
        <AssetPreviewModal
          kind="image"
          src={ytScreenshotUrl(preview.folder, preview.files[preview.index])}
          title={preview.files[preview.index]}
          subtitle={`${preview.index + 1} of ${preview.files.length} • ${preview.folder}`}
          onClose={() => setPreview(null)}
          onPrevious={
            preview.index > 0
              ? () => setPreview((p) => (p ? { ...p, index: p.index - 1 } : p))
              : undefined
          }
          onNext={
            preview.index < preview.files.length - 1
              ? () => setPreview((p) => (p ? { ...p, index: p.index + 1 } : p))
              : undefined
          }
        />
      )}
    </div>
  )
}
