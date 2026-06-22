"""AI API client for processing text input."""
import os
import re
import sys
import threading
import httpx  # type: ignore
from openai import OpenAI  # type: ignore

# Add config to path
config_path = os.path.join(os.path.dirname(__file__), '..', '..', 'config')
sys.path.insert(0, config_path)

from config import API_URL, MODELS_CONFIG  # type: ignore

# Add utils to path
utils_path = os.path.join(os.path.dirname(__file__), '..', 'utils')
sys.path.insert(0, utils_path)

from cache_manager import CacheManager  # type: ignore
from retry_handler import retry_with_backoff  # type: ignore

# Initialize cache manager
cache = CacheManager()

MODEL_SLUG_ALIASES = {
    "z-ai/glm-4.7": "z-ai/glm-5.1",
    "deepseek-ai/deepseek-v3.2": "nvidia/nemotron-3-super-120b-a12b",
    "meta/llama-3.1-8b-instruct": "nvidia/llama-3.1-nemotron-nano-8b-v1",
}

MODEL_FALLBACK_ORDER = ("balanced", "fast", "long", "quality", "short", "default")


def resolve_model_config(model_choice='default'):
    """Return a copy of the selected model config with deprecated slugs upgraded."""
    model_config = dict(MODELS_CONFIG.get(model_choice, MODELS_CONFIG['default']))
    model = model_config.get('model')
    replacement = MODEL_SLUG_ALIASES.get(model)
    if replacement:
        print(f"🔁 Upgrading deprecated model slug: {model} -> {replacement}", flush=True)
        model_config['model'] = replacement
    return model_config


def model_fallback_choices(model_choice='default'):
    """Return the requested model choice followed by safe fallback choices."""
    choices = []
    for choice in (model_choice, *MODEL_FALLBACK_ORDER):
        if choice in MODELS_CONFIG and choice not in choices:
            choices.append(choice)
    return choices


def is_model_unavailable_error(exc):
    message = str(exc).lower()
    return (
        type(exc).__name__ == 'NotFoundError'
        or 'degraded function cannot be invoked' in message
        or '404 page not found' in message
        or 'model not found' in message
        or 'model_not_found' in message
    )


def make_openai_client(model_config):
    placeholder_keys = {'', 'your-api-key-here', 'REPLACE_ME'}
    resolved_key = (model_config.get('api_key') or '').strip()
    if resolved_key in placeholder_keys:
        raise RuntimeError(
            "AI is not configured: API_KEY is missing or a placeholder. "
            "Edit backend/config/config.py (or set the API_KEY env var) "
            "with a real key and restart the backend."
        )

    connect_timeout = float(os.environ.get('AI_CONNECT_TIMEOUT', '15'))
    read_timeout = float(os.environ.get('AI_READ_TIMEOUT', '600'))
    return OpenAI(
        base_url=API_URL,
        api_key=resolved_key,
        timeout=httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=30.0,
            pool=30.0,
        ),
        max_retries=0,  # _make_ai_request already handles retries
    )


def clean_ai_response(full_response):
    full_response = full_response.strip()
    if full_response.startswith("```html"):
        full_response = full_response[7:]  # Remove ```html
    if full_response.startswith("```"):
        full_response = full_response[3:]  # Remove ```
    if full_response.endswith("```"):
        full_response = full_response[:-3]  # Remove trailing ```
    return full_response.strip()


