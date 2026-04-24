"""Response caching for AI requests with TTL and size limits."""
import hashlib
import json
import os
import time
from pathlib import Path


class CacheManager:
    """Manage cached AI responses with TTL expiration and LRU eviction."""
    
    def __init__(self, cache_dir="output/cache", max_entries=100, ttl_days=7):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_file = self.cache_dir / "ai_responses.json"
        self.max_entries = max_entries
        self.ttl_seconds = ttl_days * 86400
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
    
    def _save_cache(self):
        """Save cache to disk."""
        try:
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(self.cache, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Warning: Could not save cache: {e}")
    
    def _generate_key(self, text):
        """Generate cache key from input text."""
        return hashlib.sha256(text.encode('utf-8')).hexdigest()
    
    def _is_expired(self, entry):
        """Check if a cache entry has expired based on TTL."""
        if 'created_at' not in entry:
            return False  # Legacy entries without timestamp are kept
        age = time.time() - entry['created_at']
        return age > self.ttl_seconds
    
    def _evict_if_needed(self):
        """Evict oldest entries if cache exceeds max_entries (LRU)."""
        if len(self.cache) <= self.max_entries:
            return
        
        # Sort by last_accessed (or created_at as fallback)
        sorted_keys = sorted(
            self.cache.keys(),
            key=lambda k: self.cache[k].get('last_accessed', self.cache[k].get('created_at', 0))
        )
        
        # Remove oldest entries until we're under the limit
        entries_to_remove = len(self.cache) - self.max_entries
        for key in sorted_keys[:entries_to_remove]:
            del self.cache[key]
            print(f"✓ Cache evicted entry (LRU): {key[:8]}...")
    
    def get(self, text):
        """Get cached response if available and not expired."""
        key = self._generate_key(text)
        if key in self.cache:
            entry = self.cache[key]
            
            # Check TTL expiration
            if self._is_expired(entry):
                del self.cache[key]
                self._save_cache()
                print(f"✗ Cache entry expired: {key[:8]}...")
                return None
            
            # Update last_accessed for LRU tracking
            entry['last_accessed'] = time.time()
            self._save_cache()
            
            print(f"✓ Cache hit! Using cached response from {entry['timestamp']}")
            return entry['response']
        return None
    
    def set(self, text, response):
        """Cache a response with timestamp tracking."""
        key = self._generate_key(text)
        now = time.time()
        self.cache[key] = {
            'response': response,
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            'created_at': now,
            'last_accessed': now,
            'text_length': len(text)
        }
        
        # Evict old entries if over limit
        self._evict_if_needed()
        
        self._save_cache()
        print(f"✓ Response cached (key: {key[:8]}...)")
    
    def clear(self):
        """Clear all cached responses."""
        self.cache = {}
        self._save_cache()
        print("✓ Cache cleared")
    
    def get_stats(self):
        """Get cache statistics."""
        expired_count = sum(1 for entry in self.cache.values() if self._is_expired(entry))
        return {
            'total_entries': len(self.cache),
            'expired_entries': expired_count,
            'active_entries': len(self.cache) - expired_count,
            'max_entries': self.max_entries,
            'ttl_days': self.ttl_seconds / 86400,
            'cache_file': str(self.cache_file),
            'cache_size_kb': round(self.cache_file.stat().st_size / 1024, 2) if self.cache_file.exists() else 0
        }
