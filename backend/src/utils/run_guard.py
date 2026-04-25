"""Process-wide concurrency / dedup guard for generation runs.

Why this exists
---------------
Two recurring user complaints justified adding a server-side guard:

1.  *"Sometimes 2 processes run, one is duplicate of another."* — the React
    UI already debounces the Submit button, but a hard refresh, a stuck
    SSE stream that hasn't been GC'd by the browser, or a script firing
    ``/generate-sse`` from two tabs all spawn a parallel run. Two parallel
    runs share the Playwright browser pool and the AI quota, double the
    wall-clock time, and produce overlapping batch folders.

2.  *"It is too slow — sometimes 10–15 min."* — once a stuck run is in
    flight, every retry submission piles on top of it because nothing on
    the backend serializes them. Fail-fast with HTTP 409 lets the UI tell
    the user "another run is already in progress" instead of silently
    queuing more load.

Design
------
* **Single-flight:** at most one generation runs at a time per process.
  ``begin_run()`` reserves the slot atomically; ``end_run()`` (idempotent)
  releases it.
* **Dedup window:** if the same fingerprint (route + body hash) arrives
  within ``DEDUP_WINDOW_SECS`` of an *accepted* run starting, the second
  request is rejected even if the first has completed. This catches
  double-submits caused by accidental form re-POSTs.
* **Stale-slot watchdog:** if a slot is held longer than
  ``MAX_RUN_SECS`` (default 30 min) it is auto-released. This is a safety
  net for crashes that don't run ``end_run`` (e.g. SIGKILL of a worker
  thread in a debugger). It is **not** a soft cap — the run continues; it
  just stops blocking new submissions.
"""
from __future__ import annotations

import hashlib
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional


DEDUP_WINDOW_SECS = float(os.environ.get("RUN_DEDUP_WINDOW_SECS", "5"))
MAX_RUN_SECS = float(os.environ.get("RUN_MAX_SECS", str(30 * 60)))


@dataclass
class _ActiveRun:
    operation_id: str
    fingerprint: str
    started_at: float


class RunRejected(Exception):
    """Raised when a new run is rejected because of an in-flight run.

    The HTTP layer translates this into a 409 Conflict response. ``reason``
    is one of ``"in_flight"`` or ``"duplicate"`` so the client can choose
    between "wait" and "retry without changes" UX.
    """

    def __init__(self, reason: str, message: str, operation_id: Optional[str] = None):
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.operation_id = operation_id


_lock = threading.Lock()
_active: Optional[_ActiveRun] = None
# Maps fingerprint -> wall-clock time when the matching run started. We
# keep at most a handful of entries (one per accepted run inside
# ``DEDUP_WINDOW_SECS``) so this never grows unbounded.
_recent: dict[str, float] = {}


def _gc_locked(now: float) -> None:
    """Drop dedup entries older than the window. Caller holds the lock."""
    cutoff = now - DEDUP_WINDOW_SECS
    stale = [fp for fp, ts in _recent.items() if ts < cutoff]
    for fp in stale:
        _recent.pop(fp, None)


def _force_release_if_stale_locked(now: float) -> None:
    """Auto-release a slot held longer than ``MAX_RUN_SECS``."""
    global _active
    if _active is not None and (now - _active.started_at) > MAX_RUN_SECS:
        _active = None


def fingerprint(route: str, payload: object) -> str:
    """Stable hash of ``(route, payload)``. Used for dedup window matching."""
    raw = f"{route}|{repr(payload)}".encode("utf-8", errors="replace")
    return hashlib.sha256(raw).hexdigest()[:32]


def begin_run(operation_id: str, route: str, payload: object) -> _ActiveRun:
    """Reserve the single-flight slot.

    Raises ``RunRejected`` if another run is already in flight or if the
    same payload was just submitted within the dedup window.
    """
    global _active
    fp = fingerprint(route, payload)
    now = time.time()
    with _lock:
        _gc_locked(now)
        _force_release_if_stale_locked(now)

        if _active is not None:
            raise RunRejected(
                reason="in_flight",
                message=(
                    f"Another generation is already running "
                    f"(operation_id={_active.operation_id}). "
                    "Cancel it first or wait for it to finish."
                ),
                operation_id=_active.operation_id,
            )

        recent_ts = _recent.get(fp)
        if recent_ts is not None and (now - recent_ts) < DEDUP_WINDOW_SECS:
            raise RunRejected(
                reason="duplicate",
                message=(
                    "Duplicate request — an identical submission was just "
                    f"accepted {now - recent_ts:.1f}s ago. Wait a moment "
                    "and try again if this was intentional."
                ),
            )

        run = _ActiveRun(operation_id=operation_id, fingerprint=fp, started_at=now)
        _active = run
        _recent[fp] = now
        return run


def end_run(operation_id: str) -> None:
    """Release the slot. Idempotent — safe to call from a ``finally`` block."""
    global _active
    with _lock:
        if _active is not None and _active.operation_id == operation_id:
            _active = None


def current_run() -> Optional[str]:
    """Return the operation_id of the in-flight run, if any."""
    with _lock:
        return _active.operation_id if _active is not None else None
