"""Single-worker queue for long-running generation workflows."""
from __future__ import annotations

import threading
import traceback
import sys
from collections import deque
from dataclasses import dataclass
from typing import Callable

from core.ai_client import unregister_operation
from core import run_manager
from core.workflow_runner import WorkflowContext, publish_run_event
from utils.run_guard import RunRejected, begin_run, end_run


@dataclass
class QueuedJob:
    run_id: str
    operation_id: str
    fn: Callable[[WorkflowContext], None]
    cancel_event: threading.Event
    label: str = "workflow"
    pipeline_enabled: bool = False


_QUEUE: deque[QueuedJob] = deque()
_CURRENT: dict[str, QueuedJob] = {}
_CONDITION = threading.Condition()
_STARTED = False


def _prevent_sleep() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        ES_CONTINUOUS = 0x80000000
        ES_SYSTEM_REQUIRED = 0x00000001
        ES_DISPLAY_REQUIRED = 0x00000002
        ctypes.windll.kernel32.SetThreadExecutionState(
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
        )
        return True
    except Exception:
        return False


def _allow_sleep() -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ES_CONTINUOUS = 0x80000000
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
    except Exception:
        pass


def _queue_positions() -> dict[str, int]:
    return {job.run_id: index + 1 for index, job in enumerate(_QUEUE)}


def _publish_queue_positions() -> None:
    positions = _queue_positions()
    for job in list(_QUEUE):
        position = positions.get(job.run_id)
        message = f"Queued at position {position}" if position else "Queued"
        run_manager.update_run(
            job.run_id,
            status="queued",
            stage="queued",
            message=message,
            progress=0,
            queue_position=position,
        )
        run_manager.add_event(
            job.run_id,
            event_type="queued",
            stage="queued",
            progress=0,
            message=message,
            data={"queue_position": position},
        )
        publish_run_event(job.run_id, {
            "type": "queued",
            "run_id": job.run_id,
            "operation_id": job.operation_id,
            "message": message,
            "progress": 0,
            "queue_position": position,
        })


def _worker_loop() -> None:
    while True:
        with _CONDITION:
            while not _QUEUE:
                _CONDITION.wait()
            job = _QUEUE.popleft()
            _CURRENT[job.run_id] = job
            _publish_queue_positions()

        _run_job(job)


def _run_job(job: QueuedJob) -> None:
        ctx = WorkflowContext(job.run_id, job.operation_id, job.cancel_event)
        # In classic mode, hold the global single-flight slot for the
        # duration of the job. Pipeline mode deliberately releases that
        # coarse lock and lets the workflow's own phase locks protect
        # screenshots / PowerPoint while AI can overlap.
        slot_held = False
        sleep_guard = False
        try:
            sleep_guard = _prevent_sleep()
            if not job.pipeline_enabled:
                try:
                    begin_run(job.operation_id, "/job-queue", {"run_id": job.run_id})
                    slot_held = True
                except RunRejected as rr:
                    ctx.fail(f"Backend busy: {rr.message}")
                    return
            if job.cancel_event.is_set():
                ctx.cancel()
            else:
                ctx.started(f"{job.label} started")
                job.fn(ctx)
        except Exception as exc:
            traceback.print_exc()
            run = run_manager.get_run(job.run_id)
            if run and run.get("status") not in {"completed", "failed", "cancelled"}:
                ctx.fail(f"Error: {exc}")
        finally:
            if sleep_guard:
                _allow_sleep()
            if slot_held:
                end_run(job.operation_id)
            with _CONDITION:
                _CURRENT.pop(job.run_id, None)
                _publish_queue_positions()


def _ensure_worker() -> None:
    global _STARTED
    with _CONDITION:
        if _STARTED:
            return
        thread = threading.Thread(target=_worker_loop, daemon=True, name="workflow-job-queue")
        thread.start()
        _STARTED = True


