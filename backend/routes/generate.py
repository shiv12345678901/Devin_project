"""Legacy text endpoints backed by the unified tracked export pipeline."""
from __future__ import annotations

import json
import time
from queue import Empty

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

from backend.routes.helpers import (
    HTML_FOLDER,
    OUTPUT_FOLDER,
    build_ai_input_text,
    get_next_batch_id,
    save_html,
    take_screenshots,
)
from backend.src.core.ai_client import (
    CancelledError,
    cancel_operation,
    get_ai_response,
    register_operation,
    unregister_operation,
)
from backend.src.core.workflow_runner import subscribe_run, unsubscribe_run
from backend.src.utils.html_beautifier import HTMLBeautifier
from backend.src.utils.performance_metrics import metrics_tracker
from backend.src.utils.run_guard import RunRejected, begin_run, end_run


generate_bp = Blueprint("generate", __name__)


def _generation_payload(data: dict) -> tuple[str, dict]:
    text = str(data.get("text") or "")
    project = {
        "class_name": str(data.get("class_name") or "").strip(),
        "subject": str(data.get("subject") or "").strip(),
        "title": str(data.get("title") or "").strip(),
    }
    return text, project


@generate_bp.route("/generate", methods=["POST"])
def generate():
    """Synchronous images-only compatibility endpoint.

    New clients should use ``POST /runs/text-to-video``. This endpoint remains
    for scripts that expect a single JSON response.
    """
    data = request.get_json(silent=True) or {}
    text, project = _generation_payload(data)
    if not text.strip():
        return jsonify({"success": False, "error": "No text provided"}), 400
    operation_id = f"generate_{int(time.time() * 1000)}"
    try:
        begin_run(operation_id, "/generate", {"text": text, "project_info": project})
    except RunRejected as rejected:
        return jsonify({
            "success": False,
            "error": rejected.message,
            "reason": rejected.reason,
            "active_operation_id": rejected.operation_id,
        }), 409

    cancel_event = register_operation(operation_id)
    metrics_tracker.start(operation_id)
    try:
        html = get_ai_response(
            build_ai_input_text(text, project),
            use_cache=bool(data.get("use_cache", True)),
            cancel_event=cancel_event,
            model_choice=str(data.get("model_choice") or "default"),
            system_prompt=str(data.get("system_prompt") or "") or None,
        )
        if not html:
            raise RuntimeError("Failed to get AI response")
        if data.get("beautify_html"):
            html = HTMLBeautifier().beautify(html)
        html_filename, _ = save_html(html, prefix=operation_id, folder=HTML_FOLDER)
        batch_id = get_next_batch_id()
        screenshot_files, screenshot_names = take_screenshots(
            html,
            screenshot_name=batch_id,
            screenshot_folder=OUTPUT_FOLDER,
            zoom=float(data.get("zoom") or 2.1),
            overlap=int(data.get("overlap") or 15),
            viewport_width=int(data.get("viewport_width") or 1920),
            viewport_height=int(data.get("viewport_height") or 1080),
            max_screenshots=int(data.get("max_screenshots") or 75),
            cancel_event=cancel_event,
        )
        metrics_tracker.end(operation_id, success=True, metadata={"screenshot_count": len(screenshot_files)})
        return jsonify({
            "success": True,
            "operation_id": operation_id,
            "html_filename": html_filename,
            "html_content": html,
            "screenshot_folder": f"batch {batch_id}",
            "screenshot_files": screenshot_names,
            "screenshot_count": len(screenshot_names),
        })
    except CancelledError:
        metrics_tracker.end(operation_id, success=False)
        return jsonify({"success": False, "error": "Generation cancelled"}), 409
    except Exception as exc:
        metrics_tracker.end(operation_id, success=False, metadata={"error": str(exc)})
        return jsonify({"success": False, "error": str(exc)}), 500
    finally:
        unregister_operation(operation_id)
        end_run(operation_id)


@generate_bp.route("/generate-sse", methods=["POST"])
def generate_sse():
    """Deprecated POST-SSE adapter to the persisted `/runs/*` pipeline."""
    from backend.routes.runs import start_text_to_video

    started_response = current_app.make_response(start_text_to_video())
    if started_response.status_code >= 400:
        return started_response
    started = started_response.get_json(silent=True) or {}
    run_id = str(started.get("run_id") or "")
    operation_id = str(started.get("operation_id") or run_id)
    subscriber = subscribe_run(run_id, replay=True)

    def events():
        try:
            yield "data: " + json.dumps({
                "type": "started",
                "run_id": run_id,
                "operation_id": operation_id,
                "queue_position": started.get("queue_position"),
                "estimated_total_seconds": started.get("estimated_total_seconds"),
                "progress": 0,
            }) + "\n\n"
            while True:
                try:
                    event = subscriber.get(timeout=20)
                except Empty:
                    yield "event: ping\ndata: {}\n\n"
                    continue
                if event.get("type") == "complete" and isinstance(event.get("data"), dict):
                    event = {**event, **event["data"]}
                yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                if event.get("type") in {"complete", "error", "cancelled"}:
                    break
        finally:
            unsubscribe_run(run_id, subscriber)

    return Response(
        stream_with_context(events()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Deprecation": "true",
            "Link": '</runs/text-to-video>; rel="successor-version"',
        },
    )


@generate_bp.route("/cancel/<operation_id>", methods=["POST"])
def cancel(operation_id: str):
    """Cancel either a tracked run or a synchronous compatibility request."""
    from backend.src.core.job_queue import cancel_job

    data = request.get_json(silent=True) or {}
    if cancel_job(
        operation_id,
        mode=str(data.get("mode") or "now"),
        delete_outputs=bool(data.get("delete_outputs", False)),
    ) or cancel_operation(operation_id):
        return jsonify({"success": True, "message": "Cancellation requested"})
    return jsonify({"success": False, "error": "Operation not found or already finished"}), 404


@generate_bp.route("/preview", methods=["POST"])
def preview():
    """Generate HTML without screenshots for lightweight prompt preview."""
    data = request.get_json(silent=True) or {}
    text, project = _generation_payload(data)
    if not text.strip():
        return jsonify({"success": False, "error": "No text provided"}), 400
    try:
        html = get_ai_response(
            build_ai_input_text(text, project),
            use_cache=bool(data.get("use_cache", True)),
            model_choice=str(data.get("model_choice") or "default"),
            system_prompt=str(data.get("system_prompt") or "") or None,
        )
        if not html:
            raise RuntimeError("Failed to get AI response")
        return jsonify({"success": True, "html_content": html})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
