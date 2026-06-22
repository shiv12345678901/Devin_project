"""YouTube -> Screenshots Blueprint.

The previous implementation opened YouTube in headless Chromium and captured
the video element. That is fragile because YouTube may render its own player
error page, which then gets saved as the screenshot.

This version uses yt-dlp to download a readable video stream, seeks to the
requested timestamps with OpenCV, and saves the decoded frames as PNG files.
"""

import json
import io
import os
import queue as stdlib_queue
import re
import shutil
import tempfile
import threading
import time
import unicodedata
import zipfile

from flask import Blueprint, Response, jsonify, request, send_file, stream_with_context

youtube_screenshots_bp = Blueprint("youtube_screenshots", __name__)

BACKEND_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
OUTPUT_DIR = os.path.join(BACKEND_DIR, "output", "yt_screenshots")
COOKIES_PATH = os.path.join(BACKEND_DIR, "config", "cookies.txt")
MAX_OPERATION_SECONDS = 600

_ops_lock = threading.Lock()
_active_ops: dict[str, bool] = {}


class OperationCancelled(Exception):
    pass


def _op_register(operation_id: str) -> None:
    with _ops_lock:
        _active_ops[operation_id] = False


def _op_cancel(operation_id: str) -> bool:
    with _ops_lock:
        if operation_id in _active_ops:
            _active_ops[operation_id] = True
            return True
        return False


def _op_is_cancelled(operation_id: str) -> bool:
    with _ops_lock:
        return _active_ops.get(operation_id, False)


def _op_remove(operation_id: str) -> None:
    with _ops_lock:
        _active_ops.pop(operation_id, None)


_job_queue: "stdlib_queue.Queue[tuple]" = stdlib_queue.Queue()
_worker_started = False
_worker_lock = threading.Lock()


def _ensure_worker() -> None:
    global _worker_started
    with _worker_lock:
        if not _worker_started:
            threading.Thread(target=_worker_loop, daemon=True).start()
            _worker_started = True


def _worker_loop() -> None:
    while True:
        video_id, timestamps, operation_id, event_queue = _job_queue.get()
        try:
            _process_job(video_id, timestamps, operation_id, event_queue)
        except OperationCancelled:
            event_queue.put(("cancelled", {"message": "Operation cancelled"}))
        except Exception as e:
            event_queue.put(("error", {"message": str(e)}))
        finally:
            event_queue.put(("done", None))
            _op_remove(operation_id)


def _check_deps() -> str | None:
    missing = []
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        missing.append("yt-dlp")
    try:
        import cv2  # noqa: F401
    except ImportError:
        missing.append("opencv-python")
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    if missing:
        return f"Missing: {', '.join(missing)}. Run: pip install {' '.join(missing)}"
    return None


def _cookie_diagnostics() -> dict:
    info = {
        "path": COOKIES_PATH,
        "exists": os.path.isfile(COOKIES_PATH),
        "size_bytes": 0,
        "last_modified": None,
        "netscape_header": False,
        "valid_rows": 0,
        "youtube_rows": 0,
        "status": "missing",
    }
    if not info["exists"]:
        return info
    try:
        stat = os.stat(COOKIES_PATH)
        info["size_bytes"] = stat.st_size
        info["last_modified"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime))
        with open(COOKIES_PATH, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
        info["netscape_header"] = any("Netscape HTTP Cookie File" in line for line in lines[:5])
        for line in lines:
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            info["valid_rows"] += 1
            domain = parts[0].lower()
            if "youtube" in domain or "google" in domain:
                info["youtube_rows"] += 1
        if stat.st_size < 100:
            info["status"] = "empty"
        elif info["valid_rows"] == 0:
            info["status"] = "invalid"
        elif info["youtube_rows"] == 0:
            info["status"] = "no_youtube_rows"
        else:
            info["status"] = "ok"
    except Exception:
        info["status"] = "unreadable"
    return info


def _extract_video_id(url: str) -> str | None:
    patterns = [
        r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",
    ]
    for pat in patterns:
        match = re.search(pat, url)
        if match:
            return match.group(1)
    return None


def _safe_name(name: str) -> str | None:
    if not name or "/" in name or "\\" in name or ".." in name:
        return None
    return name


def _safe_folder_path(folder_name: str) -> str | None:
    safe = _safe_name(folder_name)
    if not safe:
        return None
    base = os.path.abspath(OUTPUT_DIR)
    fp = os.path.abspath(os.path.join(base, safe))
    if fp != base and fp.startswith(base + os.sep):
        return fp
    return None


def _safe_slug(value: str, fallback: str, max_len: int = 48) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_value).strip("._-")
    slug = re.sub(r"_+", "_", slug)
    return (slug[:max_len].strip("._-") or fallback)


