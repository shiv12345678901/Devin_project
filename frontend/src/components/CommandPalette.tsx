import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, FileText, Home, Image, Library, Search, Settings, UploadCloud, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { preloadRoute } from '../lib/routePreload'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Command {
  label: string
  path: string
  group: string
  keywords: string
  icon: typeof Home
}

const COMMANDS: Command[] = [
  { label: 'Home', path: '/', group: 'Navigate', keywords: 'dashboard status recent', icon: Home },
  { label: 'New run', path: '/workspace', group: 'Create', keywords: 'workspace tools start', icon: FileText },
  { label: 'Text to Video', path: '/workspace/text', group: 'Create', keywords: 'text ai lesson video', icon: FileText },
  { label: 'HTML to Video', path: '/workspace/html', group: 'Create', keywords: 'html render playwright', icon: FileText },
  { label: 'Image/PDF to Screenshots', path: '/workspace/image', group: 'Create', keywords: 'image pdf ocr screenshot', icon: Image },
  { label: 'Screenshots to Video', path: '/workspace/screenshots', group: 'Create', keywords: 'screenshots export pptx mp4', icon: Image },
  { label: 'YouTube to Video', path: '/workspace/youtube', group: 'Create', keywords: 'youtube timestamps video', icon: UploadCloud },
  { label: 'YouTube to Screenshots', path: '/workspace/youtube-screenshots', group: 'Utility', keywords: 'youtube screenshots capture folder', icon: Image },
  { label: 'Library', path: '/library', group: 'Manage', keywords: 'files outputs assets bundles', icon: Library },
  { label: 'Publish', path: '/publish', group: 'Manage', keywords: 'youtube metadata upload checklist', icon: UploadCloud },
  { label: 'Processes', path: '/processes', group: 'Monitor', keywords: 'runs logs queue progress', icon: FileText },
  { label: 'Settings', path: '/settings', group: 'System', keywords: 'backend theme defaults diagnostics', icon: Settings },
]

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const nav = useNavigate()
  const dialogRef = useFocusTrap<HTMLDivElement>(open)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    const resetId = window.setTimeout(() => setQuery(''), 0)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(resetId)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMANDS
    return COMMANDS.filter((command) =>
      `${command.label} ${command.group} ${command.keywords}`.toLowerCase().includes(q),
    )
  }, [query])

  const run = (command: Command) => {
    preloadRoute(command.path)
    nav(command.path)
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/45 px-4 pt-[12vh] backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="relative w-full max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] shadow-2xl dark:border-white/10"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <Search size={17} className="shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]) run(matches[0])
            }}
            placeholder="Search tools, pages, runs, settings..."
            className="min-w-0 flex-1 bg-transparent text-sm text-[rgb(var(--text-strong))] outline-none placeholder:text-faint"
          />
          <button type="button" className="btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close command palette">
            <X size={15} />
          </button>
        </div>
        <div className="max-h-[56vh] overflow-auto p-2">
          {matches.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted">No commands found.</div>
          ) : (
            matches.map((command) => {
              const Icon = command.icon
              return (
                <button
                  key={command.path}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-[rgb(var(--bg-muted))] focus:bg-[rgb(var(--bg-muted))] focus:outline-none"
                  onMouseEnter={() => preloadRoute(command.path)}
                  onFocus={() => preloadRoute(command.path)}
                  onClick={() => run(command)}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[rgb(var(--text-strong))]">{command.label}</span>
                    <span className="block text-xs text-muted">{command.group}</span>
                  </span>
                  <ArrowRight size={14} className="text-faint" />
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
