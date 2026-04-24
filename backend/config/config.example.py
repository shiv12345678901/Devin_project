"""Configuration file for TextBro / Screenshot Studio.

Copy this file to ``config.py`` and fill in your actual values.

The backend talks to any OpenAI-compatible chat-completions endpoint
(OpenAI, Groq, Together, NVIDIA NIM, a local llama.cpp server, …).
"""

# ─── API Configuration ─────────────────────────────────────────────────────
#
# `API_KEY` and `API_URL` are used by the vision/OCR client
# (src/core/vision_client.py). `API_URL` is also used as the base URL for
# chat completions — each entry in MODELS_CONFIG below provides its own
# `api_key` so you can mix providers if you want.

API_KEY = "your-api-key-here"
API_URL = "https://api.groq.com/openai/v1"   # OpenAI-compatible endpoint

# ─── Chat Models (used by src/core/ai_client.py) ───────────────────────────
#
# The frontend exposes three choices: default / fast / quality. Feel free
# to point them at any model your provider exposes. Each entry MUST define
# `model`, `temperature`, `top_p`, `max_tokens`, and `api_key`.

MODELS_CONFIG = {
    "default": {
        "model": "llama-3.1-70b-versatile",
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": 16384,
        "api_key": API_KEY,
    },
    "fast": {
        "model": "llama-3.1-8b-instant",
        "temperature": 0.3,
        "top_p": 0.9,
        "max_tokens": 8192,
        "api_key": API_KEY,
    },
    "quality": {
        "model": "llama-3.1-70b-versatile",
        "temperature": 0.1,
        "top_p": 0.9,
        "max_tokens": 16384,
        "api_key": API_KEY,
    },
}

# ─── Vision Model (used by src/core/vision_client.py) ──────────────────────

MODEL_VISION = "llama-3.2-90b-vision-preview"
MODEL_VISION_FALLBACK = "llama-3.2-11b-vision-preview"

# ─── Application Settings ──────────────────────────────────────────────────

DEBUG = True
PORT = 5000
HOST = "0.0.0.0"

# ─── Output Folders (relative to backend/) ─────────────────────────────────

OUTPUT_FOLDER = "output/screenshots"
HTML_FOLDER = "output/html"

# ─── Screenshot Settings ───────────────────────────────────────────────────

DEFAULT_VIEWPORT_WIDTH = 1920
DEFAULT_VIEWPORT_HEIGHT = 1080
DEFAULT_ZOOM = 2.1
DEFAULT_OVERLAP = 15
MAX_SCREENSHOTS_LIMIT = 50

# ─── AI Settings ───────────────────────────────────────────────────────────

MAX_TOKENS = 16384
TEMPERATURE = 0.2

# ─── PowerPoint Automation Settings (Windows only) ─────────────────────────

POWERPOINT_ENABLED = True
POWERPOINT_TEMPLATE_PATH = "templates/powerpoint/default.pptm"
POWERPOINT_OUTPUT_FOLDER = "output/presentations"
POWERPOINT_VIDEO_FOLDER = "output/videos"

# ─── Slide Settings ────────────────────────────────────────────────────────

DEFAULT_SLIDE_DURATION = 3.0          # seconds per slide
DEFAULT_TRANSITION_TYPE = "fade"      # fade | push | wipe | none
DEFAULT_TRANSITION_DURATION = 0.5     # seconds for transition

# ─── Video Export Settings ─────────────────────────────────────────────────

VIDEO_RESOLUTION_WIDTH = 3840   # 4K width
VIDEO_RESOLUTION_HEIGHT = 2160  # 4K height
VIDEO_FPS = 30
VIDEO_QUALITY = 5               # 1-5, where 5 is highest
VIDEO_FORMAT = "mp4"

# ─── Image Insertion Settings ──────────────────────────────────────────────

IMAGE_FIT_MODE = "contain"      # contain | cover | fill
IMAGE_POSITION = "center"       # center | top | bottom
PRESERVE_ASPECT_RATIO = True
