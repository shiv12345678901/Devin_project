"""Screenshot capture using Playwright with browser pooling."""
from playwright.sync_api import sync_playwright
from PIL import Image
import tempfile
import time
import os
import io
import threading


class BrowserPool:
    """Thread-safe browser pool that keeps a Chromium instance per thread."""
    
    def __init__(self):
        self._local = threading.local()
        self._lock = threading.Lock()
    
    def _ensure_browser(self):
        """Launch browser if not already running in this thread."""
        if not hasattr(self._local, 'playwright') or self._local.playwright is None:
            self._local.playwright = sync_playwright().start()
            self._local.browser = self._local.playwright.chromium.launch(headless=True)
            print(f"🌐 Browser launched for thread {threading.current_thread().name}")
        elif not self._local.browser.is_connected():
            self._local.browser = self._local.playwright.chromium.launch(headless=True)
            print(f"🌐 Browser reconnected for thread {threading.current_thread().name}")
    
    def get_page(self, logical_width, logical_height, zoom):
        """Get a new page from the thread-local browser."""
        with self._lock:
            self._ensure_browser()
            page = self._local.browser.new_page(
                viewport={"width": logical_width, "height": logical_height},
                device_scale_factor=zoom,
            )
            return page
    
    def shutdown(self):
        """Clean up browser and playwright resources for current thread."""
        with self._lock:
            if hasattr(self._local, 'browser') and self._local.browser:
                try:
                    self._local.browser.close()
                except Exception:
                    pass
                self._local.browser = None
            if hasattr(self._local, 'playwright') and self._local.playwright:
                try:
                    self._local.playwright.stop()
                except Exception:
                    pass
                self._local.playwright = None
            print(f"🌐 Browser pool shut down for thread {threading.current_thread().name}", flush=True)


# Module-level browser pool instance
_browser_pool = BrowserPool()


def get_browser_pool():
    """Get the module-level browser pool."""
    return _browser_pool


