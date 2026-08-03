# Audio assets

Drop `.ogg` (preferred) or `.mp3` files here that match the names declared in [`/assets/sfx-map.json`](../sfx-map.json). The runtime silently skips missing files, so the system ships safely before any audio lands.

> **Note:** the map lives in `assets/`, not `data/`. In production `./data` is a bind-mounted volume that shadows the repo's committed files, so anything the client fetches must live under `assets/` (served straight from the image).

Default expected files (override the map to use different names):

| File | When it plays |
|---|---|
| `office_ambient_1.wav` (+ add more) | Office music playlist — tracks rotate (shuffled) while presence is on. A one-entry playlist loops gaplessly; add entries to `assets/sfx-map.json` → `ambient.playlist` to rotate. Missing files are skipped. `.ogg`/`.mp3` also work and are much smaller — convert when you can. |
| `office-air/*.ogg`, `chatter/*.ogg` | Always-on ambient **layers** — each `ambient.layers[]` entry loops its `files` together (L/R stems → wide stereo bed) at its own `volume`, for as long as presence is on. Alongside the music, not instead of it. |
| `presence_on.ogg` / `presence_off.ogg` | Alt+V toggle |
| `threat_low.ogg` … `threat_critical.ogg` | Per-severity threat alerts |
| `task_ping.ogg` | New `/api/task-update` arrives |
| `event_chime.ogg` | Generic worldState event broadcast |
| `meeting_start.ogg` / `meeting_end.ogg` | `worldState.setMeeting()` flips |
| `chat_ding.ogg` | New `player_chat_response` |

Free-tier sources for placeholder audio: [freesound.org](https://freesound.org), [zapsplat.com](https://zapsplat.com), [pixabay.com/sound-effects](https://pixabay.com/sound-effects/).

Keep one-shot SFX under ~100 KB. Looping beds (music, `ambient.layers`) can be larger (~1–4 MB) but should have a clean loop point.

## Ambient layers

`ambient.layers` in `assets/sfx-map.json` is a list of independent looping beds that all play while presence is on, mixed under the music:

```json
{ "name": "office-air", "files": ["office-air/left.ogg", "office-air/right.ogg"], "volume": 0.14, "fadeInMs": 3000 }
```

Each layer's `files` loop simultaneously (use the L/R stems together for a wide field, or a single file). Tune per-layer `volume` to balance against the music (`ambient.volume`). Missing files are skipped, so a layer degrades gracefully.
