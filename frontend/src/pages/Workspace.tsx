import { Link } from 'react-router-dom'
import { ArrowRight, Code2, FileText, Image as ImageIcon, Info } from 'lucide-react'

const TOOLS = [
  {
    to: '/workspace/text',
    title: 'Text → Video',
    tagline: '6-step guided wizard',
    description:
      'Paste source text, pick project metadata, tune AI + rendering, and start a run. The richest flow — supports every knob the backend exposes.',
    icon: FileText,
    accent: 'brand',
    highlights: ['AI content generation', '3-pass verification', 'Full wizard + preflight'],
  },
  {
    to: '/workspace/html',
    title: 'HTML → Video',
    tagline: 'Skip the AI step',
    description:
      'Paste or upload raw HTML. Backed by Playwright rendering. Great when you already have a layout and just want crisp screenshots.',
    icon: Code2,
    accent: 'sky',
    highlights: ['Beautify / minify', 'Bring your own HTML', 'Instant render'],
  },
  {
    to: '/workspace/image',
    title: 'Image / PDF → Video',
    tagline: 'Vision AI extraction',
    description:
      'Upload a photo, screenshot, or PDF. Vision AI extracts text, formats it as HTML, then renders screenshots. Up to 10 PDF pages per run.',
    icon: ImageIcon,
    accent: 'violet',
    highlights: ['OCR via Vision AI', 'PDF support', 'Automatic cleanup'],
  },
] as const

const ACCENT_CLASSES: Record<string, { border: string; bg: string; text: string }> = {
  brand: {
    border: 'border-brand-200 dark:border-brand-500/30',
    bg: 'bg-brand-50 dark:bg-brand-500/10',
    text: 'text-brand-700 dark:text-brand-200',
  },
  sky: {
    border: 'border-sky-200 dark:border-sky-500/30',
    bg: 'bg-sky-50 dark:bg-sky-500/10',
    text: 'text-sky-700 dark:text-sky-200',
  },
  violet: {
    border: 'border-violet-200 dark:border-violet-500/30',
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    text: 'text-violet-700 dark:text-violet-200',
  },
}

export default function Workspace() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Workspace
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Pick a tool to start a run. All three share the same screenshot
          engine — they just differ in how you get HTML to it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {TOOLS.map((t) => {
          const c = ACCENT_CLASSES[t.accent]
          return (
            <Link
              key={t.to}
              to={t.to}
              className="group relative flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-glass transition-shadow hover:shadow-glass-lg dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-lg border ${c.border} ${c.bg} ${c.text}`}
              >
                <t.icon size={22} />
              </div>

              <div>
                <div className={`text-xs font-medium uppercase tracking-wide ${c.text}`}>
                  {t.tagline}
                </div>
                <div className="mt-1 font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {t.title}
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {t.description}
                </p>
              </div>

              <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-slate-400 dark:bg-slate-500" />
                    {h}
                  </li>
                ))}
              </ul>

              <div
                className={`mt-auto inline-flex items-center gap-1 text-sm font-medium ${c.text}`}
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

      <div className="card flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.05] dark:text-slate-300">
          <Info size={16} />
        </div>
        <div className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">
          <div className="font-medium text-slate-800 dark:text-slate-100">
            How tools share state
          </div>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Every run is logged to your local <em>Processes</em> timeline and
            served assets land in the <em>Library</em>. Pick one of the three
            above — the output ends up in the same place.
          </p>
        </div>
      </div>
    </div>
  )
}
