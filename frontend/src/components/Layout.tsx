import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Home as HomeIcon,
  Library,
  LayoutGrid,
  Loader2,
  Menu,
  RefreshCw,
  UploadCloud,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import clsx from 'clsx'

import { api, invalidatePreflightCache } from '../api/client'
import { useRuns } from '../store/runs'
import { useGenerationQueue } from '../hooks/useTrackedGenerate'
import { readSelectedProcessId, SELECTED_PROCESS_EVENT } from '../lib/selectedProcess'
import { useSettings } from '../store/settings'

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
      { to: '/publish', label: 'Publish', icon: UploadCloud },
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
  '/publish': 'YouTube Publish',
  '/processes': 'Processes',
  '/settings': 'Settings',
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { settings, update } = useSettings()
  const collapsed = !!settings.sidebarCollapsed

  // A6: react to address-bar updates (e.g. open-in-new-tab navigation, in-app
  // window.history.pushState) without polling on a 500ms interval. The
  // popstate listener catches the back/forward case; pushstate is patched
  // once at module load so React Router's own pushes still flow normally.
  useEffect(() => {
    const sync = () => {
      const actual = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const rendered = `${location.pathname}${location.search}${location.hash}`
      if (actual !== rendered) navigate(actual, { replace: true })
    }
    sync()
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [location.hash, location.pathname, location.search, navigate])

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
      <aside
        className={clsx(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r transition-[width] duration-200 md:flex',
          collapsed ? 'w-[60px]' : 'w-64',
        )}
        style={{ borderColor: 'rgb(var(--line))', backgroundColor: 'rgb(var(--bg-surface))' }}
        aria-label="Primary navigation"
      >
        <Brand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <SidebarFooterWithProgress collapsed={collapsed} />
        <button
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => update({ sidebarCollapsed: !collapsed })}
          className="absolute -right-3 top-1/2 z-20 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border bg-[rgb(var(--bg-surface))] text-faint shadow-sm transition-colors hover:text-[rgb(var(--text-strong))] md:flex"
          style={{ borderColor: 'rgb(var(--line))' }}
        >
          {collapsed ? <ChevronsRight size={12} /> : <ChevronsLeft size={12} />}
        </button>
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
        <SidebarFooterWithProgress />
      </aside>

      {/* ─── Main column ────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <DocumentTitleSync />
        <BackendOfflineBanner />
        <main className="flex-1 px-4 pb-12 pt-6 md:px-10 md:pt-8">
          <div key={location.pathname} className="animate-app-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * A7: write a "(N) TextBro Studio" prefix into document.title that reflects
 * how many runs are running + queued. Restores the original title when no
 * jobs are active.
 */
function DocumentTitleSync() {
  const { runs } = useRuns()
  const { queue } = useGenerationQueue()
  const running = runs.filter((r) => r.status === 'running').length
  const total = running + queue.length

  useEffect(() => {
    const base = 'TextBro Studio'
    document.title = total > 0 ? `(${total}) ${base}` : base
  }, [total])

  return null
}

/**
 * A5: app-wide banner shown when the backend is unreachable. Replaces the
 * tiny sidebar status pill that was easy to miss while scrolling a long
 * Library or Processes page.
 */
function BackendOfflineBanner() {
  const status = useBackendStatus()
  const [retrying, setRetrying] = useState(false)

  if (status !== 'offline') return null

  const retry = async () => {
    setRetrying(true)
    invalidatePreflightCache()
    try {
      await api.preflight({ fresh: true })
    } catch {
      /* the periodic poll in useBackendStatus will flip the dot */
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="alert"
      className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-rose-200/70 bg-rose-50 px-4 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 md:px-10"
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Backend unreachable.</span>{' '}
        <span className="opacity-90">
          Generations and live progress are paused — check that the Flask
          server is running.
        </span>
      </span>
      <button
        type="button"
        className="btn-ghost btn-sm shrink-0 !text-rose-800 hover:!bg-rose-100 dark:!text-rose-100 dark:hover:!bg-rose-500/10"
        onClick={retry}
        disabled={retrying}
      >
        <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
      <NavLink
        to="/settings"
        className="btn-ghost btn-sm shrink-0 !text-rose-800 hover:!bg-rose-100 dark:!text-rose-100 dark:hover:!bg-rose-500/10"
      >
        Open settings
      </NavLink>
    </div>
  )
}

/* ─── Pieces ─────────────────────────────────────────────────────────── */

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 py-5',
        collapsed ? 'justify-center px-3' : 'px-5',
      )}
      style={{ borderBottom: '1px solid rgb(var(--line-soft))' }}
      title={collapsed ? 'TextBro Studio' : undefined}
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
      {!collapsed && (
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold tracking-tight">
            TextBro
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-faint">
            Studio
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const { runs } = useRuns()
  const { queue } = useGenerationQueue()
  // A run is "live" if at least one tracked entry is still in the running
  // state. Shown next to the Processes link so the user never loses sight
  // of an in-flight job when they navigate to Library / Settings / etc.
  // The queue contains pending-only items; the currently-executing run is
  // tracked in the runs store / live generation state.
  const runningCount = runs.filter((r) => r.status === 'running').length
  const queuedCount = queue.length
  const badgeCount = runningCount + queuedCount
  return (
    <nav className={clsx('flex-1 overflow-y-auto pb-4 pt-3', collapsed ? 'px-1.5' : 'px-3')}>
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          {!collapsed && (
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              {group.label}
            </div>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const showRunningBadge = item.to === '/processes' && badgeCount > 0
              const badgeParts: string[] = []
              if (runningCount > 0) badgeParts.push(`${runningCount} running`)
              if (queuedCount > 0) badgeParts.push(`${queuedCount} queued`)
              const badgeLabel = badgeParts.join(' · ')
              return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={collapsed ? (showRunningBadge ? `${item.label} (${badgeLabel})` : item.label) : undefined}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center rounded-md text-[13.5px] font-medium transition-colors',
                    collapsed ? 'h-9 justify-center px-1' : 'gap-2.5 px-2.5 py-1.5',
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
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                    {showRunningBadge && !collapsed && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-200"
                        title={badgeLabel}
                        aria-label={badgeLabel}
                      >
                        {runningCount > 0 && <Loader2 size={10} className="animate-spin" />}
                        {badgeCount}
                      </span>
                    )}
                    {showRunningBadge && collapsed && (
                      <span
                        aria-hidden="true"
                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-500"
                      />
                    )}
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

function SidebarFooterWithProgress({ collapsed = false }: { collapsed?: boolean }) {
  const status = useBackendStatus()
  const { runs } = useRuns()
  const { state } = useGenerationQueue()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => readSelectedProcessId())
  useEffect(() => {
    const syncSelected = () => setSelectedRunId(readSelectedProcessId())
    window.addEventListener(SELECTED_PROCESS_EVENT, syncSelected)
    window.addEventListener('storage', syncSelected)
    return () => {
      window.removeEventListener(SELECTED_PROCESS_EVENT, syncSelected)
      window.removeEventListener('storage', syncSelected)
    }
  }, [])
  const runningRuns = runs.filter((r) => r.status === 'running')
  const trackedRun =
    runningRuns.find((r) => r.id === selectedRunId || r.operationId === selectedRunId) ??
    runningRuns[0]
  const hasLiveState = state.status === 'running'
  const progress = Math.max(
    0,
    Math.min(100, trackedRun?.progress ?? state.progress ?? 0),
  )
  const stage = trackedRun?.stage ?? state.stage
  const message = trackedRun?.message ?? state.message
  const showCurrent = hasLiveState || !!trackedRun
  const label =
    status === 'online'
      ? 'Backend online'
      : status === 'offline'
      ? 'Backend offline'
      : 'Checking backend...'

  if (collapsed) {
    return (
      <div className="mt-auto" style={{ borderTop: '1px solid rgb(var(--line-soft))' }}>
        {showCurrent && (
          <NavLink
            to="/processes"
            className="flex h-9 items-center justify-center transition-colors hover:bg-[rgb(var(--bg-muted))]"
            title={`Current process — ${Math.round(progress)}% — ${message || formatSidebarStage(stage)}`}
            aria-label={`Current process at ${Math.round(progress)}%`}
          >
            <Loader2 size={14} className="animate-spin text-brand-500" />
          </NavLink>
        )}
        <NavLink
          to="/settings"
          title={status === 'offline' ? `${label} — open Settings to ping or change the URL` : label}
          aria-label={`${label} — open settings`}
          className="flex h-9 items-center justify-center transition-colors hover:bg-[rgb(var(--bg-muted))]"
        >
          <span
            aria-hidden="true"
            className={clsx(
              'h-2 w-2 shrink-0 rounded-full',
              status === 'online'
                ? 'bg-emerald-500'
                : status === 'offline'
                ? 'bg-rose-500'
                : 'bg-slate-300 dark:bg-slate-500',
            )}
            style={status === 'online' ? { boxShadow: '0 0 0 3px rgba(16,185,129,0.18)' } : undefined}
          />
        </NavLink>
      </div>
    )
  }

  return (
    <div className="mt-auto" style={{ borderTop: '1px solid rgb(var(--line-soft))' }}>
      {showCurrent && (
        <NavLink
          to="/processes"
          className="block px-4 py-3 transition-colors hover:bg-[rgb(var(--bg-muted))]"
          title="Open current process"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-[rgb(var(--text-strong))]">
              <Loader2 size={12} className="shrink-0 animate-spin text-brand-500" />
              <span className="truncate">Current process</span>
            </span>
            <span className="shrink-0 tabular-nums text-faint">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
              style={{ width: `${Math.max(progress, 3)}%` }}
            />
          </div>
          <div className="mt-1.5 truncate text-[10px] text-muted">
            {message || formatSidebarStage(stage)}
          </div>
        </NavLink>
      )}
      <NavLink
        to="/settings"
        title={
          status === 'offline'
            ? 'Backend not reachable - open Settings to ping or change the URL'
            : 'Open Settings'
        }
        aria-label={`${label} - open settings`}
        className="flex items-center gap-2 px-4 py-3 text-[11px] transition-colors hover:bg-[rgb(var(--bg-muted))]"
      >
        <span
          aria-hidden="true"
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
        <span className={clsx(status === 'offline' ? 'text-rose-600 dark:text-rose-300' : 'text-muted')}>
          {label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-faint">v1.0</span>
      </NavLink>
    </div>
  )
}

function formatSidebarStage(stage: string | undefined): string {
  if (!stage) return 'Working...'
  return stage.replace(/_/g, ' ')
}

export function SidebarFooter() {
  const status = useBackendStatus()
  const label =
    status === 'online'
      ? 'Backend online'
      : status === 'offline'
      ? 'Backend offline'
      : 'Checking backend…'
  // Status row links to /settings — when offline the user gets a one-click
  // path to the "Ping backend" panel instead of a dead-end indicator.
  return (
    <NavLink
      to="/settings"
      title={
        status === 'offline'
          ? 'Backend not reachable — open Settings to ping or change the URL'
          : 'Open Settings'
      }
      aria-label={`${label} — open settings`}
      className="mt-auto flex items-center gap-2 px-4 py-3 text-[11px] transition-colors hover:bg-[rgb(var(--bg-muted))]"
      style={{ borderTop: '1px solid rgb(var(--line-soft))' }}
    >
      <span
        aria-hidden="true"
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
      <span className={clsx(status === 'offline' ? 'text-rose-600 dark:text-rose-300' : 'text-muted')}>
        {label}
      </span>
      <span className="ml-auto font-mono text-[10px] text-faint">v1.0</span>
    </NavLink>
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
