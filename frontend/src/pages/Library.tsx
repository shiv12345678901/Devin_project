import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { api } from '../api/client'
import HtmlPreviewModal from '../components/HtmlPreviewModal'

type AssetKind = 'html' | 'screenshot'
type SortKey = 'name-asc' | 'name-desc'

interface Preview {
  kind: AssetKind
  filename: string
}

export default function Library() {
  const [kind, setKind] = useState<AssetKind>('screenshot')
  const [screenshots, setScreenshots] = useState<string[]>([])
  const [htmlFiles, setHtmlFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name-desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.list()
      setScreenshots(r.screenshots ?? [])
      setHtmlFiles(r.html_files ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // setTimeout(0) defers the first fetch past the effect body so the rule
  // `react-hooks/set-state-in-effect` is satisfied (same pattern as Processes).
  useEffect(() => {
    const t = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(t)
  }, [load])

  // Selecting a tab also clears any cross-tab selection — done inline below.
  const switchKind = (next: AssetKind) => {
    setKind(next)
    setSelected(new Set())
  }

  const raw = kind === 'screenshot' ? screenshots : htmlFiles
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? raw.filter((f) => f.toLowerCase().includes(q)) : [...raw]
    list.sort((a, b) => (sort === 'name-asc' ? a.localeCompare(b) : b.localeCompare(a)))
    return list
  }, [raw, query, sort])

  const allSelected = filtered.length > 0 && filtered.every((f) => selected.has(f))
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered))
  }

  const toggleOne = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const urlFor = (name: string) =>
    kind === 'screenshot' ? api.screenshotUrl(name) : api.htmlUrl(name)

  const onDownloadOne = (name: string) => {
    const a = document.createElement('a')
    a.href = urlFor(name)
    a.download = name.split('/').pop() ?? name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const onDownloadZip = async () => {
    if (kind !== 'screenshot' || selected.size === 0) return
    setWorking(true)
    try {
      const blob = await api.downloadZip([...selected], 'library')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'library.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  const onDeleteSelected = async () => {
    if (selected.size === 0) return
    if (
      !confirm(`Permanently delete ${selected.size} file${selected.size === 1 ? '' : 's'}?`)
    )
      return
    setWorking(true)
    try {
      const type = kind === 'screenshot' ? 'screenshot' : 'html'
      await Promise.all(
        [...selected].map((name) => api.deleteFile(type as 'screenshot' | 'html', name)),
      )
      setSelected(new Set())
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Library
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Every HTML file and screenshot produced by the backend. Preview,
            download, or clean up.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-white/10">
        {(
          [
            { id: 'screenshot' as const, label: 'Screenshots', icon: ImageIcon, count: screenshots.length },
            { id: 'html' as const, label: 'HTML files', icon: FileText, count: htmlFiles.length },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchKind(t.id)}
            className={
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
              (kind === t.id
                ? 'border-brand-500 text-brand-700 dark:text-brand-200'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100')
            }
          >
            <t.icon size={14} />
            {t.label}
            <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div className="card flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kind === 'screenshot' ? 'screenshots' : 'HTML files'}…`}
            className="input !pl-9"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="select max-w-[220px]"
        >
          <option value="name-desc">Sort: Name (Z → A)</option>
          <option value="name-asc">Sort: Name (A → Z)</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
            />
            Select all ({filtered.length})
          </label>
          {kind === 'screenshot' && (
            <button
              type="button"
              className="btn-secondary"
              disabled={selected.size === 0 || working}
              onClick={onDownloadZip}
              title="Zip selected screenshots"
            >
              <Archive size={14} /> Download ZIP
            </button>
          )}
          <button
            type="button"
            className="btn-danger"
            disabled={selected.size === 0 || working}
            onClick={onDeleteSelected}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* Grid / list */}
      {error ? (
        <div className="card flex items-start gap-3 border-rose-200 bg-rose-50 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <div className="font-medium">Couldn't load library</div>
            <div className="mt-0.5 opacity-80">{error}</div>
          </div>
        </div>
      ) : loading ? (
        <div className="card flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <X className="text-slate-300 dark:text-slate-600" size={24} />
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {raw.length === 0 ? 'No files yet.' : 'No matches for your search.'}
          </div>
        </div>
      ) : kind === 'screenshot' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((name) => (
            <ScreenshotCard
              key={name}
              name={name}
              selected={selected.has(name)}
              onToggle={() => toggleOne(name)}
              onPreview={() => setPreview({ kind: 'screenshot', filename: name })}
              onDownload={() => onDownloadOne(name)}
            />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-white/5">
          {filtered.map((name) => (
            <HtmlRow
              key={name}
              name={name}
              selected={selected.has(name)}
              onToggle={() => toggleOne(name)}
              onPreview={() => setPreview({ kind: 'html', filename: name })}
              onDownload={() => onDownloadOne(name)}
            />
          ))}
        </div>
      )}

      {preview && (
        <HtmlPreviewModal
          kind={preview.kind === 'screenshot' ? 'image' : 'html'}
          src={urlFor(preview.filename)}
          title={preview.filename.split('/').pop() ?? preview.filename}
          subtitle={preview.kind === 'html' ? 'HTML file' : preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function ScreenshotCard({
  name,
  selected,
  onToggle,
  onPreview,
  onDownload,
}: {
  name: string
  selected: boolean
  onToggle: () => void
  onPreview: () => void
  onDownload: () => void
}) {
  return (
    <div
      className={
        'group relative overflow-hidden rounded-xl border bg-white shadow-glass transition-shadow hover:shadow-glass-lg dark:bg-white/[0.03] ' +
        (selected
          ? 'border-brand-400 ring-2 ring-brand-200 dark:border-brand-500/60 dark:ring-brand-500/30'
          : 'border-slate-200 dark:border-white/10')
      }
    >
      <label className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/90 shadow-sm backdrop-blur-sm dark:bg-slate-900/80">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
          aria-label={`Select ${name}`}
        />
      </label>
      <button
        type="button"
        onClick={onPreview}
        className="block aspect-[16/10] w-full overflow-hidden bg-slate-100 dark:bg-slate-900/40"
      >
        <img
          src={api.screenshotUrl(name)}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
        />
      </button>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200" title={name}>
          {name}
        </div>
        <button
          type="button"
          onClick={onPreview}
          className="btn-ghost !px-1.5 !py-1"
          aria-label="Preview"
        >
          <Eye size={14} />
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="btn-ghost !px-1.5 !py-1"
          aria-label="Download"
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  )
}

function HtmlRow({
  name,
  selected,
  onToggle,
  onPreview,
  onDownload,
}: {
  name: string
  selected: boolean
  onToggle: () => void
  onPreview: () => void
  onDownload: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
        aria-label={`Select ${name}`}
      />
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.05] dark:text-slate-300">
        <FileText size={16} />
      </div>
      <button
        type="button"
        onClick={onPreview}
        className="min-w-0 flex-1 text-left text-sm font-medium text-slate-800 hover:text-brand-700 dark:text-slate-100 dark:hover:text-brand-300"
      >
        <span className="block truncate">{name}</span>
      </button>
      <button
        type="button"
        onClick={onPreview}
        className="btn-ghost !px-2 !py-1"
        aria-label="Preview"
      >
        <Eye size={14} />
      </button>
      <button
        type="button"
        onClick={onDownload}
        className="btn-ghost !px-2 !py-1"
        aria-label="Download"
      >
        <Download size={14} />
      </button>
    </div>
  )
}
