"""Resources Blueprint — file listing, serving, deletion, ZIP download (#7), history (#8), regeneration."""
import os
import io
import re
import uuid
import zipfile
import time
import json

from flask import Blueprint, request, jsonify, send_file, Response
from core.thumbnail_builder import ThumbnailParams, render_thumbnail_png

THUMBNAILS_FOLDER = 'output/thumbnails'
THUMBNAIL_TEMPLATES_FILE = 'output/thumbnail_templates.json'
PRESENTATIONS_FOLDER = 'output/presentations'
VIDEOS_FOLDER = 'output/videos'
os.makedirs(THUMBNAILS_FOLDER, exist_ok=True)
os.makedirs(PRESENTATIONS_FOLDER, exist_ok=True)
os.makedirs(VIDEOS_FOLDER, exist_ok=True)
os.makedirs(os.path.dirname(THUMBNAIL_TEMPLATES_FILE), exist_ok=True)

from core.ai_client import cache
from utils.performance_metrics import metrics_tracker
from routes.helpers import (
    OUTPUT_FOLDER, HTML_FOLDER,
    get_next_batch_id, sanitize_folder_path,
    take_screenshots, get_history, clear_history,
    log_generation,
)

resources_bp = Blueprint('resources', __name__)


# ─── File Serving ──────────────────────────────────────────────────────────

def _safe_child(base_folder, user_path):
    """Resolve user_path relative to base_folder, rejecting traversal.

    Returns the absolute path inside base_folder, or None if the request
    would escape the folder.
    """
    abs_base = os.path.abspath(base_folder)
    candidate = os.path.abspath(os.path.join(base_folder, user_path))
    if candidate == abs_base or candidate.startswith(abs_base + os.sep):
        return candidate
    return None


def _read_thumbnail_templates():
    try:
        with open(THUMBNAIL_TEMPLATES_FILE, 'r', encoding='utf-8') as fp:
            data = json.load(fp)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []


def _write_thumbnail_templates(templates):
    tmp_path = f'{THUMBNAIL_TEMPLATES_FILE}.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as fp:
        json.dump(templates, fp, ensure_ascii=False, indent=2)
    os.replace(tmp_path, THUMBNAIL_TEMPLATES_FILE)


@resources_bp.route('/screenshots/<path:filename>')
def get_screenshot(filename):
    """Serve screenshot file."""
    safe = _safe_child(OUTPUT_FOLDER, filename)
    if safe is None:
        return jsonify({'error': 'Invalid file path'}), 403
    if os.path.exists(safe):
        return send_file(safe, mimetype='image/png')

    # Fall back to walking output/screenshots/ for batch subfolders — must
    # stay rooted at OUTPUT_FOLDER, not `output/`, otherwise a basename match
    # would serve internal files like `output/cache/ai_responses.json` or
    # `output/history.json` under the screenshots endpoint.
    abs_screens = os.path.abspath(OUTPUT_FOLDER)
    basename = os.path.basename(filename)
    for root, _dirs, files in os.walk(abs_screens):
        if basename in files:
            candidate = os.path.abspath(os.path.join(root, basename))
            if candidate.startswith(abs_screens + os.sep):
                return send_file(candidate, mimetype='image/png')
    return jsonify({'error': 'File not found'}), 404


@resources_bp.route('/html/<path:filename>')
def get_html(filename):
    """Serve HTML file."""
    safe = _safe_child(HTML_FOLDER, filename)
    if safe is None:
        return jsonify({'error': 'Invalid file path'}), 403
    if os.path.exists(safe):
        return send_file(safe, mimetype='text/html')
    return jsonify({'error': 'File not found'}), 404


@resources_bp.route('/thumbnails/<path:filename>')
def get_thumbnail(filename):
    """Serve a previously-uploaded thumbnail image."""
    safe = _safe_child(THUMBNAILS_FOLDER, filename)
    if safe is None:
        return jsonify({'error': 'Invalid file path'}), 403
    if os.path.exists(safe):
        return send_file(safe)
    return jsonify({'error': 'File not found'}), 404


