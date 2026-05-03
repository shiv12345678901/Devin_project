"""Persistent run tracking for backend-owned generation jobs."""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any


RUNS_DIR = Path("output") / "runs"
INDEX_PATH = RUNS_DIR / "index.json"
_LOCK = threading.RLock()
_ROOT_DIR = Path.cwd().resolve()


def _now() -> float:
    return time.time()


def _ensure_dir() -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def _run_path(run_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(run_id))
    return RUNS_DIR / f"{safe}.json"


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    _ensure_dir()
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _normalize_path_string(value: str) -> str:
    normalized = value.replace("\\", "/")
    try:
        path = Path(normalized)
        if path.is_absolute():
            resolved = path.resolve()
            try:
                return resolved.relative_to(_ROOT_DIR).as_posix()
            except ValueError:
                return resolved.as_posix()
    except Exception:
        pass
    return normalized


def _normalize_output_value(value: Any) -> Any:
    if isinstance(value, str):
        return _normalize_path_string(value)
    if isinstance(value, list):
        return [_normalize_output_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_output_value(item) for key, item in value.items()}
    return value


def _normalize_outputs(outputs: dict[str, Any] | None) -> dict[str, Any]:
    if not outputs:
        return {}
    return {key: _normalize_output_value(value) for key, value in outputs.items()}


def _load_index() -> list[dict[str, Any]]:
    index = _read_json(INDEX_PATH, [])
    return index if isinstance(index, list) else []


def _save_index(index: list[dict[str, Any]]) -> None:
    _write_json(INDEX_PATH, index[:500])


def _summarize(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": run.get("run_id"),
        "operation_id": run.get("operation_id"),
        "tool": run.get("tool"),
        "title": run.get("title"),
        "status": run.get("status"),
        "progress": run.get("progress", 0),
        "stage": run.get("stage"),
        "message": run.get("message"),
        "model_choice": run.get("model_choice"),
        "input_preview": run.get("input_preview"),
        "input_length": run.get("input_length"),
        "input_fingerprint": run.get("input_fingerprint"),
        "created_at": run.get("created_at") or run.get("started_at"),
        "queued_at": run.get("queued_at"),
        "started_at": run.get("started_at"),
        "updated_at": run.get("updated_at"),
        "completed_at": run.get("completed_at"),
        "duration_seconds": run.get("duration_seconds"),
        "queued_seconds": run.get("queued_seconds"),
        "queue_position": run.get("queue_position"),
        "outputs": _normalize_outputs(run.get("outputs", {})),
        "metrics": run.get("metrics", {}),
    }


def _upsert_index_summary(run: dict[str, Any]) -> None:
    summary = _summarize(run)
    index = [item for item in _load_index() if item.get("run_id") != run.get("run_id")]
    index.insert(0, summary)
    index.sort(
        key=lambda item: item.get("created_at")
        or item.get("started_at")
        or item.get("queued_at")
        or 0,
        reverse=True,
    )
    _save_index(index)


def create_run(
    *,
    tool: str,
    title: str,
    input_text: str,
    settings: dict[str, Any] | None = None,
    model_choice: str | None = None,
    operation_id: str | None = None,
    run_id: str | None = None,
    status: str = "running",
    input_fingerprint: str | None = None,
) -> dict[str, Any]:
    with _LOCK:
        created_at = _now()
        run_id = run_id or operation_id or f"run_{int(created_at * 1000)}"
        run = {
            "run_id": run_id,
            "operation_id": operation_id,
            "tool": tool,
            "title": title,
            "status": status,
            "progress": 0,
            "stage": "queued" if status == "queued" else "created",
            "message": "Process queued" if status == "queued" else "Process created",
            "model_choice": model_choice,
            "input": input_text,
            "input_preview": input_text[:240],
            "input_length": len(input_text),
            "input_fingerprint": input_fingerprint,
            "settings": settings or {},
            "outputs": {},
            "metrics": {},
            "events": [],
            "created_at": created_at,
            "queued_at": created_at if status == "queued" else None,
            "started_at": created_at if status == "running" else None,
            "updated_at": created_at,
            "completed_at": None,
            "duration_seconds": None,
            "queued_seconds": None,
            "queue_position": None,
        }
        run["events"].append({
            "time": created_at,
            "type": "created",
            "stage": run["stage"],
            "progress": 0,
            "message": run["message"],
        })
        _write_json(_run_path(run_id), run)
        _upsert_index_summary(run)
        return run


def update_run(
    run_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    message: str | None = None,
    progress: int | None = None,
    settings: dict[str, Any] | None = None,
    outputs: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
    queue_position: int | None = None,
) -> dict[str, Any] | None:
    with _LOCK:
        run = _read_json(_run_path(run_id), None)
        if not isinstance(run, dict):
            return None
        ts = _now()
        if status is not None:
            run["status"] = status
        if stage is not None:
            run["stage"] = stage
        if message is not None:
            run["message"] = message
        if progress is not None:
            run["progress"] = max(0, min(100, int(progress)))
        if settings:
            run.setdefault("settings", {}).update(settings)
        if outputs:
            run.setdefault("outputs", {}).update(_normalize_outputs(outputs))
        if metrics:
            run.setdefault("metrics", {}).update(metrics)
        if queue_position is not None:
            run["queue_position"] = queue_position
        if status is not None and status != "queued":
            run["queue_position"] = None
        if status == "running":
            if not run.get("started_at"):
                run["started_at"] = ts
            if run.get("queued_at"):
                try:
                    run["queued_seconds"] = round(float(run["started_at"]) - float(run["queued_at"]), 2)
                except Exception:
                    pass
        run["updated_at"] = ts
        _write_json(_run_path(run_id), run)
        _upsert_index_summary(run)
        return run


