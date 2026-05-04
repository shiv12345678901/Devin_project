"""Text-to-Image / Generate Blueprint — routes for converting text to screenshots."""
import json
import os
import queue
import threading
import time

from flask import Blueprint, request, jsonify, Response, stream_with_context

from core.ai_client import get_ai_response, verify_html_content, get_ai_revision, register_operation, cancel_operation, unregister_operation, CancelledError
from utils.html_beautifier import HTMLBeautifier
from utils.performance_metrics import metrics_tracker
from utils.run_guard import begin_run, end_run, RunRejected
from utils.run_logger import RunLogger, run_log_path
from routes.helpers import (
    OUTPUT_FOLDER, HTML_FOLDER,
    build_ai_input_text, get_next_batch_id, sanitize_folder_path,
    take_screenshots, save_html, log_generation,
    youtube_video_stem,
)
from utils.eta_tracker import eta_tracker

generate_bp = Blueprint('generate', __name__)
html_beautifier = HTMLBeautifier()


def _resolution_tuple(label: str) -> tuple[int, int]:
    return {
        '720p': (1280, 720),
        '1080p': (1920, 1080),
        '1440p': (2560, 1440),
        '4k': (3840, 2160),
    }.get(str(label).lower(), (1920, 1080))


def _ppt_quality(ui_quality) -> int:
    try:
        q = int(ui_quality)
    except (TypeError, ValueError):
        return 5
    # UI exposes 1-100; PowerPoint exporter expects 1-5.
    return max(1, min(5, round(q / 20)))


