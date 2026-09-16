# Telemetry

Denizen counts operator health so the office can be steered. It does **not** sell a “we see nothing” story.

## What the office host stores

LLM telemetry (`data/llm-telemetry.jsonl` and an in-memory ring) records, per call:

| Field | What it is |
|---|---|
| npc | Who spoke (Abby, Lucy, …) |
| kind | think / chat / email / … |
| provider / model | Where the call went |
| latencyMs | How long it took |
| tokensIn / tokensOut | Counts, not the full prompt |
| promptPreview / responsePreview | First **240 characters** |
| error | Category + hint when a call failed |

Cost projection (`/api/costs`, `/api/telemetry/cost`) is computed on the host from those counts. LM Stats on the phone is the same table.

MCP audit (when the database is on) logs **tool name**, ok/error, session — not the body of what you typed to an agent.

## What Buzz sends

- **Desktop, same machine as the office:** the screenshot is written under a `buzz-captures` folder. Abby gets the path. The host reads the file locally when it can.
- **Browser, or a hosted office:** you see the shot on the note card first. Then a copy is stored under `data/uploads/chat/` so Abby can see it. The landing page says this in plain language.
- Voice and meeting transcripts go through `/api/stt` on the office host (not a personal Groq key unless you configured one).

## Desktop diagnostics

The Desktop app’s crash/diagnostics opt-in is **off until you switch it on**. Pairing tokens stay on your machine. Screen and file access are off / ask / trusted.

## What we do not count as product telemetry

No payment identifiers. No “sealed ciphertext log” theater. Mesh / City Power is opt-in.

## Turn it down

- Desktop: Settings → diagnostics opt-in off.
- Operator: stop hitting `/api/telemetry/*` panels; JSONL is local to the host.
- Do not send prompt previews off-box unless you export the jsonl yourself.

This file is the table. If a field is not listed, we should not be collecting it for telemetry.
