# TextBro — Flask Backend

The Python/Flask service that powers Text→Video, HTML→Video, and Image/PDF→Video
generation. Originally lived in
[`shiv12345678901/yt-project`](https://github.com/shiv12345678901/yt-project);
now colocated with the React frontend in this repo.

## Running locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

cp config/config.example.py config/config.py   # add your API_KEY/API_URL/MODEL
cp .env.example .env                           # tweak security knobs

python start.py
# → http://127.0.0.1:5000
```

By default the server binds to **127.0.0.1** only — there's no shared-secret
auth out of the box, so don't expose it on a LAN until you set `API_KEY`.

## Running in production

Use a real WSGI server. The repo ships `wsgi.py` and pins both `gunicorn`
(Linux/Mac) and `waitress` (Windows) in `requirements.txt`:

```bash
# Linux/Mac
gunicorn -w 4 -b 127.0.0.1:5000 wsgi:app

# Windows
waitress-serve --listen=127.0.0.1:5000 wsgi:app
```

`app.run(debug=True)` is **never** invoked unless `FLASK_DEBUG=1` is set, and
`start.py` will refuse to enable debug mode on a non-loopback host.

## Security configuration

All knobs live in `backend/.env` (see `.env.example`). Defaults are safe for
local dev:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLASK_DEBUG` | `0` | `1` enables Werkzeug debug + reloader. NEVER on in prod (PIN-protected RCE shell). |
| `FLASK_HOST` | `127.0.0.1` | Bind address. Override only behind an authenticating reverse proxy. |
| `PORT` | `5000` | Listen port. |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173,http://localhost:5000,http://127.0.0.1:5000` | CORS allowlist (comma-separated). Wildcard intentionally unsupported. |
| `API_KEY` | _(unset)_ | Shared secret. When set, every non-public request must carry `X-API-Key`. |
| `RATE_LIMIT_DEFAULT` | `200 per hour;30 per minute` | Per-IP global limit. |
| `RATE_LIMIT_HEAVY` | `20 per hour;5 per minute` | Tighter limit on `/generate*`, `/extract-from-image`, `/image-to-screenshots-sse`, `/regenerate`. |
| `RATE_LIMIT_STORAGE_URI` | `memory://` | Switch to e.g. `redis://localhost:6379` when running multiple workers. |
| `MAX_CONTENT_LENGTH_BYTES` | `33554432` | 32 MiB cap on uploaded files. |

### Public paths (always reachable)

- `GET /healthz` — liveness probe (200 if process is alive).
- `GET /` — index page.
- `GET /static/...` — static assets.

Every other route (including `/screenshots/*` and `/html/*`) requires the API
key when one is configured.

### Threat model

This is a single-tenant developer tool. The defaults assume:

- The process runs on a trusted machine on a trusted network.
- Only a small group of operators hits the AI / screenshot endpoints.
- Production deployment puts the app behind a reverse proxy that adds TLS
  and (optionally) further auth. `API_KEY` is a coarse-grained shared secret,
  not user-level auth.

If you need multi-tenant access, swap the `_enforce_api_key` `before_request`
hook for a real auth middleware (OIDC, JWT, etc.).

## Project layout

```
backend/
├── app.py            # Flask app factory + security middleware
├── start.py          # Dev launcher with preflight checks
├── wsgi.py           # Production WSGI entrypoint (gunicorn / waitress)
├── requirements.txt
├── .env.example
├── config/
│   └── config.example.py   # copy to config.py and fill in
├── routes/           # generate / html / image / resources blueprints
├── src/
│   ├── core/         # AI + vision clients
│   ├── screenshot_engines/   # Playwright wrapper
│   └── utils/        # cache, metrics, ETA, retry helpers
├── static/
└── templates/
```

## Backend endpoints used by the React frontend

| Path                          | Method | Purpose                          |
| ----------------------------- | ------ | -------------------------------- |
| `/healthz`                    | GET    | Liveness probe                   |
| `/generate-sse`               | POST   | Text → HTML → screenshots (SSE)  |
| `/generate-html`              | POST   | HTML → screenshots               |
| `/image-to-screenshots-sse`   | POST   | Image/PDF → screenshots (SSE)    |
| `/cancel/<operation_id>`      | POST   | Cancel an in-progress generation |
| `/beautify`, `/minify`        | POST   | HTML helpers                     |
| `/screenshots/<filename>`     | GET    | Serve screenshot PNG             |
| `/html/<filename>`            | GET    | Serve HTML                       |
| `/download-zip`               | POST   | Bundle files into a ZIP          |
| `/list`                       | GET    | List generated files             |
| `/delete/<type>/<filename>`   | DELETE | Delete a file                    |
| `/history`                    | GET    | Generation history               |
| `/cache/stats`, `/cache/clear` | GET/POST | AI response cache             |
