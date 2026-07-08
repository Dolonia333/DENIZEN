---
name: screen-capture
description: Capture a screenshot of the desktop or a specific window.
metadata: {"openclaw":{"emoji":"📸","requires":{"bins":["ffmpeg"]}}}
---

# Screen Capture

Capture OS-level screenshots on Windows using ffmpeg's gdigrab input.

## Usage

```bash
# Full desktop screenshot
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/screen-capture/screen-capture.mjs

# Capture a specific window by title
node skills/screen-capture/screen-capture.mjs --title "Notepad"

# Capture a region (x,y,width,height)
node skills/screen-capture/screen-capture.mjs --region "100,100,800,600"

# Custom output path
node skills/screen-capture/screen-capture.mjs --output "C:\Users\zionv\.openclaw\canvas\my-screenshot.png"
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--title` | (none) | Window title to capture instead of full desktop |
| `--region` | (none) | Region as `x,y,width,height` |
| `--output` | auto (canvas dir) | Custom output file path |

## Output

Returns JSON with:
- `success`: boolean
- `filePath`: absolute path to the PNG
- `previewUrl`: base64 data URI for inline chat display
- `canvasUrl`: canvas host URL path

The `previewUrl` will display the screenshot inline in the chat.
