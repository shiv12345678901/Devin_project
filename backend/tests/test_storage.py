from dataclasses import FrozenInstanceError

import pytest

from backend.src.settings import settings
from backend.src.storage.database import Database


def test_sqlite_round_trip_for_runs_history_and_cache(tmp_path):
    db = Database(tmp_path / "textbro.sqlite3")
    run = {
        "run_id": "run-1",
        "tool": "text-to-video",
        "status": "running",
        "created_at": 10.0,
        "updated_at": 10.0,
        "completed_at": None,
        "input_fingerprint": "abc",
        "events": [],
    }
    db.upsert_run(run)
    assert db.get_run("run-1")["tool"] == "text-to-video"
    assert db.list_runs(10)[0]["run_id"] == "run-1"

    db.add_history({"timestamp": 11.0, "tool": "text-to-video"})
    assert db.history()[0]["tool"] == "text-to-video"

    db.cache_set("cache-key", "<html />", 9)
    assert db.cache_get("cache-key", 60)["response"] == "<html />"
    db.cache_clear()
    assert db.cache_get("cache-key", 60) is None

    db.set_state("pending_client_queue", [{"id": "queue-1"}])
    assert db.get_state("pending_client_queue")[0]["id"] == "queue-1"


def test_settings_are_immutable():
    with pytest.raises((FrozenInstanceError, AttributeError)):
        settings.port = 9999

