---
name: resume-generator
description: "Generate tailored HTML/PDF resumes from your stored profile, optimized for specific job descriptions."
metadata: {"openclaw":{"emoji":"📝","requires":{"bins":["node"]}}}
---

# Resume Generator

Generate professional, tailored resumes from your Supabase profile. Supports 3 templates and automatic keyword-based tailoring for specific job postings.

## Templates

| Template | Style | Best For |
|----------|-------|----------|
| `modern` | Clean, blue accent, skills badges | Tech, startups, SaaS |
| `minimal` | Classic serif, centered header | Traditional companies, finance |
| `executive` | Dark sidebar, two-column | Senior roles, management |

## Quick Start

### Step 1: Fetch the profile from Supabase

```bash
curl -s -X POST http://localhost:18791/query \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table": "documents", "filters": {"category": {"eq": "resume_profile"}}, "limit": 1}'
```

Save the `data` field as a JSON file (e.g., `profile.json`).

### Step 2: Optionally fetch the job listing

If tailoring for a specific job:
```bash
curl -s -X POST http://localhost:18791/query \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table": "documents", "filters": {"id": {"eq": "JOB_ID"}}, "limit": 1}'
```

Save the `data` field as `job.json`.

### Step 3: Generate the resume

```bash
cd C:\Users\zionv\OneDrive\Desktop\multbot\openclaw && node skills/resume-generator/resume-generator.mjs --profile profile.json --job job.json --template modern --output "C:\Users\zionv\.openclaw\canvas\resume-preview.html" --pdf "C:\Users\zionv\.openclaw\workspace\resume.pdf"
```

**Arguments:**
- `--profile <json_or_path>` — Profile JSON string or path to JSON file (REQUIRED)
- `--job <json_or_path>` — Job listing JSON string or path to JSON file (optional, for tailoring)
- `--template modern|minimal|executive` — Template choice (default: modern)
- `--output <path>` — HTML output path (default: canvas dir)
- `--pdf <path>` — If provided, also generates PDF via pdf-generator

### Step 4: Preview and iterate

The HTML is written to the canvas directory. Tell the user:

> Resume preview ready: http://localhost:18789/__moltbot__/canvas/resume-preview.html

If you generated a PDF, the output includes `preview_url` for the inline chat preview.

## Tailoring Logic

When a job description is provided, the generator:
1. Extracts keywords from the job title, description, and requirements
2. Reorders experience bullets — most relevant ones appear first
3. Highlights matching skills with a different visual style (filled badge vs outline)
4. Includes tailoring notes in the output for transparency

## Workflow for Applying to Jobs

1. Fetch profile from Supabase
2. Fetch the target job listing from Supabase
3. Write profile to temp file: `echo '<profile_json>' > /tmp/profile.json`
4. Write job to temp file: `echo '<job_json>' > /tmp/job.json`
5. Run generator with both files
6. Show preview to user
7. If user wants changes, modify the profile JSON or HTML directly and re-run
8. Generate final PDF for application

## Output

```json
{
  "success": true,
  "html_path": "C:\\Users\\zionv\\.openclaw\\canvas\\resume-preview.html",
  "template": "modern",
  "tailoring_notes": "Tailored for: react, typescript, node.js, aws, ...",
  "pdf_path": "C:\\Users\\zionv\\.openclaw\\workspace\\resume.pdf",
  "preview_url": "data:image/png;base64,..."
}
```

## Tips

- Always show the HTML preview before generating PDF so the user can request changes
- For maximum tailoring, rewrite the profile's `summary` field to match the specific job
- The `matched` CSS class on skills badges is automatic — matching skills get highlighted
- Experience bullets are reordered by keyword relevance, not removed — all content is preserved
- Templates are self-contained HTML+CSS, editable at `skills/resume-generator/assets/`
