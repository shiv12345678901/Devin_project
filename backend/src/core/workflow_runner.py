"""Shared workflow event publishing and run lifecycle helpers."""
from __future__ import annotations

import queue
import threading
from typing import Any

from core import run_manager


_SUBSCRIBERS: dict[str, list[queue.Queue]] = {}
_LOCK = threading.RLock()


def publish_run_event(run_id: str, event: dict[str, Any]) -> None:
    payload = dict(event)
    payload.setdefault("run_id", run_id)
    with _LOCK:
        subscribers = list(_SUBSCRIBERS.get(run_id, []))
    for subscriber in subscribers:
        subscriber.put(payload)


def subscribe_run(run_id: str, replay: bool = True) -> queue.Queue:
    subscriber: queue.Queue = queue.Queue()
    with _LOCK:
        _SUBSCRIBERS.setdefault(run_id, []).append(subscriber)

    if replay:
        run = run_manager.get_run(run_id)
        if run:
            status = str(run.get("status") or "queued")
            if status == "completed":
                subscriber.put({
                    "type": "complete",
                    "run_id": run_id,
                    "operation_id": run.get("operation_id") or run_id,
                    "message": run.get("message") or "Process completed",
                    "data": {"success": True, **(run.get("outputs") or {})},
                })
                return subscriber
            if status == "failed":
                subscriber.put({
                    "type": "error",
                    "run_id": run_id,
                    "operation_id": run.get("operation_id") or run_id,
                    "message": run.get("message") or "Process failed",
                })
                return subscriber
            if status == "cancelled":
                subscriber.put({
                    "type": "cancelled",
                    "run_id": run_id,
                    "operation_id": run.get("operation_id") or run_id,
                    "message": run.get("message") or "Operation cancelled",
                })
                return subscriber
            subscriber.put({
                "type": "started" if run.get("status") == "running" else str(run.get("status") or "queued"),
                "run_id": run_id,
                "operation_id": run.get("operation_id") or run_id,
                "stage": run.get("stage"),
                "progress": run.get("progress", 0),
                "message": run.get("message") or "Process queued",
                "queue_position": run.get("queue_position"),
            })
    return subscriber


def unsubscribe_run(run_id: str, subscriber: queue.Queue) -> None:
    with _LOCK:
        subscribers = _SUBSCRIBERS.get(run_id)
        if not subscribers:
            return
        try:
            subscribers.remove(subscriber)
        except ValueError:
            return
        if not subscribers:
            _SUBSCRIBERS.pop(run_id, None)


class WorkflowCancelled(Exception):
    """Raised when the workflow cancel event is set."""


class WorkflowContext:
    """Convenience wrapper used by queued workflow jobs."""

    def __init__(self, run_id: str, operation_id: str, cancel_event: threading.Event):
        self.run_id = run_id
        self.operation_id = operation_id
        self.cancel_event = cancel_event

    def emit(self, event: dict[str, Any]) -> None:
        event.setdefault("run_id", self.run_id)
        event.setdefault("operation_id", self.operation_id)
        publish_run_event(self.run_id, event)

    def started(self, message: str = "Process started") -> None:
        run_manager.update_run(self.run_id, status="running", stage="running", message=message, progress=0)
        run_manager.add_event(self.run_id, event_type="started", stage="running", progress=0, message=message)
        self.emit({"type": "started", "message": message, "progress": 0})

    def progress(self, stage: str, progress: int, message: str, data: dict[str, Any] | None = None) -> None:
        run_manager.add_event(
            self.run_id,
            event_type="progress",
            stage=stage,
            progress=progress,
            message=message,
            data=data or {},
        )
        print(f"[{self.operation_id}] {stage} {progress}% - {message}", flush=True)
        self.emit({
            "type": "progress",
            "stage": stage,
            "progress": progress,
            "message": message,
            **(data or {}),
        })

    def output(self, key: str, value: Any) -> None:
        run_manager.attach_output(self.run_id, key, value)

    def metrics(self, values: dict[str, Any]) -> None:
        run_manager.update_metrics(self.run_id, values)

    def complete(
        self,
        message: str,
        outputs: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
    ) -> None:
        run_manager.finish_run(
            self.run_id,
            status="completed",
            message=message,
            progress=100,
            outputs=outputs,
            metrics=metrics,
        )
        self.emit({
            "type": "complete",
            "message": message,
            "data": {"success": True, "message": message, **(outputs or {})},
        })

    def fail(self, message: str, progress: int | None = None) -> None:
        run_manager.finish_run(self.run_id, status="failed", message=message, progress=progress)
        self.emit({"type": "error", "message": message})

    def cancel(self, message: str = "Operation cancelled", outputs: dict[str, Any] | None = None) -> None:
        run_manager.finish_run(self.run_id, status="cancelled", message=message, progress=0, outputs=outputs)
        self.emit({"type": "cancelled", "message": message})

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise WorkflowCancelled("Operation cancelled")
