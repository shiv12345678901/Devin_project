import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  Archive,
  Download,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Presentation,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'

import { api } from '../api/client'
import AssetPreviewModal from '../components/AssetPreviewModal'
import ErrorCard from '../components/ErrorCard'
import EmptyState from '../components/EmptyState'
import { useToast } from '../store/toast'
import { useConfirm } from '../components/ConfirmDialog'

type AssetKind = 'html' | 'screenshot' | 'presentation' | 'video'
type SortKey = 'name-asc' | 'name-desc'

interface Preview {
  kind: AssetKind
  filename: string
}

function kindLabel(kind: AssetKind): string {
  if (kind === 'screenshot') return 'screenshots'
  if (kind === 'html') return 'HTML files'
  if (kind === 'presentation') return 'PowerPoint files'
  return 'videos'
}

function kindIcon(kind: AssetKind): React.ReactNode {
  if (kind === 'screenshot') return <ImageIcon size={20} />
  if (kind === 'html') return <FileText size={20} />
  if (kind === 'presentation') return <Presentation size={20} />
  return <Film size={20} />
}

/**
 * How many library entries to render per "page". On a full repo a section
 * can contain several hundred files — rendering the whole grid at once
 * pushes the browser into tens of thousands of DOM nodes (4 tiles per
 * card × 500+ = 2k image tags + metadata) and the scroll becomes
 * unusable. We render in pages and auto-load the next page when the
 * sentinel scrolls into view.
 */
const LIBRARY_PAGE_SIZE = 60

