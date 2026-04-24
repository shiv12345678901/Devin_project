"""Screenshot Studio — Flask Application Entry Point.

All route logic is organized into Blueprints under routes/:
  - generate.py    — Text-to-Image (generate, SSE, cancel, preview)
  - html_routes.py — HTML-to-Image (generate-html, beautify, minify)
  - image_routes.py — Image-to-Screenshots (extract, SSE workflow)
  - resources.py   — File management, ZIP download, history, cache, metrics

Security posture (B1–B4):
  - Debug mode is OFF unless FLASK_DEBUG=1 explicitly.
  - CORS is restricted to ALLOWED_ORIGINS (comma-separated env var). No wildcard.
  - flask-limiter applies a per-IP default limit + tighter limits on heavy endpoints.
  - When API_KEY is set, every non-health request must carry X-API-Key.
  - Default bind is 127.0.0.1; override with FLASK_HOST (and accept the risk).
"""
import sys
import os

# Force unbuffered output for Windows
if sys.version_info >= (3, 7):
    import io
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(line_buffering=True)

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Load .env if present (no-op if python-dotenv isn't installed)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
except Exception:
    pass

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)


# ─── Security: CORS allowlist (B2) ─────────────────────────────────────────

def _parse_origins(raw: str) -> list[str]:
    return [o.strip() for o in raw.split(',') if o.strip()]


_DEFAULT_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:5000,http://127.0.0.1:5000"
)
ALLOWED_ORIGINS = _parse_origins(os.environ.get('ALLOWED_ORIGINS', _DEFAULT_ORIGINS))

# Only allow the explicit list of origins. Never use "*". Credentials are
# disabled because the app authenticates via shared-secret header (X-API-Key),
# not cookies.
CORS(
    app,
    resources={r"/*": {"origins": ALLOWED_ORIGINS}},
    supports_credentials=False,
    allow_headers=["Content-Type", "X-API-Key"],
    expose_headers=["Content-Type"],
)


# ─── Security: Request size limit (B9) ─────────────────────────────────────

# 32 MiB cap for uploads (PDFs / images). Configurable.
app.config['MAX_CONTENT_LENGTH'] = int(
    os.environ.get('MAX_CONTENT_LENGTH_BYTES', 32 * 1024 * 1024)
)


# ─── Security: Rate limiting (B3) ──────────────────────────────────────────

# Heavy endpoints (AI calls, screenshot generation) get a tighter limit; the
# global default protects every other route from abuse.
DEFAULT_LIMITS = os.environ.get('RATE_LIMIT_DEFAULT', '200 per hour;30 per minute')
HEAVY_LIMIT = os.environ.get('RATE_LIMIT_HEAVY', '20 per hour;5 per minute')

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=[lim.strip() for lim in DEFAULT_LIMITS.split(';') if lim.strip()],
    storage_uri=os.environ.get('RATE_LIMIT_STORAGE_URI', 'memory://'),
    headers_enabled=True,
)

# Heavy routes — applied via decorators in the blueprints would scatter the
# config across files. Doing it here keeps the security policy centralized.
HEAVY_ROUTES = [
    '/generate',
    '/generate-sse',
    '/generate-html',
    '/generate-html-sse',
    '/extract-from-image',
    '/image-to-screenshots-sse',
    '/regenerate',
]


# ─── Security: Optional shared-secret auth (B4) ────────────────────────────

API_KEY = os.environ.get('API_KEY', '').strip()
PUBLIC_PATHS = {'/healthz', '/'}


@app.before_request
def _enforce_api_key():
    """If API_KEY is configured, require it on every non-public request.

    Static assets and the health probe are always reachable so reverse
    proxies can monitor liveness without leaking the key.
    """
    if not API_KEY:
        return None
    if request.method == 'OPTIONS':  # Let CORS preflights through
        return None
    if request.path in PUBLIC_PATHS or request.path.startswith('/static/'):
        return None
    provided = request.headers.get('X-API-Key', '')
    # Constant-time compare to avoid timing oracle.
    import hmac
    if not hmac.compare_digest(provided, API_KEY):
        return jsonify({'error': 'Unauthorized'}), 401
    return None


# Log every request to terminal (only in debug mode — B10)
if os.environ.get('FLASK_DEBUG') == '1':
    @app.before_request
    def log_request():
        print(f"📡 Request: {request.method} {request.path}", flush=True)


# ─── Register Blueprints ──────────────────────────────────────────────────

from routes.generate import generate_bp
from routes.html_routes import html_bp
from routes.image_routes import image_bp
from routes.resources import resources_bp

app.register_blueprint(generate_bp)
app.register_blueprint(html_bp)
app.register_blueprint(image_bp)
app.register_blueprint(resources_bp)

# Apply heavy-route rate limits after blueprints are registered.
for rule in app.url_map.iter_rules():
    if rule.rule in HEAVY_ROUTES:
        view = app.view_functions.get(rule.endpoint)
        if view is not None:
            app.view_functions[rule.endpoint] = limiter.limit(HEAVY_LIMIT)(view)


# ─── Health & Main Page ────────────────────────────────────────────────────

@app.route('/healthz')
@limiter.exempt
def healthz():
    """Lightweight liveness probe — always 200 if the process is up."""
    return jsonify({'status': 'ok'}), 200


@app.route('/')
def index():
    """Render the main page."""
    return render_template('index.html')


# ─── Entry Point ───────────────────────────────────────────────────────────

if __name__ == '__main__':
    debug_mode = os.environ.get('FLASK_DEBUG') == '1'
    host = os.environ.get('FLASK_HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5000))

    if debug_mode:
        print("=" * 60)
        print("⚠️  DEV MODE — debug=True, Werkzeug reloader enabled")
        print("⚠️  Do NOT expose this process to untrusted networks.")
        print("=" * 60)
    print(f"\n📱 Listening on http://{host}:{port}")
    print("💡 Press Ctrl+C to stop\n")
    app.run(debug=debug_mode, host=host, port=port)
