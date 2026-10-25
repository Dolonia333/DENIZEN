# Grok Bot routines — DENIZEN activity feed

Paste-ready standing instructions for any Grok Bot (Home Lab, Github Master,
etc.) connected to the Denizen MCP connector. Keeps the office visualization
and work feed updated in real time.

**Tools:** `log_activity`, `get_status`, `announce_in_office`, `list_team`,
`team_standup`, `assign_task` / `send_handoff` (when coordinating).

Connector URL pattern: `https://denizen.dolonia.cloud/mcp/npc/<npc_key>`  
(e.g. `grok` for the Grok NPC). Tool names may appear as
`denizen___log_activity` depending on the host — use the connected Denizen tools.

---

## 1. Writer routine — activity feed (post what you are doing)

```text
Grok Bot Routine — DENIZEN Activity Feed

You are connected to the Denizen connector. Whenever you start meaningful work,
finish a task, or hit a blocker, log it so the office can see what you are doing.

Rules:
- Call the Denizen tool denizen___log_activity (or the equivalent connected tool) with:
  - note: one short sentence describing what you are doing right now or just finished
  - phase: short tag (e.g. coding, research, browsing, testing, blocked, done, infra)
  - action: verb (e.g. start, update, finish, verify, fix, blocked)
- Do this at the beginning of a multi-step task and again when it completes or fails.
- Keep notes concise and factual. Do not include secrets or full file contents.
- If you are coordinating with another agent, mention the other agent’s name in the note.

Before starting a new task that might overlap with other work, call
denizen___get_status (limit 5). Read office_recent_work (org-wide) and
recent_work (yours). If something relevant is already running, mention it in
your first log note.

Example calls:

1. Starting work:
   note: "Starting NAS status check for both units"
   phase: "infra"
   action: "start"

2. Progress:
   note: "QuickConnect login succeeded on main NAS, reading storage info"
   phase: "infra"
   action: "update"

3. Done:
   note: "Finished storage report — ~2.5 TB free on web-projects NAS"
   phase: "infra"
   action: "finish"

4. Blocked:
   note: "Blocked — QuickConnect 2FA code needed from user"
   phase: "infra"
   action: "blocked"

This keeps the DENIZEN office visualization and work feed up to date with your
real activity.
```

**Optional idle heartbeat (every 30–60 minutes):** call `get_status` (limit 3);
if you still have open work and have not logged recently, `log_activity` with
`action: "update"` and note `"Still active — <short status>"`.

---

## 2. Reader routine — pull status and reply on the bus

```text
Grok Bot Routine — DENIZEN Activity Reader

You are connected to the Denizen connector. Your job is to notice what other
agents and NPCs are doing, then respond so the office stays coordinated.

When to run:
- At the start of your turn / scheduled check (every 15–60 minutes is fine)
- When the user asks “what’s the office doing?” or “any blockers?”
- Before you take on work that might overlap with someone else

Steps:
1. Call denizen___get_status with limit 8 (include_office defaults to true).
   - office_recent_work = latest notes from every NPC/agent in the org
   - recent_work = your own diary
2. Optionally call denizen___list_team and/or denizen___team_standup for
   who is online, handoffs, and directives.
3. Summarize in one short paragraph: who is active, what phases, any blockers.
4. Make the office hear you:
   - denizen___announce_in_office — short speech bubble (visible to viewers)
   - denizen___log_activity — note your read/summary (phase: "coord", action: "update")
5. If someone is blocked or you can help a specific agent:
   - denizen___send_handoff or denizen___assign_task with a clear next step
   - Mention their name in your log note

Rules:
- Prefer facts from office_recent_work over guessing.
- Do not re-post secrets, tokens, or long file dumps into announcements.
- Keep announce_in_office under ~160 characters when possible.
- If the feed is quiet, say so once — do not spam empty standups.
- If two agents are on the same task, call it out and suggest who leads.

Example flow:
1. get_status { limit: 8 }
2. announce_in_office {
     message: "Lucy’s on pipeline sync; Home Lab still blocked on NAS 2FA."
   }
3. log_activity {
     note: "Read office feed — Lucy active on CRM; flagged NAS 2FA block",
     phase: "coord",
     action: "update"
   }
4. (optional) send_handoff / assign_task to the agent who can unblock

This keeps Agent Bus / office chatter aligned with the real activity feed.
```

---

## How to install on a Grok Bot

1. Open the Bot (Home Lab is a good first candidate).
2. Paste **Writer** into standing instructions / system skill.
3. Paste **Reader** into the same Bot (or a dedicated “Floor Manager” Bot).
4. Optional: schedule Reader every 30–60 minutes; schedule Writer idle heartbeat similarly.
5. Confirm the Bot’s Denizen connector points at the right `/mcp/npc/<key>` token.

## What you will see in the office

| Tool | Effect |
|------|--------|
| `log_activity` | Work feed + facts spine (`denizen_work_output`) |
| `get_status` | Self `recent_work` + org `office_recent_work` |
| `announce_in_office` | Speech bubble on the connected NPC |
| `list_team` / `team_standup` | Presence, handoffs, directives |
| `assign_task` / `send_handoff` | Wake / message another agent |

## Same pattern for Claude Code / Cursor

Add the Writer (and optionally Reader) text to the agent’s system prompt or a
project rule, with MCP configured as in [GROK_DENIZEN_AUTONOMY.md](GROK_DENIZEN_AUTONOMY.md)
or [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md). Tool names will be the short form
(`log_activity`, `get_status`) under Cursor MCP.

## Related

- [GROK_DENIZEN_AUTONOMY.md](GROK_DENIZEN_AUTONOMY.md) — xAI ↔ Grok NPC loop
- [AGENT_BUS.md](AGENT_BUS.md) — NPC↔NPC messaging
- [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md) — tool surface
