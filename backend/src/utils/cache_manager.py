"""Response caching for AI requests with TTL and size limits.

Thread-safety
~~~~~~~~~~~~~
A single ``threading.RLock`` guards both the in-memory ``self.cache`` dict
and the on-disk JSON. Without it, two concurrent SSE workers calling
``set()`` could lose entries (last writer wins on the JSON file), and
``get()`` -> ``last_accessed`` updates could race with other writers.

Hot-path I/O
~~~~~~~~~~~~
The previous implementation rewrote the whole JSON file on every cache
*hit* just to update ``last_accessed``. That's an unbounded write rate
under load. We now batch those updates and only flush to disk every
``LRU_FLUSH_INTERVAL`` seconds (or when ``set()`` mutates state). Worst
case after a crash: a hit's ``last_accessed`` is up to 30 s stale, which
is harmless for LRU eviction.
"""
import hashlib
import json
import os
import threading
import time
from pathlib import Path


# How long we may delay flushing access-time updates for cache hits.
LRU_FLUSH_INTERVAL = 30.0


class CacheManager:
    """Manage cached AI responses with TTL expiration and LRU eviction."""

    def __init__(self, cache_dir="output/cache", max_entries=100, ttl_days=7):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_file = self.cache_dir / "ai_responses.json"
        self.max_entries = max_entries
        self.ttl_seconds = ttl_days * 86400
        self._lock = threading.RLock()
        self._dirty_since_flush = False
        self._last_flush = 0.0
        self.cache = self._load_cache()

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

    def _save_cache_locked(self, force: bool = False):
        """Save cache to disk while holding the lock.

        Uses an atomic ``write tmp + rename`` so a crash mid-write doesn't
        leave a half-written ``ai_responses.json``. With ``force=False``
        skips the write if no state has changed since the last flush.
        """
        if not force and not self._dirty_since_flush:
            return
        try:
            tmp_path = self.cache_file.with_suffix('.json.tmp')
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(self.cache, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.cache_file)
            self._dirty_since_flush = False
            self._last_flush = time.time()
        except Exception as e:
            print(f"Warning: Could not save cache: {e}")

    def _generate_key(self, text):
        """Generate cache key from input text.

        ``text`` here is treated as the full composite key (model | prompt
        | user text) — see ``ai_client.generate_response``.
        """
        return hashlib.sha256(text.encode('utf-8')).hexdigest()

    def _is_expired(self, entry):
        """Check if a cache entry has expired based on TTL."""
        if 'created_at' not in entry:
            return False  # Legacy entries without timestamp are kept
        age = time.time() - entry['created_at']
        return age > self.ttl_seconds

    def _evict_if_needed_locked(self):
        """Evict oldest entries if cache exceeds max_entries (LRU)."""
        if len(self.cache) <= self.max_entries:
            return
        sorted_keys = sorted(
            self.cache.keys(),
            key=lambda k: self.cache[k].get(
                'last_accessed', self.cache[k].get('created_at', 0)
            ),
        )
        entries_to_remove = len(self.cache) - self.max_entries
        for key in sorted_keys[:entries_to_remove]:
            del self.cache[key]
            self._dirty_since_flush = True
            print(f"✓ Cache evicted entry (LRU): {key[:8]}...")

    def get(self, text):
        """Get cached response if available and not expired."""
        key = self._generate_key(text)
        with self._lock:
            entry = self.cache.get(key)
            if entry is None:
                return None

            if self._is_expired(entry):
                del self.cache[key]
                self._dirty_since_flush = True
                self._save_cache_locked(force=True)
                print(f"✗ Cache entry expired: {key[:8]}...")
                return None

            entry['last_accessed'] = time.time()
            self._dirty_since_flush = True
            # Throttle flushes for hits — see module docstring.
            if time.time() - self._last_flush > LRU_FLUSH_INTERVAL:
                self._save_cache_locked()

            print(f"✓ Cache hit! Using cached response from {entry['timestamp']}")
            return entry['response']

    def set(self, text, response):
        """Cache a response with timestamp tracking."""
        key = self._generate_key(text)
        now = time.time()
        with self._lock:
            self.cache[key] = {
                'response': response,
                'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
                'created_at': now,
                'last_accessed': now,
                'text_length': len(text),
            }
            self._dirty_since_flush = True
            self._evict_if_needed_locked()
            self._save_cache_locked(force=True)
        print(f"✓ Response cached (key: {key[:8]}...)")

    def flush(self):
        """Force a flush of any pending access-time updates to disk."""
        with self._lock:
            self._save_cache_locked(force=True)

    def clear(self):
        """Clear all cached responses."""
        with self._lock:
            self.cache = {}
            self._dirty_since_flush = True
            self._save_cache_locked(force=True)
        print("✓ Cache cleared")

    def get_stats(self):
        """Get cache statistics (snapshot — safe to call from any thread)."""
        with self._lock:
            expired_count = sum(
                1 for entry in self.cache.values() if self._is_expired(entry)
            )
            total = len(self.cache)
            cache_size = (
                self.cache_file.stat().st_size if self.cache_file.exists() else 0
            )
        return {
            'total_entries': total,
            'expired_entries': expired_count,
            'active_entries': total - expired_count,
            'max_entries': self.max_entries,
            'ttl_days': self.ttl_seconds / 86400,
            'cache_file': str(self.cache_file),
            'cache_size_kb': round(cache_size / 1024, 2),
        }
