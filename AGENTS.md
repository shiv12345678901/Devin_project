# Contributor and agent guide

## Project map

- `frontend/`: React 19 + TypeScript + Vite UI.
- `backend/`: Flask API, queued workflows, screenshot engines, and video export.
- `backend/src/video_engine.py`: Windows PowerPoint branch and Linux/macOS
  FFmpeg branch. Do not change Windows behavior while optimizing Linux unless
  the task explicitly requests it.
- `backend/routes/runs.py`: canonical queued workflows. Treat
  `/generate-sse` as legacy compatibility code.

## Required checks

Run checks relevant to every changed area before committing:

```bash
cd frontend
npm ci
npm run lint
npm run build

cd ..
python -m compileall -q backend
python -m pytest backend/tests -q
```

Video changes also require `ffmpeg` and `ffprobe` on `PATH`. Add or update a
focused test in `backend/tests/test_video_engine.py`; when available, run a real
Linux FFmpeg smoke encode in addition to command-construction tests.

## Invariants

- Preserve the Windows PowerPoint path unless Windows behavior is in scope.
- Keep generated media and secrets out of Git (`backend/output/`, `.env`,
  `.env`, cookies, API keys).
- Validate all file paths against their intended output root before serving,
  deleting, or moving them.
- Keep one export per small Linux VM by default; 4K work is CPU, RAM, and disk
  intensive.
- Prefer `/runs/*` APIs and shared client helpers over new direct `fetch` calls.
- Keep UI copy platform-aware: PPTX is Windows-only; MP4 is cross-platform via
  FFmpeg on Linux/macOS.
- Any new long-running operation needs cancellation, persisted status,
  structured progress, and cleanup on failure.

## Architecture direction

See `docs/PROJECT_IMPROVEMENT_BACKLOG.md` before broad refactors. Avoid adding
more responsibilities to `TextToVideo.tsx`, `Processes.tsx`, `routes/runs.py`,
or `video_engine.py`; extract focused modules instead.

