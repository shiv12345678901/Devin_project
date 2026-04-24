"""HTML-to-Image Blueprint — routes for converting HTML code to screenshots."""
import time

from flask import Blueprint, request, jsonify

from utils.html_beautifier import HTMLBeautifier
from routes.helpers import (
    OUTPUT_FOLDER, HTML_FOLDER,
    get_next_batch_id,
    take_screenshots, save_html, log_generation,
)

html_bp = Blueprint('html', __name__)
html_beautifier = HTMLBeautifier()


@html_bp.route('/generate-html', methods=['POST'])
def generate_html_direct():
    """Process HTML directly and generate screenshots."""
    try:
        data = request.get_json()
        html_content = data.get('html', '')

        if not html_content:
            return jsonify({'error': 'No HTML content provided'}), 400

        zoom = data.get('zoom', 2.1)
        overlap = data.get('overlap', 15)
        viewport_width = data.get('viewport_width', 1920)
        viewport_height = data.get('viewport_height', 1080)
        max_screenshots = data.get('max_screenshots', 50)

        print(f"\n{'='*60}")
        print(f"📥 Processing direct HTML input")
        print(f"⚙️  Settings: {viewport_width}x{viewport_height}, zoom={zoom}x, overlap={overlap}px")
        print(f"{'='*60}\n")

        # Save HTML
        html_filename, _ = save_html(html_content, prefix="html")

        # Take screenshots (DRY #12)
        screenshot_name = get_next_batch_id()
        screenshot_files, screenshot_names = take_screenshots(
            html_content, screenshot_name,
            screenshot_folder=OUTPUT_FOLDER,
            zoom=zoom, overlap=overlap,
            viewport_width=viewport_width, viewport_height=viewport_height,
            max_screenshots=max_screenshots
        )

        # Log to history (#8)
        log_generation({
            'tool': 'html-to-image',
            'input_preview': html_content[:200],
            'html_file': html_filename,
            'screenshot_folder': OUTPUT_FOLDER,
            'screenshot_count': len(screenshot_files),
            'settings': {'zoom': zoom, 'overlap': overlap, 'width': viewport_width, 'height': viewport_height},
        })

        return jsonify({
            'success': True,
            'message': f'Successfully generated {len(screenshot_files)} screenshot(s) from HTML',
            'html_filename': html_filename,
            'screenshot_files': screenshot_names,
            'screenshot_count': len(screenshot_files),
            'screenshot_folder': OUTPUT_FOLDER
        })

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Error: {str(e)}'}), 500


@html_bp.route('/beautify', methods=['POST'])
def beautify_html_endpoint():
    """Beautify HTML code."""
    try:
        data = request.get_json()
        html_content = data.get('html', '')
        if not html_content:
            return jsonify({'error': 'No HTML provided'}), 400

        beautified = html_beautifier.beautify(html_content)
        validation = html_beautifier.validate(beautified)
        return jsonify({'success': True, 'html': beautified, 'validation': validation})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@html_bp.route('/minify', methods=['POST'])
def minify_html_endpoint():
    """Minify HTML code."""
    try:
        data = request.get_json()
        html_content = data.get('html', '')
        if not html_content:
            return jsonify({'error': 'No HTML provided'}), 400

        minified = html_beautifier.minify(html_content)
        return jsonify({
            'success': True,
            'html': minified,
            'original_size': len(html_content),
            'minified_size': len(minified),
            'reduction_percent': round((1 - len(minified) / len(html_content)) * 100, 2)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