def _build_run_folder(title: str, video_id: str) -> str:
    stamp = time.strftime("%Y%m%d_%H%M%S")
    title_slug = _safe_slug(title, "video", 40)
    return f"batch_yt_{stamp}_{video_id}_{title_slug}"


def _screenshot_filename(index: int, seconds: float) -> str:
    total = max(0, int(round(seconds)))
    if total >= 3600:
        stamp = f"{total // 3600}h{(total % 3600) // 60:02d}m{total % 60:02d}s"
    else:
        stamp = f"{total // 60:02d}m{total % 60:02d}s"
    return f"yt_{index:04d}_{stamp}.png"


@youtube_screenshots_bp.route("/youtube-screenshots/check", methods=["GET"])
def check_available():
    err = _check_deps()
    cookies = _cookie_diagnostics()
    try:
        import yt_dlp
        yt_dlp_version = getattr(yt_dlp.version, "__version__", "unknown")
    except Exception:
        yt_dlp_version = None
    if err:
        return jsonify({
            "available": False,
            "error": err,
            "cookies": cookies,
            "has_cookies": cookies["status"] == "ok",
            "yt_dlp_version": yt_dlp_version,
        }), 200
    return jsonify({
        "available": True,
        "has_cookies": cookies["status"] == "ok",
        "cookies": cookies,
        "yt_dlp_version": yt_dlp_version,
    }), 200


@youtube_screenshots_bp.route("/youtube-screenshots/cancel/<operation_id>", methods=["POST"])
def cancel_operation(operation_id: str):
    if _op_cancel(operation_id):
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Not found"}), 404


@youtube_screenshots_bp.route("/youtube-screenshots/start", methods=["POST"])
def start_extraction():
    dep_err = _check_deps()
    if dep_err:
        return jsonify({"success": False, "error": dep_err}), 400

    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"success": False, "error": "No YouTube URL provided"}), 400

    video_id = _extract_video_id(url)
    if not video_id:
        return jsonify({"success": False, "error": "Could not extract video ID from URL"}), 400

    timestamps = data.get("timestamps", [])
    if not timestamps or not isinstance(timestamps, list):
        return jsonify({"success": False, "error": "No timestamps provided"}), 400

    try:
        timestamps = sorted(set(float(t) for t in timestamps))
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Invalid timestamps; must be seconds"}), 400

    operation_id = f"yt_{int(time.time() * 1000)}"
    event_queue: stdlib_queue.Queue = stdlib_queue.Queue()
    _op_register(operation_id)
    _ensure_worker()
    _job_queue.put((video_id, timestamps, operation_id, event_queue))

    def generate():
        yield _sse_event("started", {"operation_id": operation_id})
        while True:
            try:
                evt, payload = event_queue.get(timeout=30)
            except stdlib_queue.Empty:
                yield ": keepalive\n\n"
                continue
            if evt == "done":
                break
            yield _sse_event(evt, payload)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@youtube_screenshots_bp.route("/youtube-screenshots/list", methods=["GET"])
def list_extractions():
    try:
        page = max(1, int(request.args.get("page", "1")))
    except ValueError:
        page = 1
    try:
        size = min(100, max(1, int(request.args.get("size", "20"))))
    except ValueError:
        size = 20

    if not os.path.isdir(OUTPUT_DIR):
        return jsonify({"folders": [], "page": page, "size": size, "total": 0, "has_more": False})

    entries = []
    for name in os.listdir(OUTPUT_DIR):
        fp = os.path.join(OUTPUT_DIR, name)
        if os.path.isdir(fp):
            try:
                entries.append((os.path.getmtime(fp), name, fp))
            except OSError:
                continue
    entries.sort(reverse=True)

    total = len(entries)
    start = (page - 1) * size
    selected = entries[start:start + size]

    folders = []
    for mtime, name, fp in selected:
        try:
            files = sorted(f for f in os.listdir(fp) if f.lower().endswith(".png"))
        except OSError:
            files = []
        folders.append({
            "name": name,
            "path": fp,
            "screenshot_count": len(files),
            "files": files,
            "modified_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime)),
        })
    return jsonify({
        "folders": folders,
        "page": page,
        "size": size,
        "total": total,
        "has_more": start + len(selected) < total,
    })


