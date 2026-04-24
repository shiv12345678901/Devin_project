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
# React index.html so client-side routing (/text-to-video, /resources, etc.)
# works on a hard refresh.
_API_PREFIXES = (
    '/generate',
    '/generate-sse',
    '/generate-html',
    '/cancel',
    '/beautify',
    '/minify',
    '/extract-from-image',
    '/image-to-screenshots-sse',
    '/regenerate',
    '/screenshots',
    '/html',
    '/download',
    '/download-zip',
    '/list',
    '/delete',
    '/history',
    '/cache',
    '/metrics',
)


@app.errorhandler(404)
def spa_fallback(_err):
    path = request.path
    if path.startswith(_API_PREFIXES):
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
