# Additional Features Documentation

This document describes five additional features implemented in Screenshot Studio.

## 1. HTML Beautifier

Auto-format messy HTML code with proper indentation and structure.

### Features:
- **Beautify**: Format HTML with proper indentation
- **Minify**: Remove unnecessary whitespace
- **Validate**: Check for common HTML issues

### Usage:

**Via API:**
```bash
# Beautify HTML
POST /beautify
Body: { "html": "<div><p>Hello</p></div>" }

# Minify HTML
POST /minify
Body: { "html": "<div>  <p>  Hello  </p>  </div>" }
```

**Programmatic:**
```python
from utils.html_beautifier import HTMLBeautifier

beautifier = HTMLBeautifier(indent_size=2)

# Beautify
formatted = beautifier.beautify(messy_html)

# Minify
minified = beautifier.minify(html_content)

# Validate
validation = beautifier.validate(html_content)
print(validation['valid'])  # True/False
print(validation['issues'])  # List of issues
```

### API Response:
```json
{
  "success": true,
  "html": "formatted HTML",
  "validation": {
    "valid": true,
    "issues": [],
    "tag_count": 15
  }
}
```

### Features:
- Proper indentation (configurable)
- Handles inline vs block elements
- Preserves self-closing tags
- Validates tag balance
- Checks for required HTML structure

## 2. Performance Metrics

Track and display load time, render time, and other performance metrics.

### Tracked Metrics:
- **Total Duration**: Complete operation time
- **AI Processing Time**: Time for AI response
- **Screenshot Generation Time**: Time to create screenshots
- **Tokens Per Second**: AI processing speed
- **File Sizes**: Individual and total screenshot sizes
- **Screenshots Per Second**: Generation rate

### Usage:

**Automatic Tracking:**
All `/generate` requests automatically track performance metrics.

**API Endpoints:**
```bash
# Get metrics for specific operation
GET /metrics/{operation_id}

# Response includes:
{
  "operation_id": "generate_1234567890",
  "duration": "5.2s",
  "duration_ms": 5234.56,
  "status": "success",
  "start_time": "2024-03-04T10:30:00",
  "end_time": "2024-03-04T10:30:05",
  "metadata": {
    "screenshot_count": 3,
    "total_size_kb": 1024.5,
    "avg_time_per_screenshot": 1.2
  }
}
```

**Programmatic:**
```python
from utils.performance_metrics import metrics_tracker

# Start tracking
metrics_tracker.start('my_operation')

# ... do work ...

# End tracking
metrics_tracker.end('my_operation', success=True, metadata={
    'custom_data': 'value'
})

# Get metrics
metrics = metrics_tracker.get_metrics('my_operation')
summary = metrics_tracker.get_summary('my_operation')
```

### Display in UI:
Performance metrics are automatically displayed after screenshot generation:
- Total Time
- AI Processing Time
- Screenshot Generation Time

## 3. Progress Indicators

Real-time progress bars with ETA for long-running operations.

### Features:
- **Visual Progress Bar**: Animated progress indicator
- **Percentage Display**: Current progress percentage
- **ETA Calculation**: Estimated time remaining
- **Stage Messages**: Current operation stage
- **Smooth Animations**: Professional transitions

### Usage:

**JavaScript:**
```javascript
// Start progress tracking
progressTracker.start([
    'Sending request to AI...',
    'Generating HTML...',
    'Creating screenshots...',
    'Finalizing...'
]);

// Update progress
progressTracker.updateProgress(50, 'Processing...');

// Move to next stage
progressTracker.nextStage();

// Complete
progressTracker.complete('Done!');

// Reset
progressTracker.reset();
```

### UI Elements:
- Progress bar with smooth fill animation
- Percentage text (0-100%)
- ETA display (e.g., "ETA: 15s" or "ETA: 2m 30s")
- Stage message (e.g., "Creating screenshots...")

### Automatic Integration:
Progress tracking is automatically integrated into the text-to-image generation workflow.

## 4. Notification System

Desktop notifications when jobs complete, with in-app toast notifications.

### Features:
- **Desktop Notifications**: Native OS notifications
- **Toast Notifications**: In-app notification toasts
- **Multiple Types**: Success, error, info
- **Auto-dismiss**: Configurable duration
- **Manual Close**: Click to dismiss
- **Permission Request**: Automatic permission handling

