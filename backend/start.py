"""Startup script for Screenshot Studio with environment checks."""
import os
import sys
import io

if sys.version_info >= (3, 7):
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    if isinstance(sys.stderr, io.TextIOWrapper):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

def check_dependencies():
    """Check if all required dependencies are installed."""
    required = ['flask', 'playwright', 'PIL', 'requests']
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
    """Validate the typed environment settings without requiring config.py."""
    from .src.settings import settings
    if settings.api_key.strip() in {'', 'your-api-key-here', 'REPLACE_ME'}:
        print("❌ API_KEY is missing. Set it in the environment or repo .env file.")
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
    """Create necessary output folders (relative to this script)."""
    project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    folders = [
        'output/screenshots',
        'output/html',
        'output/presentations',
        'output/videos',
    ]

    for folder in folders:
        os.makedirs(os.path.join(project_dir, folder), exist_ok=True)

    print("✅ Output folders ready")

def main():
    """Run all checks and start the application."""
    print("=" * 60)
    print("🚀 Screenshot Studio - Starting...")
    print("=" * 60)
    print()
    
    # Run checks
    checks = [
        ("Dependencies", check_dependencies),
        ("Configuration", check_config),
        ("Playwright", check_playwright)
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
    
    # Start the application
    print("=" * 60)
    print("✅ All checks passed! Starting server...")
    print("=" * 60)
    print()
    
    # Import and run the app
    from .app import app, _env_bool
    host = os.environ.get('FLASK_HOST') or os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '5000'))
    debug = _env_bool('FLASK_DEBUG', False) or _env_bool('DEBUG', False)
    app.run(debug=debug, port=port, host=host, use_reloader=debug)

if __name__ == '__main__':
    main()
