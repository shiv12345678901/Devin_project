"""Versioned OpenAPI contract for the supported export pipeline."""

OPENAPI = {
    "openapi": "3.1.0",
    "info": {
        "title": "TextBro Export API",
        "version": "2.0.0",
        "description": "Tracked text/HTML/screenshot export runs with SSE progress.",
    },
    "paths": {
        "/runs/text-to-video": {"post": {"operationId": "startTextExport", "summary": "Queue text to HTML, screenshots, PPTX, or MP4", "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/TextExportRequest"}}}}, "responses": {"200": {"description": "Run queued", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/RunStart"}}}}, "409": {"description": "Duplicate active/recent run"}}}},
        "/runs/html-to-video": {"post": {"operationId": "startHtmlExport", "summary": "Queue HTML export", "responses": {"200": {"description": "Run queued"}}}},
        "/runs/screenshots-to-video": {"post": {"operationId": "startScreenshotExport", "summary": "Queue screenshot export", "responses": {"200": {"description": "Run queued"}}}},
        "/runs": {"get": {"operationId": "listRuns", "summary": "List persisted runs", "responses": {"200": {"description": "Run summaries"}}}},
        "/runs/{run_id}": {"get": {"operationId": "getRun", "parameters": [{"name": "run_id", "in": "path", "required": True, "schema": {"type": "string"}}], "responses": {"200": {"description": "Run detail"}, "404": {"description": "Not found"}}}},
        "/runs/{run_id}/events": {"get": {"operationId": "streamRunEvents", "summary": "Stream run progress as server-sent events", "parameters": [{"name": "run_id", "in": "path", "required": True, "schema": {"type": "string"}}], "responses": {"200": {"description": "text/event-stream"}}}},
        "/runs/{run_id}/cancel": {"post": {"operationId": "cancelRun", "parameters": [{"name": "run_id", "in": "path", "required": True, "schema": {"type": "string"}}], "responses": {"200": {"description": "Cancellation accepted"}}}},
        "/generate-sse": {"post": {"deprecated": True, "summary": "Legacy adapter to the tracked text export pipeline", "responses": {"200": {"description": "Legacy SSE stream"}}}},
        "/healthz": {"get": {"operationId": "health", "responses": {"200": {"description": "Liveness"}}}},
        "/preflight": {"get": {"operationId": "preflight", "responses": {"200": {"description": "Engine capabilities"}}}},
    },
    "components": {"schemas": {
        "TextExportRequest": {"type": "object", "required": ["text"], "properties": {"text": {"type": "string", "minLength": 1}, "output_format": {"type": "string", "enum": ["html", "images", "pptx", "video"], "default": "images"}, "resolution": {"type": "string", "enum": ["720p", "1080p", "1440p", "4k"], "default": "1080p"}, "fps": {"type": "integer", "minimum": 1, "maximum": 60, "default": 30}, "intro_video_path": {"type": "string"}, "outro_video_path": {"type": "string"}, "narration_audio": {"type": "string"}, "background_music": {"type": "string"}, "logo_path": {"type": "string"}, "voiceover_files": {"type": "array", "items": {"type": ["string", "null"]}}}},
        "RunStart": {"type": "object", "required": ["success", "run_id", "operation_id"], "properties": {"success": {"type": "boolean"}, "run_id": {"type": "string"}, "operation_id": {"type": "string"}, "queue_position": {"type": "integer"}, "estimated_total_seconds": {"type": "number"}}},
    }},
}