def add_event(
    run_id: str,
    *,
    event_type: str,
    message: str,
    stage: str | None = None,
    progress: int | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    with _LOCK:
        run = _read_json(_run_path(run_id), None)
        if not isinstance(run, dict):
            return None
        ts = _now()
        event = {
            "time": ts,
            "type": event_type,
            "stage": stage,
            "progress": progress,
            "message": message,
            "data": data or {},
        }
        run.setdefault("events", []).append(event)
        if stage is not None:
            run["stage"] = stage
        if progress is not None:
            run["progress"] = max(0, min(100, int(progress)))
        run["message"] = message
        run["updated_at"] = ts
        _write_json(_run_path(run_id), run)
        _upsert_index_summary(run)
        return run


def attach_output(run_id: str, key: str, value: Any) -> None:
    update_run(run_id, outputs={key: value})


def update_metrics(run_id: str, values: dict[str, Any]) -> None:
    update_run(run_id, metrics=values)


def finish_run(
    run_id: str,
    *,
    status: str,
    message: str,
    progress: int | None = 100,
    outputs: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    with _LOCK:
        run = _read_json(_run_path(run_id), None)
        if not isinstance(run, dict):
            return None
        ts = _now()
        run["status"] = status
        run["message"] = message
        run["stage"] = status
        if progress is not None:
            run["progress"] = max(0, min(100, int(progress)))
        run["completed_at"] = ts
        run["updated_at"] = ts
        if run.get("started_at"):
            try:
                run["duration_seconds"] = round(ts - float(run["started_at"]), 2)
            except Exception:
                pass
        if outputs:
            run.setdefault("outputs", {}).update(_normalize_outputs(outputs))
        if metrics:
            run.setdefault("metrics", {}).update(metrics)
        run.setdefault("events", []).append({
            "time": ts,
            "type": status,
            "stage": status,
            "progress": run.get("progress"),
            "message": message,
        })
        _write_json(_run_path(run_id), run)
        _upsert_index_summary(run)
        return run


def get_run(run_id: str, include_input: bool = False) -> dict[str, Any] | None:
    with _LOCK:
        run = _read_json(_run_path(run_id), None)
        if not isinstance(run, dict):
            return None
        run = dict(run)
        if not include_input:
            run.pop("input", None)
        run["outputs"] = _normalize_outputs(run.get("outputs"))
        return run


def list_runs(limit: int = 100) -> list[dict[str, Any]]:
    with _LOCK:
        return [dict(item) for item in _load_index()[:limit] if isinstance(item, dict)]


def _recovered_outputs_for_interrupted_run(run: dict[str, Any]) -> dict[str, Any] | None:
    """Detect outputs already on disk for a run that was interrupted at restart.

    When the backend is restarted while a generation is queued/running, the
    run's status is still queued/running in the index even though the
    workflow's MP4 / PPTX may already be fully written to disk. Mark such
    runs as ``completed`` instead of ``failed`` so the user isn't told the
    run failed when they actually have a working video.

    Returns a dict of output keys (matching the keys ``ctx.complete()`` would
    have written) when the canonical output for the run's tool exists on
    disk with a non-trivial size and a modification time after the run
    started. Returns ``None`` otherwise (caller falls back to the failed
    "interrupted by app restart" behavior).
    """
    if not isinstance(run, dict):
        return None
    tool = str(run.get("tool") or "")
    settings = run.get("settings") or {}
    if not isinstance(settings, dict):
        settings = {}
    input_text = str(run.get("input") or "")
    output_format = str(settings.get("output_format") or "").lower()

    # Lazy imports — ``run_manager`` lives in ``backend/src/core`` and the
    # canonical-stem helper lives under ``backend/routes``. Importing at
    # module load would create a cycle.
    try:
        import sys as _sys
        _here = Path(__file__).resolve()
        _backend = _here.parents[2]
        for _path in (_backend, _backend / "routes", _backend / "config"):
            if str(_path) not in _sys.path:
                _sys.path.insert(0, str(_path))
        from helpers import youtube_video_stem  # type: ignore
        try:
            from config import (  # type: ignore
                POWERPOINT_OUTPUT_FOLDER,
                POWERPOINT_VIDEO_FOLDER,
            )
        except Exception:
            POWERPOINT_OUTPUT_FOLDER = "output/presentations"
            POWERPOINT_VIDEO_FOLDER = "output/videos"
    except Exception:
        return None

    project_info = {
        "class_name": settings.get("class_name") or "",
        "subject": settings.get("subject") or "",
        "title": settings.get("title") or "",
        "exercise_year": settings.get("exercise_year") or "",
    }
    output_name = str(settings.get("output_name") or settings.get("title") or "")
    try:
        stem = youtube_video_stem(project_info, output_name, input_text)
    except Exception:
        return None

    started_at = 0.0
    for key in ("started_at", "queued_at", "created_at"):
        try:
            value = float(run.get(key) or 0)
        except (TypeError, ValueError):
            value = 0.0
        if value:
            started_at = value
            break

    def _check(rel: str, min_size: int) -> bool:
        path = Path(rel)
        if not path.is_absolute():
            path = Path.cwd() / path
        try:
            stat = path.stat()
        except OSError:
            return False
        if stat.st_size < min_size:
            return False
        # Guard against marking a run as completed because of a stale file
        # left over from a *previous* run that wrote the same canonical
        # path. Require the file to have been touched at or after this
        # run's start (with a small clock skew margin).
        if started_at and stat.st_mtime + 5 < started_at:
            return False
        return True

    is_video_tool = (
        tool in {"text-to-video", "html-to-video", "screenshots-to-video", "image-to-video"}
        or output_format == "video"
    )
    is_pptx_tool = (
        tool in {"text-to-pptx", "html-to-pptx"}
        or output_format == "pptx"
    )

    outputs: dict[str, Any] = {}
    if is_video_tool:
        video_rel = f"{POWERPOINT_VIDEO_FOLDER}/{stem}.mp4"
        if _check(video_rel, 100_000):
            outputs["video_file"] = video_rel
            outputs["video_path"] = video_rel
            pptx_rel = f"{POWERPOINT_OUTPUT_FOLDER}/{stem}.pptx"
            if _check(pptx_rel, 10_000):
                outputs["presentation_file"] = pptx_rel
                outputs["presentation_path"] = pptx_rel
    elif is_pptx_tool:
        pptx_rel = f"{POWERPOINT_OUTPUT_FOLDER}/{stem}.pptx"
        if _check(pptx_rel, 10_000):
            outputs["presentation_file"] = pptx_rel
            outputs["presentation_path"] = pptx_rel

    return outputs or None


def mark_interrupted_active_runs() -> dict[str, int]:
    """Reconcile queued/running/paused runs with what's actually on disk.

    Called once on app startup. Runs whose canonical video/pptx output
    already exists on disk are marked ``completed`` (the workflow ran to
    completion, the user just didn't see it because the app restarted
    before the run JSON reached the ``completed`` state). Everything else
    is marked ``failed`` with the legacy "interrupted" message.
    """
    with _LOCK:
        interrupted = 0
        recovered = 0
        for item in list(_load_index()):
            if str(item.get("status") or "").lower() not in {"queued", "running", "paused"}:
                continue
            run_id = str(item.get("run_id") or "")
            if not run_id:
                continue
            full_run = _read_json(_run_path(run_id), None)
            recovered_outputs = (
                _recovered_outputs_for_interrupted_run(full_run)
                if isinstance(full_run, dict)
                else None
            )
            if recovered_outputs:
                finish_run(
                    run_id,
                    status="completed",
                    message="Recovered after app restart — output was already written to disk.",
                    progress=100,
                    outputs=recovered_outputs,
                )
                recovered += 1
            else:
                finish_run(
                    run_id,
                    status="failed",
                    message="Interrupted by app restart before the queue could finish.",
                    progress=item.get("progress"),
                )
                interrupted += 1
        return {"interrupted": interrupted, "recovered": recovered}


def find_active_run_by_fingerprint(
    tool: str,
    input_fingerprint: str,
    statuses: set[str] | None = None,
) -> dict[str, Any] | None:
    statuses = statuses or {"queued", "running", "paused"}
    with _LOCK:
        for item in _load_index():
            if item.get("tool") != tool:
                continue
            if item.get("status") not in statuses:
                continue
            if item.get("input_fingerprint") == input_fingerprint:
                return item
        return None


def find_recent_run_by_fingerprint(
    tool: str,
    input_fingerprint: str,
    within_seconds: float,
) -> dict[str, Any] | None:
    """Return a recently-finished run with a matching fingerprint, if any.

    Used as defense-in-depth against the client dispatching the same payload
    twice in quick succession. ``find_active_run_by_fingerprint`` already
    blocks simultaneous duplicates; this catches the narrower race where
    the client fires a second identical submission within ``within_seconds``
    of the first completing. Only ``completed`` runs are considered — a
    recently failed/cancelled run should always be allowed to retry.
    """
    if within_seconds <= 0:
        return None
    now = time.time()
    with _LOCK:
        for item in _load_index():
            if item.get("tool") != tool:
                continue
            if item.get("status") != "completed":
                continue
            if item.get("input_fingerprint") != input_fingerprint:
                continue
            finished_at = item.get("completed_at") or item.get("updated_at") or 0
            try:
                finished_at = float(finished_at)
            except (TypeError, ValueError):
                continue
            if finished_at <= 0:
                continue
            if now - finished_at <= within_seconds:
                return item
        return None
