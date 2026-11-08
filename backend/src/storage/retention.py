"""Bound generated artifacts on small Linux VMs."""
from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

from .database import database
from ..settings import PROJECT_DIR, settings

logger = logging.getLogger("textbro.retention")
_OUTPUT_DIRS = ("html", "screenshots", "presentations", "videos", "logs", "cache")


def _active_paths(root: Path) -> set[Path]:
    protected: set[Path] = set()
    for run in database.list_runs(settings.retention.max_runs):
        if run.get("status") not in {"queued", "running", "paused"}:
            continue
        outputs = run.get("outputs") if isinstance(run.get("outputs"), dict) else {}
        for key, value in outputs.items():
            values = value if isinstance(value, list) else [value]
            for item in values:
                if isinstance(item, str):
                    candidate = Path(item)
                    if candidate.is_absolute():
                        protected.add(candidate.resolve())
                        continue
                    normalized = candidate.as_posix().lstrip("./")
                    if normalized.startswith("output/"):
                        protected.add((PROJECT_DIR / normalized).resolve())
                    elif "screenshot" in key:
                        protected.add((root / "screenshots" / candidate).resolve())
                    elif "html" in key:
                        protected.add((root / "html" / candidate).resolve())
                    elif "presentation" in key:
                        protected.add((root / "presentations" / candidate).resolve())
                    elif "video" in key:
                        protected.add((root / "videos" / candidate).resolve())
    return protected


def apply_artifact_retention(output_root: Path | None = None) -> dict[str, int | float]:
    """Delete expired/unreferenced outputs and restore the configured free-space floor."""
    policy = settings.retention
    if not policy.enabled:
        return {"files_deleted": 0, "bytes_reclaimed": 0, "enabled": 0}
    root = (output_root or (PROJECT_DIR / "output")).resolve()
    root.mkdir(parents=True, exist_ok=True)
    protected = _active_paths(root)
    candidates: list[tuple[float, Path, int]] = []
    cutoff = time.time() - policy.output_days * 86400
    for name in _OUTPUT_DIRS:
        folder = (root / name).resolve()
        if root not in folder.parents:
            continue
        if not folder.exists():
            continue
        for path in folder.rglob("*"):
            resolved = path.resolve()
            if not path.is_file() or any(item == resolved or item in resolved.parents for item in protected):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            candidates.append((stat.st_mtime, path, stat.st_size))

    deleted = 0
    reclaimed = 0
    free_floor = int(policy.min_free_disk_gb * 1024**3)
    for modified, path, size in sorted(candidates):
        under_pressure = shutil.disk_usage(root).free < free_floor
        if modified >= cutoff and not under_pressure:
            continue
        try:
            path.unlink()
            deleted += 1
            reclaimed += size
        except OSError:
            logger.warning("retention.delete_failed", extra={"path": str(path)})
    for name in _OUTPUT_DIRS:
        folder = root / name
        if folder.exists():
            for directory in sorted((p for p in folder.rglob("*") if p.is_dir()), reverse=True):
                try:
                    directory.rmdir()
                except OSError:
                    pass
    result = {"files_deleted": deleted, "bytes_reclaimed": reclaimed, "enabled": 1}
    logger.info("retention.completed", extra=result)
    return result

