interface ToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

/**
 * Green-when-on / gray-when-off switch that matches the old HF Space design.
 * Pulled out of SettingsPanel so the wizard steps can reuse it.
 */
export default function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={
          checked
            ? 'mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-brand-500 transition-colors disabled:opacity-50'
            : 'mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-slate-200 transition-colors disabled:opacity-50 dark:bg-white/10'
        }
      >
        <span
          className={
            checked
              ? 'ml-4 inline-block h-4 w-4 rounded-full bg-white shadow-glass transition-transform'
              : 'ml-0.5 inline-block h-4 w-4 rounded-full bg-white shadow-glass transition-transform'
          }
        />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
        {description && (
          <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>
        )}
      </span>
    </label>
  )
}
