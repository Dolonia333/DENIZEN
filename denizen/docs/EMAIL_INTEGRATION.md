# Denizen — Email Integration (n8n → Lucy → Gmail)

> Lucy (Secretary NPC) drafts replies to the CEO's inbox automatically.
> n8n watches Gmail, posts new messages to Denizen, the NPC brain
> composes a reply in Lucy's voice, and the result lands in Gmail
> drafts for one-click review. Inside the office, Lucy visibly walks
> to her desk when mail arrives.

## TL;DR

| Piece | Where |
|---|---|
| n8n workflow | [`data/email-workflows/lucy-inbox.n8n.json`](../data/email-workflows/lucy-inbox.n8n.json) (import into n8n) |
| Inbound endpoint | `POST /api/email-inbound` |
| Operator review | `GET /api/email-drafts?sent=false` + `POST /api/email-draft/send` |
| Audit log | `data/email-log.json` (lazy-created, gitignored if you add it) |
| Drafts mirror | `data/email-drafts.json` (lazy-created) |
| Lucy's email config | `npcs/lucy/SOUL.md` → `### email_style` block |
| Server module | [`src/email-handler.js`](../src/email-handler.js) |
| Gmail wrapper | [`src/gmail-client.js`](../src/gmail-client.js) |
| In-game animation | `agent-office-manager._handleServerMessage` → `case 'npc_email_arrived'` |

## Setup (10 minutes)

### 1. Choose Gmail mode

**Local-drafts mode (no setup, recommended first run).** Denizen writes
each draft to `data/email-drafts.json` and you copy-paste into Gmail's
compose window. Nothing goes near a real Gmail API. Tests pass, the
office sprite walks to her desk, the audit log fills — everything
*except* Gmail itself works.

**Real-Gmail mode** (when you want one-click drafts in Gmail):

```bash
cd denizen
npm install googleapis             # adds the official Google client lib
```

Place an OAuth2 token JSON at `data/gmail-oauth.json` (or set
`GMAIL_OAUTH_FILE` to a custom path). Shape:

```json
{
  "client_id": "…",
  "client_secret": "…",
  "redirect_uri": "http://localhost",
  "access_token": "…",
  "refresh_token": "…",
  "scope": "https://www.googleapis.com/auth/gmail.compose",
  "token_type": "Bearer",
  "expiry_date": 1799999999999
}
```

`src/gmail-client.js` auto-detects this on each call — if the file is
present and `googleapis` is installed, it routes drafts through the
real API; otherwise it keeps using local-drafts. No code change needed
to flip modes.

### 2. Wire the n8n workflow

In n8n:

