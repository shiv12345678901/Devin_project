import { useId, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  /** Optional `aria-label` override for icon-only options. */
  ariaLabel?: string
}

interface Props<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  /** Stretch each segment to fill the row equally. Defaults to true. */
  stretch?: boolean
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Radiogroup-style segmented control — exclusively-selected options
 * rendered in a single rounded row. Replaces hand-rolled "row of buttons,
 * one is highlighted" patterns scattered across pages.
 *
 * Keyboard support: ←/→ to move focus + select, Home/End jump to ends.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  stretch = true,
  size = 'md',
  className,
}: Props<T>) {
  const groupId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const focusAt = (next: number) => {
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
    if (enabled.length === 0) return
    const wrapped = ((next % enabled.length) + enabled.length) % enabled.length
    const targetIdx = enabled[wrapped]
    refs.current[targetIdx]?.focus()
    onChange(options[targetIdx].value)
  }

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
    const cursor = enabled.indexOf(idx)
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        focusAt(cursor + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        focusAt(cursor - 1)
        break
      case 'Home':
        e.preventDefault()
        focusAt(0)
        break
      case 'End':
        e.preventDefault()
        focusAt(enabled.length - 1)
        break
    }
  }

  const sizeClass = size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3 py-2'

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={
        'inline-flex items-stretch rounded-lg border p-0.5 ' +
        'border-[rgb(var(--line))] bg-[rgb(var(--bg-muted))] ' +
        (stretch ? 'w-full ' : '') +
        (className ?? '')
      }
    >
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={`${groupId}-${opt.value}`}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => !opt.disabled && onChange(opt.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ' +
              sizeClass + ' ' +
              (stretch ? 'flex-1 ' : '') +
              (active
                ? 'bg-[rgb(var(--bg-surface))] text-[rgb(var(--text-strong))] shadow-sm '
                : 'text-muted hover:text-[rgb(var(--text-strong))] ') +
              'disabled:cursor-not-allowed disabled:opacity-50 ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-app))]'
            }
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