_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def _plain_text(value):
    value = re.sub(r"(?is)<style.*?</style>|<script.*?</script>", " ", value or "")
    value = re.sub(r"(?s)<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value.translate(_DEVANAGARI_DIGITS)).strip()


def _numbered_items(value):
    text = _plain_text(value)
    found = set()
    for match in re.finditer(r"(?:^|\s)(?:q(?:uestion)?\s*)?([0-9]{1,3})\s*(?:[.)।:]|\-)", text, re.I):
        number = int(match.group(1))
        if 0 < number < 200:
            found.add(number)
    return found


def _tail_segments(value):
    text = _plain_text(value)
    pieces = [
        p.strip()
        for p in re.split(r"(?:\n+|[।.!?]\s+)", text)
        if len(p.strip()) >= 35
    ]
    return pieces[-4:]


def missing_content_reason(input_text, html_content):
    """Detect obvious partial output, especially numbered Q/A lists cut short."""
    input_numbers = _numbered_items(input_text)
    output_numbers = _numbered_items(html_content)
    if input_numbers:
        missing = sorted(input_numbers - output_numbers)
        # A missing tail like 8,9,10 is a strong signal. Missing scattered
        # numbers can happen inside examples, so require the highest input
        # number to be absent or at least two missing items.
        if missing and (max(input_numbers) in missing or len(missing) >= 2):
            return f"Missing numbered items from input: {', '.join(map(str, missing[:12]))}"

    output_text = _plain_text(html_content).lower()
    tail_missing = [
        segment
        for segment in _tail_segments(input_text)
        if segment.lower()[:80] not in output_text
    ]
    if len(tail_missing) >= 2:
        return "The ending/tail content from the input is missing in the generated HTML."
    return None


def _tail_source_for_repair(input_text, html_content):
    input_text = input_text.strip()
    input_numbers = _numbered_items(input_text)
    output_numbers = _numbered_items(html_content)
    missing = sorted(input_numbers - output_numbers)
    if missing:
        first = missing[0]
        pattern = re.compile(rf"(?m)(?:^|\n)\s*(?:q(?:uestion)?\s*)?{first}\s*(?:[.)।:]|\-)")
        match = pattern.search(input_text.translate(_DEVANAGARI_DIGITS))
        if match:
            return input_text[match.start():].strip()
    return input_text[-6000:].strip()


def append_missing_content(input_text, html_content, cancel_event=None, model_choice='default'):
    reason = missing_content_reason(input_text, html_content)
    if not reason:
        return html_content, None

    missing_source = _tail_source_for_repair(input_text, html_content)
    repair_prompt = (
        "You are repairing an incomplete educational HTML document.\n"
        "The previous HTML omitted content from the original input.\n"
        "Generate ONLY HTML body fragments for the missing source content below.\n"
        "Do not output <!DOCTYPE>, <html>, <head>, <body>, CSS, markdown, or explanations.\n"
        "Do not repeat content that is already in the previous HTML.\n"
        "Preserve every question, answer, option, example, and paragraph from the missing source.\n"
        "Use the same classes when useful: content-card, question, answer, vocabulary-item, section-title.\n"
    )
    repair_input = (
        f"Reason detected: {reason}\n\n"
        f"--- PREVIOUS HTML TAIL ---\n{html_content[-4000:]}\n\n"
        f"--- MISSING SOURCE CONTENT TO CONVERT ---\n{missing_source}"
    )
    fragment = get_ai_response(
        repair_input,
        use_cache=False,
        cancel_event=cancel_event,
        system_prompt=repair_prompt,
        model_choice=model_choice,
    )
    if not fragment:
        return html_content, reason

    marker = "\n<section class=\"content-card repaired-missing-content\">\n"
    repaired = marker + clean_ai_response(fragment) + "\n</section>\n"
    lower = html_content.lower()
    body_idx = lower.rfind("</body>")
    if body_idx >= 0:
        return html_content[:body_idx] + repaired + html_content[body_idx:], reason
    html_idx = lower.rfind("</html>")
    if html_idx >= 0:
        return html_content[:html_idx] + repaired + html_content[html_idx:], reason
    return html_content + repaired, reason


def load_system_prompt():
    """Load the system prompt from file."""
    try:
        prompt_path = os.path.join(os.path.dirname(__file__), '..', '..', 'config', 'system_prompt.txt')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return """You are an expert web developer. Convert the raw text notes into properly formatted HTML content using CSS classes: .exercise-title, .question, .answer, .vocabulary-item, .section-number. Output ONLY the HTML content without DOCTYPE, html, head, or body tags."""


@retry_with_backoff(max_retries=3, base_delay=2, max_delay=30)
def _make_ai_request(client, system_prompt, user_text, model_config, cancel_event=None):
    """Make the actual AI request with proper system/user roles (wrapped with retry logic)."""
    
    # Safely handle extra_body params if they are defined
    kwargs = {
        "model": model_config['model'],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text}
        ],
        "temperature": model_config['temperature'],
        "top_p": model_config['top_p'],
        "max_tokens": model_config['max_tokens'],
        "stream": True,
    }
    
    if model_config.get('extra_body'):
        kwargs['extra_body'] = model_config['extra_body']
        
    if model_config.get('seed'):
        kwargs['seed'] = model_config['seed']
        
    completion = client.chat.completions.create(**kwargs)
    
    # Collect streamed response
    full_response = ""
    print("📥 Receiving response:", flush=True)
    
    last_print_len: int = 0
    for chunk in completion:
        # Check for cancellation
        if cancel_event and cancel_event.is_set():
            print("\n⚠️ Request cancelled by user", flush=True)
            raise CancelledError("Generation cancelled by user")
        
        if not getattr(chunk, "choices", None):
            continue
            
        # Handle reasoning content (thought process) if present
        reasoning = getattr(chunk.choices[0].delta, "reasoning_content", None)
        if reasoning:
            print(reasoning, end="", flush=True)
            continue # Don't add reasoning to full_response to avoid corrupting HTML
            
        if chunk.choices[0].delta.content is not None:
            content = chunk.choices[0].delta.content
            full_response += content
            
            # Print a dot for every 50 characters received
            if len(full_response) >= last_print_len + 50:  # type: ignore
                print(".", end="", flush=True)
                last_print_len = len(full_response)
    
    print("\n", flush=True)
    return full_response


