# Denizen Discord Bot & Discord Spaces

**Branch:** `feature/discord-bot-oauth-finish` (forked from `feature/discord-bot-and-app`)  
**Bot package:** `denizen/discord-bot` v0.3.0  
**Prefix:** `,` (comma) by default — also slash commands  
**Date:** 2026-07-15  

This document covers:

1. What shipped on the Discord bot / Spaces line of work  
2. Architecture and data flow  
3. Everything the Discord bot can do today (commands by module)  
4. Discord Spaces map + avatar system  
5. Environment variables, APIs, and known gaps  

---

## 1. Product overview

Denizen’s Discord product has three layers:

| Layer | Purpose |
|-------|---------|
| **Discord bot** | Tracks voice/text presence, moderation/community tools, avatar closet, account linking |
| **Discord Spaces map** | Pixel city generated from the live guild (categories → buildings, channels → rooms) |
| **Denizen server** | Serves the map, OAuth, avatar bake API; optional spawn of bot as a sidecar |

**Core experience:** Invite the bot → open `/discord-map/` → join a voice channel → appear as a sprite in that room. Customize look with `/avatar`. Optionally link a Denizen visitor profile via Discord OAuth.

---

## 2. Branch changes (high level)

Commits on this line (relative to `master`, simplified):

| Area | What changed |
|------|----------------|
| **discord-bot/** | New bot: tracker, presence HTTP API, Bleed-style modules, avatar module |
| **discord-map/** | Full Pixel Spaces map client: dynamic guild layout, elevators, sit/lie, presence poll, mobile |
| **Avatar system** | `src/discord-avatar/`: catalog, file store, PNG bake, booster golden headsets |
| **OAuth** | `src/denizen-discord-auth.js`: Discord connect/callback/status for map identity |
| **server.js** | Static `/discord-map/`, presence proxy, avatar API, Discord OAuth routes, bot sidecar with retry |
| **Phone UI** | Discord Map app tile → `/discord-map/` |
| **Office NPCs** | Living-office pathfinding / dwell behavior (shared office, not map-only) |
| **Deploy** | Production Dockerfile installs `discord-bot` deps; presence sidecar env |

### Major feature milestones

1. **Bot + presence tracker** — hard voice occupancy, soft text window (~90s)  
2. **Pixel Spaces map** — themed buildings from guild categories  
3. **Map interactions** — elevators, rooftops, sit/lie, world catalog  
4. **Live presence polish** — smooth room moves, layout rebuild on channel changes, auto-warp to your VC  
5. **OAuth** — signup/link Discord → green “(you)” on map  
6. **Avatar closet P0–P3** — premade + layered looks, bot UI, map closet, seasons  
7. **Booster cosmetics** — golden headsets for server boosters  

---

## 3. Architecture

```text
Discord Guild
     │  voice / text / members
     ▼
discord-bot (sidecar or standalone)
  ├── TrackerEngine          # rooms + occupants
  ├── Modules (commands)     # mod, avatar, community, …
  ├── Presence HTTP :5180    # /presence /guilds /invite /avatar/*
  └── optional POST → Denizen /api/discord/presence  (office bridge)
     │
     ▼
server.js (main Denizen app)
  ├── GET  /discord-map/*              # static map
  ├── GET  /api/discord/map/presence   # proxy → :5180
  ├── GET  /api/discord/avatar/*       # bake/serve looks
  ├── GET  /api/visitor/auth/discord/* # OAuth
  └── spawn bot if DISCORD_BOT_TOKEN set
     │
     ▼
Browser: /discord-map/
  ├── Connect UI (guild pick, closet, OAuth)
  └── play.html + game.js (Phaser map, polls presence ~1.5s)
```

### Presence model

| Kind | Meaning |
|------|---------|
| **Hard (voice/stage)** | In VC until leave/move |
| **Soft (text)** | Recent message/typing; expires after `DISCORD_TEXT_WINDOW_MS` (default 90s) |

Snapshot includes rooms, categories, people, and per-person `avatar` metadata when available.

---

## 4. Discord bot — full capability list

Default **prefix:** `,`  
Also: **slash** for most commands (synced on ready).  
**@Denizen** natural chat: `help`, `rooms`, `who`, `status`, or freeform → LM Studio if configured.

### 4.1 Core

| Command | Description |
|---------|-------------|
| `,ping` / `/ping` | Latency (WS ping) |
| `,help` / `/help` | Lists commands by module |

### 4.2 Denizen account & map (`denizen` module)

| Command | Description |
|---------|-------------|
| `/denizen signup` · `,signup` · `,join` · `,account` | Ephemeral OAuth link to create Denizen profile |
| `/denizen link` · `,link` | Link Discord to existing Denizen session |
| `/denizen map` | Link to Discord Spaces map (`/discord-map/`) |

OAuth routes (server): connect → Discord → callback → localStorage `discordUserId` + optional `access_grant` session.

### 4.3 Avatar closet (`avatar` module)

| Command | Description |
|---------|-------------|
| `/avatar edit` · `,avatar` · `,closet` · `,look` | Open closet UI (select menus + preview PNG) |
| `/avatar random` | Randomize look and save |
| `/avatar show [@user]` | Preview yours or another member’s look |
| `/avatar reset` | Default premade |
| `/avatar save` | Save current draft |
| `,skin <light\|white\|lightdark\|dark\|…>` | Quick skin (layers) |
| `,hair <short\|long\|unique\|none> [index]` | Quick hair |
| `,clothes <index> [set]` | Quick outfit |

**Closet controls:** Mode (premade/layers), premade sheet, skin, hair, Next outfit, Cycle tint, Randomize, Save, Reset.

**Looks system (`src/discord-avatar/`):**

| Mode | Behavior |
|------|----------|
| **Premade** | One of 30 NPC sheets (`npc_m1`–`npc_f15`) |
| **Layers** | Body + pants + outfit + face + eyes + hair + hat, baked to 256×448 PNG |

**Cosmetics / unlocks:**

| Unlock | Who | Reward |
|--------|-----|--------|
| `role:booster` | Server boost (`premiumSince` or boost-named role) | **Golden headset** (`headsets.png` + gold tint `#f0c14a`) |
| `role:mod` | Admin / Manage Guild / mod perms | Unlock flag (for future cosmetics) |
| `event:halloween` | Oct–early Nov | Skeleton body, ember tint |
| `event:winter` | Dec–early Jan | Gingerbread body, frost tint |

Boosters auto-equip golden headsets on `/avatar` open/save (unless hat was set manually). Leaving boost removes auto headset.

**Storage:** `denizen/data/discord-avatars/{userId}.json` + `.png`  
**APIs:** `GET/PUT /api/discord/avatar/:userId`, `GET …/:userId.png`, `GET …/catalog`

### 4.4 Canvas / rooms (`canvas` module)

| Command | Description |
|---------|-------------|
| `,roomsnapshot` / `/roomsnapshot` | Occupied rooms + recent security event types |
| `,canvasevents` · `,cevents` | Last ~15 security/canvas bus events |

Feeds the map pipeline mentally; presence HTTP is the real map data source.

### 4.5 Moderation (`moderation` module)

| Command | Permission | Description |
|---------|------------|-------------|
| `/setup` | Administrator | Create Jailed role, `#jail`, `#denizen-mod-log` |
| `/setupmute` | (mod setup) | Mute role setup |
| `/ban` | ban_members (or fakeperm) | Ban + case log |
| `/softban` | ban_members | Ban + unban (purge) + case |
| `/kick` | kick_members | Kick + case |
| `/timeout` | moderate_members | 1h timeout + case |
| `/warn` | moderate_members | DM warn + case |
| `/jail` | moderate_members | Add jail role (needs setup) |
| `/mute` | moderate_members | Add mute role (needs setupmute) |

Cases logged via `core/cases.js` into configured log channel.

### 4.6 Automod (`automod` module)

| Command | Description |
|---------|-------------|
| `/automod` | `on\|off\|status\|invites\|links` toggles |
| `/snipe` | Last deleted message (in-memory) |
| `/editsnipe` | Last edited message |

Hooks: message create/delete/update for filters (invites, links, word list, spam config).

### 4.7 Security (`security` module)

| Command | Description |
|---------|-------------|
| `/security` | `enable\|disable\|doctor\|status` |
| `/antinuke` | `on\|off\|status` + threshold / punishment |
| `/antiraid` | `on\|off\|status\|unlock\|massjoin` |
| `/recentban` | Act on N most recent members |
| `/raid` | Timed raid mode (`2h`, `30m`, …) ban/kick |
| `/fakepermissions` | `add\|remove\|list\|reset` role → fake perm flags |

Antinuke listens to audit log patterns; antiraid to mass joins / avatar / age rules (config-driven).

### 4.8 Community (`community` module)

| Command | Description |
|---------|-------------|
| `/welcome` | `on\|off\|channel\|message` |
| `/autoresponder` | Trigger/response pairs |
| `/levels` | XP leveling toggle/config |
| `/starboard` | Star threshold + channel |
| `/giveaway` | Create giveaways (stored in guild config) |
| `/bump` | Reminder-style bump helper |
| `/counter` | Channel counters |

Also: member join/leave messages, reaction roles hooks, XP on messages (if enabled).

### 4.9 VoiceMaster (`voicemaster` module)

| Command | Description |
|---------|-------------|
| `/voicemaster` | `setup\|off\|status` — join-to-create temp VCs |

Creates hub channel; on join, spawns personal voice channel.

### 4.10 Tickets (`tickets` module)

| Command | Description |
|---------|-------------|
| `/tickets` | `setup\|panel\|close\|list` |

Button panel → private ticket channels under a Tickets category.

### 4.11 Music (`music` module) — stub

| Command | Description |
|---------|-------------|
| `/play <query>` | Queue stub (not full Lavalink) |
| `/queue` | Show queue stub |
| `/skip` | Skip stub |

### 4.12 Integrations (`integrations` module) — light stubs

| Command | Description |
|---------|-------------|
| `/social` | Social link helpers |
| `/fortnite` | Stub/info |
| `/lastfm` | Stub/info |

### 4.13 Misc (`misc` module)

| Command | Description |
|---------|-------------|
| `/alias` | Command aliases in guild config |
| `/tts` | Text-to-speech helper (if wired) |
| `/translate` | Translate helper |
| `/tictactoe` | Mini-game |
| `/webhook` | Create/relay webhook in channel |

### 4.14 Mention / DM chat (`chat.js`)

When messaged with @bot or in DM:

| Input | Behavior |
|-------|----------|
| `help` | Brief help |
| `rooms` | Occupancy summary from tracker |
| `who` | Who is in voice/text soft presence |
| `status` | Bot/guild status |
| freeform | LM Studio if `LM_STUDIO_URL` reachable, else short tracker summary |

---

## 5. Discord Spaces map

### URLs

| Path | Role |
|------|------|
| `/discord-map/` | Connect UI: guilds, account, **avatar closet**, advanced presence URL |
| `/discord-map/play.html` | Phaser game (iframe from connect) |

### Map features

- **Dynamic layout** from live guild categories/channels  
- **Themes** from category names (cafe, gamer, hospital, museum, police, fire, halloween, …) or round-robin  
- **Voice buildings** vs plain office park vs outdoor zones (winter / dig site)  
- **Elevators**, rooftops, sit/lie furniture  
- **Presence poll** ~1.5s: spawn/move/despawn people; soft = faded tag  
- **Smooth moves** between rooms (street path if floors differ)  
- **Layout rebuild** when channels/categories change  
- **Auto-warp** linked user (`ME_DISCORD_ID`) into hard VC room on join/move  
- **Custom avatars** from baked sheets when presence includes `avatar`  
- **Mobile** touch controls  

### Connect UI also includes

- Invite bot button (from `/invite` or proxy)  
- Server list from bot guilds  
- OAuth signup/link  
- Map closet (same avatar API as bot)  
- Optional custom presence URL  

---

## 6. Server / deploy integration

| Mechanism | Behavior |
|-----------|----------|
| **Sidecar** | `server.js` spawns `discord-bot/index.js` when `DISCORD_BOT_TOKEN` set and `DENIZEN_DISCORD_BOT` ≠ off |
| **Retry** | Up to 5 restarts with backoff after crash; reset after 60s healthy |
| **Docker** | `Dockerfile.production` runs `npm ci` in `discord-bot/` |
| **Office bridge** | If `DISCORD_FORWARD_OFFICE=1`, VC events POST to `/api/discord/presence` |

---

## 7. Environment variables

### Bot / Spaces (required for full stack)

| Variable | Purpose |
|----------|---------|
| `DISCORD_BOT_TOKEN` | Bot login |
| `DISCORD_CLIENT_ID` / `DISCORD_APPLICATION_ID` | OAuth + invite URL |
| `DISCORD_CLIENT_SECRET` | OAuth token exchange |
| `DENIZEN_PUBLIC_URL` | Public base for OAuth redirects & map links |
| `DISCORD_GUILD_ID` | Optional: single-guild filter |
| `DISCORD_PRESENCE_PORT` | Default `5180` |
| `DISCORD_PREFIX` | Default `,` |
| `DENIZEN_DISCORD_BOT` | `auto` (default) or `off` |

### Optional

| Variable | Purpose |
|----------|---------|
| `DISCORD_FORWARD_OFFICE` | `1` = push VC to Denizen office |
| `DISCORD_BRIDGE_SECRET` | Auth for office presence POST |
| `DISCORD_OFFICE_ID` | Target office id |
| `DISCORD_TEXT_WINDOW_MS` | Soft text TTL |
| `LM_STUDIO_URL` / `LM_STUDIO_MODEL` | @bot freeform replies |
| `DENIZEN_SESSION_SIGNING_KEY` | OAuth state + grants |
| `DISCORD_AVATAR_DIR` | Override avatar store path |

**OAuth redirect to register in Discord Developer Portal:**

```text
{DENIZEN_PUBLIC_URL}/api/visitor/auth/discord/callback
```

---

## 8. HTTP APIs (presence + avatars)

### Presence server (`127.0.0.1:5180`, also proxied)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health |
| GET | `/presence?guildId=` | Rooms, people, categories, avatars |
| GET | `/guilds` | Guild list summary |
| GET | `/invite` | OAuth2 bot invite URL |
| GET | `/avatar/catalog` | Closet options + unlocks |
| GET | `/avatar/:userId` | Avatar JSON |
| GET | `/avatar/:userId.png` | Baked spritesheet |
| PUT | `/avatar/:userId` | Save + bake |

### Main server

| Method | Path | Description |
|--------|------|-------------|
| GET | `/discord-map/` | Map UI |
| GET | `/api/discord/map/presence` | Proxy presence |
| GET | `/api/discord/map/guilds` | Proxy guilds |
| GET | `/api/discord/map/invite` | Proxy invite |
| GET/PUT | `/api/discord/avatar/*` | Avatar API (shared store) |
| GET | `/api/visitor/auth/discord/connect` | Start OAuth |
| GET | `/api/visitor/auth/discord/callback` | OAuth return |
| GET | `/api/visitor/auth/discord/status` | Link status |
| POST | `/api/discord/presence` | Bot → office VC bridge |

---

## 9. How to run

```bash
# From denizen/
# 1. Configure denizen/.env with DISCORD_BOT_TOKEN (and OAuth secrets for full auth)
cd denizen
npm install
cd discord-bot && npm install && cd ..

# 2. Main app (spawns bot sidecar if token set)
npm start
# → http://localhost:8080 (or PORT)

# 3. Map
open http://localhost:8080/discord-map/

# 4. Bot alone
cd discord-bot && npm start
```

**Bot tests:**

```bash
cd denizen/discord-bot && npm test
cd denizen && node --test tests/discord-avatar.test.js tests/denizen-discord-auth.test.js
```

---

## 10. Code map

```text
denizen/
├── discord-bot/
│   ├── index.js                 # Boot, gateway, presence, modules
│   ├── src/
│   │   ├── tracker.js           # Occupancy engine
│   │   ├── presence-server.js   # :5180 API
│   │   ├── gateway.js           # discord.js client
│   │   ├── chat.js              # @mention replies
│   │   ├── core/                # config, commands, perms, audit
│   │   └── modules/             # feature modules (see §4)
│   └── test/
├── discord-map/
│   ├── index.html               # Connect + closet UI
│   ├── play.html / game.js      # Phaser world
│   ├── PixelSpaces*             # Art packs
│   └── ROOM_CATALOG.md
├── src/
│   ├── denizen-discord-auth.js  # OAuth
│   └── discord-avatar/          # catalog, store, bake, role-cosmetics
└── docs/
    └── DISCORD_BOT_AND_SPACES.md  # this file
```

---

## 11. Known gaps / honesty

| Item | Status |
|------|--------|
| Music / Fortnite / Last.fm | Stubs, not production media bots |
| Full Bleed parity | Partial (structure + many commands; depth varies) |
| Hosted one-click SaaS | Not productized; still env + deploy |
| Profile accent color → default tint | Designed; booster headset shipped; full profile-merge may be partial |
| Main `server.js` boot | May require full monorepo modules/env (lab-specific) |
| Message content intent | Required for prefix + automod; enable in Developer Portal |

---

## 12. Quick reference — member vs staff

**Members**

- Join VC → appear on map  
- `/avatar`, `,skin`, `,hair`, `,clothes`  
- Boost server → golden headset  
- `/denizen signup|map`, OAuth link  

**Staff**

- `/setup`, ban/kick/mute/jail, automod, antinuke/antiraid  
- Welcome, starboard, tickets, voicemaster  
- `/roomsnapshot` for live occupancy  

**Operators**

- Env + sidecar, presence port, OAuth redirect, avatar data dir  

---

*Generated for branch `feature/discord-bot-oauth-finish`. Update this doc when adding modules or changing unlock rules.*
