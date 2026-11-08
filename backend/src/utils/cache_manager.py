"""SQLite-backed AI response cache with TTL and LRU retention."""
import hashlib
import json
import threading
from pathlib import Path

from ..settings import settings
from ..storage.database import database


class CacheManager:
    """Manage cached AI responses with TTL expiration and LRU eviction."""

    def __init__(self, cache_dir="output/cache", max_entries=None, ttl_days=None):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_file = self.cache_dir / "ai_responses.json"
        self.max_entries = max_entries or settings.retention.max_cache_entries
        self.ttl_seconds = (ttl_days or settings.retention.cache_days) * 86400
        self._lock = threading.RLock()
        self._migrate_legacy_cache()

    def _migrate_legacy_cache(self):
        """Import the old JSON cache once; SQLite is canonical afterwards."""
        if database.migration_applied("legacy_ai_cache_json_v1"):
            return
        legacy = self._load_cache()
        for key, entry in legacy.items():
            if not isinstance(entry, dict) or "response" not in entry:
                continue
            if database.cache_get(key, self.ttl_seconds) is None:
                database.cache_set(key, str(entry["response"]), int(entry.get("text_length") or 0))
        database.mark_migration("legacy_ai_cache_json_v1")

    def _load_cache(self):
        """Load cache from disk."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Warning: Could not load cache: {e}")
                return {}
        return {}

    def _generate_key(self, text):
        """Generate cache key from input text.

        ``text`` here is treated as the full composite key (model | prompt
        | user text) — see ``ai_client.generate_response``.
        """
        return hashlib.sha256(text.encode('utf-8')).hexdigest()

    def get(self, text):
        """Get cached response if available and not expired."""
        key = self._generate_key(text)
        with self._lock:
            entry = database.cache_get(key, self.ttl_seconds)
            if entry is None:
                return None
            print(f"Cache hit (key: {key[:8]}...)")
            return entry['response']

    def set(self, text, response):
        """Cache a response with timestamp tracking."""
        key = self._generate_key(text)
        with self._lock:
            database.cache_set(key, response, len(text))
            database.apply_retention()
        print(f"Response cached (key: {key[:8]}...)")

    def flush(self):
        """Compatibility no-op: SQLite commits each cache transaction."""

    def clear(self):
        """Clear all cached responses."""
        with self._lock:
            database.cache_clear()
        print("Cache cleared")

    def get_stats(self):
        """Get cache statistics (snapshot — safe to call from any thread)."""
        with self._lock:
            stats = database.cache_stats(self.ttl_seconds)
            total = stats["total"]
            expired_count = stats["expired"]
            cache_size = settings.database_path.stat().st_size if settings.database_path.exists() else 0
        return {
            'total_entries': total,
            'expired_entries': expired_count,
            'active_entries': total - expired_count,
            'max_entries': self.max_entries,
            'ttl_days': self.ttl_seconds / 86400,
            'cache_file': str(settings.database_path),
            'cache_size_kb': round(cache_size / 1024, 2),
        }
