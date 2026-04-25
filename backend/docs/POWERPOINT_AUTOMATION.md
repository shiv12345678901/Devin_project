# PowerPoint Automation Guide

Transform your AI-generated screenshots into professional 4K video presentations automatically using PowerPoint's native video export capabilities.

## Overview

The PowerPoint Automation feature extends Screenshot Studio with the ability to:
- Automatically create PowerPoint presentations from generated images
- Configure slide timings and transitions
- Export presentations as high-quality 4K videos (3840x2160, MP4 format)
- Monitor progress in real-time
- Manage operations through a simple web interface

## System Requirements

### Operating System
- **Windows 10** or later
- **Windows Server 2016** or later
- **Not supported**: macOS, Linux (requires Windows COM automation)

### Software Requirements
- **Microsoft PowerPoint 2016** or later (must be installed and licensed)
- **Python 3.8** or later
- **8GB RAM minimum** (16GB recommended for 4K export)
- **10GB free disk space** for temporary files and output

### Python Dependencies
- `python-pptx==0.6.23` - PowerPoint file manipulation
- `pywin32==306` - Windows COM automation
- All other dependencies from `requirements.txt`

## Installation

### 1. Install Python Dependencies

```bash
pip install -r requirements.txt
```

This installs `python-pptx` and `pywin32` along with other required packages.

### 2. Run pywin32 Post-Install Script

After installing pywin32, you must run the post-install script to register COM components:

```bash
python Scripts/pywin32_postinstall.py -install
```

**Note**: On some systems, the script may be in a different location:
```bash
python -m pywin32_postinstall -install
```

### 3. Verify PowerPoint Installation

Test that PowerPoint is accessible via COM automation:

```python
python -c "import win32com.client; ppt = win32com.client.Dispatch('PowerPoint.Application'); print('PowerPoint version:', ppt.Version); ppt.Quit()"
```

Expected output: `PowerPoint version: 16.0` (or similar)

If you see an error, ensure:
- PowerPoint is installed and licensed
- You ran the pywin32 post-install script
- You're running on Windows

### 4. Create Required Directories

The application will create these automatically, but you can create them manually:

```bash
mkdir output\presentations
mkdir output\videos
mkdir templates\powerpoint
```

### 5. Configure Settings

Edit `config/config.py` to customize PowerPoint settings (optional):

```python
# PowerPoint Automation Settings
POWERPOINT_ENABLED = True
POWERPOINT_TEMPLATE_PATH = "templates/powerpoint/default.pptx"
POWERPOINT_OUTPUT_FOLDER = "output/presentations"
POWERPOINT_VIDEO_FOLDER = "output/videos"

# Slide Settings
DEFAULT_SLIDE_DURATION = 3.0  # Seconds per slide
DEFAULT_TRANSITION_TYPE = "fade"  # fade, push, wipe, none
DEFAULT_TRANSITION_DURATION = 0.5  # Seconds for transition

# Video Export Settings
VIDEO_RESOLUTION_WIDTH = 3840  # 4K width
VIDEO_RESOLUTION_HEIGHT = 2160  # 4K height
VIDEO_FPS = 30  # Frames per second
VIDEO_QUALITY = 5  # 1-5, where 5 is highest quality
```

## Configuration Options

### Slide Settings

**DEFAULT_SLIDE_DURATION** (float)
- Duration each slide displays in seconds
- Default: `3.0`
- Range: `0.5` to `30.0`
- Example: `5.0` for 5 seconds per slide

**DEFAULT_TRANSITION_TYPE** (string)
- Type of transition between slides
- Default: `"fade"`
- Options: `"fade"`, `"push"`, `"wipe"`, `"none"`

**DEFAULT_TRANSITION_DURATION** (float)
- Duration of transition animation in seconds
- Default: `0.5`
- Range: `0.1` to `3.0`

### Video Export Settings

**VIDEO_RESOLUTION_WIDTH** / **VIDEO_RESOLUTION_HEIGHT** (int)
- Video resolution in pixels
- Default: `3840 x 2160` (4K)
- Common options:
  - 4K: `3840 x 2160`
  - 1080p: `1920 x 1080`
  - 720p: `1280 x 720`

**VIDEO_FPS** (int)
- Frames per second for video
- Default: `30`
- Options: `24`, `30`, `60`

**VIDEO_QUALITY** (int)
- Video encoding quality
- Default: `5` (highest)
- Range: `1` (lowest) to `5` (highest)
- Higher quality = larger file size

