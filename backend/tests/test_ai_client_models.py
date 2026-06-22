import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core import ai_client  # noqa: E402


def test_resolve_model_config_upgrades_deprecated_balanced_slug(monkeypatch):
    monkeypatch.setitem(ai_client.MODELS_CONFIG, "balanced", {
        "model": "z-ai/glm-4.7",
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": 32768,
        "api_key": "test-key",
    })

    resolved = ai_client.resolve_model_config("balanced")

    assert resolved["model"] == "z-ai/glm-5.1"
    assert ai_client.MODELS_CONFIG["balanced"]["model"] == "z-ai/glm-4.7"


def test_resolve_model_config_keeps_qwen_122b_default():
    resolved = ai_client.resolve_model_config("default")

    assert resolved["model"] == "qwen/qwen3.5-122b-a10b"


def test_get_ai_response_falls_back_when_requested_model_is_degraded(monkeypatch):
    calls = []

    monkeypatch.setattr(ai_client, "make_openai_client", lambda _config: object())
    monkeypatch.setattr(ai_client.cache, "get", lambda _key: None)
    monkeypatch.setattr(ai_client.cache, "set", lambda _key, _value: None)

    def fake_request(_client, _system_prompt, _input_text, model_config, cancel_event=None):
        calls.append(model_config["model"])
        if model_config["model"] == "qwen/qwen3.5-122b-a10b":
            raise RuntimeError("DEGRADED function cannot be invoked")
        return "<main>ok</main>"

    monkeypatch.setattr(ai_client, "_make_ai_request", fake_request)

    response = ai_client.get_ai_response("hello", use_cache=False, system_prompt="system", model_choice="default")

    assert response == "<main>ok</main>"
    assert calls[:2] == ["qwen/qwen3.5-122b-a10b", "z-ai/glm-5.1"]


def test_missing_content_reason_detects_truncated_numbered_questions():
    source = "\n".join(f"{i}. Question {i}\nAnswer {i}" for i in range(1, 11))
    html = "<html><body>" + "".join(
        f"<div class='question'>{i}. Question {i}</div><div class='answer'>Answer {i}</div>"
        for i in range(1, 8)
    ) + "</body></html>"

    reason = ai_client.missing_content_reason(source, html)

    assert reason is not None
    assert "8" in reason
    assert "10" in reason
