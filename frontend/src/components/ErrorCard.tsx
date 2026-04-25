/**
 * Reusable error banner with structured affordances.
 *
 * Every page used to hand-roll its own red card with just `{error.message}`
 * inside — no retry, no way to copy the full stack, no consistent layout.
 * This component is the standard: title, message, optional error code,
 * optional retry, and a "Copy full error" button that copies a JSON blob
 * (code + message + details) to the clipboard so users can paste it into
 * a bug report without screenshots.
 */
import { useState } from 'react'
import { AlertCircle, Copy, Check, RefreshCw } from 'lucide-react'

export interface ErrorCardProps {
  /** Short heading, e.g. "Couldn't load library". */
  title?: string
  /** Human-readable message. Defaults to the `Error.message` if `error` is given. */
  message?: string
  /** Backend error code (e.g. a stringified HTTP status, `ECONNREFUSED`). */
  code?: string
  /** Optional long-form details the user can copy to clipboard. */
  details?: string
  /** Raw Error / thrown value — used to derive defaults when message is blank. */
  error?: unknown
  /** Click handler for a "Retry" button. Hidden when undefined. */
  onRetry?: () => void
  /** Extra class names appended to the outer container. */
  className?: string
}

function deriveMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return 'An unexpected error occurred.'
}

function deriveDetails(error: unknown): string | undefined {
  if (error instanceof Error && error.stack) return error.stack
  return undefined
}

export default function ErrorCard({
  title = 'Something went wrong',
  message,
  code,
  details,
  error,
  onRetry,
  className,
}: ErrorCardProps) {
  const [copied, setCopied] = useState(false)
  const effectiveMessage = message ?? (error !== undefined ? deriveMessage(error) : '')
  const effectiveDetails = details ?? (error !== undefined ? deriveDetails(error) : undefined)

  const onCopy = async () => {
    const payload = JSON.stringify(
      {
        title,
        code,
        message: effectiveMessage,
        details: effectiveDetails,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    )
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard APIs require a secure context — fall back to a prompt so
      // the user can still grab the text. We avoid logging to console
      // because the caller probably already surfaced the message inline.
      const win = typeof window !== 'undefined' ? window : null
      if (win) win.prompt('Copy error details:', payload)
    }
  }

  return (
    <div
      role="alert"
      className={
        'card flex items-start gap-3 border-rose-200 bg-rose-50 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 ' +
        (className ?? '')
      }
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-rose-800 dark:text-rose-100">{title}</span>
          {code && (
            <code className="rounded border border-rose-300/60 bg-white/50 px-1.5 py-0.5 font-mono text-[11px] text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
              {code}
            </code>
          )}
        </div>
        {effectiveMessage && (
          <div className="mt-1 break-words text-rose-700/90 dark:text-rose-200/90">
            {effectiveMessage}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-400/40 dark:bg-transparent dark:text-rose-100 dark:hover:bg-rose-500/10"
            >
              <RefreshCw size={12} /> Retry
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose-300/60 bg-transparent px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-white/60 dark:border-rose-400/30 dark:text-rose-100 dark:hover:bg-rose-500/10"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy full error'}
          </button>
        </div>
      </div>
    </div>
  )
}
