"""Small SQLite repository shared by runs, history, and AI cache."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from ..settings import settings


class Database:
    def __init__(self, path: Path | None = None):
        self.path = path or settings.database_path
        self._lock = threading.RLock()
        self._initialized = False

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
            with self.connect() as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.execute("PRAGMA synchronous=NORMAL")
                db.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS runs (
                      run_id TEXT PRIMARY KEY,
                      tool TEXT NOT NULL,
                      status TEXT NOT NULL,
                      created_at REAL NOT NULL,
                      updated_at REAL NOT NULL,
                      completed_at REAL,
                      input_fingerprint TEXT,
                      payload_json TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_runs_updated ON runs(updated_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_runs_fingerprint ON runs(tool, input_fingerprint, status);
                    CREATE TABLE IF NOT EXISTS history (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      created_at REAL NOT NULL,
                      payload_json TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
                    CREATE TABLE IF NOT EXISTS ai_cache (
                      cache_key TEXT PRIMARY KEY,
                      created_at REAL NOT NULL,
                      last_accessed REAL NOT NULL,
                      text_length INTEGER NOT NULL DEFAULT 0,
                      response TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_cache_accessed ON ai_cache(last_accessed);
                    CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at REAL NOT NULL);
                    CREATE TABLE IF NOT EXISTS app_state (
                      state_key TEXT PRIMARY KEY,
                      updated_at REAL NOT NULL,
                      payload_json TEXT NOT NULL
                    );
                    """
                )
            self._initialized = True

    def upsert_run(self, run: dict[str, Any]) -> None:
        self.initialize()
        with self.connect() as db:
            db.execute(
                """INSERT INTO runs(run_id, tool, status, created_at, updated_at, completed_at, input_fingerprint, payload_json)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(run_id) DO UPDATE SET tool=excluded.tool, status=excluded.status,
                   updated_at=excluded.updated_at, completed_at=excluded.completed_at,
                   input_fingerprint=excluded.input_fingerprint, payload_json=excluded.payload_json""",
                (run["run_id"], run.get("tool", "unknown"), run.get("status", "unknown"),
                 float(run.get("created_at") or time.time()), float(run.get("updated_at") or time.time()),
                 run.get("completed_at"), run.get("input_fingerprint"), json.dumps(run, ensure_ascii=False)),
            )

    def migration_applied(self, name: str) -> bool:
        self.initialize()
        with self.connect() as db:
            return db.execute("SELECT 1 FROM migrations WHERE name=?", (name,)).fetchone() is not None

    def mark_migration(self, name: str) -> None:
        self.initialize()
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO migrations(name, applied_at) VALUES(?, ?)", (name, time.time()))

    def get_state(self, key: str, default: Any = None) -> Any:
        self.initialize()
        with self.connect() as db:
            row = db.execute("SELECT payload_json FROM app_state WHERE state_key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_state(self, key: str, payload: Any) -> None:
        self.initialize()
        with self.connect() as db:
            db.execute("""INSERT INTO app_state(state_key, updated_at, payload_json) VALUES(?, ?, ?)
                          ON CONFLICT(state_key) DO UPDATE SET updated_at=excluded.updated_at,
                          payload_json=excluded.payload_json""",
                       (key, time.time(), json.dumps(payload, ensure_ascii=False)))

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        self.initialize()
        with self.connect() as db:
            row = db.execute("SELECT payload_json FROM runs WHERE run_id=?", (run_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list_runs(self, limit: int = 100) -> list[dict[str, Any]]:
        self.initialize()
        with self.connect() as db:
            rows = db.execute("SELECT payload_json FROM runs ORDER BY created_at DESC LIMIT ?", (max(1, limit),)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def add_history(self, payload: dict[str, Any]) -> None:
        self.initialize()
        created = float(payload.get("timestamp") or time.time())
        with self.connect() as db:
            db.execute("INSERT INTO history(created_at, payload_json) VALUES(?, ?)", (created, json.dumps(payload, ensure_ascii=False)))

    def history(self, limit: int = 500) -> list[dict[str, Any]]:
        self.initialize()
        with self.connect() as db:
            rows = db.execute("SELECT payload_json FROM (SELECT payload_json, created_at FROM history ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC", (max(1, limit),)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def clear_history(self) -> None:
        self.initialize()
        with self.connect() as db:
            db.execute("DELETE FROM history")

    def cache_get(self, key: str, ttl_seconds: float) -> dict[str, Any] | None:
        self.initialize()
        now = time.time()
        with self.connect() as db:
            row = db.execute("SELECT * FROM ai_cache WHERE cache_key=?", (key,)).fetchone()
            if not row:
                return None
            if now - float(row["created_at"]) > ttl_seconds:
                db.execute("DELETE FROM ai_cache WHERE cache_key=?", (key,))
                return None
            db.execute("UPDATE ai_cache SET last_accessed=? WHERE cache_key=?", (now, key))
        return dict(row)

    def cache_set(self, key: str, response: str, text_length: int) -> None:
        self.initialize()
        now = time.time()
        with self.connect() as db:
            db.execute("""INSERT INTO ai_cache(cache_key, created_at, last_accessed, text_length, response)
                          VALUES(?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET
                          created_at=excluded.created_at, last_accessed=excluded.last_accessed,
                          text_length=excluded.text_length, response=excluded.response""",
                       (key, now, now, text_length, response))

    def cache_clear(self) -> None:
        self.initialize()
        with self.connect() as db:
            db.execute("DELETE FROM ai_cache")

    def cache_stats(self, ttl_seconds: float) -> dict[str, int]:
        self.initialize()
        cutoff = time.time() - ttl_seconds
        with self.connect() as db:
            total = int(db.execute("SELECT COUNT(*) FROM ai_cache").fetchone()[0])
            expired = int(db.execute("SELECT COUNT(*) FROM ai_cache WHERE created_at < ?", (cutoff,)).fetchone()[0])
        return {"total": total, "expired": expired}

    def apply_retention(self) -> dict[str, int]:
        """Bound metadata growth for a small VM; active runs are never removed."""
        self.initialize()
        now = time.time()
        policy = settings.retention
        deleted = {"runs": 0, "history": 0, "cache": 0}
        with self.connect() as db:
            before = db.total_changes
            db.execute("DELETE FROM runs WHERE status IN ('completed','failed','cancelled') AND updated_at < ?", (now - policy.run_days * 86400,))
            db.execute("""DELETE FROM runs WHERE run_id IN (SELECT run_id FROM runs WHERE status IN ('completed','failed','cancelled')
                        ORDER BY updated_at DESC LIMIT -1 OFFSET ?)""", (policy.max_runs,))
            deleted["runs"] = db.total_changes - before
            before = db.total_changes
            db.execute("DELETE FROM history WHERE created_at < ?", (now - policy.history_days * 86400,))
            db.execute("DELETE FROM history WHERE id IN (SELECT id FROM history ORDER BY created_at DESC LIMIT -1 OFFSET ?)", (policy.max_history,))
            deleted["history"] = db.total_changes - before
            before = db.total_changes
            db.execute("DELETE FROM ai_cache WHERE created_at < ?", (now - policy.cache_days * 86400,))
            db.execute("DELETE FROM ai_cache WHERE cache_key IN (SELECT cache_key FROM ai_cache ORDER BY last_accessed DESC LIMIT -1 OFFSET ?)", (policy.max_cache_entries,))
            deleted["cache"] = db.total_changes - before
            db.execute("PRAGMA optimize")
        return deleted


database = Database()

