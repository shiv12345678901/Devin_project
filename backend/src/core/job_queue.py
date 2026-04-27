"""Single-worker queue for long-running generation workflows."""
from __future__ import annotations

import threading
import traceback
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


_QUEUE: deque[QueuedJob] = deque()
_CURRENT: QueuedJob | None = None
_CONDITION = threading.Condition()
_STARTED = False


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
    global _CURRENT
    while True:
        with _CONDITION:
            while not _QUEUE:
                _CONDITION.wait()
            job = _QUEUE.popleft()
            _CURRENT = job
            _publish_queue_positions()

        ctx = WorkflowContext(job.run_id, job.operation_id, job.cancel_event)
        # Hold the global single-flight slot for the duration of the job.
        # Without this a queued text-to-video would happily run alongside a
        # `/generate-sse` (or `/generate-html`, `/image-to-screenshots-sse`)
        # request, doubling load on the Playwright pool / AI quota. The
        # route used here (`/job-queue`) and run_id payload guarantee a
        # unique fingerprint so we never trip the dedup window.
        slot_held = False
        try:
            try:
                begin_run(job.operation_id, "/job-queue", {"run_id": job.run_id})
                slot_held = True
            except RunRejected as rr:
                ctx.fail(f"Backend busy: {rr.message}")
                continue
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
            if slot_held:
                end_run(job.operation_id)
            with _CONDITION:
                _CURRENT = None
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
) -> int:
    _ensure_worker()
    with _CONDITION:
        _QUEUE.append(QueuedJob(run_id=run_id, operation_id=operation_id, fn=fn, cancel_event=cancel_event, label=label))
        position = len(_QUEUE)
        _publish_queue_positions()
        _CONDITION.notify()
        return position


def cancel_job(run_id: str) -> bool:
    with _CONDITION:
        for job in list(_QUEUE):
            if job.run_id == run_id or job.operation_id == run_id:
                job.cancel_event.set()
                _QUEUE.remove(job)
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

        if _CURRENT and (_CURRENT.run_id == run_id or _CURRENT.operation_id == run_id):
            _CURRENT.cancel_event.set()
            current_run = run_manager.get_run(_CURRENT.run_id) or {}
            run_manager.update_run(
                _CURRENT.run_id,
                status="running",
                stage="cancelling",
                message="Cancellation requested. Waiting for the running step to stop.",
                progress=None,
            )
            publish_run_event(_CURRENT.run_id, {
                "type": "progress",
                "run_id": _CURRENT.run_id,
                "operation_id": _CURRENT.operation_id,
                "message": "Cancellation requested",
                "stage": "cancelling",
                "progress": current_run.get("progress", 0),
            })
            return True

    return False


def get_queue_snapshot() -> dict:
    with _CONDITION:
        return {
            "running": {
                "run_id": _CURRENT.run_id,
                "operation_id": _CURRENT.operation_id,
                "label": _CURRENT.label,
            } if _CURRENT else None,
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
