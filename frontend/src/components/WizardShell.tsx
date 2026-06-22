import type React from 'react'
import { Check, CircleAlert } from 'lucide-react'

export interface WizardStep {
  id: string
  label: string
  shortLabel?: string
  valid?: boolean
}

export function WizardShell({
  eyebrow,
  title,
  subtitle,
  steps,
  activeStep,
  onStep,
  children,
  sidebar,
  footer,
}: {
  eyebrow: string
  title: string
  subtitle?: React.ReactNode
  steps: WizardStep[]
  activeStep: string
  onStep: (id: string) => void
  children: React.ReactNode
  sidebar?: React.ReactNode
  footer?: React.ReactNode
}) {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStep))

  return (
    <div className="container-workbench space-y-6">
      <header>
        <div className="eyebrow">
          <span className="h-1 w-1 rounded-full bg-brand-500" />
          {eyebrow}
        </div>
        <h1 className="h-page mt-2">{title}</h1>
        {subtitle && <p className="mt-2 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </header>

      <ol role="tablist" aria-label={`${title} workflow`} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, index) => {
          const active = step.id === activeStep
          const done = index < activeIndex && step.valid !== false
          const invalid = step.valid === false
          return (
            <li key={step.id} role="presentation">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onStep(step.id)}
                className={
                  'flex min-h-12 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 ' +
                  (active
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-100'
                    : invalid
                    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
                    : done
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : 'border-[rgb(var(--line))] bg-[rgb(var(--bg-surface))] text-muted hover:bg-[rgb(var(--bg-muted))]')
                }
              >
                <span
                  className={
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ' +
                    (active
                      ? 'bg-brand-600 text-white'
                      : invalid
                      ? 'bg-rose-500 text-white'
                      : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-[rgb(var(--bg-muted))] text-muted')
                  }
                >
                  {invalid ? <CircleAlert size={12} /> : done ? <Check size={12} /> : index + 1}
                </span>
                <span className="min-w-0 truncate">{step.shortLabel ?? step.label}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className={sidebar ? 'workbench-grid' : 'space-y-5'}>
        <main className="min-w-0 space-y-5">{children}</main>
        {sidebar && (
          <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            {sidebar}
          </aside>
        )}
      </div>

      {footer}
    </div>
  )
}

export function WizardPanel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card space-y-5">
      <div>
        <h2 className="h-section">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}
