"""Dual-engine video builder.

Routes call :class:`VideoStudio` instead of touching the platform-specific
engines directly. The studio inspects the host OS (and the
``USE_POWERPOINT`` config flag) and dispatches to one of two engines:

- **Windows** → ``core.powerpoint.controller.PowerPointController`` driving
  PowerPoint via COM automation. Same behaviour the project has shipped
  on Windows since day one.
- **Linux / macOS** → FFmpeg first, with MoviePy as a compatibility fallback.
  Static slides use a variable-frame-rate pipeline while animated transitions,
  intro / outro clips, watermarking, and audio mixing stay inside FFmpeg.

Both engines accept the same ``config_data`` dict (see
:meth:`VideoStudio.build_video`) and return the same shape so the calling
route doesn't care which one ran.
"""
from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import subprocess
import queue
import threading
import time
from pathlib import Path
from typing import Any, Callable, List, Optional

from .settings import settings

logger = logging.getLogger(__name__)


def _run_ffmpeg_process(
    cmd: List[str],
    *,
    cancel_event=None,
    expected_duration: float | None = None,
    progress_callback: Optional[Callable[[dict], None]] = None,
    progress_range: tuple[int, int] = (90, 99),
    engine: str = "ffmpeg",
) -> None:
    """Run FFmpeg and translate ``-progress`` media time into stable ETA data."""
    command = list(cmd)
    if "-progress" not in command:
        command[1:1] = ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    # Lightweight test/process adapters may expose only ``communicate``.
    if not hasattr(proc, "stdout") or not hasattr(proc, "stderr"):
        stdout, stderr = proc.communicate()
        if proc.returncode:
            raise VideoEngineError(f"FFmpeg export failed: {(stderr or stdout or 'unknown error').strip()}")
        return
    lines: queue.Queue[str | None] = queue.Queue()
    stderr_lines: list[str] = []

    def read_stdout() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            lines.put(line.rstrip())
        lines.put(None)

    def read_stderr() -> None:
        assert proc.stderr is not None
        stderr_lines.extend(proc.stderr)

    threading.Thread(target=read_stdout, daemon=True, name="ffmpeg-progress").start()
    threading.Thread(target=read_stderr, daemon=True, name="ffmpeg-stderr").start()
    started = time.monotonic()
    last_emit = 0.0
    progress_values: dict[str, str] = {}
    try:
        while proc.poll() is None or not lines.empty():
            if cancel_event is not None and cancel_event.is_set():
                proc.terminate()
                raise VideoEngineError("Cancelled by user")
            try:
                line = lines.get(timeout=0.25)
            except queue.Empty:
                continue
            if line is None:
                continue
            key, separator, value = line.partition("=")
            if separator:
                progress_values[key] = value
            if key != "progress" or not progress_callback or not expected_duration:
                continue
            raw_us = progress_values.get("out_time_us") or progress_values.get("out_time_ms") or "0"
            try:
                encoded_seconds = max(0.0, float(raw_us) / 1_000_000.0)
            except ValueError:
                encoded_seconds = 0.0
            ratio = min(1.0, encoded_seconds / max(expected_duration, 0.001))
            now = time.monotonic()
            if now - last_emit < 0.5 and value != "end":
                continue
            last_emit = now
            low, high = progress_range
            percent = low + round((high - low) * ratio)
            elapsed = max(now - started, 0.001)
            eta = max(0.0, elapsed * (1.0 - ratio) / ratio) if ratio > 0 else None
            speed = progress_values.get("speed", "").strip()
            progress_callback({
                "stage": "ffmpeg",
                "engine": engine,
                "progress": percent,
                "encoded_seconds": round(encoded_seconds, 2),
                "total_seconds": round(expected_duration, 2),
                "eta_seconds": round(eta, 1) if eta is not None else None,
                "speed": speed or None,
                "message": f"Encoding with {engine}: {ratio * 100:.0f}% of media time" + (f" at {speed}" if speed else ""),
            })
    finally:
        if proc.poll() is None:
            proc.kill()
    proc.wait()
    if proc.returncode:
        raise VideoEngineError(f"FFmpeg export failed: {(''.join(stderr_lines) or 'unknown error').strip()}")


