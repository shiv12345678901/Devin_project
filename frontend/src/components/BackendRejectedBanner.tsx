import { AlertTriangle, ArrowRight, Clock } from 'lucide-react'
import { NavLink } from 'react-router-dom'

interface Props {
  reason: 'in_flight' | 'duplicate' | 'unknown'
  message: string
}

/**
 * Inline banner shown on a wizard when the backend rejects the run with
 * 409. Renders a tailored, action-oriented message + a one-click link
 * over to /processes so the user can find / cancel the conflicting run
 * without copy-pasting an opaque error string.
 */
export default function BackendRejectedBanner({ reason, message }: Props) {
  const Icon = reason === 'duplicate' ? Clock : AlertTriangle
  const tone =
    reason === 'duplicate'
      ? 'border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
      : 'border-rose-300/60 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm ${tone}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {reason === 'in_flight'
            ? 'Another run is already in progress'
            : reason === 'duplicate'
            ? 'Same payload submitted seconds ago'
            : 'Backend refused the run'}
        </p>
        <p className="mt-0.5 text-xs opacity-90">{message}</p>
      </div>
      <NavLink
        to="/processes"
        className="btn-secondary btn-sm shrink-0 self-center"
      >
        Open Processes <ArrowRight size={14} />
      </NavLink>
    </div>
  )
}
