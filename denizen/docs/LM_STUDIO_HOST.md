# LM Studio Host Runbook — the `.232` box

**One page. Follow it exactly and the office never silently degrades.**

Box: i9-14900KF · 64GB RAM · RTX 4070 Ti SUPER **16GB VRAM** · water-cooled · `http://192.168.1.232:1234`

Water cooling buys *sustained clocks* under multi-hour think loops. It does **not** buy VRAM — the model policy below is a hard rule.

---

## 1. Daily A+ default — dual-load, nothing else

| Slot | Model | Context | Role |
|------|-------|---------|------|
| FAST | `google/gemma-4-e2b` | 8–12k | presence, ambient thinks, bouncer, skill args |
| MAIN = HEAVY | **`qwen/qwen3.6-27b`** Q4_K_M | **12–16k** | player chat, Abby/Bob thinks, director, code, mentors |

Verified dual-load on 4070 Ti SUPER 16GB with those context caps.  
**Fallback if VRAM tight:** unload Gemma temporarily, or pin MAIN=HEAVY to `qwen2.5-14b-instruct-1m` @ 12–16k — not the daily default.

**Never load three mid/heavy models.** 2×fat + 1×small at 64k context = VRAM thrash, 10x latency, and the router silently falling back to the 2B — which is exactly the "feels dumb" failure.

### LM Studio settings checklist (Server tab)

- [ ] **Serve on Local Network: ON** (Denizen NAS calls from 192.168.1.237)
- [ ] Port **1234**
- [ ] **Keep model loaded in memory: ON** for BOTH models (no TTL auto-unload)
- [ ] **Context length: 12,288–16,384** on MAIN, ~8,192 on FAST — do not "max" the slider
- [ ] Flash attention ON (if available for the runtime)
- [ ] GPU offload: max layers that fit — if LM Studio warns about partial offload on MAIN, reduce context before reducing layers

### Env pins (denizen/.env + .env.production — must match what's loaded)

```
LM_STUDIO_REMOTE_URLS=http://192.168.1.232:1234
LM_STUDIO_FAST_MODEL=google/gemma-4-e2b
LM_STUDIO_MODEL=qwen/qwen3.6-27b
LM_STUDIO_HEAVY_MODEL=qwen/qwen3.6-27b
```

If you swap models in LM Studio, **update the pins and restart denizen-server**. The health endpoint will flag `main_model_unloaded` if the pin and reality disagree — that flag red = fix it now, the office is answering hard questions on the 2B.

---

## 2. Mode switches (deliberate, temporary)

| Mode | Load | When | Revert |
|------|------|------|--------|
| **Quality burst** | Qwen only @ 32k | long dossiers / big-doc research | same day |
| **Reasoning experiment** | unload Gemma, load an R1-class @ 8–12k | hard planning experiments | same day |

Both modes degrade FAST-tier latency (everything queues on one model). The office will feel slower — that's expected and temporary, not a bug.

---

## 3. Health verification (2 minutes)

1. `curl http://192.168.1.232:1234/v1/models` → both model IDs listed
2. `https://denizen.dolonia.cloud/api/health` →
   - `issues` **does not** contain `main_model_unloaded`, `inference_unreachable`, or `director_offline`
   - `harness.harnessRate ≥ 0.95`
   - `lmStudio.reachable: true`
3. `https://denizen.dolonia.cloud/api/harness` → `metrics.mainModelUnloaded: false`, `inference.tiers` shows FAST≠MAIN
4. Open the office — **no red "Director offline" banner** at the top

## 4. Common failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `main_model_unloaded` in health | LM Studio auto-unloaded MAIN (TTL) or model swapped without pin update | Reload model, set Keep-Loaded ON, fix env pins |
| Red "Director offline" banner in office | LM Studio unreachable ≥5 thinks → Abby fell to scripted demo loop | Start LM Studio server, banner clears on next successful think |
| Everything slow, queue climbing | Third model loaded / context set to 64k+ | Unload extras, drop context to 12–16k |
| NPC chat replies feel 2B-dumb | MAIN pin missing so main tier fell through to Gemma | Set `LM_STUDIO_MODEL` pin + verify §3 |
| `inference_unreachable` | Box asleep / firewall / LM Studio closed | Wake box, disable sleep while serving, allow port 1234 on Private network |

## 5. Windows host hygiene (.232)

- Power plan: **High performance**; Sleep: **Never** while serving
- LM Studio in the Startup apps so a reboot self-recovers
- Firewall: inbound TCP 1234 allowed on Private profile only
- After a Windows update: re-run §3 verification before trusting the office

---

*Load-test baseline lives in `reports/harness/` — regenerate after any model/context change with `node scripts/harness-load-test.js --minutes 30`.*