def _resolve_use_powerpoint() -> bool:
    """Read ``USE_POWERPOINT`` from the environment or typed settings."""
    override = os.environ.get("USE_POWERPOINT")
    if override is not None and override.strip():
        return override.strip().lower() in {"1", "true", "yes", "on"}
    return settings.use_powerpoint


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
_DEFAULT_CRF = 23
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
            ``transition_type``  – ``fade``, ``wipe``, ``push``, or ``none``
            ``transition_duration`` – seconds for still-image transitions
            ``progress_callback``   – ``fn(payload: dict)``
            ``cancel_event``        – threading.Event for cooperative cancel

        Optional FFmpeg / MoviePy keys:
            ``intro_video_path``    – intro MP4 before the screenshot slides
            ``outro_video_path``    – outro MP4 after the screenshot slides
            ``voiceover_files``     – ``list[Optional[str]]`` (one per slide)

        Returns:
            ``{'presentation_path': str | None, 'video_path': str, 'warning': str | None}``
        """
        if self.use_powerpoint:
            return self._build_with_powerpoint(config_data)
        if self._can_build_simple_with_ffmpeg(config_data):
            return self._build_simple_with_ffmpeg(config_data)
        if self._can_build_ffmpeg_transitions(config_data):
            return self._build_with_ffmpeg_transitions(config_data)
        return self._build_with_moviepy(config_data)

    # ──────────────────────────────────────────────────────────────────
    # Windows — PowerPoint COM
    # ──────────────────────────────────────────────────────────────────
    def _build_with_powerpoint(self, cfg: dict) -> dict:
        from .core.powerpoint.controller import PowerPointController

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
    def _sort_image_files_like_powerpoint(self, image_files: List[str]) -> List[str]:
        """Match PowerPointExporter.create_from_template screenshot ordering."""

        def sort_key(filepath: str) -> int:
            basename = os.path.basename(filepath)
            match = re.search(r"\((\d+)\)", basename)
            if match:
                return int(match.group(1))
            nums = re.findall(r"\d+", basename)
            return int(nums[-1]) if nums else 0

        return sorted(image_files, key=sort_key)

    def _quality_to_crf(self, cfg: dict) -> int:
        if cfg.get("encode_crf") is not None:
            return int(cfg["encode_crf"])

        raw_quality = cfg.get("quality")
        try:
            quality = int(raw_quality)
        except (TypeError, ValueError):
            return _DEFAULT_CRF

        # Some callers pass PowerPoint's legacy 1-5 quality, while queued
        # Linux runs pass the UI's 1-100 value. Convert both to a sane x264 CRF.
        if quality <= 5:
            quality = quality * 20
        quality = max(1, min(100, quality))
        return round(31 - (quality / 100) * 13)

    def _can_build_simple_with_ffmpeg(self, cfg: dict) -> bool:
        """Use ffmpeg directly for still-image timelines.

        MoviePy is flexible, but 4K still slides force Python to generate
        every frame. ffmpeg can hold each image for N seconds natively, which
        is much faster for the common screenshot-only export path.
        """
        if not shutil.which("ffmpeg"):
            return False

        image_files = list(cfg.get("image_files") or [])
        if not image_files or any(not Path(p).is_file() for p in image_files):
            return False

        transition_type, _transition_duration = self._transition_settings(cfg)
        # A single still has no boundary to animate, so a requested transition
        # is equivalent to a cut and can use the sparse VFR path.
        if transition_type != "none" and len(image_files) > 1:
            return False

        for key in (
            "intro_video_path",
            "outro_video_path",
            "narration_audio",
            "background_music",
            "logo_path",
        ):
            path = cfg.get(key)
            if path and not Path(path).is_file():
                return False

        voiceover_files = [p for p in list(cfg.get("voiceover_files") or []) if p]
        if any(not Path(p).is_file() for p in voiceover_files):
            return False
        if (voiceover_files or cfg.get("intro_video_path") or cfg.get("outro_video_path")) and not shutil.which("ffprobe"):
            return False

        return True

    def _transition_settings(self, cfg: dict) -> tuple[str, float]:
        """Resolve Linux still-image transition settings.

        The PowerPoint path owns its own transition implementation. These
        settings are intentionally used only by the Linux FFmpeg/MoviePy
        paths so the Windows export behavior remains unchanged.
        """
        transition_type = cfg.get("transition_type")
        transition_duration = cfg.get("transition_duration")
        if transition_type is None or transition_duration is None:
            if transition_type is None:
                transition_type = settings.default_transition_type
            if transition_duration is None:
                transition_duration = settings.default_transition_duration

        transition_type = str(transition_type or "fade").strip().lower()
        aliases = {
            "crossfade": "fade",
            "slide": "push",
            "none": "none",
            "cut": "none",
        }
        transition_type = aliases.get(transition_type, transition_type)
        if transition_type not in {"fade", "wipe", "push", "none"}:
            transition_type = "fade"
        try:
            duration = float(transition_duration)
        except (TypeError, ValueError):
            duration = 0.5
        return transition_type, max(0.0, duration)

    def _can_build_ffmpeg_transitions(self, cfg: dict) -> bool:
        """Return whether a still-image timeline can use FFmpeg natively.

        Full-track narration, per-slide voiceovers, looping background music,
        video intro/outro clips, and a watermark are handled inside FFmpeg.
        """
        if not shutil.which("ffmpeg"):
            return False
        transition_type, transition_duration = self._transition_settings(cfg)
        if transition_type != "none" and transition_duration <= 0:
            return False
        image_files = list(cfg.get("image_files") or [])
        if len(image_files) < 2 or any(not Path(p).is_file() for p in image_files):
            return False
        for key in (
            "narration_audio",
            "background_music",
            "logo_path",
            "intro_video_path",
            "outro_video_path",
        ):
            path = cfg.get(key)
            if path and not Path(path).is_file():
                return False
        voiceover_files = [p for p in list(cfg.get("voiceover_files") or []) if p]
        if any(not Path(p).is_file() for p in voiceover_files):
            return False
        if (voiceover_files or cfg.get("intro_video_path") or cfg.get("outro_video_path")) and not shutil.which("ffprobe"):
            return False
        return True

    def _ffprobe_duration(self, path: str) -> float:
        """Return media duration in seconds, raising a useful engine error."""
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        try:
            duration = float(probe.stdout.strip())
        except (TypeError, ValueError):
            duration = 0.0
        if probe.returncode or duration <= 0:
            detail = (probe.stderr or "duration unavailable").strip()
            raise VideoEngineError(f"ffprobe could not read {path}: {detail}")
        return duration

    def _ffprobe_has_audio(self, path: str) -> bool:
        if not shutil.which("ffprobe"):
            return False
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        return probe.returncode == 0 and bool(probe.stdout.strip())

    def _build_with_ffmpeg_transitions(self, cfg: dict) -> dict:
        """Encode a smoothly transitioned mixed-media timeline with FFmpeg."""
        image_files = self._sort_image_files_like_powerpoint(
            list(cfg.get("image_files") or [])
        )
        if len(image_files) < 2:
            raise VideoEngineError("FFmpeg transition engine requires at least two image files")

        output_video_path: str = cfg["output_video_path"]
        Path(output_video_path).parent.mkdir(parents=True, exist_ok=True)
        resolution = tuple(cfg.get("resolution") or _DEFAULT_RESOLUTION)
        fps = int(cfg.get("fps") or _DEFAULT_FPS)
        slide_duration = float(cfg.get("slide_duration", 5.0))
        transition_type, transition_duration = self._transition_settings(cfg)
        if slide_duration <= transition_duration:
            raise VideoEngineError(
                "Transition duration must be shorter than the slide duration"
            )

        encode_preset = str(cfg.get("encode_preset") or _DEFAULT_PRESET)
        encode_codec = str(cfg.get("encode_codec") or _DEFAULT_CODEC)
        encode_crf = self._quality_to_crf(cfg)
        thread_count = int(
            cfg.get("threads")
            or max(1, min((os.cpu_count() or 4), 16))
        )
        progress_callback: Optional[Callable[[dict], None]] = cfg.get("progress_callback")
        cancel_event = cfg.get("cancel_event")

        voiceover_files: List[Optional[str]] = list(cfg.get("voiceover_files") or [])
        voiceover_files += [None] * max(0, len(image_files) - len(voiceover_files))
        voiceover_files = voiceover_files[:len(image_files)]

        timeline: List[dict[str, Any]] = []
        intro_video = cfg.get("intro_video_path")
        if intro_video:
            timeline.append({
                "kind": "video",
                "path": str(intro_video),
                "duration": self._ffprobe_duration(str(intro_video)),
                "native_audio": self._ffprobe_has_audio(str(intro_video)),
            })
        intro_thumb = cfg.get("intro_thumbnail_path")
        if intro_thumb and Path(intro_thumb).is_file():
            timeline.append({
                "kind": "image",
                "path": str(intro_thumb),
                "duration": float(cfg.get("intro_thumbnail_duration", 5.0)),
            })
        for path, voiceover in zip(image_files, voiceover_files):
            voice_duration = self._ffprobe_duration(str(voiceover)) if voiceover else None
            timeline.append({
                "kind": "image",
                "path": str(path),
                # Match the legacy MoviePy behavior: a voiceover controls its
                # slide length; otherwise use the configured still duration.
                "duration": max(voice_duration or slide_duration, 0.1),
                "voiceover": str(voiceover) if voiceover else None,
            })
        outro_thumb = cfg.get("outro_thumbnail_path")
        if outro_thumb and Path(outro_thumb).is_file():
            timeline.append({
                "kind": "image",
                "path": str(outro_thumb),
                "duration": float(cfg.get("outro_thumbnail_duration", 5.0)),
            })
        outro_video = cfg.get("outro_video_path")
        if outro_video:
            timeline.append({
                "kind": "video",
                "path": str(outro_video),
                "duration": self._ffprobe_duration(str(outro_video)),
                "native_audio": self._ffprobe_has_audio(str(outro_video)),
            })

        if len(timeline) < 2:
            return self._build_simple_with_ffmpeg({**cfg, "transition_type": "none"})

        width, height = int(resolution[0]), int(resolution[1])
        boundary_durations = [
            min(
                transition_duration,
                float(timeline[index - 1]["duration"]) / 2,
                float(timeline[index]["duration"]) / 2,
            ) if transition_type != "none" else 0.0
            for index in range(1, len(timeline))
        ]
        starts = [0.0]
        for index in range(1, len(timeline)):
            starts.append(
                starts[-1]
                + float(timeline[index - 1]["duration"])
                - boundary_durations[index - 1]
            )
        total_duration = starts[-1] + float(timeline[-1]["duration"])

        transition_map = {
            "fade": "fade",
            "wipe": "wipeleft",
            "push": "slideleft",
        }
        xfade_name = transition_map.get(transition_type)
        transition_label = xfade_name or "cut"

        cmd: List[str] = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
        for item in timeline:
            if item["kind"] == "image":
                cmd.extend([
                    "-loop", "1", "-framerate", str(fps),
                    "-t", f"{float(item['duration']):.6f}", "-i", str(item["path"]),
                ])
            else:
                cmd.extend(["-i", str(item["path"])])

        voice_inputs: dict[int, int] = {}
        for timeline_index, item in enumerate(timeline):
            if item.get("voiceover"):
                voice_inputs[timeline_index] = len(timeline) + len(voice_inputs)
                cmd.extend(["-i", str(item["voiceover"])])

        audio_inputs: dict[str, int] = {}
        if cfg.get("narration_audio"):
            audio_inputs["narration_audio"] = len(timeline) + len(voice_inputs)
            cmd.extend(["-i", str(cfg["narration_audio"])])
        if cfg.get("background_music"):
            audio_inputs["background_music"] = len(timeline) + len(voice_inputs) + len(audio_inputs)
            cmd.extend(["-stream_loop", "-1", "-i", str(cfg["background_music"])])

        logo_index: int | None = None
        if cfg.get("logo_path"):
            logo_index = len(timeline) + len(voice_inputs) + len(audio_inputs)
            cmd.extend(["-loop", "1", "-i", str(cfg["logo_path"])])

        filters: List[str] = []
        for index, item in enumerate(timeline):
            duration = float(item["duration"])
            filters.append(
                f"[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
                f"fps={fps},format=yuv420p,trim=duration={duration:.6f},"
                f"setpts=PTS-STARTPTS[v{index}]"
            )

        current_label = "v0"
        if transition_type == "none":
            concat_inputs = "".join(f"[v{index}]" for index in range(len(timeline)))
            filters.append(
                f"{concat_inputs}concat=n={len(timeline)}:v=1:a=0[vout]"
            )
            current_label = "vout"
        else:
            for index in range(1, len(timeline)):
                boundary_duration = boundary_durations[index - 1]
                offset = starts[index]
                next_label = f"x{index}"
                filters.append(
                    f"[{current_label}][v{index}]xfade=transition={xfade_name}:"
                    f"duration={boundary_duration:.6f}:offset={offset:.6f}[{next_label}]"
                )
                current_label = next_label

        if logo_index is not None:
            filters.extend([
                f"[{logo_index}:v]format=rgba,scale=iw*0.12:-1,"
                "colorchannelmixer=aa=0.5[logo]",
                f"[{current_label}][logo]overlay=x=W-w-32:y=H-h-32:"
                "eof_action=repeat:format=auto[vfinal]",
            ])
            current_label = "vfinal"

        audio_labels: List[str] = []
        for timeline_index, item in enumerate(timeline):
            if item.get("native_audio"):
                label = f"clipaudio{timeline_index}"
                delay_ms = max(0, round(starts[timeline_index] * 1000))
                filters.append(
                    f"[{timeline_index}:a]aresample=48000,"
                    "aformat=sample_fmts=fltp:channel_layouts=stereo,"
                    f"atrim=duration={float(item['duration']):.6f},asetpts=PTS-STARTPTS,"
                    f"adelay={delay_ms}:all=1[{label}]"
                )
                audio_labels.append(label)
            if timeline_index in voice_inputs:
                label = f"voice{timeline_index}"
                delay_ms = max(0, round(starts[timeline_index] * 1000))
                input_index = voice_inputs[timeline_index]
                filters.append(
                    f"[{input_index}:a]aresample=48000,"
                    "aformat=sample_fmts=fltp:channel_layouts=stereo,"
                    f"atrim=duration={float(item['duration']):.6f},asetpts=PTS-STARTPTS,"
                    f"adelay={delay_ms}:all=1[{label}]"
                )
                audio_labels.append(label)
        if "narration_audio" in audio_inputs:
            index = audio_inputs["narration_audio"]
            filters.append(
                f"[{index}:a]aresample=48000,apad,atrim=duration={total_duration:.6f},"
                "asetpts=PTS-STARTPTS[narration]"
            )
            audio_labels.append("narration")
        if "background_music" in audio_inputs:
            index = audio_inputs["background_music"]
            filters.append(
                f"[{index}:a]aresample=48000,volume=0.1,"
                f"atrim=duration={total_duration:.6f},asetpts=PTS-STARTPTS[music]"
            )
            audio_labels.append("music")

        if len(audio_labels) > 1:
            mix_inputs = "".join(f"[{label}]" for label in audio_labels)
            filters.append(
                f"{mix_inputs}amix=inputs={len(audio_labels)}:"
                "duration=longest:dropout_transition=0:normalize=0,"
                "alimiter=limit=0.95,apad,"
                f"atrim=duration={total_duration:.6f}[aout]"
            )
        elif len(audio_labels) == 1:
            filters.append(
                f"[{audio_labels[0]}]apad,atrim=duration={total_duration:.6f}[aout]"
            )
        else:
            silence_input = len(timeline) + len(voice_inputs) + len(audio_inputs) + (1 if logo_index is not None else 0)
            cmd.extend([
                "-f", "lavfi",
                "-t", f"{total_duration:.6f}",
                "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            ])
            filters.append(
                f"[{silence_input}:a]atrim=duration={total_duration:.6f},"
                "asetpts=PTS-STARTPTS[aout]"
            )

        cmd.extend([
            "-filter_complex", ";".join(filters),
            "-map", f"[{current_label}]",
            "-map", "[aout]",
            "-t", f"{total_duration:.6f}",
            "-c:v", encode_codec,
            "-preset", encode_preset,
            "-crf", str(encode_crf),
            "-threads", str(thread_count),
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-ar", "48000",
            "-ac", "2",
            "-movflags", "+faststart",
            "-shortest",
            output_video_path,
        ])

        if progress_callback:
            try:
                resolution_label = f"{width}x{height}"
                progress_callback({
                    "stage": "ffmpeg",
                    "engine": "ffmpeg-transitions",
                    "progress": 90,
                    "message": (
                        f"Encoding {resolution_label} MP4 with FFmpeg ({transition_label}, "
                        f"{fps} fps, crf={encode_crf}, threads={thread_count})..."
                    ),
                })
            except Exception:
                logger.exception("progress_callback raised")

        _run_ffmpeg_process(
            cmd,
            cancel_event=cancel_event,
            expected_duration=total_duration,
            progress_callback=progress_callback,
            engine="ffmpeg-transitions",
        )

        if progress_callback:
            try:
                progress_callback({"stage": "ffmpeg", "engine": "ffmpeg-transitions", "progress": 99, "eta_seconds": 0, "message": "MP4 written to disk."})
            except Exception:
                logger.exception("progress_callback raised")

        return {
            "presentation_path": None,
            "video_path": output_video_path,
            "warning": None,
            "engine": "ffmpeg-transitions",
        }

    def _build_simple_with_ffmpeg(self, cfg: dict) -> dict:
        """Build a cut-only timeline with sparse VFR frames for still holds.

        Audio-only additions keep the already encoded video stream untouched.
        A watermark is the only media layer that requires a final video pass.
        """
        image_files: List[str] = self._sort_image_files_like_powerpoint(
            list(cfg.get("image_files") or [])
        )
        if not image_files:
            raise VideoEngineError("ffmpeg engine requires at least one image_file")

        output_video_path: str = cfg["output_video_path"]
        Path(output_video_path).parent.mkdir(parents=True, exist_ok=True)

        resolution = tuple(cfg.get("resolution") or _DEFAULT_RESOLUTION)
        fps = int(cfg.get("fps") or _DEFAULT_FPS)
        slide_duration = float(cfg.get("slide_duration", 5.0))
        encode_preset = str(cfg.get("encode_preset") or _DEFAULT_PRESET)
        encode_codec = str(cfg.get("encode_codec") or _DEFAULT_CODEC)
        encode_crf = self._quality_to_crf(cfg)
        thread_count = int(
            cfg.get("threads")
            or max(1, min((os.cpu_count() or 4), 16))
        )
        progress_callback: Optional[Callable[[dict], None]] = cfg.get("progress_callback")
        cancel_event = cfg.get("cancel_event")
        voiceover_files: List[Optional[str]] = list(cfg.get("voiceover_files") or [])
        voiceover_files += [None] * max(0, len(image_files) - len(voiceover_files))
        voiceover_files = voiceover_files[:len(image_files)]

        def _emit(progress: int, message: str) -> None:
            if progress_callback:
                try:
                    progress_callback(
                        {"stage": "ffmpeg", "engine": "ffmpeg-static-vfr", "progress": progress, "message": message}
                    )
                except Exception:
                    logger.exception("progress_callback raised")

        def _duration(value: Any, default: float) -> float:
            try:
                parsed = float(value)
            except Exception:
                return default
            return parsed if parsed > 0 else default

        timeline: List[tuple[str, float]] = []
        voice_starts: List[tuple[str, float, float]] = []
        slide_cursor = 0.0
        intro_thumb = cfg.get("intro_thumbnail_path")
        if intro_thumb and Path(intro_thumb).is_file():
            intro_thumb_duration = _duration(cfg.get("intro_thumbnail_duration"), 5.0)
            timeline.append(
                (str(intro_thumb), intro_thumb_duration)
            )
            slide_cursor += intro_thumb_duration
        for path, voiceover in zip(image_files, voiceover_files):
            duration = self._ffprobe_duration(str(voiceover)) if voiceover else slide_duration
            duration = max(duration, 0.1)
            timeline.append((str(path), duration))
            if voiceover:
                voice_starts.append((str(voiceover), slide_cursor, duration))
            slide_cursor += duration
        outro_thumb = cfg.get("outro_thumbnail_path")
        if outro_thumb and Path(outro_thumb).is_file():
            outro_thumb_duration = _duration(cfg.get("outro_thumbnail_duration"), 5.0)
            timeline.append(
                (str(outro_thumb), outro_thumb_duration)
            )
            slide_cursor += outro_thumb_duration

        width, height = int(resolution[0]), int(resolution[1])
        # Keep still-slide exports variable-frame-rate: one encoded frame can
        # be held for the slide duration instead of duplicating it to match fps.
        vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p"
        )

        def _concat_path(path: str) -> str:
            escaped = Path(path).resolve().as_posix().replace("'", "'\\''")
            return f"file '{escaped}'"

        def _run_ffmpeg(
            cmd: List[str],
            expected_duration: float | None = None,
            progress_range: tuple[int, int] = (90, 98),
        ) -> None:
            _run_ffmpeg_process(
                cmd,
                cancel_event=cancel_event,
                expected_duration=expected_duration,
                progress_callback=progress_callback,
                progress_range=progress_range,
                engine="ffmpeg-static-vfr",
            )

        def _video_segment(input_path: str, output_path: Path) -> None:
            cmd = [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                input_path,
            ]
            audio_index = "0:a:0"
            if not self._ffprobe_has_audio(input_path):
                cmd.extend(
                    [
                        "-f",
                        "lavfi",
                        "-i",
                        "anullsrc=channel_layout=stereo:sample_rate=48000",
                    ]
                )
                audio_index = "1:a:0"
            cmd.extend(
                [
                    "-map",
                    "0:v:0",
                    "-map",
                    audio_index,
                    "-vf",
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
                    f"fps={fps},format=yuv420p",
                    "-c:v",
                    encode_codec,
                    "-preset",
                    encode_preset,
                    "-crf",
                    str(encode_crf),
                    "-threads",
                    str(thread_count),
                    "-c:a",
                    "aac",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                ]
            )
            if audio_index == "0:a:0":
                cmd.extend(["-af", "apad"])
            cmd.extend(["-shortest", str(output_path)])
            _run_ffmpeg(cmd)

        _emit(
            90,
            f"Encoding static VFR MP4 with ffmpeg ({encode_codec} {encode_preset}, crf={encode_crf}, threads={thread_count})...",
        )
        output_path = Path(output_video_path)
        slide_concat_path = output_path.with_suffix(".slides.ffconcat")
        segment_concat_path = output_path.with_suffix(".segments.ffconcat")
        slide_segment_path = output_path.with_suffix(".slides.mp4")
        combined_path = output_path.with_suffix(".combined.mp4")
        segment_paths: List[Path] = []
        intro_video_duration = 0.0
        outro_video_duration = 0.0
        native_clip_audio = False
        try:
            intro_video = cfg.get("intro_video_path")
            if intro_video:
                intro_video_duration = self._ffprobe_duration(str(intro_video))
                native_clip_audio = native_clip_audio or self._ffprobe_has_audio(str(intro_video))
                intro_segment_path = output_path.with_suffix(".intro.mp4")
                _video_segment(str(intro_video), intro_segment_path)
                segment_paths.append(intro_segment_path)

            lines = ["ffconcat version 1.0"]
            for path, duration in timeline:
                lines.append(_concat_path(path))
                lines.append(f"duration {duration:.6f}")
            # The concat demuxer needs the final file repeated to honor its
            # duration instead of treating it as a single-frame tail.
            lines.append(_concat_path(timeline[-1][0]))
            slide_concat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

            total_slide_duration = sum(duration for _path, duration in timeline)
            _run_ffmpeg(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(slide_concat_path),
                    "-f",
                    "lavfi",
                    "-t",
                    f"{total_slide_duration:.6f}",
                    "-i",
                    "anullsrc=channel_layout=stereo:sample_rate=48000",
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-vf",
                    vf,
                    "-fps_mode",
                    "vfr",
                    "-c:v",
                    encode_codec,
                    "-preset",
                    encode_preset,
                    "-crf",
                    str(encode_crf),
                    "-threads",
                    str(thread_count),
                    "-c:a",
                    "aac",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-shortest",
                    str(slide_segment_path),
                ],
                expected_duration=total_slide_duration,
                progress_range=(90, 97),
            )
            segment_paths.append(slide_segment_path)

            outro_video = cfg.get("outro_video_path")
            if outro_video:
                outro_video_duration = self._ffprobe_duration(str(outro_video))
                native_clip_audio = native_clip_audio or self._ffprobe_has_audio(str(outro_video))
                outro_segment_path = output_path.with_suffix(".outro.mp4")
                _video_segment(str(outro_video), outro_segment_path)
                segment_paths.append(outro_segment_path)

            segment_lines = ["ffconcat version 1.0"]
            segment_lines.extend(_concat_path(str(path)) for path in segment_paths)
            segment_concat_path.write_text(
                "\n".join(segment_lines) + "\n",
                encoding="utf-8",
            )

            needs_media_pass = bool(
                voice_starts
                or cfg.get("narration_audio")
                or cfg.get("background_music")
                or cfg.get("logo_path")
            )
            concat_output_path = combined_path if needs_media_pass else output_path
            _run_ffmpeg(
                [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(segment_concat_path),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(concat_output_path),
                ]
            )

            if needs_media_pass:
                total_duration = intro_video_duration + total_slide_duration + outro_video_duration
                media_cmd: List[str] = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-i", str(combined_path),
                ]
                voice_input_indexes: List[tuple[int, float, float]] = []
                for voice_path, start, duration in voice_starts:
                    input_index = 1 + len(voice_input_indexes)
                    voice_input_indexes.append(
                        (input_index, intro_video_duration + start, duration)
                    )
                    media_cmd.extend(["-i", voice_path])

                narration_index: int | None = None
                if cfg.get("narration_audio"):
                    narration_index = 1 + len(voice_input_indexes)
                    media_cmd.extend(["-i", str(cfg["narration_audio"])])

                music_index: int | None = None
                if cfg.get("background_music"):
                    music_index = 1 + len(voice_input_indexes) + (1 if narration_index is not None else 0)
                    media_cmd.extend(["-stream_loop", "-1", "-i", str(cfg["background_music"])])

                logo_index: int | None = None
                if cfg.get("logo_path"):
                    logo_index = (
                        1 + len(voice_input_indexes)
                        + (1 if narration_index is not None else 0)
                        + (1 if music_index is not None else 0)
                    )
                    media_cmd.extend(["-loop", "1", "-i", str(cfg["logo_path"])])

                filters: List[str] = []
                audio_labels: List[str] = []
                if native_clip_audio:
                    filters.append(
                        f"[0:a]atrim=duration={total_duration:.6f},asetpts=PTS-STARTPTS[clipaudio]"
                    )
                    audio_labels.append("clipaudio")
                for number, (input_index, start, duration) in enumerate(voice_input_indexes):
                    label = f"voice{number}"
                    delay_ms = max(0, round(start * 1000))
                    filters.append(
                        f"[{input_index}:a]aresample=48000,"
                        "aformat=sample_fmts=fltp:channel_layouts=stereo,"
                        f"atrim=duration={duration:.6f},asetpts=PTS-STARTPTS,"
                        f"adelay={delay_ms}:all=1[{label}]"
                    )
                    audio_labels.append(label)
                if narration_index is not None:
                    filters.append(
                        f"[{narration_index}:a]aresample=48000,apad,"
                        f"atrim=duration={total_duration:.6f},asetpts=PTS-STARTPTS[narration]"
                    )
                    audio_labels.append("narration")
                if music_index is not None:
                    filters.append(
                        f"[{music_index}:a]aresample=48000,volume={_BG_MUSIC_VOLUME},"
                        f"atrim=duration={total_duration:.6f},asetpts=PTS-STARTPTS[music]"
                    )
                    audio_labels.append("music")

                if len(audio_labels) > 1:
                    mix_inputs = "".join(f"[{label}]" for label in audio_labels)
                    filters.append(
                        f"{mix_inputs}amix=inputs={len(audio_labels)}:duration=longest:"
                        "dropout_transition=0:normalize=0,"
                        "alimiter=limit=0.95,apad,"
                        f"atrim=duration={total_duration:.6f}[aout]"
                    )
                elif len(audio_labels) == 1:
                    filters.append(
                        f"[{audio_labels[0]}]apad,"
                        f"atrim=duration={total_duration:.6f}[aout]"
                    )

                video_map = "0:v:0"
                if logo_index is not None:
                    filters.extend([
                        f"[{logo_index}:v]format=rgba,scale=iw*0.12:-1,"
                        f"colorchannelmixer=aa={_WATERMARK_OPACITY}[logo]",
                        "[0:v][logo]overlay=x=W-w-32:y=H-h-32:"
                        "eof_action=repeat:format=auto[vout]",
                    ])
                    video_map = "[vout]"

                if filters:
                    media_cmd.extend(["-filter_complex", ";".join(filters)])
                media_cmd.extend(["-map", video_map])
                if audio_labels:
                    media_cmd.extend(["-map", "[aout]"])
                else:
                    media_cmd.extend(["-map", "0:a:0"])
                if logo_index is not None:
                    media_cmd.extend([
                        "-c:v", encode_codec, "-preset", encode_preset,
                        "-crf", str(encode_crf), "-threads", str(thread_count),
                        "-pix_fmt", "yuv420p", "-fps_mode", "vfr",
                    ])
                else:
                    media_cmd.extend(["-c:v", "copy"])
                media_cmd.extend([
                    "-c:a", "aac", "-ar", "48000", "-ac", "2",
                    "-t", f"{total_duration:.6f}", "-movflags", "+faststart",
                    output_video_path,
                ])
                _run_ffmpeg(media_cmd, expected_duration=total_duration, progress_range=(97, 99))
        finally:
            for path in [
                slide_concat_path,
                segment_concat_path,
                combined_path,
                *segment_paths,
            ]:
                try:
                    path.unlink()
                except OSError:
                    pass

        _emit(99, "MP4 written to disk.")
        return {
            "presentation_path": None,
            "video_path": output_video_path,
            "warning": None,
            "engine": "ffmpeg",
        }

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
                "The direct FFmpeg path is unavailable and the optional MoviePy "
                "fallback is not installed. Install the system `ffmpeg` + "
                "`ffprobe` binaries."
            ) from exc

        image_files: List[str] = self._sort_image_files_like_powerpoint(
            list(cfg.get("image_files") or [])
        )
        if not image_files:
            raise VideoEngineError("MoviePy engine requires at least one image_file")

        output_video_path: str = cfg["output_video_path"]
        Path(output_video_path).parent.mkdir(parents=True, exist_ok=True)

        resolution = tuple(cfg.get("resolution") or _DEFAULT_RESOLUTION)
        fps = int(cfg.get("fps") or _DEFAULT_FPS)
        slide_duration = float(cfg.get("slide_duration", 5.0))
        encode_preset = str(cfg.get("encode_preset") or _DEFAULT_PRESET)
        encode_codec = str(cfg.get("encode_codec") or _DEFAULT_CODEC)
        encode_crf = self._quality_to_crf(cfg)
        thread_count = int(
            cfg.get("threads")
            or max(1, min((os.cpu_count() or 4), 16))
        )
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

            # Export — default H.264 ultrafast, with configurable knobs.
            _emit(
                "moviepy",
                90,
                f"Encoding MP4 ({encode_codec} {encode_preset}, crf={encode_crf}, threads={thread_count})...",
            )
            ffmpeg_logger = _ProgressBarLogger(progress_callback)
            ffmpeg_params = [
                "-movflags", "+faststart",
                "-pix_fmt", "yuv420p",
                "-crf", str(encode_crf),
            ]
            timeline.write_videofile(
                output_video_path,
                codec=encode_codec,
                preset=encode_preset,
                fps=fps,
                audio_codec="aac" if timeline.audio is not None else None,
                threads=thread_count,
                ffmpeg_params=ffmpeg_params,
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