### Usage:

**JavaScript:**
```javascript
// Success notification
notificationManager.success(
    'Generation Complete!',
    'Created 5 screenshots in 3.2s'
);

// Error notification
notificationManager.error(
    'Generation Failed',
    'API request timed out'
);

// Info notification
notificationManager.info(
    'Processing',
    'Your request is being processed'
);

// Custom notification
notificationManager.show(
    'Custom Title',
    'Custom message',
    'success',  // type: success, error, info
    5000        // duration in ms (0 = no auto-close)
);

// Close notification
notificationManager.close(notificationId);
```

### Notification Types:

**Success:**
- Green accent color
- Checkmark icon
- Default duration: 5 seconds

**Error:**
- Red accent color
- X icon
- Default duration: 7 seconds

**Info:**
- Blue accent color
- Info icon
- Default duration: 5 seconds

### Desktop Notifications:
- Requires user permission (requested automatically)
- Shows even when browser is minimized
- Native OS notification style
- Includes app icon

### Toast Notifications:
- Bottom-right corner
- Slide-in animation
- Click to dismiss
- Auto-dismiss after duration
- Multiple notifications stack

## 5. Automatic Cleanup

Delete old files after 7 days to save disk space.

### Features:
- **Scheduled Cleanup**: Daily at 2:00 AM
- **Configurable Age**: Default 7 days
- **Dry Run Mode**: Preview before deleting
- **Statistics**: Track deleted files and space freed
- **Multiple Directories**: Clean screenshots and HTML
- **Error Handling**: Graceful failure handling

### Usage:

**Run Cleanup Scheduler:**
```bash
python cleanup_scheduler.py
```

This starts a background process that:
- Runs cleanup daily at 2:00 AM
- Deletes files older than 7 days
- Logs all operations
- Continues running until stopped (Ctrl+C)

**API Endpoints:**

```bash
# Preview cleanup (dry run)
POST /cleanup/preview
Body: { "max_age_days": 7 }

# Execute cleanup
POST /cleanup/execute
Body: { "max_age_days": 7 }

# Get directory statistics
GET /cleanup/stats
```

**Programmatic:**
```python
from utils.file_cleanup import file_cleanup

# Preview cleanup
result = file_cleanup.schedule_cleanup(
    ['output/screenshots', 'output/html'],
    max_age_days=7
)

# Execute cleanup
result = file_cleanup.cleanup_multiple_directories(
    ['output/screenshots', 'output/html'],
    max_age_days=7,
    dry_run=False
)

# Get directory stats
stats = file_cleanup.get_directory_stats('output/screenshots')
print(f"Total files: {stats['file_count']}")
print(f"Total size: {stats['total_size_mb']} MB")
```

### Cleanup Response:
```json
{
  "results": {
    "output/screenshots": {
      "success": true,
      "deleted_count": 15,
      "deleted_size_mb": 12.5,
      "kept_count": 5,
      "errors": []
    }
  },
  "total_deleted": 15,
  "total_size_mb": 12.5
}
```

### Configuration:

**Change Cleanup Age:**
```python
# In cleanup_scheduler.py
run_cleanup(max_age_days=14)  # Keep files for 14 days
```

**Change Schedule:**
```python
# In cleanup_scheduler.py
schedule.every().day.at("03:00").do(run_cleanup)  # Run at 3 AM
schedule.every().week.do(run_cleanup)  # Run weekly
```

**Add More Directories:**
```python
directories = [
    'output/screenshots',
    'output/html',
    'output/cache'  # Add cache cleanup
]
```

## Integration Examples

### Example 1: Complete Workflow with All Features

```javascript
// Start progress
progressTracker.start([
    'Preparing request...',
    'Processing with AI...',
    'Generating screenshots...',
    'Applying watermarks...',
    'Complete!'
]);

try {
    // Generate with beautified HTML
    const response = await fetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: "My content",
            beautify_html: true,
            watermark_text: "© 2024",
            resolution_preset: "desktop-fhd"
        })
    });
    
    const data = await response.json();
    
    // Complete progress
    progressTracker.complete('Done!');
    
    // Show success notification
    notificationManager.success(
        'Screenshots Generated!',
        `Created ${data.screenshot_count} files in ${data.performance.total_time}`
    );
    
    // Display performance metrics
    console.log('Performance:', data.performance);
    
} catch (error) {
    progressTracker.reset();
    notificationManager.error('Error', error.message);
}
```