1. **Import** `data/email-workflows/lucy-inbox.n8n.json`.
2. Attach your **Gmail OAuth2 credential** to the *Gmail Trigger* node.
3. Edit the *POST → Denizen* HTTP node:
   - URL → `https://your-denizen-host/api/email-inbound`
   - Header `X-Denizen-Secret` → some random string (or remove the
     header if you're running unauthenticated in dev)
4. Set `EMAIL_INBOUND_SECRET` on the Denizen server to the same string.
5. **Activate** the workflow.

### 3. (Optional) flip on autosend

By default every draft lands in drafts. To allow Lucy to actually send
without operator review:

```bash
EMAIL_AUTOSEND=true npm start
```

Plus, edit Lucy's SOUL — change `never_send: true` to `never_send: false`
and add `email_canAutoSend: true` under the `### email_style` block.
Both gates must pass.

## How the prompt is built

`src/email-handler.buildReplyPrompt(npcName, email, style)` produces:

```
You are acting as Lucy, drafting an email reply on the CEO's behalf.
Tone: warm-professional, brief. Keep it under 3 short paragraphs.
Always disclose that this draft was composed by an AI secretary, not the CEO personally.
Do NOT make commitments on the CEO's behalf (calendar invites, contract terms, money).

Incoming email
--------------
From:    garnett@example.com
Subject: Development Meeting
<the email body, truncated to 4000 chars>
--------------
Draft a reply that the CEO can review before sending. Return ONLY the email body — no subject line, no headers, no surrounding quotes. The signature will be appended automatically.
```

Then `assembleFinalBody()` appends the SOUL's `signature` block on a
blank line so the disclosure footer is consistent every time.

## Escalation rules

`### email_style.escalate_keywords` is a list of phrases that
*disqualify* auto-drafting. Defaults include `contract`, `nda`,
`invoice`, `wire`, `payment`, `agreement`, `legal`, `urgent`,
`ASAP`, `fire`, `lawsuit`. When any of these appear in the subject
or body, Lucy:

- Does NOT compose a reply.
- Logs the email to `data/email-log.json` with `kind: "escalated"`.
- Broadcasts `npc_email_arrived` over `/agent-ws` with `escalated: true`.
  The in-office sprite emotes `!` instead of `✉`, walks to her desk,
  and says `"Flagged email from … — needs your eyes."`

Matching is case-insensitive and word-bounded — `paymentless` does
NOT match `payment`.

## Daily cap

Each email-handling NPC is capped at **10 inbound emails per UTC day**.
Returns `400` with `daily email cap hit for Lucy (10/10)` once
exceeded. The cap reads `data/email-log.json` so it survives restarts.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/email-inbound` | n8n posts here. Body: `{ from, subject, body, threadId? }`. Optional `secret` field or `X-Denizen-Secret` header. |
| `GET`  | `/api/email-drafts?sent=false&limit=25` | List drafts for operator review. |
| `POST` | `/api/email-draft/send` | Body `{ id, autoSendAllowed }`. Refused unless `EMAIL_AUTOSEND=true` AND `autoSendAllowed: true`. |

## WS event for the office

When `processInboundEmail` succeeds, the server broadcasts:

```json
{
  "type": "npc_email_arrived",
  "npcName": "Lucy",
  "from": "garnett@example.com",
  "subject": "Development Meeting",
  "escalated": false,
  "draftId": "draft_1734…"
}
```

The client handler (`agent-office-manager._handleServerMessage` →
`case 'npc_email_arrived'`) makes Lucy stand up, emote, walk to her
assigned desk, and speak a one-line summary. Pure visual flourish;
the actual draft has already been composed server-side.

## What this is NOT

- **No auto-replies to unknown senders by default.** That's a Phase 2
  feature — would need a per-sender allow-list. Today, Lucy will draft
  a reply for whoever lands in the inbox.
- **No calendar acceptance.** Lucy explicitly refuses to RSVP to
  events on the CEO's behalf — that always requires the operator.
- **No multi-recipient mass-send.** The `to:` field is whoever wrote
  to you; Lucy doesn't add CCs or BCCs.
- **No contract signing.** The escalation keyword list catches the
  obvious flags. If she misses one, the `never_send: true` SOUL gate
  + the `EMAIL_AUTOSEND` env gate both have to be flipped before
  anything actually leaves the building.

## Phase 2 (future, not yet wired)

- Per-sender memory: `data/email-relations.json` tracking sender → tone
  preference / past responses / "do I always escalate to Marcus?"
- Threading awareness — read the last N messages in a thread and
  reference them.
- Multi-NPC handling: different NPCs handle different kinds of email
  (Marcus for vendor stuff, Lucy for scheduling, Lucy for visitor
  RSVPs).
- Sender allow-list before any draft fires.
- Inline-reply UI in the operator review panel.

## See also

- [WORLD-STATE.md](WORLD-STATE.md) — the singleton each event lands in
- [AI-SYSTEM.md](AI-SYSTEM.md) — the brain pipeline `getResponse` runs through
- [ACTIONS.md](ACTIONS.md) — the in-game actions Lucy uses
- [PROPOSAL_REVIEW.md](PROPOSAL_REVIEW.md) — the operator review pattern
  email drafts inherit from
