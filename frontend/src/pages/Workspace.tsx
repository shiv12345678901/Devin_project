import { Link } from 'react-router-dom'
import { ArrowRight, Code2, FileText, Image as ImageIcon, Info } from 'lucide-react'

const TOOLS = [
  {
    to: '/workspace/text',
    title: 'Text → Video',
    tagline: 'Guided 6-step wizard',
    description:
      'Paste source text, pick project metadata, tune AI + rendering, and start a run. The richest flow — exposes every backend knob.',
    icon: FileText,
    accent: 'brand',
    highlights: [
      'AI content generation',
      '3-pass verification',
      'Full wizard + preflight',
    ],
  },
  {
    to: '/workspace/html',
    title: 'HTML → Video',
    tagline: 'Skip the AI step',
    description:
      'Paste or upload raw HTML. Backed by Playwright rendering. Use it when you already have a layout and just want crisp screenshots.',
    icon: Code2,
    accent: 'sky',
    highlights: ['Beautify / minify', 'Bring your own HTML', 'Instant render'],
  },
  {
    to: '/workspace/image',
    title: 'Image / PDF → Video',
    tagline: 'Vision AI extraction',
    description:
      'Upload a photo, screenshot, or PDF. Vision AI extracts the text, formats it as HTML, then renders screenshots. Up to 10 PDF pages per run.',
    icon: ImageIcon,
    accent: 'violet',
    highlights: ['OCR via Vision AI', 'PDF support', 'Automatic cleanup'],
  },
] as const

const ACCENT_CLASSES: Record<
  string,
  { border: string; bg: string; text: string; ring: string }
> = {
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
}

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
          All three tools share the same screenshot engine — they only differ
          in how source content gets to it.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {TOOLS.map((t) => {
          const c = ACCENT_CLASSES[t.accent]
          return (
            <Link
              key={t.to}
              to={t.to}
              className={
                'group surface relative flex flex-col gap-5 p-6 transition-all duration-150 ' +
                'hover:-translate-y-0.5 hover:shadow-glass-lg ring-1 ring-transparent ' +
                c.ring
              }
            >
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-lg border ${c.border} ${c.bg} ${c.text}`}
              >
                <t.icon size={20} />
              </div>

              <div>
                <div
                  className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${c.text}`}
                >
                  {t.tagline}
                </div>
                <div className="mt-1.5 font-display text-[17px] font-semibold tracking-tight text-[rgb(var(--text-strong))]">
                  {t.title}
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                  {t.description}
                </p>
              </div>

              <ul className="space-y-1.5 text-[12.5px] text-muted">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-[rgb(var(--text-faint))]" />
                    {h}
                  </li>
                ))}
              </ul>

              <div
                className={`mt-auto inline-flex items-center gap-1 text-[13px] font-medium ${c.text}`}
              >
                Open
                <ArrowRight
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </div>
            </Link>
          )
        })}
      </div>

      <aside
        className="surface flex items-start gap-3 p-5"
        aria-label="How tools share state"
      >
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint"
          style={{ backgroundColor: 'rgb(var(--bg-muted))' }}
        >
          <Info size={15} />
        </div>
        <div className="min-w-0 flex-1 text-[13.5px]">
          <div className="font-medium text-[rgb(var(--text-strong))]">
            How tools share state
          </div>
          <p className="mt-1 leading-relaxed text-muted">
            Every run is logged to your local <em>Processes</em> timeline and
            served assets land in the <em>Library</em>. Pick one of the three
            tools above — the output ends up in the same place either way.
          </p>
        </div>
      </aside>
    </div>
  )
}
