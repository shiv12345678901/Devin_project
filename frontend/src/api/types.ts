export type OutputFormat = 'html' | 'images' | 'pptx' | 'video'

export interface PreflightCheck {
  ok: boolean
  detail: string
}

export interface PreflightResponse {
  ok: boolean
  checks: {
    platform: PreflightCheck
    backend: PreflightCheck
    ai_config: PreflightCheck
    powerpoint: PreflightCheck
  }
}

export interface GenerateSettings {
  // Project metadata (Step 1 — drives gating + history search)
  class_name?: string
  subject?: string
  title?: string
  output_format?: OutputFormat
  // Screenshot rendering
  zoom?: number
  overlap?: number
  viewport_width?: number
  viewport_height?: number
  max_screenshots?: number
  use_cache?: boolean
  beautify_html?: boolean
  enable_verification?: boolean
  model_choice?: string
  system_prompt?: string
  // Output paths / names
  output_name?: string
  screenshot_folder?: string
  html_folder?: string
  // Images → MP4 / PowerPoint export (Windows-only; pass-through otherwise)
  resolution?: '720p' | '1080p' | '1440p' | '4k'
  video_quality?: number
  fps?: number
  slide_duration_sec?: number
  close_powerpoint_before_start?: boolean
  auto_timing_screenshot_slides?: boolean
  fixed_seconds_per_screenshot_slide?: number
  // Intro thumbnail — inserted on slide 2 of the deck.
  intro_thumbnail_enabled?: boolean
  intro_thumbnail_filename?: string
  intro_thumbnail_duration_sec?: number
  // Outro thumbnail — inserted on the 2nd-to-last slide.
  outro_thumbnail_enabled?: boolean
  outro_thumbnail_filename?: string
  outro_thumbnail_duration_sec?: number
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
  /** Unix timestamp as a float (from `time.time()`). Prefer `datetime`. */
  timestamp?: number | string
  /** Human-readable local time, e.g. "2024-03-04 10:30:00". */
  datetime?: string
  tool?: string
  input_preview?: string
  html_file?: string
  screenshot_folder?: string
  screenshot_count?: number
  /** Included since the dedup work in #8 — matches the tracked run's operationId. */
  operation_id?: string
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
