import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2, Database } from 'lucide-react'
import { api } from '../api/client'
import type { CacheStats, HistoryEntry, ListResponse } from '../api/types'

export default function Resources() {
  const [list, setList] = useState<ListResponse>({ screenshots: [], html_files: [] })
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [l, h, c] = await Promise.all([api.list(), api.history(), api.cacheStats()])
      setList(l)
      setHistory(Array.isArray(h) ? h : [])
      setCache(c)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      void refresh()
    }, 0)
    return () => clearTimeout(id)
  }, [refresh])

  const clearCache = async () => {
    if (!confirm('Clear the AI response cache?')) return
    try {
      await api.clearCache()
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteFile = async (type: 'screenshot' | 'html', filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return
    try {
      await api.deleteFile(type, filename)
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Resources</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Generated files, history, and cache stats.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="btn-secondary" onClick={clearCache}>
            <Database size={16} /> Clear AI cache
          </button>
        </div>
      </div>

      {err && <div className="card text-sm text-red-600 dark:text-red-400">{err}</div>}

      {cache && (
        <div className="card">
          <h2 className="mb-2 text-base font-semibold">Cache</h2>
          <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-xs dark:bg-slate-800">
            {JSON.stringify(cache, null, 2)}
          </pre>
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 text-base font-semibold">
          Screenshots ({list.screenshots.length})
        </h2>
        {list.screenshots.length === 0 ? (
          <p className="text-sm text-slate-500">No screenshots yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.screenshots.map((f) => (
              <li key={f} className="flex items-center justify-between gap-4 py-2">
                <a
                  href={api.screenshotUrl(f)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm text-brand-600 hover:underline dark:text-brand-300"
                  title={f}
                >
                  {f}
                </a>
                <button
                  className="btn-secondary"
                  onClick={() => deleteFile('screenshot', f)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-base font-semibold">HTML files ({list.html_files.length})</h2>
        {list.html_files.length === 0 ? (
          <p className="text-sm text-slate-500">No HTML files yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.html_files.map((f) => (
              <li key={f} className="flex items-center justify-between gap-4 py-2">
                <a
                  href={api.htmlUrl(f)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm text-brand-600 hover:underline dark:text-brand-300"
                  title={f}
                >
                  {f}
                </a>
                <button
                  className="btn-secondary"
                  onClick={() => deleteFile('html', f)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-base font-semibold">History ({history.length})</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No generation history yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.slice(0, 50).map((entry, i) => (
              <li key={entry.id ?? `${entry.timestamp}-${i}`} className="py-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{entry.tool ?? 'generation'}</span>
                  {entry.timestamp && (
                    <span className="text-xs text-slate-500">{entry.timestamp}</span>
                  )}
                </div>
                {entry.input_preview && (
                  <p className="mt-0.5 truncate text-xs text-slate-500">{entry.input_preview}</p>
                )}
                <p className="text-xs text-slate-500">
                  {entry.screenshot_count ?? 0} screenshots · {entry.html_file ?? '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
