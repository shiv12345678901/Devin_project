# TextBro — Text to Video Studio

A React + Vite + TypeScript + Tailwind frontend, plus the Flask backend
(formerly [`shiv12345678901/yt-project`](https://github.com/shiv12345678901/yt-project))
that turns text, HTML, or images into screenshots and video presentations
using AI. The two services live side-by-side in this repo:

```
.
├── src/                  # React frontend (Vite)
├── backend/              # Flask backend (see backend/README.md)
└── ...
```

## Features

- **Text → Video** — paste text, AI generates HTML, renders to screenshots
  with live SSE progress and cancel support.
- **HTML → Video** — paste or upload raw HTML, render directly. Includes
  beautify / minify helpers.
- **Image / PDF → Video** — upload an image or PDF, vision AI extracts text,
  generates HTML, and captures screenshots.
- **Resources** — browse generated screenshots, HTML files, history, cache
  stats; delete files; clear cache; download all as ZIP.

## Requirements

- Node.js 20.19+ (or 22.13+)
- Python 3.10+ for the backend (see [backend/README.md](backend/README.md)
  for full instructions).

## Quick start

```bash
# 1. Install frontend dependencies
npm install

# 2. Start the Flask backend (in a separate terminal)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp config/config.example.py config/config.py   # add API_KEY/API_URL/MODEL
cp .env.example .env                           # security knobs (optional)
python start.py    # binds to 127.0.0.1:5000 by default

# 3. Start the React dev server (back at repo root)
npm run dev        # opens http://localhost:5173
```

The backend now binds to **127.0.0.1** by default and exposes a `/healthz`
liveness probe. See [`backend/README.md`](backend/README.md) for the full
security configuration (CORS allowlist, optional `X-API-Key` shared secret,
per-IP rate limits, debug-mode gating).

The Vite dev server proxies all Flask API paths (`/generate-sse`,
`/generate-html`, `/screenshots/*`, etc.) to `http://localhost:5000`, so
you can develop without touching CORS.

### Changing the backend URL

By default the dev proxy points to `http://localhost:5000`. Override with an
environment variable:

```bash
VITE_BACKEND_URL=http://192.168.1.10:5000 npm run dev
```

For production builds, set `VITE_BACKEND_URL` at build time — the API client
will call that URL directly instead of relying on the proxy.

## Production deployment

You have two options, depending on how you want to serve the app.

### Option A — Serve React from Flask (no CORS needed)

Build the React app, then point Flask's static/template folders at the
output directory:

```bash
npm run build
# dist/ contains index.html + assets. Copy into yt-project/static/app/
```

Then either replace `yt-project/templates/index.html` with the built file,
or add a new Flask route that serves `dist/index.html`.

### Option B — Separate deployment with CORS enabled

`flask-cors` is already wired in (`backend/app.py`) — set the allowlist via
the `ALLOWED_ORIGINS` env var instead of editing code:

```bash
# backend/.env
ALLOWED_ORIGINS=https://your-frontend-domain
API_KEY=<generate a long random string>
FLASK_HOST=127.0.0.1   # keep loopback; put nginx/caddy/cloudflared in front
```

Run with a real WSGI server:

```bash
gunicorn -w 4 -b 127.0.0.1:5000 wsgi:app   # Linux/Mac
waitress-serve --listen=127.0.0.1:5000 wsgi:app   # Windows
```

Then build the frontend with `VITE_BACKEND_URL=https://your-backend-domain
npm run build` and deploy `dist/` to any static host (Netlify, Vercel,
Cloudflare Pages, S3 + CloudFront, etc.). Make sure the frontend forwards
`X-API-Key` on every request — the API key is required on every non-public
route once it's set.

## Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start the Vite dev server with API proxy |
| `npm run build`   | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build locally     |
| `npm run lint`    | Run ESLint                               |

## Project structure

```
src/
├── api/
│   ├── client.ts       # fetch wrappers + POST SSE streaming
│   └── types.ts
├── components/
│   ├── Layout.tsx      # sidebar + responsive nav
│   ├── ProgressBar.tsx
│   ├── ScreenshotGallery.tsx
│   └── SettingsPanel.tsx
├── hooks/
│   └── useGenerate.ts  # SSE-driven generation state machine
├── pages/
│   ├── TextToVideo.tsx
│   ├── HtmlToVideo.tsx
│   ├── ImageToVideo.tsx
│   └── Resources.tsx
├── App.tsx             # routes
├── main.tsx
└── index.css           # Tailwind + component classes
```

## Backend endpoints used

| Path                         | Method | Purpose                          |
| ---------------------------- | ------ | -------------------------------- |
| `/generate-sse`              | POST   | Text → HTML → screenshots (SSE)  |
| `/generate-html`             | POST   | HTML → screenshots               |
| `/image-to-screenshots-sse`  | POST   | Image/PDF → screenshots (SSE)    |
| `/cancel/<operation_id>`     | POST   | Cancel an in-progress generation |
| `/beautify`, `/minify`       | POST   | HTML helpers                     |
| `/screenshots/<filename>`    | GET    | Serve screenshot PNG             |
| `/html/<filename>`           | GET    | Serve HTML                       |
| `/download-zip`              | POST   | Bundle files into a ZIP          |
| `/list`                      | GET    | List generated files             |
| `/delete/<type>/<filename>`  | DELETE | Delete a file                    |
| `/history`                   | GET    | Generation history               |
| `/cache/stats`, `/cache/clear` | GET/POST | AI response cache           |
