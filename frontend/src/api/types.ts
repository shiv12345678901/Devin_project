export type OutputFormat = 'html' | 'images' | 'pptx' | 'video'

export interface PreflightCheck {
  ok: boolean
  detail: string
}

export interface VideoEngineCheck extends PreflightCheck {
  engines?: Array<'powerpoint' | 'moviepy'>
}

export interface PreflightResponse {
  ok: boolean
  checks: {
    platform: PreflightCheck
    backend: PreflightCheck
    ai_config: PreflightCheck
    powerpoint: PreflightCheck
    video_engine?: VideoEngineCheck
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
  model_choice?: string
  system_prompt?: string
  concurrent_pipeline_runs?: boolean
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
  presentation_file?: string
  video_file?: string
  screenshot_folder?: string
  estimated_total_seconds?: number
  performance?: {
    total_time?: number
    ai_time?: number
    screenshot_time?: number
  }
}

export interface BackendRunStartResponse {
  success: boolean
  run_id: string
  operation_id: string
  queue_position?: number
  error?: string
}

export interface BackendRunDetail {
  success: boolean
  run: {
    run_id: string
    operation_id?: string
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string
    stage?: string
    message?: string
    progress?: number
    queue_position?: number
    outputs?: {
      html_filename?: string
      html_file?: string
      screenshot_files?: string[]
      screenshot_folder?: string
      presentation_file?: string
      presentation_path?: string
      video_file?: string
      video_path?: string
    }
  }
  error?: string
}

export type SseEvent =
  | {
      type: 'started'
      run_id?: string
      operation_id: string
      estimated_total_seconds?: number
      stage?: string
      progress?: number
      message?: string
      /** Server-side per-run log file. Read via GET /logs/<op_id>?tail=N. */
      log_path?: string
    }
  | {
      type: 'queued'
      run_id?: string
      operation_id?: string
      message: string
      progress?: number
      queue_position?: number
    }
  | {
      type: 'progress'
      run_id?: string
      operation_id?: string
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
      presentation_file?: string
      video_file?: string
      operation_id?: string
      performance?: Record<string, number>
      message?: string
      data?: {
        success?: boolean
        message?: string
        html_filename?: string
        html_file?: string
        screenshot_files?: string[]
        screenshot_count?: number
        screenshot_folder?: string
        presentation_file?: string
        presentation_path?: string
        video_file?: string
        video_path?: string
      }
    }
  | { type: 'error'; run_id?: string; operation_id?: string; message: string; log_path?: string }
  | { type: 'cancelled'; run_id?: string; operation_id?: string; message: string }

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
  presentation_file?: string
  video_file?: string
  /** Included since the dedup work in #8 — matches the tracked run's operationId. */
  operation_id?: string
  settings?: Record<string, unknown>
}

export interface ListResponse {
  screenshots: string[]
  html_files: string[]
  presentation_files?: string[]
  video_files?: string[]
}

export interface CacheStats {
  size?: number
  hits?: number
  misses?: number
  [k: string]: unknown
}

export interface YoutubeVideoItem {
  run_id: string
  operation_id?: string
  class_name: string
  subject: string
  chapter_name: string
  title: string
  video_file: string
  video_abs_path?: string | null
  thumbnail_file?: string | null
  thumbnail_abs_path?: string | null
  thumbnail_role?: 'intro' | 'outro' | string | null
  presentation_file?: string | null
  html_file?: string | null
  screenshot_count?: number
  duration_seconds?: number
  completed_at?: number
  input_preview?: string
  input_text?: string
  model_choice?: string | null
}

export interface YoutubeVideosResponse {
  success: boolean
  videos: YoutubeVideoItem[]
  error?: string
}
