"""TextBro (Screenshot Studio) — Flask Application Entry Point.

All route logic is organized into Blueprints under routes/:
  - generate.py      — Text-to-Image (generate, SSE, cancel, preview)
  - html_routes.py   — HTML-to-Image (generate-html, beautify, minify)
  - image_routes.py  — Image-to-Screenshots (extract, SSE workflow)
  - resources.py     — File management, ZIP download, history, cache, metrics

When the React frontend has been built (`../frontend/dist/index.html` exists),
this app also serves that SPA at `/`. Otherwise `/` returns a short message
telling the user to run the dev server or build the frontend.
"""
import io
import logging
import os
import sys

# Force UTF-8-safe, unbuffered output for Windows terminals/services.
if sys.version_info >= (3, 7):
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    if isinstance(sys.stderr, io.TextIOWrapper):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

# Add src to path so blueprints can import `core.*`, `utils.*` unprefixed.
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(BACKEND_DIR, 'src'))

# Optional .env loader. We only fail soft — having python-dotenv missing
# means the user has to set env vars another way (export, systemd unit, etc.).
try:
    from dotenv import load_dotenv  # type: ignore

    # Project root .env takes precedence over backend-local .env so a single
    # repo-level file can drive both frontend (Vite) and backend.
    for _candidate in (
        os.path.join(BACKEND_DIR, '..', '.env'),
        os.path.join(BACKEND_DIR, '.env'),
    ):
        if os.path.isfile(_candidate):
            load_dotenv(_candidate, override=False)
except ImportError:  # pragma: no cover
    pass


