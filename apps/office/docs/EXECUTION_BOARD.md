# Denizen Execution Board



> **North star:** Denizen runs **1921 Holding Co.** as the master template, supports **multiple isolated companies**, and is ready for entrepreneurs and solo devs.



**Master doc:** [MULTI_USER_OFFICE_PLAN.md](MULTI_USER_OFFICE_PLAN.md) · **1921 canon:** [1921_TEMPLATE.md](1921_TEMPLATE.md) · **Gap bridge:** `py infra/verify-gap-bridge-all.py` · **Capture:** `py infra/bridge-capture-all.py`



---



## Five tracks



| Track | Goal | Status |

|-------|------|--------|

| **1. 1921 template & business context** | Real company in prompts + souls | 🟢 Soul pack + org business model |

| **2. Multi-user foundation** | `agent_souls` + org hydration + world isolation | 🟢 Phases 4–5 verify |

| **3. CRM / Meridian + autonomy** | Marcus proactive, MCP, Grok Build | 🟢 MCP live; multi-hop verify |

| **4. Server / scaling / deploy** | NAS, mesh, reliable for multiple users | 🟢 AGENT_TOKEN patched |

| **5. Polish & onboarding** | Templates, login flow, docs | 🟢 clone API + script |



---



## Active slice



| Field | Value |

|-------|--------|

| **Slice** | ✅ Soul depth — all 17 NPCs (Wave 1–4) |

| **Done when** | `node --test tests/soul-depth-all.test.js` passes + NAS re-seed |

| **Plan** | [SOUL_DEPTH_PLAN.md](SOUL_DEPTH_PLAN.md) |



---



## Slice backlog



| # | Slice | Verify | Status |

|---|--------|--------|--------|

| ✅ | Platform gap bridge (phases 3–6) | `verify-gap-bridge-all.py` | Done |

| ✅ | **All 17 deep souls** | `tests/soul-depth-all.test.js` | Done |

| ✅ | Org soul isolation (zion vs acme) | `verify-org-isolation.py` | Done |

| ⬜ | LM tuning — chat matches soul depth | Office spot-checks | Backlog |

| ✅ | `agent_souls` migration + seed | `verify-phase4-agent-souls.py` | Done |

| ✅ | 1921 soul pack (17 NPCs) | `tests/1921-soul-pack.test.js` | Done |

| ✅ | Per-org `business-model` in DB | `org_business_models` + seed script | Done |

| ✅ | World state `org_id` scoping | `verify-phase5-world-isolation.py` | Done |

| ✅ | WS broadcast filter by org | phase5 | Done |

| ✅ | MCP delegation + ping | `verify-phase6-mcp-delegation.py` | Done |

| ✅ | Template clone on signup | `POST /api/org/clone-template` + CLI | Done |

| ⬜ | Fair LLM queue per org | Telemetry | Backlog |

| ⬜ | CRM write-back reliability | CRM integration test | Backlog |

| ⬜ | Proactive CEO-needs think loop | New verify | Backlog |

| ⬜ | Multi-hop autonomous chains (3+ NPCs) | Manual + future verify | Backlog |



---



## Commands



```bash

# Full gap bridge gate

py infra/verify-gap-bridge-all.py



# Deploy + migrate + seed (NAS)

py infra/deploy-everything-nas.py

py infra/apply-migrations-nas.py

py infra/seed-agent-souls-nas.py

docker exec denizen-server node scripts/seed-org-business-model.js zion 1921-govcon



# Optional: business-context-brief on NAS

py infra/patch-agent-token-nas.py



# Grok MCP health

node apps/office/scripts/grok-mcp-ping.js

py infra/verify-mcp-preflight.py grok



# Clone template to new org

node apps/office/scripts/clone-template-pack.js <org_slug> 1921-govcon

```



---



## Done / verified



| Date | Item |

|------|------|

| 2026-06-24 | Phases 0–5 + Grok MCP + Grok Build dual-mode |

| 2026-06-24 | 1921 soul pack all NPCs; `org_business_models`; gap bridge scripts |


