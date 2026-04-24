"""Vision AI client for extracting text from images.

Supports:
- Handwritten & low-resolution images (auto-enhanced)
- PDF pages (via PyMuPDF)
- Printed text, equations, diagrams
"""
import os
import io
import base64
from openai import OpenAI
from PIL import Image, ImageEnhance, ImageFilter
import sys

# Add config to path
config_path = os.path.join(os.path.dirname(__file__), '..', '..', 'config')
if config_path not in sys.path:
    sys.path.insert(0, config_path)
from config import API_KEY, API_URL

# Vision model — document OCR specialist
MODEL_VISION = "nvidia/llama-3.1-nemotron-nano-vl-8b-v1"

# Fallback model if primary unavailable
MODEL_VISION_FALLBACK = "meta/llama-3.2-90b-vision-instruct"


# ─── Image Preprocessing ────────────────────────────────────────────

def preprocess_image(image_path, target_min_width=1500):
    """
    Preprocess image for better OCR accuracy on handwritten / low-res content.
    
    Steps:
    1. Upscale if too small (< target_min_width)
    2. Enhance contrast for faded/handwritten text
    3. Sharpen to crisp up edges
    4. Convert to high-quality PNG bytes for API
    
    Returns: (base64_encoded_data, mime_type)
    """
    try:
        img = Image.open(image_path)
        original_size = img.size
        
        # Convert to RGB if needed (some PNGs have alpha)
        if img.mode in ('RGBA', 'P', 'LA'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'RGBA':
                background.paste(img, mask=img.split()[3])
            else:
                background.paste(img)
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        
        # 1. Upscale small images
        width, height = img.size
        if width < target_min_width:
            scale = target_min_width / width
            new_width = int(width * scale)
            new_height = int(height * scale)
            img = img.resize((new_width, new_height), Image.LANCZOS)
            print(f"  📐 Upscaled: {original_size} → {img.size}")
        
        # 2. Enhance contrast (helps with faded/handwritten text)
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.4)  # 1.4x contrast boost
        
        # 3. Enhance sharpness (crisp text edges)
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(1.8)  # 1.8x sharpness boost
        
        # 4. Slight brightness boost for dark images
        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(1.1)  # Gentle brightness lift
        
        # 5. Convert to high-quality PNG bytes
        buffer = io.BytesIO()
        img.save(buffer, format='PNG', quality=95)
        buffer.seek(0)
        
        encoded = base64.b64encode(buffer.read()).decode('utf-8')
        print(f"  ✨ Preprocessed: contrast=1.4x, sharpness=1.8x, brightness=1.1x")
        
        return encoded, 'image/png'
        
    except Exception as e:
        print(f"  ⚠️ Preprocessing failed, using original: {e}")
        # Fallback: just read the raw file
        with open(image_path, 'rb') as f:
            raw_data = base64.b64encode(f.read()).decode('utf-8')
        ext = os.path.splitext(image_path)[1].lower()
        mime_type = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.gif': 'image/gif',
            '.webp': 'image/webp'
        }.get(ext, 'image/jpeg')
        return raw_data, mime_type


# ─── OCR Prompt ──────────────────────────────────────────────────────

OCR_SYSTEM_PROMPT = """You are a high-precision OCR transcription system. Your ONLY task is to read and transcribe ALL visible text from the provided image EXACTLY as it appears — word for word, character for character.

ABSOLUTE RULES (violation = failure):
1. TRANSCRIBE VERBATIM — copy every word exactly as printed or written
2. NEVER answer, solve, explain, or interpret questions — just copy them
3. NEVER summarize, paraphrase, or skip any content
4. Preserve ALL multiple-choice options: (A), (B), (C), (D) — copy them all
5. Preserve ALL mathematical equations, formulas, subscripts, superscripts
6. Preserve ALL question numbers, marks allocations like [2], [3], (3x8=24)
7. Preserve ALL section headers: Group A, Group B, Group C
8. Preserve ALL instructions like "Attempt all questions", "Full Marks: 75"
9. For handwritten text, transcribe your best reading — mark unclear words with [?]
10. Include EVERY line from top to bottom — miss nothing
11. Use markdown: # for titles, ## for sections, ### for subsections
12. Output ONLY the raw transcribed text — zero commentary

Think of yourself as a SCANNER that converts images to text. You do not think, interpret, or respond — you only copy."""


