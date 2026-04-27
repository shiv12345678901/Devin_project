export const SELECTED_PROCESS_KEY = 'textbro:selected-process:v1'
export const SELECTED_PROCESS_EVENT = 'textbro:selected-process-change'

export function readSelectedProcessId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SELECTED_PROCESS_KEY)
}

export function writeSelectedProcessId(id: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SELECTED_PROCESS_KEY, id)
  window.dispatchEvent(new CustomEvent(SELECTED_PROCESS_EVENT, { detail: id }))
}