### Image Insertion Settings

**IMAGE_FIT_MODE** (string)
- How images fit within slides
- Default: `"contain"`
- Options:
  - `"contain"` - Fit entire image, preserve aspect ratio
  - `"cover"` - Fill slide, may crop image
  - `"fill"` - Stretch to fill slide

**IMAGE_POSITION** (string)
- Image alignment on slide
- Default: `"center"`
- Options: `"center"`, `"top"`, `"bottom"`

**PRESERVE_ASPECT_RATIO** (bool)
- Whether to maintain image aspect ratios
- Default: `True`
- Set to `False` to allow stretching

## API Endpoints

### 1. Upload Template

Upload a PowerPoint template file to use for presentation creation.

**Endpoint**: `POST /api/powerpoint/upload-template`

**Request**: Multipart form data
```javascript
const formData = new FormData();
formData.append('template', templateFile);

fetch('/api/powerpoint/upload-template', {
    method: 'POST',
    body: formData
});
```

**Response**:
```json
{
    "success": true,
    "template_path": "templates/powerpoint/my_template.pptx"
}
```

### 2. Create Presentation

Create a PowerPoint presentation from images in a folder.

**Endpoint**: `POST /api/powerpoint/create`

**Request Body**:
```json
{
    "template_path": "templates/powerpoint/default.pptx",
    "image_folder": "output/screenshots",
    "slide_duration": 3.0,
    "transition_type": "fade"
}
```

**Response**:
```json
{
    "success": true,
    "presentation_path": "output/presentations/presentation_20240101_120000.pptx",
    "operation_id": "create_1704110400000"
}
```

### 3. Export Video

Export an existing PowerPoint presentation to 4K video.

**Endpoint**: `POST /api/powerpoint/export-video`

**Request Body**:
```json
{
    "presentation_path": "output/presentations/presentation.pptx",
    "resolution": [3840, 2160],
    "fps": 30,
    "quality": 5
}
```

**Response**:
```json
{
    "success": true,
    "video_path": "output/videos/video_20240101_120000.mp4",
    "operation_id": "export_1704110400000"
}
```

### 4. Create and Export (Combined)

Create presentation and export to video in one operation.

**Endpoint**: `POST /api/powerpoint/create-and-export`

**Request Body**:
```json
{
    "template_path": "templates/powerpoint/default.pptx",
    "image_folder": "output/screenshots",
    "slide_duration": 3.0,
    "transition_type": "fade",
    "video_resolution": [3840, 2160],
    "video_fps": 30,
    "video_quality": 5
}
```

**Response**:
```json
{
    "success": true,
    "presentation_path": "output/presentations/presentation_20240101_120000.pptx",
    "video_path": "output/videos/video_20240101_120000.mp4",
    "operation_id": "create_and_export_1704110400000"
}
```

### 5. Monitor Progress

Stream real-time progress updates using Server-Sent Events (SSE).

**Endpoint**: `GET /api/powerpoint/progress/<operation_id>`

**Usage**:
```javascript
const eventSource = new EventSource(`/api/powerpoint/progress/${operationId}`);

eventSource.addEventListener('slide_inserted', (e) => {
    const data = JSON.parse(e.data);
    console.log(`Slide ${data.slide_number} of ${data.total_slides}`);
});

eventSource.addEventListener('video_export_started', (e) => {
    console.log('Video export started...');
});

eventSource.addEventListener('completed', (e) => {
    const data = JSON.parse(e.data);
    console.log('Completed!', data);
    eventSource.close();
});

eventSource.addEventListener('error', (e) => {
    const data = JSON.parse(e.data);
    console.error('Error:', data.error_message);
    eventSource.close();
});
```

**Event Types**:
- `slide_inserted` - A slide was added to the presentation
- `video_export_started` - Video export has begun
- `video_export_progress` - Video export progress update (if available)
- `completed` - Operation finished successfully
- `error` - Operation failed with error

### 6. Validate Template

Check if a PowerPoint template file is valid before using it.

**Endpoint**: `POST /api/powerpoint/validate-template`

**Request Body**:
```json
{
    "template_path": "templates/powerpoint/my_template.pptx"
}
```

**Response**:
```json
{
    "valid": true,
    "slide_count": 1,
    "layout_info": {
        "slide_width": 9144000,
        "slide_height": 6858000,
        "layout_names": ["Title Slide", "Content"]
    }
}
```

