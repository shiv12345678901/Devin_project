export interface GenerateSettings {
  zoom?: number
  overlap?: number
  viewport_width?: number
  viewport_height?: number
  max_screenshots?: number
  use_cache?: boolean
  beautify_html?: boolean
  enable_verification?: boolean
  model_choice?: string
  screenshot_folder?: string
  html_folder?: string
}

export interface GenerateResponse {
  success: boolean
  message?: string
  error?: string
  html_filename?: string
  html_content?: string
  screenshot_files?: string[]
  screenshot_count?: number
  screenshot_folder?: string
  estimated_total_seconds?: number
  performance?: {
    total_time?: number
    ai_time?: number
    screenshot_time?: number
  }
}

export type SseEvent =
  | {
      type: 'started'
      operation_id: string
      estimated_total_seconds?: number
      stage?: string
      progress?: number
    }
  | {
      type: 'progress'
      stage: string
      message: string
      progress: number
      eta_seconds?: number
    }
  | {
      type: 'html_generated'
      html_filename: string
      html_content?: string
    }
  | {
      type: 'screenshot'
      index: number
      total: number
      filename: string
      progress: number
    }
  | {
      type: 'complete'
      html_filename: string
      html_content?: string
      screenshot_files: string[]
      screenshot_count: number
      screenshot_folder: string
      operation_id?: string
      performance?: Record<string, number>
    }
  | { type: 'error'; message: string }
  | { type: 'cancelled'; message: string }

export interface HistoryEntry {
  id?: string | number
  timestamp?: string
  tool?: string
  input_preview?: string
  html_file?: string
  screenshot_folder?: string
  screenshot_count?: number
  settings?: Record<string, unknown>
}

export interface ListResponse {
  screenshots: string[]
  html_files: string[]
}

export interface CacheStats {
  size?: number
  hits?: number
  misses?: number
  [k: string]: unknown
}
