"""Backend-owned run API and queued Text -> Video workflow."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from queue import Empty, Queue

from flask import Blueprint, Response, jsonify, request, stream_with_context

from core.ai_client import (
    CancelledError,
    get_ai_response,
    register_operation,
    unregister_operation,
)
from core.job_queue import cancel_job, enqueue, get_queue_snapshot
from core.pipeline_scheduler import ai_slot, export_slot, screenshot_slot
from core.powerpoint.controller import ExportError, PowerPointController, PowerPointNotFoundError, TemplateError
from video_engine import MovieEngineUnavailableError, VideoStudio
from core.run_manager import (
    create_run,
    find_active_run_by_fingerprint,
    find_recent_run_by_fingerprint,
    get_run,
    list_runs,
)
from core.workflow_runner import WorkflowContext, subscribe_run, unsubscribe_run
from routes.helpers import (
    OUTPUT_FOLDER,
    build_ai_input_text,
    get_next_batch_id,
    log_generation,
    save_html,
    take_screenshots,
    youtube_video_stem,
)
from utils.eta_tracker import eta_tracker


runs_bp = Blueprint("runs", __name__)
MIN_VIDEO_SECONDS = 500.0


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


def _canonical_output_path(folder: str, project_info: dict, output_name: str, input_text: str, suffix: str) -> str:
    """Return a path under *folder* using the canonical YouTube stem.

    Both ``.mp4`` and ``.pptx`` outputs of the same run go through this so
    the artefacts always come out as a matched pair (e.g. the MP4 the
    Publish tab opens, the PPTX visible in the Process tab, and what the
    Library lists on disk).
    """
    stem = youtube_video_stem(project_info, output_name, input_text)
    return _rel(Path(folder) / f"{stem}{suffix}") or ""


def _bool_value(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _positive_float(value, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _thumbnail_path(filename: str | None) -> str | None:
    name = str(filename or "").strip()
    if not name:
        return None
    base = Path("output") / "thumbnails"
    candidate = (base / name).resolve()
    try:
        candidate.relative_to(base.resolve())
    except ValueError:
        return None
    return str(candidate) if candidate.is_file() else None


def _run_powerpoint_export(
    ctx,
    *,
    output_format: str,
    screenshot_files: list[str],
    project_info: dict,
    output_name: str,
    input_text: str,
    close_powerpoint: bool,
    concurrent_pipeline_runs: bool,
    auto_timing_screenshot_slides: bool,
    fixed_seconds_per_screenshot_slide: float,
    width: int,
    height: int,
    fps: int,
    quality: int,
    intro_thumbnail_filename: str,
    intro_thumbnail_enabled: bool,
    intro_thumbnail_duration: float,
    outro_thumbnail_filename: str,
    outro_thumbnail_enabled: bool,
    outro_thumbnail_duration: float,
    starting_progress: int = 88,
) -> tuple[str | None, str | None]:
    """Run the shared PowerPoint export half of the pipeline.

    Both ``text-to-video`` and ``screenshots-to-video`` need exactly the
    same MP4/PPTX export step (canonical filename, slot scheduling, intro
    /outro thumbnail handling, …). Pulling it out keeps the two callers
    in lockstep so a fix in one path automatically benefits the other.
    """
    if output_format not in {"pptx", "video"}:
        return None, None

    import sys
    config_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "config"))
    if config_dir not in sys.path:
        sys.path.insert(0, config_dir)
    from config import (  # type: ignore
        POWERPOINT_OUTPUT_FOLDER,
        POWERPOINT_TEMPLATE_PATH,
        POWERPOINT_VIDEO_FOLDER,
    )

    presentation_file: str | None = None
    video_file: str | None = None

    with export_slot(ctx, concurrent_pipeline_runs):
        if close_powerpoint:
            ctx.progress("powerpoint_cleanup", starting_progress, "Closing existing PowerPoint instances...")
            _close_powerpoint_best_effort()
            time.sleep(1)
        ctx.check_cancelled()

        # MP4 and PPTX share the same canonical stem so the Process tab,
        # Publish tab, and Library all line up on the same
        # ``class_X_subject_chapter_Y_exercise_2083`` base name regardless
        # of which tool produced them.
        pptx_path = _canonical_output_path(
            POWERPOINT_OUTPUT_FOLDER, project_info, output_name, input_text, ".pptx"
        )
        video_path = _canonical_output_path(
            POWERPOINT_VIDEO_FOLDER, project_info, output_name, input_text, ".mp4"
        )
        screenshot_count = max(len(screenshot_files), 1)
        if output_format == "video":
            auto_duration = round(MIN_VIDEO_SECONDS / screenshot_count, 3)
            fixed_total = fixed_seconds_per_screenshot_slide * screenshot_count
            if auto_timing_screenshot_slides or fixed_total < MIN_VIDEO_SECONDS:
                screenshot_slide_duration = auto_duration
                if not auto_timing_screenshot_slides:
                    ctx.progress(
                        "powerpoint",
                        starting_progress + 1,
                        (
                            "Fixed timing was shorter than 500 seconds; "
                            f"using {auto_duration}s per screenshot slide."
                        ),
                    )
            else:
                screenshot_slide_duration = fixed_seconds_per_screenshot_slide
        else:
            screenshot_slide_duration = (
                round(MIN_VIDEO_SECONDS / screenshot_count, 3)
                if auto_timing_screenshot_slides
                else fixed_seconds_per_screenshot_slide
            )

        intro_thumbnail_path = (
            _thumbnail_path(intro_thumbnail_filename) if intro_thumbnail_enabled else None
        )
        outro_thumbnail_path = (
            _thumbnail_path(outro_thumbnail_filename) if outro_thumbnail_enabled else None
        )

        def _ppt_progress(payload: dict) -> None:
            stage = str(payload.get("stage") or "powerpoint")
            raw_progress = payload.get("progress")
            try:
                progress = int(raw_progress)
            except Exception:
                progress = 90 if stage.startswith("powerpoint") else 95
            ctx.progress(stage, progress, str(payload.get("message") or "PowerPoint is working..."), data=payload)

        if output_format == "video":
            ctx.progress("powerpoint", 90, "Building presentation and exporting MP4...")
            studio = VideoStudio()
            try:
                result = studio.build_video(
                    {
                        "template_path": POWERPOINT_TEMPLATE_PATH,
                        "image_files": screenshot_files,
                        "output_pptx_path": pptx_path,
                        "output_video_path": video_path,
                        "resolution": (width, height),
                        "fps": fps,
                        "quality": quality,
                        "slide_duration": screenshot_slide_duration,
                        "intro_thumbnail_path": intro_thumbnail_path,
                        "intro_thumbnail_duration": intro_thumbnail_duration,
                        "outro_thumbnail_path": outro_thumbnail_path,
                        "outro_thumbnail_duration": outro_thumbnail_duration,
                        "progress_callback": _ppt_progress,
                        "cancel_event": ctx.cancel_event,
                    }
                )
            except MovieEngineUnavailableError as exc:
                raise RuntimeError(str(exc)) from exc
            presentation_file = _rel(result.get("presentation_path"))
            video_file = _rel(result.get("video_path"))
            if not video_file or not Path(video_file).exists():
                raise RuntimeError(result.get("warning") or "Video engine did not produce an MP4 file")
        else:
            controller = PowerPointController()
            ctx.progress("powerpoint", 90, "Building PowerPoint deck...")
            presentation_file = controller.create_template_presentation(
                template_path=POWERPOINT_TEMPLATE_PATH,
                output_pptx_path=pptx_path,
                image_files=screenshot_files,
                slide_duration=screenshot_slide_duration,
                intro_thumbnail_path=intro_thumbnail_path,
                intro_thumbnail_duration=intro_thumbnail_duration,
                outro_thumbnail_path=outro_thumbnail_path,
                outro_thumbnail_duration=outro_thumbnail_duration,
                progress_callback=_ppt_progress,
                cancel_event=ctx.cancel_event,
            )
            presentation_file = _rel(presentation_file)

    return presentation_file, video_file


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


def _first_text(*values) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _existing_output_file(value) -> str | None:
    rel = _rel(value)
    if not rel:
        return None
    try:
        path = Path(rel)
        if path.is_absolute():
            return rel if path.is_file() else None
        return rel if (Path.cwd() / path).is_file() else None
    except Exception:
        return None


def _absolute_display_path(value) -> str | None:
    rel = _rel(value)
    if not rel:
        return None
    path = Path(rel)
    if not path.is_absolute():
        path = Path.cwd() / path
    return str(path.resolve())


def _dedupe_key(item: dict) -> tuple[str, str, str]:
    return (
        str(item.get("class_name") or "").strip().casefold(),
        str(item.get("subject") or "").strip().casefold(),
        str(item.get("chapter_name") or "").strip().replace("_", " ").casefold(),
    )


def _youtube_video_item(summary: dict) -> dict | None:
    outputs = summary.get("outputs") if isinstance(summary.get("outputs"), dict) else {}
    if str(summary.get("status") or "").lower() != "completed":
        return None

    run_id = str(summary.get("run_id") or "")
    detail = get_run(run_id, include_input=True) if run_id else None
    settings = detail.get("settings", {}) if isinstance(detail, dict) else {}
    if not isinstance(settings, dict):
        settings = {}
    detail_outputs = detail.get("outputs", {}) if isinstance(detail, dict) else {}
    if isinstance(detail_outputs, dict):
        outputs = {**outputs, **detail_outputs}
    video_file = _existing_output_file(outputs.get("video_file") or outputs.get("video_path"))
    if not video_file:
        return None

    intro_thumb = _first_text(settings.get("intro_thumbnail_filename"), settings.get("thumbnail_filename"))
    outro_thumb = _first_text(settings.get("outro_thumbnail_filename"))
    thumbnail = ""
    thumbnail_role = None
    if intro_thumb and _existing_output_file(Path("output") / "thumbnails" / intro_thumb):
        thumbnail = intro_thumb
        thumbnail_role = "intro"
    if not thumbnail and outro_thumb and _existing_output_file(Path("output") / "thumbnails" / outro_thumb):
        thumbnail = outro_thumb
        thumbnail_role = "outro"
    if not thumbnail:
        return None
    title = _first_text(settings.get("title"), summary.get("title"), run_id)

    return {
        "run_id": run_id,
        "operation_id": summary.get("operation_id"),
        "class_name": _first_text(settings.get("class_name"), "Unsorted"),
        "subject": _first_text(settings.get("subject"), "General"),
        "chapter_name": title,
        "title": title,
        "video_file": video_file,
        "video_abs_path": _absolute_display_path(video_file),
        "thumbnail_file": thumbnail or None,
        "thumbnail_abs_path": _absolute_display_path(Path("output") / "thumbnails" / thumbnail) if thumbnail else None,
        "thumbnail_role": thumbnail_role,
        "presentation_file": _rel(outputs.get("presentation_file") or outputs.get("presentation_path")),
        "html_file": outputs.get("html_file") or outputs.get("html_filename"),
        "screenshot_count": outputs.get("screenshot_count") or len(outputs.get("screenshot_files") or []),
        "duration_seconds": summary.get("duration_seconds"),
        "completed_at": summary.get("completed_at"),
        "input_preview": summary.get("input_preview") or "",
        "input_text": (detail.get("input") if isinstance(detail, dict) else "") or "",
        "model_choice": summary.get("model_choice") or (detail.get("model_choice") if isinstance(detail, dict) else None),
    }


@runs_bp.route("/youtube/videos", methods=["GET"])
def youtube_videos():
    by_chapter: dict[tuple[str, str, str], dict] = {}
    for summary in list_runs(limit=500):
        item = _youtube_video_item(summary)
        if item:
            key = _dedupe_key(item)
            existing = by_chapter.get(key)
            if not existing or float(item.get("completed_at") or 0) > float(existing.get("completed_at") or 0):
                by_chapter[key] = item
    items = sorted(
        by_chapter.values(),
        key=lambda item: float(item.get("completed_at") or 0),
        reverse=True,
    )
    return jsonify({"success": True, "videos": items})


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
    project_info = {
        "class_name": str(data.get("class_name") or "").strip(),
        "subject": str(data.get("subject") or "").strip(),
        "title": str(data.get("title") or "").strip(),
    }
    ai_input_text = build_ai_input_text(text, project_info)

    zoom = float(data.get("zoom") or 2.1)
    overlap = int(data.get("overlap") or 15)
    viewport_width = int(data.get("viewport_width") or 1920)
    viewport_height = int(data.get("viewport_height") or 1080)
    max_screenshots = int(data.get("max_screenshots") or 50)
    auto_timing_screenshot_slides = _bool_value(data.get("auto_timing_screenshot_slides"), True)
    fixed_seconds_per_screenshot_slide = _positive_float(data.get("fixed_seconds_per_screenshot_slide"), 5.0)
    slide_duration = _positive_float(data.get("slide_duration_sec"), 5.0)
    intro_thumbnail_enabled = _bool_value(
        data.get("intro_thumbnail_enabled", data.get("thumbnail_enabled", data.get("thumbnail_on_slide_2"))),
        False,
    )
    outro_thumbnail_enabled = _bool_value(data.get("outro_thumbnail_enabled"), False)
    intro_thumbnail_filename = str(data.get("intro_thumbnail_filename") or data.get("thumbnail_filename") or "")
    outro_thumbnail_filename = str(data.get("outro_thumbnail_filename") or "")
    intro_thumbnail_duration = _positive_float(
        data.get("intro_thumbnail_duration_sec", data.get("thumbnail_duration_sec")),
        5.0,
    )
    outro_thumbnail_duration = _positive_float(data.get("outro_thumbnail_duration_sec"), 5.0)
    resolution_label = str(data.get("resolution") or "1080p")
    width, height = _resolution_tuple(resolution_label)
    fps = int(data.get("fps") or 30)
    quality = _ppt_quality(data.get("video_quality", 85))
    concurrent_pipeline_runs = _bool_value(data.get("concurrent_pipeline_runs"), False)
    estimated_total_seconds = eta_tracker.predict_process_time(
        model_choice,
        len(ai_input_text),
        resolution=resolution_label,
        concurrent=concurrent_pipeline_runs,
    )

    fingerprint_payload = {
        "text": text.strip(),
        "class_name": project_info["class_name"],
        "subject": project_info["subject"],
        "title": project_info["title"],
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
        "auto_timing_screenshot_slides": auto_timing_screenshot_slides,
        "fixed_seconds_per_screenshot_slide": fixed_seconds_per_screenshot_slide,
        "intro_thumbnail_enabled": intro_thumbnail_enabled,
        "intro_thumbnail_filename": intro_thumbnail_filename,
        "intro_thumbnail_duration": intro_thumbnail_duration,
        "outro_thumbnail_enabled": outro_thumbnail_enabled,
        "outro_thumbnail_filename": outro_thumbnail_filename,
        "outro_thumbnail_duration": outro_thumbnail_duration,
        "resolution": [width, height],
        "fps": fps,
        "quality": quality,
        "concurrent_pipeline_runs": concurrent_pipeline_runs,
    }
    input_fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    duplicate = find_active_run_by_fingerprint("text-to-video", input_fingerprint)
    if duplicate:
        return jsonify({
            "success": False,
            "error": f"This exact job is already {duplicate.get('status')}.",
            # `reason` lines up with the keys the frontend's
            # tryParseRejection() understands so the wizard can show its
            # tailored "duplicate" banner instead of a generic 409 string.
            "reason": "duplicate",
            "duplicate_run_id": duplicate.get("run_id"),
            "operation_id": duplicate.get("operation_id"),
        }), 409

    # Defense-in-depth: also reject a second identical submission within a
    # short window of the first one *completing*. The client-side queue
    # already dedupes payloads, but a page reload, a racing retry, or an
    # orphaned second tab can all resubmit the exact same job the moment
    # the first finishes. The active-fingerprint check above doesn't catch
    # those because at that instant the first run is no longer "active".
    # Window is tuned to bounce accidental double-submits without blocking
    # legitimate "try it again with the same input" retries.
    try:
        recent_window = float(os.environ.get("TEXT_VIDEO_RECENT_DEDUP_SECS", "30"))
    except ValueError:
        recent_window = 30.0
    recent = find_recent_run_by_fingerprint("text-to-video", input_fingerprint, recent_window)
    if recent:
        return jsonify({
            "success": False,
            "error": "This exact job just finished moments ago — open the existing run instead of resubmitting.",
            "reason": "duplicate",
            "duplicate_run_id": recent.get("run_id"),
            "operation_id": recent.get("operation_id"),
        }), 409

    operation_id = f"text_video_{time.time_ns()}"
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
        process_started = time.time()
        html_filename = None
        screenshot_files: list[str] = []
        screenshot_names: list[str] = []
        screenshot_folder = None
        presentation_file = None
        video_file = None
        try:
            progress_data = (
                {"eta_seconds": estimated_total_seconds}
                if estimated_total_seconds is not None
                else None
            )
            ai_started = time.time()
            with ai_slot(ctx, concurrent_pipeline_runs):
                ctx.progress("ai", 5, f"Generating HTML with model {model_choice}...", data=progress_data)
                ai_q: Queue[dict] = Queue()
                ai_holder: dict = {"content": None, "error": None}

                def _ai_worker() -> None:
                    try:
                        ai_holder["content"] = get_ai_response(
                            ai_input_text,
                            use_cache=use_cache,
                            cancel_event=ctx.cancel_event,
                            model_choice=model_choice,
                            system_prompt=system_prompt or None,
                        )
                    except Exception as exc:
                        ai_holder["error"] = exc
                    finally:
                        ai_q.put({"kind": "_done"})

                ai_thread = threading.Thread(target=_ai_worker, daemon=True, name=f"{operation_id}-ai")
                ai_thread.start()
                while True:
                    try:
                        msg = ai_q.get(timeout=1)
                    except Empty:
                        if ctx.cancel_event.is_set():
                            ai_thread.join(timeout=10)
                            ctx.check_cancelled()
                        elapsed = int(time.time() - ai_started)
                        progress = min(28, 5 + max(1, elapsed // 3))
                        ctx.progress("ai", progress, f"AI is generating HTML... {elapsed}s elapsed")
                        continue
                    if msg.get("kind") == "_done":
                        break

                ai_thread.join(timeout=10)
                if ai_holder["error"]:
                    raise ai_holder["error"]
                html_content = ai_holder["content"]
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

            html_filename, _ = save_html(html_content, prefix=operation_id, folder="output/html")
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
                eta_tracker.record_process_completion(
                    model_choice,
                    len(ai_input_text),
                    time.time() - process_started,
                    resolution=resolution_label,
                    concurrent=concurrent_pipeline_runs,
                )
                return

            batch_id = get_next_batch_id()
            screenshot_folder = f"batch {batch_id}"
            ctx.output("screenshot_folder", screenshot_folder)
            screenshot_started = time.time()

            def _screenshot_progress(message: str, pct: int = 0) -> None:
                p = max(0, min(100, int(pct or 0)))
                ctx.progress("screenshot", 35 + int((p / 100.0) * 50), str(message))

            with screenshot_slot(ctx, concurrent_pipeline_runs):
                ctx.progress("screenshot", 35, "Starting browser screenshots...")
                screenshot_files, screenshot_names = take_screenshots(
                    html_content,
                    screenshot_name=batch_id,
                    screenshot_folder=OUTPUT_FOLDER,
                    zoom=zoom,
                    overlap=overlap,
                    viewport_width=viewport_width,
                    viewport_height=viewport_height,
                    max_screenshots=max_screenshots,
                    progress_callback=_screenshot_progress,
                    cancel_event=ctx.cancel_event,
                )
            expected_screenshot_prefix = f"{screenshot_folder}/"
            if any(not str(name).startswith(expected_screenshot_prefix) for name in screenshot_names):
                raise RuntimeError("Screenshot output path mismatch; refusing to attach files from another run")
            ctx.check_cancelled()
            ctx.metrics({
                "screenshot_seconds": round(time.time() - screenshot_started, 2),
                "screenshot_count": len(screenshot_files),
            })
            ctx.output("screenshot_files", screenshot_names)
            ctx.progress("screenshots_done", 86, f"Captured {len(screenshot_files)} screenshot(s)")

            if output_format in {"pptx", "video"}:
                presentation_file, video_file = _run_powerpoint_export(
                    ctx,
                    output_format=output_format,
                    screenshot_files=screenshot_files,
                    project_info=project_info,
                    output_name=output_name,
                    input_text=text,
                    close_powerpoint=close_powerpoint,
                    concurrent_pipeline_runs=concurrent_pipeline_runs,
                    auto_timing_screenshot_slides=auto_timing_screenshot_slides,
                    fixed_seconds_per_screenshot_slide=fixed_seconds_per_screenshot_slide,
                    width=width,
                    height=height,
                    fps=fps,
                    quality=quality,
                    intro_thumbnail_filename=intro_thumbnail_filename,
                    intro_thumbnail_enabled=intro_thumbnail_enabled,
                    intro_thumbnail_duration=intro_thumbnail_duration,
                    outro_thumbnail_filename=outro_thumbnail_filename,
                    outro_thumbnail_enabled=outro_thumbnail_enabled,
                    outro_thumbnail_duration=outro_thumbnail_duration,
                )

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
            eta_tracker.record_process_completion(
                model_choice,
                len(ai_input_text),
                time.time() - process_started,
                resolution=resolution_label,
                concurrent=concurrent_pipeline_runs,
            )
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

    position = enqueue(
        run_id,
        operation_id,
        worker,
        cancel_event,
        label="Text-to-video",
        pipeline_enabled=concurrent_pipeline_runs,
    )
    return jsonify({
        "success": True,
        "run_id": run_id,
        "operation_id": operation_id,
        "queue_position": position,
    })


# ─── Screenshots → Video ─────────────────────────────────────────────────────
#
# Runs the *export* half of the text-to-video pipeline against screenshots
# the user already captured (or rendered elsewhere). Skips AI generation
# and Playwright screenshotting entirely, so all the user provides is the
# ordered list of PNG/JPG files plus the same project metadata + export
# settings as ``/runs/text-to-video``.
#
# Why share so much with the text-to-video flow?
#  * Same canonical ``class_X_subject_chapter_Y_exercise_<year>`` filename
#    so MP4/PPTX line up across Process tab, Publish tab, and Library.
#  * Same run-manager record + queueing so the Processes tab handles it
#    transparently (cancel, replay, history, etc.).
#  * Same ETA tracker buckets (resolution + concurrent flag) so concurrent
#    screenshot-to-video exports influence future predictions correctly.

@runs_bp.route("/runs/html-to-video", methods=["POST"])
def start_html_to_video():
    """Queue HTML -> screenshots -> optional PPTX/MP4 using the shared engine."""
    data = request.get_json(silent=True) or {}
    html_content = str(data.get("html") or "")
    if not html_content.strip():
        return jsonify({"success": False, "error": "HTML is required"}), 400

    output_format = str(data.get("output_format") or "video")
    if output_format not in {"images", "pptx", "video"}:
        return jsonify({
            "success": False,
            "error": "output_format must be 'images', 'pptx', or 'video'",
        }), 400

    output_name = _safe_name(
        str(data.get("output_name") or data.get("title") or ""),
        f"html_{int(time.time() * 1000)}",
    )
    project_info = {
        "class_name": str(data.get("class_name") or "").strip(),
        "subject": str(data.get("subject") or "").strip(),
        "title": str(data.get("title") or "").strip(),
    }
    zoom = float(data.get("zoom") or 2.1)
    overlap = int(data.get("overlap") or 15)
    viewport_width = int(data.get("viewport_width") or 1920)
    viewport_height = int(data.get("viewport_height") or 1080)
    max_screenshots = int(data.get("max_screenshots") or 50)
    close_powerpoint = _bool_value(data.get("close_powerpoint_before_start"), True)
    auto_timing_screenshot_slides = _bool_value(data.get("auto_timing_screenshot_slides"), True)
    fixed_seconds_per_screenshot_slide = _positive_float(data.get("fixed_seconds_per_screenshot_slide"), 5.0)
    intro_thumbnail_enabled = _bool_value(
        data.get("intro_thumbnail_enabled", data.get("thumbnail_enabled", data.get("thumbnail_on_slide_2"))),
        False,
    )
    outro_thumbnail_enabled = _bool_value(data.get("outro_thumbnail_enabled"), False)
    intro_thumbnail_filename = str(data.get("intro_thumbnail_filename") or data.get("thumbnail_filename") or "")
    outro_thumbnail_filename = str(data.get("outro_thumbnail_filename") or "")
    intro_thumbnail_duration = _positive_float(
        data.get("intro_thumbnail_duration_sec", data.get("thumbnail_duration_sec")),
        5.0,
    )
    outro_thumbnail_duration = _positive_float(data.get("outro_thumbnail_duration_sec"), 5.0)
    resolution_label = str(data.get("resolution") or "1080p")
    width, height = _resolution_tuple(resolution_label)
    fps = int(data.get("fps") or 30)
    quality = _ppt_quality(data.get("video_quality", 85))
    concurrent_pipeline_runs = _bool_value(data.get("concurrent_pipeline_runs"), False)
    model_choice = "html-to-video"

    estimated_total_seconds = eta_tracker.predict_process_time(
        model_choice,
        max(len(html_content), 1),
        resolution=resolution_label,
        concurrent=concurrent_pipeline_runs,
    )

    fingerprint_payload = {
        "tool": "html-to-video",
        "html": html_content.strip(),
        "class_name": project_info["class_name"],
        "subject": project_info["subject"],
        "title": project_info["title"],
        "output_format": output_format,
        "output_name": output_name,
        "zoom": zoom,
        "overlap": overlap,
        "viewport_width": viewport_width,
        "viewport_height": viewport_height,
        "max_screenshots": max_screenshots,
        "auto_timing_screenshot_slides": auto_timing_screenshot_slides,
        "fixed_seconds_per_screenshot_slide": fixed_seconds_per_screenshot_slide,
        "intro_thumbnail_enabled": intro_thumbnail_enabled,
        "intro_thumbnail_filename": intro_thumbnail_filename,
        "intro_thumbnail_duration": intro_thumbnail_duration,
        "outro_thumbnail_enabled": outro_thumbnail_enabled,
        "outro_thumbnail_filename": outro_thumbnail_filename,
        "outro_thumbnail_duration": outro_thumbnail_duration,
        "resolution": [width, height],
        "fps": fps,
        "quality": quality,
        "concurrent_pipeline_runs": concurrent_pipeline_runs,
    }
    input_fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    duplicate = find_active_run_by_fingerprint("html-to-video", input_fingerprint)
    if duplicate:
        return jsonify({
            "success": False,
            "error": f"This exact job is already {duplicate.get('status')}.",
            "reason": "duplicate",
            "duplicate_run_id": duplicate.get("run_id"),
            "operation_id": duplicate.get("operation_id"),
        }), 409

    operation_id = f"html_video_{time.time_ns()}"
    cancel_event = register_operation(operation_id)
    settings = dict(data)
    settings.update({
        "output_format": output_format,
        "output_name": output_name,
        "input_fingerprint": input_fingerprint,
    })
    run = create_run(
        tool="html-to-video",
        title=output_name,
        input_text=html_content,
        settings=settings,
        model_choice=model_choice,
        operation_id=operation_id,
        run_id=operation_id,
        status="queued",
        input_fingerprint=input_fingerprint,
    )
    run_id = run["run_id"]

    def worker(ctx: WorkflowContext) -> None:
        process_started = time.time()
        html_filename = None
        screenshot_files: list[str] = []
        screenshot_names: list[str] = []
        screenshot_folder = None
        presentation_file = None
        video_file = None
        try:
            progress_data = (
                {"eta_seconds": estimated_total_seconds}
                if estimated_total_seconds is not None
                else None
            )
            html_filename, _ = save_html(html_content, prefix=operation_id, folder="output/html")
            ctx.output("html_file", html_filename)
            ctx.progress("html_saved", 30, "HTML saved; starting screenshots...", data=progress_data)

            batch_id = get_next_batch_id()
            screenshot_folder = f"batch {batch_id}"
            ctx.output("screenshot_folder", screenshot_folder)
            screenshot_started = time.time()

            def _screenshot_progress(message: str, pct: int = 0) -> None:
                p = max(0, min(100, int(pct or 0)))
                ctx.progress("screenshot", 35 + int((p / 100.0) * 50), str(message))

            with screenshot_slot(ctx, concurrent_pipeline_runs):
                ctx.progress("screenshot", 35, "Starting browser screenshots...")
                screenshot_files, screenshot_names = take_screenshots(
                    html_content,
                    screenshot_name=batch_id,
                    screenshot_folder=OUTPUT_FOLDER,
                    zoom=zoom,
                    overlap=overlap,
                    viewport_width=viewport_width,
                    viewport_height=viewport_height,
                    max_screenshots=max_screenshots,
                    progress_callback=_screenshot_progress,
                    cancel_event=ctx.cancel_event,
                )
            expected_screenshot_prefix = f"{screenshot_folder}/"
            if any(not str(name).startswith(expected_screenshot_prefix) for name in screenshot_names):
                raise RuntimeError("Screenshot output path mismatch; refusing to attach files from another run")
            ctx.check_cancelled()
            ctx.metrics({
                "screenshot_seconds": round(time.time() - screenshot_started, 2),
                "screenshot_count": len(screenshot_files),
            })
            ctx.output("screenshot_files", screenshot_names)
            ctx.progress("screenshots_done", 86, f"Captured {len(screenshot_files)} screenshot(s)")

            if output_format in {"pptx", "video"}:
                presentation_file, video_file = _run_powerpoint_export(
                    ctx,
                    output_format=output_format,
                    screenshot_files=screenshot_files,
                    project_info=project_info,
                    output_name=output_name,
                    input_text=html_content,
                    close_powerpoint=close_powerpoint,
                    concurrent_pipeline_runs=concurrent_pipeline_runs,
                    auto_timing_screenshot_slides=auto_timing_screenshot_slides,
                    fixed_seconds_per_screenshot_slide=fixed_seconds_per_screenshot_slide,
                    width=width,
                    height=height,
                    fps=fps,
                    quality=quality,
                    intro_thumbnail_filename=intro_thumbnail_filename,
                    intro_thumbnail_enabled=intro_thumbnail_enabled,
                    intro_thumbnail_duration=intro_thumbnail_duration,
                    outro_thumbnail_filename=outro_thumbnail_filename,
                    outro_thumbnail_enabled=outro_thumbnail_enabled,
                    outro_thumbnail_duration=outro_thumbnail_duration,
                )

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
                "tool": "html-to-video",
                "input_preview": html_content[:200],
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
            eta_tracker.record_process_completion(
                model_choice,
                max(len(html_content), 1),
                time.time() - process_started,
                resolution=resolution_label,
                concurrent=concurrent_pipeline_runs,
            )
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

    position = enqueue(
        run_id,
        operation_id,
        worker,
        cancel_event,
        label="HTML-to-video",
        pipeline_enabled=concurrent_pipeline_runs,
    )
    return jsonify({
        "success": True,
        "run_id": run_id,
        "operation_id": operation_id,
        "queue_position": position,
    })


_SCREENSHOT_FIELD_NAMES = ("screenshots", "screenshots[]", "screenshot", "files", "files[]")
_ALLOWED_SCREENSHOT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def _collect_uploaded_screenshots() -> list:
    """Return all uploaded screenshot files regardless of which field
    name the client used (``screenshots[]`` is the canonical one but we
    accept a few common aliases for resilience).
    """
    found: list = []
    for name in _SCREENSHOT_FIELD_NAMES:
        if name in request.files:
            found.extend(request.files.getlist(name))
    return [f for f in found if getattr(f, "filename", "")]


def _save_uploaded_screenshots_to_batch(uploads: list, batch_id: str) -> tuple[list[str], list[str], str]:
    """Persist uploaded screenshots into ``output/screenshots/batch <id>/``.

    Returns ``(absolute_paths, relative_names, batch_folder)`` where the
    relative names round-trip through the existing
    ``/screenshots/<path:filename>`` endpoint that the frontend already
    knows how to render.
    """
    folder = OUTPUT_FOLDER
    os.makedirs(folder, exist_ok=True)
    batch_subdir = f"batch {batch_id}"
    batch_folder = os.path.join(folder, batch_subdir)
    os.makedirs(batch_folder, exist_ok=True)

    abs_paths: list[str] = []
    rel_names: list[str] = []
    for index, upload in enumerate(uploads, start=1):
        original = str(upload.filename or f"screenshot_{index}.png")
        ext = os.path.splitext(original)[1].lower()
        if ext not in _ALLOWED_SCREENSHOT_EXTS:
            raise ValueError(f"Unsupported screenshot type: {original}")
        # 4-digit zero-padded prefix preserves the user's drop-order so
        # PowerPoint slides come out in the same sequence the user sees in
        # the upload list.
        target_name = f"{batch_id}({index:04d}){ext}"
        target_path = os.path.join(batch_folder, target_name)
        upload.save(target_path)
        abs_paths.append(target_path.replace("\\", "/"))
        rel_names.append(f"{batch_subdir}/{target_name}".replace("\\", "/"))
    return abs_paths, rel_names, batch_subdir


def _form_value(data, key: str, default=None):
    """Read a value from JSON body OR multipart form. Multipart wins so
    drag-drop forms don't have to JSON-encode every option.
    """
    if request.form and key in request.form:
        return request.form.get(key)
    if isinstance(data, dict) and key in data:
        return data.get(key)
    return default


@runs_bp.route("/runs/screenshots-to-video", methods=["POST"])
def start_screenshots_to_video():
    # The frontend uploads multipart for the files + form fields, but we
    # also accept a JSON-only body that points at existing screenshots
    # (``screenshot_files`` = list of paths under ``output/screenshots``).
    data = request.get_json(silent=True) or {}
    uploads = _collect_uploaded_screenshots()

    project_info = {
        "class_name": str(_form_value(data, "class_name") or "").strip(),
        "subject": str(_form_value(data, "subject") or "").strip(),
        "title": str(_form_value(data, "title") or "").strip(),
    }

    output_format = str(_form_value(data, "output_format") or "video")
    if output_format not in {"pptx", "video"}:
        return jsonify({
            "success": False,
            "error": "output_format must be 'pptx' or 'video'",
        }), 400

    output_name = _safe_name(
        str(_form_value(data, "output_name") or _form_value(data, "title") or ""),
        f"screenshots_{int(time.time() * 1000)}",
    )
    close_powerpoint = _bool_value(_form_value(data, "close_powerpoint_before_start"), True)
    auto_timing_screenshot_slides = _bool_value(
        _form_value(data, "auto_timing_screenshot_slides"), True
    )
    fixed_seconds_per_screenshot_slide = _positive_float(
        _form_value(data, "fixed_seconds_per_screenshot_slide"), 5.0
    )
    intro_thumbnail_enabled = _bool_value(
        _form_value(
            data,
            "intro_thumbnail_enabled",
            _form_value(data, "thumbnail_enabled", _form_value(data, "thumbnail_on_slide_2")),
        ),
        False,
    )
    outro_thumbnail_enabled = _bool_value(_form_value(data, "outro_thumbnail_enabled"), False)
    intro_thumbnail_filename = str(
        _form_value(data, "intro_thumbnail_filename") or _form_value(data, "thumbnail_filename") or ""
    )
    outro_thumbnail_filename = str(_form_value(data, "outro_thumbnail_filename") or "")
    intro_thumbnail_duration = _positive_float(
        _form_value(data, "intro_thumbnail_duration_sec", _form_value(data, "thumbnail_duration_sec")),
        5.0,
    )
    outro_thumbnail_duration = _positive_float(
        _form_value(data, "outro_thumbnail_duration_sec"), 5.0
    )
    resolution_label = str(_form_value(data, "resolution") or "1080p")
    width, height = _resolution_tuple(resolution_label)
    try:
        fps = int(_form_value(data, "fps") or 30)
    except (TypeError, ValueError):
        fps = 30
    quality = _ppt_quality(_form_value(data, "video_quality", 85))
    concurrent_pipeline_runs = _bool_value(_form_value(data, "concurrent_pipeline_runs"), False)
    model_choice = "screenshots-to-video"

    # Resolve the screenshot list — either uploads we just received or a
    # JSON ``screenshot_files`` array of paths under ``output/screenshots``.
    screenshot_abs: list[str] = []
    screenshot_names: list[str] = []
    screenshot_folder: str | None = None
    batch_id: str | None = None

    if uploads:
        try:
            batch_id = get_next_batch_id()
            screenshot_abs, screenshot_names, screenshot_folder = (
                _save_uploaded_screenshots_to_batch(uploads, batch_id)
            )
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
    else:
        provided = data.get("screenshot_files") or data.get("screenshots")
        if isinstance(provided, list) and provided:
            for raw in provided:
                rel = str(raw or "").strip().replace("\\", "/")
                if not rel:
                    continue
                # Only accept paths under output/screenshots — defense in
                # depth against path traversal.
                candidate = (Path(OUTPUT_FOLDER) / rel).resolve() if not rel.startswith(OUTPUT_FOLDER) else Path(rel).resolve()
                base = Path(OUTPUT_FOLDER).resolve()
                try:
                    candidate.relative_to(base)
                except ValueError:
                    return jsonify({
                        "success": False,
                        "error": f"Screenshot path escapes output folder: {rel}",
                    }), 400
                if not candidate.is_file():
                    return jsonify({
                        "success": False,
                        "error": f"Screenshot not found: {rel}",
                    }), 400
                screenshot_abs.append(str(candidate).replace("\\", "/"))
                # Store the path relative to OUTPUT_FOLDER so the existing
                # /screenshots/<path:filename> endpoint can serve it.
                screenshot_names.append(str(candidate.relative_to(base)).replace(os.sep, "/"))

    if not screenshot_abs:
        return jsonify({
            "success": False,
            "error": "At least one screenshot is required (upload via 'screenshots[]' or pass 'screenshot_files').",
        }), 400

    # ETA: there is no AI input text for this flow, so we feed the tracker
    # a synthetic char count proportional to the number of screenshots.
    # That keeps predictions sensible across runs of different lengths
    # without leaking unrelated text-to-video variance into them.
    synthetic_char_count = max(len(screenshot_abs) * 250, 1)
    estimated_total_seconds = eta_tracker.predict_process_time(
        model_choice,
        synthetic_char_count,
        resolution=resolution_label,
        concurrent=concurrent_pipeline_runs,
    )

    fingerprint_payload = {
        "tool": "screenshots-to-video",
        "class_name": project_info["class_name"],
        "subject": project_info["subject"],
        "title": project_info["title"],
        "output_format": output_format,
        "output_name": output_name,
        "screenshot_count": len(screenshot_abs),
        # Order+content of the saved files defines the run; using basenames
        # is enough since each upload batch lands in its own folder.
        "screenshots": [Path(p).name for p in screenshot_abs],
        "intro_thumbnail_enabled": intro_thumbnail_enabled,
        "intro_thumbnail_filename": intro_thumbnail_filename,
        "intro_thumbnail_duration": intro_thumbnail_duration,
        "outro_thumbnail_enabled": outro_thumbnail_enabled,
        "outro_thumbnail_filename": outro_thumbnail_filename,
        "outro_thumbnail_duration": outro_thumbnail_duration,
        "resolution": [width, height],
        "fps": fps,
        "quality": quality,
        "auto_timing_screenshot_slides": auto_timing_screenshot_slides,
        "fixed_seconds_per_screenshot_slide": fixed_seconds_per_screenshot_slide,
        "concurrent_pipeline_runs": concurrent_pipeline_runs,
    }
    input_fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    duplicate = find_active_run_by_fingerprint("screenshots-to-video", input_fingerprint)
    if duplicate:
        return jsonify({
            "success": False,
            "error": f"This exact job is already {duplicate.get('status')}.",
            "reason": "duplicate",
            "duplicate_run_id": duplicate.get("run_id"),
            "operation_id": duplicate.get("operation_id"),
        }), 409

    operation_id = f"screenshots_video_{time.time_ns()}"
    cancel_event = register_operation(operation_id)
    settings = {
        "class_name": project_info["class_name"],
        "subject": project_info["subject"],
        "title": project_info["title"],
        "output_format": output_format,
        "output_name": output_name,
        "screenshot_folder": screenshot_folder,
        "screenshot_files": screenshot_names,
        "screenshot_count": len(screenshot_abs),
        "intro_thumbnail_enabled": intro_thumbnail_enabled,
        "intro_thumbnail_filename": intro_thumbnail_filename,
        "intro_thumbnail_duration_sec": intro_thumbnail_duration,
        "outro_thumbnail_enabled": outro_thumbnail_enabled,
        "outro_thumbnail_filename": outro_thumbnail_filename,
        "outro_thumbnail_duration_sec": outro_thumbnail_duration,
        "resolution": resolution_label,
        "fps": fps,
        "video_quality": quality,
        "auto_timing_screenshot_slides": auto_timing_screenshot_slides,
        "fixed_seconds_per_screenshot_slide": fixed_seconds_per_screenshot_slide,
        "close_powerpoint_before_start": close_powerpoint,
        "concurrent_pipeline_runs": concurrent_pipeline_runs,
        "input_fingerprint": input_fingerprint,
    }
    run = create_run(
        tool="screenshots-to-video",
        title=output_name,
        # No raw text input — record the screenshot count instead so the
        # Process tab still has a sensible "input preview" to render.
        input_text=f"[{len(screenshot_abs)} screenshots]",
        settings=settings,
        model_choice=model_choice,
        operation_id=operation_id,
        run_id=operation_id,
        status="queued",
        input_fingerprint=input_fingerprint,
    )
    run_id = run["run_id"]

    def worker(ctx: WorkflowContext) -> None:
        process_started = time.time()
        presentation_file: str | None = None
        video_file: str | None = None
        try:
            progress_data = (
                {"eta_seconds": estimated_total_seconds}
                if estimated_total_seconds is not None
                else None
            )
            ctx.progress(
                "screenshots_ready",
                10,
                f"Loaded {len(screenshot_abs)} screenshot(s)",
                data=progress_data,
            )
            if screenshot_folder:
                ctx.output("screenshot_folder", screenshot_folder)
            ctx.output("screenshot_files", screenshot_names)
            ctx.metrics({"screenshot_count": len(screenshot_abs)})
            ctx.check_cancelled()

            presentation_file, video_file = _run_powerpoint_export(
                ctx,
                output_format=output_format,
                screenshot_files=screenshot_abs,
                project_info=project_info,
                output_name=output_name,
                # No HTML/text source — the canonical filename helper still
                # falls back to the project metadata + output_name fields.
                input_text=output_name,
                close_powerpoint=close_powerpoint,
                concurrent_pipeline_runs=concurrent_pipeline_runs,
                auto_timing_screenshot_slides=auto_timing_screenshot_slides,
                fixed_seconds_per_screenshot_slide=fixed_seconds_per_screenshot_slide,
                width=width,
                height=height,
                fps=fps,
                quality=quality,
                intro_thumbnail_filename=intro_thumbnail_filename,
                intro_thumbnail_enabled=intro_thumbnail_enabled,
                intro_thumbnail_duration=intro_thumbnail_duration,
                outro_thumbnail_filename=outro_thumbnail_filename,
                outro_thumbnail_enabled=outro_thumbnail_enabled,
                outro_thumbnail_duration=outro_thumbnail_duration,
                starting_progress=20,
            )

            outputs = {
                "screenshot_folder": screenshot_folder,
                "screenshot_files": screenshot_names,
                "screenshot_count": len(screenshot_abs),
                "presentation_file": presentation_file,
                "presentation_path": presentation_file,
                "video_file": video_file,
                "video_path": video_file,
            }
            log_generation({
                "tool": "screenshots-to-video",
                "input_preview": f"{len(screenshot_abs)} screenshots",
                "output_name": output_name,
                "screenshot_folder": screenshot_folder,
                "screenshot_count": len(screenshot_abs),
                "presentation_file": presentation_file,
                "video_file": video_file,
                "operation_id": operation_id,
                "settings": settings,
            })
            final = (
                "Successfully generated MP4 video"
                if output_format == "video"
                else "Successfully generated PowerPoint deck"
            )
            ctx.complete(final, outputs=outputs, metrics={"screenshot_count": len(screenshot_abs)})
            eta_tracker.record_process_completion(
                model_choice,
                synthetic_char_count,
                time.time() - process_started,
                resolution=resolution_label,
                concurrent=concurrent_pipeline_runs,
            )
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

    position = enqueue(
        run_id,
        operation_id,
        worker,
        cancel_event,
        label="Screenshots-to-video",
        pipeline_enabled=concurrent_pipeline_runs,
    )
    return jsonify({
        "success": True,
        "run_id": run_id,
        "operation_id": operation_id,
        "queue_position": position,
    })
