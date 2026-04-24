import { Download, Eye, Package } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../store/toast'

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

  // Esc closes the lightbox preview.
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  if (files.length === 0) {
    return (
      <div className="card text-center text-sm text-slate-500">
        No screenshots yet — generate some to see them here.
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
              <div className="relative aspect-video overflow-hidden bg-slate-50 dark:bg-white/[0.04]">
                <img
                  src={url}
                  alt={filename}
                  loading="lazy"
                  className="h-full w-full cursor-zoom-in object-cover"
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
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview}
            alt="Preview"
            className="max-h-full max-w-full rounded-md shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
