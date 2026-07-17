# Pixel Spaces UI — how the pack is meant to work

Official pack: [Pixel Spaces by Netherzapdos](https://netherzapdos.itch.io/pixel-spaces)

The author designed this for **life sim / city / Tiny Tower–style** games. The UI expansion is not optional decoration — it is the intended chrome for:

| Pack folder | Intended use |
|-------------|--------------|
| **Emotes** | Feelings over characters (heart, question, fire, thumbs…) |
| **Chat Bubbles** | Speech / talk beats (8 colors + shadow) |
| **Icons → Status_*** | Resident **needs**: happiness 0–4, hunger, energy, thirst, hygiene, comfort, cold |
| **Icons → Pointer_*** | Selection arrow over player / focused NPC (8 colors) |
| **Icons → Progress_bar_*** | Need meters (color + levels 1–5) |
| **Icons → XP_bar_*** | Day / level progress |
| **Panels / Tabs / Frames** | HUD boxes, room name plaques |
| **Buttons** | Menus / actions |
| **Selection_*** | Ring under selected character |
| **Cursor** | Optional desktop cursor art |

## What we wire in this map

| Feature | UI assets used |
|---------|----------------|
| Room plaques | `Panel_*_tab` |
| Top HUD | `Panel_*_background`, population icon, person emote |
| Community need meters | `Status_hunger/energy/comfort` + green/orange/blue progress bars |
| Day clock panel | Yellow panel + `XP_bar_*` from hour of day |
| Event strip | Grey panel + mail icon |
| You (player) | Green **pointer** + green **selection** ring |
| Neighbors | Dominant **status** icon (hunger / tired / mood face) |
| Social chat | Chat bubbles + emotes |
| Pose emotes | Full emote set mapped from sit/eat/wave/etc. |
| Discord live members | Happiness faces, pointer, bubbles, boost (existing) |

## Not every PNG is on screen at once

~370 UI files exist; the pack expects **systems** that pick the right frame (e.g. progress level 3 of 5). We load the **usable set** into Phaser `ASSETS` and drive them from needs/day/poses.

Re-check usage:

```bash
node discord-map/scripts/inventory-sprites.mjs
```

## Code entry points (`game.js`)

- `ASSETS` — UI paths under `UI_BTN`, `UI_EMOTE`, `UI_BUBBLE`, `UI_ICON`, `UI_CURSOR`
- `buildHud` / `refreshHudNeeds` — community panel + bars + XP
- `syncResidentChrome` — need icon over neighbors
- `updatePlayerUiChrome` — pointer + selection
- `showEmote` / `showChatBubble` — floating pack UI
- `emoteKeyForPose` / `statusIconForResident` / `progressBarKey`
