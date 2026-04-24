# Backend ↔ Frontend Analysis

A full walk of `backend/` with every route and its inputs/outputs, mapped
against what the React frontend actually calls. Covers what works today,
what's partially wired, and what to fix before hosting the backend.

---

## 1. Backend surface

### 1.1 Entry points

| File | Purpose |
|------|---------|
| `backend/app.py` | Flask app factory — registers blueprints, serves built SPA, SPA-fallback router. |
| `backend/start.py` | Dev startup script — checks deps, config, Playwright, then runs `app.run(debug=True, port=5000)`. |
| `backend/config/config.example.py` | Template config. Must be copied to `config.py` with real values before running. |

### 1.2 Runtime deps (`requirements.txt`)

- Flask 3 + `flask-cors` (loaded lazily; app still runs without it)
- Playwright 1.40 + Chromium (required — `playwright install chromium`)
- Pillow, PyMuPDF (PDF page rasterization), requests
- `openai>=1.35` (used as a generic OpenAI-compatible client for chat + vision)
- `python-pptx` + `pywin32` — Windows-only, for the PowerPoint video path

### 1.3 Required config (`config/config.py`)

The backend **will not boot** without these:

- `API_KEY`, `API_URL` — any OpenAI-compatible chat/completions endpoint (Groq, OpenAI, NVIDIA NIM, local llama.cpp, …)
- `MODELS_CONFIG["default" | "fast" | "quality"]` — each entry needs `model`, `temperature`, `top_p`, `max_tokens`, `api_key`
- `MODEL_VISION`, `MODEL_VISION_FALLBACK` — vision model for the Image/PDF tool

Everything else (`OUTPUT_FOLDER`, `HTML_FOLDER`, `DEFAULT_*`, PowerPoint paths) has sensible defaults.

---

## 2. Routes — inputs and outputs

### 2.1 `generate.py` (text → screenshots)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/generate` | `{ text, zoom?, overlap?, viewport_width?, viewport_height?, max_screenshots?, use_cache?, beautify_html?, enable_verification?, model_choice?, screenshot_folder?, html_folder? }` | `{ success, html_filename, html_content, screenshot_files[], screenshot_count, screenshot_folder, estimated_total_seconds, metrics, performance }` |
| POST | `/generate-sse` | same body | SSE stream: `started` → `progress` (ai / ai_verify / ai_revision / html_saved / screenshots_done) → `complete` / `error` / `cancelled` |
| POST | `/cancel/<operation_id>` | empty | `{ success, message }` or 404 |
| POST | `/preview` | `{ text, use_cache?, beautify?, model_choice? }` | `{ success, html_content }` (no screenshots) |

Notes:
- `text` limit: ~100k tokens (rejected otherwise).
- Settings: `zoom` default 2.1, `overlap` 15 px, viewport 1920×1080, `max_screenshots` 50, `use_cache` true, `beautify_html` false, `enable_verification` true.
- `operation_id` comes from the `started` SSE event — frontend uses it for `/cancel/<id>`.

### 2.2 `html_routes.py` (HTML → screenshots)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/generate-html` | `{ html, zoom?, overlap?, viewport_width?, viewport_height?, max_screenshots? }` | `{ success, html_filename, screenshot_files[], screenshot_count, screenshot_folder }` |
| POST | `/beautify` | `{ html }` | `{ success, html, validation }` |
| POST | `/minify` | `{ html }` | `{ success, html, original_size, minified_size, reduction_percent }` |

Notes:
- No SSE variant — this path is synchronous.
- No cancel, no cache, no verification loop — it just renders the HTML as-is.

### 2.3 `image_routes.py` (image/PDF → screenshots)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/extract-from-image` | `multipart`: `image` (file), `instructions` (text) | `{ success, raw_text, metadata: {image_count, character_count, word_count}, message }` |
| POST | `/image-to-screenshots-sse` | `multipart`: `image` (file), `instructions`, `zoom`, `overlap`, `viewport_width`, `viewport_height`, `max_screenshots`, `system_prompt` | SSE: `started` → `progress` (vision → ai → html_saved → screenshots) → `complete` / `error` / `cancelled` |

