"""Shared helpers for routes — DRY screenshot logic (#12), history log (#8)."""
import os
import re
import glob
import json
import time

from screenshot_engines.playwright_engine import take_screenshot_playwright

# Output folders (shared config)
OUTPUT_FOLDER = "output/screenshots"
HTML_FOLDER = "output/html"
HISTORY_FILE = "output/history.json"

# Ensure output folders exist at import time
for _folder in [OUTPUT_FOLDER, HTML_FOLDER]:
    os.makedirs(_folder, exist_ok=True)


# ─── Batch ID ─────────────────────────────────────────────────────────────

def get_next_batch_id():
    """Scan OUTPUT_FOLDER to find the highest batch N and return N+1 as string."""
    try:
        if not os.path.exists(OUTPUT_FOLDER):
            return "1"
        max_id = 0
        for item in os.listdir(OUTPUT_FOLDER):
            if item.startswith("batch ") and os.path.isdir(os.path.join(OUTPUT_FOLDER, item)):
                try:
                    num = int(item.split(" ")[1])
                    max_id = max(max_id, num)
                except ValueError:
                    pass
            # Also check top-level files like 5(1).png
            match = re.match(r'^(\d+)\(\d+\)\.png$', item)
            if match:
                max_id = max(max_id, int(match.group(1)))
        return str(max_id + 1)
    except Exception as e:
        print(f"Error finding next batch ID: {e}")
        return str(int(time.time()))


# ─── Sanitization ─────────────────────────────────────────────────────────

def sanitize_folder_path(folder_path, default):
    """Validate folder path is safe (under output/) to prevent path traversal."""
    if not folder_path:
        return default
    normalized = os.path.normpath(folder_path)
    if os.path.isabs(normalized) or normalized.startswith('..') or not normalized.startswith('output'):
        print(f"⚠️ Blocked unsafe folder path: {folder_path}, using default: {default}")
        return default
    return normalized


def sanitize_filename(name, default):
    """Sanitize a filename — allow only alphanumeric, dash, underscore."""
    if not name:
        return default
    sanitized = re.sub(r'[^a-zA-Z0-9_\-]', '_', name)
    return sanitized if sanitized else default


# ─── Shared Screenshot Logic (#12) ────────────────────────────────────────

def take_screenshots(html_content, screenshot_name, screenshot_folder=None,
                     zoom=2.1, overlap=15, viewport_width=1920,
                     viewport_height=1080, max_screenshots=50,
                     progress_callback=None, cancel_event=None):
    """
    Shared screenshot helper that handles:
    1. Cleaning up old files with the same name
    2. Taking screenshots with Playwright
    3. Returning (file_paths, basenames)
    
    Returns:
        tuple: (screenshot_files, screenshot_names)
    """
    folder = screenshot_folder or OUTPUT_FOLDER
    os.makedirs(folder, exist_ok=True)

    screenshot_filename = f"{screenshot_name}(1).png"
    screenshot_path = os.path.join(folder, screenshot_filename)

    # Delete old screenshots to prevent leftovers
    old_pattern = os.path.join(folder, f"{screenshot_name}(*).png")
    for old_file in glob.glob(old_pattern):
        try:
            os.remove(old_file)
        except Exception:
            pass

    # Build kwargs
    kwargs = dict(
        zoom=zoom,
        overlap=overlap,
        viewport_width=viewport_width,
        viewport_height=viewport_height,
        max_screenshots=max_screenshots,
    )
    if progress_callback:
        kwargs['progress_callback'] = progress_callback
    if cancel_event:
        kwargs['cancel_event'] = cancel_event

    screenshot_files = take_screenshot_playwright(html_content, screenshot_path, **kwargs)
    screenshot_names = [os.path.basename(f) for f in screenshot_files]

    return screenshot_files, screenshot_names


# ─── Save HTML ─────────────────────────────────────────────────────────────

def save_html(html_content, prefix="html_notes", folder=None):
    """Save HTML content to disk and return (filename, full_path)."""
    folder = folder or HTML_FOLDER
    os.makedirs(folder, exist_ok=True)
    timestamp = int(time.time())
    filename = f"{prefix}_{timestamp}.html"
    path = os.path.join(folder, filename)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print(f"✔ HTML saved: {path}")
    return filename, path


# ─── History Log (#8) ─────────────────────────────────────────────────────

def log_generation(entry):
    """
    Append a generation entry to the history log.
    
    entry should be a dict with keys like:
      tool, input_preview, html_file, screenshot_folder, screenshot_count,
      settings, timestamp
    """
    try:
        history = []
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                history = json.load(f)

        entry.setdefault('timestamp', time.time())
        entry.setdefault('datetime', time.strftime('%Y-%m-%d %H:%M:%S'))
        history.append(entry)

        # Keep last 200 entries
        history = history[-200:]

        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: Failed to log generation history: {e}")


def get_history():
    """Read the generation history."""
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"Warning: Failed to read history: {e}")
    return []
