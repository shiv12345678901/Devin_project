interface Props {
  progress: number
  stage?: string
  message?: string
  etaSeconds?: number
}

export default function ProgressBar({ progress, stage, message, etaSeconds }: Props) {
  const clamped = Math.max(0, Math.min(100, progress))
  return (
    <div className="card">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {stage ? stage.replace(/_/g, ' ') : 'Working…'}
        </div>
        <div className="text-sm tabular-nums text-slate-500">{Math.round(clamped)}%</div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {message && (
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{message}</div>
      )}
      {typeof etaSeconds === 'number' && etaSeconds > 0 && (
        <div className="mt-1 text-xs text-slate-500">~{Math.round(etaSeconds)}s remaining</div>
      )}
    </div>
  )
}
