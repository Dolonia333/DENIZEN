# NEXEN code review snapshot

Filtered public review tree for NEXEN v1 source fixes. **Not a distributable or fully runnable application.** Private runtime data, credentials, environment/config, personal-plan modules, photographs, and vendor packages are intentionally excluded. Read [REVIEW-SCOPE.md](REVIEW-SCOPE.md) before drawing conclusions from this tree.

## What’s here

| Area | Contents |
|---|---|
| Hub & workspaces | Top-level `*.html` shells (Command Center, login, game, money, voice, …) |
| Browser assets | `world-assets/` JS/CSS for workspace shell, city, money, voice, etc. |
| Python modules | Selected server/runtime modules included for review (imports of excluded modules will fail) |
| Tests | Focused `test_*.py` / `test_review_ui.mjs` from the review capture |
| Install wrappers | Four PowerShell helpers + `start_on_f.pyw` only |

## UI demo (this branch)

Because the snapshot omits branding, config, and several FastAPI dependencies, this branch adds a **static demo server** so reviewers can see the UI:

```bash
python3 demo_server.py
# → http://127.0.0.1:8765/       Command Center
# → http://127.0.0.1:8765/demo   Page index
# → http://127.0.0.1:8765/login  Unlock screen
# → http://127.0.0.1:8765/game   WDR City shell
```

- Serves included HTML + `world-assets/`
- Serves placeholder logo under `/branding/` (`demo/branding/`)
- Stubs common `/api/*` responses so the hub layout stays readable
- Does **not** attach databases, Discord archives, models, or PC control

## Cleanup notes

- Flat layout matches the original review capture; do not assume production package layout.
- Prefer `demo_server.py` over forcing FastAPI boot — missing modules such as `daily_plan` / `plan_compiler` and absent config are review boundaries, not accidental deletions.
- Handoff/legal docs may live on separate documentation branches; this branch focuses on making the included UI inspectable.

## Validation context (from REVIEW-SCOPE)

Canonical local validation reported large focused/global test suites; this public tree alone cannot reproduce that full private environment. Review concrete correctness and security in the included code; do not treat demo stubs as product guarantees.
