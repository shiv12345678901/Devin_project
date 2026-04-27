"""Phase-level resource gates for concurrent text-to-video runs."""
from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Iterator

from core.workflow_runner import WorkflowContext


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(1, value)


_AI = threading.BoundedSemaphore(_int_env("TEXTBRO_PIPELINE_AI_SLOTS", 2))
_COND = threading.Condition()
_screenshot_active = 0
_export_active = 0


@contextmanager
def ai_slot(ctx: WorkflowContext, enabled: bool) -> Iterator[None]:
    if not enabled:
        yield
        return
    while not _AI.acquire(timeout=2):
        ctx.check_cancelled()
        ctx.progress("ai_waiting", 3, "Waiting for AI generation slot")
    try:
        yield
    finally:
        _AI.release()


@contextmanager
def screenshot_slot(ctx: WorkflowContext, enabled: bool) -> Iterator[None]:
    global _screenshot_active
    if not enabled:
        yield
        return
    with _COND:
        while _screenshot_active > 0 or _export_active > 0:
            ctx.check_cancelled()
            if _export_active > 0:
                ctx.progress("screenshot_waiting", 32, "Waiting: video export in progress")
            else:
                ctx.progress("screenshot_waiting", 32, "Waiting for screenshot slot")
            _COND.wait(timeout=2)
        _screenshot_active += 1
    try:
        yield
    finally:
        with _COND:
            _screenshot_active = max(0, _screenshot_active - 1)
            _COND.notify_all()


@contextmanager
def export_slot(ctx: WorkflowContext, enabled: bool) -> Iterator[None]:
    global _export_active
    if not enabled:
        yield
        return
    with _COND:
        while _export_active > 0 or _screenshot_active > 0:
            ctx.check_cancelled()
            if _export_active > 0:
                ctx.progress("export_waiting", 87, "Waiting: another video export is in progress")
            else:
                ctx.progress("export_waiting", 87, "Waiting: screenshot capture in progress")
            _COND.wait(timeout=2)
        _export_active += 1
    try:
        yield
    finally:
        with _COND:
            _export_active = max(0, _export_active - 1)
            _COND.notify_all()

