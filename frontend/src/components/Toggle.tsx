import { useId } from 'react'

interface ToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

/**
 * Brand-colored switch. Implemented as a real `<input type="checkbox">`
 * (visually hidden) wrapped in a `<label>` so screen readers, keyboard
 * navigation, and form autofill behave correctly. The visible "track"
 * is decorative and tied to the input via `aria-hidden`.
 */
export default function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  const inputId = useId()
  const descId = description ? `${inputId}-desc` : undefined
  return (
    <label
      htmlFor={inputId}
      className={
        'group flex items-start gap-3 ' + (disabled ? 'cursor-not-allowed' : 'cursor-pointer')
      }
    >
      <span className="relative mt-0.5 inline-flex">
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={descId}
          onChange={(e) => onChange(e.target.checked)}
          // Visually hidden but still focusable + reachable by AT.
          className="peer absolute inset-0 h-full w-full cursor-inherit opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={
            'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 ' +
            (checked
              ? 'bg-brand-500'
              : 'bg-slate-200 dark:bg-white/10') +
            (disabled ? ' opacity-50' : '')
          }
        >
          <span
            className={
              'inline-block h-4 w-4 rounded-full bg-white shadow-glass transition-transform ' +
              (checked ? 'translate-x-4' : 'translate-x-0.5')
            }
          />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
        {description && (
          <span id={descId} className="block text-xs text-slate-500 dark:text-slate-400">
            {description}
          </span>
        )}
      </span>
    </label>
  )
}
