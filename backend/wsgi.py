"""WSGI entry point for production servers.

Linux/Mac:
    gunicorn -w 4 -b 127.0.0.1:5000 wsgi:app

Windows:
    waitress-serve --listen=127.0.0.1:5000 wsgi:app

Bind to 127.0.0.1 unless you have an authenticating reverse proxy in front
(nginx with mTLS, Cloudflare Tunnel, etc.). Setting API_KEY on top of an
exposed port is acceptable for trusted users but not a substitute for TLS.
"""
import os
import sys

# Match app.py's path setup so blueprints can resolve `core.*` and `utils.*`
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from app import app  # noqa: E402  re-export Flask app as WSGI callable

# Some WSGI servers look for `application` rather than `app`.
application = app

if __name__ == '__main__':  # pragma: no cover
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 5000)))