def _env_bool(name: str, default: bool = False) -> bool:
    """Parse a truthy env var (1/true/yes/on are truthy; anything else falsy)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}


from flask import Flask, jsonify, request, send_from_directory  # noqa: E402

# Locate the built React frontend, if any.
FRONTEND_DIST = os.path.abspath(os.path.join(BACKEND_DIR, '..', 'frontend', 'dist'))


def has_frontend_build() -> bool:
    """Check on every request — cheap stat call, avoids stale state when the
    user builds / rebuilds / removes ``frontend/dist`` while the backend is
    running (Flask's reloader only watches .py files)."""
    return os.path.isfile(os.path.join(FRONTEND_DIST, 'index.html'))

app = Flask(__name__)

# Cap incoming request bodies to a reasonable size so a malicious or buggy
# client can't OOM the process by streaming a multi-GB upload. 64 MB is
# generous for thumbnails (max 4096×4096 PNG ~ a few MB) but tight enough
# to bounce abuse. Override via env var for unusual workloads.
app.config['MAX_CONTENT_LENGTH'] = int(
    os.environ.get('MAX_CONTENT_LENGTH_BYTES', 64 * 1024 * 1024)
)

# CORS — pinned by default to local dev origins. To allow access from a
# remote machine, set ``CORS_ORIGINS`` to a comma-separated allowlist (or
# the literal string ``*`` to disable the allowlist for prototyping).
# Wide-open ``*`` is also allowed but logged as a warning.
_DEFAULT_CORS = ','.join(
    [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174',
        'http://localhost:5175',
        'http://127.0.0.1:5175',
        'http://localhost:5000',
        'http://127.0.0.1:5000',
    ]
)
_cors_raw = os.environ.get('CORS_ORIGINS') or os.environ.get('ALLOWED_ORIGINS', _DEFAULT_CORS)
_cors_raw = _cors_raw.strip()
if _cors_raw == '*':
    CORS_ORIGINS: list = ['*']
else:
    CORS_ORIGINS = [o.strip() for o in _cors_raw.split(',') if o.strip()]
try:
    from flask_cors import CORS  # type: ignore

    CORS(
        app,
        resources={r"/*": {"origins": CORS_ORIGINS}},
        supports_credentials=False,
    )
    if CORS_ORIGINS == ['*']:
        print(
            "⚠️  CORS_ORIGINS=* — wide open, suitable for prototyping only.",
            flush=True,
        )
    else:
        print(f"🛡️  CORS enabled for: {', '.join(CORS_ORIGINS)}", flush=True)
except ImportError:
    print(
        "ℹ️  flask-cors not installed — install it if you run the React dev "
        "server on a different origin (pip install flask-cors).",
        flush=True,
    )

# Optional rate-limiting. Off by default (this is a single-user local app)
# but available for anyone who exposes the backend further. Enable with
# RATE_LIMIT=on or by setting RATE_LIMIT_DEFAULT.
_rate_default = os.environ.get('RATE_LIMIT_DEFAULT', '60/minute;10/second')
if _env_bool('RATE_LIMIT', False):
    try:
        from flask_limiter import Limiter  # type: ignore
        from flask_limiter.util import get_remote_address  # type: ignore

        Limiter(
            get_remote_address,
            app=app,
            default_limits=[lim.strip() for lim in _rate_default.split(';') if lim.strip()],
            storage_uri=os.environ.get('RATE_LIMIT_STORAGE', 'memory://'),
        )
        print(f"🚦 Rate limiting enabled: {_rate_default}", flush=True)
    except ImportError:
        print(
            "⚠️  RATE_LIMIT=on but flask-limiter not installed. "
            "`pip install flask-limiter` to enable.",
            flush=True,
        )


# Log every request to terminal
@app.before_request
def log_request():
    print(f"📡 Request: {request.method} {request.path}", flush=True)


# ─── Register Blueprints ──────────────────────────────────────────────────

from routes.generate import generate_bp  # noqa: E402
from routes.html_routes import html_bp  # noqa: E402
from routes.image_routes import image_bp  # noqa: E402
from routes.resources import resources_bp  # noqa: E402

app.register_blueprint(generate_bp)
app.register_blueprint(html_bp)
app.register_blueprint(image_bp)
app.register_blueprint(resources_bp)


# ─── Health & Preflight ───────────────────────────────────────────────────

@app.route('/healthz')
def healthz():
    """Liveness probe — cheap, always 200 if Flask can route a request."""
    return jsonify({'ok': True, 'service': 'textbro-backend'})


# Memoize the (relatively expensive) preflight result for a short window so a
# wizard-initiated triple-call (component mount + retry + parent re-render)
# doesn't spawn three POWERPNT.EXE processes on Windows.
import threading as _preflight_threading
_PREFLIGHT_TTL = float(os.environ.get('PREFLIGHT_CACHE_SECS', '30'))
_preflight_cache: dict = {'value': None, 'fetched_at': 0.0}
_preflight_lock = _preflight_threading.Lock()


@app.route('/preflight')
def preflight():
    """Report what the runtime can do so the wizard can gate outputs.

    Response shape (each check: {ok: bool, detail: str}):
      - platform:    always ok; reports OS / python version.
      - backend:     always ok when this handler responds.
      - ai_config:   ok when config/config.py exists and defines a non-empty API_KEY.
      - powerpoint:  ok only on Windows with pywin32 and PowerPoint.Application COM.

    Bypass the cache with ``?fresh=1``.
    """
    import time as _time
    import platform as _platform

    if request.args.get('fresh') != '1':
        with _preflight_lock:
            cached = _preflight_cache['value']
            age = _time.time() - _preflight_cache['fetched_at']
        if cached is not None and age < _PREFLIGHT_TTL:
            return jsonify(cached)

    checks: dict = {
        'platform': {
            'ok': True,
            'detail': f"{_platform.system()} {_platform.release()} · Python {_platform.python_version()}",
        },
        'backend': {'ok': True, 'detail': 'Flask responded to /preflight'},
        'ai_config': {'ok': False, 'detail': ''},
        'powerpoint': {'ok': False, 'detail': ''},
    }

    # AI config: does config/config.py have a non-placeholder API_KEY and at
    # least one real api_key in MODELS_CONFIG?
    try:
        config_dir = os.path.join(BACKEND_DIR, 'config')
        if config_dir not in sys.path:
            sys.path.insert(0, config_dir)
        from config import API_KEY, MODELS_CONFIG  # type: ignore
        placeholder = {'', 'your-api-key-here', 'REPLACE_ME'}
        top_ok = isinstance(API_KEY, str) and API_KEY.strip() not in placeholder
        model_ok = any(
            isinstance(m.get('api_key'), str) and m['api_key'].strip() not in placeholder
            for m in MODELS_CONFIG.values()
        )
        if top_ok or model_ok:
            checks['ai_config']['ok'] = True
            checks['ai_config']['detail'] = f"{sum(1 for m in MODELS_CONFIG.values() if m.get('api_key'))} model(s) configured"
        else:
            checks['ai_config']['detail'] = 'API_KEY is empty or placeholder — edit backend/config/config.py'
    except Exception as e:  # pragma: no cover — surfaces in UI
        checks['ai_config']['detail'] = f'Failed to load config: {e}'

    # PowerPoint: only succeeds on Windows with pywin32 + PowerPoint. We MUST
    # call Quit() afterwards, otherwise every /preflight hit spawns a new
    # POWERPNT.EXE process that never exits (the wizard triggers preflight
    # before every run, so this leak accumulates fast).
    if _platform.system() == 'Windows':
        app_obj = None
        com_initialized = False
        try:
            import pythoncom  # type: ignore
            import win32com.client  # type: ignore

            pythoncom.CoInitialize()
            com_initialized = True
            app_obj = win32com.client.DispatchEx('PowerPoint.Application')
            version = getattr(app_obj, 'Version', 'unknown')
            checks['powerpoint']['ok'] = True
            checks['powerpoint']['detail'] = f'PowerPoint {version} detected'
        except Exception as e:
            checks['powerpoint']['detail'] = (
                f'Optional for screenshots; PowerPoint not available: {e}'
            )
        finally:
            if app_obj is not None:
                try:
                    app_obj.Quit()
                except Exception:
                    pass
            if com_initialized:
                try:
                    pythoncom.CoUninitialize()  # type: ignore[name-defined]
                except Exception:
                    pass
    else:
        checks['powerpoint']['detail'] = (
            f'PowerPoint COM is Windows-only; this host is {_platform.system()}'
        )

    payload = {
        'ok': all(c['ok'] for k, c in checks.items() if k != 'powerpoint'),
        'checks': checks,
    }
    with _preflight_lock:
        _preflight_cache['value'] = payload
        _preflight_cache['fetched_at'] = _time.time()
    return jsonify(payload)


# ─── Error handlers ──────────────────────────────────────────────────────

@app.errorhandler(413)
def _too_large(_err):
    """Return JSON when a request exceeds MAX_CONTENT_LENGTH (defaults to 64 MB)."""
    limit = app.config.get('MAX_CONTENT_LENGTH', 0)
    return (
        jsonify({
            'success': False,
            'error': 'Request body too large',
            'limit_bytes': limit,
            'limit_mb': round(limit / (1024 * 1024), 1) if limit else None,
        }),
        413,
    )


@app.errorhandler(500)
def _internal(err):
    """Generic JSON 500 handler so frontend never has to parse stack-trace HTML."""
    logging.exception('Unhandled 500 in Flask handler: %s', err)
    return jsonify({
        'success': False,
        'error': 'Internal server error',
        'detail': str(err),
    }), 500


# ─── Frontend (React SPA) ─────────────────────────────────────────────────

INDEX_FALLBACK_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>TextBro backend</title>
<style>body{font-family:system-ui;max-width:640px;margin:4rem auto;padding:0 1rem;color:#1e293b}code{background:#f1f5f9;padding:.1rem .3rem;border-radius:.25rem}</style>
</head><body>
<h1>TextBro backend is running</h1>
<p>The Flask API is live on <code>http://localhost:5000</code>, but no built React
frontend was found at <code>frontend/dist</code>.</p>
<p>Either:</p>
<ul>
  <li>Run the React dev server: <code>cd frontend &amp;&amp; npm install &amp;&amp; npm run dev</code>
      and open <a href="http://localhost:5173">http://localhost:5173</a>.</li>
  <li>Or build the frontend once: <code>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</code>,
      then reload this page.</li>
</ul>
</body></html>
"""


@app.route('/')
def index():
    if has_frontend_build():
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return INDEX_FALLBACK_HTML


@app.route('/assets/<path:filename>')
def frontend_assets(filename: str):
    if not has_frontend_build():
        return jsonify({'error': 'Frontend not built'}), 404
    return send_from_directory(os.path.join(FRONTEND_DIST, 'assets'), filename)


@app.route('/favicon.svg')
def frontend_favicon():
    if has_frontend_build():
        fav = os.path.join(FRONTEND_DIST, 'favicon.svg')
        if os.path.isfile(fav):
            return send_from_directory(FRONTEND_DIST, 'favicon.svg')
    return ('', 204)


# SPA fallback: any unknown path that isn't an API route should return the
# React index.html so client-side routing (/workspace/html, /text-to-video, …)
# works on a hard refresh. Two cases:
#   * Exact endpoint names — routes without a trailing path component.
#   * Path-style prefixes — require a trailing slash so `/html-to-video`
#     does NOT match the `/html/<file>` asset endpoint.
_API_EXACT = {
    '/generate',
    '/generate-sse',
    '/generate-html',
    '/generate-html-sse',
    '/beautify',
    '/minify',
    '/extract-from-image',
    '/extract-from-image-sse',
    '/image-to-screenshots-sse',
    '/regenerate',
    '/download-zip',
    '/list',
    '/history',
    '/healthz',
    '/preflight',
    '/upload-thumbnail',
}
_API_PATH_PREFIXES = (
    '/cancel/',
    '/screenshots/',
    '/html/',
    '/thumbnails/',
    '/download/',
    '/delete/',
    '/cache/',
    '/metrics/',
)


def _is_api_path(path: str) -> bool:
    return path in _API_EXACT or path.startswith(_API_PATH_PREFIXES)


@app.errorhandler(404)
def spa_fallback(_err):
    path = request.path
    if _is_api_path(path):
        return jsonify({'error': 'Not found'}), 404
    if has_frontend_build():
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return INDEX_FALLBACK_HTML, 404


# ─── Entry Point ───────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 TextBro (Screenshot Studio) - Starting Server")
    print("=" * 60)
    if has_frontend_build():
        print(f"\n🎨 Serving React build from: {FRONTEND_DIST}")
    else:
        print("\n⚠️  No React build found. To use the UI:")
        print("     cd frontend && npm install && npm run dev")
        print("   or build it: npm run build  (then reload the backend URL)")

    # Single-tenant local app by default. Bind to loopback so it isn't
    # accidentally exposed on the LAN; override with HOST=0.0.0.0 only if
    # you've added auth / a reverse proxy in front. Same idea for DEBUG —
    # debug=True enables the Werkzeug debugger, which is RCE-as-a-feature.
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '5000'))
    debug = _env_bool('DEBUG', False)
    if host == '0.0.0.0' and not _env_bool('ALLOW_PUBLIC_BIND', False):
        print(
            "⚠️  HOST=0.0.0.0 binds the API on every interface. "
            "Set ALLOW_PUBLIC_BIND=1 to acknowledge this and re-launch, "
            "or run behind a reverse proxy (nginx, Caddy) with auth.",
            flush=True,
        )
        sys.exit(2)
    print(f"\n🌐 Listening on http://{host}:{port}  (debug={debug})")
    print("💡 Press Ctrl+C to stop\n")
    # use_reloader is forced off when debug=False to avoid double-launch
    # of Playwright in production-style runs.
    app.run(debug=debug, port=port, host=host, use_reloader=debug)
