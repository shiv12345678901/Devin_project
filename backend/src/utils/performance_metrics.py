"""Performance metrics tracking for screenshot generation."""
import time
from datetime import datetime


class PerformanceMetrics:
    """Track and report performance metrics."""
    
    def __init__(self):
        self.metrics = {}
        self.start_times = {}
    
    def start(self, operation_id):
        """Start timing an operation."""
        self.start_times[operation_id] = time.time()
        self.metrics[operation_id] = {
            'start_time': datetime.now().isoformat(),
            'status': 'running'
        }
    
    def end(self, operation_id, success=True, metadata=None):
        """End timing an operation."""
        if operation_id not in self.start_times:
            return None
        
        end_time = time.time()
        duration = end_time - self.start_times[operation_id]
        
        self.metrics[operation_id].update({
            'end_time': datetime.now().isoformat(),
            'duration_seconds': round(duration, 3),
            'duration_ms': round(duration * 1000, 2),
            'status': 'success' if success else 'failed',
            'metadata': metadata or {}
        })
        
        return self.metrics[operation_id]
    
    def get_metrics(self, operation_id):
        """Get metrics for a specific operation."""
        return self.metrics.get(operation_id)
    
    def get_all_metrics(self):
        """Get all tracked metrics."""
        return self.metrics
    
    def clear(self):
        """Clear all metrics."""
        self.metrics = {}
        self.start_times = {}
    
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
        """Get formatted summary of operation metrics."""
        metrics = self.get_metrics(operation_id)
        if not metrics:
            return None
        
        summary = {
            'operation_id': operation_id,
            'duration': self.format_duration(metrics['duration_seconds']),
            'duration_ms': metrics['duration_ms'],
            'status': metrics['status'],
            'start_time': metrics['start_time'],
            'end_time': metrics.get('end_time', 'N/A')
        }
        
        if 'metadata' in metrics:
            summary['metadata'] = metrics['metadata']
        
        return summary


class ScreenshotMetrics(PerformanceMetrics):
    """Specialized metrics for screenshot operations."""
    
    def track_screenshot_generation(
        self,
        operation_id,
        num_screenshots,
        total_height,
        viewport_size,
        file_sizes=None
    ):
        """Track screenshot-specific metrics."""
        metrics = self.get_metrics(operation_id)
        if not metrics:
            return None
        
        metadata = {
            'screenshot_count': num_screenshots,
            'total_page_height': total_height,
            'viewport_width': viewport_size[0],
            'viewport_height': viewport_size[1],
            'avg_time_per_screenshot': round(
                metrics['duration_seconds'] / num_screenshots, 3
            ) if num_screenshots > 0 else 0
        }
        
        if file_sizes:
            total_size = sum(file_sizes)
            metadata['total_size_kb'] = round(total_size / 1024, 2)
            metadata['avg_size_kb'] = round(total_size / len(file_sizes) / 1024, 2)
        
        metrics['metadata'].update(metadata)
        return metrics
    
    def track_ai_request(self, operation_id, input_length, output_length, cached=False):
        """Track AI request metrics."""
        metrics = self.get_metrics(operation_id)
        if not metrics:
            return None
        
        metadata = {
            'input_length': input_length,
            'output_length': output_length,
            'cached': cached,
            'tokens_per_second': round(
                output_length / metrics['duration_seconds'], 2
            ) if metrics['duration_seconds'] > 0 else 0
        }
        
        metrics['metadata'].update(metadata)
        return metrics


# Global metrics instance
metrics_tracker = ScreenshotMetrics()
