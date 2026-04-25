"""Shared helpers for routes — DRY screenshot logic (#12), history log (#8)."""
import os
import re
import glob
import json
import time
import threading

# Process-wide in-memory lock that serializes history read-modify-write.
# SSE runs execute on separate Flask worker threads and can finish at the same
# time; without serializing the JSON file RMW, concurrent writes would clobber
# each other and silently drop entries (classic TOCTOU).
_HISTORY_LOCK = threading.Lock()

# Cross-process advisory file lock. Only engaged on POSIX (fcntl). Windows
# uses msvcrt.locking — we detect at import time.
try:  # pragma: no cover — platform-dependent
    import fcntl  # type: ignore

    def _file_lock(fh):
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)

    def _file_unlock(fh):
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
except ImportError:  # Windows
    try:
        import msvcrt  # type: ignore

        def _file_lock(fh):
            msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)

        def _file_unlock(fh):
            try:
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
    except ImportError:  # neither available — degrade to thread-only lock
        def _file_lock(_fh):
            return None

        def _file_unlock(_fh):
            return None

from screenshot_engines.playwright_engine import take_screenshot_playwright

# Output folders (shared config)
OUTPUT_FOLDER = "output/screenshots"
HTML_FOLDER = "output/html"
HISTORY_FILE = "output/history.json"

# Ensure output folders exist at import time
for _folder in [OUTPUT_FOLDER, HTML_FOLDER]:
    os.makedirs(_folder, exist_ok=True)


# ─── Batch ID ─────────────────────────────────────────────────────────────

# Serializes both the disk scan AND the os.makedirs that reserves the next
# numeric folder. Without this, two concurrent runs would scan, both compute
# N+1, and both try to write to the same "batch N+1" directory.
_BATCH_ID_LOCK = threading.Lock()


def get_next_batch_id():
    """Pick the next free batch ID and atomically reserve its folder.

    Walks ``OUTPUT_FOLDER`` once for both ``batch N/`` directories and any
    top-level ``N(M).png`` files (so legacy non-batched runs still bump the
    counter), then ``mkdir`` s ``batch <N+1>/`` while the lock is held. The
    mkdir doubles as the reservation: if a second concurrent caller picks
    the same N (shouldn't happen under the lock, but belt-and-braces) it
    would race on ``EEXIST`` and we'd retry.
    """
    with _BATCH_ID_LOCK:
        try:
            if not os.path.exists(OUTPUT_FOLDER):
                os.makedirs(OUTPUT_FOLDER, exist_ok=True)
            for _attempt in range(10):
                max_id = 0
                for item in os.listdir(OUTPUT_FOLDER):
                    if item.startswith("batch ") and os.path.isdir(
                        os.path.join(OUTPUT_FOLDER, item)
                    ):
                        try:
                            num = int(item.split(" ")[1])
                            max_id = max(max_id, num)
                        except ValueError:
                            pass
                    # Also account for legacy top-level files like 5(1).png
                    match = re.match(r'^(\d+)\(\d+\)\.png$', item)
                    if match:
                        max_id = max(max_id, int(match.group(1)))
                next_id = max_id + 1
                target = os.path.join(OUTPUT_FOLDER, f"batch {next_id}")
                try:
                    os.makedirs(target, exist_ok=False)
                    return str(next_id)
                except FileExistsError:
                    # Lost a race (or stale dir from a previous run with no
                    # children). Try the next ID.
                    continue
            # Fall back to a timestamp if we somehow couldn't reserve a slot.
            return str(int(time.time()))
        except Exception as e:
            print(f"Error finding next batch ID: {e}")
            return str(int(time.time()))


# ─── Sanitization ─────────────────────────────────────────────────────────

