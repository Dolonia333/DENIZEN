# Denizen Discord Bot & Discord Spaces

**Branch:** `feature/discord-bot-oauth-finish`  
**Bot package:** `denizen/discord-bot` v0.3.0  
**Prefix:** `,` (comma) — most commands also work as **/** slash  
**Last updated:** 2026-07-16  

> **Ops / live NAS map:** see [`OPS_LIVE_STACK.md`](./OPS_LIVE_STACK.md) (conversation sense, Dolonia data, CRM GovCon, Angela Gmail→CRM via n8n).  


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
2. Open `/discord-map/`  
3. Join a **voice channel** → appear in that room  
4. `/avatar` → customize look (free vs paid cosmetics)  
5. Optional: boost for golden headset · OAuth so the map knows “you”  

| Layer | Role |
|-------|------|
| **Discord bot** | Presence tracker, commands, avatar closet, hangout recaps, moderation suite |
| **Discord Spaces map** | Phaser pixel world from live guild categories/channels |
| **Denizen server** | Static map, OAuth, avatar bake API, optional bot sidecar |

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
| **Engagement** | Open-mic / mute status icons, chat bubbles, public share link, watermark, weekly hangout |
| **Pixel UI pack** | Status/chat/boost/panels from Pixel Spaces UI expansion (not emoji) |
| **Help** | Spaces-first `/help`, `/start`, updated command copy |
| **Monetization gates** | Free premade+skins; paid hair/clothes/masks/hats/headsets |
| **Docs** | This file |

---

## 3. Architecture

```text
Discord Guild
     │  voice / text / members
     ▼
discord-bot
  ├── TrackerEngine       # rooms, mute/deaf/live, text snippets, hangout minutes
  ├── Command modules     # avatar, hangout, denizen, mod, …
  ├── Presence HTTP :5180 # /presence, /guilds, /invite, /avatar/*
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
| **Live mic** | In VC, not muted/deafened → green pointer + happy status icon |
| **Muted/deaf** | Status icons from UI pack (sad / angry) |

---

## 4. Getting started (what users see)

### `/help` or `,help`

Default topic is **Spaces**, not a raw module dump:

1. Open the map  
2. Join voice → appear  
3. `/avatar` → look  
4. Boost → golden headset  

Topics: `/help topic:avatar` · `hangout` · `mods` · `all`

### `/start` (aliases `,spaces`, `,maphelp`)

Short onboarding only.

### `@Denizen help` / DM

Same map-first flow; also `rooms`, `who`, `status`.

### Map URL examples

| URL | Use |
|-----|-----|
| `/discord-map/` | Full connect + closet |
| `/discord-map/?guildId=ID` | Preselect guild |
| `/discord-map/?view=public&guildId=ID` | **Public read-only** share / OBS |

Set `DENIZEN_PUBLIC_URL` so help and hangout embeds use absolute links.

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

**Not automatic today.** Payment systems are not wired.

After someone pays, an operator must set the plan (see [§14](#14-ops-turning-on-paid-after-payment)).

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
- Public `?view=public` mode  

### Map HUD (Pixel Spaces UI expansion — not emoji)

| State | Asset |
|-------|--------|
| Open mic | `Status_happiness_4` + bobbing `Pointer_green` |
| Muted | `Status_happiness_1` |
| Deafened | `Status_happiness_0` |
| Soft text | `ChatBubble_*` + short caption |
| Booster | `Boost.png` |
| Nameplate | Small `Panel_green` / `grey` / `blue` |
| Free watermark | `Panel_grey` + text |

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

### Community

`/welcome`, `/autoresponder`, `/levels`, `/starboard`, `/giveaway`, `/bump`, `/counter`  

### Voice / tickets / music / misc

| Module | Commands |
|--------|----------|
| VoiceMaster | `/voicemaster` setup/off/status |
| Tickets | `/tickets` setup/panel/close/list |
| Music | `/play`, `/queue`, `/skip` (**stubs**) |
| Integrations | `/social`, `/fortnite`, `/lastfm` (**stubs**) |
| Misc | `/alias`, `/tts`, `/translate`, `/tictactoe`, `/webhook` |

---

## 9. Engagement features

| Feature | Behavior |
|---------|----------|
| **Open mic / mute** | Voice flags on tracker; pixel status icons on map |
| **Soft social** | Recent text → chat bubble sprite + snippet |
| **Public map link** | `?view=public&guildId=` + copy button |
| **Watermark** | Free plan only; paid removes |
| **Weekly hangout** | VC minutes leaderboard embed + map link |
| **Smooth moves** | Street path when changing rooms |
| **Layout rebuild** | When channels/categories change |

---

## 10. Pixel Spaces art packs

Assets live under `discord-map/`:

| Path | Contents |
|------|----------|
| `PixelSpaces/` | Base furniture, infrastructure, 30 premade NPCs |
| `PixelSpacesFull/` | Full pack: expansions (cafe, hospital, …), NPC layers, **UI/** |
| `PixelSpacesFull/UI/` | **UI Expansion** (~374 PNGs): buttons, panels, frames, icons, status, progress/XP bars, chat bubbles, emotes, pointers, boost icons |

**Used heavily:** furniture, themes, NPCs, status/chat/boost UI for presence.  
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

Presence `people[]` fields include: `soft`, `muted`, `deafened`, `streaming`, `video`, `live`, `textSnippet`, `avatar`.

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
cd denizen && node --test tests/discord-avatar.test.js tests/denizen-discord-auth.test.js
```

**Docker:** `Dockerfile.production` installs `discord-bot` deps; sidecar retries with backoff on crash.

---

## 14. Ops: turning on paid after payment

**Payment does not auto-unlock.** Operator steps:

1. Customer pays (invoice, Stripe Payment Link, etc.).  
2. Set plan:  
   ```bash
   DENIZEN_SPACES_PLAN=community
   # and/or DENIZEN_SPACES_REMOVE_BRANDING=1
   ```  
   Restart bot/server.  
3. Tell user: run `/avatar` → customize → **Save**.  

**Future (not built):** Stripe/Discord webhook → set plan for `guildId` automatically.

---

## 15. Code map

```text
denizen/
├── discord-bot/
│   ├── index.js
│   ├── src/
│   │   ├── help-copy.js          # Spaces-first help text
│   │   ├── tracker.js            # occupancy + hangout + voice flags
│   │   ├── presence-server.js
│   │   ├── gateway.js
│   │   ├── chat.js
│   │   ├── core/                 # config, commands, perms
│   │   └── modules/              # avatar, hangout, denizen, mod, …
│   └── test/
├── discord-map/
│   ├── index.html / play.html / game.js
│   ├── PixelSpaces/ · PixelSpacesFull/   # art + UI expansion
│   └── ROOM_CATALOG.md
├── src/
│   ├── denizen-discord-auth.js
│   └── discord-avatar/           # catalog, plan-gates, bake, store, role-cosmetics
└── docs/
    └── DISCORD_BOT_AND_SPACES.md   # this file
```

---

## 16. Known gaps

| Item | Status |
|------|--------|
| Auto unlock after Stripe/Discord pay | **Not built** — manual plan flip |
| Per-guild plan fully wired everywhere | Env plan is primary; guild JSON partial |
| Music / Fortnite / Last.fm | Stubs |
| Full Bleed-depth moderation | Partial |
| True Discord speaking waveform | Not built (open-mic flags only; needs bot in VC) |
| Hosted multi-tenant SaaS | Not productized |
| Main monorepo boot | May need full lab env/modules |
| Event spaces product | Idea only (themes exist) |
| Message Content Intent | Required for prefix/automod — enable in Developer Portal |

---

## Quick reference

| Audience | Do this |
|----------|---------|
| **Member** | Map → join VC → `/avatar` → boost for headset |
| **Staff** | `/hangout setup` · mod tools · welcome/tickets |
| **Operator** | Env tokens · `DENIZEN_SPACES_PLAN` after pay · public URL |

---

*Branch: `feature/discord-bot-oauth-finish`. Update this doc when gates, payments, or modules change.*