def take_screenshot_playwright(
    html_content,
    save_path,
    zoom=2.1,              # Single zoom parameter (replaces font_size + device_scale)
    overlap=20,            # Logical pixels of overlap between consecutive shots
    viewport_width=1920,   # Final output width in physical pixels
    viewport_height=1080,  # Final output height in physical pixels
    max_screenshots=50,
    progress_callback=None, # Optional callback for SSE progress updates
    cancel_event=None       # Optional threading.Event to abort generation
):
    """
    Take multiple 1920×1080 screenshots of HTML content with configurable zoom.

    The zoom is achieved purely via device_scale_factor:
      - logical viewport = (1920/zoom) × (1080/zoom)
      - device_scale_factor = zoom
      - output image = 1920 × 1080 (no resize needed)

    Args:
        html_content:    Full HTML string to render
        save_path:       Path for the first screenshot (e.g., "output.png")
        zoom:            Zoom level (2.5 = 250%)
        overlap:         Overlap between shots in logical pixels
        viewport_width:  Output image width
        viewport_height: Output image height
        max_screenshots: Safety cap
        progress_callback: Optional callable(message, progress_pct) for progress updates
        cancel_event: Optional threading.Event to monitor for user cancellation
    """
    screenshots = []
    temp_fd = None
    temp_path = None
    page = None

    try:
        # Write HTML to unique temp file (fixes race condition)
        temp_fd, temp_path = tempfile.mkstemp(suffix='.html', prefix='screenshot_')
        with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
            f.write(html_content)
        temp_fd = None  # fd is now closed by os.fdopen

        file_url = f"file:///{os.path.abspath(temp_path)}"

        # ─── Single zoom mechanism ───
        logical_width = int(viewport_width / zoom)
        logical_height = int(viewport_height / zoom)

        # Clamp overlap below the logical viewport so (viewport_h - overlap)
        # in the num_est division is always positive. Without this, a user
        # sending overlap >= viewport_h causes ZeroDivisionError or negative
        # step-size crashes in the capture loop.
        max_overlap = max(0, logical_height - 1)
        if overlap > max_overlap:
            print(
                f"⚠️ overlap={overlap} exceeds logical viewport height "
                f"{logical_height}; clamping to {max_overlap}",
                flush=True,
            )
            overlap = max_overlap

        # Use pooled browser
        page = _browser_pool.get_page(logical_width, logical_height, zoom)

        page.goto(file_url)
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        # Get page dimensions (clean, undistorted values)
        dimensions = page.evaluate("""
            () => ({
                scrollHeight: document.documentElement.scrollHeight,
                clientHeight: window.innerHeight
            })
        """)

        total_height = dimensions["scrollHeight"]
        viewport_h = dimensions["clientHeight"]

        print(f"📏 Page: {total_height}px logical | Viewport: {viewport_h}px logical", flush=True)
        print(f"🔍 Zoom: {zoom}x → logical {logical_width}×{logical_height} → "
              f"output {viewport_width}×{viewport_height}", flush=True)

        # Re-clamp against the real clientHeight (may differ from logical_height
        # when scrollbars take space) so the divisor below is always >= 1.
        if overlap >= viewport_h:
            overlap = max(0, viewport_h - 1)
        num_est = max(1, -(-total_height // (viewport_h - overlap)))
        print(f"📸 Estimated {num_est} screenshot(s) (overlap={overlap}px)", flush=True)

        if progress_callback:
            progress_callback(f"Estimated {num_est} screenshot(s)", 10)

        # Prepare filenames
        base_path, extension = (
            (save_path.rsplit(".", 1)[0], save_path.rsplit(".", 1)[1])
            if "." in save_path
            else (save_path, "png")
        )

        screenshot_count = 0
        scroll_position = 0

        while screenshot_count < max_screenshots:
            # Check for early cancellation
            if cancel_event and cancel_event.is_set():
                print("🛑 Screenshot generation aborted by user.")
                break
                
            screenshot_count += 1
            
            # Scroll to position
            page.evaluate(f"window.scrollTo(0, {scroll_position})")
            time.sleep(0.3)

            actual_scroll = page.evaluate("window.pageYOffset")
            current_total = page.evaluate(
                "document.documentElement.scrollHeight"
            )

            print(
                f"📍 Shot {screenshot_count}: "
                f"scroll={actual_scroll}/{current_total - viewport_h}", flush=True
            )

            # ─── Consistent naming: base(1).png, base(2).png, ... ───
            screenshot_path = f"{base_path}({screenshot_count}).{extension}"

            # Capture screenshot
            screenshot_bytes = page.screenshot(full_page=False)
            img = Image.open(io.BytesIO(screenshot_bytes))

            # Verify exact target size
            target_size = (viewport_width, viewport_height)
            if img.size != target_size:
                print(f"   ⚠️  Raw {img.size} → resizing to {target_size}")
                img = img.resize(target_size, Image.Resampling.LANCZOS)

            img.save(screenshot_path, "PNG")
            screenshots.append(screenshot_path)
            print(
                f"   ✅ {os.path.basename(screenshot_path)} "
                f"({img.size[0]}×{img.size[1]})", flush=True
            )

            if progress_callback:
                pct = 10 + int((screenshot_count / max(num_est, 1)) * 80)
                progress_callback(
                    f"Captured screenshot {screenshot_count}/{num_est}",
                    min(pct, 90)
                )

            # ─── Check if we've reached the bottom ───
            max_scroll = current_total - viewport_h

            if actual_scroll >= max_scroll - 2:
                print("🏁 Reached bottom of page.", flush=True)
                break

            # Advance with overlap
            scroll_position += viewport_h - overlap

            # Clamp to capture the very last strip
            if scroll_position > max_scroll:
                scroll_position = max_scroll

        print(f"\n✅ Done — {screenshot_count} screenshot(s) saved.")

    finally:
        # Close page (but browser stays alive in pool)
        if page:
            try:
                page.close()
            except Exception:
                pass
        
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

    return screenshots


# Alias for compatibility
take_screenshot_selenium = take_screenshot_playwright