def _build_user_prompt(user_instructions="", is_handwritten=False):
    """Build the user prompt."""
    handwritten_note = ""
    if is_handwritten:
        handwritten_note = "\nNOTE: This may contain HANDWRITTEN text. Read carefully and transcribe your best interpretation. Mark uncertain words with [?]."
    
    return f"""TRANSCRIBE every single word from this image exactly as written/printed.

CRITICAL: Do NOT answer or solve any questions. Do NOT skip any options (A/B/C/D). Copy ALL text verbatim — every question, every option, every mark, every instruction.{handwritten_note}

{f"Document context: {user_instructions}" if user_instructions else ""}

Begin transcription from the very top of the page:"""


# ─── Extraction Functions ────────────────────────────────────────────

def extract_text_from_image(image_path, user_instructions=""):
    """
    Extract text from a single image using vision AI with preprocessing.
    
    Args:
        image_path: Path to image file
        user_instructions: Optional context about the image
    
    Returns:
        dict with raw_text and metadata, or None on failure
    """
    print("=" * 60)
    print(f"👁️ Extracting text from: {os.path.basename(image_path)}")
    
    # Preprocess image for better OCR
    print("  🔧 Preprocessing image...")
    image_data, mime_type = preprocess_image(image_path)
    
    user_prompt = _build_user_prompt(user_instructions)
    
    # Try primary model, then fallback
    for model in [MODEL_VISION, MODEL_VISION_FALLBACK]:
        try:
            client = OpenAI(base_url=API_URL, api_key=API_KEY)
            print(f"  🔍 Using model: {model}")
            
            completion = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": OCR_SYSTEM_PROMPT + "\n\n" + user_prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_data}"
                                }
                            }
                        ]
                    }
                ],
                temperature=0.1,
                max_tokens=16384
            )
            
            raw_text = completion.choices[0].message.content.strip()
            
            if raw_text and len(raw_text) > 20:
                print(f"  ✅ Extracted {len(raw_text)} characters")
                print(f"  📝 Preview: {raw_text[:80]}...")
                print("=" * 60)
                
                return {
                    'raw_text': raw_text,
                    'metadata': {
                        'model': model,
                        'image_file': os.path.basename(image_path),
                        'character_count': len(raw_text),
                        'word_count': len(raw_text.split()),
                        'preprocessed': True
                    }
                }
            else:
                print(f"  ⚠️ Model returned too little text ({len(raw_text)} chars), trying next model...")
                continue
                
        except Exception as e:
            print(f"  ⚠️ Model {model} failed: {e}")
            if model == MODEL_VISION_FALLBACK:
                import traceback
                traceback.print_exc()
            continue
    
    print("  ❌ All models failed for this image")
    return None


def extract_text_from_multiple_images(image_paths, user_instructions=""):
    """
    Extract text from multiple images — processes each image individually
    for maximum accuracy, then combines results.
    
    Args:
        image_paths: List of paths to image files
        user_instructions: Optional context about the document
    """
    print("=" * 60)
    print(f"👁️ Extracting text from {len(image_paths)} images...")
    
    # Always process page by page for best results
    all_text_parts = []
    total = len(image_paths)
    
    for i, path in enumerate(image_paths):
        print(f"\n📄 Processing image {i+1}/{total}...")
        result = extract_text_from_image(path, user_instructions)
        
        if result and result.get('raw_text'):
            if total > 1:
                all_text_parts.append(f"--- Page {i+1} ---\n{result['raw_text']}")
            else:
                all_text_parts.append(result['raw_text'])
            print(f"  ✅ Page {i+1}: {len(result['raw_text'])} chars")
        else:
            print(f"  ⚠️ Page {i+1}: extraction returned empty")
    
    if all_text_parts:
        combined_text = "\n\n".join(all_text_parts)
        print(f"\n✅ Total extracted: {len(combined_text)} characters from {len(all_text_parts)}/{total} pages")
        print("=" * 60)
        
        return {
            'raw_text': combined_text,
            'metadata': {
                'model': MODEL_VISION,
                'image_count': total,
                'pages_extracted': len(all_text_parts),
                'character_count': len(combined_text),
                'word_count': len(combined_text.split()),
                'preprocessed': True
            }
        }
    
    print("❌ Failed to extract text from any image")
    print("=" * 60)
    return None
