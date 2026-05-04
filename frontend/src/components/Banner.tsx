import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Info } from 'lucide-react'

export type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

interface Props {
  tone?: BannerTone
  title?: ReactNode
  children?: ReactNode
  /** Optional leading icon override. Falls back to a tone-appropriate icon. */
  icon?: ReactNode
  /** Optional trailing actions (buttons, links). */
  actions?: ReactNode
  /** ARIA role: `alert` for important conditions, `status` for soft notices. */
  role?: 'alert' | 'status'
  /** Extra class names appended to the outer container. */
  className?: string
}

const TONE_CLASS: Record<BannerTone, string> = {
  info:
    'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  warning:
    'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
  danger:
    'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100',
  neutral:
    'border-[rgb(var(--line))] bg-[rgb(var(--bg-muted))] text-[rgb(var(--text-strong))]',
}

function defaultIcon(tone: BannerTone): ReactNode {
  switch (tone) {
    case 'info':
      return <Info size={16} />
    case 'success':
      return <CheckCircle2 size={16} />
    case 'warning':
      return <Clock size={16} />
    case 'danger':
      return <AlertTriangle size={16} />
    default:
      return <AlertCircle size={16} />
  }
}

/**
 * Inline banner — single primitive for soft alerts, info notices,
 * warnings, and rejected-action states. Replaces ad-hoc colored cards
 * scattered across pages so tone, spacing, and accessibility are
 * defined in one place.
 */
export default function Banner({
  tone = 'info',
  title,
  children,
  icon,
  actions,
  role,
  className,
}: Props) {
  const resolvedRole = role ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status')
  return (
    <div
      role={resolvedRole}
      className={
        'flex flex-wrap items-start gap-3 rounded-md border px-3 py-2.5 text-sm ' +
        TONE_CLASS[tone] +
        (className ? ' ' + className : '')
      }
    >
      <span className="mt-0.5 shrink-0">{icon ?? defaultIcon(tone)}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium leading-snug">{title}</div>}
        {children && (
          <div className={'text-[12.5px] leading-snug opacity-90 ' + (title ? 'mt-0.5' : '')}>
            {children}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}
