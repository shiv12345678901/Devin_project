"""Retry mechanism with exponential backoff for AI requests."""
import time
from functools import wraps


def retry_with_backoff(max_retries=3, base_delay=1, max_delay=30):
    """
    Decorator for retrying failed AI requests with exponential backoff.
    
    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Initial delay in seconds
        max_delay: Maximum delay between retries
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            
            while retries <= max_retries:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    retries += 1
                    
                    if retries > max_retries:
                        print(f"❌ Max retries ({max_retries}) exceeded")
                        raise
                    
                    # Calculate delay with exponential backoff
                    delay = min(base_delay * (2 ** (retries - 1)), max_delay)
                    
                    print(f"⚠️  Attempt {retries} failed: {str(e)}")
                    print(f"🔄 Retrying in {delay} seconds... ({retries}/{max_retries})")
                    
                    time.sleep(delay)
            
            return None
        
        return wrapper
    return decorator
