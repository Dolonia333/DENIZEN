# Phase 4 Remainder — Plan & Status



> Completes inference-mesh **Phase 4** after Phases 1–3 (runtime, RPC, wizard scaffold).



## Done before this pass



| ID | Item | Status |

|----|------|--------|

| 1–3 | Inference runtime, RPC, router, NAS hotfix | ✅ |

| A2.1 | `brain-catalog.json` + `GET /api/compute/inference/catalog` | ✅ |

| A2.2 | Wizard + agent settings brain UI | ✅ |

| A3.1–3.3 | `inference_rpc` progress + SSE stream API | ✅ |

| A5 | Real `embedding_index` + `sim_tick` | ✅ |

| B1 | NAS deploy + env | ✅ |



## This pass (remainder) — ✅ complete



### A1 — Bundled Ollama (installer-ready)



| Task | File | Status |

|------|------|--------|

| Copy system Ollama into `resources/ollama/` at build | `desktop/scripts/fetch-ollama.js` | ✅ |

| Package as `extraResources` | `desktop/package.json` | ✅ |

| `prebuild:win` runs fetch when `OLLAMA_FETCH=1` | `desktop/package.json` | ✅ |

| Spawn bundled binary | `desktop/ollama-manager.js` | ✅ |



**CI:** set `OLLAMA_FETCH=1` on build agents with Ollama installed, or place binary in `resources/ollama/` manually.



### A2 — Catalog UX finish



| Task | Detail | Status |

|------|--------|--------|

| Pull progress events | IPC `brain-pull-progress` → wizard + settings | ✅ |

| Persist `brainModel` | `denizen-desktop-setup.json` + heartbeat `inference.main_model` | ✅ |

| Web catalog hint | City Power panel shows suggested brains from catalog | ✅ |



### A3 — Streaming RPC in chat



| Task | Detail | Status |

|------|--------|--------|

| `npc-brains` | Pass `opts.stream.onToken` → `runMeshInference` | ✅ |

| Worker | Posts progress during `inference_rpc` | ✅ |



### A6 — Federation v1 (minimal)



| Task | Detail | Status |

|------|--------|--------|

| `DENIZEN_FEDERATION_PEERS` | Comma-separated peer city URLs | ✅ |

| `DENIZEN_FEDERATION_TOKEN` | Shared secret | ✅ |

| `POST /api/compute/federation/report` | Peer registers remote inference nodes | ✅ |

| `GET /api/compute/federation/status` | Operator visibility | ✅ |



### B2 — Public demo Haiku



| Task | Detail | Status |

|------|--------|--------|

| Server banner | `/api/health` includes `publicDemo.haiku_configured` | ✅ |

| Env | `DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY` in `patch-denizen-nas-env.py` when set | ✅ |



### B6 — Durable deploy



| Task | Detail | Status |

|------|--------|--------|

| `Dockerfile.production` | Health on `PORT` env (8888 NAS) | ✅ |

| Hotfix list | Includes federation + all inference modules | ✅ |



## Explicitly deferred (Phase 5 / backlog)



- **A4** llama.cpp embed

- **100 WS viewers** — Redis pub/sub

- **MCP token rotation** — operator action

- **pgvector** embedding persistence — vectors returned in job result only

- **Full Docker image rebuild on NAS** — run when Docker Desktop available (`infra/deploy-denizen-to-nas.py`)



## Acceptance



1. `npm run prebuild:win` stages Ollama when installed on build machine ✅

2. Brain download shows progress in wizard ✅

3. NPC chat streams tokens over mesh RPC when direct HTTP unavailable ✅

4. Federation peer appears in `GET /api/compute/inference/nodes` when peer reports ✅

5. `GET /api/health` shows `publicDemo.haiku_configured: true` when key set ✅



## Commands



```powershell

cd apps/office/desktop

npm run prebuild:win

npm start



cd apps/office

node scripts/smoke-inference-rpc.js

node --test tests/denizen-federation.test.js



py infra/hotfix-inference-mesh-nas.py

```



## Federation usage



Peer city A reports nodes to city B:



```bash

curl -X POST https://denizen.dolonia.cloud/api/compute/federation/report \

  -H "Content-Type: application/json" \

  -H "x-federation-token: $DENIZEN_FEDERATION_TOKEN" \

  -d '{

    "peer_url": "https://city-a.example",

    "city_label": "City A",

    "nodes": [{

      "machine_id": "city-a-gpu",

      "url": "http://10.0.0.5:1234",

      "label": "City A GPU",

      "models": ["llama3.2"],

      "main_model": "llama3.2"

    }]

  }'

```



Nodes appear with `role: federation` in `GET /api/compute/inference/nodes`.


