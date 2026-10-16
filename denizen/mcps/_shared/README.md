# Shared MCP tool schemas

Canonical copies of tools that multiple Denizen MCP namespaces expose:

- `tools/enqueue_compute_job.json` → `denizen-grok`, `denizen-team`
- `tools/get_job_status.json` → `denizen-grok`, `denizen-team`

Edit here, then run:

```bash
node denizen/scripts/sync-shared-mcp-tools.mjs
```
