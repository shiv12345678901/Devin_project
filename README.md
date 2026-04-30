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
- An API key for an OpenAI-compatible LLM endpoint (Groq, Together, OpenAI,
  a local `llama.cpp` server, etc.) — the backend uses chat completions.
- **Optional (Windows only)** Microsoft PowerPoint, for the
  screenshot → video pipeline.

## First-time setup

```bash
# 1) Clone
git clone https://github.com/shiv12345678901/Devin_project.git
cd Devin_project
```

### Backend

```bash
cd backend

# (Optional but recommended) create a virtualenv
python -m venv .venv
# Windows:     .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

pip install -r requirements.txt
playwright install chromium

# Fill in your API credentials
cp config/config.example.py config/config.py
# Edit config/config.py:
#   API_KEY   = "sk-..."                 # your LLM API key
#   API_URL   = "https://api.groq.com/openai/v1"   # or wherever
#   MODEL     = "llama-3.1-70b-versatile"
```

### Frontend

```bash
cd ../frontend
npm install
```

## Running it

You have two options.

### Option A — dev mode (two terminals, hot reload everywhere)

```bash
# Terminal 1
cd backend && python start.py         # http://localhost:5000

# Terminal 2
cd frontend && npm run dev            # http://localhost:5173
```

Open http://localhost:5173 — the Vite dev server proxies every API path to
the Flask backend so CORS isn't an issue. Changes to React are hot-reloaded.

### Option B — single server (Flask serves the built React app)

```bash
cd frontend && npm run build          # produces frontend/dist/
cd ../backend && python start.py      # http://localhost:5000
```

Now Flask serves the UI and the API from one port, so this is also the
setup you'd use when pointing a tunnel (ngrok, Cloudflare Tunnel) at it.

## What's wired to what

| Frontend page     | Backend endpoint                    | Notes                               |
| ----------------- | ----------------------------------- | ----------------------------------- |
| Text → Video      | `POST /generate-sse`                | SSE progress, cancel via `/cancel/<op>` |
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

Key values in `backend/config/config.py` (see
`backend/config/config.example.py` for the full list):

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
| `python start.py`     | Launch the Flask app with env checks                 |
| `python app.py`       | Launch the Flask app directly (skip env checks)      |

## Troubleshooting

- **`Configuration file not found`** when starting the backend — you didn't
  copy `config/config.example.py` to `config/config.py`.
- **Generation returns 500 / `Failed to get AI response`** — the API key or
  base URL in `config.py` is wrong, or the model isn't available from that
  endpoint.
- **Screenshots are blank** — run `playwright install chromium` again.
- **`/assets/...` 404 on Option B** — rebuild the frontend after code
  changes (`cd frontend && npm run build`).
- **Video export fails on macOS/Linux** — the PowerPoint exporter is
  Windows-only. Screenshots still work on all platforms.

## Credits

Based on [Screenshot Studio](https://github.com/shiv12345678901/yt-project)
by Educated Nepal. Original stack: Flask + Playwright + Llama 3.1 70B.
