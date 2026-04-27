"""Configuration for TextBro / Screenshot Studio.

Copy this file to ``config.py`` (which is gitignored) and fill in your
actual values. Every entry can also be supplied through an environment
variable (or a ``.env`` file in the project root) — env wins over the
literal default below, so you can keep an unredacted ``config.py`` empty
on shared machines.

Env vars used:
    API_KEY, API_URL, MODEL_VISION, MODEL_VISION_FALLBACK
    HOST, PORT, DEBUG, MAX_CONTENT_LENGTH_BYTES
    CORS_ORIGINS  (comma-separated allowlist; ``*`` for wide-open)
    RATE_LIMIT, RATE_LIMIT_DEFAULT  (e.g. RATE_LIMIT_DEFAULT="60/minute;10/second")
    PREFLIGHT_CACHE_SECS

The backend talks to any OpenAI-compatible chat-completions endpoint
(OpenAI, Groq, Together, NVIDIA NIM, a local llama.cpp server, …).
"""
import os


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


# ─── API Configuration ─────────────────────────────────────────────────────
#
# `API_KEY` and `API_URL` are used by the vision/OCR client
# (src/core/vision_client.py). `API_URL` is also used as the base URL for
# chat completions — each entry in MODELS_CONFIG below provides its own
# `api_key` so you can mix providers if you want.

API_KEY = _env("API_KEY", "your-api-key-here")
API_URL = _env("API_URL", "https://integrate.api.nvidia.com/v1")
DEFAULT_MAX_TOKENS = int(_env("MAX_TOKENS", "32768"))

# ─── Chat Models (used by src/core/ai_client.py) ───────────────────────────
#
# The frontend exposes named model choices. Feel free
# to point them at any model your provider exposes. Each entry MUST define
# `model`, `temperature`, `top_p`, `max_tokens`, and `api_key`.

# The keys here are what the UI ships as `model_choice`. Each one maps
# to a build.nvidia.com model slug that is callable through
# `https://integrate.api.nvidia.com/v1`. See
# https://build.nvidia.com/models for the live catalog — "Free Endpoint"
# models are always callable with a developer API key, "Downloadable"
# entries require self-hosting.

MODELS_CONFIG = {
    # Default — Qwen 3.5 122B MoE (10B active). Large + capable; user
    # pick from the UI's "Default" slot.
    "default": {
        "model": _env("MODEL_DEFAULT", "qwen/qwen3.5-122b-a10b"),
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": int(_env("MAX_TOKENS_DEFAULT", str(DEFAULT_MAX_TOKENS))),
        "api_key": API_KEY,
    },
    # Fast — DeepSeek V4 Flash (284B MoE, 1M ctx), tuned for throughput.
    "fast": {
        "model": _env("MODEL_FAST", "deepseek-ai/deepseek-v4-flash"),
        "temperature": 0.3,
        "top_p": 0.9,
        "max_tokens": int(_env("MAX_TOKENS_FAST", str(DEFAULT_MAX_TOKENS))),
        "api_key": API_KEY,
    },
    # Short & fastest — Llama 3.1 8B Instruct for very low latency runs.
    "short": {
        "model": _env("MODEL_SHORT", "meta/llama-3.1-8b-instruct"),
        "temperature": 0.3,
        "top_p": 0.9,
        "max_tokens": int(_env("MAX_TOKENS_SHORT", str(DEFAULT_MAX_TOKENS))),
        "api_key": API_KEY,
    },
    # Balanced — GLM-4.7 (358B, 131K ctx). Solid middle ground for
    # coding / HTML generation + tool calling.
    "balanced": {
        "model": _env("MODEL_BALANCED", "z-ai/glm-4.7"),
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": int(_env("MAX_TOKENS_BALANCED", str(DEFAULT_MAX_TOKENS))),
        "api_key": API_KEY,
    },
    # Quality — DeepSeek V3.2 (685B), long-context reasoning.
    "quality": {
        "model": _env("MODEL_QUALITY", "deepseek-ai/deepseek-v3.2"),
        "temperature": 0.1,
        "top_p": 0.9,
        "max_tokens": int(_env("MAX_TOKENS_QUALITY", str(DEFAULT_MAX_TOKENS))),
        "api_key": API_KEY,
    },
    # Long context — DeepSeek V4 Pro (1.6T MoE, 49B active, 1M ctx).
    "long": {
        "model": _env("MODEL_LONG", "deepseek-ai/deepseek-v4-pro"),
        "temperature": 0.1,
        "top_p": 0.9,
        "max_tokens": int(_env("MAX_TOKENS_LONG", str(DEFAULT_MAX_TOKENS))),
        "api_key": API_KEY,
    },
    # Llama 3.3 70B kept for back-compat with old stored runs that set
    # `model_choice: "llama"`. New UI does not expose it separately.
    "llama": {
        "model": _env("MODEL_LLAMA", "meta/llama-3.3-70b-instruct"),
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": int(_env("MAX_TOKENS_LLAMA", str(DEFAULT_MAX_TOKENS))),
        "api_key": API_KEY,
    },
}

