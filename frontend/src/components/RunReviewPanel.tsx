import type React from 'react'
import { Clock, FolderOpen, ListChecks, Play, ShieldCheck } from 'lucide-react'

export interface ReviewItem {
  label: string
  value: React.ReactNode
}

export function RunReviewPanel({
  title = 'Review before start',
  source,
  output,
  project,
  settings,
  dependencies,
  destination = 'Backend output folders',
  estimate,
  onStart,
  startLabel = 'Start run',
  disabled,
  busy,
}: {
  title?: string
  source: ReviewItem[]
  output: ReviewItem[]
  project?: ReviewItem[]
  settings?: ReviewItem[]
  dependencies?: ReviewItem[]
  destination?: React.ReactNode
  estimate?: React.ReactNode
  onStart?: () => void
  startLabel?: string
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <section className="card space-y-5">
      <div>
        <h2 className="h-section">{title}</h2>
        <p className="mt-1 text-sm text-muted">Confirm the source, output, dependencies, and destination before the backend starts.</p>
      </div>

      <ReviewGroup title="Source" items={source} />
      {project && project.length > 0 && <ReviewGroup title="Project" items={project} />}
      <ReviewGroup title="Output" items={output} />
      {settings && settings.length > 0 && <ReviewGroup title="Settings" items={settings} />}

      <div className="grid gap-3 text-sm">
        {estimate && (
          <div className="flex items-start gap-2 rounded-md bg-[rgb(var(--bg-muted))] px-3 py-2">
            <Clock size={15} className="mt-0.5 shrink-0 text-faint" />
            <div>
              <div className="font-medium text-[rgb(var(--text-strong))]">Estimated time</div>
              <div className="text-muted">{estimate}</div>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 rounded-md bg-[rgb(var(--bg-muted))] px-3 py-2">
          <FolderOpen size={15} className="mt-0.5 shrink-0 text-faint" />
          <div>
            <div className="font-medium text-[rgb(var(--text-strong))]">Output destination</div>
            <div className="text-muted">{destination}</div>
          </div>
        </div>
        {dependencies && dependencies.length > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-[rgb(var(--bg-muted))] px-3 py-2">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-faint" />
            <div>
              <div className="font-medium text-[rgb(var(--text-strong))]">Dependencies</div>
              <dl className="mt-1 space-y-1">
                {dependencies.map((item) => (
                  <div key={item.label} className="flex justify-between gap-3 text-xs">
                    <dt className="text-muted">{item.label}</dt>
                    <dd className="text-right text-[rgb(var(--text-strong))]">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </div>

      {onStart && (
        <button type="button" className="btn-primary w-full" onClick={onStart} disabled={disabled || busy}>
          <Play size={16} /> {busy ? 'Starting...' : startLabel}
        </button>
      )}
    </section>
  )
}

function ReviewGroup({ title, items }: { title: string; items: ReviewItem[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <ListChecks size={13} />
        {title}
      </div>
      <dl className="divide-y divide-[rgb(var(--line-soft))] rounded-md border border-[rgb(var(--line))]">
        {items.map((item) => (
          <div key={item.label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
            <dt className="text-muted">{item.label}</dt>
            <dd className="min-w-0 text-[rgb(var(--text-strong))]">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
