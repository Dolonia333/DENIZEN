# Bouncer 60s Investor Demo

## Goal
Show that Denizen can detect, investigate, and report a security issue in under one minute using real server routes.

## Setup (before call)
- Start Denizen server with Bouncer enabled.
- Keep one browser tab on the office UI and one tab on terminal/logs.
- Optional public-demo guard:
  - `DENIZEN_PUBLIC_DEMO=true`
  - `DENIZEN_SECURITY_TEST_PUBLIC=0`

## 60-second script
1. **0-10s — Trigger**
   - Say: "Bouncer, run a live security check."
   - Call:
     - `POST /api/bouncer-linux` with `{"category":"api_abuse","source":"203.0.113.50","detail":"Investor demo threat","force":true}`
   - Mention this is a real Kali-backed workflow, not mock text.

2. **10-25s — Live response**
   - Show `bouncer_linux_status` in WS stream.
   - Point out office clients receive updates from `agent-ws` in real time.

3. **25-40s — Findings**
   - Show `bouncer_linux_result` payload with summary and command steps.
   - Highlight report artifact path under `reports/security/`.

4. **40-50s — Operational cadence**
   - Mention scheduled patrol loop plus daily brief broadcast (`bouncer_daily_brief`).
   - If it is Friday and enabled, point to weekly brief file under `reports/security/weekly_*.md`.

5. **50-60s — Governance**
   - Show that sensitive trigger routes require auth (`/api/bouncer-scan`, `/api/bouncer-linux`).
   - Explain production/public demo guardrails on `/security-test` to block anonymous abuse.

## Optional fast backup
If Kali tools are unavailable on host, run:
- `POST /api/bouncer-scan` with `{"tool":"wireshark","target":"localhost","reason":"quick demo"}`

This still demonstrates authenticated trigger + WS status + security reporting flow.
