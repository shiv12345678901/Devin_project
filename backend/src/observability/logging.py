"""JSON logging with request/run correlation for VM-friendly ingestion."""
from __future__ import annotations

import contextvars
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any


_context: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar("log_context", default={})


def log_context(**values: Any):
    return _context.set({**_context.get(), **{key: value for key, value in values.items() if value is not None}})


def reset_log_context(token) -> None:
    _context.reset(token)


class JsonFormatter(logging.Formatter):
    _standard = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            **_context.get(),
        }
        payload.update({key: value for key, value in record.__dict__.items() if key not in self._standard and not key.startswith("_")})
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

