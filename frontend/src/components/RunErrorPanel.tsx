import { AlertTriangle, Clipboard, ListOrdered, RefreshCw } from 'lucide-react'
import { useToast } from '../store/toast'

function likelyCause(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('powerpoint') || m.includes('ppt')) return 'PowerPoint may be closed, busy, blocked by a dialog, or unavailable on this machine.'
  if (m.includes('moviepy') || m.includes('ffmpeg')) return 'The video engine is missing or ffmpeg is not available.'
  if (m.includes('api') || m.includes('key') || m.includes('model')) return 'The AI provider configuration may be missing or rejected.'
  if (m.includes('youtube') || m.includes('sign in') || m.includes('cookies')) return 'YouTube may require cookies or the video/timestamps may be unavailable.'
  if (m.includes('permission') || m.includes('access') || m.includes('write')) return 'The backend may not have permission to write into the output folder.'
  return 'A backend step failed while processing this run.'
}

function nextAction(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('powerpoint') || m.includes('ppt')) return 'Close PowerPoint windows, dismiss any dialogs, then retry the export.'
  if (m.includes('moviepy') || m.includes('ffmpeg')) return 'Install MoviePy/ffmpeg or switch to screenshots/PPTX where available.'
  if (m.includes('api') || m.includes('key') || m.includes('model')) return 'Open Settings, verify the API key, then run System Check again.'
  if (m.includes('youtube') || m.includes('sign in') || m.includes('cookies')) return 'Export YouTube cookies to backend/config/cookies.txt, then retry.'
  if (m.includes('permission') || m.includes('access') || m.includes('write')) return 'Check output folder permissions and disk space, then retry.'
  return 'Open logs for technical details, then retry when the dependency is fixed.'
}

export default function RunErrorPanel({
  title = 'Run failed',
  message,
  onRetry,
  onOpenLogs,
}: {
  title?: string
  message: string
  onRetry?: () => void
  onOpenLogs?: () => void
}) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${title}\n\n${message}`)
      toast.push({ variant: 'success', message: 'Error report copied.' })
    } catch {
      toast.push({ variant: 'error', message: 'Could not copy error report.' })
    }
  }

  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-semibold">{title}</div>
          <div>
            <span className="font-medium">What failed: </span>
            {message || 'The backend did not return a detailed error.'}
          </div>
          <div>
            <span className="font-medium">Likely reason: </span>
            {likelyCause(message)}
          </div>
          <div>
            <span className="font-medium">What to do: </span>
            {nextAction(message)}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {onRetry && (
              <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>
                <RefreshCw size={12} /> Retry
              </button>
            )}
            <button type="button" className="btn-secondary btn-sm" onClick={copy}>
              <Clipboard size={12} /> Copy report
            </button>
            {onOpenLogs && (
              <button type="button" className="btn-secondary btn-sm" onClick={onOpenLogs}>
                <ListOrdered size={12} /> Open logs
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