class CancelledError(Exception):
    """Raised when a generation is cancelled by the user."""
    pass


# Store active cancel events keyed by operation_id
_active_operations = {}
_operations_lock = threading.Lock()


def register_operation(operation_id):
    """Register a new operation and return its cancel event."""
    event = threading.Event()
    with _operations_lock:
        _active_operations[operation_id] = event
    return event


def cancel_operation(operation_id):
    """Cancel an active operation by setting its cancel event."""
    with _operations_lock:
        event = _active_operations.get(operation_id)
        if event:
            event.set()
            return True
    return False


def unregister_operation(operation_id):
    """Clean up a completed operation."""
    with _operations_lock:
        _active_operations.pop(operation_id, None)


def verify_html_content(input_text, html_content, cancel_event=None, model_choice='default'):
    """Verify that the generated HTML preserves all content from the input text."""
    print("=" * 60, flush=True)
    print("🤖 Verifying HTML content against original text...", flush=True)
    
    verification_sys_prompt = (
        "You are an expert quality assurance reviewer. Your job is to compare the original raw text with the generated HTML output.\n"
        "Check line by line to ensure NO content, questions, answers, or vocabulary from the original text has been skipped, summarized, or omitted in the HTML.\n"
        "If ALL content is carefully preserved in the HTML, output EXACTLY the word 'PASS' and nothing else.\n"
        "If ANY content was removed, summarized, or omitted, output a list of the specific missing content and instructions on what needs to be added back. Do not output 'PASS'."
    )
    
    verification_user_prompt = (
        f"--- ORIGINAL RAW TEXT ---\n{input_text}\n\n"
        f"--- GENERATED HTML ---\n{html_content}\n\n"
        "Did the HTML preserve all the content? Output 'PASS' or list the missing content."
    )
    
    try:
        model_config = resolve_model_config(model_choice)
        client = OpenAI(base_url=API_URL, api_key=model_config['api_key'])
        response = _make_ai_request(client, verification_sys_prompt, verification_user_prompt, model_config, cancel_event=cancel_event)
        
        response = response.strip()
        print(f"✅ Verification result: {response[:100]}...", flush=True)
        
        if response.upper() == "PASS" or response.upper().startswith("PASS"):
            return "PASS"
        else:
            return response
            
    except CancelledError:
        print("⚠️ Verification was cancelled")
        return None
    except Exception as e:
        print(f"❌ Verification failed: {e}")
        return "PASS"  # Fail open if verification errors


