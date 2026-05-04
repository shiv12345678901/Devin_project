import { useId } from 'react'
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible label rendered next to the box. Pass empty string for an icon-only checkbox. */
  label?: ReactNode
  /** Helper text below the label. */
  description?: ReactNode
  disabled?: boolean
  /** When true, no visible label is rendered — but `aria-label` must be provided. */
  hideLabel?: boolean
  ariaLabel?: string
  /** Extra class on the outer label/wrapper. */
  className?: string
  /** ID for the underlying input — defaults to a generated one. */
  id?: string
}

/**
 * Design-system checkbox. A real `<input type="checkbox">` (visually hidden)
 * with a rendered box + check glyph so styling is consistent across browsers
 * and brand-recoloring works through CSS variables.
 */
export default function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  hideLabel,
  ariaLabel,
  className,
  id,
}: Props) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descId = description ? `${inputId}-desc` : undefined
  const visibleLabel = !hideLabel && label !== undefined && label !== ''

  return (
    <label
      htmlFor={inputId}
      className={
        'group inline-flex items-start gap-2 ' +
        (disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer') +
        (className ? ' ' + className : '')
      }
    >
      <span className="relative mt-0.5 inline-flex">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={descId}
          aria-label={!visibleLabel ? ariaLabel : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-inherit opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors ' +
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 ' +
            (checked
              ? 'border-brand-500 bg-brand-500 text-white'
              : 'border-[rgb(var(--line))] bg-[rgb(var(--bg-surface))]')
          }
        >
          {checked && <Check size={11} strokeWidth={3} />}
        </span>
      </span>
      {visibleLabel && (
        <span className="min-w-0">
          <span className="block text-sm leading-snug text-[rgb(var(--text-strong))]">
            {label}
          </span>
          {description && (
            <span id={descId} className="block text-xs text-muted">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  )
}
