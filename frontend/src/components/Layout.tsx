import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  ChevronRight,
  Home as HomeIcon,
  Library,
  LayoutGrid,
  Loader2,
  Menu,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import clsx from 'clsx'

import { api } from '../api/client'
import { useRuns } from '../store/runs'
import { useGenerationQueue } from '../hooks/useTrackedGenerate'

type NavItem = {
  to: string
  label: string
  icon: typeof HomeIcon
  end?: boolean
}

// Two visual groups: primary destinations and a secondary "activity" group
// for runtime-y sections. Keeps the sidebar legible without scrolling once
// more pages get added.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: HomeIcon, end: true },
      { to: '/workspace', label: 'New run', icon: LayoutGrid },
      { to: '/library', label: 'Library', icon: Library },
    ],
  },
  {
    label: 'Activity',
    items: [
      { to: '/processes', label: 'Processes', icon: Activity },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
]

const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/workspace': 'Workspace',
  '/workspace/text': 'Text → Video',
  '/workspace/html': 'HTML → Video',
  '/workspace/image': 'Image → Video',
  '/library': 'Library',
  '/processes': 'Processes',
  '/settings': 'Settings',
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer whenever the route changes. Deferring with a
  // 0ms timeout keeps `react-hooks/set-state-in-effect` happy (same pattern
  // already used in Library / Processes for their initial fetch).
  useEffect(() => {
    const t = setTimeout(() => setMobileOpen(false), 0)
    return () => clearTimeout(t)
  }, [location.pathname])

  return (
    <div className="relative flex min-h-full">
      {/* ─── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r md:flex"
             style={{ borderColor: 'rgb(var(--line))', backgroundColor: 'rgb(var(--bg-surface))' }}>
        <Brand />
        <SidebarNav />
        <SidebarFooter />
      </aside>

      {/* ─── Mobile drawer ──────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ borderColor: 'rgb(var(--line))', backgroundColor: 'rgb(var(--bg-surface))' }}
      >
        <div className="flex items-center justify-between pr-2">
          <Brand />
          <button
            type="button"
            className="btn-ghost btn-sm mr-2"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>
        <SidebarNav />
        <SidebarFooter />
      </aside>

      {/* ─── Main column ────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 pb-12 pt-6 md:px-10 md:pt-8">
          <div key={location.pathname} className="animate-app-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

/* ─── Pieces ─────────────────────────────────────────────────────────── */

function Brand() {
  return (
    <div
      className="flex items-center gap-3 px-5 py-5"
      style={{ borderBottom: '1px solid rgb(var(--line-soft))' }}
    >
      <div className="relative flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
        {/* Wordmark glyph — a simple geometric "T" + line that reads as a
            content-to-frames mark. No emoji, no sparkle. */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path d="M5 6h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 6v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <rect x="14.5" y="11.5" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="font-display text-[15px] font-semibold tracking-tight">
          TextBro
        </div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-faint">
          Studio
        </div>
      </div>
    </div>
  )
}

function SidebarNav() {
  const { runs } = useRuns()
  const { queue } = useGenerationQueue()
  // A run is "live" if at least one tracked entry is still in the running
  // state. Shown next to the Processes link so the user never loses sight
  // of an in-flight job when they navigate to Library / Settings / etc.
  // The queue *includes* the currently-executing item, so pending = len-1
  // when a run is live, or = len when idle.
  const runningCount = runs.filter((r) => r.status === 'running').length
  const queuedCount = Math.max(0, queue.length - (runningCount > 0 ? 1 : 0))
  const badgeCount = runningCount + queuedCount
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
            {group.label}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const showRunningBadge = item.to === '/processes' && badgeCount > 0
              return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors',
                    isActive
                      ? 'text-[rgb(var(--text-strong))]'
                      : 'text-muted hover:text-[rgb(var(--text-strong))]',
                  )
                }
                style={({ isActive }) => ({
                  backgroundColor: isActive ? 'rgb(var(--bg-muted))' : 'transparent',
                })}
              >
                {({ isActive }) => (
                  <>
                    {/* Active marker: a 2px brand-colored bar on the left. */}
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'absolute inset-y-1.5 left-0 w-0.5 rounded-r-full transition-opacity',
                        isActive ? 'bg-brand-500 opacity-100' : 'opacity-0',
                      )}
                    />
                    <item.icon
                      size={15}
                      strokeWidth={isActive ? 2.25 : 1.75}
                      className={clsx(
                        'shrink-0 transition-colors',
                        isActive ? 'text-brand-600 dark:text-brand-300' : 'text-faint group-hover:text-[rgb(var(--text-muted))]',
                      )}
                    />
                    <span className="flex-1">{item.label}</span>
                    {showRunningBadge && (() => {
                      const parts: string[] = []
                      if (runningCount > 0) {
                        parts.push(`${runningCount} running`)
                      }
                      if (queuedCount > 0) {
                        parts.push(`${queuedCount} queued`)
                      }
                      const label = parts.join(' · ')
                      return (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-200"
                          title={label}
                          aria-label={label}
                        >
                          {runningCount > 0 && <Loader2 size={10} className="animate-spin" />}
                          {badgeCount}
                        </span>
                      )
                    })()}
                  </>
                )}
              </NavLink>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function SidebarFooter() {
  const status = useBackendStatus()
  return (
    <div
      className="mt-auto flex items-center gap-2 px-4 py-3 text-[11px]"
      style={{ borderTop: '1px solid rgb(var(--line-soft))' }}
    >
      <span
        className={clsx(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          status === 'online'
            ? 'bg-emerald-500'
            : status === 'offline'
            ? 'bg-rose-500'
            : 'bg-slate-300 dark:bg-slate-500',
        )}
        style={status === 'online' ? { boxShadow: '0 0 0 3px rgba(16,185,129,0.18)' } : undefined}
      />
      <span className="text-muted">
        {status === 'online' ? 'Backend online' : status === 'offline' ? 'Backend offline' : 'Checking backend…'}
      </span>
      <span className="ml-auto font-mono text-[10px] text-faint">v1.0</span>
    </div>
  )
}

function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const location = useLocation()
  const path = location.pathname.replace(/\/+$/, '') || '/'

  // Build crumbs: Workspace > Text → Video, etc.
  const crumbs = buildCrumbs(path)

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-2 px-4 backdrop-blur md:px-10"
      style={{
        backgroundColor: 'rgb(var(--bg-app) / 0.78)',
        borderBottom: '1px solid rgb(var(--line-soft))',
      }}
    >
      <button
        type="button"
        className="btn-ghost btn-sm md:hidden"
        onClick={onOpenMenu}
        aria-label="Open menu"
      >
        <Menu size={16} />
      </button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 truncate text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <span key={c.to} className="flex items-center gap-1.5 truncate">
              {i > 0 && (
                <ChevronRight size={13} className="shrink-0 text-faint" />
              )}
              {last ? (
                <span className="truncate font-medium text-[rgb(var(--text-strong))]">
                  {c.label}
                </span>
              ) : (
                <NavLink
                  to={c.to}
                  className="truncate text-muted transition-colors hover:text-[rgb(var(--text-strong))]"
                >
                  {c.label}
                </NavLink>
              )}
            </span>
          )
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* Tiny keyboard hint — like Linear / Raycast. Decorative; no
            shortcut wired yet, but signals "this app expects keyboard use". */}
        <span className="hidden items-center gap-1 text-[11px] text-faint md:inline-flex">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </div>
    </header>
  )
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

function buildCrumbs(path: string): { to: string; label: string }[] {
  if (path === '/') return [{ to: '/', label: 'Home' }]
  const segments = path.split('/').filter(Boolean)
  const crumbs: { to: string; label: string }[] = [{ to: '/', label: 'Home' }]
  let acc = ''
  for (const seg of segments) {
    acc += '/' + seg
    const fromMap = ROUTE_TITLES[acc]
    const fromNav = ALL_ITEMS.find((i) => i.to === acc)?.label
    crumbs.push({
      to: acc,
      label: fromMap ?? fromNav ?? seg.replace(/-/g, ' '),
    })
  }
  return crumbs
}

type Status = 'pending' | 'online' | 'offline'

function useBackendStatus(): Status {
  const [status, setStatus] = useState<Status>('pending')

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const ping = async () => {
      try {
        await api.preflight()
        if (!cancelled) setStatus('online')
      } catch {
        if (!cancelled) setStatus('offline')
      } finally {
        if (!cancelled) timer = setTimeout(ping, 30_000)
      }
    }

    ping()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return status
}