def get_ai_revision(input_text, previous_html, feedback, cancel_event=None, model_choice='default'):
    """Ask the AI to revise the HTML based on verification feedback."""
    print("=" * 60, flush=True)
    print("🤖 Requesting AI revision based on feedback...", flush=True)
    
    base_sys_prompt = load_system_prompt()
    revision_sys_prompt = (
        f"{base_sys_prompt}\n\n"
        "CRITICAL REVISION INSTRUCTIONS:\n"
        "You previously generated HTML for this text, but the quality assurance reviewer found that you skipped or summarized some content.\n"
        "Here is the exact feedback on what is missing:\n"
        "-------------------------------------\n"
        f"{feedback}\n"
        "-------------------------------------\n"
        "Your task:\n"
        "1. Rewrite the ENTIRE HTML document from start to finish.\n"
        "2. You MUST include ALL content from the original text.\n"
        "3. Pay special attention to the feedback above and guarantee that all missing parts are inserted in the correct locations.\n"
        "4. This is a strict test. If you skip, omit, or summarize ANY paragraph, question, or option, you will fail.\n"
        "DO NOT output anything other than raw HTML. No markdown code blocks, no explanations. Start with <!DOCTYPE html>."
    )
    
    return get_ai_response(input_text, use_cache=False, cancel_event=cancel_event, system_prompt=revision_sys_prompt, model_choice=model_choice)


def _cache_key(input_text, model_choice, system_prompt):
    """Cache key varies on (model_choice, system_prompt, input_text) — switching
    model or adding a custom system prompt must produce a different key so the
    cache doesn't return the response from a previous configuration."""
    return f"{model_choice}|{system_prompt or ''}|{input_text}"


