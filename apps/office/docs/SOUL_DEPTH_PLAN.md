# Soul Depth Plan — Platform → Operating Team

> **Status (June 2026):** All **17 roster NPCs** have deep souls — playbooks, skill maps, weekly rhythms, never-guess boundaries, and 1921 pursuit context. Platform + operating team layer **complete** for Wave 1–4.

---

## Depth criteria (per NPC) — ✅ all met

1. **1921 operating context** — entity, pursuits, certifications where relevant
2. **Role playbook** — `## … Operating Playbook — 1921`
3. **Skill map** — `## Skill Playbook`
4. **Delegation** — `## Teammate Ownership` (existing) + playbook handoffs
5. **Never guess** — `## Never Guess`
6. **Proactive rhythm** — `## Weekly Operating Rhythm`
7. **Ecosystem** — DENIZEN, I.W.I.N., SmartContainer™, RM Cyber as role-appropriate

**Verify:** `node --test tests/soul-depth-all.test.js` (85 assertions, 17 NPCs × 5 checks)

---

## Rollout — complete

| Wave | NPCs | Status |
|------|------|--------|
| 1 | Abby, Lucy, Marcus, Sarah | ✅ |
| 2 | Bob, Pier, Bouncer | ✅ |
| 3 | Alex, Edward, Josh, Jenny, Molly, Oscar, Rob, Dan, Roki | ✅ |
| 4 | Grok | ✅ |

After soul edits: `py infra/seed-agent-souls-nas.py` + `py infra/seed-org-business-model-nas.py`

---

## CEO spot-checks (sample)

| NPC | Ask |
|-----|-----|
| Abby | What's blocking OMES — capture vs Denizen this week? |
| Lucy | Log RM Cyber intro — what do you need from me? |
| Marcus | Teaming agreement age and next action? |
| Sarah | SmartContainer — can we promise deployment? |
| Bob | What changed on OMES solicitation this week? |
| Grok | `get_status` → `delegate_task` Marcus → `log_activity` |

---

## Still backlog (not soul depth)

- Fair LLM queue per org
- CRM write-back reliability automation
- Proactive CEO-needs think loop (server-side)
- Onboarding UI → `POST /api/org/clone-template`
- LM tuning so chat replies match soul depth in practice