export default function Library() {
  const [kind, setKind] = useState<AssetKind>('screenshot')
  const [screenshots, setScreenshots] = useState<string[]>([])
  const [htmlFiles, setHtmlFiles] = useState<string[]>([])
  const [presentationFiles, setPresentationFiles] = useState<string[]>([])
  const [videoFiles, setVideoFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name-desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [working, setWorking] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.list()
      setScreenshots(r.screenshots ?? [])
      setHtmlFiles(r.html_files ?? [])
      setPresentationFiles(r.presentation_files ?? [])
      setVideoFiles(r.video_files ?? [])
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

  const raw =
    kind === 'screenshot'
      ? screenshots
      : kind === 'html'
      ? htmlFiles
      : kind === 'presentation'
      ? presentationFiles
      : videoFiles
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? raw.filter((f) => f.toLowerCase().includes(q)) : [...raw]
    list.sort((a, b) => (sort === 'name-asc' ? a.localeCompare(b) : b.localeCompare(a)))
    return list
  }, [raw, query, sort])

  // Pagination — reset whenever the visible list identity changes (tab
  // switch, search, sort, underlying list reloaded). We defer the reset
  // with setTimeout(0) so the setState doesn't fire synchronously in an
  // effect body (matches the `load()` pattern above and satisfies
  // react-hooks/set-state-in-effect).
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE)
  useEffect(() => {
    const t = setTimeout(() => setVisibleCount(LIBRARY_PAGE_SIZE), 0)
    return () => clearTimeout(t)
  }, [kind, query, sort, raw])
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((n) => Math.min(n + LIBRARY_PAGE_SIZE, filtered.length))
          }
        }
      },
      { rootMargin: '320px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, filtered.length])

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
    kind === 'screenshot'
      ? api.screenshotUrl(name)
      : kind === 'html'
      ? api.htmlUrl(name)
      : api.downloadUrl(kind === 'presentation' ? `output/presentations/${name}` : `output/videos/${name}`)

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
      toast.push({
        variant: 'error',
        title: 'Bulk download failed',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setWorking(false)
    }
  }

  const onDeleteSelected = async () => {
    if (selected.size === 0) return
    const ok = await confirm({
      title: `Delete ${selected.size} file${selected.size === 1 ? '' : 's'}?`,
      message: 'This permanently removes the files from the backend output folder.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    setWorking(true)
    try {
      const type =
        kind === 'screenshot'
          ? 'screenshot'
          : kind === 'html'
          ? 'html'
          : kind === 'presentation'
          ? 'presentation'
          : 'video'
      await Promise.all([...selected].map((name) => api.deleteFile(type, name)))
      const removed = selected.size
      setSelected(new Set())
      await load()
      toast.push({ variant: 'success', message: `Deleted ${removed} file${removed === 1 ? '' : 's'}.` })
    } catch (e) {
      toast.push({
        variant: 'error',
        title: 'Delete failed',
        message: e instanceof Error ? e.message : String(e),
      })
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
            Every screenshot, HTML file, PowerPoint deck, and video produced
            by the backend. Preview, download, or clean up.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Tabs — keyboard navigable per WAI-ARIA tablist pattern. */}
      <LibraryTabs
        kind={kind}
        screenshots={screenshots.length}
        htmlFiles={htmlFiles.length}
        presentationFiles={presentationFiles.length}
        videoFiles={videoFiles.length}
        onSwitch={switchKind}
      />

      {/* Controls row */}
      <div className="card flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <label htmlFor="library-search" className="sr-only">
            Search {kindLabel(kind)}
          </label>
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            id="library-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kindLabel(kind)}...`}
            className="input !pl-9"
          />
        </div>
        <label htmlFor="library-sort" className="sr-only">
          Sort order
        </label>
        <select
          id="library-sort"
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

      {/* Grid / list — rendered as the tabpanel for the selected kind. */}
      <div
        role="tabpanel"
        id={`library-panel-${kind}`}
        aria-labelledby={`library-tab-${kind}`}
        tabIndex={0}
      >
      {error ? (
        <ErrorCard title="Couldn't load library" message={error} onRetry={load} />
      ) : loading ? (
        <div className="card flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        raw.length === 0 ? (
          <EmptyState
            icon={kindIcon(kind)}
            title={`No ${kindLabel(kind)} yet`}
            description={
              <>
                Run a Text→Video, HTML→Video, or Image→Video job and the
                outputs will land here automatically.
              </>
            }
          />
        ) : (
          <EmptyState
            variant="muted"
            icon={<Search size={20} />}
            title="No matches for your search"
            description="Try a shorter query, clear the filter, or switch tabs."
          />
        )
      ) : kind === 'screenshot' ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((name) => (
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
          <LibraryPaginator
            sentinelRef={sentinelRef}
            hasMore={hasMore}
            shown={visible.length}
            total={filtered.length}
            onLoadMore={() => setVisibleCount((n) => Math.min(n + LIBRARY_PAGE_SIZE, filtered.length))}
          />
        </>
      ) : kind === 'html' ? (
        <>
          <div className="card divide-y divide-slate-100 dark:divide-white/5">
            {visible.map((name) => (
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
          <LibraryPaginator
            sentinelRef={sentinelRef}
            hasMore={hasMore}
            shown={visible.length}
            total={filtered.length}
            onLoadMore={() => setVisibleCount((n) => Math.min(n + LIBRARY_PAGE_SIZE, filtered.length))}
          />
        </>
      ) : (
        <>
          <div className="card divide-y divide-slate-100 dark:divide-white/5">
            {visible.map((name) => (
              <GeneratedFileRow
                key={name}
                kind={kind}
                name={name}
                selected={selected.has(name)}
                onToggle={() => toggleOne(name)}
                onPreview={kind === 'video' ? () => setPreview({ kind: 'video', filename: name }) : undefined}
                onDownload={() => onDownloadOne(name)}
              />
            ))}
          </div>
          <LibraryPaginator
            sentinelRef={sentinelRef}
            hasMore={hasMore}
            shown={visible.length}
            total={filtered.length}
            onLoadMore={() => setVisibleCount((n) => Math.min(n + LIBRARY_PAGE_SIZE, filtered.length))}
          />
        </>
      )}
      </div>

      {preview && (
        <AssetPreviewModal
          kind={preview.kind === 'screenshot' ? 'image' : preview.kind === 'html' ? 'html' : 'video'}
          src={urlFor(preview.filename)}
          title={preview.filename.split('/').pop() ?? preview.filename}
          subtitle={
            preview.kind === 'html'
              ? 'HTML file'
              : preview.kind === 'video'
              ? 'MP4 video'
              : preview.filename
          }
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function LibraryPaginator({
  sentinelRef,
  hasMore,
  shown,
  total,
  onLoadMore,
}: {
  sentinelRef: React.MutableRefObject<HTMLDivElement | null>
  hasMore: boolean
  shown: number
  total: number
  onLoadMore: () => void
}) {
  if (total <= LIBRARY_PAGE_SIZE) return null
  return (
    <div className="mt-4 flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <div aria-live="polite">
        Showing {shown.toLocaleString()} of {total.toLocaleString()} items
      </div>
      {hasMore ? (
        <>
          <button type="button" className="btn-secondary btn-sm" onClick={onLoadMore}>
            Load more
          </button>
          <div ref={sentinelRef} aria-hidden="true" className="h-1 w-full" />
        </>
      ) : null}
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

// ─── Tabs ────────────────────────────────────────────────────────────────
// WAI-ARIA tablist pattern with roving-tabindex + arrow-key navigation, so
// Left/Right, Home/End walk between "Screenshots" and "HTML files" and the
// active tab is the one in the document tab order.
function GeneratedFileRow({
  kind,
  name,
  selected,
  onToggle,
  onPreview,
  onDownload,
}: {
  kind: 'presentation' | 'video'
  name: string
  selected: boolean
  onToggle: () => void
  onPreview?: () => void
  onDownload: () => void
}) {
  const Icon = kind === 'presentation' ? Presentation : Film
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
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">
        <span className="block truncate">{name}</span>
        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
          {kind === 'presentation' ? 'PowerPoint deck' : 'MP4 video'}
        </span>
      </div>
      {onPreview && (
        <button type="button" onClick={onPreview} className="btn-ghost !px-2 !py-1" aria-label="Preview">
          <Eye size={14} />
        </button>
      )}
      <button type="button" onClick={onDownload} className="btn-ghost !px-2 !py-1" aria-label="Download">
        <Download size={14} />
      </button>
    </div>
  )
}

function LibraryTabs({
  kind,
  screenshots,
  htmlFiles,
  presentationFiles,
  videoFiles,
  onSwitch,
}: {
  kind: AssetKind
  screenshots: number
  htmlFiles: number
  presentationFiles: number
  videoFiles: number
  onSwitch: (next: AssetKind) => void
}) {
  const tabs: { id: AssetKind; label: string; icon: typeof FileText; count: number }[] = [
    { id: 'screenshot', label: 'Screenshots', icon: ImageIcon, count: screenshots },
    { id: 'html', label: 'HTML files', icon: FileText, count: htmlFiles },
    { id: 'presentation', label: 'PowerPoint', icon: Presentation, count: presentationFiles },
    { id: 'video', label: 'Videos', icon: Film, count: videoFiles },
  ]
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const focusAt = (idx: number) => {
    const n = tabs.length
    const target = ((idx % n) + n) % n
    refs.current[target]?.focus()
    onSwitch(tabs[target].id)
  }

  const onKey = (e: React.KeyboardEvent, idx: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusAt(idx + 1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        focusAt(idx - 1)
        break
      case 'Home':
        e.preventDefault()
        focusAt(0)
        break
      case 'End':
        e.preventDefault()
        focusAt(tabs.length - 1)
        break
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Library kind"
      className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-white/10"
    >
      {tabs.map((t, i) => {
        const active = kind === t.id
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`library-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`library-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSwitch(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
              (active
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
        )
      })}
    </div>
  )
}