@resources_bp.route('/upload-thumbnail', methods=['POST'])
def upload_thumbnail():
    """Accept a thumbnail image upload and return its stable path.

    Saves into THUMBNAILS_FOLDER with a sanitized `<uuid>_<original>` name
    so subsequent /generate-sse requests can reference it by filename.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file in request (expected form field "file")'}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({'error': 'Empty filename'}), 400

    # Limit to common image types
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg', '.webp', '.bmp'):
        return jsonify({'error': f'Unsupported image type: {ext}'}), 400

    safe_base = re.sub(r'[^A-Za-z0-9._-]+', '_', os.path.splitext(f.filename)[0])[:60]
    stored_name = f'{uuid.uuid4().hex[:8]}_{safe_base}{ext}'
    full_path = os.path.join(THUMBNAILS_FOLDER, stored_name)
    f.save(full_path)
    return jsonify({
        'success': True,
        'filename': stored_name,
        'url': f'/thumbnails/{stored_name}',
        'size_bytes': os.path.getsize(full_path),
    })


@resources_bp.route('/generate-thumbnail', methods=['GET'])
def generate_thumbnail():
    """Public PNG thumbnail endpoint for external websites.

    Example:
    /generate-thumbnail?class=10&chapterNum=12&chapterTitle=Title&imageUrl=https://...
    """
    params = ThumbnailParams(
        class_name=(request.args.get('class') or request.args.get('className') or '10').strip(),
        chapter_num=(request.args.get('chapterNum') or request.args.get('chapter') or '1').strip(),
        chapter_title=(request.args.get('chapterTitle') or request.args.get('title') or 'Chapter').strip(),
        chapter_title2=(request.args.get('chapterTitle2') or '').strip(),
        image_url=(request.args.get('imageUrl') or '').strip(),
        year=(request.args.get('year') or '2082').strip(),
        template=(request.args.get('template') or 'default').strip(),
    )
    try:
        png = render_thumbnail_png(params)
    except Exception as exc:
        return jsonify({'error': f'Could not generate thumbnail: {exc}'}), 500
    return Response(
        png,
        mimetype='image/png',
        headers={'Cache-Control': 'public, max-age=86400'},
    )


@resources_bp.route('/thumbnail-templates', methods=['GET'])
def list_thumbnail_templates():
    """Return saved editable thumbnail templates, optionally scoped by class/subject."""
    class_name = (request.args.get('className') or '').strip().lower()
    subject = (request.args.get('subject') or '').strip().lower()
    templates = _read_thumbnail_templates()
    if class_name:
        templates = [
            item for item in templates
            if str(item.get('className', '')).strip().lower() == class_name
        ]
    if subject:
        templates = [
            item for item in templates
            if str(item.get('subject', '')).strip().lower() == subject
        ]
    return jsonify({'success': True, 'templates': templates})


@resources_bp.route('/thumbnail-templates', methods=['POST'])
def save_thumbnail_template():
    """Create or update one saved editable thumbnail template."""
    data = request.get_json(silent=True) or {}
    name = str(data.get('name') or '').strip()
    class_name = str(data.get('className') or '').strip()
    subject = str(data.get('subject') or '').strip()
    settings = data.get('settings') if isinstance(data.get('settings'), dict) else {}
    if not name or not class_name or not subject:
        return jsonify({'error': 'name, className, and subject are required'}), 400

    now = time.time()
    templates = _read_thumbnail_templates()
    existing_index = next(
        (
            idx for idx, item in enumerate(templates)
            if str(item.get('className', '')).strip().lower() == class_name.lower()
            and str(item.get('subject', '')).strip().lower() == subject.lower()
            and str(item.get('name', '')).strip().lower() == name.lower()
        ),
        -1,
    )
    template = {
        'id': templates[existing_index].get('id') if existing_index >= 0 else f'tpl_{uuid.uuid4().hex[:12]}',
        'name': name,
        'className': class_name,
        'subject': subject,
        'createdAt': templates[existing_index].get('createdAt') if existing_index >= 0 else now,
        'updatedAt': now,
        'settings': settings,
    }
    if existing_index >= 0:
        templates[existing_index] = template
    else:
        templates.append(template)
    _write_thumbnail_templates(templates)
    return jsonify({'success': True, 'template': template})


@resources_bp.route('/thumbnail-templates/<template_id>', methods=['DELETE'])
def delete_thumbnail_template(template_id):
    templates = _read_thumbnail_templates()
    next_templates = [item for item in templates if str(item.get('id')) != template_id]
    if len(next_templates) == len(templates):
        return jsonify({'error': 'Template not found'}), 404
    _write_thumbnail_templates(next_templates)
    return jsonify({'success': True})


@resources_bp.route('/download/<path:filepath>')
def download_file(filepath):
    """Download any generated file."""
    safe_path = os.path.normpath(filepath)
    if '..' in safe_path or safe_path.startswith('/') or safe_path.startswith('\\'):
        return jsonify({'error': 'Invalid file path'}), 400

    for base_folder in ['output/presentations', 'output/videos', 'output/screenshots']:
        for check in [os.path.join(base_folder, os.path.basename(safe_path)),
                       os.path.join(base_folder, safe_path)]:
            if os.path.exists(check) and os.path.isfile(check):
                return send_file(check, as_attachment=True)

    # Strict-boundary check: only serve files that live directly under the
    # whitelisted output subfolders already tried above. The earlier fallback
    # `safe_path.startswith('output')` was too loose — matched `outputevil/…`
    # and also handed out internal files like `output/cache/ai_responses.json`.
    return jsonify({'error': 'File not found'}), 404


# ─── File Listing ──────────────────────────────────────────────────────────

@resources_bp.route('/list')
def list_files():
    """List all generated screenshots, HTML files, presentations, and videos."""
    screenshots = []
    html_files = []
    presentation_files = []
    video_files = []

    if os.path.exists(OUTPUT_FOLDER):
        for f in os.listdir(OUTPUT_FOLDER):
            if f.endswith('.png'):
                screenshots.append(f)
            elif f.startswith('batch ') and os.path.isdir(os.path.join(OUTPUT_FOLDER, f)):
                batch_folder = os.path.join(OUTPUT_FOLDER, f)
                for b_file in os.listdir(batch_folder):
                    if b_file.endswith('.png'):
                        screenshots.append(f"{f}/{b_file}")
        screenshots.sort(reverse=True)

    if os.path.exists(HTML_FOLDER):
        html_files = [f for f in os.listdir(HTML_FOLDER) if f.endswith('.html')]
        html_files.sort(reverse=True)

    if os.path.exists(PRESENTATIONS_FOLDER):
        presentation_files = [
            f for f in os.listdir(PRESENTATIONS_FOLDER)
            if f.lower().endswith(('.pptx', '.pptm'))
        ]
        presentation_files.sort(reverse=True)

    if os.path.exists(VIDEOS_FOLDER):
        video_files = [
            f for f in os.listdir(VIDEOS_FOLDER)
            if f.lower().endswith(('.mp4', '.mov', '.webm'))
        ]
        video_files.sort(reverse=True)

    return jsonify({
        'screenshots': screenshots,
        'html_files': html_files,
        'presentation_files': presentation_files,
        'video_files': video_files,
    })


# ─── Delete ────────────────────────────────────────────────────────────────

@resources_bp.route('/delete/<file_type>/<path:filename>', methods=['DELETE'])
def delete_file_route(file_type, filename):
    """Delete a generated screenshot, HTML, presentation, or video file."""
    try:
        if file_type == 'screenshot':
            folder = OUTPUT_FOLDER
        elif file_type == 'html':
            folder = HTML_FOLDER
        elif file_type == 'presentation':
            folder = PRESENTATIONS_FOLDER
        elif file_type == 'video':
            folder = VIDEOS_FOLDER
        else:
            return jsonify({'error': 'Invalid file type'}), 400

        file_path = os.path.join(folder, filename)
        abs_folder = os.path.abspath(folder)
        abs_file = os.path.abspath(file_path)

        if not abs_file.startswith(abs_folder + os.sep):
            return jsonify({'error': 'Invalid file path'}), 403

        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404

        os.remove(file_path)
        print(f"✔ Deleted: {file_path}")
        return jsonify({'success': True, 'message': f'Successfully deleted {filename}'})

    except Exception as e:
        import traceback
        print(f"Error deleting file: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Error: {str(e)}'}), 500


# ─── Regenerate ────────────────────────────────────────────────────────────

@resources_bp.route('/regenerate', methods=['POST'])
def regenerate():
    """Regenerate screenshots from existing HTML file with new settings."""
    try:
        data = request.get_json()
        html_filename = data.get('html_filename', '')

        if not html_filename:
            return jsonify({'error': 'No HTML filename provided'}), 400

        html_path = _safe_child(HTML_FOLDER, html_filename)
        if html_path is None:
            return jsonify({'error': 'Invalid file path'}), 403
        if not os.path.exists(html_path):
            return jsonify({'error': 'HTML file not found'}), 404

        with open(html_path, 'r', encoding='utf-8') as f:
            html_content = f.read()

        screenshot_folder = sanitize_folder_path(data.get('screenshot_folder', OUTPUT_FOLDER), OUTPUT_FOLDER)
        zoom = data.get('zoom', 2.1)
        overlap = data.get('overlap', 15)
        viewport_width = data.get('viewport_width', 1920)
        viewport_height = data.get('viewport_height', 1080)
        max_screenshots = data.get('max_screenshots', 50)

        screenshot_name = get_next_batch_id()
        screenshot_files, screenshot_names = take_screenshots(
            html_content, screenshot_name,
            screenshot_folder=screenshot_folder,
            zoom=zoom, overlap=overlap,
            viewport_width=viewport_width, viewport_height=viewport_height,
            max_screenshots=max_screenshots
        )

        log_generation({
            'tool': 'regenerate',
            'input_preview': f'Regenerated from {html_filename}',
            'html_file': html_filename,
            'screenshot_folder': screenshot_folder,
            'screenshot_count': len(screenshot_files),
            'settings': {'zoom': zoom, 'overlap': overlap, 'width': viewport_width, 'height': viewport_height},
        })

        return jsonify({
            'success': True,
            'message': f'Successfully regenerated {len(screenshot_files)} screenshot(s)',
            'screenshot_files': screenshot_names,
            'screenshot_count': len(screenshot_files),
            'screenshot_folder': screenshot_folder
        })

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Error: {str(e)}'}), 500


# ─── ZIP Download (#7) ────────────────────────────────────────────────────

@resources_bp.route('/download-zip', methods=['POST'])
def download_zip():
    """Download multiple files as a single ZIP archive."""
    try:
        data = request.get_json()
        files = data.get('files', [])
        zip_name = data.get('name', 'screenshots')

        if not files:
            return jsonify({'error': 'No files specified'}), 400

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for file_path in files:
                # Security: normalize and block traversal
                safe = os.path.normpath(file_path)
                if '..' in safe or safe.startswith('/') or safe.startswith('\\'):
                    continue

                # Try to find the file in output folders
                full_path = None
                for prefix in [OUTPUT_FOLDER, 'output']:
                    candidate = os.path.join(prefix, safe)
                    if os.path.exists(candidate) and os.path.isfile(candidate):
                        full_path = candidate
                        break

                # Also try direct path if strictly under `output/` (not
                # `outputevil/…` and not arbitrary other siblings).
                if not full_path and (
                    safe == 'output' or safe.startswith('output' + os.sep)
                ) and os.path.isfile(safe):
                    full_path = safe

                if full_path:
                    arcname = os.path.basename(full_path)
                    zf.write(full_path, arcname)

        buffer.seek(0)
        return send_file(
            buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'{zip_name}.zip'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── History (#8) ─────────────────────────────────────────────────────────

@resources_bp.route('/history')
def history():
    """Get generation history."""
    return jsonify(get_history())


@resources_bp.route('/history/clear', methods=['POST'])
def clear_history_route():
    """Clear saved backend generation history."""
    if clear_history():
        return jsonify({'success': True, 'message': 'History cleared successfully'})
    return jsonify({'success': False, 'error': 'Failed to clear history'}), 500


# ─── Cache ─────────────────────────────────────────────────────────────────

@resources_bp.route('/cache/stats', methods=['GET'])
def cache_stats():
    """Get cache statistics."""
    return jsonify(cache.get_stats())


@resources_bp.route('/cache/clear', methods=['POST'])
def clear_cache():
    """Clear the response cache."""
    cache.clear()
    return jsonify({'success': True, 'message': 'Cache cleared successfully'})


# ─── Metrics ───────────────────────────────────────────────────────────────

@resources_bp.route('/metrics/<operation_id>', methods=['GET'])
def get_metrics(operation_id):
    """Get performance metrics for an operation."""
    metrics = metrics_tracker.get_summary(operation_id)
    if metrics:
        return jsonify(metrics)
    return jsonify({'error': 'Metrics not found'}), 404


# ─── Per-run log tail ─────────────────────────────────────────────────────

@resources_bp.route('/logs/<operation_id>', methods=['GET'])
def get_run_log(operation_id):
    """Return the last N lines of the per-run log file.

    Designed for the frontend to drop into a "Backend log" panel so users
    can see what the server is doing without ssh-ing into the host. Use
    ``?tail=200`` to control how many lines are returned (default 200,
    max 2000). Returns 404 if no log file exists for the given id.
    """
    from utils.run_logger import run_log_path
    path = run_log_path(operation_id)
    if not os.path.isfile(path):
        return jsonify({'error': 'Log file not found', 'operation_id': operation_id}), 404
    try:
        tail = max(1, min(2000, int(request.args.get('tail', '200'))))
    except (TypeError, ValueError):
        tail = 200
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as fp:
            lines = fp.readlines()
    except OSError as e:
        return jsonify({'error': f'Could not read log: {e}'}), 500
    selected = lines[-tail:]
    return jsonify({
        'operation_id': operation_id,
        'path': path,
        'returned_lines': len(selected),
        'total_lines': len(lines),
        'truncated': len(lines) > tail,
        'lines': [ln.rstrip('\n') for ln in selected],
    })