## UI Usage

### Basic Workflow

1. **Generate Screenshots**
   - Use the Text-to-Image or HTML-to-Image features to create screenshots
   - Screenshots are saved to `output/screenshots/`

2. **Open PowerPoint Panel**
   - Scroll to the PowerPoint Automation section in the UI
   - The panel contains all PowerPoint controls

3. **Upload Template** (Optional)
   - Click "Choose File" to select a .pptx template
   - Click "Validate" to check if the template is valid
   - Or use the default template

4. **Configure Settings**
   - **Slide Duration**: How long each slide displays (seconds)
   - **Transition Type**: Animation between slides
   - **Video Quality**: 1 (lowest) to 5 (highest)

5. **Create Presentation**
   - Click "Create Presentation" to generate .pptx file only
   - Or click "Create & Export Video" to generate both .pptx and .mp4

6. **Monitor Progress**
   - Progress bar shows current operation status
   - Status text displays detailed progress information
   - Download links appear when complete

### Advanced Options

**Custom Image Folder**
- By default, uses `output/screenshots/`
- Can specify different folder via API

**Custom Output Paths**
- Presentations saved to `output/presentations/`
- Videos saved to `output/videos/`
- Filenames include timestamp for uniqueness

**Template Customization**
- Create custom .pptx templates with your branding
- Templates should have at least one slide layout
- Images will be inserted as new slides

## Troubleshooting

### PowerPoint Not Found

**Error**: `PowerPointNotFoundError: PowerPoint is not installed or not accessible`

**Solutions**:
1. Verify PowerPoint is installed: Open PowerPoint manually
2. Check PowerPoint version: Must be 2016 or later
3. Verify license: PowerPoint must be activated
4. Run as Administrator: Some COM operations require elevated privileges
5. Re-run pywin32 post-install: `python -m pywin32_postinstall -install`

### COM Automation Errors

**Error**: `pywintypes.com_error: (-2147221005, 'Invalid class string', None, None)`

**Solutions**:
1. Re-register COM components:
   ```bash
   python -m pywin32_postinstall -install
   ```
2. Restart your computer
3. Check Windows Event Viewer for COM errors
4. Ensure no other process is using PowerPoint

### Video Export Timeout

**Error**: `ExportError: Video export operation timed out`

**Solutions**:
1. Reduce video quality setting (try 3 instead of 5)
2. Reduce resolution (try 1080p instead of 4K)
3. Reduce number of slides (split into multiple videos)
4. Close other applications to free up CPU/RAM
5. Check disk space (video export requires significant space)

### Template Validation Fails

**Error**: `TemplateError: Template file is invalid or corrupted`

**Solutions**:
1. Open template in PowerPoint manually to verify it works
2. Save template as .pptx (not .ppt or .pptm)
3. Remove macros from template (save as .pptx, not .pptm)
4. Create new template from scratch
5. Use the default template provided

### Out of Memory

**Error**: `MemoryError` or system becomes unresponsive during video export

**Solutions**:
1. Close other applications
2. Reduce video resolution
3. Reduce video quality setting
4. Process fewer slides at once
5. Upgrade RAM (16GB recommended for 4K)

### Permission Denied

**Error**: `PermissionError: [Errno 13] Permission denied`

**Solutions**:
1. Close PowerPoint if it's open
2. Check file isn't open in another program
3. Run application as Administrator
4. Check antivirus isn't blocking file access
5. Verify write permissions on output folders

### Slow Video Export

**Issue**: Video export takes very long (>10 minutes)

**Solutions**:
1. This is normal for 4K video with many slides
2. Reduce resolution to 1080p for faster export
3. Reduce video quality setting
4. Use fewer slides per video
5. Upgrade CPU (video encoding is CPU-intensive)

### Images Not Appearing in Slides

**Issue**: Presentation created but slides are blank

**Solutions**:
1. Verify images exist in the specified folder
2. Check image file formats (PNG, JPG, JPEG supported)
3. Ensure images aren't corrupted (open manually)
4. Check file permissions on image folder
5. Verify image paths don't contain special characters

## Performance Considerations

### Presentation Creation
- **Speed**: ~0.2 seconds per slide
- **10 slides**: ~2 seconds
- **50 slides**: ~10 seconds

