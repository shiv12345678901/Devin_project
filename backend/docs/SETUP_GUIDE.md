# Screenshot Studio - Setup Guide

Complete guide to set up and run Screenshot Studio.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Install Playwright browsers
playwright install chromium

# 3. Configure API
cp config/config.example.py config/config.py
# Edit config/config.py with your API credentials

# 4. Start the application
python start.py
```

## Detailed Setup

### Step 1: System Requirements

- **Python**: 3.8 or higher
- **pip**: Latest version
- **Operating System**: Windows, macOS, or Linux
- **RAM**: Minimum 2GB
- **Disk Space**: ~500MB for dependencies

### Step 2: Install Python Dependencies

```bash
pip install -r requirements.txt
```

This installs:
- Flask (web framework)
- Playwright (screenshot engine)
- Pillow (image processing)
- Requests (HTTP client)

### Step 3: Install Playwright Browsers

Playwright needs browser binaries:

```bash
playwright install chromium
```

This downloads Chromium (~150MB). You can also install other browsers:

```bash
playwright install firefox
playwright install webkit
```

### Step 4: Configure API Settings

1. **Copy the example config:**
   ```bash
   cp config/config.example.py config/config.py
   ```

2. **Edit config/config.py:**
   ```python
   API_KEY = "your-actual-api-key"
   BASE_URL = "https://your-api-endpoint.com/v1"
   MODEL_NAME = "your-model-name"
   ```

3. **Get API credentials:**
   - For Groq: https://console.groq.com/keys
   - For OpenAI: https://platform.openai.com/api-keys
   - For other providers: Check their documentation

### Step 5: Verify Installation

Run the startup script with checks:

```bash
python start.py
```

This will:
- ✅ Check all dependencies
- ✅ Verify configuration
- ✅ Test Playwright installation
- ✅ Create output folders
- 🚀 Start the server

### Step 6: Access the Application

Open your browser to:
```
http://localhost:5000
```

## Configuration Options

### Basic Settings (config/config.py)

```python
# API Configuration
API_KEY = "sk-..."              # Your API key
BASE_URL = "https://..."        # API endpoint
MODEL_NAME = "llama-3.1-70b"    # Model to use

# Server Settings
DEBUG = True                    # Enable debug mode
PORT = 5000                     # Server port
HOST = "0.0.0.0"               # Listen on all interfaces

# Output Settings
DEFAULT_SCREENSHOT_FOLDER = "output/screenshots"
DEFAULT_HTML_FOLDER = "output/html"
```

### Advanced Settings

```python
# Screenshot Quality
DEFAULT_VIEWPORT_WIDTH = 1920   # Screenshot width
DEFAULT_VIEWPORT_HEIGHT = 1080  # Screenshot height
DEFAULT_DEVICE_SCALE = 2.5      # Quality multiplier
DEFAULT_FONT_SIZE = 250         # Font size percentage
DEFAULT_OVERLAP = 35            # Overlap between shots

# Limits
MAX_SCREENSHOTS_LIMIT = 50      # Maximum screenshots per request
MAX_TOKENS = 100000             # Maximum AI tokens
```

## Troubleshooting

### Issue: "Module not found"

**Solution:**
```bash
pip install -r requirements.txt
```

### Issue: "Playwright executable not found"

**Solution:**
```bash
playwright install chromium
```

### Issue: "API key invalid"

**Solution:**
1. Check `config/config.py` has correct API key
2. Verify API key is active on provider's dashboard
3. Check BASE_URL is correct

### Issue: "Permission denied" on output folders

**Solution:**
```bash
# Windows
icacls output /grant Users:F /T

# Linux/Mac
chmod -R 755 output
```

### Issue: Port 5000 already in use

**Solution:**
Edit `config/config.py`:
```python
PORT = 5001  # Use different port
```

Or stop the process using port 5000:
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:5000 | xargs kill -9
```

## Running in Production

### Using Gunicorn (Linux/Mac)

```bash
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### Using Waitress (Windows)

```bash
pip install waitress
waitress-serve --port=5000 app:app
```

### Environment Variables

Set sensitive data via environment variables:

```bash
# Linux/Mac
export API_KEY="your-key"
export BASE_URL="your-url"

# Windows
set API_KEY=your-key
set BASE_URL=your-url
```

Then in `config/config.py`:
```python
import os
API_KEY = os.getenv('API_KEY', 'default-key')
BASE_URL = os.getenv('BASE_URL', 'default-url')
```

## Updating

### Update Python packages

```bash
pip install --upgrade -r requirements.txt
```

### Update Playwright

```bash
playwright install chromium --force
```

## Uninstalling

```bash
# Remove Python packages
pip uninstall -r requirements.txt -y

# Remove Playwright browsers
playwright uninstall --all

# Delete project folder
cd ..
rm -rf screenshot-studio
```

## Getting Help

1. **Check terminal output** for detailed error messages
2. **Review logs** in the console
3. **Verify configuration** in `config/config.py`
4. **Test API** separately to isolate issues

## Next Steps

After setup:
1. Read [README.md](README.md) for usage instructions
2. Check [static/README.md](static/README.md) for frontend customization
3. Explore the UI at http://localhost:5000
4. Try the Text to Image tool with sample content
5. Experiment with advanced settings

## Support

For issues:
- Check error messages in terminal
- Verify all setup steps completed
- Review troubleshooting section
- Check API provider status
