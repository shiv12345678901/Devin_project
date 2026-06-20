"""
Test: YouTube Video → Screenshots at Scene Changes

Downloads a YouTube video and captures screenshots whenever the visual content
changes significantly (scene change detection via frame differencing with OpenCV).

Usage:
    python test_yt_screenshots.py "https://www.youtube.com/watch?v=VIDEO_ID"
    python test_yt_screenshots.py "https://www.youtube.com/watch?v=VIDEO_ID" 25

Requirements (already installed):
    pip install yt-dlp numpy opencv-python Pillow
"""

import os
import sys
import tempfile
import shutil
import time
from pathlib import Path

# ─── Config ────────────────────────────────────────────────────────────────

# How different two frames must be (0-100 scale) to count as a scene change.
# Lower = more sensitive (more screenshots). Higher = less sensitive.
SCENE_THRESHOLD = 30.0

# Minimum seconds between captures (avoids rapid-fire during transitions)
MIN_GAP_SECONDS = 2.0

# Max screenshots to capture (safety limit)
MAX_SCREENSHOTS = 100

# Sample every Nth frame for speed (1 = every frame, 5 = every 5th frame)
FRAME_SAMPLE_RATE = 3

# Output folder
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output", "yt_screenshots")


def check_dependencies():
    """Verify required tools are available."""
    errors = []

    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        errors.append("yt-dlp         →  pip install yt-dlp")

    try:
        import numpy  # noqa: F401
    except ImportError:
        errors.append("numpy          →  pip install numpy")

    try:
        import cv2  # noqa: F401
    except ImportError:
        errors.append("opencv-python  →  pip install opencv-python")

    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        errors.append("Pillow         →  pip install Pillow")

    if errors:
        print("\n  Missing dependencies:")
        for e in errors:
            print(f"    ✗ {e}")
        print(f"\n  Install all: pip install yt-dlp numpy opencv-python Pillow")
        sys.exit(1)

    print("  ✓ All dependencies OK")


