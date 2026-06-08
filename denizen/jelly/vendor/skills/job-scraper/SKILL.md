---
name: job-scraper
description: "Scrape job listings from LinkedIn, Indeed, Glassdoor, ZipRecruiter, or any direct URL. Saves to Supabase with deduplication."
metadata: {"openclaw":{"emoji":"🔍","requires":{"bins":["node"]}}}
---

# Job Scraper

Scrape job postings from major job boards and store them in Supabase for tracking and auto-apply.

## IMPORTANT: First-Time Login Setup

Most job sites require login for full results. Before first use on a site:

```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/job-scraper/job-scraper.mjs --site linkedin --query "test" --pages 1 --headless false
```

This opens a **visible browser**. Tell the user:

> A browser window has opened. Please log into LinkedIn (or Indeed, etc.) with your account.
> Once logged in, close the browser or wait for it to close automatically.

The login session persists in `C:\Users\zionv\.openclaw\browser\job-apply\user-data` — future runs will reuse it.

## Usage

### LinkedIn
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/job-scraper/job-scraper.mjs --site linkedin --query "React Developer" --location "Austin, TX" --pages 3 --remote-only true
```

### Indeed
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/job-scraper/job-scraper.mjs --site indeed --query "Full Stack Engineer" --location "Remote" --pages 3
```

### Glassdoor
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/job-scraper/job-scraper.mjs --site glassdoor --query "Software Engineer" --location "San Francisco" --pages 2
```

### ZipRecruiter
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/job-scraper/job-scraper.mjs --site ziprecruiter --query "Python Developer" --location "New York" --pages 2
```

### Direct URL (scrape a specific job posting)
```bash
cd C:\Users\zionv\OneDrive\Desktop\Denizen\openclaw && node skills/job-scraper/job-scraper.mjs --site direct --url "https://boards.greenhouse.io/company/jobs/12345"
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--site` | `linkedin` | Job board: `linkedin`, `indeed`, `glassdoor`, `ziprecruiter`, `direct` |
| `--query` | — | Search query (required unless --url) |
| `--location` | — | Location filter |
| `--pages` | `3` | Max pages to scrape (max 3 recommended) |
| `--remote-only` | `false` | Filter for remote jobs only |
| `--url` | — | Direct URL to scrape (for --site direct) |
| `--headless` | `true` | Set to `false` for visible browser (needed for login) |
| `--save` | `true` | Set to `false` to preview without saving to Supabase |

## Output

```json
{
  "success": true,
  "site": "linkedin",
  "query": "React Developer",
  "location": "Austin, TX",
  "total_found": 25,
  "saved": 22,
  "duplicates": 3,
  "screenshot": "/__moltbot__/canvas/scrape-linkedin-1708300000.png",
  "jobs": [
    { "title": "React Developer", "company": "Acme Inc", "location": "Austin, TX", "url": "...", "easy_apply": true }
  ]
}
```

## Error Handling

| Error | Action |
|-------|--------|
| `needs_login: true` | Run with `--headless false`, let user log in |
| `needs_captcha: true` | Wait and retry, or run with `--headless false` |
| `Browser launch failed` | Check that Playwright Chromium is installed |

## Anti-Bot Protections

- Persistent browser session (real cookies)
- Random delays 3-8s between page loads
- Human-like scrolling before extraction
- Max 3 pages per session (configurable)
- Rate limiter: minimum 5s between navigations

## Workflow

1. User says "find me React jobs in Austin"
2. Run scraper for each relevant site (LinkedIn + Indeed recommended)
3. Report results: "Found 45 jobs (22 new, 3 duplicates). Top results: ..."
4. Show screenshot from canvas for visual confirmation
5. User can then use job-applier to apply to specific listings
