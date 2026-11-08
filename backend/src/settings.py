"""Immutable, typed application settings.

Environment variables are the public configuration API. Values are validated
and copied into frozen dataclasses at process start; application code never
imports or mutates executable configuration modules.
"""
from __future__ import annotations

import os
import platform
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

try:
    from dotenv import load_dotenv

    for _env_file in (PROJECT_DIR / ".env", BACKEND_DIR / ".env"):
        if _env_file.is_file():
            load_dotenv(_env_file, override=False)
except ImportError:  # pragma: no cover - requirements install python-dotenv
    pass


def _bool(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _integer(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _value(name: str, default: Any) -> Any:
    return os.environ.get(name, default)


def _default_models(api_key: str, default_max_tokens: int) -> dict[str, dict[str, Any]]:
    def model(name: str, slug: str, tokens: int, temperature: float = 0.6, top_p: float = 0.95, **extra: Any) -> dict[str, Any]:
        result = {
            "model": str(_value(name, slug)),
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": _integer(_value(f"MAX_TOKENS_{name.removeprefix('MODEL_')}", tokens), tokens),
            "api_key": api_key,
        }
        result.update(extra)
        return result

    return {
        "default": model("MODEL_DEFAULT", "qwen/qwen3.5-122b-a10b", 16384),
        "fast": model("MODEL_FAST", "deepseek-ai/deepseek-v4-flash", 16384, 1, extra_body={"chat_template_kwargs": {"thinking": True, "reasoning_effort": "high"}}),
        "short": model("MODEL_SHORT", "nvidia/llama-3.1-nemotron-nano-8b-v1", 4096),
        "balanced": model("MODEL_BALANCED", "z-ai/glm-5.1", 16384, 1, 1),
        "quality": model("MODEL_QUALITY", "nvidia/nemotron-3-super-120b-a12b", 16384, 1, extra_body={"chat_template_kwargs": {"enable_thinking": True}, "reasoning_budget": 16384}),
        "long": model("MODEL_LONG", "deepseek-ai/deepseek-v4-pro", 16384, 1, extra_body={"chat_template_kwargs": {"thinking": False}}),
        "llama": model("MODEL_LLAMA", "meta/llama-3.3-70b-instruct", default_max_tokens, 0.2, 0.9),
    }


@dataclass(frozen=True, slots=True)
class RetentionSettings:
    enabled: bool = True
    run_days: int = 30
    max_runs: int = 500
    history_days: int = 30
    max_history: int = 500
    cache_days: int = 7
    max_cache_entries: int = 100
    min_free_disk_gb: float = 2.0
    output_days: int = 30


@dataclass(frozen=True, slots=True)
class Settings:
    api_key: str
    api_url: str
    models: Mapping[str, Mapping[str, Any]]
    model_vision: str
    model_vision_fallback: str
    host: str
    port: int
    debug: bool
    use_powerpoint: bool
    max_content_length_bytes: int
    cors_origins: tuple[str, ...]
    database_path: Path
    output_folder: str = "output/screenshots"
    html_folder: str = "output/html"
    powerpoint_template_path: str = "templates/powerpoint/default.pptm"
    powerpoint_output_folder: str = "output/presentations"
    powerpoint_video_folder: str = "output/videos"
    default_transition_type: str = "fade"
    default_transition_duration: float = 0.5
    retention: RetentionSettings = field(default_factory=RetentionSettings)


def load_settings() -> Settings:
    api_key = str(_value("API_KEY", "your-api-key-here"))
    max_tokens = _integer(_value("MAX_TOKENS", 32768), 32768)
    models = _default_models(api_key, max_tokens)
    cors = str(_value("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"))
    retention = RetentionSettings(
        enabled=_bool(_value("RETENTION_ENABLED", platform.system() == "Linux")),
        run_days=_integer(_value("RETENTION_RUN_DAYS", 30), 30),
        max_runs=_integer(_value("RETENTION_MAX_RUNS", 500), 500),
        history_days=_integer(_value("RETENTION_HISTORY_DAYS", 30), 30),
        max_history=_integer(_value("RETENTION_MAX_HISTORY", 500), 500),
        cache_days=_integer(_value("RETENTION_CACHE_DAYS", 7), 7),
        max_cache_entries=_integer(_value("RETENTION_MAX_CACHE_ENTRIES", 100), 100),
        min_free_disk_gb=float(_value("RETENTION_MIN_FREE_DISK_GB", 2.0)),
        output_days=_integer(_value("RETENTION_OUTPUT_DAYS", 30), 30),
    )
    frozen_models = MappingProxyType({key: MappingProxyType(dict(value)) for key, value in models.items()})
    db_raw = Path(str(_value("DATABASE_PATH", "output/textbro.sqlite3")))
    return Settings(
        api_key=api_key,
        api_url=str(_value("API_URL", "https://integrate.api.nvidia.com/v1")),
        models=frozen_models,
        model_vision=str(_value("MODEL_VISION", "nvidia/llama-3.1-nemotron-nano-vl-8b-v1")),
        model_vision_fallback=str(_value("MODEL_VISION_FALLBACK", "meta/llama-3.2-90b-vision-instruct")),
        host=str(_value("HOST", "127.0.0.1")),
        port=_integer(_value("PORT", 5000), 5000),
        debug=_bool(_value("DEBUG", False)),
        use_powerpoint=_bool(_value("USE_POWERPOINT", None), platform.system() == "Windows"),
        max_content_length_bytes=_integer(_value("MAX_CONTENT_LENGTH_BYTES", 64 * 1024 * 1024), 64 * 1024 * 1024),
        cors_origins=tuple(item.strip() for item in cors.split(",") if item.strip()),
        database_path=db_raw if db_raw.is_absolute() else PROJECT_DIR / db_raw,
        output_folder=str(_value("OUTPUT_FOLDER", "output/screenshots")),
        html_folder=str(_value("HTML_FOLDER", "output/html")),
        powerpoint_template_path=str(_value("POWERPOINT_TEMPLATE_PATH", str(BACKEND_DIR / "templates" / "powerpoint" / "default.pptm"))),
        powerpoint_output_folder=str(_value("POWERPOINT_OUTPUT_FOLDER", "output/presentations")),
        powerpoint_video_folder=str(_value("POWERPOINT_VIDEO_FOLDER", "output/videos")),
        default_transition_type=str(_value("DEFAULT_TRANSITION_TYPE", "fade")),
        default_transition_duration=float(_value("DEFAULT_TRANSITION_DURATION", 0.5)),
        retention=retention,
    )


settings = load_settings()

