import os
from openai import OpenAI

API_KEY = os.getenv("ZENMUX_API_KEY", "").strip()
API_BASE_URL = (os.getenv("ZENMUX_BASE_URL") or "https://zenmux.ai/api/v1").rstrip("/")
MODEL = os.getenv("ZENMUX_MODEL") or "anthropic/claude-fable-5-free"
PROMPT = os.getenv("ZENMUX_PROMPT") or "What is the meaning of life?"
TIMEOUT_SECONDS = float(os.getenv("ZENMUX_TIMEOUT_SECONDS", "20"))


def main() -> None:
    if not API_KEY:
        raise RuntimeError(
            "Set ZENMUX_API_KEY in backend/.env before running this script. "
            "The regular API_KEY in this project is for a different provider and will not work here."
        )

    client = OpenAI(
        base_url=API_BASE_URL,
        api_key=API_KEY,
        timeout=TIMEOUT_SECONDS,
        max_retries=1,
    )
    print(f"Base URL: {API_BASE_URL}")
    print(f"Model: {MODEL}")
    print(f"Timeout: {TIMEOUT_SECONDS}s")

    try:
        completion = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": PROMPT}],
            timeout=TIMEOUT_SECONDS,
        )
        print("\nChat completion output:")
        print(completion.choices[0].message.content)

        responses = client.responses.create(model=MODEL, input=PROMPT, timeout=TIMEOUT_SECONDS)
        print("\nResponses API output:")
        print(responses)
    except Exception as exc:
        raise RuntimeError(f"Request failed against {API_BASE_URL}: {exc}") from exc


if __name__ == "__main__":
    main()
