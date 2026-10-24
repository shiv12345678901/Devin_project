# TextBro (Screenshot Studio) — Codebase Audit — 2026-10-13

> Workspace: `D:\Youtube With Python\Devin_project` · Audited via direct file reads (Bash VM unavailable — `VM_DISK_SPACE_INSUFFICIENT`, workaround via Glob/Read). Graphify GitHub (`github.com/Graphify-Labs/graphify`) was not fetchable — domain blocked by Cowork egress allowlist (only `radoxai.com` allowed) — so Graphify analysis below is from web-search metadata + offline planning.

## 1. What this project actually is

**TextBro — Text → Video Studio**. Turns raw text / raw HTML / images / PDFs / YouTube timestamps into screenshot-ready HTML → paginated 1920×1080 PNGs → optional PowerPoint deck → optional MP4 video. Origin: [`shiv12345678901/yt-project`](https://github.com/shiv12345678901/yt-project) (Screenshot Studio), now a monorepo with React frontend colocated with Flask backend. Target use-case: Nepali educational content (detected from `system_prompt.txt` — Nepali OCR correction, textbook layout), YouTube educational videos, notes sites.

Two run modes today:

| Mode | Stack | What happens |
|---|---|---|
| **A. Dev, two terminals** | `backend/start.py` on :5000 + `frontend npm run dev` on :5173 | Vite proxies API to Flask, hot reload everywhere |
| **B. Single server** | `frontend npm run build` → `frontend/dist` served by Flask at :5000 | Prod-like, single origin, ngrok-ready |

Deployment target in `Dockerfile`: Node 22 builder → `mcr.microsoft.com/playwright/python:v1.40.0-jammy`, `gunicorn` single worker, `USE_POWERPOINT=0`.

---

## 2. High-level architecture

```
User Text / HTML / Image / PDF / YouTube URL
        │
        ▼
React SPA (Vite + TS + Tailwind + React Router)
  pages: Home · Workspace · TextToVideo · HtmlToVideo · ImageToVideo
         ScreenshotsToVideo · YouTubeScreenshots · Library · YouTubePublish · Settings
  store: RunsProvider, SettingsProvider, ToastProvider
  api:  api/client.ts  (fetch + SSE helpers, preflight coalescing)
        │
        │  POST /runs/{text,html,youtube,screenshots}-to-video  → queue
        │  GET  /runs/<id>/events  (SSE)  ← WorkflowContext events
        ▼
Flask app.py  (blueprints)
  ├─ routes/generate.py       — legacy /generate, /generate-sse (kept for compat)
  ├─ routes/html_routes.py    — /generate-html, /beautify, /minify
  ├─ routes/image_routes.py   — /extract-from-image, /image-to-screenshots-sse
  ├─ routes/runs.py           — queued workflows (text/html/youtube/screenshots → video)  ~2.3k LOC
  ├─ routes/resources.py      — /list, /delete, /history, /cache, /metrics
  ├─ routes/youtube_screenshots.py — optional yt-dlp + opencv tool
  └─ app.py                   — CORS, rate limit, /healthz, /version, /preflight, /models/check, SPA fallback
        │
        ├─ src/core/ai_client.py        — OpenAI-compatible chat (streaming, cache, fallback, repair)
        ├─ src/core/vision_client.py    — OCR (PIL preprocessing + vision LLM)
        ├─ src/core/run_manager.py      — JSON file runs store (output/runs/*.json + index.json)
        ├─ src/core/workflow_runner.py  — WorkflowContext + pub/sub event bus
        ├─ src/core/job_queue.py        — single-worker queue (+ pipeline concurrent mode)
        ├─ src/core/pipeline_scheduler.py — ai/screenshot/export slots
        ├─ src/screenshot_engines/playwright_engine.py — BrowserPool + paginated screenshots
        ├─ src/video_engine.py + src/core/powerpoint/* — Dual engine: PowerPoint COM (Windows) / MoviePy (Linux)
        └─ src/utils/* — cache_manager, eta_tracker, content_matcher, html_beautifier, run_guard, run_logger ...
        │
        ▼
  output/
    ├── html/  · screenshots/batch N/  · presentations/  · videos/
    ├── runs/*.json  · history.json  · cache/ai_responses.json  · thumbnails/
    └── config/estimated_times.json + process_time_estimates.json
```

**Request flow (canonical `POST /runs/text-to-video`):**

1. Validate + build `ai_input_text` (project_info prepended), compute synthetic `input_fingerprint` (SHA-256 of settings), dedup against active + recent runs (409 if duplicate/dedup window hit).
2. `create_run(queued)` + `enqueue()` → job enters global `deque`; worker thread (pipeline-aware) picks it up.
3. Worker gets `ai_slot` → streams chat completions (`ai_client.get_ai_response`, with model fallback chain, retry, cancel checks) → `append_missing_content` repair pass → `match_input_to_html` metric → `save_html`.
4. `screenshot_slot` → `take_screenshots` (Playwright, batched with overlap, progress_callback → SSE).
5. `export_slot` → `_run_powerpoint_export` (canonical `class_<n>_<subject>_chapter_<m>_exercise_<year>` stem via `helpers.youtube_video_stem`) using PowerPoint COM or MoviePy VideoStudio.
6. `log_generation` + `ctx.complete` → persisted in `run_manager`, visible in Processes/Library/Publish.

---

## 3. Stack inventory

**Backend** (`backend/requirements.txt`): Flask 3.0, Werkzeug 3.0, flask-cors 4, playwright≥1.40, yt-dlp, opencv-python, numpy, Pillow, PyMuPDF, requests, openai 1.35–2.0 (pinned <2.0), gunicorn (non-Windows), waitress (Windows path), flask-limiter (optional), ffmpeg-python, moviepy≥2.0, proglog, python-pptx 0.6.23, pywin32≥306 (Windows), hypothesis, pytest.

**Frontend** (`frontend/package.json`): React 19.2, react-dom 19.2, react-router-dom 7.14, lucide-react 1.21, Vite 8, TypeScript ~6, Tailwind 3.4, eslint 10.

**Config sources** (duality — see §5): `backend/config/config.example.py` (copied to `config.py`, gitignored), `backend/.env` + project root `.env` (python-dotenv, env wins), plus per-model env overrides (`MODEL_DEFAULT`, `MAX_TOKENS_*`, `API_URL`, etc.). Frontend reads `VITE_BACKEND_URL`, `VITE_BUILD_SHA`.

---

## 4. Frontend map

- `src/App.tsx`: lazy-loaded routes, legacy redirects (`/text-to-video` → `/workspace/text`).
- `src/api/client.ts`: `API_BASE` overrideable at runtime, 409 → `RunRejectedError`, SSE via `fetch`+`ReadableStream` (POST) and `streamSseGet` (GET), preflight coalesced cache (30 s).
- `src/api/types.ts`: `GenerateSettings`, `OutputFormat` (`html|images|pptx|video`), `PreflightResponse`, `BackendRun*`.
- `src/hooks/useTrackedGenerate.tsx` / `useGenerate.ts`: SSE state machine.
- `src/pages/TextToVideo.tsx` (~4.2k LOC): wizard with 6 steps (project → content → screenshot → video → thumbnail → advanced), validation per step, draft autosave (5 s), template system, intro/outro thumbnails, YouTube mode.
- `src/components/*`: Layout, WizardShell, ProgressBar, ScreenshotGallery, PreflightModal, etc.
- `src/lib/thumbnailBuilder.ts`, `youtubePublishTemplate.ts`, `routePreload.ts`, etc.
- `vite.config.ts`: proxies `/runs`, `/generate*`, `/screenshots`, `/html`, `/youtube*`, etc. to `VITE_BACKEND_URL` or localhost:5000.

---

## 5. Understandability debt — why the codebase is hard to navigate

**A. God files.** `routes/runs.py` (~2,300 lines) houses 4 distinct workflows (text/html/youtube/screenshots → video) plus all helpers (`_run_powerpoint_export`, fingerprinting, resume, dedup) — any change to one workflow risks others. `pages/TextToVideo.tsx` (~4,219 lines) is a wizard, thumbnail builder, template CRUD, and mode switch in one file.

**B. sys.path hacks.** `app.py`, `ai_client.py`, `vision_client.py`, `runs.py` all do `sys.path.insert(0, os.path.join(..., 'config'))` / `src` / `routes` to make bare `from config import ...` / `from core...` work. Breaks under `python -m`, linters, and tests; creates import cycles avoided only by lazy imports.

**C. Config duality.** `config.py` literals + env overrides + `MAX_TOKENS_DEFAULT` etc. — reader must check three places to know effective value. `start.py` reads `PORT` vs `FLASK_HOST`, `app.py` reads `HOST`/`PORT`/`DEBUG` vs `CORS_ORIGINS` vs `ALLOWED_ORIGINS` — easy to misconfigure.

**D. Output paths are relative strings.** Everywhere: `"output/screenshots"`, `"output/html"` as bare strings, resolved against `Path.cwd()` at call time. Moving the process cwd silently breaks all I/O. No central `settings.paths` object.

**E. Naming drift.** `TextBro` vs `Screenshot Studio` vs `Devin_project` vs `yt-project` appear interchangeably in docs, `app.py` banner, `start.py`, `README.md`, `Dockerfile`.

**F. Duplicated export logic.** `routes/generate.py` (`/generate-sse`) and `routes/runs.py` (`/runs/text-to-video`) each implement AI→HTML→screenshots→PPTX/MP4 with slightly different branching — the latter is queued/worker-based, the former is inline SSE. Shared helper `helpers.take_screenshots` exists, but export branching is copy-pasted.

**G. Implicit concurrency model.** `job_queue` has classic single-worker + pipeline-opt-in flag (`concurrent_pipeline_runs`) that switches from global `run_guard` lock to per-phase `pipeline_scheduler` locks — undocumented in README, only in comments.

**H. Cache/history on JSON files.** `run_manager` + `cache_manager` + `helpers.log_generation` use file-level locks (`threading.RLock`, `fcntl`/`msvcrt`, atomic `os.replace`) — correct but surprising for a web app; no migration path to DB noted.

**I. Type hints are partial.** Backend is mixed typed/untyped; frontend is stricter (TS) but `GenerateSettings` carries 30+ optional fields used differently per workflow.

---

## 6. Operational notes

- CORS defaults to `*` if `CORS_ORIGINS` unset — logged as warning but still wide open for prototyping.
- Rate limiting off by default (`RATE_LIMIT=on` to enable), in-memory store (needs Redis for multi-worker).
- Playwright browser pooling per thread (`BrowserPool`) with `atexit` cleanup — must run `playwright install chromium` after `pip install`.
- PowerPoint COM probe on Windows spawns `POWERPNT.EXE` — preflight caches for 30 s; `?powerpoint=1` does the expensive launch deliberately.
- Video guarantees: `MIN_VIDEO_SECONDS = 500.0` enforced by auto-bumping per-slide duration.
- ETA tracker: `config/estimated_times.json` + `config/process_time_estimates.json` learn per-model speed, per-resolution and per-concurrency bucket.

---

## 7. Quick wins to improve understandability (no Graphify dependency)

1. **Single settings source.** Introduce `backend/src/config.py` (Pydantic `BaseSettings`) that reads `.env` + env vars, exposes `settings.paths`, `settings.models`, `settings.eta` — deprecate `config/config.py` literals.
2. **Package the backend properly.** Add `backend/pyproject.toml` / `setup.py`, use `from backend.src.core...` imports, remove all `sys.path.insert` blocks, add `python -m backend.app` entry point.
3. **Split god files.** `routes/runs.py` → `routes/runs/{text,html,youtube,screenshots,common}.py`; `pages/TextToVideo.tsx` → `features/wizard/{steps/*,hooks/*,validation.ts}`.
4. **Canonical path object.** Central `paths = { screenshots: Path("output/screenshots"), html: ... }` resolved once at boot via `Path(__file__).resolve().parents[1]`.
5. **Unify export pipeline.** Extract `services/export_pipeline.py` used by both `generate.py` and `runs.py`.
6. **ARCHITECTURE.md + onboarding checklist.** This audit + the companion upgrade plan (GRAPHIFY_UPGRADE_PLAN.md) are the start.
7. **Tests for the tricky bits.** `youtube_video_stem`, fingerprint dedup, cache LRU, screenshot overlap clamping — already has `hypothesis`/`pytest` deps but no tests checked in.

---

## 8. What was actually inspected

Glob of `D:\Youtube With Python\Devin_project` (23425 files, including `.venv`), then targeted reads: `README.md`, `backend/README.md`, `.env.example`, `backend/app.py`, `backend/start.py`, `backend/config/config.example.py`, `backend/config/system_prompt.txt`, `backend/requirements.txt`, `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/App.tsx`, `frontend/src/api/client.ts`, `backend/src/core/{ai_client,vision_client,run_manager,workflow_runner,job_queue}`, `backend/src/screenshot_engines/playwright_engine.py`, `backend/src/utils/{cache_manager,progress_tracker,eta_tracker}`, `backend/routes/{generate,helpers,runs}`. New frontend page count capped by glob.
