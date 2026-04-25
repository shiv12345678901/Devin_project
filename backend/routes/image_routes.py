"""Image-to-Screenshots Blueprint — routes for OCR + screenshot generation."""
import os
import json
import time
import tempfile
import uuid

from flask import Blueprint, request, jsonify, Response, stream_with_context

from core.ai_client import get_ai_response, register_operation, unregister_operation, CancelledError
from routes.helpers import (
    OUTPUT_FOLDER, HTML_FOLDER,
    get_next_batch_id,
    take_screenshots, save_html, log_generation,
)

image_bp = Blueprint('image', __name__)


@image_bp.route('/extract-from-image', methods=['POST'])
def extract_from_image():
    """Stage 1: Extract text from uploaded image."""
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400

        image_file = request.files['image']
        if image_file.filename == '':
            return jsonify({'error': 'No image selected'}), 400

        instructions = request.form.get('instructions', '')

        # Save uploaded file temporarily
        temp_dir = tempfile.gettempdir()
        file_ext = os.path.splitext(image_file.filename)[1].lower()
        temp_filename = f"upload_{uuid.uuid4()}{file_ext}"
        temp_path = os.path.join(temp_dir, temp_filename)
        image_file.save(temp_path)

        print(f"\n{'='*60}")
        print(f"📄 File uploaded: {image_file.filename}")
        print(f"💾 Saved to: {temp_path}")
        print(f"{'='*60}\n")

        image_paths_to_process = []
        is_pdf = file_ext == '.pdf'

        if is_pdf:
            import fitz
            print(f"📑 Processing PDF document...")
            pdf_document = fitz.open(temp_path)
            num_pages = min(len(pdf_document), 10)
            for page_num in range(num_pages):
                page = pdf_document.load_page(page_num)
                pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))
                page_img_path = os.path.join(temp_dir, f"page_{uuid.uuid4()}_{page_num}.png")
                pix.save(page_img_path)
                image_paths_to_process.append(page_img_path)
            pdf_document.close()
        else:
            image_paths_to_process = [temp_path]

        from core.vision_client import extract_text_from_multiple_images
        result = extract_text_from_multiple_images(image_paths_to_process, instructions)

        # Cleanup
        try:
            os.remove(temp_path)
            if is_pdf:
                for img_path in image_paths_to_process:
                    if os.path.exists(img_path):
                        os.remove(img_path)
        except Exception as cleanup_err:
            print(f"Warning: Cleanup failed - {cleanup_err}")

        if not result:
            return jsonify({'error': 'Failed to extract text from image'}), 500

        return jsonify({
            'success': True,
            'raw_text': result['raw_text'],
            'metadata': result['metadata'],
            'message': f"Extracted {result['metadata']['word_count']} words from image"
        })

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Error: {str(e)}'}), 500


