---
name: canvas-render
description: "Render any canvas HTML to a screenshot or run JavaScript — no physical device needed. Replaces 'canvas present' + 'canvas snapshot'."
metadata: {"openclaw":{"emoji":"🖼️","requires":{"bins":["node"]}}}
---

# Canvas Render

Take screenshots of HTML content from the canvas directory or any URL. Works without a connected device/node.

**Use this instead of `canvas present` / `canvas snapshot`.**

## Usage

### Screenshot a canvas HTML file
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/canvas-render/canvas-render.mjs --file "C:\Users\zionv\.openclaw\canvas\resume-preview.html"
```

### Screenshot a URL (e.g., gateway-served canvas)
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/canvas-render/canvas-render.mjs --url "http://localhost:18789/__moltbot__/canvas/resume-preview.html"
```

### Run JavaScript and get result
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/canvas-render/canvas-render.mjs --url "http://localhost:18789/__moltbot__/canvas/game.html" --eval "document.title"
```

### Custom viewport and output
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/canvas-render/canvas-render.mjs --file "C:\Users\zionv\.openclaw\canvas\dashboard.html" --output "C:\Users\zionv\.openclaw\canvas\dashboard-snapshot.png" --width 1920 --height 1080
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--url` | — | URL to render (mutually exclusive with --file) |
| `--file` | — | Local HTML file path (mutually exclusive with --url) |
| `--output` | auto (canvas dir) | Output PNG path |
| `--eval` | — | JavaScript to evaluate on the page, returns result |
| `--width` | 1366 | Viewport width in pixels |
| `--height` | 768 | Viewport height in pixels |
| `--wait` | 2000 | Wait time (ms) after load before screenshot |

## Output

```json
{
  "success": true,
  "screenshot_path": "C:\\Users\\zionv\\.openclaw\\canvas\\resume-preview-render.png",
  "previewUrl": "data:image/png;base64,...",
  "eval_result": "My Resume"
}
```

The `previewUrl` is a base64 data URI — it renders inline in the chat UI automatically.

## When to Use

| Task | Use this skill |
|------|---------------|
| Preview a generated resume HTML | `--file C:\...\resume-preview.html` |
| Capture a dashboard/visualization | `--url http://localhost:18789/__moltbot__/canvas/...` |
| Get data from a rendered page | `--url ... --eval "JSON.stringify(appState)"` |
| Show web page content to user | `--url https://example.com` |

## vs `canvas` skill

The `canvas` skill requires a connected Mac/iOS/Android device. This skill uses headless Chromium and works anywhere. The trade-off is no live interactivity — this takes a static snapshot.
