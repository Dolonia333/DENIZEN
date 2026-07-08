---
name: pdf-generator
description: Generate PDFs from HTML content, templates, or URLs using headless Chromium. Preview HTML via canvas.
metadata: {"openclaw":{"emoji":"📄","requires":{"bins":["node"]}}}
---

# PDF Generator

Generate professional PDFs from HTML content using headless Chromium (Playwright).
Preview generated content live via the canvas host.

## Overview

This skill converts HTML to PDF locally using a headless browser. It supports:
- Inline HTML strings
- HTML files on disk
- Live URLs
- Custom page size, orientation, margins, headers, and footers

The generated PDFs preserve CSS styling, web fonts, images, and print backgrounds.

## IMPORTANT: Preview Workflow

When creating documents for the user, ALWAYS follow this workflow:

### Step 1: Write the HTML to the canvas directory for live preview

```bash
cat > C:\Users\zionv\.openclaw\canvas\preview.html << 'HTML'
<!DOCTYPE html>
<html>
<head><style>/* your styles */</style></head>
<body><!-- your content --></body>
</html>
HTML
```

### Step 2: Tell the user to view the preview

After writing the file, tell the user:

> Preview is ready. Open this link to see it:
> http://localhost:18789/__moltbot__/canvas/preview.html
> (or via tunnel: https://dolobot.2iwin.com/__moltbot__/canvas/preview.html)

The canvas has **live reload** enabled — if you update the file, the browser auto-refreshes.

### Step 3: Generate the PDF

Once the user is happy with the preview (or immediately if they asked for a PDF):

```bash
node skills/pdf-generator/pdf-generator.mjs --file "C:\Users\zionv\.openclaw\canvas\preview.html" --output "C:\Users\zionv\.openclaw\workspace\output.pdf" --format Letter --margin "0"
```

### Step 4: Show the inline preview and tell the user the PDF path

After calling `generate_pdf`, the tool result JSON includes a `previewMarkdown` field like:
```
![PDF Preview](/__moltbot__/canvas/output.preview.png)
```

**ALWAYS include this markdown image in your response to show the preview inline in chat.**

Example response:
```
Here's your proposal:

![PDF Preview](/__moltbot__/canvas/dolonia-proposal.preview.png)

PDF saved to: C:\Users\zionv\.openclaw\workspace\dolonia-proposal.pdf
Preview: http://localhost:18789/__moltbot__/canvas/proposal.html
```

The user will see a visual thumbnail of the PDF directly in the chat message.

## Canvas Directory

The canvas host serves files from: `C:\Users\zionv\.openclaw\canvas\`

Any HTML file you write there is immediately viewable at:
```
http://localhost:18789/__moltbot__/canvas/<filename>.html
```

Use descriptive filenames for different documents:
- `preview.html` — general preview
- `proposal-thunderwalker.html` — client-specific proposal
- `media-kit.html` — media kit preview
- `menu.html` — social media menu

## Script Location

The generator script is at:
```
C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw\skills\pdf-generator\pdf-generator.mjs
```

Run it from the OpenClaw project root directory:
```
C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw
```

## Usage

### Generate from inline HTML

```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/pdf-generator/pdf-generator.mjs --html "<html><head><style>body{font-family:Arial,sans-serif;padding:40px}h1{color:#2563eb}</style></head><body><h1>Dolonia Media Kit</h1><p>Professional social media management services.</p></body></html>" --output "C:\Users\zionv\.openclaw\workspace\media-kit.pdf"
```

### Generate from an HTML file (recommended)

Write the HTML first, then convert:

```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/pdf-generator/pdf-generator.mjs --file "C:\Users\zionv\.openclaw\canvas\preview.html" --output "C:\Users\zionv\.openclaw\workspace\proposal.pdf"
```

### Generate from a URL

```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/pdf-generator/pdf-generator.mjs --url "http://localhost:18789/__moltbot__/canvas/preview.html" --output "C:\Users\zionv\.openclaw\workspace\report.pdf"
```

### Custom page settings

```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/pdf-generator/pdf-generator.mjs --file "C:\Users\zionv\.openclaw\canvas\preview.html" --output "C:\Users\zionv\.openclaw\workspace\report.pdf" --format A4 --landscape true --margin "1in" --scale 0.8
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--html` | — | Inline HTML string to render |
| `--file` | — | Path to an HTML file |
| `--url` | — | URL to load and render |
| `--output` | `output.pdf` | Output PDF file path |
| `--format` | `Letter` | Page size: `Letter`, `A4`, `Legal`, `Tabloid` |
| `--landscape` | `false` | Set to `true` for landscape orientation |
| `--margin` | `0.5in` | Page margins (CSS units) |
| `--header` | — | Header HTML template |
| `--footer` | — | Footer HTML template |
| `--wait` | `1000` | Milliseconds to wait after page load |
| `--scale` | `1` | Scale factor (0.1 to 2.0) |

## Output

The script prints a JSON result to stdout:

**Success:**
```json
{"success": true, "path": "C:\\Users\\...\\output.pdf", "format": "Letter", "landscape": false}
```

**Failure:**
```json
{"success": false, "error": "File not found: ..."}
```

## Complete Example: Professional Proposal

### 1. Write HTML to canvas for preview

```bash
cat > "C:\Users\zionv\.openclaw\canvas\proposal.html" << 'HTML'
<!DOCTYPE html>
<html>
<head>
<style>
  @page { margin: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; color: #1a1a2e; }
  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 60px 50px; }
  .header h1 { font-size: 36px; margin: 0; }
  .header p { font-size: 18px; opacity: 0.9; margin-top: 10px; }
  .content { padding: 50px; }
  .section { margin-bottom: 30px; }
  .section h2 { color: #667eea; border-bottom: 2px solid #667eea; padding-bottom: 8px; }
  .price-box { background: #f8f9fa; border-left: 4px solid #667eea; padding: 20px; margin: 20px 0; }
  .footer { text-align: center; padding: 30px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
</style>
</head>
<body>
  <div class="header">
    <h1>Social Media Management Proposal</h1>
    <p>Prepared for: Thunder Walker | Date: February 2026</p>
  </div>
  <div class="content">
    <div class="section">
      <h2>Services Included</h2>
      <ul>
        <li>Content creation and scheduling (3 platforms)</li>
        <li>Community management and engagement</li>
        <li>Monthly analytics and reporting</li>
        <li>Brand voice development</li>
      </ul>
    </div>
    <div class="section">
      <h2>Investment</h2>
      <div class="price-box">
        <strong>Monthly Retainer:</strong> $2,500/month<br>
        <strong>Contract Term:</strong> 3 months minimum
      </div>
    </div>
  </div>
  <div class="footer">Dolonia Media | dolonia.cloud</div>
</body>
</html>
HTML
```

### 2. Tell user to preview

> Preview ready: http://localhost:18789/__moltbot__/canvas/proposal.html

### 3. Generate PDF

```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/pdf-generator/pdf-generator.mjs --file "C:\Users\zionv\.openclaw\canvas\proposal.html" --output "C:\Users\zionv\.openclaw\workspace\dolonia-proposal.pdf" --format Letter --margin "0"
```

### 4. Tell user the result with inline preview

> Here's your proposal:
>
> ![PDF Preview](/__moltbot__/canvas/dolonia-proposal.preview.png)
>
> PDF saved to: C:\Users\zionv\.openclaw\workspace\dolonia-proposal.pdf
> Preview: http://localhost:18789/__moltbot__/canvas/proposal.html

## Tips

- ALWAYS write HTML to the canvas directory first so the user can preview it
- ALWAYS give the user the preview URL after writing
- Use `--margin "0"` if your HTML has its own padding/header backgrounds that go edge-to-edge
- For multi-page documents, CSS `page-break-before: always` works for forced page breaks
- Web fonts from Google Fonts work if the HTML includes the `<link>` tag
- Images can be inline base64 data URIs or file:// URLs for local files
- The script uses `networkidle` to wait for resources; add `--wait 2000` for slow-loading content
- The canvas has live reload — updating the HTML file auto-refreshes the browser
- Save PDFs to `C:\Users\zionv\.openclaw\workspace\` to keep them organized
