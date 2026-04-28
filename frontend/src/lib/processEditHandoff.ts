import type { GenerateSettings } from '../api/types'
import type { RunTool } from '../store/runs'

export const PROCESS_EDIT_HANDOFF_KEY = 'textbro:process-edit-handoff:v1'

export interface ReplacementTargets {
  runId?: string
  htmlFilename?: string
  screenshotFiles?: string[]
  presentationFile?: string
  videoFile?: string
}

export interface ProcessEditHandoff {
  tool: Exclude<RunTool, 'image-to-video' | 'screenshots-to-video'>
  text: string
  settings: GenerateSettings
  replaceTargets: ReplacementTargets
}

export function readProcessEditHandoff(): ProcessEditHandoff | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PROCESS_EDIT_HANDOFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const draft = parsed as Partial<ProcessEditHandoff>
    if (draft.tool !== 'text-to-video' && draft.tool !== 'html-to-video') return null
    if (typeof draft.text !== 'string') return null
    return {
      tool: draft.tool,
      text: draft.text,
      settings: draft.settings ?? {},
      replaceTargets: draft.replaceTargets ?? {},
    }
  } catch {
    return null
  }
}

export function consumeProcessEditHandoff(tool: ProcessEditHandoff['tool']): ProcessEditHandoff | null {
  const draft = readProcessEditHandoff()
  if (!draft || draft.tool !== tool) return null
  try {
    window.sessionStorage.removeItem(PROCESS_EDIT_HANDOFF_KEY)
  } catch {
    /* ignore storage failures */
  }
  return draft
}

