# Discord Block Life Sim — NPCs that really live here

**Goal:** Residents of the pixel city block have identities, homes, needs, relationships
(friends / enemies / love), life events (birth, aging, death), and jobs that read as
a living neighborhood — not random walkers.

This sits on top of `game.js` ambient life + Pixel Spaces animations.

---

## 1. How to see every animation today

| Tool | How |
|------|-----|
| **F9** | Full pose gallery (auto-cycles all 14 rows) |
| **F8** | Cycle poses on *you* |
| **1–6** | jump / wave / shrug / snicker / eat / hurt |
| **E / ↑** near couch | sit → sitIdle |
| **E / ↑** near bed | lie → lieIdle |
| **↓ / E** while seated | sitFinish / lieFinish |
| Watch street NPCs | walk, sit, eat, wave, social |

### Pose inventory (Pixel Spaces premade sheets)

| Pose | Row | Ability use |
|------|-----|-------------|
| walk | 0 | travel, patrol, go to work |
| idle | 1 | standing, waiting |
| jump | 2 | joy, play, kids |
| sit / sitIdle / sitFinish | 3–5 | rest, cafe, hangout |
| lie / lieIdle / lieFinish | 6–7 | sleep, illness, intimacy (fade) |
| eat / eatSit | 8–9 | meals, hunger need |
| hurt | 10 | fight, accident, illness |
| shrug | 11 | confusion, social fail |
| snicker | 12 | jokes, flirt success |
| wave | 13 | greeting, friends |

### Abilities the art already supports (wire to systems)

- **Locomotion:** walk between home / work / park  
- **Rest:** sit, sleep (lie)  
- **Social:** wave, snicker, shrug  
- **Survival:** eat  
- **Conflict / drama:** hurt, flee (walk fast)  
- **Joy:** jump  

Missing from pack (future art or placeholders): kiss, fight loop, cry, carry child — can use emotes + sit/wave for v1.

---

## 2. Core data model — a real resident

```json
{
  "id": "npc_r12",
  "name": "Mira",
  "sheet": "npc_f3",
  "ageYears": 24,
  "stage": "adult",
  "homeBuildingId": "b_cafe",
  "homeRoomKey": "ch_123",
  "job": "barista",
  "workplaceId": "b_cafe",
  "needs": { "hunger": 0.4, "energy": 0.7, "social": 0.3, "fun": 0.5, "hygiene": 0.8 },
  "mood": 0.6,
  "traits": ["friendly", "curious"],
  "relationships": {
    "npc_r7": { "type": "friend", "score": 0.72 },
    "npc_r2": { "type": "rival", "score": -0.4 },
    "npc_r9": { "type": "crush", "score": 0.55 }
  },
  "family": { "partnerId": null, "parentIds": [], "childIds": [] },
  "schedule": [
    { "h": 8, "act": "work" },
    { "h": 12, "act": "lunch" },
    { "h": 17, "act": "home" },
    { "h": 22, "act": "sleep" }
  ],
  "alive": true,
  "memories": []
}
```

Persist under `data/block-life/<guildId>.json` (or localStorage for map-only demo).

---

## 3. Systems (build order)

### Phase L1 — Named residents (1–2 days)
- Spawn N fixed residents with names + home buildings  
- Nameplates always on  
- Each has a home room + preferred seat  
- Schedule: morning work → evening home  

### Phase L2 — Needs & mood
- Hunger / energy / social decay over time  
- Low hunger → walk to food → eat anim  
- Low energy → sit/sleep  
- Low social → seek others → wave  

### Phase L3 — Relationships
- Proximity + shared room → affinity ticks  
- High affinity: friend (wave more, follow)  
- Negative: rival (shrug, hurt tease, avoid)  
- Crush/partner: sit together, gift emotes  

### Phase L4 — Drama events
- Random daily: fight (hurt), make-up (wave), party (jump)  
- Chat bubbles with short lines from templates  
- News strip on HUD: “Mira befriended Ken”  

### Phase L5 — Life cycle
- Age stages: child / adult / elder (scale sprite, different sheet)  
- Partner + home + happiness threshold → “family” flag  
- Kids: small-scale NPCs that follow parents (no new art required at first)  
- Death: rare elder fade / lie + memorial plaque; respawn as new resident or offspring  

### Phase L6 — Discord bridge
- Real Discord users = “visitors” in the block  
- Map long-time members to adopted resident IDs  
- VC hang time boosts social with NPCs in that room  

---

## 4. Architecture sketch

```
BlockLifeEngine (data)
  ├── residents[]
  ├── buildings / homes
  ├── relationships graph
  └── clock (block-hour, 1 real min = 1 block hour?)

MapScene (view)
  ├── spawn/update sprites from engine
  ├── play poses from needs
  └── HUD: day, events, selected NPC dossier
```

Keep engine pure JS (testable); scene only renders.

---

## 5. UX: “this is a real place”

- **Homes:** each resident returns to a bedroom/couch at night  
- **Jobs:** cafe staff stay near counters during work hours  
- **Pets:** owned by households, follow owners  
- **Kids:** play near street / park zone  
- **Graveyard / memorial** roof plaque for dead legends  
- **Dossier panel (UI pack):** click NPC → needs bars + friends list  

---

## 6. Success metrics

| Metric | Target |
|--------|--------|
| Named residents | ≥ 12 per medium guild map |
| Visible home returns | ≥ 80% at “night” |
| Relationship edges | ≥ 1 friend avg after 10 min |
| Player can explain an NPC’s life | “That’s Mira, she works cafe, friends with Ken” |

---

## 7. Immediate next implementation steps

1. ✅ Animation gallery (F9) + pose inventory  
2. ✅ Pets visible (depth + near spawn)  
3. **Next:** `BlockLifeEngine` + 8 named residents with homes + schedule  
4. Needs-driven sit/eat/sleep  
5. Relationship scores + HUD event log  

*Living doc — update as phases ship.*
