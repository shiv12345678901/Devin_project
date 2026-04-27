"""Backend-owned run API and queued Text -> Video workflow."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from pathlib import Path
from queue import Empty

from flask import Blueprint, Response, jsonify, request, stream_with_context

from core.ai_client import (
    CancelledError,
    get_ai_response,
    register_operation,
    unregister_operation,
)
from core.job_queue import cancel_job, enqueue, get_queue_snapshot
from core.powerpoint.controller import ExportError, PowerPointController, PowerPointNotFoundError, TemplateError
from core.run_manager import create_run, find_active_run_by_fingerprint, get_run, list_runs
from core.workflow_runner import WorkflowContext, subscribe_run, unsubscribe_run
from routes.helpers import OUTPUT_FOLDER, get_next_batch_id, log_generation, save_html, take_screenshots


runs_bp = Blueprint("runs", __name__)


def _emit(evt: dict) -> str:
    return f"data: {json.dumps(evt)}\n\n"


def _safe_name(name: str, fallback: str) -> str:
    raw = (name or fallback).strip() or fallback
    cleaned = "".join(c if c.isalnum() or c in "._- " else "_" for c in raw)
    return "_".join(cleaned.split())[:80].strip("._-") or fallback


def _resolution_tuple(label: str) -> tuple[int, int]:
    return {
        "720p": (1280, 720),
        "1080p": (1920, 1080),
        "1440p": (2560, 1440),
        "4k": (3840, 2160),
    }.get(str(label).lower(), (1920, 1080))


def _ppt_quality(ui_quality) -> int:
    try:
        q = int(ui_quality)
    except (TypeError, ValueError):
        return 85
    return max(1, min(100, q))


def _rel(path: str | Path | None) -> str | None:
    if not path:
        return None
    return str(path).replace("\\", "/")


def _run_output_path(folder: str, output_name: str, operation_id: str, suffix: str) -> str:
    stem = _safe_name(output_name, "output")
    return _rel(Path(folder) / f"{stem}_{operation_id}{suffix}") or ""


def _close_powerpoint_best_effort() -> None:
    try:
        import win32com.client  # type: ignore

        try:
            ppt = win32com.client.GetActiveObject("PowerPoint.Application")
            try:
                ppt.Quit()
            except Exception:
                pass
        except Exception:
            pass
    except Exception:
        pass
    try:
        subprocess.run(
            ["taskkill", "/IM", "POWERPNT.EXE", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass


@runs_bp.route("/runs", methods=["GET"])
def runs_index():
    return jsonify({"success": True, "runs": list_runs()})


@runs_bp.route("/runs/queue", methods=["GET"])
def queue_status():
    return jsonify({"success": True, "queue": get_queue_snapshot()})


@runs_bp.route("/runs/<run_id>", methods=["GET"])
def run_detail(run_id: str):
    run = get_run(run_id)
    if not run:
        return jsonify({"success": False, "error": "Run not found"}), 404
    return jsonify({"success": True, "run": run})


@runs_bp.route("/runs/<run_id>/events", methods=["GET"])
def run_events(run_id: str):
    if not get_run(run_id):
        return jsonify({"success": False, "error": "Run not found"}), 404

    subscriber = subscribe_run(run_id, replay=True)

    def generate_events():
        try:
            while True:
                try:
                    evt = subscriber.get(timeout=20)
                except Empty:
                    yield "event: ping\ndata: {}\n\n"
                    continue
                yield _emit(evt)
                if evt.get("type") in {"complete", "error", "cancelled"}:
                    break
        finally:
            unsubscribe_run(run_id, subscriber)

    return Response(
        stream_with_context(generate_events()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@runs_bp.route("/runs/<run_id>/cancel", methods=["POST"])
def cancel_run(run_id: str):
    if cancel_job(run_id):
        return jsonify({"success": True, "message": "Cancellation requested"})
    return jsonify({"success": False, "error": "Run is not queued or running"}), 404


@runs_bp.route("/runs/text-to-video", methods=["POST"])
def start_text_to_video():
    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "")
    if not text.strip():
        return jsonify({"success": False, "error": "Text is required"}), 400

    output_format = str(data.get("output_format") or "images")
    output_name = _safe_name(str(data.get("output_name") or data.get("title") or ""), f"generate_{int(time.time() * 1000)}")
    model_choice = str(data.get("model_choice") or "default")
    system_prompt = str(data.get("system_prompt") or "")
    use_cache = bool(data.get("use_cache", True))
    beautify_html = bool(data.get("beautify_html", False))
    close_powerpoint = bool(data.get("close_powerpoint_before_start", True))

    zoom = float(data.get("zoom") or 2.1)
    overlap = int(data.get("overlap") or 15)
    viewport_width = int(data.get("viewport_width") or 1920)
    viewport_height = int(data.get("viewport_height") or 1080)
    max_screenshots = int(data.get("max_screenshots") or 50)
    slide_duration = float(data.get("slide_duration_sec") or 5)
    width, height = _resolution_tuple(str(data.get("resolution") or "1080p"))
    fps = int(data.get("fps") or 30)
    quality = _ppt_quality(data.get("video_quality", 85))

    fingerprint_payload = {
        "text": text.strip(),
        "system_prompt": system_prompt,
        "output_format": output_format,
        "output_name": output_name,
        "model_choice": model_choice,
        "zoom": zoom,
        "overlap": overlap,
        "viewport_width": viewport_width,
        "viewport_height": viewport_height,
        "max_screenshots": max_screenshots,
        "slide_duration": slide_duration,
        "resolution": [width, height],
        "fps": fps,
        "quality": quality,
    }
    input_fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    duplicate = find_active_run_by_fingerprint("text-to-video", input_fingerprint)
    if duplicate:
        return jsonify({
            "success": False,
            "error": f"This exact job is already {duplicate.get('status')}.",
            "duplicate_run_id": duplicate.get("run_id"),
        }), 409

    operation_id = f"text_video_{int(time.time() * 1000)}"
    cancel_event = register_operation(operation_id)
    settings = dict(data)
    settings.update({
        "output_name": output_name,
        "input_fingerprint": input_fingerprint,
    })
    run = create_run(
        tool="text-to-video",
        title=output_name,
        input_text=text,
        settings=settings,
        model_choice=model_choice,
        operation_id=operation_id,
        run_id=operation_id,
        status="queued",
        input_fingerprint=input_fingerprint,
    )
    run_id = run["run_id"]

    def worker(ctx: WorkflowContext) -> None:
        html_filename = None
        screenshot_files: list[str] = []
        screenshot_names: list[str] = []
        screenshot_folder = None
        presentation_file = None
        video_file = None
        try:
            ctx.progress("ai", 5, f"Generating HTML with model {model_choice}...")
            ai_started = time.time()
            html_content = get_ai_response(
                text,
                use_cache=use_cache,
                cancel_event=ctx.cancel_event,
                model_choice=model_choice,
                system_prompt=system_prompt or None,
            )
            ctx.check_cancelled()
            if not html_content:
                ctx.fail("Failed to generate HTML", progress=10)
                return
            ctx.metrics({"ai_seconds": round(time.time() - ai_started, 2), "html_characters": len(html_content)})

            if beautify_html:
                try:
                    from utils.html_beautifier import HTMLBeautifier

                    html_content = HTMLBeautifier().beautify(html_content)
                except Exception:
                    pass

            html_filename, _ = save_html(html_content, folder="output/html")
            ctx.output("html_file", html_filename)
            ctx.progress("html_saved", 30, "HTML saved")

            if output_format == "html":
                outputs = {
                    "html_filename": html_filename,
                    "html_file": html_filename,
                    "screenshot_files": [],
                    "screenshot_count": 0,
                }
                ctx.complete("Successfully generated HTML file", outputs=outputs)
                return

            batch_id = get_next_batch_id()
            screenshot_folder = _rel(Path(OUTPUT_FOLDER) / f"batch {batch_id}")
            ctx.output("screenshot_folder", screenshot_folder)
            ctx.progress("screenshot", 35, "Starting browser screenshots...")
            screenshot_started = time.time()

            def _screenshot_progress(message: str, pct: int = 0) -> None:
                p = max(0, min(100, int(pct or 0)))
                ctx.progress("screenshot", 35 + int((p / 100.0) * 50), str(message))

            screenshot_files, screenshot_names = take_screenshots(
                html_content,
                screenshot_name=batch_id,
                screenshot_folder=screenshot_folder,
                zoom=zoom,
                overlap=overlap,
                viewport_width=viewport_width,
                viewport_height=viewport_height,
                max_screenshots=max_screenshots,
                progress_callback=_screenshot_progress,
                cancel_event=ctx.cancel_event,
            )
            ctx.check_cancelled()
            ctx.metrics({
                "screenshot_seconds": round(time.time() - screenshot_started, 2),
                "screenshot_count": len(screenshot_files),
            })
            ctx.output("screenshot_files", screenshot_names)
            ctx.progress("screenshots_done", 86, f"Captured {len(screenshot_files)} screenshot(s)")

            if output_format in {"pptx", "video"}:
                import sys
                config_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "config"))
                if config_dir not in sys.path:
                    sys.path.insert(0, config_dir)
                from config import POWERPOINT_OUTPUT_FOLDER, POWERPOINT_TEMPLATE_PATH, POWERPOINT_VIDEO_FOLDER  # type: ignore

                if close_powerpoint:
                    ctx.progress("powerpoint_cleanup", 88, "Closing existing PowerPoint instances...")
                    _close_powerpoint_best_effort()
                    time.sleep(1)
                ctx.check_cancelled()

                pptx_path = _run_output_path(POWERPOINT_OUTPUT_FOLDER, output_name, operation_id, ".pptx")
                video_path = _run_output_path(POWERPOINT_VIDEO_FOLDER, output_name, operation_id, ".mp4")

                def _ppt_progress(payload: dict) -> None:
                    stage = str(payload.get("stage") or "powerpoint")
                    raw_progress = payload.get("progress")
                    try:
                        progress = int(raw_progress)
                    except Exception:
                        progress = 90 if stage.startswith("powerpoint") else 95
                    ctx.progress(stage, progress, str(payload.get("message") or "PowerPoint is working..."), data=payload)

                controller = PowerPointController()
                if output_format == "video":
                    ctx.progress("powerpoint", 90, "Building presentation and exporting MP4...")
                    result = controller.create_and_export_video(
                        template_path=POWERPOINT_TEMPLATE_PATH,
                        image_files=screenshot_files,
                        output_pptx_path=pptx_path,
                        output_video_path=video_path,
                        resolution=(width, height),
                        fps=fps,
                        quality=quality,
                        slide_duration=slide_duration,
                        progress_callback=_ppt_progress,
                        cancel_event=ctx.cancel_event,
                    )
                    presentation_file = _rel(result.get("presentation_path"))
                    video_file = _rel(result.get("video_path"))
                    if not video_file or not Path(video_file).exists():
                        raise RuntimeError(result.get("warning") or "PowerPoint did not produce an MP4 file")
                else:
                    ctx.progress("powerpoint", 90, "Building PowerPoint deck...")
                    presentation_file = controller.create_presentation(
                        template_path=POWERPOINT_TEMPLATE_PATH,
                        output_path=pptx_path,
                        image_files=screenshot_files,
                        slide_duration=slide_duration,
                    )
                    presentation_file = _rel(presentation_file)

            outputs = {
                "html_filename": html_filename,
                "html_file": html_filename,
                "screenshot_folder": screenshot_folder,
                "screenshot_files": screenshot_names,
                "screenshot_count": len(screenshot_files),
                "presentation_file": presentation_file,
                "presentation_path": presentation_file,
                "video_file": video_file,
                "video_path": video_file,
            }
            log_generation({
                "tool": "text-to-video",
                "input_preview": text[:200],
                "output_name": output_name,
                "html_file": html_filename,
                "screenshot_folder": screenshot_folder,
                "screenshot_count": len(screenshot_files),
                "presentation_file": presentation_file,
                "video_file": video_file,
                "operation_id": operation_id,
                "settings": settings,
            })
            final = "Successfully generated MP4 video" if output_format == "video" else (
                "Successfully generated PowerPoint deck" if output_format == "pptx" else f"Successfully generated {len(screenshot_files)} screenshot(s)"
            )
            ctx.complete(final, outputs=outputs, metrics={"screenshot_count": len(screenshot_files)})
        except (CancelledError, Exception) as exc:
            if ctx.cancel_event.is_set() or isinstance(exc, CancelledError):
                _close_powerpoint_best_effort()
                ctx.cancel("Operation cancelled")
            elif isinstance(exc, (PowerPointNotFoundError, TemplateError, ExportError)):
                ctx.fail(str(exc))
            else:
                ctx.fail(str(exc))
        finally:
            unregister_operation(operation_id)

    position = enqueue(run_id, operation_id, worker, cancel_event, label="Text-to-video")
    return jsonify({
        "success": True,
        "run_id": run_id,
        "operation_id": operation_id,
        "queue_position": position,
    })
