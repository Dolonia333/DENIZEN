# Denizen live stack (NAS + GitHub)

**Branch:** `feature/discord-bot-and-app`  
**Repo:** https://github.com/Dolonia333/DENIZEN  
**Last aligned:** 2026-07-18  

This is the operator map for everything shipped in the Discord / CRM / Dolonia data push.  
Runtime lives on the **Synology NAS**; source of truth for product code is **GitHub**.

---

## 1. Where things run

| Service | Where | Port / URL |
|---------|--------|------------|
| **denizen-server** | NAS Docker | `8888` · public via tunnel if configured |
| **denizen-n8n** | NAS Docker | host `5679` · https://n8n.dolonia.cloud |
| **supabase-db** | NAS Docker | Postgres for CRM + Dolonia tables |
| **denizen-lavalink** | NAS Docker | music |
| **LM Studio** | GPU host | `<PC_LAN_IP>:1234` |
| **Discord bot** | Sidecar inside denizen-server | when `DISCORD_BOT_TOKEN` set |

Default NAS paths:

- App dir: `/volume1/docker/denizen-server`
- Data volume: `./data` → `/app/data`

---

## 2. GitHub vs NAS vs n8n

| Layer | On GitHub? | On NAS live? |
|-------|------------|--------------|
| Product code (`denizen/src`, `discord-bot`, migrations) | **Yes** (feature branch) | **Yes** (hotfixed +/or image) |
| Docs (`docs/OPS_LIVE_STACK.md`, Dolonia, email) | **Yes** | optional copy |
| Infra ops scripts (`infra/_*.py`) | **Yes** (selected) | local machine only |
| Secrets (`.env`, OAuth tokens) | **Never** | NAS only |
| CRM workspace data / Angela admin role | **No** (runtime DB) | **Yes** (Supabase) |
| n8n “Angela Gmail → CRM” workflow | JSON export in repo | **Active in n8n DB** |

**Not on `master` yet** — use branch `feature/discord-bot-and-app`.

---

## 3. Feature map

### Discord

- Multipurpose bot (mod, tickets, VM, music, Spaces) — single command registry, auto slash sync on ready
- **Spaces map social** — chat reactions → map emotes; `,eat [food]` → Pixel Platter sprite + chew (free)
- **Music** — Lavalink v4 (`denizen-lavalink`); defaults `127.0.0.1:2333`; set `LAVALINK_DISABLE=1` to skip
- **Last.fm** — `,lastfm` / WhoKnows when `LASTFM_API_KEY` set
- **Logging** — `,log` is free (`module: logging`), not community-gated
- **Conversation sense** — learns how people talk (styles); `,sense` / `,voice`
- **Open chat** — `,chat on` in a channel (no @)
- **@Denizen / DM** — LM replies (uses `LM_STUDIO_REMOTE_URLS` mesh)
- Code: `discord-bot/`, `src/denizen-conversation-sense.js`, `src/denizen-discord-farm.js`
- Docs: `docs/DISCORD_BOT_AND_SPACES.md`, `docs/DISCORD_PAID_TIER.md`

### Dolonia data company (Denizen = product #1)

- Privacy-aware events → Supabase `dolonia_conv_*`
- API: `GET /api/dolonia/conversation-quality`
- Doc: `docs/DOLONIA_CONVERSATION_DATA.md`
- Migration: `supabase/migrations/20260716000001_dolonia_conversation_data.sql`

### CRM (Meridian) + Angela / 1921 GovCon

- Org **zion / Dolo** industry: **govcon**
- **Angela Van Zandt** (`vzion253@gmail.com`): role **admin**
- Per-user audit on workspace save: `GET /api/crm/audit?user=angela`
- Enable GovCon mode: `POST /api/crm/govcon-enable` (session)
- Code: `src/denizen-crm-audit-diff.js`, `src/denizen-crm-store.js`, `src/denizen-crm-routes.js`

### Email: Angela → your Gmail → CRM

**Primary path (live):** self-hosted **n8n**

| Workflow | Status |
|----------|--------|
| **Denizen — Angela Gmail → CRM** | Active |
| Denizen — Gmail inbox to Lucy | Active (separate) |

