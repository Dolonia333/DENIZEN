# Denizen Discord Bot & Discord Spaces

**Branch:** `feature/discord-bot-oauth-finish`  
**Bot package:** `denizen/discord-bot` v0.3.0  
**Prefix:** `,` (comma) — most commands also work as **/** slash  
**Last updated:** 2026-07-18  

> **Ops / live NAS map:** see [`OPS_LIVE_STACK.md`](./OPS_LIVE_STACK.md) (conversation sense, Dolonia data, CRM GovCon, Angela Gmail→CRM via n8n).  
> **Paid guilds / pets:** see [`DISCORD_PAID_TIER.md`](./DISCORD_PAID_TIER.md).


---

## Table of contents

1. [Product overview](#1-product-overview)  
2. [What’s shipped (branch changelog)](#2-whats-shipped-branch-changelog)  
3. [Architecture](#3-architecture)  
4. [Getting started (what users see)](#4-getting-started-what-users-see)  
5. [Monetization & plan gates](#5-monetization--plan-gates)  
6. [Avatar system](#6-avatar-system)  
7. [Discord Spaces map](#7-discord-spaces-map)  
8. [Bot commands (full list)](#8-bot-commands-full-list)  
9. [Engagement features](#9-engagement-features)  
10. [Pixel Spaces art packs](#10-pixel-spaces-art-packs)  
11. [Environment variables](#11-environment-variables)  
12. [HTTP APIs](#12-http-apis)  
13. [How to run & deploy](#13-how-to-run--deploy)  
14. [Ops: turning on paid after payment](#14-ops-turning-on-paid-after-payment)  
15. [Code map](#15-code-map)  
16. [Known gaps](#16-known-gaps)  

---

## 1. Product overview

Denizen Spaces is a **live pixel map of a Discord server**:

1. Invite the bot  
2. **Owner:** `,teamlink <Denizen team code>` then `,mapcode` (share the code with members)  
3. **Members:** `,signup` (Discord → Denizen account) → open the map → enter the **team code**  
4. Join a **voice channel** (or chat in text) → appear in that room  
5. React in chat or `,eat pizza` → organic emotes / snack sprites on the map  
6. `/avatar` → customize look (free vs paid cosmetics)  
7. Optional: boost for golden headset · `,pet buy` for a companion  

**Signup vs map unlock:** `,signup` creates a Denizen website profile linked to Discord. It does **not** unlock another server’s map — the owner’s team code does.

| Layer | Role |
|-------|------|
| **Discord bot** | Presence tracker, map actions (reactions / eat), commands, avatar closet, hangout, moderation |
| **Discord Spaces map** | Phaser pixel world from live guild categories/channels |
| **Denizen server** | Static map, OAuth, avatar bake API, billing webhooks, optional bot sidecar |

---

## 2. What’s shipped (branch changelog)

High-level work on `feature/discord-bot-oauth-finish` (and parent Discord branch):

| Area | Delivered |
|------|-----------|
| **Bot core** | Tracker, presence `:5180`, gateway, Bleed-style modules |
| **Map** | Dynamic buildings from categories, themes, elevators, sit/lie, mobile |
| **Presence UX** | Smooth VC moves, layout rebuild, auto-warp to your VC |
| **OAuth** | Discord signup/link → map identity (`denizen-discord-auth.js`) |
| **Avatars** | Premade + layered bake, closet in bot + web, plan gates |
| **Boosters** | Golden headset (`headsets.png` + gold tint) |
| **Engagement** | Soft-text chat bubbles, public share link, watermark, weekly hangout |
| **Map social** | Discord reactions → NPC poses; `,eat` / food emoji → Pixel Platter sprite + chew; no permanent head chrome |
| **Pixel UI pack** | Brief fade emotes + chat bubbles (not permanent status faces / mic pointer / boost badge) |
| **Map polish** | Elevator themes + proximity open/close; soft colored chat bubbles; section atmosphere palettes; door enter step; slower walk/idle |
| **Music** | Lavalink v4 auto-connect (`127.0.0.1:2333`); no silent fake queue; `,lavalink` status; play-dl fallback |
| **Last.fm** | Live API when `LASTFM_API_KEY` set; setup embeds; WhoKnows / tops / NP with art |
| **Logging** | `,log` is a **free** module (`logging`) — not gated as community premium |
| **Commands** | Single registry → auto guild slash sync on ready (~93 cmds / ~90 slash); prefix `,` |
| **Help** | Spaces-first `/help`, `/start`; Live field documents react + `,eat` |
| **Monetization gates** | Free premade+skins; paid closet; per-member pets — see [`DISCORD_PAID_TIER.md`](./DISCORD_PAID_TIER.md) |
| **Docs** | This file · paid tier runbook · ops live stack |

---

## 3. Architecture

```text
Discord Guild
     │  voice / text / members
     ▼
discord-bot
  ├── TrackerEngine       # rooms, mute/deaf/live, text snippets, hangout, mapAction TTL
  ├── Command modules     # avatar, hangout, denizen, misc (,eat), mod, …
  ├── map-actions.js      # food aliases + reaction → emote/eat
  ├── Presence HTTP :5180 # /presence (people[].action), /guilds, /invite, /avatar/*
  └── optional office bridge POST → Denizen
     │
     ▼
server.js
  ├── /discord-map/*                    # map UI
  ├── /api/discord/map/*                # proxy presence
  ├── /api/discord/avatar/*             # bake + serve looks (plan-enforced)
  ├── /api/visitor/auth/discord/*       # OAuth
  └── spawn bot if DISCORD_BOT_TOKEN set
     │
     ▼
Browser /discord-map/
  ├── Connect UI (guild, share link, closet, OAuth)
  └── play.html + game.js (polls presence ~1.5s)
```

### Presence model

| Kind | Behavior |
|------|----------|
| **Hard** (voice/stage) | In channel until leave/move |
| **Soft** (text) | Message/typing; expires after `DISCORD_TEXT_WINDOW_MS` (default 90s) |
| **On the map** | Hard VC **or** active soft text window (`tracker.isOnMap`) |
| **Live flags** | `muted` / `deafened` / `live` still in the payload for HUD/logic — **not** shown as permanent faces above heads |
| **Map action** | Ephemeral `people[].action` (~5s TTL) from reactions or `,eat` |

### Map actions (organic emotes + eat)

```text
messageReactionAdd  ─┐
,eat / /eat          ─┼─► tracker.setMapAction ─► people[].action ─► map pose + emote fade
                      │                                      └─► eat: held food sprite (± table plate)
```

| Trigger | Map result |
|---------|------------|
| 👋 wave / hello | `wave` pose + brief heart emote |
| 🤷 shrug | `shrug` |
| 😂 joy / laugh | `snicker` |
| 💨 dash / ⚡ zap | `jump` |
| 💔 broken_heart | `hurt` |
| ❤️ heart | `wave` + heart icon |
| 🍕 🍔 🍎 … (food emoji) | `eat` / `eatSit` + matching Pixel Platter key |
| `,eat` / `,eat pizza` / `/eat food:pizza` | Same eat path; random food if omitted |

Anyone currently on the map (VC or soft text) can trigger actions. Reactions are **ungated** (misc hook, not community premium).

---

## 4. Getting started (what users see)

### `/help` or `,help`

Default topic is **Spaces**, not a raw module dump:

1. Open the map  
2. Join voice (or chat) → appear  
3. React in chat or `,eat pizza` → emote / snack on the map  
4. `/avatar` → look  
5. Boost → golden headset · `,pet buy` → companion  

Topics: `/help topic:spaces` · `avatar` · `hangout` · `mods` · `all`

### `/start` (aliases `,spaces`, `,maphelp`)

Short onboarding only.

### `@Denizen help` / DM

Same map-first flow; also `rooms`, `who`, `status`.

### Map URL examples

| URL | Use |
|-----|-----|
| `/discord-map/` | Full connect + closet |
| `/discord-map/?guildId=ID` | Preselect guild (still needs team code when linked) |

Ungated `?view=public` share links are **disabled** for linked guilds — presence requires a `map_grant` from the team code unlock.

### Owner / member flow

| Who | Commands |
|-----|----------|
| Owner (Manage Server) | `,teamlink <code>` · `,mapcode` |
| Member | `,signup` · `,map` · enter team code on `/discord-map/` |

Set `DENIZEN_PUBLIC_URL` so help and hangout embeds use absolute links.

### HTTP (map gate)

| Endpoint | Role |
|----------|------|
| `GET /api/discord/map/access?guildId=` | `{ linked, gated, setup_required, unlocked }` |
| `POST /api/discord/map/unlock` | `{ guildId, teamCode }` → `{ map_grant }` |
| `POST /api/discord/map/teamlink` | Bot bridge: bind guild → org |
| `GET /api/discord/map/mapcode` | Bot bridge: reveal team code |
| `GET /api/discord/map/presence` | Proxied presence — **403** without grant when gated |

---

## 5. Monetization & plan gates

### Free vs paid avatar (enforced in code)

| | **Free** | **Paid** (`community` / `pro` / `paid`) |
|--|----------|------------------------------------------|
| Premade NPCs (30 cast) | ✅ | ✅ |
| Skin tones (light / fair / tan / deep) | ✅ preference | ✅ + full layers |
| Hair style | ❌ | ✅ |
| Hair color (tint) | ❌ | ✅ |
| Clothes / outfits | ❌ | ✅ |
| Masks / faces | ❌ | ✅ |
| Hats | ❌ | ✅ |
| Headsets | ❌* | ✅ |
| Custom layers mode | ❌ (forced premade) | ✅ |

\* **Server boosters** still get a **golden headset** on free (Discord boost perk).

### Branding

| Plan | Watermark on map |
|------|------------------|
| `free` | “Denizen Spaces” panel (Pixel UI) |
| `community` / `pro` | Hidden |
| or `DENIZEN_SPACES_REMOVE_BRANDING=1` | Hidden |

### Payment → unlock

Guild Pro/Ultra and per-member pets are wired through Stripe — see [`DISCORD_PAID_TIER.md`](./DISCORD_PAID_TIER.md).

Env `DENIZEN_SPACES_PLAN` remains a global override for branding/closet when not using per-guild rows.

### Future monetization ideas (not all built)

- Event spaces (timed theme / pin building)  
- Cosmetic packs / seasonal drops  
- Auto hangout only on paid (manual report free)  
- Custom domain, multi-guild Pro  
- Event attendance recaps  

---

## 6. Avatar system

### Storage

`denizen/data/discord-avatars/{userId}.json` + `.png` (+ optional preview)

### Bake

- **Premade:** full NPC sheet (`npc_m1`…`npc_f15`)  
- **Layers:** body + pants + outfit + face + eyes + hair + hat (Pixel Spaces Full sheets)  
- **Booster:** `headsets.png` + gold hat tint `#f0c14a`

### Commands

| Command | Free | Paid |
|---------|------|------|
| `/avatar edit` | Premade + skin | Full closet |
| `/avatar random` | Premade only | Full random |
| `/avatar show @user` | Preview | Preview |
| `,skin light` | Yes | Yes |
| `,hair short 3` | Upgrade message | Yes |
| `,clothes 7` | Upgrade message | Yes |

### Code

- `src/discord-avatar/catalog.js` — options, seasons  
- `src/discord-avatar/plan-gates.js` — free/paid enforcement  
- `src/discord-avatar/role-cosmetics.js` — booster headset  
- `src/discord-avatar/bake.js` — PNG composite  
- `src/discord-avatar/store.js` — files  
- `discord-bot/src/modules/avatar/` — Discord UI  

---

## 7. Discord Spaces map

### Features

- Buildings from **live guild categories**; themes from names (cafe, gamer, hospital, police, fire, halloween, winter, dig, …)  
- Elevators, rooftops, sit/lie  
- Presence poll ~1.5s; smooth walk between rooms  
- Layout rebuild when channels/categories change  
- Auto-warp linked user (`me=` / OAuth) into hard VC  
- Custom avatars from baked sheets  
- Mobile touch controls  
- Team-code gate (owner `,teamlink` / members unlock with code)  
- **Discord reactions + `,eat`** → NPC poses and held Pixel Platter food (see [Map actions](#map-actions-organic-emotes--eat))  

### Map HUD (Pixel Spaces UI — organic, not permanent chrome)

Live members no longer wear permanent status faces, open-mic pointers, or boost badges above their heads. Feedback is ephemeral:

| Signal | What you see |
|--------|----------------|
| Soft text | Brief `ChatBubble_*` + short caption |
| Reaction emote | One-shot pose (`wave` / `shrug` / `snicker` / `jump` / `hurt`) + fade emote icon |
| Eat | `eat` / `eatSit` pose + temporary held food sprite (or nearest matching table plate) |
| Nameplate | Colored name tag only |
| Free watermark | Corner branding panel (paid removes) |

Mute/deaf/live flags remain on the presence payload for logic and future HUD; they are **not** painted as permanent overhead icons.

### Connect UI

- Guild list, invite bot  
- Account OAuth signup/link  
- Avatar closet (web)  
- **Copy public map link**  
- Branding hint for free vs paid  

---

## 8. Bot commands (full list)

Default prefix: `,` · also slash where registered.

### Core

| Command | Description |
|---------|-------------|
| `/help` · `,help` | Spaces-first help; topics avatar / hangout / mods / all |
| `/start` · `,spaces` | Onboarding (map → VC → avatar → boost) |
| `/ping` | Latency + pointer to help |

### Denizen account & map

| Command | Description |
|---------|-------------|
| `/denizen map` (default) | Map URL + public share + steps |
| `/denizen signup` · `,signup` | OAuth create profile |
| `/denizen link` · `,link` | OAuth link existing login |

### Avatar

| Command | Description |
|---------|-------------|
| `/avatar edit` | Closet UI |
| `/avatar random` · `show` · `reset` · `save` | As named |
| `,skin` · `,hair` · `,clothes` | Quick edits (hair/clothes paid) |

### Hangout (weekly VC minutes)

| Command | Description |
|---------|-------------|
| `/hangout setup #channel` | Recap channel + enable auto |
| `/hangout report` | Post leaderboard now |
| `/hangout enable` / `disable` | Auto weekly (default Mon 17:00 UTC) |
| `/hangout status` | Config + top so far |

### Map social (free — `misc`)

| Command | Description |
|---------|-------------|
| `,eat` · `/eat` | Random Pixel Platter snack + chew pose on the map |
| `,eat pizza` · `/eat food:pizza` | Chosen food (`burger`, `apple`, … — see `map-actions.js`) |
| React with 👋 🤷 😂 💨 💔 ❤️ or food emoji | Same path as above if you are on the map |

Unknown food names get a short alias list in the reply. You must be in VC or soft text presence first.

### Canvas / occupancy

| Command | Description |
|---------|-------------|
| `/roomsnapshot` · `,rooms` | Live room occupancy + map link |
| `/canvasevents` | Recent security/canvas events |

### @mention / DM

| Input | Behavior |
|-------|----------|
| `help` / `start` | Mention help |
| `rooms` / `map` | Occupancy + map URL |
| `who` | Who is in VC/text |
| `status` | Summary + open-mic count |
| freeform | LM Studio if available, else rooms + help |

### Moderation (staff)

`/setup`, `/setupmute`, ban, softban, kick, timeout, warn, jail, mute  

### Automod

`/automod`, `/snipe`, `/editsnipe`  

### Security

`/security`, `/antinuke`, `/antiraid`, `/recentban`, `/raid`, `/fakepermissions`  

### Logging (free)

| Command | Description |
|---------|-------------|
| `/log` · `,log` · `,logging` | Configure event logging (on/off, channel, embeds, per-event toggles, ignore channels) |

Tagged `module: 'logging'` — **not** premium. Hooks always run; configure command is available on free guilds (needs Manage Guild).

### Community (premium 💎)

`/welcome`, `/autoresponder`, `/levels`, `/starboard`, `/giveaway`, `/bump`, `/counter`  

### Voice / tickets / music / integrations / misc

| Module | Commands |
|--------|----------|
| VoiceMaster | `/voicemaster` setup/off/status |
| Tickets | `/tickets` setup/panel/close/list |
| Music | `/play` `/queue` `/skip` `/stop` `/pause` `/volume` `/np` `/player` `/loop` `/filter` `/shuffle` `/remove` `/clearqueue` `/lavalink` — **Lavalink v4** (see env below) |
| Integrations | `/lastfm` (`fm`/`npfm`) live with key; `/fortnite`; `/social` YouTube poll; Twitter/Spotify notify **not built** |
| Misc | `/alias`, `/tts`, `/translate`, `/tictactoe` (honor-system stub), `/webhook`, `/urban`, `/define`, `/image`, `/afk`, **`/eat`** |

**Slash sync:** on bot ready, `registry.syncSlash` pushes all `slash !== false` commands to each joined guild (or `DISCORD_GUILD_ID` only). Restart the bot after adding commands. Prefix-only: `,skin` `,hair` `,clothes`.

---

## 9. Engagement features

| Feature | Behavior |
|---------|----------|
| **Reaction emotes** | Chat reactions → map poses + brief fade icons (anyone on the map) |
| **Eat / snack** | `,eat [food]` or food emoji → Pixel Platter sprite + chew anim for all map viewers |
| **Soft social** | Recent text → colored chat bubble sprite + snippet (pops on change) |
| **Elevators / doors** | Theme elevators open on proximity; door enter step on floor change |
| **Section atmosphere** | Per-section palette tint on plain building shells |
| **No permanent head chrome** | Status faces / mic pointer / boost badge removed from live members |
| **Team-code map gate** | Owner `,teamlink` · members enter code on `/discord-map/` |
| **Watermark** | Free plan only; paid removes |
| **Weekly hangout** | VC minutes leaderboard embed + map link |
| **Smooth moves** | Street path when changing rooms |
| **Layout rebuild** | When channels/categories change |
| **Companion pets** | Per-member entitlement — see [`DISCORD_PAID_TIER.md`](./DISCORD_PAID_TIER.md) |

---

## 10. Pixel Spaces art packs

Assets live under `discord-map/`:

| Path | Contents |
|------|----------|
| `PixelSpaces/` | Base furniture, infrastructure, 30 premade NPCs |
| `PixelSpacesFull/` | Full pack: expansions (cafe, hospital, …), NPC layers, **UI/** |
| `PixelSpacesFull/UI/` | **UI Expansion** (~374 PNGs): buttons, panels, frames, icons, status, progress/XP bars, chat bubbles, emotes, pointers, boost icons |
| `PacksExtra/PixelPlatter/` | Food plate PNGs (`foodBurger`, `foodPizza`, …) for table props + held snack sprites |

**Used heavily:** furniture, themes, NPCs, chat bubbles, brief emotes, Pixel Platter food.  
**Present but lightly used:** permanent status/pointer/boost icons (kept in pack; not shown as live-member overhead chrome).  
**Present but lightly used:** full button/panel shop mockups (available for future HUD).

Also: root `discord pixel game/` prototype with Free + Full packs.

---

## 11. Environment variables

### Required for full stack

| Variable | Purpose |
|----------|---------|
| `DISCORD_BOT_TOKEN` | Bot login |
| `DISCORD_CLIENT_ID` / `DISCORD_APPLICATION_ID` | Invite + OAuth |
| `DISCORD_CLIENT_SECRET` | OAuth |
| `DENIZEN_PUBLIC_URL` | Absolute map/help/OAuth URLs |

### Spaces product

| Variable | Purpose |
|----------|---------|
| `DENIZEN_SPACES_PLAN` | `free` (default) · `community` · `pro` |
| `DENIZEN_SPACES_REMOVE_BRANDING` | `1` = hide watermark |

### Optional bot

| Variable | Purpose |
|----------|---------|
| `DISCORD_GUILD_ID` | Single-guild filter |
| `DISCORD_PRESENCE_PORT` | Default `5180` |
| `DISCORD_PREFIX` | Default `,` |
| `DENIZEN_DISCORD_BOT` | `auto` or `off` (sidecar) |
| `DISCORD_FORWARD_OFFICE` | `1` = VC → Denizen office |
| `DISCORD_BRIDGE_SECRET` | Office presence auth |
| `DISCORD_TEXT_WINDOW_MS` | Soft text TTL |
| `LM_STUDIO_URL` | @bot freeform chat |
| `DENIZEN_SESSION_SIGNING_KEY` | OAuth state |
| `DISCORD_AVATAR_DIR` | Avatar store path override |

### Music (Lavalink)

| Variable | Purpose |
|----------|---------|
| *(defaults)* | Auto-connect `127.0.0.1:2333` / password `youshallnotpass` |
| `LAVALINK_HOST` / `LAVALINK_PORT` / `LAVALINK_PASSWORD` | Override node |
| `LAVALINK_URL` | Full HTTP base (e.g. `http://192.168.1.237:2333`) |
| `LAVALINK_DISABLE` | `1` = skip auto-connect |

```bash
cd denizen/discord-bot
docker compose -f docker-compose.lavalink.yml up -d
```

`,play` fails with setup help if the node is down — it does **not** fake-queue silent tracks. Status: `,lavalink`.

### Integrations keys

| Variable | Purpose |
|----------|---------|
| `LASTFM_API_KEY` | `,lastfm` / WhoKnows / tops ([create key](https://www.last.fm/api/account/create)) |
| `YOUTUBE_API_KEY` | `,social bind youtube` |
| `FORTNITE_API_KEY` | `,fortnite` shop snapshot |

**OAuth redirect:**

```text
{DENIZEN_PUBLIC_URL}/api/visitor/auth/discord/callback
```

---

## 12. HTTP APIs

### Presence (`:5180`, proxied as `/api/discord/map/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health |
| GET | `/presence?guildId=` | Rooms, people (flags + avatars), branding, share |
| GET | `/guilds` | Guild list |
| GET | `/invite` | Bot invite URL |
| GET | `/avatar/catalog?plan=` | Closet options (plan-filtered) |
| GET | `/avatar/:userId[.png]` | JSON or baked sheet |
| PUT | `/avatar/:userId` | Save + bake (plan-enforced) |

### Main server

| Method | Path | Description |
|--------|------|-------------|
| GET | `/discord-map/` | Map UI |
| GET | `/api/discord/map/presence` | Proxy |
| GET/PUT | `/api/discord/avatar/*` | Avatar API |
| GET | `/api/visitor/auth/discord/*` | OAuth |
| POST | `/api/discord/presence` | Bot → office bridge |

Presence `people[]` fields include: `soft`, `muted`, `deafened`, `streaming`, `video`, `live`, `textSnippet`, `avatar`, `pet`, **`action`** (`{ kind, pose?, food?, ts }` while mapAction TTL is live).

Tracker APIs: `setMapAction(guildId, userId, action, ttlMs?)`, `isOnMap(guildId, userId)`.

---

## 13. How to run & deploy

```bash
cd denizen
# configure .env (token, DENIZEN_PUBLIC_URL, optional PLAN)
npm install
cd discord-bot && npm install && cd ..

npm start                    # main app + bot sidecar if token set
# or
cd discord-bot && npm start  # bot alone
```

Open: `http://localhost:8080/discord-map/` (or your `PORT`).

**Tests:**

```bash
cd denizen/discord-bot && npm test
# includes tracker mapAction, map-actions food/reaction catalog, UI kit Spaces help
cd denizen && node --test tests/discord-avatar.test.js tests/denizen-discord-auth.test.js
```

**Docker:** `Dockerfile.production` installs `discord-bot` deps; sidecar retries with backoff on crash.

---

## 14. Ops: turning on paid after payment

Prefer Stripe Checkout + webhooks ([`DISCORD_PAID_TIER.md`](./DISCORD_PAID_TIER.md)).

**Manual / env override** (still useful for labs):

1. Customer pays (invoice, Stripe, etc.).  
2. Set plan:  
   ```bash
   DENIZEN_SPACES_PLAN=community
   # and/or DENIZEN_SPACES_REMOVE_BRANDING=1
   ```  
   Restart bot/server.  
3. Tell user: run `/avatar` → customize → **Save**. Pets: `,pet buy` or Pro `,pet grant @user`.

---

## 15. Code map

```text
denizen/
├── discord-bot/
│   ├── index.js
│   ├── src/
│   │   ├── help-copy.js          # Spaces-first help (Live: react + ,eat)
│   │   ├── map-actions.js        # food aliases + reaction → emote/eat
│   │   ├── tracker.js            # occupancy + hangout + voice flags + mapAction
│   │   ├── presence-server.js    # people[].action
│   │   ├── gateway.js
│   │   ├── chat.js
│   │   ├── music/lavalink-client.js
│   │   ├── core/                 # config, commands, perms
│   │   └── modules/              # avatar, hangout, denizen, misc (,eat), music, logging, …
│   └── test/
├── discord-map/
│   ├── index.html / play.html / game.js
│   ├── PacksExtra/PixelPlatter/  # food sprites
│   ├── PixelSpaces/ · PixelSpacesFull/   # art + UI expansion
│   └── ROOM_CATALOG.md
├── src/
│   ├── denizen-discord-auth.js
│   ├── denizen-guild-plans.js / denizen-guild-billing.js / denizen-guild-pets.js
│   └── discord-avatar/           # catalog, plan-gates, bake, store, role-cosmetics
└── docs/
    ├── DISCORD_BOT_AND_SPACES.md   # this file
    └── DISCORD_PAID_TIER.md
```

---

## 16. Known gaps

| Item | Status |
|------|--------|
| Auto unlock after Stripe/Discord pay | **Built** for guild plans + pets — see [`DISCORD_PAID_TIER.md`](./DISCORD_PAID_TIER.md) |
| Per-guild plan fully wired everywhere | Guild rows primary; env plan still used as override |
| Music | **Live** via Lavalink (or play-dl fallback) — not a silent queue stub |
| Last.fm | **Live** when `LASTFM_API_KEY` set |
| `,log` premium mis-tag | **Fixed** — module is `logging` (free) |
| Fortnite shop | Needs `FORTNITE_API_KEY` |
| Twitter / Spotify notify | Not built |
| Tic-tac-toe | Honor-system board only (not interactive) |
| Slash command count | ~90 / Discord guild limit 100 — room is thin |
| Full Bleed-depth moderation | Partial |
| True Discord speaking waveform | Not built (voice flags only; needs bot in VC) |
| Permanent mute/deaf face chrome | **Removed by design** — organic emotes instead |
| Cross-client sync of emptied table plates | Out of scope (held food via presence still syncs) |
| Hosted multi-tenant SaaS | Not productized |
| Main monorepo boot | May need full lab env/modules |
| Event spaces product | Idea only (themes exist) |
| Message Content Intent | Required for prefix/automod — enable in Developer Portal |

---

## Quick reference

| Audience | Do this |
|----------|---------|
| **Member** | Map → join VC → react / `,eat` → `/avatar` → boost for headset · `,pet buy` |
| **Staff** | `/hangout setup` · mod tools · welcome/tickets · `,pet grant` (Pro) |
| **Operator** | Env tokens · Stripe prices · guild plans · public URL |

---

*Update this doc when gates, payments, map social, or modules change. Paid detail: [`DISCORD_PAID_TIER.md`](./DISCORD_PAID_TIER.md).*
