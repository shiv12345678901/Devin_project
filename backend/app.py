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
import os
import sys

# Force unbuffered output for Windows
if sys.version_info >= (3, 7):
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(line_buffering=True)

# Add src to path so blueprints can import `core.*`, `utils.*` unprefixed.
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(BACKEND_DIR, 'src'))

from flask import Flask, jsonify, request, send_from_directory  # noqa: E402

# Locate the built React frontend, if any.
FRONTEND_DIST = os.path.abspath(os.path.join(BACKEND_DIR, '..', 'frontend', 'dist'))
HAS_FRONTEND_BUILD = os.path.isfile(os.path.join(FRONTEND_DIST, 'index.html'))

# Optional: enable CORS so the React dev server on :5173 can call the API
# without relying on the Vite proxy. `flask-cors` is optional — if not
# installed, we just skip it.
app = Flask(__name__)
try:
    from flask_cors import CORS  # type: ignore

    CORS(
        app,
        resources={r"/*": {"origins": "*"}},
        supports_credentials=False,
    )
    print("🛡️  CORS enabled via flask-cors", flush=True)
except ImportError:
    print(
        "ℹ️  flask-cors not installed — install it if you run the React dev "
        "server on a different origin (pip install flask-cors).",
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


# ─── Preflight ────────────────────────────────────────────────────────────

@app.route('/preflight')
def preflight():
    """Report what the runtime can do so the wizard can gate outputs.

    Response shape (each check: {ok: bool, detail: str}):
      - platform:    always ok; reports OS / python version.
      - backend:     always ok when this handler responds.
      - ai_config:   ok when config/config.py exists and defines a non-empty API_KEY.
      - powerpoint:  ok only on Windows with pywin32 and PowerPoint.Application COM.
    """
    import platform as _platform

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
        sys.path.insert(0, os.path.join(BACKEND_DIR, 'config'))
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
        try:
            import win32com.client  # type: ignore
            app_obj = win32com.client.Dispatch('PowerPoint.Application')
            version = getattr(app_obj, 'Version', 'unknown')
            checks['powerpoint']['ok'] = True
            checks['powerpoint']['detail'] = f'PowerPoint {version} detected'
        except Exception as e:
            checks['powerpoint']['detail'] = f'PowerPoint not available: {e}'
        finally:
            if app_obj is not None:
                try:
                    app_obj.Quit()
                except Exception:
                    pass
    else:
        checks['powerpoint']['detail'] = (
            f'PowerPoint COM is Windows-only; this host is {_platform.system()}'
        )

    return jsonify({
        'ok': all(c['ok'] for k, c in checks.items() if k != 'powerpoint'),
        'checks': checks,
    })


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
    if HAS_FRONTEND_BUILD:
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return INDEX_FALLBACK_HTML


@app.route('/assets/<path:filename>')
def frontend_assets(filename: str):
    if not HAS_FRONTEND_BUILD:
        return jsonify({'error': 'Frontend not built'}), 404
    return send_from_directory(os.path.join(FRONTEND_DIST, 'assets'), filename)


@app.route('/favicon.svg')
def frontend_favicon():
    if HAS_FRONTEND_BUILD:
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
    '/beautify',
    '/minify',
    '/extract-from-image',
    '/image-to-screenshots-sse',
    '/regenerate',
    '/download-zip',
    '/list',
    '/history',
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
    if HAS_FRONTEND_BUILD:
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return INDEX_FALLBACK_HTML, 404


# ─── Entry Point ───────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 TextBro (Screenshot Studio) - Starting Server")
    print("=" * 60)
    if HAS_FRONTEND_BUILD:
        print(f"\n🎨 Serving React build from: {FRONTEND_DIST}")
        print("\n📱 Open your browser: http://localhost:5000")
    else:
        print("\n⚠️  No React build found. To use the UI:")
        print("     cd frontend && npm install && npm run dev")
        print("   or build it: npm run build  (then reload http://localhost:5000)")
    print("\n💡 Press Ctrl+C to stop\n")
    app.run(debug=True, port=5000, host='0.0.0.0')
