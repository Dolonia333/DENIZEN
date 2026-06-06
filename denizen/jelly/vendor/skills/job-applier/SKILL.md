---
name: job-applier
description: "Auto-fill and submit job applications on LinkedIn, Indeed, Greenhouse, Lever, Workday, and other ATS platforms."
metadata: {"openclaw":{"emoji":"🚀","requires":{"bins":["node"]}}}
---

# Job Applier

Automatically fill and submit job applications using browser automation. Supports LinkedIn Easy Apply, Indeed, and common ATS platforms (Workday, Greenhouse, Lever, iCIMS).

## CRITICAL: Always Dry-Run First

**NEVER submit an application without the user reviewing it first.** Always use `--dry-run true` for the first attempt on any job, show the screenshot to the user, and only submit after approval.

## Workflow

### 1. Generate a tailored resume
Use the `resume-generator` skill first to create a targeted PDF:
```bash
cd C:\Users\zionv\OneDrive\Desktop\multbot\openclaw && node skills/resume-generator/resume-generator.mjs --profile profile.json --job job.json --template modern --pdf "C:\Users\zionv\.openclaw\workspace\tailored-resume.pdf"
```

### 2. Dry-run the application
```bash
cd C:\Users\zionv\OneDrive\Desktop\multbot\openclaw && node skills/job-applier/job-applier.mjs --job-id "SUPABASE_JOB_ID" --resume-pdf "C:\Users\zionv\.openclaw\workspace\tailored-resume.pdf" --dry-run true
```

### 3. Show the user the screenshot
The output includes a `screenshot` canvas URL. Tell the user:

> Here's what the application looks like before submission:
> ![Application Preview](screenshot_url)
>
> Fields filled: name, email, phone, resume
> Should I submit this application?

### 4. Submit if approved
```bash
cd C:\Users\zionv\OneDrive\Desktop\multbot\openclaw && node skills/job-applier/job-applier.mjs --job-id "SUPABASE_JOB_ID" --resume-pdf "C:\Users\zionv\.openclaw\workspace\tailored-resume.pdf" --dry-run false
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--job-id` | — | Supabase document ID for the job listing (required unless --url) |
| `--url` | — | Direct URL to apply to (alternative to --job-id) |
| `--resume-pdf` | — | Path to the resume PDF to upload |
| `--cover-letter` | — | Cover letter text (for forms that accept it) |
| `--dry-run` | `true` | Fill form but don't submit. Set to `false` to submit. |
| `--headless` | `true` | Set to `false` for visible browser |

## Supported Platforms

| Platform | Method | Notes |
|----------|--------|-------|
| LinkedIn Easy Apply | Modal form | Multi-step, file upload, screening questions |
| Indeed | Form page | Contact info + resume upload |
| Workday | Generic | Click apply → fill fields |
| Greenhouse | Generic | Usually has a clean form |
| Lever | Generic | Similar to Greenhouse |
| iCIMS | Generic | May require more fields |
| Other | Generic | Best-effort field detection |

## Daily Application Cap

Default limit: **20 applications per day**. To change:

```bash
curl -s -X POST http://localhost:18791/insert \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table": "key_value", "rows": [{"key": "job_apply_config", "value": {"daily_cap": 30}}]}'
```

## Error Handling

| Error | What to Do |
|-------|------------|
| "No Easy Apply button" | Job requires external application — use direct URL or skip |
| "External application required" | Navigate to external URL and use generic ATS handler |
| "Could not find apply button" | Run with `--headless false` and help fill manually |
| "Daily cap reached" | Wait until tomorrow or increase cap |
| "Browser launch failed" | Check Playwright installation |

## Batch Mode

To apply to multiple jobs, loop through approved listings:

1. Query saved jobs: get list from Supabase where status=new
2. For each job:
   - Generate tailored resume
   - Dry-run → show user → get approval
   - Submit if approved
   - Update status
3. Report summary when done

The agent should NOT batch-submit without per-job user approval on the first few applications. After the user is comfortable with the quality, they can tell the agent to auto-submit.

## Output

```json
{
  "success": true,
  "submitted": true,
  "message": "Application submitted via LinkedIn Easy Apply",
  "filled_fields": ["first_name", "last_name", "email", "phone", "resume"],
  "screenshot": "/__moltbot__/canvas/apply-linkedin-confirm.png",
  "steps": 3
}
```
