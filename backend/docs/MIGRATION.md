# Migration Guide - Old to New Structure

This document explains the changes from the old structure to the new organized structure.

## Structure Changes

### Old Structure
```
project/
├── ai_client.py
├── app.py
├── config.py
├── html_generator.py
├── screenshot_playwright.py
├── system_prompt.txt
├── template.html
├── templates/index.html
├── generated_html/
└── screenshots/
```

### New Structure
```
project/
├── app.py                      # Updated with new imports
├── start.py                    # New startup script
├── requirements.txt            # Updated dependencies
├── README.md                   # Comprehensive documentation
├── SETUP_GUIDE.md             # Setup instructions
│
├── src/                        # NEW: Source code organization
│   ├── core/
│   │   ├── ai_client.py       # Moved from root
│   │   └── html_generator.py  # Moved from root
│   └── screenshot_engines/
│       └── playwright_engine.py # Renamed from screenshot_playwright.py
│
├── config/                     # NEW: Configuration folder
│   ├── config.py              # Moved from root
│   ├── config.example.py      # NEW: Template
│   ├── system_prompt.txt      # Moved from root
│   └── template.html          # Moved from root
│
├── static/                     # Frontend assets
│   ├── css/styles.css         # NEW: Extracted from index.html
│   ├── js/
│   │   ├── navigation.js      # NEW: Extracted from index.html
│   │   ├── text-to-image.js   # NEW: Extracted from index.html
│   │   ├── html-to-image.js   # NEW: Extracted from index.html
│   │   └── utils.js           # NEW: Extracted from index.html
│   └── README.md              # NEW: Frontend documentation
│
├── templates/
│   └── index.html             # Refactored to use external CSS/JS
│
└── output/                     # NEW: Organized output
    ├── screenshots/           # Replaces root screenshots/
    └── html/                  # Replaces generated_html/
```

## Import Changes

### Old Imports (app.py)
```python
from ai_client import get_ai_response
from html_generator import generate_html
from screenshot_playwright import take_screenshot_playwright
```

### New Imports (app.py)
```python
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from core.ai_client import get_ai_response
from core.html_generator import generate_html
from screenshot_engines.playwright_engine import take_screenshot_playwright
```

## Path Changes

### Output Folders

**Old:**
```python
OUTPUT_FOLDER = "screenshots"
HTML_FOLDER = "generated_html"
```

**New:**
```python
OUTPUT_FOLDER = "output/screenshots"
HTML_FOLDER = "output/html"
```

### Config Files

**Old:**
```python
# Direct import
import config
```

**New:**
```python
# Import from config folder
sys.path.insert(0, 'config')
import config
```

## Migration Steps

### Automatic Migration (Recommended)

The new structure is already set up. Old files remain for reference.

### Manual Migration (If needed)

1. **Move core files:**
   ```bash
   mkdir -p src/core
   cp ai_client.py src/core/
   cp html_generator.py src/core/
   ```

2. **Move screenshot engine:**
   ```bash
   mkdir -p src/screenshot_engines
   cp screenshot_playwright.py src/screenshot_engines/playwright_engine.py
   ```

3. **Move config files:**
   ```bash
   mkdir -p config
   cp config.py config/
   cp system_prompt.txt config/
   cp template.html config/
   ```

4. **Create output folders:**
   ```bash
   mkdir -p output/screenshots output/html
   ```

5. **Update app.py** with new imports (already done)

6. **Test the application:**
   ```bash
   python start.py
   ```

## Backward Compatibility

### Old Files

Old files are kept in the root for reference:
- `ai_client.py` (use `src/core/ai_client.py`)
- `html_generator.py` (use `src/core/html_generator.py`)
- `screenshot_playwright.py` (use `src/screenshot_engines/playwright_engine.py`)
- `config.py` (use `config/config.py`)

### Old Output Folders

Old output folders still work:
- `screenshots/` (use `output/screenshots/`)
- `generated_html/` (use `output/html/`)

You can safely delete old files after verifying the new structure works.

## Benefits of New Structure

### Organization
- ✅ Clear separation of concerns
- ✅ Modular code structure
- ✅ Easy to navigate

### Scalability
- ✅ Easy to add new tools
- ✅ Easy to add new screenshot engines
- ✅ Easy to add new features

### Maintainability
- ✅ Easier to find files
- ✅ Easier to update code
- ✅ Easier to debug

### Professional
- ✅ Industry-standard structure
- ✅ Better for collaboration
- ✅ Better for version control

## Cleanup (Optional)

After verifying everything works, you can remove old files:

```bash
# Remove old Python files (keep as backup first!)
# rm ai_client.py
# rm html_generator.py
# rm screenshot_playwright.py
# rm config.py
# rm system_prompt.txt
# rm template.html

# Remove old test files
rm test_*.py
rm check_*.py
rm list_models.py
rm main.py
rm css_template.txt

# Move old output (optional)
# mv screenshots/* output/screenshots/
# mv generated_html/* output/html/
# rmdir screenshots generated_html
```

## Rollback (If needed)

If you need to go back to the old structure:

1. The old files are still in the root directory
2. Revert `app.py` to use old imports
3. Use old output folders

## Testing Checklist

After migration, test:

- [ ] Server starts without errors
- [ ] Text to Image tool works
- [ ] HTML to Image tool works
- [ ] Screenshots are generated
- [ ] HTML files are saved
- [ ] Custom settings work
- [ ] Advanced settings work
- [ ] File serving works

## Questions?

If you encounter issues:
1. Check terminal for error messages
2. Verify all files are in correct locations
3. Check imports in `app.py`
4. Review `SETUP_GUIDE.md`
