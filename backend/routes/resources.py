"""Resources Blueprint — file listing, serving, deletion, ZIP download (#7), history (#8), regeneration."""
import os
import io
import zipfile
import time

from flask import Blueprint, request, jsonify, send_file

from core.ai_client import cache
from utils.performance_metrics import metrics_tracker
from routes.helpers import (
    OUTPUT_FOLDER, HTML_FOLDER,
    get_next_batch_id, sanitize_folder_path,
    take_screenshots, get_history,
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


@resources_bp.route('/screenshots/<path:filename>')
def get_screenshot(filename):
    """Serve screenshot file."""
    safe = _safe_child(OUTPUT_FOLDER, filename)
    if safe is None:
        return jsonify({'error': 'Invalid file path'}), 403
    if os.path.exists(safe):
        return send_file(safe, mimetype='image/png')

    # Fall back to walking output/ for batch subfolders, still constrained.
    abs_output = os.path.abspath('output')
    basename = os.path.basename(filename)
    for root, _dirs, files in os.walk(abs_output):
        if basename in files:
            candidate = os.path.abspath(os.path.join(root, basename))
            if candidate.startswith(abs_output + os.sep):
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

    if safe_path.startswith('output') and os.path.exists(safe_path):
        return send_file(safe_path, as_attachment=True)

    return jsonify({'error': 'File not found'}), 404


# ─── File Listing ──────────────────────────────────────────────────────────

@resources_bp.route('/list')
def list_files():
    """List all generated screenshots and HTML files."""
    screenshots = []
    html_files = []

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

    return jsonify({'screenshots': screenshots, 'html_files': html_files})


# ─── Delete ────────────────────────────────────────────────────────────────

@resources_bp.route('/delete/<file_type>/<filename>', methods=['DELETE'])
def delete_file_route(file_type, filename):
    """Delete a screenshot or HTML file."""
    try:
        if file_type == 'screenshot':
            folder = OUTPUT_FOLDER
        elif file_type == 'html':
            folder = HTML_FOLDER
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

                # Also try direct path if under output/
                if not full_path and safe.startswith('output') and os.path.exists(safe):
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
