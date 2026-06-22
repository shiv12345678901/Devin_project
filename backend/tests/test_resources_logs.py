import sys
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from routes.resources import resources_bp  # noqa: E402
from utils import run_logger  # noqa: E402


def create_app():
    app = Flask(__name__)
    app.register_blueprint(resources_bp)
    return app


def test_log_tail_returns_last_requested_lines(tmp_path, monkeypatch):
    log_path = tmp_path / "op-1.log"
    log_path.write_text("\n".join(f"line {i}" for i in range(1, 8)), encoding="utf-8")
    monkeypatch.setattr(run_logger, "run_log_path", lambda _operation_id: str(log_path))

    client = create_app().test_client()
    response = client.get("/logs/op-1?tail=3")

    assert response.status_code == 200
    data = response.get_json()
    assert data["operation_id"] == "op-1"
    assert data["returned_lines"] == 3
    assert data["total_lines"] == 7
    assert data["truncated"] is True
    assert data["lines"] == ["line 5", "line 6", "line 7"]


def test_log_tail_returns_404_when_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(run_logger, "run_log_path", lambda _operation_id: str(tmp_path / "missing.log"))

    client = create_app().test_client()
    response = client.get("/logs/op-missing")

    assert response.status_code == 404
    assert response.get_json()["error"] == "Log file not found"