# ─── Vision Model (used by src/core/vision_client.py) ──────────────────────

MODEL_VISION = _env("MODEL_VISION", "nvidia/llama-3.1-nemotron-nano-vl-8b-v1")
MODEL_VISION_FALLBACK = _env("MODEL_VISION_FALLBACK", "meta/llama-3.2-90b-vision-instruct")

# ─── Application Settings ──────────────────────────────────────────────────
#
# Defaults mirror the safe values used by ``app.py`` when run as a script.
# DEBUG defaults to False to avoid the Werkzeug debugger (which is
# remote-code-execution-by-design) being on accidentally.

DEBUG = _env("DEBUG", "0").lower() in {"1", "true", "yes", "on"}
PORT = int(_env("PORT", "5000"))
HOST = _env("HOST", "127.0.0.1")  # bind to loopback by default

# ─── Output Folders (relative to backend/) ─────────────────────────────────

OUTPUT_FOLDER = "output/screenshots"
HTML_FOLDER = "output/html"

# ─── Screenshot Settings ───────────────────────────────────────────────────

DEFAULT_VIEWPORT_WIDTH = 1920
DEFAULT_VIEWPORT_HEIGHT = 1080
DEFAULT_ZOOM = 2.1
DEFAULT_OVERLAP = 15
MAX_SCREENSHOTS_LIMIT = 50

# Cap on how many pages we'll rasterize from a PDF in /extract-from-image.
PDF_MAX_PAGES = int(_env("PDF_MAX_PAGES", "100"))

# ─── AI Settings ───────────────────────────────────────────────────────────

MAX_TOKENS = DEFAULT_MAX_TOKENS
TEMPERATURE = 0.2

# ─── PowerPoint Automation Settings (Windows only) ─────────────────────────

POWERPOINT_ENABLED = True
POWERPOINT_TEMPLATE_PATH = "templates/powerpoint/default.pptm"
POWERPOINT_OUTPUT_FOLDER = "output/presentations"
POWERPOINT_VIDEO_FOLDER = "output/videos"

# ─── Slide Settings ────────────────────────────────────────────────────────

DEFAULT_SLIDE_DURATION = 5.0          # seconds per slide
DEFAULT_TRANSITION_TYPE = "fade"      # fade | push | wipe | none
DEFAULT_TRANSITION_DURATION = 0.5     # seconds for transition

# ─── Video Export Settings ─────────────────────────────────────────────────

VIDEO_RESOLUTION_WIDTH = 1920
VIDEO_RESOLUTION_HEIGHT = 1080
VIDEO_FPS = 30
VIDEO_QUALITY = 5               # 1-5, where 5 is highest
VIDEO_FORMAT = "mp4"

# ─── Image Insertion Settings ──────────────────────────────────────────────

IMAGE_FIT_MODE = "contain"      # contain | cover | fill
IMAGE_POSITION = "center"       # center | top | bottom
PRESERVE_ASPECT_RATIO = True
