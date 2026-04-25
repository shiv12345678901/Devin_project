"""Performance metrics tracking for screenshot generation.

Thread-safe by way of a single ``threading.RLock``. Concurrent SSE workers
that finish at the same time would otherwise race on the underlying dicts
and silently drop entries. The recursive lock allows ``end()`` (which may
call ``get_metrics()`` indirectly) to nest without deadlocking.

Memory is bounded with a simple ordered eviction (``MAX_TRACKED_OPS``).
Without this every run leaves ~5 entries in memory forever.
"""
import threading
import time
from collections import OrderedDict
from datetime import datetime

# How many operations we keep before evicting the oldest. ~500 = a comfortable
# afternoon's worth of runs and only ~few hundred KB of RAM.
MAX_TRACKED_OPS = 500


class PerformanceMetrics:
    """Track and report performance metrics."""

    def __init__(self, max_tracked: int = MAX_TRACKED_OPS):
        self._lock = threading.RLock()
        self._max_tracked = max_tracked
        # OrderedDict preserves insertion order so ``popitem(last=False)``
        # evicts the oldest tracked operation.
        self.metrics: "OrderedDict[str, dict]" = OrderedDict()
        self.start_times: "OrderedDict[str, float]" = OrderedDict()

    def _evict_if_needed_locked(self) -> None:
        """Evict oldest entries while holding the lock."""
        while len(self.metrics) > self._max_tracked:
            oldest, _ = self.metrics.popitem(last=False)
            self.start_times.pop(oldest, None)

    def start(self, operation_id):
        """Start timing an operation."""
        with self._lock:
            self.start_times[operation_id] = time.time()
            self.metrics[operation_id] = {
                'start_time': datetime.now().isoformat(),
                'status': 'running',
            }
            self._evict_if_needed_locked()

    def end(self, operation_id, success=True, metadata=None):
        """End timing an operation."""
        with self._lock:
            if operation_id not in self.start_times:
                return None

            end_time = time.time()
            duration = end_time - self.start_times[operation_id]

            self.metrics[operation_id].update({
                'end_time': datetime.now().isoformat(),
                'duration_seconds': round(duration, 3),
                'duration_ms': round(duration * 1000, 2),
                'status': 'success' if success else 'failed',
                'metadata': metadata or {},
            })

            return dict(self.metrics[operation_id])

    def get_metrics(self, operation_id):
        """Get metrics for a specific operation."""
        with self._lock:
            entry = self.metrics.get(operation_id)
            return dict(entry) if entry else None

    def get_all_metrics(self):
        """Get all tracked metrics (snapshot copy)."""
        with self._lock:
            return {k: dict(v) for k, v in self.metrics.items()}

    def clear(self):
        """Clear all metrics."""
        with self._lock:
            self.metrics.clear()
            self.start_times.clear()
    
    def format_duration(self, seconds):
        """Format duration in human-readable format."""
        if seconds < 1:
            return f"{seconds * 1000:.0f}ms"
        elif seconds < 60:
            return f"{seconds:.2f}s"
        else:
            minutes = int(seconds // 60)
            secs = seconds % 60
            return f"{minutes}m {secs:.0f}s"
    
    def get_summary(self, operation_id):
        """Get formatted summary of operation metrics.

        Works while an operation is still running — in that case we report
        elapsed time instead of crashing on the missing duration_seconds
        key (which is only set by end()).
        """
        with self._lock:
            metrics = self.metrics.get(operation_id)
            if not metrics:
                return None

            if 'duration_seconds' not in metrics:
                start = self.start_times.get(operation_id, time.time())
                elapsed = time.time() - start
                return {
                    'operation_id': operation_id,
                    'duration': self.format_duration(elapsed),
                    'duration_seconds': round(elapsed, 3),
                    'duration_ms': round(elapsed * 1000, 2),
                    'status': metrics.get('status', 'running'),
                    'start_time': metrics.get('start_time'),
                    'end_time': 'N/A',
                    'metadata': dict(metrics.get('metadata', {})),
                }

            summary = {
                'operation_id': operation_id,
                'duration': self.format_duration(metrics['duration_seconds']),
                'duration_seconds': metrics['duration_seconds'],
                'duration_ms': metrics['duration_ms'],
                'status': metrics['status'],
                'start_time': metrics['start_time'],
                'end_time': metrics.get('end_time', 'N/A'),
            }

            if 'metadata' in metrics:
                summary['metadata'] = dict(metrics['metadata'])

            return summary


class ScreenshotMetrics(PerformanceMetrics):
    """Specialized metrics for screenshot operations."""

    def _update_metadata(self, operation_id, extra: dict):
        """Merge ``extra`` into the operation's metadata under the lock.

        Returns a snapshot of the resulting metric entry, or None if the
        operation hasn't been started.
        """
        with self._lock:
            entry = self.metrics.get(operation_id)
            if not entry:
                return None
            entry.setdefault('metadata', {}).update(extra)
            return dict(entry)

    def track_screenshot_generation(
        self,
        operation_id,
        num_screenshots,
        total_height,
        viewport_size,
        file_sizes=None,
    ):
        """Track screenshot-specific metrics."""
        with self._lock:
            entry = self.metrics.get(operation_id)
            if not entry:
                return None
            duration = entry.get('duration_seconds', 0) or 0

        metadata = {
            'screenshot_count': num_screenshots,
            'total_page_height': total_height,
            'viewport_width': viewport_size[0],
            'viewport_height': viewport_size[1],
            'avg_time_per_screenshot': (
                round(duration / num_screenshots, 3) if num_screenshots > 0 else 0
            ),
        }

        if file_sizes:
            total_size = sum(file_sizes)
            metadata['total_size_kb'] = round(total_size / 1024, 2)
            metadata['avg_size_kb'] = round(total_size / len(file_sizes) / 1024, 2)

        return self._update_metadata(operation_id, metadata)

    def track_ai_request(self, operation_id, input_length, output_length, cached=False):
        """Track AI request metrics."""
        with self._lock:
            entry = self.metrics.get(operation_id)
            if not entry:
                return None
            duration = entry.get('duration_seconds', 0) or 0

        metadata = {
            'input_length': input_length,
            'output_length': output_length,
            'cached': cached,
            'tokens_per_second': (
                round(output_length / duration, 2) if duration > 0 else 0
            ),
        }

        return self._update_metadata(operation_id, metadata)


# Global metrics instance
metrics_tracker = ScreenshotMetrics()