@youtube_screenshots_bp.route("/youtube-screenshots/delete/<folder_name>", methods=["DELETE"])
def delete_extraction(folder_name: str):
    fp = _safe_folder_path(folder_name)
    if not fp:
        return jsonify({"success": False, "error": "Invalid folder name"}), 400
    if not os.path.isdir(fp):
        return jsonify({"success": False, "error": "Not found"}), 404
    shutil.rmtree(fp, ignore_errors=True)
    return jsonify({"success": True})


@youtube_screenshots_bp.route("/youtube-screenshots/download-zip/<folder_name>", methods=["GET"])
def download_extraction_zip(folder_name: str):
    fp = _safe_folder_path(folder_name)
    if not fp:
        return jsonify({"success": False, "error": "Invalid folder name"}), 400
    if not os.path.isdir(fp):
        return jsonify({"success": False, "error": "Not found"}), 404

    files = sorted(f for f in os.listdir(fp) if f.lower().endswith(".png"))
    if not files:
        return jsonify({"success": False, "error": "No screenshots in folder"}), 404

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for filename in files:
            path = os.path.join(fp, filename)
            if os.path.isfile(path):
                zf.write(path, arcname=filename)
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{folder_name}.zip",
    )


@youtube_screenshots_bp.route("/youtube-screenshots/file/<folder_name>/<filename>", methods=["GET"])
def serve_screenshot(folder_name: str, filename: str):
    from flask import send_from_directory

    safe_file = _safe_name(filename)
    fp = _safe_folder_path(folder_name)
    if not fp or not safe_file:
        return jsonify({"error": "Invalid path"}), 400
    if not os.path.isfile(os.path.join(fp, safe_file)):
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(fp, safe_file, mimetype="image/png")


def _sse_event(event_type: str, data: dict | None) -> str:
    return f"event: message\ndata: {json.dumps({'type': event_type, **(data or {})})}\n\n"


