"""Dual-engine video builder.

Routes call :class:`VideoStudio` instead of touching the platform-specific
engines directly. The studio inspects the host OS (and the
``USE_POWERPOINT`` config flag) and dispatches to one of two engines:

- **Windows** → ``core.powerpoint.controller.PowerPointController`` driving
  PowerPoint via COM automation. Same behaviour the project has shipped
  on Windows since day one.
- **Linux / macOS** → MoviePy + ffmpeg. Stitches the same screenshot
  list into a 4K H.264 MP4 with the same intro / outro thumbnail
  layering plus optional intro / outro video clips, watermark, and an
  audio bed (per-slide voiceovers + 10 %-volume background music).

Both engines accept the same ``config_data`` dict (see
:meth:`VideoStudio.build_video`) and return the same shape so the calling
route doesn't care which one ran.
"""
from __future__ import annotations

import logging
import os
import platform
from pathlib import Path
from typing import Any, Callable, Iterable, List, Optional

logger = logging.getLogger(__name__)


def _resolve_use_powerpoint() -> bool:
    """Read ``USE_POWERPOINT`` from config, falling back to OS detection.

    Routes import VideoStudio after backend ``config`` has been added to
    ``sys.path`` (see ``app.py``). We re-resolve on every instantiation
    so flipping the env var without restarting picks up the new value.
    """
    override = os.environ.get("USE_POWERPOINT")
    if override is not None and override.strip():
        return override.strip().lower() in {"1", "true", "yes", "on"}
    try:
        import config  # type: ignore

        flag = getattr(config, "USE_POWERPOINT", None)
        if flag is not None:
            return bool(flag)
    except Exception:  # pragma: no cover - config import is best-effort
        pass
    return platform.system() == "Windows"


class VideoEngineError(Exception):
    """Base class for engine-level failures surfaced to the caller."""


class MovieEngineUnavailableError(VideoEngineError):
    """MoviePy / ffmpeg isn't usable on this host. Caller should surface
    a clean error to the user (e.g. via SSE) rather than blow up."""


# Default video knobs — match the spec (4K, 30 fps, libx264 ultrafast).
_DEFAULT_RESOLUTION = (3840, 2160)
_DEFAULT_FPS = 30
_DEFAULT_PRESET = "ultrafast"
_DEFAULT_CODEC = "libx264"
_BG_MUSIC_VOLUME = 0.10
_WATERMARK_OPACITY = 0.50


