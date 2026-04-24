import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Code2,
  FileText,
  Image as ImageIcon,
  Library,
  Play,
  Sparkles,
  XCircle,
} from 'lucide-react'

import { api } from '../api/client'
import { useRuns, formatRelative } from '../store/runs'
import type { PreflightResponse } from '../api/types'

const TOOL_META: Record<
  string,
  { label: string; icon: typeof FileText; tint: string }
> = {
  'text-to-video': {
    label: 'Text → Video',
    icon: FileText,
    tint: 'text-brand-700 dark:text-brand-200',
  },
  'html-to-video': {
    label: 'HTML → Video',
    icon: Code2,
    tint: 'text-sky-700 dark:text-sky-200',
  },
  'image-to-video': {
    label: 'Image → Video',
    icon: ImageIcon,
    tint: 'text-violet-700 dark:text-violet-200',
  },
}

export default function Home() {
  const { runs } = useRuns()
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null)
  const [preflightErr, setPreflightErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .preflight()
      .then((r) => {
        if (!cancelled) setPreflight(r)
      })
      .catch((e) => {
        if (!cancelled) setPreflightErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const running = runs.filter((r) => r.status === 'running').length
    const success = runs.filter((r) => r.status === 'success').length
    const failed = runs.filter((r) => r.status === 'error' || r.status === 'cancelled').length
    return { running, success, failed, total: runs.length }
  }, [runs])

  const recent = useMemo(() => runs.slice(0, 5), [runs])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10">
      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <section className="glass-strong overflow-hidden p-8 md:p-12">
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
              <Sparkles size={12} />
              Turn long text into polished decks
            </div>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 md:text-5xl">
              Text in.
              <br />
              Video slides out.
            </h1>
            <p className="mt-4 text-base text-slate-600 dark:text-slate-300">
              Paste a chapter, a lecture, or raw HTML. TextBro turns it into
              crisp screenshot slides — or a full PowerPoint / MP4 deck on
              Windows — ready to share.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/workspace/text" className="btn-primary">
                <Play size={16} /> Create a video
              </Link>
              <Link to="/library" className="btn-secondary">
                <Library size={16} /> Browse library
              </Link>
            </div>
          </div>

          <div className="hidden shrink-0 md:block">
            <div className="flex h-40 w-40 items-center justify-center rounded-3xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white shadow-glass dark:border-brand-500/20 dark:from-brand-500/10 dark:to-white/[0.02]">
              <Sparkles size={64} className="text-brand-500" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
          At a glance
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Running"
            value={stats.running}
            tone="sky"
            icon={<CircleDot size={16} />}
          />
          <StatCard
            label="Succeeded"
            value={stats.success}
            tone="brand"
            icon={<CheckCircle2 size={16} />}
          />
          <StatCard
            label="Failed"
            value={stats.failed}
            tone="rose"
            icon={<XCircle size={16} />}
          />
          <StatCard
            label="Total runs"
            value={stats.total}
            tone="slate"
            icon={<Activity size={16} />}
          />
        </div>
      </section>

      {/* ─── Preflight ──────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
            System preflight
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Pulled from <code>GET /preflight</code>
          </span>
        </div>
        <div className="card grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {preflight
            ? (['platform', 'backend', 'ai_config', 'powerpoint'] as const).map((k) => {
                const c = preflight.checks[k]
                return (
                  <PreflightPill
                    key={k}
                    label={PREFLIGHT_LABELS[k]}
                    ok={c.ok}
                    detail={c.detail}
                  />
                )
              })
            : preflightErr
            ? (
                <div className="col-span-full flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
                  <AlertCircle size={14} /> Couldn't reach /preflight — {preflightErr}
                </div>
              )
            : [0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-md bg-slate-100 dark:bg-white/[0.04]"
                />
              ))}
        </div>
      </section>

      {/* ─── How it works ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
          How it works
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <HowStep
            step="1"
            title="Paste your content"
            body="A lecture transcript, a blog post, a chapter — anything up to ~100k tokens. Or bring raw HTML, or upload an image / PDF."
          />
          <HowStep
            step="2"
            title="AI lays it out"
            body="We generate semantic HTML from your text, verify completeness up to 3 times, then render it with Playwright at your chosen zoom and viewport."
          />
          <HowStep
            step="3"
            title="Download the deck"
            body="Grab individual screenshots, the full HTML, or (on Windows) a PowerPoint file and MP4 export."
          />
        </div>
      </section>

      {/* ─── Recent activity ────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
            Recent activity
          </h2>
          <Link
            to="/processes"
            className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            View all →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Activity className="text-slate-300 dark:text-slate-600" size={28} />
            <div className="text-sm text-slate-500 dark:text-slate-400">
              No runs yet. Start one from{' '}
              <Link to="/workspace" className="font-medium text-brand-700 dark:text-brand-300">
                Workspace
              </Link>
              .
            </div>
          </div>
        ) : (
          <div className="card divide-y divide-slate-100 dark:divide-white/5">
            {recent.map((r) => {
              const meta = TOOL_META[r.tool]
              const Icon = meta?.icon ?? Activity
              const subtitle =
                r.settings?.title || r.settings?.output_name || r.inputPreview
              // Prefer backend's operationId so the Processes page can
              // highlight/scroll to the row; fall back to the local id.
              const opQuery = r.operationId ?? r.id
              return (
                <Link
                  key={r.id}
                  to={`/processes?op=${encodeURIComponent(opQuery)}`}
                  className="flex items-center gap-3 py-3 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                >
                  <div
                    className={
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 ' +
                      (meta?.tint ?? 'text-slate-500') +
                      ' dark:bg-white/[0.05]'
                    }
                  >
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {subtitle || '(untitled run)'}
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {meta?.label ?? r.tool} · {formatRelative(r.startedAt)}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                  <ArrowRight size={14} className="shrink-0 text-slate-400" />
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

const PREFLIGHT_LABELS: Record<string, string> = {
  platform: 'Platform',
  backend: 'Backend',
  ai_config: 'AI config',
  powerpoint: 'PowerPoint',
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: number
  tone: 'brand' | 'sky' | 'rose' | 'slate'
  icon: React.ReactNode
}) {
  const tones: Record<typeof tone, string> = {
    brand: 'text-brand-700 dark:text-brand-300',
    sky: 'text-sky-700 dark:text-sky-300',
    rose: 'text-rose-700 dark:text-rose-300',
    slate: 'text-slate-700 dark:text-slate-300',
  }
  return (
    <div className="card">
      <div className={'flex items-center gap-2 text-xs font-medium ' + tones[tone]}>
        {icon}
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-semibold text-slate-900 dark:text-slate-50">
        {value}
      </div>
    </div>
  )
}

function PreflightPill({
  label,
  ok,
  detail,
}: {
  label: string
  ok: boolean
  detail: string
}) {
  return (
    <div
      className={
        'flex flex-col gap-1 rounded-md border px-3 py-2 text-xs ' +
        (ok
          ? 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
          : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span>{ok ? '✓' : '—'}</span>
      </div>
      <div className="truncate opacity-80" title={detail}>
        {detail}
      </div>
    </div>
  )
}

function HowStep({
  step,
  title,
  body,
}: {
  step: string
  title: string
  body: string
}) {
  return (
    <div className="card">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 font-display text-sm font-semibold text-white">
        {step}
      </div>
      <div className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{body}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'running') return <span className="badge-running">Running</span>
  if (status === 'success') return <span className="badge-success">Success</span>
  if (status === 'error') return <span className="badge-error">Failed</span>
  if (status === 'cancelled') return <span className="badge-neutral">Cancelled</span>
  return <span className="badge-neutral">{status}</span>
}