### Video Export (4K, Quality 5)
- **Speed**: Varies by CPU and slide count
- **1 minute video (20 slides @ 3s each)**: 3-5 minutes
- **2 minute video (40 slides @ 3s each)**: 6-10 minutes
- **5 minute video (100 slides @ 3s each)**: 15-25 minutes

### File Sizes
- **Presentation (.pptx)**: 5-20MB for 10-50 slides
- **4K Video (Quality 5)**: 50-100MB per minute
- **1080p Video (Quality 5)**: 20-40MB per minute

### Optimization Tips
1. **Use 1080p for faster export**: 4K takes 2-3x longer
2. **Lower quality for drafts**: Use quality 3 for testing
3. **Batch operations**: Process multiple sets separately
4. **Monitor resources**: Close unnecessary applications
5. **SSD recommended**: Faster disk I/O improves performance

## Best Practices

### Template Design
1. **Keep it simple**: Complex templates may cause issues
2. **Test first**: Validate template before production use
3. **Standard layouts**: Use PowerPoint's built-in layouts
4. **No macros**: Save as .pptx, not .pptm
5. **Backup templates**: Keep copies of working templates

### Image Preparation
1. **Consistent sizing**: Use same dimensions for all images
2. **High resolution**: Use at least 1920x1080 for best quality
3. **Proper naming**: Use numeric prefixes for ordering (1_image.png, 2_image.png)
4. **Supported formats**: PNG and JPEG recommended
5. **Optimize files**: Compress images to reduce file size

### Video Production
1. **Test with small sets**: Create short videos first
2. **Monitor progress**: Watch for errors during export
3. **Verify output**: Check video plays correctly
4. **Archive source files**: Keep .pptx files for re-export
5. **Plan for time**: Allow sufficient time for 4K export

### Error Handling
1. **Check logs**: Review console output for errors
2. **Retry on failure**: Transient errors may resolve on retry
3. **Validate inputs**: Use template validation before operations
4. **Clean up**: Remove partial files after errors
5. **Report issues**: Note error messages for troubleshooting

## Limitations

### Platform
- **Windows only**: Requires Windows COM automation
- **PowerPoint required**: Must have PowerPoint installed
- **No cloud support**: Cannot run on Linux servers

### Performance
- **CPU intensive**: Video export uses significant CPU
- **Memory intensive**: 4K export requires substantial RAM
- **Time consuming**: Large videos take many minutes
- **Disk space**: Temporary files can be large

### Features
- **No audio**: Videos are silent (no background music)
- **No animations**: Slide content is static
- **Limited transitions**: Basic transitions only
- **No text overlays**: Cannot add captions automatically
- **Sequential processing**: One operation at a time recommended

## Security Considerations

### File Upload
- Template files are validated for .pptx extension
- File size limited to 50MB
- Files stored in isolated directory
- Path traversal protection enabled

### Resource Limits
- Maximum 2 concurrent operations
- Video export timeout: 30 minutes
- Disk space checked before operations
- Memory usage monitored

### COM Security
- PowerPoint runs with user privileges
- COM objects properly cleaned up
- Exceptions handled to prevent crashes
- Logging enabled for audit trail

## Future Enhancements

Planned features for future releases:

1. **Audio Support**: Add background music or narration
2. **Text Overlays**: Automatic captions and titles
3. **Batch Processing**: Process multiple image sets in parallel
4. **Cloud Export**: Direct upload to YouTube, Vimeo
5. **Template Library**: Built-in professional templates
6. **Preview Generation**: Thumbnail previews before export
7. **Custom Animations**: Support for slide animations
8. **Multi-Resolution**: Export multiple resolutions simultaneously
9. **Progress Estimation**: More accurate time estimates
10. **Template Editor**: Web-based template customization

## Support

### Getting Help
- Check this documentation first
- Review troubleshooting section
- Check console logs for error messages
- Verify system requirements are met

### Reporting Issues
When reporting issues, include:
- Windows version
- PowerPoint version
- Python version
- Error message (full text)
- Steps to reproduce
- Console log output

### Additional Resources
- PowerPoint VBA Reference: [Microsoft Docs](https://docs.microsoft.com/en-us/office/vba/api/overview/powerpoint)
- python-pptx Documentation: [python-pptx.readthedocs.io](https://python-pptx.readthedocs.io/)
- pywin32 Documentation: [pywin32.readthedocs.io](https://pywin32.readthedocs.io/)

---

**Last Updated**: 2024  
**Version**: 1.0  
**Status**: Production Ready
