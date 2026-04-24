"""Progress tracking system for PowerPoint automation operations.

This module provides real-time progress monitoring and event broadcasting
for long-running PowerPoint operations like presentation creation and video export.
"""

from dataclasses import dataclass, asdict
from datetime import datetime
from queue import Queue
from typing import Dict, Any, Callable, List, Optional
import json


@dataclass
class ProgressEvent:
    """Progress update event for SSE streaming."""
    
    event_type: str  # "slide_inserted", "video_export_started", etc.
    operation_id: str
    timestamp: datetime
    data: Dict[str, Any]  # Event-specific data
    
    def to_sse_format(self) -> str:
        """Convert to Server-Sent Events format.
        
        Returns:
            Formatted SSE string with event type and JSON data
        """
        # Convert datetime to ISO format string for JSON serialization
        event_dict = {
            'event_type': self.event_type,
            'operation_id': self.operation_id,
            'timestamp': self.timestamp.isoformat(),
            'data': self.data
        }
        
        # SSE format: event: <type>\ndata: <json>\n\n
        return f"event: {self.event_type}\ndata: {json.dumps(self.data)}\n\n"


class ProgressTracker:
    """Track and broadcast operation progress.
    
    This class manages progress events for PowerPoint operations,
    allowing multiple listeners to receive real-time updates via
    callbacks or event queues.
    """
    
    def __init__(self, operation_id: str):
        """Initialize progress tracker for an operation.
        
        Args:
            operation_id: Unique identifier for the operation being tracked
        """
        self.operation_id = operation_id
        self.event_queue: Queue = Queue()
        self.listeners: List[Callable[[ProgressEvent], None]] = []
        self._events_history: List[ProgressEvent] = []
    
    def emit(self, event_type: str, data: Dict[str, Any]) -> None:
        """Emit a progress event.
        
        Args:
            event_type: Type of event (e.g., "slide_inserted", "completed")
            data: Event-specific data dictionary
        """
        event = ProgressEvent(
            event_type=event_type,
            operation_id=self.operation_id,
            timestamp=datetime.now(),
            data=data
        )
        
        # Store in history
        self._events_history.append(event)
        
        # Add to queue for SSE streaming
        self.event_queue.put(event)
        
        # Notify all registered listeners
        for listener in self.listeners:
            try:
                listener(event)
            except Exception as e:
                # Don't let listener errors break the tracker
                print(f"Error in progress listener: {e}")
    
    def add_listener(self, callback: Callable[[ProgressEvent], None]) -> None:
        """Add a progress listener callback.
        
        Args:
            callback: Function to call when events are emitted
        """
        self.listeners.append(callback)
    
    def remove_listener(self, callback: Callable[[ProgressEvent], None]) -> None:
        """Remove a progress listener callback.
        
        Args:
            callback: Function to remove from listeners
        """
        if callback in self.listeners:
            self.listeners.remove(callback)
    
    def get_events(self) -> List[ProgressEvent]:
        """Get all events emitted so far.
        
        Returns:
            List of all progress events in chronological order
        """
        return self._events_history.copy()
    
    def get_latest_event(self) -> Optional[ProgressEvent]:
        """Get the most recent event.
        
        Returns:
            Latest progress event or None if no events emitted
        """
        return self._events_history[-1] if self._events_history else None
    
    def clear_history(self) -> None:
        """Clear the event history."""
        self._events_history.clear()


# Global registry of active progress trackers
_active_trackers: Dict[str, ProgressTracker] = {}


def get_tracker(operation_id: str) -> Optional[ProgressTracker]:
    """Get an existing progress tracker by operation ID.
    
    Args:
        operation_id: Unique identifier for the operation
        
    Returns:
        ProgressTracker instance or None if not found
    """
    return _active_trackers.get(operation_id)


def create_tracker(operation_id: str) -> ProgressTracker:
    """Create and register a new progress tracker.
    
    Args:
        operation_id: Unique identifier for the operation
        
    Returns:
        New ProgressTracker instance
    """
    tracker = ProgressTracker(operation_id)
    _active_trackers[operation_id] = tracker
    return tracker


def remove_tracker(operation_id: str) -> None:
    """Remove a progress tracker from the registry.
    
    Args:
        operation_id: Unique identifier for the operation
    """
    if operation_id in _active_trackers:
        del _active_trackers[operation_id]