### Example 2: Scheduled Cleanup with Notifications

```python
import schedule
from utils.file_cleanup import file_cleanup

def cleanup_with_notification():
    result = file_cleanup.cleanup_multiple_directories(
        ['output/screenshots', 'output/html'],
        max_age_days=7
    )
    
    print(f"Cleaned up {result['total_deleted']} files")
    print(f"Freed {result['total_size_mb']:.2f} MB")

# Schedule daily cleanup
schedule.every().day.at("02:00").do(cleanup_with_notification)

while True:
    schedule.run_pending()
    time.sleep(60)
```

### Example 3: Beautify Before Preview

```javascript
async function previewWithBeautify() {
    const html = document.getElementById('htmlInput').value;
    
    // Beautify first
    const beautifyResponse = await fetch('/beautify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html })
    });
    
    const beautified = await beautifyResponse.json();
    
    if (beautified.validation.valid) {
        // Show preview
        showPreview(beautified.html);
        notificationManager.success('HTML Valid', 'No issues found');
    } else {
        notificationManager.error(
            'HTML Issues',
            beautified.validation.issues.join(', ')
        );
    }
}
```

## Configuration

### HTML Beautifier Settings:
```python
# src/utils/html_beautifier.py
beautifier = HTMLBeautifier(indent_size=4)  # Change indentation
```

### Performance Metrics Settings:
```python
# src/utils/performance_metrics.py
# Metrics are automatically tracked, no configuration needed
```

### Progress Tracker Settings:
```javascript
// static/js/notifications.js
// Customize stages in your code
progressTracker.start([
    'Custom stage 1',
    'Custom stage 2',
    'Custom stage 3'
]);
```

### Notification Settings:
```javascript
// static/js/notifications.js
// Customize durations
notificationManager.success('Title', 'Message', 10000);  // 10 seconds
```

### Cleanup Settings:
```python
# cleanup_scheduler.py
file_cleanup = FileCleanup(max_age_days=14)  # Change default age
```

## Troubleshooting

### HTML Beautifier Issues:
- **Malformed HTML**: Beautifier may not fix severely broken HTML
- **Custom Tags**: May not recognize custom web components
- **Solution**: Validate HTML first, fix critical issues manually

### Performance Metrics Not Showing:
- **Check operation_id**: Ensure you're using the correct ID
- **Check response**: Verify metrics are in the response
- **Solution**: Check browser console for errors

### Progress Bar Not Updating:
- **Check element IDs**: Ensure HTML elements exist
- **Check JavaScript**: Verify notifications.js is loaded
- **Solution**: Check browser console for errors

### Notifications Not Appearing:
- **Desktop**: Check browser notification permissions
- **Toast**: Verify CSS is loaded correctly
- **Solution**: Grant notification permission in browser settings

### Cleanup Not Running:
- **Scheduler**: Ensure cleanup_scheduler.py is running
- **Permissions**: Check file write permissions
- **Solution**: Run manually first to test: `python cleanup_scheduler.py`

## Performance Impact

- **HTML Beautifier**: ~10-50ms per operation
- **Performance Metrics**: <1ms overhead
- **Progress Indicators**: Negligible (UI only)
- **Notifications**: <1ms per notification
- **Automatic Cleanup**: Runs in background, no impact on main app

## Best Practices

1. **HTML Beautifier**: Use for user-generated HTML, not AI-generated (already formatted)
2. **Performance Metrics**: Monitor for optimization opportunities
3. **Progress Indicators**: Use for operations >2 seconds
4. **Notifications**: Don't spam users with too many notifications
5. **Cleanup**: Adjust age based on your storage capacity

## Future Enhancements

- HTML beautifier presets (compact, expanded, etc.)
- Performance metrics dashboard
- Progress bar customization
- Notification sound effects
- Cleanup scheduling UI
- Cleanup by file size threshold
- Export performance reports
