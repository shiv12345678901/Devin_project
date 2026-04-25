import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Code2,
  FileText,
  Image as ImageIcon,
  Library,
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
    const failed = runs.filter(
      (r) => r.status === 'error' || r.status === 'cancelled',
    ).length
    return { running, success, failed, total: runs.length }
  }, [runs])

  const recent = useMemo(() => runs.slice(0, 5), [runs])

  return (
    <div className="container-page space-y-12">
      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="relative">
          <div className="eyebrow">
            <span className="h-1 w-1 rounded-full bg-brand-500" />
            Text → Video Studio
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold leading-[1.1] tracking-tight md:text-[44px]">
            From source text to a polished, frame-perfect deck —{' '}
            <span className="text-muted">in one run.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
            Paste a chapter, a transcript, or raw HTML. TextBro renders it
            with a real browser engine and exports screenshots, PowerPoint,
            or MP4 — all from a single, scriptable backend.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Link to="/workspace/text" className="btn-primary btn-lg">
              Start a new run
              <ArrowRight size={15} />
            </Link>
            <Link to="/library" className="btn-secondary btn-lg">
              <Library size={15} /> Browse library
            </Link>
            <Link
              to="/workspace"
              className="btn-ghost btn-lg ml-1 text-muted hover:text-[rgb(var(--text-strong))]"
            >
              See all tools
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Stats ──────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Overview"
          title="At a glance"
          hint="Live counts from the local Processes log."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Running"   value={stats.running} tone="sky" />
          <StatCard label="Succeeded" value={stats.success} tone="emerald" />
          <StatCard label="Failed"    value={stats.failed}  tone="rose" />
          <StatCard label="Total runs" value={stats.total}   tone="slate" />
        </div>
      </section>

      {/* ─── Preflight ──────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="System"
          title="Backend preflight"
          hint={
            <>
              Pulled from <code className="font-mono text-[12px]">GET /preflight</code>
            </>
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {preflight
            ? (['platform', 'backend', 'ai_config', 'powerpoint'] as const).map(
                (k) => {
                  const c = preflight.checks[k]
                  return (
                    <PreflightTile
                      key={k}
                      label={PREFLIGHT_LABELS[k]}
                      ok={c.ok}
                      detail={c.detail}
                    />
                  )
                },
              )
            : preflightErr
            ? (
                <div className="card col-span-full flex items-start gap-2.5 border-rose-200 bg-rose-50 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Couldn't reach /preflight</div>
                    <div className="mt-0.5 text-xs opacity-80">{preflightErr}</div>
                  </div>
                </div>
              )
            : [0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="surface h-[78px] animate-pulse"
                />
              ))}
        </div>
      </section>

      {/* ─── How it works ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="Pipeline" title="How a run flows" />
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ProcessStep
            n="01"
            title="Ingest"
            body="Paste source text, drop in raw HTML, or upload an image / PDF. Up to ~100k tokens per run."
          />
          <ProcessStep
            n="02"
            title="Render"
            body="Generate semantic HTML with a configurable LLM, run a 3-pass verification, then render with Playwright at your chosen viewport."
          />
          <ProcessStep
            n="03"
            title="Export"
            body="Download screenshots, the underlying HTML, or — on Windows — a PowerPoint deck and MP4 export."
          />
        </ol>
      </section>

      {/* ─── Recent activity ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Activity"
          title="Recent runs"
          action={
            <Link
              to="/processes"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-[rgb(var(--text-strong))]"
            >
              View all <ArrowRight size={13} />
            </Link>
          }
        />
        {recent.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="surface overflow-hidden">
            {recent.map((r, i) => {
              const meta = TOOL_META[r.tool]
              const Icon = meta?.icon ?? Activity
              const subtitle =
                r.settings?.title || r.settings?.output_name || r.inputPreview
              const opQuery = r.operationId ?? r.id
              return (
                <Link
                  key={r.id}
                  to={`/processes?op=${encodeURIComponent(opQuery)}`}
                  className={
                    'group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[rgb(var(--bg-muted))]' +
                    (i > 0 ? ' border-t' : '')
                  }
                  style={i > 0 ? { borderColor: 'rgb(var(--line-soft))' } : undefined}
                >
                  <div
                    className={
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-md ' +
                      (meta?.tint ?? 'text-slate-500')
                    }
                    style={{ backgroundColor: 'rgb(var(--bg-muted))' }}
                  >
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-[rgb(var(--text-strong))]">
                      {subtitle || '(untitled run)'}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                      <span>{meta?.label ?? r.tool}</span>
                      <span className="h-1 w-1 rounded-full bg-[rgb(var(--text-faint))]" />
                      <span className="tabular">{formatRelative(r.startedAt)}</span>
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                  <ArrowRight
                    size={14}
                    className="ml-1 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-[rgb(var(--text-muted))]"
                  />
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

/* ─── Subcomponents ──────────────────────────────────────────────────── */

const PREFLIGHT_LABELS: Record<string, string> = {
  platform: 'Platform',
  backend: 'Backend',
  ai_config: 'AI config',
  powerpoint: 'PowerPoint',
}

function SectionHeader({
  eyebrow,
  title,
  hint,
  action,
}: {
  eyebrow: string
  title: string
  hint?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="mt-1 h-section text-[17px]">{title}</h2>
      </div>
      {action ? action : hint ? (
        <div className="text-[12px] text-faint">{hint}</div>
      ) : null}
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'emerald' | 'sky' | 'rose' | 'slate'
}) {
  // The number is the hero — large, tabular, deeply weighted. The tone dot
  // gives quick visual scanability without blasting color across the tile.
  const dot: Record<typeof tone, string> = {
    emerald: 'bg-emerald-500',
    sky: 'bg-sky-500',
    rose: 'bg-rose-500',
    slate: 'bg-slate-400 dark:bg-slate-500',
  }
  return (
    <div className="surface px-5 py-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        <span className={'h-1.5 w-1.5 rounded-full ' + dot[tone]} />
        {label}
      </div>
      <div
        className="mt-2 font-display text-[32px] font-semibold leading-none tracking-tight tabular text-[rgb(var(--text-strong))]"
        data-slot="number"
      >
        {value}
      </div>
    </div>
  )
}

function PreflightTile({
  label,
  ok,
  detail,
}: {
  label: string
  ok: boolean
  detail: string
}) {
  return (
    <div className="surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {label}
        </span>
        {ok ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} /> OK
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
            <XCircle size={13} /> Issue
          </span>
        )}
      </div>
      <div
        className="mt-1.5 truncate text-[12.5px] text-[rgb(var(--text-strong))]"
        title={detail}
      >
        {detail}
      </div>
    </div>
  )
}

function ProcessStep({
  n,
  title,
  body,
}: {
  n: string
  title: string
  body: string
}) {
  return (
    <li className="surface relative overflow-hidden p-5">
      <div className="font-mono text-[11px] font-medium text-faint">{n}</div>
      <div className="mt-2 font-display text-[15px] font-semibold tracking-tight text-[rgb(var(--text-strong))]">
        {title}
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{body}</p>
      {/* Subtle accent stripe at the top of each step. */}
      <span className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent" />
    </li>
  )
}

function EmptyState() {
  return (
    <div
      className="surface flex flex-col items-center justify-center gap-2 py-14 text-center dot-grid"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--line))] bg-[rgb(var(--bg-surface))] text-faint">
        <Activity size={16} />
      </div>
      <div className="text-[13.5px] font-medium text-[rgb(var(--text-strong))]">
        No runs yet
      </div>
      <div className="max-w-xs text-[12.5px] text-muted">
        Start one from{' '}
        <Link to="/workspace" className="font-medium text-brand-600 hover:underline dark:text-brand-300">
          Workspace
        </Link>{' '}
        — every run will show up here in real time.
      </div>
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
