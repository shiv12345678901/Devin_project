import { Link } from 'react-router-dom'
import { ArrowRight, Camera, Code2, FileText, Image as ImageIcon, Images, Info, Video } from 'lucide-react'
import { preloadRoute } from '../lib/routePreload'

type ToolCard = {
  to: string
  title: string
  tagline: string
  description: string
  icon: typeof FileText
  accent: keyof typeof ACCENT_CLASSES
  badges: string[]
  highlights: string[]
}

const CREATE_TOOLS: ToolCard[] = [
  {
    to: '/workspace/text',
    title: 'Text -> Video',
    tagline: 'Full wizard',
    description: 'Paste source text, set project metadata, tune AI and rendering, then start a tracked run.',
    icon: FileText,
    accent: 'brand',
    badges: ['AI required', 'PowerPoint required'],
    highlights: ['Review before start', 'Logs and retry in Processes'],
  },
  {
    to: '/workspace/html',
    title: 'HTML -> Video',
    tagline: 'Bring HTML',
    description: 'Paste or upload raw HTML and send it through the shared screenshot and export pipeline.',
    icon: Code2,
    accent: 'sky',
    badges: ['PowerPoint required', 'Fast'],
    highlights: ['Skip AI generation', 'MP4 / PPTX output'],
  },
  {
    to: '/workspace/image',
    title: 'Image/PDF -> Screenshots',
    tagline: 'Vision extract',
    description: 'Upload a photo, screenshot, or PDF. Vision AI extracts the content and captures screenshots.',
    icon: ImageIcon,
    accent: 'violet',
    badges: ['AI required', 'Screenshots only'],
    highlights: ['PDF support', 'HTML and screenshots saved'],
  },
  {
    to: '/workspace/screenshots',
    title: 'Screenshots -> Video',
    tagline: 'Export only',
    description: 'Upload screenshots you already have and run only the MP4 / PowerPoint export steps.',
    icon: Images,
    accent: 'amber',
    badges: ['PowerPoint required', 'Fast'],
    highlights: ['Drag-drop images', 'Canonical output names'],
  },
  {
    to: '/workspace/youtube',
    title: 'YouTube -> Video',
    tagline: 'Timestamp capture',
    description: 'Capture frames from a YouTube URL at specific timestamps, then export them as video.',
    icon: Video,
    accent: 'rose',
    badges: ['PowerPoint required'],
    highlights: ['Manual timestamps', 'Quality selection'],
  },
]

const UTILITY_TOOLS: ToolCard[] = [
  {
    to: '/workspace/youtube-screenshots',
    title: 'YouTube -> Screenshots',
    tagline: 'Direct capture',
    description: 'Capture YouTube frames into reusable screenshot folders without running video export.',
    icon: Camera,
    accent: 'emerald',
    badges: ['Screenshots only', 'Fast'],
    highlights: ['Saved folders', 'ZIP download'],
  },
  {
    to: '/publish',
    title: 'Publish',
    tagline: 'Metadata',
    description: 'Prepare publish-ready titles, descriptions, thumbnails, and bundles from completed videos.',
    icon: Video,
    accent: 'rose',
    badges: ['Fast'],
    highlights: ['Uses completed MP4s', 'Template-backed text'],
  },
  {
    to: '/library',
    title: 'Library',
    tagline: 'Bundles',
    description: 'Open run bundles and generated files: screenshots, HTML, PPTX, MP4, logs, and settings.',
    icon: Images,
    accent: 'brand',
    badges: ['Fast'],
    highlights: ['Run bundles first', 'Preview and cleanup'],
  },
  {
    to: '/settings',
    title: 'Settings',
    tagline: 'Diagnostics',
    description: 'Check backend health, API keys, PowerPoint, video engines, YouTube cookies, and folders.',
    icon: Info,
    accent: 'sky',
    badges: ['System check'],
    highlights: ['First-run checks', 'Defaults'],
  },
]