@image_bp.route('/image-to-screenshots-sse', methods=['POST'])
def image_to_screenshots_sse():
    """Image to Screenshots with real-time SSE progress streaming."""
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400

        image_file = request.files['image']
        instructions = request.form.get('instructions', '')

        zoom = float(request.form.get('zoom', 2.1))
        overlap = int(request.form.get('overlap', 20))
        viewport_width = int(request.form.get('viewport_width', 1920))
        viewport_height = int(request.form.get('viewport_height', 1080))
        max_screenshots = int(request.form.get('max_screenshots', 50))
        system_prompt = request.form.get('system_prompt', '')

        # Save temp file
        temp_dir = tempfile.gettempdir()
        file_ext = os.path.splitext(image_file.filename)[1].lower()
        temp_filename = f"upload_{uuid.uuid4()}{file_ext}"
        temp_path = os.path.join(temp_dir, temp_filename)
        image_file.save(temp_path)

        operation_id = f"image_to_scp_{int(time.time() * 1000)}"
        cancel_event = register_operation(operation_id)

        def generate_events():
            image_paths_to_process = []
            is_pdf = file_ext == '.pdf'

            try:
                yield f"data: {json.dumps({'type': 'started', 'operation_id': operation_id, 'stage': 'init', 'progress': 0})}\n\n"

                # STAGE 1: Vision Extraction
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'vision', 'message': 'Processing file & extracting text...', 'progress': 10})}\n\n"

                if is_pdf:
                    import fitz
                    yield f"data: {json.dumps({'type': 'progress', 'stage': 'vision', 'message': 'Converting PDF pages to images...', 'progress': 12})}\n\n"
                    pdf_document = fitz.open(temp_path)
                    num_pages = min(len(pdf_document), 10)
                    for page_num in range(num_pages):
                        page = pdf_document.load_page(page_num)
                        pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))
                        page_img_path = os.path.join(temp_dir, f"page_{uuid.uuid4()}_{page_num}.png")
                        pix.save(page_img_path)
                        image_paths_to_process.append(page_img_path)
                    pdf_document.close()
                else:
                    image_paths_to_process = [temp_path]

                yield f"data: {json.dumps({'type': 'progress', 'stage': 'vision', 'message': 'Running Vision AI on content...', 'progress': 15})}\n\n"

                try:
                    if is_pdf and len(image_paths_to_process) > 1:
                        from core.vision_client import extract_text_from_image
                        all_pages_text = []
                        total_pages = len(image_paths_to_process)
                        for i, img_path in enumerate(image_paths_to_process):
                            page_progress = 15 + int((i / total_pages) * 15)
                            yield f"data: {json.dumps({'type': 'progress', 'stage': 'vision', 'message': f'Extracting text from page {i+1}/{total_pages}...', 'progress': page_progress})}\n\n"
                            page_result = extract_text_from_image(img_path, instructions)
                            if page_result and page_result.get('raw_text'):
                                all_pages_text.append(f"--- Page {i+1} ---\n{page_result['raw_text']}")
                        if all_pages_text:
                            combined = "\n\n".join(all_pages_text)
                            extraction_result = {
                                'raw_text': combined,
                                'metadata': {'image_count': total_pages, 'character_count': len(combined), 'word_count': len(combined.split())}
                            }
                        else:
                            extraction_result = None
                    else:
                        from core.vision_client import extract_text_from_multiple_images
                        extraction_result = extract_text_from_multiple_images(image_paths_to_process, instructions)
                except Exception as vision_err:
                    extraction_result = None
                    print(f"Vision extraction error: {vision_err}")
                    import traceback
                    traceback.print_exc()

                # Cleanup temp
                try:
                    os.remove(temp_path)
                    if is_pdf:
                        for img_path in image_paths_to_process:
                            if os.path.exists(img_path):
                                os.remove(img_path)
                except Exception:
                    pass

                if cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Operation cancelled'})}\n\n"
                    return

                if not extraction_result:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Failed to extract text. Try a clearer image.'})}\n\n"
                    return

                raw_text = extraction_result['raw_text']
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'vision_complete', 'message': f'Extracted {len(raw_text)} characters.', 'progress': 30})}\n\n"

                # STAGE 2: AI HTML Generation
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai', 'message': 'Generating HTML from extracted text...', 'progress': 35})}\n\n"

                ai_system_prompt = system_prompt if system_prompt else None
                html_content = get_ai_response(raw_text, use_cache=False, cancel_event=cancel_event, system_prompt=ai_system_prompt)

                if cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Operation cancelled'})}\n\n"
                    return
                if not html_content:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Failed to generate HTML'})}\n\n"
                    return

                html_filename, _ = save_html(html_content, prefix="html_from_image")

                yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai_complete', 'message': 'HTML generated successfully', 'progress': 60})}\n\n"
                # Let the UI preview the generated HTML before screenshots finish.
                yield f"data: {json.dumps({'type': 'html_generated', 'html_filename': html_filename, 'html_content': html_content})}\n\n"

                # STAGE 3: Screenshots (DRY #12)
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'screenshots', 'message': 'Generating screenshots from HTML...', 'progress': 65})}\n\n"

                batch_id = get_next_batch_id()
                screenshot_folder = os.path.join(OUTPUT_FOLDER, f"batch {batch_id}")

                screenshot_files, screenshot_names = take_screenshots(
                    html_content, batch_id,
                    screenshot_folder=screenshot_folder,
                    zoom=zoom, overlap=overlap,
                    viewport_width=viewport_width, viewport_height=viewport_height,
                    max_screenshots=max_screenshots
                )

                if cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Operation cancelled'})}\n\n"
                    return

                # Log history (#8)
                log_generation({
                    'tool': 'image-to-screenshots',
                    'input_preview': raw_text[:200],
                    'html_file': html_filename,
                    'screenshot_folder': f"batch {batch_id}",
                    'screenshot_count': len(screenshot_files),
                    'operation_id': operation_id,
                    'settings': {'zoom': zoom, 'overlap': overlap, 'width': viewport_width, 'height': viewport_height},
                })

                yield f"data: {json.dumps({'type': 'progress', 'stage': 'screenshots_complete', 'message': 'Screenshots captured successfully', 'progress': 90})}\n\n"

                yield f"data: {json.dumps({'type': 'complete', 'stage': 'complete', 'message': f'Successfully generated {len(screenshot_files)} screenshot(s)', 'progress': 100, 'html_filename': html_filename, 'html_content': html_content, 'screenshot_files': [f'batch {batch_id}/{name}' for name in screenshot_names], 'screenshot_count': len(screenshot_files), 'screenshot_folder': f'batch {batch_id}', 'operation_id': operation_id, 'raw_text': raw_text})}\n\n"

            except CancelledError:
                # Must be caught before the generic Exception handler, otherwise
                # a user-initiated cancel surfaces as an error toast instead of
                # the clean 'cancelled' state.
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Operation cancelled'})}\n\n"
            except Exception as e:
                import traceback
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': f'Error: {str(e)}'})}\n\n"
            finally:
                unregister_operation(operation_id)

        return Response(
            stream_with_context(generate_events()),
            mimetype='text/event-stream',
            headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
        )

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
        return jsonify({'error': f'Error: {str(e)}'}), 500
