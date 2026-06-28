# Denizen Scene Building — One-Page Quick Start

*Print this. Tape it to the monitor. Full guide: [SCENE_BUILDING_MANUAL.md](SCENE_BUILDING_MANUAL.md).*

---

## 1 · Get in

1. Open a terminal in the **`denizen/`** folder and run: **`npm start`**
2. In a browser go to: **`http://localhost:8080/`**  ← this is the game
3. Click the game once, then press **`E`** → the **EDITOR** opens.
   Press **`E`** again to close it.

*(No server? Nothing loads. Start it first. Keys do nothing while a text box is focused — click empty floor first.)*

---

## 2 · The keys

| Key | Does |
|-----|------|
| **`E`** | Open / close the editor |
| **`X`** | **Save** the active tab (Furniture layout / Walls file) |
| **Double-click** a piece | Delete it |
| `D` | *(Walls)* Duplicate selected wall |
| `Delete` | *(Walls)* Delete selected wall |
| `K` | *(Walls)* Cut a wall (make a doorway gap) |

---

## 3 · Build a room (3 steps, in order)

**① Walls tab — draw the room & boundaries**
- **Rebuild perimeter box** → instant rectangular room. Then `K` to cut doorways.
- Or pick **Draw wall** and drag: across = top wall, up/down = side wall, diagonal = corner.
- Walls **are** the boundaries — if someone walks through, a wall is missing there.
- Turn on **Show Collisions** (toolbar) to see the invisible solid boxes.

**② Furniture tab — place the stuff**
- **Search** a name → **click the item** → **click the floor** to drop it.
- Double-click a placed piece to remove it. Keep **Snap: ON** so rows line up.
- Leave ~2 tiles of walking space between facing desks.

**③ Save** → press **`X`** on each tab.

---

## 4 · Adding a NEW object the game doesn't know yet

The editor only lists items that have been **named**. To name a new one:

| The art is… | Open this page | Do this |
|-------------|----------------|---------|
| A LimeZu themed piece (Japanese, gym, kitchen, lounge…) | `localhost:8080/tools/limezu-sprite-browser.html` | Type a **name**, footprint, depth → **Save** |
| A Modern Office desk/chair (HQ look) | `localhost:8080/sprite-cutter.html` then `…/sprite-labeler.html` | **Cut** a box, then **name + type** → **Save** |
| A floor or wall tile | `localhost:8080/tools/tile-inspector.html` | Click the tile → copy its **frame** number |

**You are the namer.** LimeZu never labels `Singles_42`. Pick clear names: `gym_treadmill`, not `thing3`.

---

## 5 · Copy a finished room (don't invent layouts)

Open the artist's example rooms in `assets/limezu/examples/` and match them:
`*_layer1.png` = walls (build first) · `*_layer2.png` = furniture (place next) · `*_preview.png` = the goal.

Source packs (cleaner reference): Interiors · Exteriors · Office · UI · Farm — all at **limezu.itch.io**.

---

## 6 · Hand back these files

After **`X`**, give the engineer:
`furniture_catalog_openplan_edited.json` · `openplan_walls_edited.json` · `data/limezu-labels.json`

That's the whole job. ✅
