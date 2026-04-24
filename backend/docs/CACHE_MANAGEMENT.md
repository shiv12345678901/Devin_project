# Cache Management

## Overview
Screenshot Studio caches AI responses to save time and API costs. The cache stores responses based on input text, so identical requests return instantly without calling the AI API again.

## Cache Clear Button

### Location
- Bottom of the sidebar
- Always visible and accessible
- Shows cache statistics below the button

### Features
- **Clear AI Cache**: Removes all cached AI responses
- **Cache Stats**: Shows number of cached items and hit rate
- **Confirmation**: Asks for confirmation before clearing
- **Auto-refresh**: Stats update every 30 seconds

### Visual Design
- Semi-transparent button with trash icon
- Hover effect for better visibility
- Small text showing cache statistics
- Fits naturally in sidebar design

## How It Works

### Caching Behavior
1. **First Request**: Text is sent to AI, response is cached
2. **Subsequent Requests**: Same text returns cached response instantly
3. **Cache Hit**: Shows "✓ Cache hit!" in terminal
4. **Fresh Request**: After clearing cache, new AI call is made

### Cache Statistics
- **Cache Size**: Number of cached responses
- **Hit Rate**: Percentage of requests served from cache
- **Updates**: Refreshes every 30 seconds automatically

### When to Clear Cache

**Clear cache when:**
- You want fresh AI responses for the same text
- AI model has been updated
- You're testing different AI behaviors
- Cache has grown too large
- You want to force regeneration

**Don't clear cache when:**
- Working with same content repeatedly
- Want to save API costs
- Need consistent responses
- Testing other features

## API Endpoints

### GET /cache/stats
Returns cache statistics:
```json
{
  "cache_size": 15,
  "cache_hits": 42,
  "cache_misses": 8,
  "total_requests": 50,
  "hit_rate": 0.84
}
```

### POST /cache/clear
Clears all cached responses:
```json
{
  "success": true,
  "message": "Cache cleared successfully"
}
```

## User Interface

### Button Appearance
```
┌─────────────────────────┐
│  [🗑️] Clear AI Cache    │
│  15 cached • 84% hit    │
└─────────────────────────┘
```

### Confirmation Dialog
```
Clear AI response cache?
This will force fresh AI responses for all future requests.

[Cancel]  [OK]
```

### Success Notification
```
✓ Cache Cleared
AI response cache has been cleared successfully
```

## Technical Details

### Frontend Functions
- `clearCache()`: Sends POST request to clear cache
- `updateCacheStats()`: Fetches and displays cache statistics
- Auto-updates every 30 seconds

### Backend Implementation
- Uses `cache.clear()` from cache_manager
- Returns success/failure status
- Thread-safe operation

### Cache Storage
- In-memory cache (lost on server restart)
- Key: Hash of input text
- Value: AI response content
- No size limit (grows with usage)

## Benefits

1. **Cost Savings**: Avoid repeated API calls for same content
2. **Speed**: Instant responses for cached content
3. **Consistency**: Same input always returns same output
4. **Transparency**: See cache usage statistics
5. **Control**: Clear cache when needed

## Best Practices

### For Development
- Clear cache when testing AI changes
- Monitor hit rate to optimize caching
- Clear cache after model updates

### For Production
- Let cache grow naturally
- Clear only when necessary
- Monitor cache size periodically

### For Testing
- Clear cache before each test run
- Verify cache hit/miss behavior
- Test with and without cache

## Troubleshooting

### Cache Not Clearing
- Check browser console for errors
- Verify server is running
- Check network tab for failed requests

### Stats Not Updating
- Wait 30 seconds for auto-refresh
- Reload page to force update
- Check /cache/stats endpoint directly

### Unexpected Cache Hits
- Input text must match exactly
- Whitespace differences matter
- Clear cache to force fresh response

## Future Enhancements

Potential improvements:
- Persistent cache (save to disk)
- Cache size limits
- Automatic cache expiration
- Per-user cache management
- Cache export/import
- Selective cache clearing
