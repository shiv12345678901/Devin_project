import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.core import run_manager


def test_write_json_falls_back_when_replace_is_locked(tmp_path, monkeypatch):
    path = tmp_path / "run.json"
    payload = {"run_id": "r1", "status": "running"}

    def locked_replace(_src, _dst):
        raise PermissionError("simulated Windows file lock")

    monkeypatch.setattr(run_manager.os, "replace", locked_replace)

    run_manager._write_json(path, payload)

    assert json.loads(path.read_text(encoding="utf-8")) == payload
    assert not path.with_suffix(".json.tmp").exists()