def _get_ai_response_legacy_unused(input_text, use_cache=True, cancel_event=None, system_prompt=None, model_choice='default'):
    """Send text to AI model and get response with proper system/user message roles."""
    print("=" * 60, flush=True)
    print("🤖 Sending request to AI using OpenAI library...", flush=True)

    # Check cache first — key includes model + system prompt, not just the input.
    resolved_system_prompt = system_prompt if system_prompt is not None else load_system_prompt()
    cache_key = _cache_key(input_text, model_choice, resolved_system_prompt)
    if use_cache:
        cached_response = cache.get(cache_key)
        if cached_response:
            print("=" * 60, flush=True)
            return cached_response

    try:
        model_config = resolve_model_config(model_choice)

        # Fail fast on an obviously-unconfigured key rather than making the
        # UI sit at 0% while the OpenAI client retries a bogus endpoint.
        placeholder_keys = {'', 'your-api-key-here', 'REPLACE_ME'}
        resolved_key = (model_config.get('api_key') or '').strip()
        if resolved_key in placeholder_keys:
            raise RuntimeError(
                "AI is not configured: API_KEY is missing or a placeholder. "
                "Edit backend/config/config.py (or set the API_KEY env var) "
                "with a real key and restart the backend."
            )

        # Initialize OpenAI client with per-phase timeouts. A single
        # scalar `timeout=60` was previously used, which treated the
        # whole streaming completion as one 60-second budget and meant
        # any AI response taking longer than 60s (common for 1000-char
        # inputs on slower endpoints) timed out, got retried 3x by the
        # backoff decorator, and pushed a normal 3-4 min run past 8 min.
        # httpx.Timeout gives us fast-fail on connect + generous read
        # time for the streamed body. Override via env vars.
        connect_timeout = float(os.environ.get('AI_CONNECT_TIMEOUT', '15'))
        read_timeout = float(os.environ.get('AI_READ_TIMEOUT', '600'))
        client = OpenAI(
            base_url=API_URL,
            api_key=resolved_key,
            timeout=httpx.Timeout(
                connect=connect_timeout,
                read=read_timeout,
                write=30.0,
                pool=30.0,
            ),
            max_retries=0,  # _make_ai_request already handles retries
        )

        system_prompt = resolved_system_prompt
        
        print(f"📝 Input length: {len(input_text)} characters", flush=True)
        print(f"📝 System prompt length: {len(system_prompt)} characters", flush=True)
        print(f"🌐 API URL: {API_URL}", flush=True)
        print(f"🔑 Using model config: {model_choice} -> {model_config['model']}", flush=True)
        print(f"⏳ Sending request with streaming...\n", flush=True)
        
        # Make request with retry logic and proper roles
        full_response = _make_ai_request(client, system_prompt, input_text, model_config, cancel_event=cancel_event)
        print(f"✅ Response received successfully", flush=True)
        print(f"📄 Content length: {len(full_response)} characters", flush=True)
        
        # Clean up response - remove markdown code blocks if present
        full_response = full_response.strip()
        if full_response.startswith("```html"):
            full_response = full_response[7:]  # Remove ```html
        if full_response.startswith("```"):
            full_response = full_response[3:]  # Remove ```
        if full_response.endswith("```"):
            full_response = full_response[:-3]  # Remove trailing ```
        full_response = full_response.strip()
        
        print(f"📄 First 100 chars: {full_response[:100]}...", flush=True)
        
        # Cache the response using the composite key so later requests with a
        # different model / system_prompt don't silently get this response back.
        if use_cache:
            cache.set(cache_key, full_response)
        
        return full_response
        
    except CancelledError:
        print("⚠️ Generation was cancelled")
        return None
    except Exception as e:
        print(f"❌ Request failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        print("=" * 60)


def get_ai_response(input_text, use_cache=True, cancel_event=None, system_prompt=None, model_choice='default'):
    """Send text to AI model, falling back when a provider endpoint is degraded."""
    print("=" * 60, flush=True)
    print("Sending request to AI using OpenAI library...", flush=True)

    resolved_system_prompt = system_prompt if system_prompt is not None else load_system_prompt()
    cache_key = _cache_key(input_text, model_choice, resolved_system_prompt)
    if use_cache:
        cached_response = cache.get(cache_key)
        if cached_response:
            print("=" * 60, flush=True)
            return cached_response

    try:
        print(f"Input length: {len(input_text)} characters", flush=True)
        print(f"System prompt length: {len(resolved_system_prompt)} characters", flush=True)
        print(f"API URL: {API_URL}", flush=True)

        full_response = None
        last_error = None
        for choice in model_fallback_choices(model_choice):
            model_config = resolve_model_config(choice)
            client = make_openai_client(model_config)
            print(f"Using model config: {choice} -> {model_config['model']}", flush=True)
            print("Sending request with streaming...\n", flush=True)
            try:
                full_response = _make_ai_request(
                    client,
                    resolved_system_prompt,
                    input_text,
                    model_config,
                    cancel_event=cancel_event,
                )
                if choice != model_choice:
                    print(f"Fallback model succeeded: {choice}", flush=True)
                break
            except CancelledError:
                raise
            except Exception as exc:
                last_error = exc
                if not is_model_unavailable_error(exc):
                    raise
                print(f"Model {choice} is unavailable/degraded; trying next fallback.", flush=True)

        if full_response is None:
            if last_error:
                raise last_error
            raise RuntimeError("AI request did not return a response.")

        print("Response received successfully", flush=True)
        print(f"Content length: {len(full_response)} characters", flush=True)
        full_response = clean_ai_response(full_response)
        print(f"First 100 chars: {full_response[:100]}...", flush=True)

        if use_cache:
            cache.set(cache_key, full_response)
        return full_response

    except CancelledError:
        print("Generation was cancelled")
        return None
    except Exception as e:
        print(f"Request failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        print("=" * 60)
