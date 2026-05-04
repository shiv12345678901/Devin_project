import { ArrowRight } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import Banner from './Banner'

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
  const tone = reason === 'duplicate' ? 'warning' : 'danger'
  const title =
    reason === 'in_flight'
      ? 'Another run is already in progress'
      : reason === 'duplicate'
      ? 'Same payload submitted seconds ago'
      : 'Backend refused the run'

  return (
    <Banner
      tone={tone}
      title={title}
      actions={
        <NavLink to="/processes" className="btn-secondary btn-sm shrink-0">
          Open Processes <ArrowRight size={14} />
        </NavLink>
      }
    >
      {message}
    </Banner>
  )
}
