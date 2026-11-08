# Architecture

TextBro is a React/Vite client backed by the importable `backend` Python
package. Flask owns HTTP transport; queued workflows own generation; SQLite
owns metadata; generated media remains on disk.

## Export flow

1. A client posts text, HTML, YouTube metadata, or screenshots to `/runs/*`.
2. The backend creates a persisted run and queues a `WorkflowContext` job.
3. AI, Playwright, and export stages publish one normalized event format.
4. `/runs/<run_id>/events` streams those events. Polling `/runs/<run_id>` is
   a safe fallback after network interruption.
5. Linux selects direct FFmpeg. Static/cut-only slides use sparse VFR frames;
   transitions use FFmpeg filters. Voiceovers, narration, music, watermarks,
   and intro/outro clips stay in FFmpeg. MoviePy is compatibility-only.
6. Windows retains the PowerPoint COM engine.

`POST /generate-sse` is a deprecated transport adapter. It submits to the same
tracked run pipeline and translates persisted events; it contains no active
generation orchestration.

## Runtime boundaries

- `backend/src/settings.py`: immutable typed environment settings.
- `backend/src/core`: queue, workflows, AI clients, and run lifecycle.
- `backend/src/storage`: SQLite schema, migration, and retention.
- `backend/src/video_engine.py`: engine selection and media composition.
- `backend/routes`: HTTP validation and response translation.
- `frontend/src/api`: the supported browser contract.

The contract is available at `GET /openapi.json`. Request logs are JSON and
carry `request_id`; workflow logs add `run_id`, `operation_id`, engine, stage,
progress, and ETA.