def sanitize_folder_path(folder_path, default):
    """Validate folder path is safe (under output/) to prevent path traversal.

    The check must be strict-boundary: accept the literal "output" or anything
    under "output/…". Rejects "outputevil", "output_backup", etc. which would
    otherwise pass a naive `startswith('output')` check.
    """
    if not folder_path:
        return default
    normalized = os.path.normpath(folder_path)
    under_output = normalized == 'output' or normalized.startswith('output' + os.sep)
    if os.path.isabs(normalized) or normalized.startswith('..') or not under_output:
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
    3. Returning (file_paths, basenames-relative-to-screenshot_folder)

    Each run gets its own ``batch <screenshot_name>/`` subdirectory inside
    ``screenshot_folder``. Previously the engine wrote ``5(1).png``,
    ``5(2).png`` directly into the parent folder while ``get_next_batch_id``
    pre-created an *empty* ``batch 5/`` directory next to it — so output
    accumulated as a flat soup of ``N(M).png`` files plus a parallel set of
    empty ``batch N/`` folders. Writing into the batch folder keeps each
    run self-contained, makes ZIP downloads naturally scoped, and matches
    the ``batch 3/5(1).png`` paths the frontend already encodes.

    Returns:
        tuple: (screenshot_files, screenshot_names) where ``screenshot_names``
        are paths *relative to* ``screenshot_folder`` (e.g.
        ``"batch 5/5(1).png"``) so they round-trip cleanly through the
        ``/screenshots/<path:filename>`` endpoint.
    """
    folder = screenshot_folder or OUTPUT_FOLDER
    os.makedirs(folder, exist_ok=True)

    # Per-run subfolder. ``get_next_batch_id`` already created ``batch N/``
    # for us; we just have to write into it. Fall back to plain ``batch
    # <name>`` if a caller passed a name that wasn't reserved (defensive —
    # ``mkdir(exist_ok=True)`` is idempotent).
    batch_subdir = f"batch {screenshot_name}"
    batch_folder = os.path.join(folder, batch_subdir)
    os.makedirs(batch_folder, exist_ok=True)

    screenshot_filename = f"{screenshot_name}.png"
    screenshot_path = os.path.join(batch_folder, screenshot_filename)

    # Delete old screenshots to prevent leftovers (covers both the new
    # subfolder layout and the legacy flat layout for in-place upgrades).
    for old_pattern in (
        os.path.join(batch_folder, f"{screenshot_name}(*).png"),
        os.path.join(folder, f"{screenshot_name}(*).png"),
    ):
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
    # Return paths relative to ``folder`` so the frontend can request them
    # as ``/screenshots/batch 5/5(1).png`` (the existing encoded-path
    # support handles the slash correctly).
    screenshot_names = [
        os.path.relpath(f, folder).replace(os.sep, '/') for f in screenshot_files
    ]

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

    Uses a process-wide threading.Lock plus an advisory file lock so the
    read-modify-write cycle on HISTORY_FILE can't be raced by concurrent
    SSE workers (two runs completing at once would otherwise silently drop
    one entry).
    """
    entry.setdefault('timestamp', time.time())
    entry.setdefault('datetime', time.strftime('%Y-%m-%d %H:%M:%S'))

    with _HISTORY_LOCK:
        try:
            # Ensure file exists so we can grab an advisory lock on it.
            if not os.path.exists(HISTORY_FILE):
                os.makedirs(os.path.dirname(HISTORY_FILE) or '.', exist_ok=True)
                with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                    f.write('[]')

            with open(HISTORY_FILE, 'r+', encoding='utf-8') as f:
                _file_lock(f)
                try:
                    raw = f.read()
                    try:
                        history = json.loads(raw) if raw.strip() else []
                    except json.JSONDecodeError:
                        # Corrupted file — start fresh. Do NOT os.replace the
                        # file while we still hold `f` open: on POSIX that
                        # just renames the inode and leaves our write stream
                        # pointing at the .corrupt path, so the fresh entry
                        # would vanish with the renamed file. Instead save
                        # a forensic copy via read-and-write, then truncate
                        # the original in place below.
                        try:
                            with open(HISTORY_FILE + '.corrupt', 'w', encoding='utf-8') as forensic:
                                forensic.write(raw)
                        except OSError:
                            pass
                        history = []

                    history.append(entry)
                    history = history[-200:]

                    f.seek(0)
                    f.truncate()
                    json.dump(history, f, indent=2, ensure_ascii=False)
                finally:
                    _file_unlock(f)
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
