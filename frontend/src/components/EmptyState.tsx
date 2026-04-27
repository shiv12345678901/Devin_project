import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  /**
   * One of "default" | "muted". `muted` removes the dot-grid texture for
   * cases where the empty state sits inside an already-decorated card.
   */
  variant?: 'default' | 'muted'
}

/**
 * Friendly empty-state card — used everywhere a list/grid would otherwise
 * render as a single line of grey text. The default variant uses the same
 * dot-grid surface as the dashboard so it reads as "intentionally empty"
 * rather than "broken".
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
}: Props) {
  return (
    <div
      role="status"
      className={
        'flex flex-col items-center justify-center gap-3 rounded-xl px-6 py-12 text-center ' +
        (variant === 'default'
          ? 'surface dot-grid'
          : 'border border-dashed border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02]')
      }
    >
      <EmptyIllustration>{icon}</EmptyIllustration>
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        {title}
      </div>
      {description && (
        <div className="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {description}
        </div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

function EmptyIllustration({ children }: { children?: ReactNode }) {
  // Layered "stacked cards" SVG — feels like a deck of slides waiting to
  // be filled. Uses currentColor so it adopts the brand tint where set.
  return (
    <div className="relative flex h-16 w-16 items-center justify-center text-brand-500/70 dark:text-brand-300/70">
      <svg
        aria-hidden="true"
        viewBox="0 0 64 64"
        fill="none"
        className="absolute inset-0"
      >
        <rect
          x="10"
          y="14"
          width="40"
          height="28"
          rx="4"
          className="fill-slate-100 dark:fill-white/[0.04]"
        />
        <rect
          x="14"
          y="20"
          width="40"
          height="28"
          rx="4"
          className="fill-slate-200/70 dark:fill-white/[0.06]"
        />
        <rect
          x="18"
          y="26"
          width="40"
          height="28"
          rx="4"
          className="fill-white stroke-slate-200 dark:fill-white/[0.08] dark:stroke-white/10"
          strokeWidth="1"
        />
      </svg>
      <div className="relative">
        {children ?? <Inbox size={20} strokeWidth={1.75} />}
      </div>
    </div>
  )
}