Notes:
- PDFs: first 10 pages only (`fitz.open(...).load_page(i)` capped at 10).
- `complete` event wraps the payload in `result: {...}` — **see gap §4.1**.
- Temp files (`upload_*`, `page_*`) are cleaned up after extraction.

### 2.4 `resources.py` (files, history, cache, metrics)

| Method | Path | Body / query | Response |
|--------|------|--------------|----------|
| GET | `/screenshots/<path>` | path param | PNG bytes, 403 on traversal, 404 if missing |
| GET | `/html/<path>` | path param | HTML text, 403 on traversal, 404 if missing |
| GET | `/download/<path>` | path param | File as attachment (searches `output/screenshots`, `output/videos`, `output/presentations`) |
| GET | `/list` | — | `{ screenshots[], html_files[] }` |
| DELETE | `/delete/<file_type>/<filename>` | path params — `file_type` ∈ `screenshot` / `html` | `{ success, message }` |
| POST | `/regenerate` | `{ html_filename, zoom?, overlap?, viewport_width?, viewport_height?, max_screenshots? }` | `{ success, screenshot_files[], screenshot_count, screenshot_folder }` |
| POST | `/download-zip` | `{ files[], name? }` | ZIP attachment |
| GET | `/history` | — | `HistoryEntry[]` (tool, input_preview, html_file, screenshot_folder, screenshot_count, settings, timestamp) |
| GET | `/cache/stats` | — | `{ size, hits, misses, hit_rate_percent }` |
| POST | `/cache/clear` | — | `{ success, message }` |
| GET | `/metrics/<operation_id>` | — | `{ operation_id, duration, duration_seconds, duration_ms, status, start_time, end_time, metadata }` |

Notes:
- Path-traversal hardened via `_safe_child()` on `/screenshots`, `/html`, and `/regenerate`.
- `/list` flattens `batch N/foo.png` subfolders into the `screenshots[]` array.

---

## 3. What the frontend actually uses

From `frontend/src/api/client.ts` + `hooks/useGenerate.ts`:

| Endpoint | Used by | Notes |
|----------|---------|-------|
| `/generate-sse` | Text→Video page | Fully wired (progress, cancel, ETA, completion). |
| `/generate-html` | HTML→Video page | Sync only — no SSE. |
| `/image-to-screenshots-sse` | Image→Video page | **Bug §4.1** — `complete` event's payload doesn't populate. |
| `/cancel/<id>` | All three pages | Works. |
| `/beautify`, `/minify` | HTML page helpers | Works. |
| `/history`, `/list`, `/cache/stats`, `/cache/clear` | Processes page | Works. |
| `/screenshots/<path>` | `<img>` tags in galleries | **See §4.2** — URL-encoding gap for `batch N/...` names. |
| `/html/<name>` | "Open HTML" links | Works. |

**Defined in client.ts but not called anywhere in the UI today:**

- `api.generate` — the non-SSE text path is never used.
- `api.regenerate` — no re-run-with-new-settings button.
- `api.deleteFile` — no delete button.
- `api.downloadZip` — no "download all as zip" button.

**Backend endpoints the frontend has no client for at all:**

- `/preview` (HTML dry-run).
- `/download/<path>` (single-file download as attachment).
- `/metrics/<operation_id>` (live perf inspection).

---

## 4. Gaps / fixes needed

### 4.1 Image→Video SSE `complete` event mismatch *(blocker for that page)*

`image_routes.py` sends:
```json
{ "type": "complete", ..., "result": { "html_filename": "...", "screenshot_files": ["batch 3/foo.png"], "screenshot_folder": "batch 3" } }
```
But `useGenerate.ts` reads `ev.html_filename`, `ev.screenshot_files`, `ev.screenshot_folder` as flat fields. The end result: Image→Video completes successfully server-side, but the gallery and result panel render empty.

