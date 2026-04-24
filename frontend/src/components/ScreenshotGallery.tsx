import { Download, Eye, Package } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'

interface Props {
  screenshotFolder?: string
  files: string[]
  title?: string
}

export default function ScreenshotGallery({ screenshotFolder, files, title = 'Screenshots' }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)

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
      const paths = files.map((f) => (screenshotFolder ? `${screenshotFolder}/${f}` : f))
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
      alert(err instanceof Error ? err.message : String(err))
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
              className="glass group overflow-hidden !p-0 !rounded-xl"
            >
              <div className="relative aspect-video overflow-hidden bg-white/30 dark:bg-white/5">
                <img
                  src={url}
                  alt={filename}
                  loading="lazy"
                  className="h-full w-full cursor-zoom-in object-cover"
                  onClick={() => setPreview(url)}
                />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-white/40 px-3 py-2 dark:border-white/10">
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
