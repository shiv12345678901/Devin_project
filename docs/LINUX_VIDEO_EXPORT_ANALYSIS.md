# Linux Video Export Analysis

## Scope
This analysis traces how MP4 export behaves on Linux hosts and where failures are surfaced.

## Current behavior summary
- The backend now supports a dual-path export engine in `backend/src/video_engine.py`:
  - **Windows:** COM-based PowerPoint export.
  - **Linux/macOS:** MoviePy + ffmpeg export from screenshots.
- A hard platform guard still exists in the legacy `/generate` SSE route (`backend/routes/generate.py`) that blocks `output_format=video` on non-Windows.
- The newer run-based routes in `backend/routes/runs.py` use `VideoStudio.build_video(...)` and can export MP4 on Linux when MoviePy and ffmpeg are available.

## Detailed code-path findings

### 1) Linux-capable engine exists
`VideoStudio` explicitly selects a MoviePy/ffmpeg path for non-Windows hosts and documents Linux/macOS behavior in module docs and runtime branches.

Operational impact:
- Linux MP4 export **is architecturally supported** in the engine layer.
- If ffmpeg or MoviePy is unavailable, the engine raises `MovieEngineUnavailableError` with install guidance.

### 2) Legacy route still blocks Linux video output
In `backend/routes/generate.py`, a platform check rejects `video`/`pptx` output when host OS is not Windows.

Operational impact:
- Any client still using `/generate` cannot export video on Linux, regardless of the new engine.
- Error messaging is explicit and currently advises users to switch formats.

### 3) Run-based API supports Linux video export
`backend/routes/runs.py` calls shared `_run_powerpoint_export(...)`, which delegates to `VideoStudio.build_video(...)`. On Linux this resolves to the MoviePy path rather than COM.

Operational impact:
- Clients using `/runs/text-to-video` and `/runs/screenshots-to-video` can produce MP4 on Linux if prerequisites exist.

### 4) Host dependency gap (ffmpeg)
The Linux path depends on ffmpeg and MoviePy. ffmpeg is not installed in this environment (verified previously in shell), so Linux export would fail at runtime with `MovieEngineUnavailableError`.

Operational impact:
- Feature can appear “broken” even though code path is present.
- This is an environment/package issue, not strictly a routing/logic defect.

## Risk/consistency assessment

1. **API inconsistency risk:**
   - `/generate` (legacy) blocks Linux video.
   - `/runs/*` (new) allows Linux video.
   This can produce contradictory UX depending on which frontend flow is used.

2. **Operational readiness risk:**
   - Linux deploys missing ffmpeg will fail exports late unless preflight checks are surfaced in UI.

3. **Documentation drift risk:**
   - High-level docs still emphasize Windows-only PowerPoint export; this may obscure the newer Linux-capable MoviePy path.

## Recommended actions

### High priority
1. **Unify behavior across endpoints:**
   - Either migrate all video workflows to `/runs/*` exclusively, or remove/update the non-Windows block in `/generate` so it delegates to `VideoStudio` like run routes.

2. **Add explicit backend preflight endpoint/flag:**
   - Return capability matrix (e.g., `can_export_video`, `missing_dependencies: [ffmpeg, moviepy]`) so frontend can disable/guide before launch.

3. **Install ffmpeg in Linux runtime images:**
   - Ensure container/VM provisioning includes ffmpeg package.

### Medium priority
4. **Route deprecation plan:**
   - Mark `/generate` as legacy and direct UI to run-based routes to avoid split behavior.

5. **Docs refresh:**
   - Update README/backend docs to clarify:
     - PPTX generation remains Windows+PowerPoint.
     - MP4 export is cross-platform via MoviePy+ffmpeg (where available).

## Validation checklist for Linux
- Confirm `ffmpeg` is installed and executable.
- Confirm `moviepy>=2.0` is installed.
- Run one export through `/runs/text-to-video` with `output_format=video`.
- Verify final `video_file` exists and is non-zero in output metadata.
- Confirm frontend uses run-based endpoints for video export paths.
