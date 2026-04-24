import { NavLink, Outlet } from 'react-router-dom'
import { FileText, Code2, ImageIcon, Activity, Sparkles } from 'lucide-react'
import clsx from 'clsx'

const nav = [
  { to: '/text-to-video', label: 'Text to Video', icon: FileText },
  { to: '/html-to-video', label: 'HTML to Video', icon: Code2 },
  { to: '/image-to-video', label: 'Image to Video', icon: ImageIcon },
  { to: '/processes', label: 'Processes', icon: Activity },
]

export default function Layout() {
  return (
    <div className="relative flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="sticky top-4 m-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 flex-col md:flex">
        <div className="glass-strong flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-white/40 px-5 py-5 dark:border-white/10">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-pink-500 text-white shadow-glass-lg">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                TextBro
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Text → Video Studio</div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                    isActive
                      ? 'border border-white/60 bg-white/70 text-brand-700 shadow-glass backdrop-blur-md dark:border-white/10 dark:bg-white/10 dark:text-brand-200'
                      : 'text-slate-600 hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/5',
                  )
                }
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-white/40 px-5 py-3 text-[11px] text-slate-500 dark:border-white/10 dark:text-slate-400">
            Local backend · http://localhost:5000
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header + nav */}
        <header className="glass-strong sticky top-0 z-10 m-3 flex items-center justify-between rounded-2xl px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-pink-500 text-white">
              <Sparkles size={16} />
            </div>
            <span className="font-display text-base font-semibold">TextBro</span>
          </div>
        </header>

        <nav className="glass m-3 mt-0 flex gap-1 overflow-x-auto p-2 md:hidden">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-white/70 text-brand-700 shadow-glass dark:bg-white/10 dark:text-brand-200'
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
