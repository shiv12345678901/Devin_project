"""AI API client for processing text input."""
import os
import sys
import threading
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
        model_config = MODELS_CONFIG.get(model_choice, MODELS_CONFIG['default'])
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


def get_ai_response(input_text, use_cache=True, cancel_event=None, system_prompt=None, model_choice='default'):
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
        model_config = MODELS_CONFIG.get(model_choice, MODELS_CONFIG['default'])

        # Initialize OpenAI client with NVIDIA endpoint
        client = OpenAI(
            base_url=API_URL,
            api_key=model_config['api_key']
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