def _positive_float(value, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _bool_value(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {'1', 'true', 'yes', 'on'}
    return bool(value)


def _thumbnail_path(filename: str | None) -> str | None:
    name = str(filename or '').strip()
    if not name:
        return None
    base = os.path.abspath(os.path.join('output', 'thumbnails'))
    candidate = os.path.abspath(os.path.join(base, name))
    if candidate == base or not candidate.startswith(base + os.sep):
        return None
    return candidate if os.path.isfile(candidate) else None


@generate_bp.route('/generate', methods=['POST'])
def generate():
    """Process text input, save HTML, and generate screenshots."""
    operation_id = f"generate_{int(time.time() * 1000)}"
    metrics_tracker.start(operation_id)

    try:
        data = request.get_json()
        input_text = data.get('text', '')

        if not input_text:
            return jsonify({'error': 'No text provided'}), 400

        # Settings
        screenshot_folder = sanitize_folder_path(data.get('screenshot_folder', OUTPUT_FOLDER), OUTPUT_FOLDER)
        html_folder = sanitize_folder_path(data.get('html_folder', HTML_FOLDER), HTML_FOLDER)
        zoom = data.get('zoom', 2.1)
        overlap = data.get('overlap', 15)
        viewport_width = data.get('viewport_width', 1920)
        viewport_height = data.get('viewport_height', 1080)
        max_screenshots = data.get('max_screenshots', 50)
        use_cache = data.get('use_cache', True)
        beautify_html = data.get('beautify_html', False)
        project_info = {
            'class_name': (data.get('class_name') or '').strip(),
            'subject': (data.get('subject') or '').strip(),
            'title': (data.get('title') or '').strip(),
        }
        ai_input_text = build_ai_input_text(input_text, project_info)

        # Token estimate
        estimated_tokens = len(ai_input_text) // 4
        if estimated_tokens > 100000:
            return jsonify({'error': f'Text too long! Estimated: ~{estimated_tokens} tokens, Maximum: ~100,000 tokens.'}), 400

        print(f"\n{'='*60}")
        print(f"📥 Processing input: {input_text[:50]}...")
        print(f"📊 Estimated tokens: ~{estimated_tokens}")
        print(f"⚙️  Settings: {viewport_width}x{viewport_height}, zoom={zoom}x, overlap={overlap}px")
        print(f"{'='*60}\n")

        # Model Choice
        model_choice = data.get('model_choice', 'default')
        enable_verification = data.get('enable_verification', True)

        # Predict ETA — the legacy /generate endpoint is screenshots-only,
        # so resolution doesn't apply and concurrency is always off here.
        estimated_total_seconds = eta_tracker.predict_process_time(
            model_choice,
            len(ai_input_text),
        )

        # AI request
        ai_operation_id = f"{operation_id}_ai"
        metrics_tracker.start(ai_operation_id)
        ai_content = get_ai_response(ai_input_text, use_cache=use_cache, model_choice=model_choice)

        if not ai_content:
            metrics_tracker.end(ai_operation_id, success=False)
            metrics_tracker.end(operation_id, success=False)
            return jsonify({'error': 'Failed to get AI response. Check terminal for details.'}), 500

        enable_verification = data.get('enable_verification', True)

        # Verification Loop (up to 3 times)
        if enable_verification:
            max_revisions = 3
            for attempt in range(max_revisions):
                v_start = time.time()
                feedback = verify_html_content(ai_input_text, ai_content, model_choice=model_choice)
                v_duration = time.time() - v_start
                eta_tracker.record_verification(v_duration)
                
                if not feedback or feedback == "PASS":
                    break
                    
                print(f"⚠️ Verification failed (Attempt {attempt + 1}/{max_revisions}), requesting revision...")
                revised_content = get_ai_revision(ai_input_text, ai_content, feedback, model_choice=model_choice)
                if revised_content:
                    ai_content = revised_content
        else:
            print("⏭️ AI Verification skipped by user setting")

        metrics_tracker.end(ai_operation_id, success=True)
        metrics_tracker.track_ai_request(ai_operation_id, len(input_text), len(ai_content), cached=use_cache)

        html_content = ai_content
        if beautify_html:
            html_content = html_beautifier.beautify(html_content)

        # Save HTML
        html_filename, _ = save_html(html_content, folder=html_folder)

        # Take screenshots (DRY helper #12)
        screenshot_name = get_next_batch_id()
        screenshot_operation_id = f"{operation_id}_screenshot"
        metrics_tracker.start(screenshot_operation_id)

        screenshot_files, screenshot_names = take_screenshots(
            html_content, screenshot_name,
            screenshot_folder=screenshot_folder,
            zoom=zoom, overlap=overlap,
            viewport_width=viewport_width, viewport_height=viewport_height,
            max_screenshots=max_screenshots
        )

        metrics_tracker.end(screenshot_operation_id, success=True)
        import os
        file_sizes = [os.path.getsize(f) for f in screenshot_files]
        metrics_tracker.track_screenshot_generation(
            screenshot_operation_id, len(screenshot_files), 0,
            (viewport_width, viewport_height), file_sizes
        )

        # Log to history (#8)
        log_generation({
            'tool': 'text-to-image',
            'input_preview': input_text[:200],
            'html_file': html_filename,
            'screenshot_folder': screenshot_folder,
            'screenshot_count': len(screenshot_files),
            'settings': {'zoom': zoom, 'overlap': overlap, 'width': viewport_width, 'height': viewport_height},
        })

        metrics_tracker.end(operation_id, success=True, metadata={
            'screenshot_count': len(screenshot_files),
            'total_size_kb': sum(file_sizes) / 1024
        })
        
        # Record completion metrics for accurate future ETAs
        ai_metrics = metrics_tracker.get_metrics(ai_operation_id)
        sc_metrics = metrics_tracker.get_metrics(screenshot_operation_id)
        ai_time = ai_metrics.get('duration_seconds', 0) if ai_metrics else 0
        sc_time = sc_metrics.get('duration_seconds', 0) if sc_metrics else 0
        
        eta_tracker.record_completion(
            model_choice=model_choice,
            input_chars=len(ai_input_text),
            ai_seconds=ai_time,
            screenshot_count=len(screenshot_files),
            screenshot_seconds=sc_time,
            use_cache=use_cache
        )
        total_metrics = metrics_tracker.get_metrics(operation_id)
        total_time = total_metrics.get('duration_seconds', 0) if total_metrics else 0
        eta_tracker.record_process_completion(
            model_choice,
            len(ai_input_text),
            total_time,
        )

        return jsonify({
            'success': True,
            'message': f'Successfully generated {len(screenshot_files)} screenshot(s)',
            'html_filename': html_filename,
            'html_content': html_content,
            'screenshot_files': screenshot_names,
            'screenshot_count': len(screenshot_files),
            'screenshot_folder': screenshot_folder,
            'estimated_total_seconds': estimated_total_seconds,
            'metrics': metrics_tracker.get_summary(operation_id),
            'performance': {
                'total_time': metrics_tracker.get_summary(operation_id)['duration'],
                'ai_time': metrics_tracker.get_summary(ai_operation_id)['duration'],
                'screenshot_time': metrics_tracker.get_summary(screenshot_operation_id)['duration']
            }
        })

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
        # End any sub-trackers that might still be running. The local
        # references only exist once we reach those branches, so fall
        # back to the derived id string and let metrics_tracker.end()
        # silently no-op if the id was never started.
        for sub_id in (f"{operation_id}_ai", f"{operation_id}_screenshot"):
            try:
                metrics_tracker.end(sub_id, success=False)
            except Exception:
                pass
        metrics_tracker.end(operation_id, success=False, metadata={'error': str(e)})
        return jsonify({'error': f'Error: {str(e)}'}), 500


@generate_bp.route('/generate-sse', methods=['POST'])
def generate_sse():
    """Generate with real-time SSE progress streaming."""
    data = request.get_json()
    input_text = data.get('text', '')

    if not input_text:
        return jsonify({'error': 'No text provided'}), 400

    operation_id = f"generate_{int(time.time() * 1000)}"

    screenshot_folder = sanitize_folder_path(data.get('screenshot_folder', OUTPUT_FOLDER), OUTPUT_FOLDER)
    html_folder = sanitize_folder_path(data.get('html_folder', HTML_FOLDER), HTML_FOLDER)
    zoom = data.get('zoom', 2.1)
    overlap = data.get('overlap', 15)
    viewport_width = data.get('viewport_width', 1920)
    viewport_height = data.get('viewport_height', 1080)
    max_screenshots = data.get('max_screenshots', 50)
    use_cache = data.get('use_cache', True)
    beautify_html = data.get('beautify_html', False)

    # Pass-through fields: accepted into the request + history so the UI
    # keeps parity with the old HF-Space form, but only the PowerPoint /
    # MP4 export path (Windows) actually uses them today.
    output_name = (data.get('output_name') or '').strip()
    system_prompt = data.get('system_prompt', '')
    project_info = {
        'class_name': (data.get('class_name') or '').strip(),
        'subject': (data.get('subject') or '').strip(),
        'title': (data.get('title') or '').strip(),
        'output_format': data.get('output_format', 'images'),
    }
    ai_input_text = build_ai_input_text(input_text, project_info)
    video_export_settings = {
        'resolution': data.get('resolution', '1080p'),
        'video_quality': data.get('video_quality', 85),
        'fps': data.get('fps', 30),
        'slide_duration_sec': data.get('slide_duration_sec', 5),
        'close_powerpoint_before_start': data.get('close_powerpoint_before_start', True),
        'auto_timing_screenshot_slides': data.get('auto_timing_screenshot_slides', True),
        'fixed_seconds_per_screenshot_slide': data.get('fixed_seconds_per_screenshot_slide', 5),
        # Intro thumbnail (inserted on slide 2 of the default PPT template).
        # Falls back to the legacy single-thumbnail keys so older requests
        # still resolve to the intro slot.
        'intro_thumbnail_enabled': data.get(
            'intro_thumbnail_enabled',
            data.get('thumbnail_enabled', data.get('thumbnail_on_slide_2', False)),
        ),
        'intro_thumbnail_filename': data.get(
            'intro_thumbnail_filename', data.get('thumbnail_filename', '')
        ),
        'intro_thumbnail_duration_sec': data.get(
            'intro_thumbnail_duration_sec', data.get('thumbnail_duration_sec', 5)
        ),
        # Outro thumbnail (inserted on the 2nd-to-last slide).
        'outro_thumbnail_enabled': data.get('outro_thumbnail_enabled', False),
        'outro_thumbnail_filename': data.get('outro_thumbnail_filename', ''),
        'outro_thumbnail_duration_sec': data.get('outro_thumbnail_duration_sec', 5),
    }

    # Single-flight + dedup guard. Has to happen *before* we register the
    # cancel event / metrics tracker so a rejected duplicate doesn't leak
    # state. Reject with 409 + a structured error event so the React UI
    # can show a useful "another run is already in progress" toast
    # instead of a generic SSE failure.
    try:
        begin_run(operation_id, '/generate-sse', {
            'text': input_text,
            'screenshot_folder': screenshot_folder,
            'html_folder': html_folder,
            'zoom': zoom,
            'overlap': overlap,
            'viewport_width': viewport_width,
            'viewport_height': viewport_height,
            'max_screenshots': max_screenshots,
            'output_name': output_name,
            'project_info': project_info,
            'video_export_settings': video_export_settings,
        })
    except RunRejected as rr:
        return jsonify({
            'error': rr.message,
            'reason': rr.reason,
            'active_operation_id': rr.operation_id,
        }), 409

    cancel_event = register_operation(operation_id)
    metrics_tracker.start(operation_id)
    run_logger = RunLogger(operation_id)
    log_path = run_logger.path
    run_logger.section(f"GENERATE-SSE  op={operation_id}  text_chars={len(input_text)}")
    run_logger.info(
        f"Settings: zoom={zoom} overlap={overlap} "
        f"viewport={viewport_width}x{viewport_height} "
        f"max_screenshots={max_screenshots} use_cache={use_cache} "
        f"output_format={project_info.get('output_format')!r}"
    )

    def generate_events():
        try:
            model_choice = data.get('model_choice', 'default')
            enable_verification = data.get('enable_verification', True)
            estimated_total_seconds = eta_tracker.predict_process_time(
                model_choice,
                len(ai_input_text),
                resolution=video_export_settings.get('resolution'),
                concurrent=_bool_value(
                    data.get('concurrent_pipeline_runs')
                    or video_export_settings.get('concurrent_pipeline_runs'),
                    False,
                ),
            )
            run_logger.info(
                f"Predicted total: ~{estimated_total_seconds}s  "
                f"model={model_choice} verify={enable_verification}"
            )
            yield f"data: {json.dumps({'type': 'started', 'operation_id': operation_id, 'estimated_total_seconds': estimated_total_seconds, 'log_path': log_path})}\n\n"
            # Immediately follow `started` with an actual progress event so
            # the UI flips off 0%/"Starting…" even if the AI call is about
            # to block or the WSGI layer buffers the first chunk until it
            # sees a second write.
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'init', 'message': 'Warming up…', 'progress': 2})}\n\n"

            for folder in [screenshot_folder, html_folder]:
                os.makedirs(folder, exist_ok=True)

            # Guard: output_format=video/pptx requires Windows + PowerPoint.
            import platform as _platform
            requested_format = project_info.get('output_format', 'images')
            if requested_format in ('video', 'pptx') and _platform.system() != 'Windows':
                label = 'MP4 video' if requested_format == 'video' else 'PowerPoint deck'
                yield f"data: {json.dumps({'type': 'error', 'message': f'{label} export requires a Windows host with PowerPoint installed. This backend is {_platform.system()} — pick `screenshots` or `HTML file` instead.'})}\n\n"
                return

            estimated_tokens = len(ai_input_text) // 4
            if estimated_tokens > 100000:
                yield f"data: {json.dumps({'type': 'error', 'message': f'Text too long! ~{estimated_tokens} tokens, max ~100,000'})}\n\n"
                return

            # Step 1: AI — emit the stage change first, then the blocking
            # call. If the AI endpoint is unreachable the RuntimeError
            # raised by get_ai_response will surface via the `except
            # Exception` handler below as a structured error event.
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai', 'message': 'Connecting to AI model…', 'progress': 5})}\n\n"
            
            ai_operation_id = f"{operation_id}_ai"
            metrics_tracker.start(ai_operation_id)

            ai_q: "queue.Queue[dict]" = queue.Queue()
            ai_holder: dict = {'content': None, 'error': None}

            def _ai_worker():
                try:
                    ai_holder['content'] = get_ai_response(
                        ai_input_text,
                        use_cache=use_cache,
                        cancel_event=cancel_event,
                        model_choice=model_choice,
                        system_prompt=system_prompt or None,
                    )
                except Exception as exc:  # pragma: no cover — surfaced in UI
                    ai_holder['error'] = str(exc)
                finally:
                    ai_q.put({'kind': '_done'})

            ai_started = time.time()
            ai_thread = threading.Thread(target=_ai_worker, daemon=True)
            ai_thread.start()
            run_logger.info(f"AI worker started (model={model_choice})")

            last_log_elapsed = -1
            while True:
                try:
                    # 1s timeout so the SSE stream gets fresh "still alive"
                    # events at human-perceptible intervals; previously this
                    # was 2s which left the progress bar visibly stalled.
                    msg = ai_q.get(timeout=1)
                except queue.Empty:
                    if cancel_event.is_set():
                        ai_thread.join(timeout=10)
                        metrics_tracker.end(ai_operation_id, success=False)
                        metrics_tracker.end(operation_id, success=False)
                        run_logger.warn("AI phase cancelled by user")
                        yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Generation cancelled'})}\n\n"
                        return
                    elapsed = int(time.time() - ai_started)
                    progress = min(28, 5 + max(1, elapsed // 3))
                    if elapsed != last_log_elapsed and elapsed % 5 == 0:
                        run_logger.info(f"AI still working… {elapsed}s elapsed")
                        last_log_elapsed = elapsed
                    yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai', 'message': f'AI is generating HTML... {elapsed}s elapsed', 'progress': progress})}\n\n"
                    continue

                if msg.get('kind') == '_done':
                    break
            run_logger.info(f"AI worker finished in {int(time.time() - ai_started)}s")

            ai_thread.join(timeout=10)
            if ai_holder['error']:
                metrics_tracker.end(ai_operation_id, success=False)
                metrics_tracker.end(operation_id, success=False)
                yield f"data: {json.dumps({'type': 'error', 'message': ai_holder['error']})}\n\n"
                return

            ai_content = ai_holder['content']
            metrics_tracker.end(ai_operation_id, success=bool(ai_content))

            if cancel_event.is_set():
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Generation cancelled'})}\n\n"
                return

            if not ai_content:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Failed to get AI response'})}\n\n"
                return

            enable_verification = data.get('enable_verification', True)

            if enable_verification:
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai_verify', 'message': 'Verifying completeness...', 'progress': 20})}\n\n"
                run_logger.info("AI verification phase starting")

                # Verification revision loop. Previously this ran up to 3
                # full re-generation passes, which on a slow AI endpoint
                # added ~2 extra full AI calls per request and pushed a
                # 3–4 min run into 8+ min territory. The vast majority of
                # content gaps get fixed on the first revision, so the
                # cap is now 1 pass. Override with `AI_MAX_REVISIONS` if
                # you really need the old behaviour.
                max_revisions = int(os.environ.get('AI_MAX_REVISIONS', '1'))
                for attempt in range(max_revisions):
                    v_start = time.time()
                    run_logger.info(f"Verification attempt {attempt + 1}/{max_revisions} starting")
                    feedback = verify_html_content(ai_input_text, ai_content, cancel_event=cancel_event, model_choice=model_choice)
                    v_duration = time.time() - v_start
                    eta_tracker.record_verification(v_duration)
                    run_logger.info(
                        f"Verification attempt {attempt + 1} done in {v_duration:.1f}s "
                        f"(verdict={'PASS' if not feedback or feedback == 'PASS' else 'REVISE'})"
                    )

                    if cancel_event.is_set():
                        yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Generation cancelled'})}\n\n"
                        return

                    if not feedback or feedback == "PASS":
                        break

                    yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai_revision', 'message': f'Revising missing content (Attempt {attempt + 1}/{max_revisions})...', 'progress': 20 + (attempt * 3)})}\n\n"
                    run_logger.info(f"Asking AI for revision pass {attempt + 1}")
                    revised_content = get_ai_revision(ai_input_text, ai_content, feedback, cancel_event=cancel_event, model_choice=model_choice)

                    if cancel_event.is_set():
                        yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Generation cancelled'})}\n\n"
                        return

                    if revised_content:
                        ai_content = revised_content
                        run_logger.info(f"Revision pass {attempt + 1} applied")
            else:
                run_logger.info("AI verification skipped (enable_verification=False)")
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai_verify_skip', 'message': 'AI verification skipped...', 'progress': 20})}\n\n"

            yield f"data: {json.dumps({'type': 'progress', 'stage': 'ai_done', 'message': 'AI response finalized', 'progress': 30})}\n\n"

            # Step 2: HTML
            html_content = ai_content
            if beautify_html:
                html_content = html_beautifier.beautify(html_content)

            html_filename, _ = save_html(html_content, folder=html_folder)

            if requested_format == 'html':
                log_generation({
                    'tool': 'text-to-video',
                    'input_preview': input_text[:200],
                    'output_name': output_name or None,
                    'project': project_info,
                    'html_file': html_filename,
                    'screenshot_count': 0,
                    'presentation_file': None,
                    'video_file': None,
                    'operation_id': operation_id,
                    'settings': {
                        'zoom': zoom, 'overlap': overlap,
                        'width': viewport_width, 'height': viewport_height,
                        'model_choice': model_choice,
                        'system_prompt_used': bool(system_prompt),
                        **video_export_settings,
                    },
                })
                metrics_tracker.end(operation_id, success=True)
                final_message = 'Successfully generated HTML file'
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'html_saved', 'message': final_message, 'progress': 99})}\n\n"
                yield f"data: {json.dumps({'type': 'html_generated', 'html_filename': html_filename, 'html_content': html_content})}\n\n"
                yield f"data: {json.dumps({'type': 'complete', 'success': True, 'message': final_message, 'html_filename': html_filename, 'html_content': html_content, 'screenshot_files': [], 'screenshot_count': 0, 'screenshot_folder': None, 'presentation_file': None, 'video_file': None, 'operation_id': operation_id})}\n\n"
                return

            yield f"data: {json.dumps({'type': 'progress', 'stage': 'html_saved', 'message': 'HTML saved, starting screenshots...', 'progress': 35})}\n\n"
            # Let the UI preview the generated HTML before screenshots finish.
            yield f"data: {json.dumps({'type': 'html_generated', 'html_filename': html_filename, 'html_content': html_content})}\n\n"

            # Step 3: Screenshots (DRY #12).
            # Run Playwright on a background thread and stream per-shot
            # progress back to the SSE generator via a Queue. Without this
            # the generator would sit blocked inside take_screenshots for
            # minutes and the UI would flatline — users reported "I don't
            # know if anything is happening". The progress_callback on the
            # playwright engine already fires once per shot; we just need
            # a way to surface it from the worker thread back to the SSE
            # loop.
            screenshot_name = get_next_batch_id()
            screenshot_operation_id = f"{operation_id}_screenshot"
            metrics_tracker.start(screenshot_operation_id)

            progress_q: "queue.Queue[dict]" = queue.Queue()
            result_holder: dict = {'files': [], 'names': [], 'error': None}

            def _on_progress(message, pct):
                try:
                    progress_q.put_nowait({
                        'kind': 'progress',
                        'message': message,
                        'progress': int(pct),
                    })
                except queue.Full:  # pragma: no cover — unbounded queue
                    pass

            def _worker():
                try:
                    files, names = take_screenshots(
                        html_content, screenshot_name,
                        screenshot_folder=screenshot_folder,
                        zoom=zoom, overlap=overlap,
                        viewport_width=viewport_width,
                        viewport_height=viewport_height,
                        max_screenshots=max_screenshots,
                        progress_callback=_on_progress,
                        cancel_event=cancel_event,
                    )
                    result_holder['files'] = files
                    result_holder['names'] = names
                except Exception as exc:  # pragma: no cover — surfaced in UI
                    result_holder['error'] = str(exc)
                finally:
                    progress_q.put({'kind': '_done'})

            worker = threading.Thread(target=_worker, daemon=True)
            worker.start()

            yield f"data: {json.dumps({'type': 'progress', 'stage': 'screenshot', 'message': 'Launching browser…', 'progress': 37})}\n\n"
            screenshot_started = time.time()
            last_screenshot_progress = 37
            run_logger.info("Screenshot worker started")
            last_logged_inner = -1
            last_warmup_log = -1

            # Drain progress events until the worker signals completion.
            # The inner callback reports 10–90 within the screenshot phase;
            # we map that into the outer 35–95 band so the overall bar
            # keeps progressing evenly through the whole run.
            while True:
                try:
                    # 1s heartbeat so the SSE event loop notices cancels
                    # quickly and the UI's "Ns elapsed" counter ticks at a
                    # human-perceptible rate while the browser is rendering.
                    msg = progress_q.get(timeout=1)
                except queue.Empty:
                    # Keep the SSE connection alive and re-check cancel.
                    if cancel_event.is_set():
                        # Worker will see the flag and exit its loop; we
                        # still join it so we don't leak the thread.
                        worker.join(timeout=10)
                        metrics_tracker.end(screenshot_operation_id, success=False)
                        metrics_tracker.end(operation_id, success=False)
                        run_logger.warn("Screenshot phase cancelled by user")
                        yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Generation cancelled'})}\n\n"
                        return
                    elapsed = int(time.time() - screenshot_started)
                    warmup_progress = min(45, last_screenshot_progress + 1)
                    last_screenshot_progress = warmup_progress
                    if elapsed != last_warmup_log and elapsed % 5 == 0:
                        run_logger.info(f"Browser still rendering… {elapsed}s elapsed")
                        last_warmup_log = elapsed
                    yield f"data: {json.dumps({'type': 'progress', 'stage': 'screenshot', 'message': f'Browser is rendering screenshots... {elapsed}s elapsed', 'progress': warmup_progress})}\n\n"
                    continue

                if msg.get('kind') == '_done':
                    break

                inner = msg.get('progress', 0)
                outer = 35 + int(inner * 0.60)
                outer = max(35, min(outer, 95))
                last_screenshot_progress = max(last_screenshot_progress, outer)
                if inner != last_logged_inner and inner - last_logged_inner >= 5:
                    run_logger.info(f"Screenshot progress: {inner}% — {msg.get('message', '')}")
                    last_logged_inner = inner
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'screenshot', 'message': msg.get('message', ''), 'progress': outer})}\n\n"

            worker.join(timeout=10)
            run_logger.info(
                f"Screenshot worker finished in {int(time.time() - screenshot_started)}s "
                f"({len(result_holder.get('files') or [])} files)"
            )

            if result_holder['error']:
                metrics_tracker.end(screenshot_operation_id, success=False)
                metrics_tracker.end(operation_id, success=False)
                yield f"data: {json.dumps({'type': 'error', 'message': result_holder['error']})}\n\n"
                return

            screenshot_files = result_holder['files']
            screenshot_names = result_holder['names']

            # The screenshot engine breaks out of its loop on cancel and
            # returns whatever it captured so far — without this explicit
            # check the SSE stream would emit `complete` with the partial
            # batch and the UI would treat a cancelled run as successful.
            if cancel_event.is_set():
                metrics_tracker.end(screenshot_operation_id, success=False)
                metrics_tracker.end(operation_id, success=False)
                yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Generation cancelled'})}\n\n"
                return

            presentation_file = None
            video_file = None
            export_warning = None
            if requested_format in ('pptx', 'video'):
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'export', 'message': 'Creating PowerPoint export...', 'progress': 96})}\n\n"
                try:
                    import sys
                    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
                    config_dir = os.path.join(backend_dir, 'config')
                    if config_dir not in sys.path:
                        sys.path.insert(0, config_dir)
                    from config import (  # type: ignore
                        POWERPOINT_TEMPLATE_PATH,
                        POWERPOINT_OUTPUT_FOLDER,
                        POWERPOINT_VIDEO_FOLDER,
                    )
                    from core.powerpoint.controller import PowerPointController
                    from video_engine import MovieEngineUnavailableError, VideoStudio

                    # MP4 and PPTX share the same canonical
                    # ``class_X_subject_chapter_Y_exercise_2083`` stem so
                    # the Process tab, Publish tab, and Library always
                    # show a matched pair of artefacts for the same run.
                    stem = youtube_video_stem(project_info, output_name, input_text)
                    pptx_path = os.path.join(POWERPOINT_OUTPUT_FOLDER, f"{stem}.pptx")
                    video_path = os.path.join(POWERPOINT_VIDEO_FOLDER, f"{stem}.mp4")
                    os.makedirs(POWERPOINT_OUTPUT_FOLDER, exist_ok=True)
                    os.makedirs(POWERPOINT_VIDEO_FOLDER, exist_ok=True)
                    screenshot_slide_duration = (
                        round(480.0 / max(len(screenshot_files), 1), 3)
                        if _bool_value(video_export_settings.get('auto_timing_screenshot_slides'), True)
                        else _positive_float(video_export_settings.get('fixed_seconds_per_screenshot_slide'), 5.0)
                    )
                    intro_thumbnail_path = (
                        _thumbnail_path(video_export_settings.get('intro_thumbnail_filename'))
                        if _bool_value(video_export_settings.get('intro_thumbnail_enabled'))
                        else None
                    )
                    outro_thumbnail_path = (
                        _thumbnail_path(video_export_settings.get('outro_thumbnail_filename'))
                        if _bool_value(video_export_settings.get('outro_thumbnail_enabled'))
                        else None
                    )

                    if requested_format == 'video':
                        yield f"data: {json.dumps({'type': 'progress', 'stage': 'export', 'message': 'Exporting MP4 video...', 'progress': 98})}\n\n"
                        studio = VideoStudio()
                        try:
                            export_result = studio.build_video(
                                {
                                    "template_path": POWERPOINT_TEMPLATE_PATH,
                                    "image_files": screenshot_files,
                                    "output_pptx_path": pptx_path,
                                    "output_video_path": video_path,
                                    "slide_duration": screenshot_slide_duration,
                                    "resolution": _resolution_tuple(video_export_settings.get('resolution')),
                                    "fps": int(video_export_settings.get('fps') or 30),
                                    "quality": _ppt_quality(video_export_settings.get('video_quality')),
                                    "intro_thumbnail_path": intro_thumbnail_path,
                                    "intro_thumbnail_duration": _positive_float(video_export_settings.get('intro_thumbnail_duration_sec'), 5.0),
                                    "outro_thumbnail_path": outro_thumbnail_path,
                                    "outro_thumbnail_duration": _positive_float(video_export_settings.get('outro_thumbnail_duration_sec'), 5.0),
                                }
                            )
                        except MovieEngineUnavailableError as engine_exc:
                            raise RuntimeError(str(engine_exc)) from engine_exc
                        presentation_file = export_result.get('presentation_path')
                        video_file = export_result.get('video_path')
                        export_warning = export_result.get('warning')
                        if not video_file or not os.path.exists(video_file):
                            raise RuntimeError(export_warning or 'Video engine did not produce an MP4 file')
                    else:
                        controller = PowerPointController()
                        # Pass the *explicit* screenshot list from this run —
                        # using image_folder would glob every PNG in the
                        # folder (including leftovers from previous runs)
                        # and inject those as slides.
                        controller.create_template_presentation(
                            template_path=POWERPOINT_TEMPLATE_PATH,
                            output_pptx_path=pptx_path,
                            image_files=screenshot_files,
                            slide_duration=screenshot_slide_duration,
                            intro_thumbnail_path=intro_thumbnail_path,
                            intro_thumbnail_duration=_positive_float(video_export_settings.get('intro_thumbnail_duration_sec'), 5.0),
                            outro_thumbnail_path=outro_thumbnail_path,
                            outro_thumbnail_duration=_positive_float(video_export_settings.get('outro_thumbnail_duration_sec'), 5.0),
                        )
                        presentation_file = pptx_path
                except Exception as exc:
                    metrics_tracker.end(screenshot_operation_id, success=True)
                    metrics_tracker.end(operation_id, success=False)
                    yield f"data: {json.dumps({'type': 'error', 'message': f'{requested_format.upper()} export failed after screenshots: {exc}'})}\n\n"
                    return

            # Log history (#8)
            log_generation({
                'tool': 'text-to-video',
                'input_preview': input_text[:200],
                'output_name': output_name or None,
                'project': project_info,
                'html_file': html_filename,
                'screenshot_folder': screenshot_folder,
                'screenshot_count': len(screenshot_files),
                'presentation_file': presentation_file,
                'video_file': video_file,
                # Included so the frontend can dedupe against a tracked
                # run (the tracked run stores operation_id too).
                'operation_id': operation_id,
                'settings': {
                    'zoom': zoom, 'overlap': overlap,
                    'width': viewport_width, 'height': viewport_height,
                    'model_choice': model_choice,
                    'system_prompt_used': bool(system_prompt),
                    **video_export_settings,
                },
            })

            metrics_tracker.end(screenshot_operation_id, success=True)
            metrics_tracker.end(operation_id, success=True)

            final_message = f'Successfully generated {len(screenshot_files)} screenshot(s)'
            if requested_format == 'video':
                final_message = 'Successfully generated MP4 video'
            elif requested_format == 'pptx':
                final_message = 'Successfully generated PowerPoint deck'
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'screenshots_done', 'message': final_message, 'progress': 99})}\n\n"
            
            # Record tracking for ETA system
            ai_metrics = metrics_tracker.get_metrics(ai_operation_id)
            sc_metrics = metrics_tracker.get_metrics(screenshot_operation_id)
            eta_tracker.record_completion(
                model_choice=model_choice,
                input_chars=len(ai_input_text),
                ai_seconds=ai_metrics.get('duration_seconds', 0) if ai_metrics else 0,
                screenshot_count=len(screenshot_files),
                screenshot_seconds=sc_metrics.get('duration_seconds', 0) if sc_metrics else 0,
                use_cache=use_cache
            )
            total_metrics = metrics_tracker.get_metrics(operation_id)
            total_time = total_metrics.get('duration_seconds', 0) if total_metrics else 0
            eta_tracker.record_process_completion(
                model_choice,
                len(ai_input_text),
                total_time,
                resolution=video_export_settings.get('resolution'),
                concurrent=_bool_value(
                    data.get('concurrent_pipeline_runs')
                    or video_export_settings.get('concurrent_pipeline_runs'),
                    False,
                ),
            )

            yield f"data: {json.dumps({'type': 'complete', 'success': True, 'message': final_message, 'html_filename': html_filename, 'html_content': html_content, 'screenshot_files': screenshot_names, 'screenshot_count': len(screenshot_files), 'screenshot_folder': screenshot_folder, 'presentation_file': presentation_file, 'video_file': video_file, 'operation_id': operation_id})}\n\n"

        except CancelledError:
            run_logger.warn("Run cancelled (CancelledError)")
            yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Generation cancelled'})}\n\n"
        except Exception as e:
            run_logger.error(f"Run failed: {e!r}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e), 'log_path': log_path})}\n\n"
        finally:
            unregister_operation(operation_id)
            end_run(operation_id)
            run_logger.info("Run finished — log file closed")
            run_logger.close()

    return Response(
        stream_with_context(generate_events()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


@generate_bp.route('/cancel/<operation_id>', methods=['POST'])
def cancel(operation_id):
    """Cancel an in-progress generation.

    If the operation already finished (the typical race when the user
    clicks Cancel right as the run completes), return success rather than
    a 404 so the frontend doesn't surface a misleading error toast.
    """
    success = cancel_operation(operation_id)
    if success:
        return jsonify({'success': True, 'message': 'Cancellation requested'})
    return jsonify({
        'success': True,
        'message': 'Operation already finished — nothing to cancel.',
        'already_terminal': True,
    })


@generate_bp.route('/preview', methods=['POST'])
def preview_html():
    """Preview AI-generated HTML without creating screenshots."""
    try:
        data = request.get_json()
        input_text = data.get('text', '')

        if not input_text:
            return jsonify({'error': 'No text provided'}), 400

        use_cache = data.get('use_cache', True)
        beautify = data.get('beautify', False)
        model_choice = data.get('model_choice', 'default')
        project_info = {
            'class_name': (data.get('class_name') or '').strip(),
            'subject': (data.get('subject') or '').strip(),
            'title': (data.get('title') or '').strip(),
        }
        ai_input_text = build_ai_input_text(input_text, project_info)

        ai_content = get_ai_response(ai_input_text, use_cache=use_cache, model_choice=model_choice)
        if not ai_content:
            return jsonify({'error': 'Failed to get AI response'}), 500

        html_content = ai_content
        if beautify:
            html_content = html_beautifier.beautify(html_content)

        return jsonify({'success': True, 'html_content': html_content})

    except Exception as e:
        return jsonify({'error': str(e)}), 500