const ACCENT_CLASSES = {
  brand: {
    border: 'border-brand-200 dark:border-brand-500/30',
    bg: 'bg-brand-50 dark:bg-brand-500/10',
    text: 'text-brand-700 dark:text-brand-200',
    ring: 'group-hover:ring-brand-200 dark:group-hover:ring-brand-500/30',
  },
  sky: {
    border: 'border-sky-200 dark:border-sky-500/30',
    bg: 'bg-sky-50 dark:bg-sky-500/10',
    text: 'text-sky-700 dark:text-sky-200',
    ring: 'group-hover:ring-sky-200 dark:group-hover:ring-sky-500/30',
  },
  violet: {
    border: 'border-violet-200 dark:border-violet-500/30',
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    text: 'text-violet-700 dark:text-violet-200',
    ring: 'group-hover:ring-violet-200 dark:group-hover:ring-violet-500/30',
  },
  amber: {
    border: 'border-amber-200 dark:border-amber-500/30',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-200',
    ring: 'group-hover:ring-amber-200 dark:group-hover:ring-amber-500/30',
  },
  rose: {
    border: 'border-rose-200 dark:border-rose-500/30',
    bg: 'bg-rose-50 dark:bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-200',
    ring: 'group-hover:ring-rose-200 dark:group-hover:ring-rose-500/30',
  },
  emerald: {
    border: 'border-emerald-200 dark:border-emerald-500/30',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-200',
    ring: 'group-hover:ring-emerald-200 dark:group-hover:ring-emerald-500/30',
  },
} as const

export default function Workspace() {
  return (
    <div className="container-page space-y-10">
      <header>
        <div className="eyebrow">
          <span className="h-1 w-1 rounded-full bg-brand-500" />
          Workspace
        </div>
        <h1 className="mt-3 h-page">Pick a tool to start a run</h1>
        <p className="mt-2 max-w-2xl text-[14.5px] text-muted">
          Creation tools produce tracked runs. Utilities help inspect, publish, clean up, and diagnose the system.
        </p>
      </header>

      <ToolSection title="Create" tools={CREATE_TOOLS} />
      <ToolSection title="Utilities" tools={UTILITY_TOOLS} />

      <aside className="surface flex items-start gap-3 p-5" aria-label="How tools share state">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint"
          style={{ backgroundColor: 'rgb(var(--bg-muted))' }}
        >
          <Info size={15} />
        </div>
        <div className="min-w-0 flex-1 text-[13.5px]">
          <div className="font-medium text-[rgb(var(--text-strong))]">How tools share state</div>
          <p className="mt-1 leading-relaxed text-muted">
            Runs show queued, running, progress, logs, outputs, cancel, and retry controls in Processes. Outputs are grouped as bundles in Library.
          </p>
        </div>
      </aside>
    </div>
  )
}

function ToolSection({ title, tools }: { title: string; tools: ToolCard[] }) {
  return (
    <section className="space-y-3">
      <h2 className="h-section">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => {
          const c = ACCENT_CLASSES[t.accent]
          return (
            <Link
              key={t.to}
              to={t.to}
              onMouseEnter={() => preloadRoute(t.to)}
              onFocus={() => preloadRoute(t.to)}
              className={
                'group surface relative flex flex-col gap-5 p-6 transition-all duration-150 ' +
                'ring-1 ring-transparent hover:-translate-y-0.5 hover:shadow-glass-lg ' +
                c.ring
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${c.border} ${c.bg} ${c.text}`}>
                  <t.icon size={20} />
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {t.badges.map((badge) => (
                    <span key={badge} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-slate-300">
                      {badge}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${c.text}`}>
                  {t.tagline}
                </div>
                <div className="mt-1.5 font-display text-[17px] font-semibold tracking-tight text-[rgb(var(--text-strong))]">
                  {t.title}
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t.description}</p>
              </div>

              <ul className="space-y-1.5 text-[12.5px] text-muted">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-[rgb(var(--text-faint))]" />
                    {h}
                  </li>
                ))}
              </ul>

              <div className={`mt-auto inline-flex items-center gap-1 text-[13px] font-medium ${c.text}`}>
                Open
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
