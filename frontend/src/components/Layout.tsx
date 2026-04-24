import { NavLink, Outlet } from 'react-router-dom'
import {
  Activity,
  Home as HomeIcon,
  Library,
  LayoutGrid,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react'
import clsx from 'clsx'

type NavItem = {
  to: string
  label: string
  icon: typeof HomeIcon
  end?: boolean
}

// Four primary destinations + Processes as a secondary drill-down.
const primaryNav: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/workspace', label: 'Workspace', icon: LayoutGrid },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

const secondaryNav: NavItem[] = [
  { to: '/processes', label: 'Processes', icon: Activity },
]

export default function Layout() {
  return (
    <div className="relative flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="sticky top-4 m-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col md:flex">
        <div className="glass-strong flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-5 dark:border-white/10">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                TextBro
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Text → Video Studio
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-0.5 p-2">
            {primaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.04]',
                  )
                }
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}

            <div className="my-3 border-t border-slate-100 dark:border-white/5" />

            {secondaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200'
                      : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/[0.04]',
                  )
                }
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500 dark:border-white/10 dark:text-slate-400">
            Local backend · http://localhost:5000
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header + nav */}
        <header className="glass-strong sticky top-0 z-10 m-3 flex items-center justify-between px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-white">
              <Sparkles size={14} />
            </div>
            <span className="font-display text-base font-semibold">TextBro</span>
          </div>
        </header>

        <nav className="glass m-3 mt-0 flex gap-1 overflow-x-auto p-1.5 md:hidden">
          {[...primaryNav, ...secondaryNav].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200'
                    : 'text-slate-600 dark:text-slate-300',
                )
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-x-hidden px-4 pb-8 pt-2 md:px-8 md:pt-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
