import { NavLink, Outlet } from 'react-router-dom'
import { FileText, Code2, ImageIcon, FolderOpen, Sparkles } from 'lucide-react'
import clsx from 'clsx'

const nav = [
  { to: '/text-to-video', label: 'Text to Video', icon: FileText },
  { to: '/html-to-video', label: 'HTML to Video', icon: Code2 },
  { to: '/image-to-video', label: 'Image to Video', icon: ImageIcon },
  { to: '/resources', label: 'Resources', icon: FolderOpen },
]

export default function Layout() {
  return (
    <div className="flex min-h-full bg-slate-50 dark:bg-slate-950">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-6 dark:border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-600 text-white">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="text-base font-semibold text-slate-900 dark:text-slate-50">TextBro</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Text → Video Studio</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-900 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">
              <Sparkles size={16} />
            </div>
            <span className="text-base font-semibold">TextBro</span>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 md:hidden">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'text-slate-600 dark:text-slate-300',
                )
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-x-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
