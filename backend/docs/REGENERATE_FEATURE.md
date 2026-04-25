# Regenerate Screenshots Feature

## Overview
The regenerate feature provides an intelligent workflow for adjusting screenshot settings and comparing versions. After initial generation, the interface adapts to show only relevant options, and after regeneration, you can compare both versions side-by-side before choosing which to keep.

## Smart Workflow

### 1. Initial Generation
- Enter text or HTML and click "Generate Screenshots"
- Screenshots are created and HTML file is saved

### 2. After First Generation
- **Generate button is hidden** - no need to regenerate from scratch
- **Preview HTML button remains** - you can still preview the HTML
- **Regenerate button appears (disabled)** - waiting for settings changes

### 3. Adjusting Settings
- Change any setting (zoom, viewport, overlap, etc.)
- **Regenerate button becomes enabled** automatically
- Button stays disabled until you actually change something

### 4. Regeneration
- Click "Regenerate with New Settings"
- New screenshots are created from the saved HTML file
- **No AI re-processing** - uses existing HTML

### 5. Version Comparison
After regeneration, you see:
- **Side-by-side comparison** of previous vs new version
- Previous version on the left (gray border)
- New version on the right (green border, marked as "Regenerated")
- Each version shows all its screenshots
- Click any screenshot to view full size

### 6. Choose Version
- Click "Keep This Version" on either side
- Confirmation dialog appears
- Selected version is kept
- **Other version is automatically deleted** from the server
- Results display updates to show only the kept version

## Benefits

1. **Clean Interface**: Only shows relevant buttons based on current state
2. **No Accidental Regeneration**: Button disabled until settings actually change
3. **Visual Comparison**: See both versions side-by-side before deciding
4. **Automatic Cleanup**: Unwanted version is deleted automatically
5. **No AI Costs**: Regeneration uses saved HTML, no API calls
6. **Single Location**: Everything happens in one place

## Workflow Example

1. Generate screenshots from text: "Create a landing page for a coffee shop"
2. Review the generated screenshots
3. Notice "Generate" button is now hidden
4. Increase zoom to 3.5x
5. "Regenerate" button becomes enabled
6. Click "Regenerate with New Settings"
7. See side-by-side comparison:
   - Left: Original version (zoom 2.5x)
   - Right: New version (zoom 3.5x)
8. Click "Keep This Version" on the right (new version)
9. Confirm deletion of old version
10. Only new version remains

## Technical Details

### State Management
- `lastGeneratedHtmlFile`: Stores HTML filename
- `lastGeneratedSettings`: Stores last used settings for comparison
- `currentVersionScreenshots`: Current screenshot files
- `previousVersionScreenshots`: Previous screenshot files (for comparison)

### Button States
- **Initial**: Show "Generate" button
- **Generated**: Hide "Generate", show "Regenerate" (disabled)
- **Settings Changed**: Enable "Regenerate" button
- **After Regeneration**: Show version comparison

### Settings Tracking
The system tracks these settings for changes:
- Screenshot name
- Zoom level (1-5x)
- Overlap (0-200px)
- Viewport width (800-3840px)
- Viewport height (600-2160px)
- Max screenshots (1-100)

### Version Comparison
- Creates side-by-side grid layout
- Previous version: Gray border, standard styling
- New version: Green border, highlighted as "Regenerated"
- Each version has "Keep This Version" button
- Clicking keeps selected version and deletes the other

### Automatic Deletion
When a version is selected:
1. Confirmation dialog appears
2. Files from non-selected version are deleted via `/delete/screenshot/{filename}` endpoint
3. Success/error notifications shown
4. Display updates to show only kept version
5. State is updated for future regenerations

## API Endpoints Used

- **POST /regenerate**: Regenerate screenshots from HTML file
- **DELETE /delete/screenshot/{filename}**: Delete individual screenshot files

## Notes

- HTML files are preserved (only screenshots are managed)
- Each regeneration creates new files with unique names
- Comparison works for any number of screenshots
- Settings must actually change to enable regeneration
- Both versions remain until user makes a choice
- Automatic cleanup prevents disk space waste