**Fix options:**
- Backend: flatten the payload (`{"type":"complete","html_filename":...,"screenshot_files":...,...}`) to match `generate-sse`.
- Or frontend: unwrap `ev.result` when present.

Flattening the backend is the safer fix — `generate-sse` already does it this way.

### 4.2 Screenshot URL encoding

`api.screenshotUrl('batch 3/foo.png')` produces `/screenshots/batch 3/foo.png`. Browsers percent-encode the space but some servers / proxies won't, and our Flask route reads `<path:filename>` raw. In practice it works for Playwright-rendered names but should be:
```ts
screenshotUrl: (filename: string) =>
  buildUrl('/screenshots/' + filename.split('/').map(encodeURIComponent).join('/'))
```

### 4.3 History "tool" label mismatch

Backend writes `"tool": "text-to-image"` / `"html-to-image"` / `"image-to-screenshots"` / `"regenerate"`.
Client-side runs store uses `"text-to-video"` / `"html-to-video"` / `"image-to-video"`.
Deduplication in `Processes.tsx` is by `html_filename`, so it mostly works — but the filter chips won't match backend history. Normalize both sides.

### 4.4 Missing UI hooks for existing backend features

All implemented server-side, no button yet:
- **Regenerate** — "render again with new zoom / viewport" from a history row.
- **Download ZIP** — batch-download all screenshots from a run.
- **Delete** — remove a screenshot / HTML from disk.
- **Preview** — see AI-generated HTML without rendering screenshots (big cost saver).
- **Live metrics** — `/metrics/<operation_id>` while a run is in flight.

These would slot naturally into each row on the Processes page.

### 4.5 CORS + hosting

- `flask-cors` is loaded with `try/except ImportError`. Fine for local, but for any remote host you should pin `origins` to the actual frontend domain instead of `"*"`.
- No auth. Exposing port 5000 beyond `localhost` should at least require a shared token header — the backend currently has zero access controls.
- No rate limiting. The AI endpoints are expensive; add `Flask-Limiter` or front with a reverse proxy that enforces quotas.

### 4.6 Hosting-readiness summary

**What works out of the box (local):**
- `python start.py` from `backend/` boots the whole app — serves built React at `/` and API everywhere else.
- Dev mode (`npm run dev` + Vite proxy) works without CORS.
- Single-port single-process deploy: `gunicorn -b 0.0.0.0:5000 app:app` on Linux, native Flask on Windows.

**Must fix before remote hosting:**
- Set `DEBUG=False` in `config.py` (currently `True`).
- Install `flask-cors` and pin `origins`.
- Don't use `app.run()` in prod — use `gunicorn` (already in requirements, Linux-only).
- Add at least a shared API-key header or basic-auth wrapper on every route.
- Persist `output/` on a mounted volume if the container is stateless.
- Playwright needs Chromium installed in the image — use `mcr.microsoft.com/playwright/python:v1.40.0` as the base.
- Windows-only `pywin32`/`python-pptx` should be gated — they already are in `requirements.txt`, good.

**Nice to have before shipping:**
- Pin token budgets and request size limits per endpoint.
- Structured logging (right now every route `print()`s to stdout with emojis).
- `/healthz` endpoint for container probes.
- Gunicorn config: `--workers 2 --threads 4 --timeout 600` (screenshot runs are long).

---

## 5. One-page TL;DR

- ✅ Text→Video: backend + frontend fully integrated.
- ✅ HTML→Video: backend + frontend fully integrated.
- ⚠ Image/PDF→Video: works server-side but the `complete` event wraps its payload, so the UI shows no screenshots on success — **fix backend flatten OR frontend unwrap**.
- ✅ Processes page: reads `/history`, `/list`, `/cache/stats`; unified client + backend view.
- ❌ Regenerate, Delete, Download-ZIP, Preview, Metrics endpoints are all implemented server-side but unused in UI.
- ⚠ Screenshot path encoding + history tool-name normalization are low-severity polish.
- ❌ Backend is local-only today; to host remotely you need auth, CORS pinning, prod WSGI, and log sanitization.