class VideoStudio:
    """OS-aware façade around the PowerPoint and MoviePy engines."""

    def __init__(self, use_powerpoint: Optional[bool] = None):
        self.use_powerpoint = (
            bool(use_powerpoint) if use_powerpoint is not None else _resolve_use_powerpoint()
        )

    # ──────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────
    def build_video(self, config_data: dict) -> dict:
        """Build an MP4 from ``config_data`` using the selected engine.

        Required keys:
            ``image_files``         – ordered list of slide screenshot paths
            ``output_video_path``   – where the MP4 lands

        Optional keys (all engines):
            ``output_pptx_path``    – companion PPTX path (Windows only)
            ``template_path``       – PowerPoint template (Windows only)
            ``slide_duration``      – seconds per slide (default 5.0)
            ``resolution``          – ``(w, h)`` tuple (default 4K)
            ``fps``                 – default 30
            ``quality``             – 1–5 (Windows) / 0–100 (MoviePy)
            ``intro_thumbnail_path`` / ``intro_thumbnail_duration``
            ``outro_thumbnail_path`` / ``outro_thumbnail_duration``
            ``progress_callback``   – ``fn(payload: dict)``
            ``cancel_event``        – threading.Event for cooperative cancel

        MoviePy-only optional keys:
            ``intro_video_path``    – Layer 1 (intro.mp4)
            ``outro_video_path``    – Layer 5 (outro.mp4)
            ``voiceover_files``     – ``list[Optional[str]]`` (one per slide)
            ``narration_audio``     – single full-length narration track
            ``background_music``    – music file mixed in at 10 % volume
            ``logo_path``           – watermark, 50 % opacity, bottom-right

        Returns:
            ``{'presentation_path': str | None, 'video_path': str, 'warning': str | None}``
        """
        if self.use_powerpoint:
            return self._build_with_powerpoint(config_data)
        return self._build_with_moviepy(config_data)

    # ──────────────────────────────────────────────────────────────────
    # Windows — PowerPoint COM
    # ──────────────────────────────────────────────────────────────────
    def _build_with_powerpoint(self, cfg: dict) -> dict:
        from core.powerpoint.controller import PowerPointController

        controller = PowerPointController()
        result = controller.create_and_export_video(
            template_path=cfg["template_path"],
            image_files=list(cfg["image_files"]),
            output_pptx_path=cfg["output_pptx_path"],
            output_video_path=cfg["output_video_path"],
            slide_duration=float(cfg.get("slide_duration", 5.0)),
            transition_type=cfg.get("transition_type", "fade"),
            resolution=tuple(cfg.get("resolution") or _DEFAULT_RESOLUTION),
            fps=int(cfg.get("fps") or _DEFAULT_FPS),
            quality=int(cfg.get("quality") or 5),
            intro_thumbnail_path=cfg.get("intro_thumbnail_path"),
            intro_thumbnail_duration=float(cfg.get("intro_thumbnail_duration", 5.0)),
            outro_thumbnail_path=cfg.get("outro_thumbnail_path"),
            outro_thumbnail_duration=float(cfg.get("outro_thumbnail_duration", 5.0)),
            progress_callback=cfg.get("progress_callback"),
            cancel_event=cfg.get("cancel_event"),
        )
        # Normalise the return shape so MoviePy and PPT branches are
        # interchangeable from the caller's POV.
        return {
            "presentation_path": result.get("presentation_path"),
            "video_path": result.get("video_path"),
            "warning": result.get("warning"),
            "engine": "powerpoint",
        }

    # ──────────────────────────────────────────────────────────────────
    # Linux / macOS — MoviePy
    # ──────────────────────────────────────────────────────────────────
    def _build_with_moviepy(self, cfg: dict) -> dict:
        try:
            from moviepy import (  # type: ignore
                AudioFileClip,
                CompositeAudioClip,
                CompositeVideoClip,
                ImageClip,
                VideoFileClip,
                concatenate_videoclips,
            )
        except ImportError as exc:  # pragma: no cover - exercised on hosts w/o moviepy
            raise MovieEngineUnavailableError(
                "MoviePy is not installed on this host. The Linux/macOS "
                "video engine requires `moviepy>=2.0` and `ffmpeg`. "
                "Install with: pip install 'moviepy>=2.0' && apt-get install ffmpeg"
            ) from exc

        image_files: List[str] = list(cfg.get("image_files") or [])
        if not image_files:
            raise VideoEngineError("MoviePy engine requires at least one image_file")

        output_video_path: str = cfg["output_video_path"]
        Path(output_video_path).parent.mkdir(parents=True, exist_ok=True)

        resolution = tuple(cfg.get("resolution") or _DEFAULT_RESOLUTION)
        fps = int(cfg.get("fps") or _DEFAULT_FPS)
        slide_duration = float(cfg.get("slide_duration", 5.0))
        progress_callback: Optional[Callable[[dict], None]] = cfg.get("progress_callback")
        cancel_event = cfg.get("cancel_event")

        def _emit(stage: str, progress: int, message: str) -> None:
            if progress_callback:
                try:
                    progress_callback(
                        {"stage": stage, "progress": progress, "message": message}
                    )
                except Exception:  # never let a buggy callback crash the build
                    logger.exception("progress_callback raised")

        def _check_cancel() -> None:
            if cancel_event is not None and cancel_event.is_set():
                raise VideoEngineError("Cancelled by user")

        opened_clips: List[Any] = []

        def _track(c):
            opened_clips.append(c)
            return c

        try:
            voiceover_files: List[Optional[str]] = list(
                cfg.get("voiceover_files") or [None] * len(image_files)
            )
            # Pad / trim so we always have one entry per slide.
            if len(voiceover_files) < len(image_files):
                voiceover_files += [None] * (len(image_files) - len(voiceover_files))
            voiceover_files = voiceover_files[: len(image_files)]

            sequence: List[Any] = []

            # Layer 1 — Intro video
            intro_video = cfg.get("intro_video_path")
            if intro_video and Path(intro_video).is_file():
                _emit("moviepy", 5, "Loading intro video...")
                clip = _track(VideoFileClip(intro_video)).resized(resolution)
                sequence.append(clip)
            _check_cancel()

            # Layer 2 — Intro thumbnail (still image)
            intro_thumb = cfg.get("intro_thumbnail_path")
            if intro_thumb and Path(intro_thumb).is_file():
                _emit("moviepy", 8, "Adding intro thumbnail...")
                clip = (
                    _track(ImageClip(intro_thumb))
                    .with_duration(float(cfg.get("intro_thumbnail_duration", 5.0)))
                    .resized(resolution)
                )
                sequence.append(clip)
            _check_cancel()

            # Layer 3 — Slides + per-slide voiceovers
            _emit("moviepy", 12, f"Composing {len(image_files)} slides...")
            for idx, (img_path, voice_path) in enumerate(zip(image_files, voiceover_files)):
                _check_cancel()
                voice_clip = None
                if voice_path and Path(voice_path).is_file():
                    voice_clip = _track(AudioFileClip(voice_path))
                    duration = max(voice_clip.duration, 0.1)
                else:
                    duration = slide_duration
                slide = (
                    _track(ImageClip(img_path)).with_duration(duration).resized(resolution)
                )
                if voice_clip is not None:
                    slide = slide.with_audio(voice_clip)
                sequence.append(slide)
                # 12 → 70 %: linear over slides.
                pct = 12 + int(58 * (idx + 1) / max(len(image_files), 1))
                _emit("moviepy", pct, f"Slide {idx + 1}/{len(image_files)} ready")

            # Layer 4 — Outro thumbnail (the "Thanks" image)
            outro_thumb = cfg.get("outro_thumbnail_path")
            if outro_thumb and Path(outro_thumb).is_file():
                _emit("moviepy", 72, "Adding outro thumbnail...")
                clip = (
                    _track(ImageClip(outro_thumb))
                    .with_duration(float(cfg.get("outro_thumbnail_duration", 5.0)))
                    .resized(resolution)
                )
                sequence.append(clip)
            _check_cancel()

            # Layer 5 — Outro video
            outro_video = cfg.get("outro_video_path")
            if outro_video and Path(outro_video).is_file():
                _emit("moviepy", 75, "Loading outro video...")
                clip = _track(VideoFileClip(outro_video)).resized(resolution)
                sequence.append(clip)
            _check_cancel()

            if not sequence:
                raise VideoEngineError(
                    "MoviePy engine produced an empty timeline (no slides or intros)"
                )

            _emit("moviepy", 78, "Concatenating layers...")
            timeline = concatenate_videoclips(sequence, method="compose")
            opened_clips.append(timeline)

            # Watermark — logo @ 50 % opacity, bottom-right, full duration.
            logo_path = cfg.get("logo_path")
            if logo_path and Path(logo_path).is_file():
                _emit("moviepy", 82, "Compositing watermark...")
                # Scale logo to ~12 % of frame width by default; users can
                # supply a pre-sized PNG to override.
                logo = (
                    _track(ImageClip(logo_path))
                    .with_opacity(_WATERMARK_OPACITY)
                    .with_duration(timeline.duration)
                    .with_position(("right", "bottom"))
                )
                timeline = CompositeVideoClip([timeline, logo], size=resolution)
                opened_clips.append(timeline)
            _check_cancel()

            # Audio bed — narration over background music @ 10 % volume.
            audio_layers: List[Any] = []
            if timeline.audio is not None:
                audio_layers.append(timeline.audio)
            narration = cfg.get("narration_audio")
            if narration and Path(narration).is_file():
                audio_layers.append(_track(AudioFileClip(narration)))
            bg_music = cfg.get("background_music")
            if bg_music and Path(bg_music).is_file():
                bg = _track(AudioFileClip(bg_music)).with_volume_scaled(_BG_MUSIC_VOLUME)
                # Trim background music to the final timeline length so it
                # doesn't extend past the last slide.
                if bg.duration > timeline.duration:
                    bg = bg.subclipped(0, timeline.duration)
                audio_layers.append(bg)
            if audio_layers:
                _emit("moviepy", 86, "Mixing audio bed...")
                timeline = timeline.with_audio(CompositeAudioClip(audio_layers))

            # Export — H.264 ultrafast.
            _emit("moviepy", 90, "Encoding MP4 (libx264 ultrafast)...")
            ffmpeg_logger = _ProgressBarLogger(progress_callback)
            timeline.write_videofile(
                output_video_path,
                codec=_DEFAULT_CODEC,
                preset=_DEFAULT_PRESET,
                fps=fps,
                audio_codec="aac" if timeline.audio is not None else None,
                threads=cfg.get("threads") or 4,
                logger=ffmpeg_logger,
            )
            _emit("moviepy", 99, "MP4 written to disk.")

        finally:
            for clip in opened_clips:
                close = getattr(clip, "close", None)
                if callable(close):
                    try:
                        close()
                    except Exception:
                        pass

        return {
            "presentation_path": None,
            "video_path": output_video_path,
            "warning": None,
            "engine": "moviepy",
        }


