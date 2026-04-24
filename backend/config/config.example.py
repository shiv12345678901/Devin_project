"""Configuration file for Screenshot Studio.

Copy this file to config.py and fill in your actual values.
"""

# API Configuration
API_KEY = "your-api-key-here"
API_URL = "https://api.example.com/v1"
MODEL = "meta/llama-3.1-70b-instruct"

# Application Settings
DEBUG = True
PORT = 5000
HOST = "0.0.0.0"

# Output Settings
OUTPUT_FOLDER = "output/screenshots"
HTML_FOLDER = "output/html"

# Screenshot Settings
DEFAULT_VIEWPORT_WIDTH = 1920
DEFAULT_VIEWPORT_HEIGHT = 1080
DEFAULT_ZOOM = 2.1
DEFAULT_OVERLAP = 15
MAX_SCREENSHOTS_LIMIT = 50

# AI Settings
MAX_TOKENS = 16384
TEMPERATURE = 0.2

# PowerPoint Automation Settings
POWERPOINT_ENABLED = True  # Enable/disable PowerPoint features
POWERPOINT_TEMPLATE_PATH = "templates/powerpoint/default.pptm"  # Default template
POWERPOINT_OUTPUT_FOLDER = "output/presentations"  # Where to save presentations
POWERPOINT_VIDEO_FOLDER = "output/videos"  # Where to save videos

# Slide Settings
DEFAULT_SLIDE_DURATION = 3.0  # Seconds per slide
DEFAULT_TRANSITION_TYPE = "fade"  # fade, push, wipe, none
DEFAULT_TRANSITION_DURATION = 0.5  # Seconds for transition

# Video Export Settings
VIDEO_RESOLUTION_WIDTH = 3840  # 4K width
VIDEO_RESOLUTION_HEIGHT = 2160  # 4K height
VIDEO_FPS = 30  # Frames per second
VIDEO_QUALITY = 5  # 1-5, where 5 is highest quality
VIDEO_FORMAT = "mp4"  # Output format

# Image Insertion Settings
IMAGE_FIT_MODE = "contain"  # contain, cover, fill
IMAGE_POSITION = "center"  # center, top, bottom
PRESERVE_ASPECT_RATIO = True
