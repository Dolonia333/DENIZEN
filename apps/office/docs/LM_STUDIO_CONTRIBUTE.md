# Share your local brain (Ollama, LM Studio, or Denizen mesh)

You can power the city from **Denizen Desktop** without editing NAS env files. The city talks to your GPU via **direct HTTP** (LAN/Tailscale) or **Denizen-to-Denizen mesh RPC** (no firewall holes).

## 3-step setup (recommended)

### 1. Get a local brain

**Option A — Ollama (recommended)**

- Install [Ollama](https://ollama.com) or use Denizen Desktop’s **Download brain** in the setup wizard.
- Denizen Desktop can run `ollama serve` when you enable City Power.

**Option B — LM Studio**

- Load a model → **Local Server** → **Start server** → **Reachable from network** (`0.0.0.0:1234`).

### 2. Install Denizen Desktop

From your city: `/desktop/download.html` or the **City Power** panel.

Setup wizard:

1. **Your station** — permissions
2. **City Power** → **Add City Power** — pick a brain from the catalog if needed
3. **Citizen ID** — pair in the browser

### 3. Turn on City Power

In the office (team login): **City Power** drawer → **Light / Standard / Max**.

Status examples:

- `Sharing brain · llama3.2 (Ollama, Denizen mesh — no port setup)`
- `Sharing models · qwen2.5-14b` (direct LM Studio)

## How routing works

| Your network | City uses |
|--------------|-----------|
| LM Studio on `0.0.0.0:1234`, same LAN/Tailscale | **Direct** HTTP to your GPU |
| Ollama local only, no port forward | **Mesh RPC** — `inference_rpc` job to your Desktop |
| Both down | Cloud APIs or next mesh node |

## Verify

```text
GET /api/compute/inference/nodes   → rpc_capable, inference_mode
GET /api/compute/inference/catalog → model list
GET /api/health                  → inference metrics + lmStudioPool
```

Desktop: Station settings → **Local brain** section.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Browser says install Desktop | GPU sharing requires Desktop on this PC |
| `reachable: false` but `rpc_capable: true` | **Normal** for mesh RPC — no port 1234 needed |
| Download brain fails | Install Ollama, or use LM Studio |
| NAS still only uses dolonia | Pair Desktop + City Power on; check inference nodes API |

## Advanced (operators)

```env
DENIZEN_INFERENCE_BACKEND=auto
OLLAMA_URL=http://127.0.0.1:11434
DENIZEN_INFERENCE_RPC_TIMEOUT_MS=120000
LM_STUDIO_REMOTE_URLS=http://192.168.1.232:1234
```

See [DENIZEN_INFERENCE_MESH.md](DENIZEN_INFERENCE_MESH.md), [GAP_CLOSURE_PLAN.md](GAP_CLOSURE_PLAN.md), [MESH_SCALING.md](MESH_SCALING.md).
