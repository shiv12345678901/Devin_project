---
title: YT AI Automation
emoji: 🎥
colorFrom: blue
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# TextBro — Text → Video Studio

Turn text, raw HTML, images, or PDFs into video-ready screenshots using AI.

- **Backend**: Flask + Playwright (Python) — originally
  [Screenshot Studio](https://github.com/shiv12345678901/yt-project).
- **Frontend**: React + Vite + TypeScript + Tailwind CSS.
- **Features**: live SSE progress, cancel, screenshot gallery, ZIP download,
  history, cache inspection. On Windows, the backend can also stitch
  screenshots into a PowerPoint-driven video.

```
Devin_project/
├── backend/          # Flask app, routes, Playwright screenshot engine
│   ├── app.py
│   ├── start.py
│   ├── requirements.txt
│   ├── config/
│   ├── routes/
│   └── src/
└── frontend/         # React SPA
    ├── src/
    ├── package.json
    └── vite.config.ts
```

## Requirements

- **Python** 3.10+ (3.11 recommended)
- **Node.js** 20.19+ or 22.13+
- **Playwright's Chromium** (installed via `playwright install chromium`)
- **FFmpeg + ffprobe** for MP4 export on Linux/macOS
- An API key for an OpenAI-compatible LLM endpoint (Groq, Together, OpenAI,
  a local `llama.cpp` server, etc.) — the backend uses chat completions.
- **Optional (Windows only)** Microsoft PowerPoint, for PowerPoint-driven
  PPTX/MP4 export. Linux/macOS use the FFmpeg engine instead.

## First-time setup

```bash
# 1) Clone
git clone https://github.com/shiv12345678901/Devin_project.git
cd Devin_project
```

### Backend

```bash
# (Optional but recommended) create a virtualenv
python -m venv backend/.venv
# Windows:     backend\.venv\Scripts\activate
# macOS/Linux: source backend/.venv/bin/activate

pip install -r backend/requirements.txt
playwright install chromium

# Debian/Ubuntu only — required for Linux MP4 export
sudo apt-get update && sudo apt-get install -y ffmpeg

# Fill in your API credentials (repo .env or service environment)
API_KEY="sk-..."
API_URL="https://api.groq.com/openai/v1"
```

### Frontend

```bash
cd frontend
npm install
```

## Running it

You have two options.

### Option A — dev mode (two terminals, hot reload everywhere)

```bash
# Terminal 1
python -m backend.start               # http://localhost:5000

# Terminal 2
cd frontend && npm run dev            # http://localhost:5173
```

Open http://localhost:5173 — the Vite dev server proxies every API path to
the Flask backend so CORS isn't an issue. Changes to React are hot-reloaded.

### Option B — single server (Flask serves the built React app)

```bash
cd frontend && npm run build          # produces frontend/dist/
cd .. && python -m backend.start      # http://localhost:5000
```

Now Flask serves the UI and the API from one port, so this is also the
setup you'd use when pointing a tunnel (ngrok, Cloudflare Tunnel) at it.

## What's wired to what

| Frontend page     | Backend endpoint                    | Notes                               |
| ----------------- | ----------------------------------- | ----------------------------------- |
| Text → Video      | `POST /runs/text-to-video`          | Persisted run + `/runs/<id>/events` SSE |
| HTML → Video      | `POST /generate-html`, `/beautify`, `/minify` | Synchronous                 |
| Image/PDF → Video | `POST /image-to-screenshots-sse`    | SSE progress, OCR + AI + screenshots |
| Resources         | `GET /list`, `/history`, `/cache/stats`, `DELETE /delete/<type>/<name>`, `POST /cache/clear` | — |
| Gallery           | `GET /screenshots/<path>`           | Served by Flask                     |
| ZIP download      | `POST /download-zip`                | Streams a ZIP of selected files     |

The full API client is in
[`frontend/src/api/client.ts`](frontend/src/api/client.ts) and the SSE
state machine in
[`frontend/src/hooks/useGenerate.ts`](frontend/src/hooks/useGenerate.ts).

## Configuration reference

Settings are typed and immutable at runtime. Configure them with environment
variables or a repo-level `.env`.

| Setting                        | What it controls                             |
| ------------------------------ | -------------------------------------------- |
| `API_KEY`, `API_URL`, `MODEL`  | Which LLM the backend talks to (chat completions) |
| `PORT`, `HOST`                 | Flask listen address                         |
| `DEFAULT_VIEWPORT_WIDTH/HEIGHT`| Screenshot viewport                          |
| `DEFAULT_ZOOM`, `DEFAULT_OVERLAP` | Capture scaling and slide overlap         |
| `MAX_SCREENSHOTS_LIMIT`        | Hard cap on screenshots per run              |
| `POWERPOINT_*`                 | Windows-only PowerPoint/video export         |
| `VIDEO_*`                      | Resolution / FPS / quality for PPT → video   |

## Scripts

**Frontend** (inside `frontend/`)

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start Vite dev server with API proxy     |
| `npm run build`   | TypeScript + production build to `dist/` |
| `npm run preview` | Preview the production build locally     |
| `npm run lint`    | Run ESLint                               |

**Backend** (inside `backend/`)

| Command               | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `python -m backend.start` | Launch with dependency and environment checks    |
| `python -m backend`       | Launch the packaged Flask app directly            |

## Troubleshooting

- **`API_KEY is missing`** when starting the backend — set it in `.env` or
  the service environment.
- **Generation returns 500 / `Failed to get AI response`** — the API key or
  base URL in `.env` is wrong, or the model isn't available from that
  endpoint.
- **Screenshots are blank** — run `playwright install chromium` again.
- **`/assets/...` 404 on Option B** — rebuild the frontend after code
  changes (`cd frontend && npm run build`).
- **Video export fails on macOS/Linux** — verify both `ffmpeg -version` and
  `ffprobe -version`. Static slides use sparse VFR encoding; transitions,
  voiceovers, intro/outro clips, music, and watermarks are composed directly
  by FFmpeg. For 4K on a 4-vCPU/8-GiB VM, run one export at a time and keep
  several GiB of disk space free for temporary segments.

## Credits

Based on [Screenshot Studio](https://github.com/shiv12345678901/yt-project)
by Educated Nepal. Original stack: Flask + Playwright + Llama 3.1 70B.
