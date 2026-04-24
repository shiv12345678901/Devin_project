/**
 * Focus-trap hook for modal dialogs.
 *
 * Requirements (WCAG 2.1.2): when a dialog is open, Tab and Shift+Tab must
 * cycle focus within the dialog, focus must be moved into the dialog on
 * open, and focus must be returned to the previously-focused element on
 * close. We do that with a single keydown listener instead of the heavier
 * `focus-trap` library to keep the bundle small.
 *
 * Usage:
 *   const ref = useFocusTrap<HTMLDivElement>(open)
 *   <div ref={ref} role="dialog" aria-modal>...</div>
 */
import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

export function useFocusTrap<T extends HTMLElement = HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )

    // Move initial focus to the first focusable inside the container so
    // screen readers announce the dialog content immediately.
    const initial = focusables()[0] ?? container
    initial.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // Restore focus only if the previously-focused element is still in
      // the DOM and connected (the dialog might have unmounted it).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus({ preventScroll: true })
        } catch {
          /* element no longer focusable */
        }
      }
    }
  }, [active])

  return ref
}
