"""Per-run logger that mirrors stdout to a tail-able log file.

Why
---
User feedback: *"now no any updates are shown in backend terminal too. So I
am too confused: is my process being done or not?"*

The Flask app already calls ``print(..., flush=True)`` at most key
checkpoints, but several issues conspire to hide that output:

1. Some prints in deeper modules don't pass ``flush=True``, so on Windows
   they sit in the block-buffered stdout pipe until the request finishes.
2. When the user runs the app under a terminal multiplexer / IDE that
   redirects stdout, line-buffering can drop to full-block buffering.
3. There's no per-run log file the user can ``tail -f`` from a separate
   terminal — every run's output is interleaved into the global stdout.

This module fixes all three by giving each operation a ``RunLogger`` that
writes timestamped lines both to ``sys.stdout`` (with explicit flush) and
to ``output/runs/<operation_id>.log``. The log file is stable across
restarts and survives even if the parent terminal is closed.
"""
from __future__ import annotations

import io
import os
import sys
import threading
import time
from contextlib import contextmanager
from typing import Optional


_RUN_LOG_DIR = os.environ.get("RUN_LOG_DIR") or os.path.join("output", "runs")


def _ensure_log_dir() -> str:
    os.makedirs(_RUN_LOG_DIR, exist_ok=True)
    return _RUN_LOG_DIR


def run_log_path(operation_id: str) -> str:
    """Return the canonical log path for ``operation_id``."""
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in operation_id)[:120]
    return os.path.join(_ensure_log_dir(), f"{safe or 'unnamed'}.log")


class RunLogger:
    """Tee writer for a single generation run.

    Thread-safe — all writes go through an internal lock so interleaved
    Playwright callbacks don't corrupt log lines.

    Usage::

        log = RunLogger(operation_id)
        log.info("Starting AI request")
        log.section("AI verification")
        log.close()

    Or as a context manager::

        with RunLogger(operation_id) as log:
            log.info("Step 1 done")
    """

    def __init__(self, operation_id: str, stdout: Optional[io.IOBase] = None):
        self.operation_id = operation_id
        self._lock = threading.Lock()
        self._stdout = stdout if stdout is not None else sys.stdout
        self._path = run_log_path(operation_id)
        self._closed = False
        try:
            self._fp = open(self._path, "a", encoding="utf-8", buffering=1)  # line-buffered
        except OSError as e:
            # If we can't open the log file, fall back to stdout-only.
            self._fp = None
            print(
                f"⚠️ RunLogger: failed to open {self._path}: {e}",
                file=self._stdout,
                flush=True,
            )

    @property
    def path(self) -> str:
        return self._path

    def _line(self, level: str, message: str) -> str:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        return f"[{ts}] [{level:<5}] [{self.operation_id}] {message}"

    def _emit(self, level: str, message: str) -> None:
        line = self._line(level, message)
        with self._lock:
            if self._closed:
                return
            try:
                print(line, file=self._stdout, flush=True)
            except Exception:  # pragma: no cover — never let logging break a run
                pass
            if self._fp is not None:
                try:
                    self._fp.write(line + "\n")
                    self._fp.flush()
                except Exception:
                    pass

    def info(self, message: str) -> None:
        self._emit("INFO", message)

    def warn(self, message: str) -> None:
        self._emit("WARN", message)

    def error(self, message: str) -> None:
        self._emit("ERROR", message)

    def section(self, title: str) -> None:
        bar = "─" * 60
        self._emit("INFO", bar)
        self._emit("INFO", title)
        self._emit("INFO", bar)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if self._fp is not None:
                try:
                    self._fp.flush()
                    self._fp.close()
                except Exception:
                    pass

    def __enter__(self) -> "RunLogger":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


@contextmanager
def run_logger(operation_id: str):
    """Convenience context manager — ``with run_logger(op_id) as log:``."""
    log = RunLogger(operation_id)
    try:
        yield log
    finally:
        log.close()