def download_video(url: str, output_dir: str) -> tuple:
    """Download YouTube video. Returns (file_path, title, duration)."""
    import yt_dlp

    print(f"\n  [1/4] Downloading video...")
    print(f"        URL: {url}")

    output_path = os.path.join(output_dir, "video.%(ext)s")

    ydl_opts = {
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
        "outtmpl": output_path,
        "quiet": True,
        "no_warnings": True,
        "merge_output_format": "mp4",
        "progress_hooks": [_progress_hook],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title", "unknown")
        duration = info.get("duration", 0)
        filename = ydl.prepare_filename(info)
        # Ensure .mp4 extension
        if not filename.endswith(".mp4"):
            base = os.path.splitext(filename)[0]
            if os.path.exists(base + ".mp4"):
                filename = base + ".mp4"

    print(f"        Title: {title}")
    print(f"        Duration: {duration}s")
    print(f"        File: {os.path.basename(filename)}")

    return filename, title, duration


def _progress_hook(d):
    """Simple download progress indicator."""
    if d["status"] == "downloading":
        pct = d.get("_percent_str", "?%").strip()
        speed = d.get("_speed_str", "?").strip()
        print(f"\r        Downloading: {pct} at {speed}   ", end="", flush=True)
    elif d["status"] == "finished":
        print(f"\r        Download complete.                    ")


def detect_scene_changes(video_path: str, threshold: float, min_gap: float) -> list:
    """
    Read video frames with OpenCV and detect scene changes via mean absolute
    difference between consecutive frames.
    
    Returns list of (frame_index, timestamp_sec, frame_bgr_array).
    """
    import cv2
    import numpy as np

    print(f"\n  [2/4] Analyzing video for scene changes...")
    print(f"        Threshold: {threshold}%  |  Min gap: {min_gap}s  |  Sample rate: 1/{FRAME_SAMPLE_RATE}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("        ERROR: Could not open video file")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0

    print(f"        Video: {total_frames} frames, {fps:.1f} fps, {duration:.1f}s")

    # Normalized threshold (0-255 scale for pixel difference)
    diff_threshold = (threshold / 100.0) * 255.0 * 0.3  # 30% at threshold=100 means big change

    scenes = []
    prev_gray = None
    last_capture_time = -min_gap  # Allow first frame to be captured
    frame_idx = 0
    frames_read = 0

    # Always capture first frame
    ret, first_frame = cap.read()
    if ret:
        scenes.append((0, 0.0, first_frame.copy()))
        prev_gray = cv2.cvtColor(
            cv2.resize(first_frame, (320, 180)), cv2.COLOR_BGR2GRAY
        ).astype(np.float32)
        last_capture_time = 0.0
        frame_idx = 1

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_idx += 1

        # Skip frames for speed
        if frame_idx % FRAME_SAMPLE_RATE != 0:
            continue

        frames_read += 1
        timestamp = frame_idx / fps

        # Resize for faster comparison
        small = cv2.resize(frame, (320, 180))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)

        if prev_gray is not None:
            # Mean absolute difference
            diff = np.abs(gray - prev_gray).mean()

            # Check if this is a scene change
            if diff > diff_threshold and (timestamp - last_capture_time) >= min_gap:
                scenes.append((frame_idx, timestamp, frame.copy()))
                last_capture_time = timestamp

                if len(scenes) >= MAX_SCREENSHOTS:
                    print(f"        Hit max screenshot limit ({MAX_SCREENSHOTS})")
                    break

        prev_gray = gray

        # Progress indicator every 500 frames
        if frames_read % 500 == 0:
            pct = (frame_idx / total_frames) * 100
            print(f"\r        Scanning: {pct:.0f}% ({len(scenes)} scenes found)   ", end="", flush=True)

    cap.release()
    print(f"\r        Scan complete: {len(scenes)} scene changes detected.       ")

    return scenes


def save_screenshots(scenes: list, output_dir: str) -> list:
    """Save detected scene frames as PNG files."""
    import cv2

    print(f"\n  [3/4] Saving {len(scenes)} screenshots...")

    os.makedirs(output_dir, exist_ok=True)
    saved = []

    for i, (frame_idx, timestamp, frame) in enumerate(scenes):
        filename = f"screenshot_{i + 1:03d}_at_{timestamp:.1f}s.png"
        filepath = os.path.join(output_dir, filename)
        cv2.imwrite(filepath, frame)
        saved.append(Path(filepath))

    return saved


def deduplicate(screenshots: list, similarity_threshold: float = 0.92) -> list:
    """Remove near-duplicate screenshots using structural similarity."""
    import cv2
    import numpy as np

    if len(screenshots) <= 1:
        return screenshots

    print(f"\n  [4/4] Removing near-duplicates...")

    kept = [screenshots[0]]

    for i in range(1, len(screenshots)):
        try:
            img_prev = cv2.imread(str(kept[-1]))
            img_curr = cv2.imread(str(screenshots[i]))

            if img_prev is None or img_curr is None:
                kept.append(screenshots[i])
                continue

            # Resize both to small size for comparison
            prev_small = cv2.resize(img_prev, (320, 180)).astype(np.float32)
            curr_small = cv2.resize(img_curr, (320, 180)).astype(np.float32)

            # Normalized difference
            diff = np.abs(prev_small - curr_small).mean() / 255.0
            similarity = 1.0 - diff

            if similarity < similarity_threshold:
                kept.append(screenshots[i])
            else:
                # Remove duplicate
                screenshots[i].unlink(missing_ok=True)
        except Exception:
            kept.append(screenshots[i])

    removed = len(screenshots) - len(kept)
    if removed > 0:
        print(f"        Removed {removed} near-duplicates")
    else:
        print(f"        No duplicates found")

    return kept


def main():
    print()
    print("  ╔══════════════════════════════════════════════════╗")
    print("  ║   YouTube → Screenshots (Scene Change Test)     ║")
    print("  ╚══════════════════════════════════════════════════╝")
    print()

    if len(sys.argv) < 2:
        print("  Usage:")
        print("    python test_yt_screenshots.py <youtube_url> [threshold]")
        print()
        print("  Arguments:")
        print("    youtube_url  - Full YouTube video URL")
        print("    threshold    - Scene change sensitivity 1-100 (default: 30)")
        print("                   Lower = more screenshots, Higher = fewer")
        print()
        print("  Examples:")
        print('    python test_yt_screenshots.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"')
        print('    python test_yt_screenshots.py "https://youtu.be/VIDEO_ID" 20')
        sys.exit(1)

    url = sys.argv[1]
    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else SCENE_THRESHOLD

    check_dependencies()

    # Create temp dir for video download
    temp_dir = tempfile.mkdtemp(prefix="textbro_yt_")

    try:
        # Step 1: Download
        start_time = time.time()
        video_file, title, duration = download_video(url, temp_dir)

        if not os.path.exists(video_file):
            print(f"\n  ERROR: Video file not found at {video_file}")
            sys.exit(1)

        # Step 2: Detect scene changes
        scenes = detect_scene_changes(video_file, threshold, MIN_GAP_SECONDS)

        if not scenes:
            print("\n  ✗ No scene changes detected. Try lowering the threshold.")
            sys.exit(1)

        # Step 3: Save screenshots
        safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in title)[:60].strip()
        run_output_dir = os.path.join(OUTPUT_DIR, safe_title)

        # Clear previous run for same video
        if os.path.exists(run_output_dir):
            shutil.rmtree(run_output_dir)

        saved = save_screenshots(scenes, run_output_dir)

        # Step 4: Deduplicate
        final = deduplicate(saved)

        elapsed = time.time() - start_time

        # Summary
        print()
        print(f"  ══════════════════════════════════════════════════")
        print(f"  ✓ Done in {elapsed:.1f}s")
        print(f"    Screenshots: {len(final)}")
        print(f"    Output:      {run_output_dir}")
        print(f"  ══════════════════════════════════════════════════")
        print()

        # List files
        total_size = 0
        for f in final:
            size_kb = f.stat().st_size / 1024
            total_size += size_kb
            print(f"    {f.name}  ({size_kb:.0f} KB)")

        print(f"\n    Total: {total_size / 1024:.1f} MB")
        print()

    finally:
        # Clean up downloaded video
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
