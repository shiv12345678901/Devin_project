# TextBro improvement backlog

Audited 2026-11-09 against `main`. Priorities are ordered to improve user
experience (UX), developer experience (DX), and agent experience (AX) together.

## P0 — protect production and make builds trustworthy

1. **Add authentication before exposing the backend.** Protect generation,
   file, cache, delete, model-check, and restart routes with a shared-token
   middleware at minimum; prefer OIDC for multi-user hosting. Keep restart
   disabled for remote clients by default.
2. **Finish the MoviePy retirement.** The direct FFmpeg engine now covers the
   declared workflows and MoviePy is no longer installed by default. After a
   Linux integration test matrix proves parity, delete the optional MoviePy
   implementation and its progress adapter. This removes roughly 270 lines and
   permanently avoids MoviePy's Pillow `<12` constraint.
3. **Add CI quality gates.** Every pull request should run frontend lint/build,
   backend compile/tests, dependency audits, a Docker build, and a small FFmpeg
   smoke encode. The current GitHub workflow only force-syncs `main` to Hugging
   Face and can publish code that has never been tested.
4. **Expand backend integration coverage.** Package imports and typed settings
   are now self-contained; add real browser and FFmpeg fixtures in CI.
5. **Add capacity preflight for 4K.** Before export, check free disk, RAM,
   FFmpeg codecs, writable output paths, and concurrency. Refuse unsafe starts
   with an actionable message instead of failing after minutes of work.

## P1 — reduce change risk and operating cost

### Add

- Generated/shared TypeScript response types from the OpenAPI contract.
- A downloadable diagnostic bundle per run, building on structured JSON logs.
- Real FFmpeg integration fixtures for one slide, 100 slides, transitions,
  voiceovers, intro/outro clips, music, watermark, cancellation, and 4K output.
- Frontend component/accessibility tests plus mobile visual regression tests at
  390, 768, and 1440 px.
- Optional object storage for media when deployments outgrow local disk.
- Redis-backed queue/rate-limit adapters for multi-worker deployments.

### Upgrade/refactor

- Split `TextToVideo.tsx`, `Processes.tsx`, `routes/runs.py`, and
  `video_engine.py` by feature and responsibility. They are the highest-risk
  files for humans and coding agents.
- Delete the unreachable legacy `/generate-sse` implementation after the
  compatibility window; its live adapter already uses `/runs/*`.
- Finish converting remaining relative output paths to an absolute path
  registry resolved at startup.
- Add audio ducking/normalization controls and configurable watermark
  position, opacity, and scale.

### Remove after migration

- Duplicate inline `/generate-sse` orchestration after all tools use queued
  runs.
- Optional MoviePy fallback and proglog adapter after parity tests pass.
- Unused generic `caveman*` agent skills unless they are part of the supported
  contributor workflow; replace them with a project-level `AGENTS.md` that
  documents commands, invariants, and safe edit boundaries.

## P2 — product clarity and polish

- Hide or disable platform-incompatible controls dynamically (PPTX on Linux,
  PowerPoint cleanup toggles on FFmpeg hosts).
- Add an export estimate showing duration, expected temporary disk use, output
  size range, and why transition-heavy video costs more than static VFR video.
- Add queue controls: pause pending work, reprioritize, retry from a failed
  stage, and preserve/reuse completed intermediate artifacts.
- Add keyboard and screen-reader testing for dialogs, thumbnail editing,
  galleries, and the command palette.
- Replace browser-local settings/run state with server profiles when multi-user
  authentication is introduced.

## Changes completed during this audit

- Fixed mobile banner/card/wizard layout and removed duplicate offline noise.
- Removed dead duplicated screenshot JSX, corrected mojibake, and restored a
  clean frontend lint/build.
- Updated production frontend dependencies; production audit is now clean.
- Updated Flask, Werkzeug, Flask-CORS, Requests, and Pillow requirements.
- Removed mandatory MoviePy/proglog and unused `ffmpeg-python` dependencies;
  direct FFmpeg remains the default while optional fallback code is retained.
- Tightened default CORS origins, restricted remote restart, and made preflight
  report FFmpeg/ffprobe truthfully.
- Updated user-facing Linux MP4 guidance and workspace capability labels.
- Packaged backend imports and removed runtime/test `sys.path` mutation.
- Replaced executable config modules with frozen typed environment settings.
- Migrated runs, history, AI cache, pending queue, and ETA samples to WAL-mode
  SQLite with one-time JSON import.
- Added Linux artifact retention and a 2-GiB free-disk floor for small VMs.
- Added OpenAPI 3.1, request/run-correlated JSON logs, and FFmpeg media-time ETA.
- Routed legacy `/generate-sse` traffic through the persisted `/runs/*` pipeline.
- Removed the unused Flask UI and consolidated docs into architecture and
  operations guides.