- Gmail credential: **Gmail account** (zionvanzandt@gmail.com)
- Filter: `from:(vzion253@gmail.com OR angelavanzandt1921@gmail.com)`
- POST → `http://<NAS_IP>:8888/api/crm/email-inbound`
- Workflow JSON in repo: `data/email-workflows/angela-gmail-to-crm.n8n.json`

**Secondary path (optional):** Denizen polls Gmail directly

- Needs `data/gmail-oauth.json` with **gmail.readonly** + `googleapis` in image
- Setup: `node scripts/gmail-local-oauth.js --upload-nas`
- APIs: `/api/crm/email-inbound/status|poll`

Doc: `docs/EMAIL_INTEGRATION.md`

---

## 4. Health checks

```bash
# From NAS or LAN
curl -sS http://<NAS_IP>:8888/api/health | head -c 400
curl -sS http://<NAS_IP>:8888/api/crm/health
curl -sS http://<NAS_IP>:8888/api/dolonia/conversation-quality
curl -sS http://<NAS_IP>:8888/api/crm/email-inbound/status
```

Discord: `,sense` · CRM UI for Dolo/zion · n8n Executions for Angela mail.

---

## 5. Ops scripts (repo `infra/`)

| Script | Purpose |
|--------|---------|
| `deploy-denizen-to-nas.py` | Full image build + deploy |
| `_apply-dolonia-conv-data-nas.py` | Apply Dolonia SQL + dual-write code |
| `_crm-angela-govcon-nas.py` | GovCon preset + Angela admin |
| `_hotfix-crm-email-inbound-nas.py` | Push email-inbound modules |
| `_hotfix-discord-farm-nas.py` | Push sense/farm/chat modules |
| `_n8n-gmail-crm-setup.py` | Import/activate Angela Gmail→CRM workflow |
| `upload-gmail-oauth-nas.py` | Push Gmail OAuth token to container |
| `_verify-dolonia-live-nas.py` | Quick live verify |

Requires `infra/.env` with `SYNO_HOST`, `SYNO_SSH_PASSWORD`, etc. (never commit).

---

## 6. Env (production sketch)

```bash
# Inference
LM_STUDIO_REMOTE_URLS=http://<PC_LAN_IP>:1234

# Discord
DISCORD_BOT_TOKEN=...
DENIZEN_DISCORD_BOT=auto
# Optional music / Last.fm
# LAVALINK_HOST=127.0.0.1
# LAVALINK_PASSWORD=youshallnotpass
# LASTFM_API_KEY=...

# Conversation / Dolonia
DISCORD_FARM=1
DISCORD_SENSE=1
DOLONIA_DATA=1
DOLONIA_PRODUCT_KEY=denizen

# CRM email inbound (n8n is primary; these help direct poll)
GMAIL_INBOUND=1
GMAIL_INBOUND_FROM=vzion253@gmail.com,angelavanzandt1921@gmail.com
GMAIL_INBOUND_ORG_SLUG=zion
# GMAIL_OAUTH_FILE=/app/data/gmail-oauth.json   # optional direct poll
```

---

## 7. Clean rebuild (NAS = git)

```bash
# From monorepo machine with Docker or --remote-build
cd "Denizen OS"
py infra/deploy-denizen-to-nas.py --remote-build
```

Then re-check health URLs above. Runtime DB rows and n8n workflows are **not** replaced by a rebuild (data volumes persist).

---

## 8. Known gaps

- Full Docker image may lag hotfixes until a clean rebuild.
- Server Gmail OAuth may still be `local` mode — **n8n** is the production mail reader.
- Prefer **one** active Angela→CRM n8n workflow (duplicates possible if setup re-run).
- Branch not merged to `master` unless you open a PR.
- Discord Twitter/Spotify notify still not built; music needs Lavalink container; Last.fm needs `LASTFM_API_KEY`.
- See `docs/DISCORD_BOT_AND_SPACES.md` §16 for the full Discord Gaps table.

---

## 9. People / roles (Dolo org)

| Person | Email | Role |
|--------|-------|------|
| Dolonia (Zion) | zionvanzandt@gmail.com | owner |
| Angela Van Zandt | vzion253@gmail.com | **admin** |
| Others | … | member |

CRM industry for zion workspace: **govcon** (capture pipeline, NAICS, vehicles, set-asides).
