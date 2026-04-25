# New Features Guide

This document describes the newly implemented features in Screenshot Studio.

## 1. Content Preview

Preview AI-generated HTML before creating screenshots to verify formatting and content.

### How to Use:
1. Enter your text content
2. Click "Preview HTML" button
3. Review the formatted HTML in the preview modal
4. Copy HTML to clipboard if needed
5. Click "Continue to Generate" to create screenshots

### Benefits:
- Verify AI formatting before generating screenshots
- Save API calls by checking output first
- Copy HTML for use in other applications

### API Endpoint:
```
POST /preview
Body: { "text": "your content", "use_cache": true }
Response: { "success": true, "html_content": "..." }
```

## 2. Retry Mechanism with Exponential Backoff

Automatically retry failed AI requests with increasing delays between attempts.

### Configuration:
- Max retries: 3 attempts
- Base delay: 2 seconds
- Max delay: 30 seconds
- Exponential backoff: delay doubles each retry

### How It Works:
1. First attempt fails → wait 2 seconds
2. Second attempt fails → wait 4 seconds
3. Third attempt fails → wait 8 seconds
4. After 3 retries, return error

### Benefits:
- Handles temporary network issues
- Reduces failed requests due to rate limiting
- Automatic recovery without user intervention

### Implementation:
The retry logic is implemented in `src/utils/retry_handler.py` and automatically applied to all AI requests.

## 3. Response Caching

Cache AI responses to save API calls and reduce costs for identical inputs.

### How It Works:
- Input text is hashed (SHA-256)
- Response is stored in `output/cache/ai_responses.json`
- Subsequent identical requests use cached response
- Cache persists across server restarts

### Benefits:
- Save API costs for repeated content
- Faster response for cached requests
- Automatic cache management

### API Endpoints:

**Get Cache Statistics:**
```
GET /cache/stats
Response: {
  "total_entries": 5,
  "cache_file": "output/cache/ai_responses.json",
  "cache_size_kb": 12.5
}
```

**Clear Cache:**
```
POST /cache/clear
Response: { "success": true, "message": "Cache cleared successfully" }
```

### Disable Caching:
Set `use_cache: false` in the request body to bypass cache.

## 4. Watermark Support

Add custom text or logo watermarks to screenshots for branding.

### Text Watermark:

**Settings:**
- Watermark Text: Custom text to display
- Position: top-left, top-right, bottom-left, bottom-right, center
- Opacity: 0-255 (default: 128)
- Font Size: Adjustable (default: 20px)
- Color: RGB tuple (default: white)

**How to Use:**
1. Expand "Advanced Settings"
2. Enter watermark text
3. Select position
4. Generate screenshots

**Example:**
```python
from utils.watermark import WatermarkManager

wm = WatermarkManager()
wm.add_watermark(
    "screenshot.png",
    text="My Brand",
    position="bottom-right",
    opacity=128
)
```

### Logo Watermark:

**Settings:**
- Logo Path: Path to logo image file
- Position: Same as text watermark
- Scale: Logo size relative to image (0.0-1.0)
- Opacity: 0-255

**Example:**
```python
wm.add_logo_watermark(
    "screenshot.png",
    logo_path="logo.png",
    position="bottom-right",
    scale=0.1,
    opacity=128
)
```

## 5. Multiple Resolution Presets

Quick access to common device and use-case resolutions.

### Available Presets:

**Mobile:**
- Mobile Portrait (375x667) - iPhone SE/8
- Mobile Portrait Large (414x896) - iPhone 11 Pro Max
- Mobile Landscape (667x375)

**Tablet:**
- Tablet Portrait (768x1024) - iPad
- Tablet Landscape (1024x768)
- Tablet Pro (1024x1366) - iPad Pro 12.9"

**Desktop:**
- Desktop HD (1366x768) - Standard laptop
- Desktop Full HD (1920x1080) - Default
- Desktop 2K (2560x1440)
- Desktop 4K (3840x2160)

**Social Media:**
- Instagram Post (1080x1080) - Square 1:1
- Instagram Story (1080x1920) - Vertical 9:16
- Twitter Post (1200x675) - 16:9
- Facebook Post (1200x630)

**Print:**
- Print A4 Portrait (2480x3508) - 300 DPI
- Print A4 Landscape (3508x2480) - 300 DPI
- Print Letter (2550x3300) - US Letter 300 DPI

**Presentation:**
- Presentation 16:9 (1920x1080)
- Presentation 4:3 (1024x768)

### How to Use:
1. Select preset from "Resolution Preset" dropdown
2. Dimensions and zoom automatically applied
3. Or use "Custom" and set manual values

### API Endpoint:
```
GET /presets
Response: {
  "presets": {
    "Mobile": [...],
    "Tablet": [...],
    "Desktop": [...],
    ...
  }
}
```

### Programmatic Access:
```python
from utils.resolution_presets import ResolutionPresets

# Get specific preset
preset = ResolutionPresets.get_preset("desktop-4k")
# Returns: {"name": "Desktop 4K", "width": 3840, "height": 2160, "zoom": 2.0, ...}

# Get all presets by category
presets = ResolutionPresets.get_presets_by_category()

# Get preset names
names = ResolutionPresets.get_preset_names()
```

## Usage Examples

### Example 1: Generate with Watermark and Preset
```javascript
const settings = {
    text: "My content",
    watermark_text: "© 2024 My Company",
    watermark_position: "bottom-right",
    resolution_preset: "instagram-post",
    use_cache: true
};

const response = await fetch('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
});
```

### Example 2: Preview Before Generating
```javascript
// Step 1: Preview
const preview = await fetch('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: "My content" })
});
const previewData = await preview.json();
console.log(previewData.html_content);

// Step 2: Generate if satisfied
const generate = await fetch('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: "My content" })
});
```

### Example 3: Check Cache Stats
```javascript
const stats = await fetch('/cache/stats');
const data = await stats.json();
console.log(`Cache has ${data.total_entries} entries`);
```

## Configuration

All features work out of the box with sensible defaults. Advanced users can customize:

### Cache Location:
Edit `src/utils/cache_manager.py`:
```python
cache = CacheManager(cache_dir="custom/path")
```

### Retry Settings:
Edit `src/core/ai_client.py`:
```python
@retry_with_backoff(max_retries=5, base_delay=1, max_delay=60)
```

### Watermark Defaults:
Edit `src/utils/watermark.py`:
```python
self.default_text = "Your Brand"
self.default_position = "top-right"
self.default_opacity = 200
```

## Troubleshooting

### Preview Not Working:
- Check browser console for errors
- Verify AI API is responding
- Check cache stats to see if response is cached

### Watermark Not Appearing:
- Ensure watermark text is not empty
- Check image file permissions
- Verify Pillow is installed: `pip install Pillow`

### Cache Not Saving:
- Check `output/cache/` directory exists
- Verify write permissions
- Check disk space

### Preset Not Applying:
- Ensure JavaScript is enabled
- Check browser console for errors
- Verify `/presets` endpoint is accessible

## Performance Tips

1. **Use Caching**: Enable caching for repeated content
2. **Preview First**: Use preview to verify before generating
3. **Choose Appropriate Presets**: Use smaller resolutions when possible
4. **Watermark Wisely**: Add watermarks only when needed
5. **Monitor Cache**: Clear cache periodically to save disk space

## Future Enhancements

Potential improvements for these features:
- Cache expiration policies
- Watermark templates library
- Custom preset creation UI
- Batch watermarking
- Preview with watermark
- Cache compression
- Retry statistics dashboard
