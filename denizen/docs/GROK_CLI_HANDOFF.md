# Grok CLI Handoff

How to hand off Denizen OS work to the **Grok CLI** (xAI's `grok` coding agent) as a
continuation agent when the primary Claude agent runs out of credits.

_Last verified: 2026-07-07_

## Status snapshot

| Item | Value |
|------|-------|
| Grok CLI version | `0.2.82 (6d0b07d2de) [stable]` |
| Binary | `C:\Users\zionv\.grok\bin\grok` (`~/.grok/bin/grok` in Git Bash) |
| Config dir | `C:\Users\zionv\.grok\` |
| Authenticated | **Yes** — logged in with grok.com (OAuth token cached in `~/.grok/auth.json` under `https://auth.x.ai::…`). No secrets shown here. |
| Default model | `grok-composer-2.5-fast` (alt: `grok-build`) |
| Permission mode | `always-approve` (set in `config.toml [ui]`) — grok auto-approves tool calls, suitable for unattended handoff. |
| Non-interactive support | **Yes** — `-p / --single`, `--prompt-file`, `--output-format json`, `--max-turns`, `--check`. |

## How Grok stores MCP config (important)

Grok CLI does **not** read `~/.grok/mcp.json`. That file is a leftover Claude-Code-style
config and is ignored by grok (`grok mcp list` reported "No MCP servers configured" while
mcp.json existed). Grok reads MCP servers from **`~/.grok/config.toml`** (user scope) or
**`./.grok/config.toml`** (project scope), managed via `grok mcp add/list/remove/doctor`.

Grok also natively supports remote **HTTP** transport with auth headers, so the Denizen
MCP does **not** need the `@automattic/mcp-remote` proxy that the project's
`.grok/mcp.json.example` uses — grok connects to the streamable-HTTP endpoint directly.

## MCP servers now wired

Confirm anytime with:

```bash
~/.grok/bin/grok mcp list
~/.grok/bin/grok mcp doctor          # handshake + tool-count health check
```

Current state (`grok mcp doctor`):

- **denizen-team** → `https://denizen.dolonia.cloud/mcp/team` — ✓ handshake OK, **18 tools discovered** (list_team, team_status, send_handoff, run_as_npc, enqueue_cursor_work, get_inference_nodes, etc.). This is the fleet control MCP. Added by this setup.
- `grok_com_github` → GitHub Copilot MCP — ✓ healthy (91 tools), provided by grok.com account.
- `figma` (plugin) → ✗ failing (OAuth not authorized). Unrelated to Denizen; ignore or run its OAuth flow if needed.

The `denizen-team` entry in `~/.grok/config.toml`:

```toml
[mcp_servers.denizen-team]
url = "https://denizen.dolonia.cloud/mcp/team"
enabled = true

[mcp_servers.denizen-team.headers]
Authorization = "Bearer <TEAM_TOKEN — from project .mcp-team-token.local.json>"
```

To rotate the token, re-run (add also updates):

```bash
~/.grok/bin/grok mcp add --transport http --scope user denizen-team \
  https://denizen.dolonia.cloud/mcp/team \
  --header "Authorization: Bearer <NEW_TOKEN>"
```

## Exact handoff commands

Grok is working-directory-aware. Run it **from the repo** (or pass `--cwd`). Use the
`denizen/` project root or the Denizen OS root as appropriate for the task.

### One-shot / scripted handoff (non-interactive, prints answer and exits)

```bash
cd "/c/Users/zionv/OneDrive/Desktop/Denizen OS/denizen"
~/.grok/bin/grok -p "Pick up the primary agent's work: <task description>"
```

Or without changing directory:

```bash
~/.grok/bin/grok --cwd "C:/Users/zionv/OneDrive/Desktop/Denizen OS/denizen" \
  -p "<task description>"
```

Useful flags: `--prompt-file <path>` (long prompt from file), `--max-turns <N>`
(cap the agent loop), `--check` (append a self-verify loop), `--output-format json`
(machine-readable), `--model grok-build` (switch model).

### Interactive handoff (a human sits with it)

```bash
cd "/c/Users/zionv/OneDrive/Desktop/Denizen OS/denizen"
~/.grok/bin/grok "Continue the Denizen work — start by reading recent git log and docs/"
```

Continue the most recent session for this directory:

```bash
~/.grok/bin/grok -c        # or: grok --resume  to pick a session
```

### Verify grok can see the fleet before starting real work

```bash
~/.grok/bin/grok -p "List the Denizen team via the denizen-team MCP (call list_team) and summarize."
```

## Verification performed

- `grok --version` → `0.2.82`.
- `grok models` → logged in with grok.com; default `grok-composer-2.5-fast`.
- `grok mcp add` wrote `denizen-team` to `~/.grok/config.toml`.
- `grok mcp doctor` → denizen-team handshake OK, 18 tools.
- `grok -p "reply with exactly: OK"` → returned `OK` (non-interactive path confirmed working).

## Backups made

- `~/.grok/mcp.json` → `~/.grok/mcp.json.bak`
- `~/.grok/config.toml` → `~/.grok/config.toml.bak` (pre-edit)

## Blockers / notes

- **None blocking.** The only oddity was the ignored `~/.grok/mcp.json`; resolved by
  using the supported `grok mcp add` path into `config.toml`.
- The `figma` plugin MCP is failing OAuth but is unrelated to Denizen handoff.
- `permission_mode = "always-approve"` means grok will auto-run tools without prompting.
  That is desired for unattended handoff but be aware it can edit files / run commands
  autonomously. Use `--max-turns` to bound long runs.