# ──────────────────────────────────────────────────────────────────────
# proglog adapter — bridges MoviePy's progress bar to our SSE callback.
# ──────────────────────────────────────────────────────────────────────
def _make_progress_logger_base():
    """Lazy import so importing video_engine doesn't require proglog."""
    try:
        from proglog import ProgressBarLogger  # type: ignore
        return ProgressBarLogger
    except ImportError:  # pragma: no cover
        return object


_BaseLogger = _make_progress_logger_base()


class _ProgressBarLogger(_BaseLogger):  # type: ignore[misc]
    """Forward MoviePy's ``bar`` events to ``progress_callback``.

    MoviePy uses ``proglog`` to emit progress as it writes frames. The
    ``bars`` dict is keyed by bar name (``'t'`` for the timeline bar
    when writing video) and exposes ``index`` / ``total``. We map that
    to the 90→99 % band of the overall job so the SSE stream keeps
    moving during the encode step.
    """

    def __init__(self, progress_callback: Optional[Callable[[dict], None]]):
        try:
            super().__init__()  # type: ignore[misc]
        except Exception:
            pass
        self._cb = progress_callback
        self._last_pct: int = -1

    def bars_callback(self, bar, attr, value, old_value=None):  # type: ignore[override]
        if not self._cb or attr != "index":
            return
        bars = getattr(self, "bars", {}) or {}
        info = bars.get(bar) or {}
        total = info.get("total") or 0
        if not total:
            return
        # Map encode progress into 90→99 so it slots after the
        # composition phase already reported by ``_emit``.
        pct = 90 + int(9 * (value / total))
        if pct == self._last_pct:
            return
        self._last_pct = pct
        try:
            self._cb(
                {
                    "stage": "moviepy",
                    "progress": pct,
                    "message": f"Encoding... {value}/{total}",
                }
            )
        except Exception:
            pass


__all__ = [
    "VideoStudio",
    "VideoEngineError",
    "MovieEngineUnavailableError",
]
