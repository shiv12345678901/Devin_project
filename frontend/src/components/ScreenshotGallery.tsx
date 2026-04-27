import { Download, Eye, ImageOff, Package } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../store/toast'
import HtmlPreviewModal from './HtmlPreviewModal'

interface Props {
  /**
   * Display-only; not used to construct URLs (files already contain any
   * batch-folder prefix). Kept in the props so callers don't need to be
   * edited.
   */
  screenshotFolder?: string
  files: string[]
  title?: string
}

export default function ScreenshotGallery(props: Props) {
  const { files, title = 'Screenshots' } = props
  // props.screenshotFolder is intentionally unused — see Props docs.
  const [preview, setPreview] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)
  const toast = useToast()

  if (files.length === 0) {
    return (
      <div
        className="card flex flex-col items-center justify-center gap-2 py-10 text-center"
        role="status"
      >
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500"
        >
          <ImageOff size={20} />
        </div>
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
          No screenshots yet
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Start a run and finished screenshots will appear here.
        </div>
      </div>
    )
  }

  const downloadZip = async () => {
    setZipping(true)
    try {
      // `files` are already paths relative to OUTPUT_FOLDER (e.g. "batch 3/5(1).png"
      // or "5(1).png"). The backend /download-zip handler resolves them under
      // OUTPUT_FOLDER itself, so we MUST NOT prepend screenshotFolder again —
      // doing so produced "batch 3/batch 3/5(1).png" and empty ZIPs.
      const paths = files
      const blob = await api.downloadZip(paths, 'screenshots')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'screenshots.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.push({
        variant: 'error',
        title: 'Download failed',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {title} ({files.length})
        </h3>
        <button className="btn-secondary" onClick={downloadZip} disabled={zipping}>
          <Package size={16} /> {zipping ? 'Zipping…' : 'Download all (ZIP)'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {files.map((filename) => {
          const url = api.screenshotUrl(filename)
          return (
            <div
              key={filename}
              className="glass group overflow-hidden !p-0"
            >
              {/* `object-contain` so we never crop content; the checkered */}
              {/* background makes letterboxed bars look intentional. */}
              <div
                className="relative aspect-video overflow-hidden"
                style={{
                  backgroundColor: 'rgb(var(--bg-muted))',
                  backgroundImage:
                    'linear-gradient(45deg, rgba(148,163,184,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.12) 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
                }}
              >
                <img
                  src={url}
                  alt={filename}
                  loading="lazy"
                  className="h-full w-full cursor-zoom-in object-contain"
                  onClick={() => setPreview(url)}
                />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 dark:border-white/10">
                <span
                  className="truncate text-xs text-slate-600 dark:text-slate-300"
                  title={filename}
                >
                  {filename.split('/').pop()}
                </span>
                <div className="flex gap-1">
                  <button
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setPreview(url)}
                    title="Preview"
                  >
                    <Eye size={14} />
                  </button>
                  <a
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    href={url}
                    download
                    title="Download"
                  >
                    <Download size={14} />
                  </a>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {preview && (
        <HtmlPreviewModal
          kind="image"
          src={preview}
          title={preview.split('/').pop() ?? 'Screenshot'}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
