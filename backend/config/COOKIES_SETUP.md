# YouTube Cookies Setup

Some YouTube videos require authentication (age-restricted, members-only, etc.).
To fix "Please sign in" errors, export your YouTube cookies to a file.

## Steps

### 1. Install a cookies export extension

Use one of these browser extensions:
- **Chrome**: [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
- **Firefox**: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

### 2. Export cookies

1. Go to [youtube.com](https://www.youtube.com) and make sure you're signed in
2. Click the extension icon
3. Click "Export" or "Current Site" to download cookies for youtube.com
4. Save/rename the file as `cookies.txt`

### 3. Place the file

Copy the exported `cookies.txt` file to:

```
backend/config/cookies.txt
```

That's it. The YouTube Screenshots tool will automatically use it for downloads.

## Notes

- The cookies file is gitignored (contains your session — never commit it)
- If cookies expire (downloads start failing again), re-export from your browser
- You only need cookies for videos that require sign-in; public videos work without it
