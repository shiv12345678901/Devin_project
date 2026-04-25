# Version Comparison Feature

## Overview
After regenerating screenshots with new settings, the system displays an interactive slider-based comparison that lets you drag a center line to see the differences between versions. This professional, device-friendly interface makes it easy to compare quality and choose which version to keep.

## Visual Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Compare versions and choose which to keep. Drag the slider │
└─────────────────────────────────────────────────────────────┘

        [Keep Previous Version]  [Keep New Version]

┌──────────────────────────────────────────────────────────────┐
│  ← Previous        Part 1              New →                 │
├──────────────────────────────────────────────────────────────┤
│                          │                                    │
│   Previous Image         │  New Image                         │
│                          │                                    │
│                      [Draggable                               │
│                       Slider]                                 │
│                          │                                    │
└──────────────────────────────────────────────────────────────┘
         Drag the center line left/right to compare
```

## Interactive Slider

### Features
- **Draggable Center Line**: Drag left or right to reveal more of either version
- **Visual Handle**: White circular handle with arrows for easy grabbing
- **Smooth Animation**: Fluid movement as you drag
- **Touch Support**: Works on mobile devices and tablets
- **Responsive**: Adapts to any screen size
- **Professional Look**: Clean design with subtle shadows

### How to Use
1. **Click and Drag**: Click the center handle and drag left/right
2. **Touch and Drag**: On mobile, touch and drag the handle
3. **Compare**: Move the slider to see differences in quality, layout, zoom
4. **Choose**: Click "Keep Previous Version" or "Keep New Version" at the top

## User Flow

### Step 1: Regenerate
User changes settings and clicks "Regenerate with New Settings"

### Step 2: Slider Comparison
System displays interactive sliders:
- One slider for each screenshot pair
- Previous version on left (gray label)
- New version on right (green label)
- Draggable center line at 50% position

### Step 3: Interactive Review
User can:
- Drag each slider to compare versions
- See exact differences in zoom, quality, layout
- Compare multiple screenshots if available
- Works smoothly on desktop and mobile

### Step 4: Choose Version
User clicks one of the buttons at top:
- "Keep Previous Version" (left button)
- "Keep New Version" (right button)

### Step 5: Confirmation
System shows confirmation dialog:
```
Keep [previous/new] version? 
This will delete X file(s) from the other version.
```

### Step 6: Automatic Cleanup
After confirmation:
- Selected version's files are kept
- Other version's files are deleted from server
- Display updates to show only kept version
- Notification confirms the action

## Visual Design

### Slider Components

**Header Bar**:
- Light gray background
- "← Previous" label on left
- "Part X" in center
- "New →" label on right (green)

**Slider Container**:
- White border and shadow
- Rounded corners
- Hover effect (lifts slightly)
- Responsive width (max 1200px)

**Center Handle**:
- White circular button (48px)
- Up/down arrows icon
- Drop shadow for depth
- Scales on hover
- Smooth transitions

**Divider Line**:
- Vertical white line (4px)
- Extends full height
- Shadow for visibility
- Moves with handle

### Special Cases

**Different Screenshot Counts**:
- If previous has more: Shows warning badge "⚠️ Only in Previous Version"
- If new has more: Shows success badge "✨ Only in New Version"
- Single-version screenshots shown with colored borders

**Color Coding**:
- Previous only: Yellow/amber border (#ffc107)
- New only: Green border (#4CAF50)
- Comparison: White divider line

## Technical Implementation

### Function: `showVersionComparison(type, previousFiles, newFiles)`
Creates the slider-based comparison:
- Generates action buttons at top
- Creates slider for each screenshot pair
- Handles different screenshot counts
- Initializes interactive sliders

### Function: `initComparisonSlider(sliderId)`
Makes sliders interactive:
- Sets up mouse event listeners
- Sets up touch event listeners
- Handles drag calculations
- Updates overlay width and handle position
- Prevents image dragging

### Event Handling
```javascript
// Mouse events
mousedown → start dragging
mousemove → update position
mouseup → stop dragging

// Touch events
touchstart → start dragging
touchmove → update position
touchend → stop dragging
```

### Position Calculation
```javascript
const rect = slider.getBoundingClientRect();
const offsetX = x - rect.left;
const percentage = (offsetX / rect.width) * 100;
// Clamp between 0-100%
```

## Example Scenario

### Initial Generation
```
Settings: Zoom 2.5x, Viewport 1920x1080
Result: 3 screenshots created
```

### Regeneration
```
Changed Settings: Zoom 3.5x, Viewport 1280x720
Result: 3 screenshots created
```

### Slider Comparison
```
Part 1: [Slider] - Drag to compare zoom difference
Part 2: [Slider] - Drag to compare zoom difference  
Part 3: [Slider] - Drag to compare zoom difference
```

### User Interaction
```
1. Drag Part 1 slider → See zoom 2.5x vs 3.5x
2. Drag Part 2 slider → Compare layout changes
3. Drag Part 3 slider → Check text readability
4. Click "Keep New Version"
5. Confirm deletion
6. Old version deleted, new version kept
```

## Benefits

1. **Professional Interface**: Modern slider design like image editing tools
2. **Easy Comparison**: Drag to see exact differences
3. **Device Friendly**: Works on desktop, tablet, and mobile
4. **Intuitive**: Natural drag interaction
5. **Precise**: See differences pixel-by-pixel
6. **Responsive**: Adapts to any screen size
7. **Touch Optimized**: Smooth touch gestures on mobile

## Responsive Design

### Desktop (>768px)
- Full-width sliders (max 1200px)
- 48px handle size
- Hover effects enabled
- Mouse drag support

### Mobile (≤768px)
- Full-width sliders
- 40px handle size (easier to tap)
- Touch drag support
- Optimized spacing

## CSS Features

### Animations
- Smooth handle movement
- Hover scale effect
- Active press effect
- Shadow transitions

### Visual Polish
- Box shadows for depth
- Border radius for modern look
- Subtle hover lift effect
- Crisp image rendering

## Error Handling

### Edge Cases
- No previous version: Shows only new version
- Different file counts: Shows badges for unique screenshots
- Failed image load: Browser handles gracefully
- Touch/mouse conflicts: Proper event handling

### Browser Compatibility
- Modern browsers: Full slider support
- Touch devices: Native touch events
- Older browsers: Graceful degradation

## Future Enhancements

Potential improvements:
- Keyboard arrow key support
- Double-click to reset to 50%
- Zoom in/out on images
- Settings diff display
- Animation between positions
- Preset positions (25%, 50%, 75%)
- Fullscreen comparison mode
