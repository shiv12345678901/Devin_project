# Operations

## Linux VM profile

For a 4-vCPU, 8-GiB, 20-GB VM, run one backend worker and one video export at
a time. A second Gunicorn worker would create a second in-memory queue and can
oversubscribe CPU/RAM.

```bash
python -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
playwright install chromium
sudo apt-get install -y ffmpeg
cp backend/.env.example .env
gunicorn --workers 1 --timeout 900 --bind 127.0.0.1:5000 backend.wsgi:app
```

Set `API_KEY` in `.env`. For 4K exports, use the static/cut transition option
when animation is unnecessary: the VFR path encodes one sparse still per hold
instead of generating 14,400 repeated frames for an eight-minute 30-fps video.
Transitions still require real frame generation around every animated span.

## Persistence and retention

SQLite defaults to `output/textbro.sqlite3`, uses WAL mode, and imports legacy
run/cache/history, client-queue, and ETA JSON on first access. Source JSON is
retained for rollback but is no longer written.

On Linux, retention is enabled by default:

```dotenv
RETENTION_ENABLED=1
RETENTION_RUN_DAYS=30
RETENTION_MAX_RUNS=500
RETENTION_HISTORY_DAYS=30
RETENTION_CACHE_DAYS=7
RETENTION_MAX_CACHE_ENTRIES=100
RETENTION_OUTPUT_DAYS=30
RETENTION_MIN_FREE_DISK_GB=2
```

Expired output files are removed only from known generated-output directories.
Files attached to active runs are protected. If free space drops below the
configured floor, oldest unprotected artifacts are removed first.

## Diagnostics

- `GET /healthz`: process liveness and active operation.
- `GET /preflight`: AI, FFmpeg/ffprobe, PowerPoint, and writable-folder checks.
- `GET /openapi.json`: OpenAPI 3.1 contract.
- `GET /runs`: persisted run summaries.
- `GET /runs/<id>`: stages, metrics, outputs, and event history.

FFmpeg progress is based on encoded media timestamps. Events include engine,
encoded seconds, total seconds, speed, and ETA, so a 4K encode is not presented
as an arbitrary frame-count task.

