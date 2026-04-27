import React from 'react'
import { AlertOctagon, RefreshCw } from 'lucide-react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
  info: React.ErrorInfo | null
}

/**
 * Top-level error boundary. Catches any render-time exception in the
 * React tree and renders a recoverable error card instead of a blank
 * white screen. Component-level errors below this point should still
 * use local try/catch + toast for inline failures (network etc.).
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the structured info around for the "Copy details" button. We
    // intentionally do NOT post this anywhere — the app is local-first.
    this.setState({ error, info })
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null, info: null })
  }

  reload = (): void => {
    window.location.reload()
  }

  copyDetails = async (): Promise<void> => {
    const { error, info } = this.state
    if (!error) return
    const text = [
      `Error: ${error.name}: ${error.message}`,
      '',
      'Stack:',
      error.stack ?? '(no stack)',
      '',
      'Component stack:',
      info?.componentStack ?? '(no component stack)',
      '',
      `URL: ${window.location.href}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore — clipboard may be unavailable in non-secure contexts */
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children

    const { error } = this.state
    return (
      <div
        role="alert"
        className="mx-auto my-12 max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-200">
            <AlertOctagon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">
              Something broke while rendering this page
            </h2>
            <p className="mt-1 text-sm text-rose-700/90 dark:text-rose-100/80">
              The app caught the error so the rest of TextBro keeps running.
              You can try going back, reloading, or copying the details to
              report the bug.
            </p>
            <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-white/60 p-3 text-xs text-rose-900 dark:bg-black/30 dark:text-rose-100">
              {error.name}: {error.message}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={this.reload}>
                <RefreshCw size={14} /> Reload app
              </button>
              <button type="button" className="btn-secondary" onClick={this.reset}>
                Try again
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void this.copyDetails()}
              >
                Copy details
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
