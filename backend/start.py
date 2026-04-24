"""Startup script for Screenshot Studio with environment checks.

Runs preflight checks for dependencies, config, and Playwright browsers,
then launches the Flask app. Honors the same security env vars as app.py:
  - FLASK_DEBUG=1   to enable Werkzeug debug mode (NEVER on in prod)
  - FLASK_HOST      to override the bind address (default 127.0.0.1)
  - PORT            port to listen on (default 5000)
  - API_KEY         shared-secret required on every non-public request
  - ALLOWED_ORIGINS comma-separated CORS allowlist

For production, run via ``gunicorn wsgi:app`` (Linux/Mac) or
``waitress-serve --listen=127.0.0.1:5000 wsgi:app`` (Windows) instead.
"""
import os
import sys


def check_dependencies():
    """Check if all required dependencies are installed."""
    required = ['flask', 'flask_cors', 'flask_limiter', 'playwright', 'PIL', 'requests']
    missing = []

    for package in required:
        try:
            if package == 'PIL':
                __import__('PIL')
            else:
                __import__(package)
        except ImportError:
            missing.append(package)

    if missing:
        print("❌ Missing dependencies:")
        for pkg in missing:
            print(f"   - {pkg}")
        print("\n💡 Install with: pip install -r requirements.txt")
        return False

    return True


def check_config():
    """Check if configuration file exists."""
    config_path = os.path.join('config', 'config.py')

    if not os.path.exists(config_path):
        print("❌ Configuration file not found!")
        print("\n💡 Steps to fix:")
        print("   1. Copy config/config.example.py to config/config.py")
        print("   2. Edit config/config.py and add your API credentials")
        return False

    return True


def check_playwright():
    """Check if Playwright browsers are installed."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
                browser.close()
                return True
            except Exception:
                print("❌ Playwright browsers not installed!")
                print("\n💡 Install with: playwright install chromium")
                return False
    except Exception as e:
        print(f"❌ Playwright check failed: {e}")
        return False


def create_folders():
    """Create necessary output folders."""
    folders = [
        'output/screenshots',
        'output/html',
        'static/css',
        'static/js',
        'templates',
    ]

    for folder in folders:
        os.makedirs(folder, exist_ok=True)

    print("✅ Output folders ready")


def main():
    """Run all checks and start the application."""
    print("=" * 60)
    print("🚀 Screenshot Studio - Starting...")
    print("=" * 60)
    print()

    checks = [
        ("Dependencies", check_dependencies),
        ("Configuration", check_config),
        ("Playwright", check_playwright),
    ]

    for name, check_func in checks:
        print(f"Checking {name}...", end=" ")
        if check_func():
            print("✅")
        else:
            print()
            sys.exit(1)

    print()
    create_folders()
    print()

    print("=" * 60)
    print("✅ All checks passed! Starting server...")
    print("=" * 60)
    print()

    # Resolve runtime config from env vars (B1 + B4).
    debug_mode = os.environ.get('FLASK_DEBUG') == '1'
    host = os.environ.get('FLASK_HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5000))

    if debug_mode and host not in ('127.0.0.1', 'localhost'):
        print("⚠️  Refusing to run debug mode on a non-loopback host.")
        print("⚠️  Set FLASK_HOST=127.0.0.1 or unset FLASK_DEBUG.")
        sys.exit(2)

    from app import app
    app.run(debug=debug_mode, host=host, port=port)


if __name__ == '__main__':
    main()