def enqueue(
    run_id: str,
    operation_id: str,
    fn: Callable[[WorkflowContext], None],
    cancel_event: threading.Event,
    label: str = "workflow",
    pipeline_enabled: bool = False,
) -> int:
    job = QueuedJob(
        run_id=run_id,
        operation_id=operation_id,
        fn=fn,
        cancel_event=cancel_event,
        label=label,
        pipeline_enabled=pipeline_enabled,
    )
    _ensure_worker()
    with _CONDITION:
        if pipeline_enabled and not _QUEUE and not any(
            not current.pipeline_enabled for current in _CURRENT.values()
        ):
            _CURRENT[job.run_id] = job
            _publish_queue_positions()
            thread = threading.Thread(
                target=_run_job,
                args=(job,),
                daemon=True,
                name=f"workflow-{run_id}",
            )
            thread.start()
            return 1

        _QUEUE.append(job)
        position = len(_QUEUE)
        _publish_queue_positions()
        _CONDITION.notify()
        return position


_SOFT_CANCEL_STAGES = {
    "after_html": ("html_saved", "Cancellation requested. The process will stop after the HTML file is saved."),
    "after_screenshots": ("screenshots_done", "Cancellation requested. The process will stop after screenshots are captured."),
    "after_pptx": ("pptx_built", "Cancellation requested. The process will stop after the PowerPoint deck is saved."),
    "after_video": ("video_export_done", "Cancellation requested. The process will stop after the MP4 export finishes."),
}


def cancel_job(run_id: str, mode: str = "now", delete_outputs: bool = False) -> bool:
    mode = str(mode or "now").strip().lower()
    delete_outputs = bool(delete_outputs)
    with _CONDITION:
        for job in list(_QUEUE):
            if job.run_id == run_id or job.operation_id == run_id:
                job.cancel_event.set()
                _QUEUE.remove(job)
                run_manager.update_run(job.run_id, settings={"delete_outputs_on_cancel": delete_outputs})
                run_manager.finish_run(job.run_id, status="cancelled", message="Operation cancelled before start", progress=0)
                unregister_operation(job.operation_id)
                publish_run_event(job.run_id, {
                    "type": "cancelled",
                    "run_id": job.run_id,
                    "operation_id": job.operation_id,
                    "message": "Operation cancelled before start",
                })
                _publish_queue_positions()
                return True

        current = next(
            (job for job in _CURRENT.values() if job.run_id == run_id or job.operation_id == run_id),
            None,
        )
        if current:
            if mode in _SOFT_CANCEL_STAGES:
                stage, message = _SOFT_CANCEL_STAGES[mode]
                current_run = run_manager.get_run(current.run_id) or {}
                run_manager.update_run(
                    current.run_id,
                    status="running",
                    stage="cancelling",
                    message=message,
                    progress=None,
                    settings={
                        "cancel_after_stage": stage,
                        "delete_outputs_on_cancel": False,
                    },
                )
                publish_run_event(current.run_id, {
                    "type": "progress",
                    "run_id": current.run_id,
                    "operation_id": current.operation_id,
                    "message": message,
                    "stage": "cancelling",
                    "progress": current_run.get("progress", 0),
                })
                return True

            current.cancel_event.set()
            current_run = run_manager.get_run(current.run_id) or {}
            run_manager.update_run(
                current.run_id,
                status="running",
                stage="cancelling",
                message="Cancellation requested. Waiting for the running step to stop.",
                progress=None,
                settings={"delete_outputs_on_cancel": delete_outputs},
            )
            publish_run_event(current.run_id, {
                "type": "progress",
                "run_id": current.run_id,
                "operation_id": current.operation_id,
                "message": "Cancellation requested",
                "stage": "cancelling",
                "progress": current_run.get("progress", 0),
            })
            return True

    return False


def get_queue_snapshot() -> dict:
    with _CONDITION:
        running = list(_CURRENT.values())
        return {
            "running": {
                "run_id": running[0].run_id,
                "operation_id": running[0].operation_id,
                "label": running[0].label,
            } if running else None,
            "running_all": [
                {
                    "run_id": job.run_id,
                    "operation_id": job.operation_id,
                    "label": job.label,
                    "pipeline_enabled": job.pipeline_enabled,
                }
                for job in running
            ],
            "queued": [
                {
                    "run_id": job.run_id,
                    "operation_id": job.operation_id,
                    "label": job.label,
                    "position": index + 1,
                }
                for index, job in enumerate(_QUEUE)
            ],
        }
