# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`main`) | Yes |
| Older commits | No — please update to `main` |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report them privately:

1. Email: use GitHub's [private vulnerability reporting](https://github.com/Dolonia333/DENIZEN/security/advisories/new) feature (Settings → Security → Report a vulnerability).
2. Include: a description of the issue, steps to reproduce, and potential impact.
3. You'll receive a response within 48 hours.

Fixes will be released as soon as practical, and you'll be credited in the release notes (unless you prefer to stay anonymous).

## Scope

This project is a local-first game server that runs on `localhost`. The primary attack surface is:

- **API key handling** — keys are read from `~/.openclaw/openclaw.json`. Never commit this file.
- **WebSocket endpoints** — `/agent-ws` and `/security-ws` are unauthenticated; do not expose port 8080 to the public internet.
- **NPC response parsing** — AI provider responses are parsed for action/delegation tags. All delegation targets are validated against known NPC names.
- **File access monitoring** — the security monitor watches the project directory for sensitive file patterns. Test events via `/security-test` are for development only.

## Known Non-Issues

- The game has no user authentication — it is designed for single-user local use only.
- LM Studio runs on `localhost:1234` — this is an intentional local-only dependency.

## Secrets: never commit them, rotate if exposed

- Credentials, API keys, tokens, passwords and internal host addresses must come from environment variables
  (or gitignored local files such as `infra/hosts.local`, `~/.openclaw/openclaw.json`). Scripts must fail fast
  with a clear message when a required variable is missing — **no default values for secrets**.
- Use the `.env.example` / `hosts.local.example` templates; never put real values in them.
- CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every pull request (`.github/workflows/gitleaks.yml`,
  config in `.gitleaks.toml`). Run `gitleaks detect --config .gitleaks.toml` locally before pushing.
- **If a secret was ever committed, treat it as compromised**: rotate/revoke it at the provider first
  (SSH/owner passwords, Brave Search key, `AGENT_TOKEN`, Supabase JWT/service keys, etc.), then remove it from the code.
  Deleting it in a later commit does **not** remove it from git history; scrubbing history (e.g. `git filter-repo`)
  is optional and only a complement to rotation.
- Self-hosted Supabase: never run production with the publicly documented demo `anon`/`service_role` keys or
  default Postgres/dashboard passwords; generate your own (see `infra/supabase-project/.env.example`).