def _process_job(video_id: str, timestamps: list[float], operation_id: str, event_queue) -> None:
    import cv2
    import numpy as np
    import yt_dlp
    from yt_dlp.utils import DownloadError

    started_at = time.time()
    deadline = started_at + MAX_OPERATION_SECONDS
    watch_url = f"https://www.youtube.com/watch?v={video_id}"

    def is_cancelled() -> bool:
        return _op_is_cancelled(operation_id) or time.time() > deadline

    def emit(event_type: str, **kwargs) -> None:
        event_queue.put((event_type, kwargs))

    def assert_running() -> None:
        if is_cancelled():
            raise OperationCancelled()

    emit("progress", stage="download", message="Getting video stream...", percent=8)
    assert_running()

    temp_dir = tempfile.mkdtemp(prefix="textbro_yt_")
    video_path = ""
    title = f"YT_{video_id}"
    duration = 0.0

    try:
        def progress_hook(d):
            assert_running()
            if d.get("status") != "downloading":
                return
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            if total:
                pct = min(45, 12 + (downloaded / total) * 33)
                emit("progress", stage="download", message=f"Downloading video... {pct:.0f}%", percent=pct)

        ydl_opts = {
            "format": (
                "bestvideo[height<=1080][ext=mp4]/best[height<=1080][ext=mp4]/"
                "bestvideo[height<=1080]/best[height<=1080]/best"
            ),
            "outtmpl": os.path.join(temp_dir, "video.%(ext)s"),
            "quiet": True,
            "no_progress": True,
            "no_warnings": True,
            "progress_hooks": [progress_hook],
        }
        if os.path.isfile(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 100:
            ydl_opts["cookiefile"] = COOKIES_PATH

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(watch_url, download=True)
                title = info.get("title") or title
                duration = float(info.get("duration") or 0)
                video_path = ydl.prepare_filename(info)
        except DownloadError as exc:
            message = str(exc)
            if "sign in" in message.lower() or "cookies" in message.lower():
                raise Exception(
                    "YouTube requires sign-in for this download. Export YouTube cookies to "
                    "backend/config/cookies.txt, then try again."
                ) from exc
            raise Exception(f"yt-dlp could not download this video: {message}") from exc

        if not os.path.exists(video_path):
            candidates = [
                os.path.join(temp_dir, name)
                for name in os.listdir(temp_dir)
                if os.path.isfile(os.path.join(temp_dir, name))
            ]
            if candidates:
                video_path = max(candidates, key=os.path.getsize)

        if not video_path or not os.path.exists(video_path):
            raise Exception("Downloaded video file was not found.")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise Exception("OpenCV could not read the downloaded video stream.")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
        detected_duration = frame_count / fps if fps > 0 and frame_count > 0 else 0.0
        if detected_duration > 0:
            duration = detected_duration
        if duration <= 0:
            raise Exception("Could not determine video duration.")

        emit(
            "progress",
            stage="capture",
            message=f"Video: {title} ({_fmt_time(duration)})",
            percent=48,
            title=title,
            duration=duration,
        )

        valid_ts = [t for t in timestamps if t <= duration + 0.5]
        skipped = [t for t in timestamps if t > duration + 0.5]
        if not valid_ts:
            raise Exception(f"All timestamps are beyond the video length ({_fmt_time(duration)}).")

        screenshots = []
        total = len(valid_ts)
        for i, ts in enumerate(valid_ts):
            assert_running()
            emit(
                "progress",
                stage="capture",
                message=f"Capturing {i + 1}/{total} at {_fmt_time(ts)}...",
                percent=50 + (i / total) * 42,
            )

            frame = _read_frame_at(cap, ts, fps)
            if frame is None:
                continue
            if _is_blank_frame(frame, np):
                frame = _read_frame_at(cap, min(ts + 0.25, duration), fps)
            if frame is not None and not _is_blank_frame(frame, np):
                screenshots.append((ts, frame.copy()))

        cap.release()

        if not screenshots:
            raise Exception("No frames captured. Try different timestamps or add YouTube cookies.")

        emit("progress", stage="save", message="Saving screenshots...", percent=94)

        folder_name = _build_run_folder(title, video_id)
        run_output_dir = os.path.join(OUTPUT_DIR, folder_name)
        os.makedirs(run_output_dir, exist_ok=True)

        final_files = []
        for i, (ts, frame) in enumerate(screenshots):
            filename = _screenshot_filename(i + 1, ts)
            path = os.path.join(run_output_dir, filename)
            if _save_png_frame(cv2, frame, path):
                final_files.append(filename)

        if not final_files:
            raise Exception(
                f"Frames were captured but could not be saved to {run_output_dir}."
            )

        emit(
            "complete",
            stage="complete",
            message=f"Done! {len(final_files)} screenshots"
            + (f" ({len(skipped)} skipped beyond video length)" if skipped else ""),
            percent=100,
            folder=folder_name,
            files=final_files,
            screenshot_count=len(final_files),
            skipped=len(skipped),
            title=title,
            duration=duration,
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def capture_youtube_screenshots_to_batch(
    *,
    url: str,
    timestamps: list[float],
    output_dir: str,
    batch_id: str,
    quality: str = "1080p",
    progress=None,
    is_cancelled=None,
) -> dict:
    """Capture YouTube frames into the normal TextBro screenshot batch folder.

    Returns absolute and relative paths compatible with the existing
    screenshots-to-video export pipeline.
    """
    import cv2
    import numpy as np
    import yt_dlp
    from yt_dlp.utils import DownloadError

    video_id = _extract_video_id(url)
    if not video_id:
        raise ValueError("Could not extract video ID from URL")
    if not timestamps:
        raise ValueError("No timestamps provided")

    def emit(stage: str, pct: float, message: str, **data) -> None:
        if progress:
            progress(stage, pct, message, data or None)

    def assert_running() -> None:
        if is_cancelled and is_cancelled():
            raise OperationCancelled()

    height = {"720p": 720, "1080p": 1080, "best": 2160}.get(quality, 1080)
    watch_url = f"https://www.youtube.com/watch?v={video_id}"
    temp_dir = tempfile.mkdtemp(prefix="textbro_yt_")
    title = f"YT_{video_id}"
    duration = 0.0
    video_path = ""

    try:
        def progress_hook(d):
            assert_running()
            if d.get("status") != "downloading":
                return
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            if total:
                pct = min(45, 12 + (downloaded / total) * 33)
                emit("youtube_download", pct, f"Downloading YouTube video... {pct:.0f}%")

        ydl_opts = {
            "format": (
                f"bestvideo[height<={height}][vcodec^=avc1][ext=mp4]/"
                f"best[height<={height}][vcodec^=avc1][ext=mp4]/"
                f"bestvideo[height<={height}][ext=mp4]/best[height<={height}][ext=mp4]/"
                f"bestvideo[height<={height}]/best[height<={height}]/best"
            ),
            "outtmpl": os.path.join(temp_dir, "video.%(ext)s"),
            "quiet": True,
            "no_progress": True,
            "no_warnings": True,
            "progress_hooks": [progress_hook],
        }
        if os.path.isfile(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 100:
            ydl_opts["cookiefile"] = COOKIES_PATH

        emit("youtube_download", 8, "Getting YouTube video stream...")
        assert_running()
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(watch_url, download=True)
                title = info.get("title") or title
                duration = float(info.get("duration") or 0)
                video_path = ydl.prepare_filename(info)
        except DownloadError as exc:
            message = str(exc)
            if "sign in" in message.lower() or "cookies" in message.lower():
                raise Exception(
                    "YouTube requires sign-in for this download. Export YouTube cookies to "
                    "backend/config/cookies.txt, then try again."
                ) from exc
            raise Exception(f"yt-dlp could not download this video: {message}") from exc

        if not os.path.exists(video_path):
            candidates = [
                os.path.join(temp_dir, name)
                for name in os.listdir(temp_dir)
                if os.path.isfile(os.path.join(temp_dir, name))
            ]
            if candidates:
                video_path = max(candidates, key=os.path.getsize)
        if not video_path or not os.path.exists(video_path):
            raise Exception("Downloaded video file was not found.")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise Exception("OpenCV could not read the downloaded video stream.")
        try:
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
            detected_duration = frame_count / fps if fps > 0 and frame_count > 0 else 0.0
            if detected_duration > 0:
                duration = detected_duration
            if duration <= 0:
                raise Exception("Could not determine video duration.")

            valid_ts = [float(t) for t in timestamps if float(t) <= duration + 0.5]
            skipped = [float(t) for t in timestamps if float(t) > duration + 0.5]
            if not valid_ts:
                raise Exception(f"All timestamps are beyond the video length ({_fmt_time(duration)}).")

            batch_subdir = f"batch {batch_id}"
            batch_folder = os.path.join(output_dir, batch_subdir)
            os.makedirs(batch_folder, exist_ok=True)
            abs_paths: list[str] = []
            rel_names: list[str] = []
            total = len(valid_ts)

            emit("youtube_capture", 48, f"Video: {title} ({_fmt_time(duration)})", title=title, duration=duration)
            for index, ts in enumerate(valid_ts, start=1):
                assert_running()
                emit("youtube_capture", 50 + ((index - 1) / total) * 42, f"Capturing {index}/{total} at {_fmt_time(ts)}...")
                frame = _read_frame_at(cap, ts, fps)
                if frame is None:
                    continue
                if _is_blank_frame(frame, np):
                    frame = _read_frame_at(cap, min(ts + 0.25, duration), fps)
                if frame is None or _is_blank_frame(frame, np):
                    continue
                filename = f"{batch_id}({index:04d}).png"
                path = os.path.join(batch_folder, filename)
                if _save_png_frame(cv2, frame, path):
                    abs_paths.append(path.replace("\\", "/"))
                    rel_names.append(f"{batch_subdir}/{filename}".replace("\\", "/"))
            if not abs_paths:
                raise Exception("No frames captured. Try different timestamps or add YouTube cookies.")
            return {
                "video_id": video_id,
                "title": title,
                "duration": duration,
                "skipped": skipped,
                "abs_paths": abs_paths,
                "rel_names": rel_names,
                "batch_folder": batch_subdir,
            }
        finally:
            cap.release()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _read_frame_at(cap, seconds: float, fps: float):
    cap.set(0, max(0.0, seconds * 1000.0))
    ok, frame = cap.read()
    if ok and frame is not None:
        return frame

    frame_index = max(0, int(seconds * fps))
    cap.set(1, frame_index)
    ok, frame = cap.read()
    return frame if ok else None


def _save_png_frame(cv2, frame, path: str) -> bool:
    """Save a BGR OpenCV frame as PNG.

    cv2.imwrite can return False on Windows for perfectly valid Unicode paths.
    Encoding first and writing with Python's filesystem APIs avoids that.
    """
    try:
        ok, encoded = cv2.imencode(".png", frame, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        if not ok:
            return False
        with open(path, "wb") as f:
            f.write(encoded.tobytes())
        return os.path.getsize(path) > 0
    except Exception:
        return False


def _fmt_time(seconds: float) -> str:
    s = int(seconds)
    if s >= 3600:
        return f"{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}"
    return f"{s // 60}:{s % 60:02d}"


def _is_blank_frame(frame, np) -> bool:
    try:
        small = frame[:: max(1, frame.shape[0] // 32), :: max(1, frame.shape[1] // 32)]
        gray = (
            0.114 * small[:, :, 0].astype("float32")
            + 0.587 * small[:, :, 1].astype("float32")
            + 0.299 * small[:, :, 2].astype("float32")
        )
        return float(np.max(gray) - np.min(gray)) < 8.0
    except Exception:
        return False
