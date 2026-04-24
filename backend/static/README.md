# Frontend Structure

This folder contains the modular frontend components for Screenshot Studio.

## Directory Structure

```
static/
├── css/
│   └── styles.css          # Main stylesheet with all UI components
├── js/
│   ├── navigation.js       # Navigation, tabs, and UI controls
│   ├── text-to-image.js    # Text to Image tool functionality
│   ├── html-to-image.js    # HTML to Image tool functionality
│   └── utils.js            # Shared utility functions
└── README.md               # This file
```

## File Descriptions

### CSS
- **styles.css**: Contains all styles including:
  - Layout (sidebar, main content)
  - Components (buttons, forms, cards)
  - Utilities (loading, alerts, grids)
  - Responsive design

### JavaScript Modules

#### navigation.js
- Tool switching between Text to Image and HTML to Image
- Advanced settings toggle
- Reset to defaults functionality
- HTML tab switching (paste/upload)
- File upload handler

#### text-to-image.js
- Handles text input processing
- Collects all settings (output, advanced)
- Makes API call to `/generate` endpoint
- Error handling and loading states

#### html-to-image.js
- Handles HTML input (paste or upload)
- Makes API call to `/generate-html` endpoint
- Error handling and loading states

#### utils.js
- `displayResults()`: Renders screenshot grid
- Shared utility functions
- Can be extended with more helpers

## Customization Guide

### Adding a New Tool

1. **Add navigation item** in `templates/index.html`:
```html
<div class="nav-item" onclick="switchTool('new-tool')">
    <svg class="nav-icon">...</svg>
    New Tool
</div>
```

2. **Add tool section** in `templates/index.html`:
```html
<div id="new-tool" class="tool-section">
    <!-- Tool content -->
</div>
```

3. **Create JS file** `static/js/new-tool.js`:
```javascript
async function generateFromNewTool() {
    // Implementation
}
```

4. **Import in** `templates/index.html`:
```html
<script src="{{ url_for('static', filename='js/new-tool.js') }}"></script>
```

### Modifying Styles

All styles are in `static/css/styles.css`. The design uses CSS variables for easy theming:

```css
:root {
    --primary: #34A853;        /* Main green color */
    --primary-dark: #2D8E47;   /* Darker green */
    --primary-light: #E8F5E9;  /* Light green background */
    --bg-white: #FFFFFF;
    --bg-gray: #F8F9FA;
    --text-primary: #202124;
    --text-secondary: #5F6368;
    --border: #DADCE0;
}
```

### Adding New Settings

1. Add input field in the settings section
2. Collect value in `generateFromText()` function
3. Pass to backend in settings object
4. Handle in Flask route

## Best Practices

1. **Keep modules focused**: Each JS file should handle one tool/feature
2. **Use CSS variables**: For consistent theming
3. **Follow naming conventions**: 
   - CSS: kebab-case (`.form-input`)
   - JS: camelCase (`generateFromText`)
4. **Add comments**: Explain complex logic
5. **Test responsiveness**: Check mobile/tablet views

## Dependencies

- Google Fonts (Roboto, Google Sans)
- No external JS libraries (vanilla JavaScript)
- Flask for serving static files
