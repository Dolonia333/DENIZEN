# Scene Building Manual — Cut, Label & Place Sprites By Hand

> **Who this is for:** Someone new to Denizen who is going to help build the
> pixel world — catalog the LimeZu/Modern Office sprites, cut them out, give
> them names, and place them into rooms with walls and boundaries.
>
> **You do not need to know how to code.** Everything in this guide happens in
> the browser. You open a page, click things, and download a file. The hard
> engineering parts (loading those files back into the game) are already built.
>
> If you only read one thing, read **Part 1 (Get In)** and **Part 4 (Build a
> Room)**. The rest is reference for when you get stuck.

Related deeper docs (for the engineer, not required reading for a first-timer):
[LIMEZU_PLACEMENT.md](LIMEZU_PLACEMENT.md) ·
[SPRITE_FIX_GUIDE.md](SPRITE_FIX_GUIDE.md) ·
[CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md) ·
[ROOM_GENERATOR.md](ROOM_GENERATOR.md) ·
[SCENE.md](SCENE.md)

---

## The big picture (read this first)

A "scene" in Denizen is built from **three kinds of thing**, in this order:

1. **The shell** — the floor and the 3D walls. The empty room.
2. **The boundaries** — invisible walls that stop people walking through stuff.
3. **The furniture** — desks, chairs, plants, beds… placed on top of the floor.

To put furniture in a room, the game first has to **know what each sprite is**.
The art packs (LimeZu, Modern Office) ship as big image sheets with **no names**
— `Singles_42` is just "the 42nd picture the artist exported," not "blue chair."
So there are really **two jobs**, and they feed each other:

| Job | What you do | Where |
|-----|-------------|-------|
| **A. Catalog** | Cut each sprite out of the big sheet, give it a name, save it to the catalog | Standalone tool pages (Part 3) |
| **B. Build** | Drag the now-named sprites into a room, draw walls, set boundaries | In-game editor, **press `E`** (Part 4) |

You can only place things in Job B that have been named in Job A. Most days
you'll do a little of both.

---

## Part 1 — Get in (how to reach it from the web)

### Start the server

The whole thing runs on your own machine through a tiny web server. Open a
terminal in the Denizen project folder and run **one** of these:

```bash
# from the denizen/ folder
npm start
```

or, if you just want the tool pages and the game without the full backend:

```bash
# from the repo root (the folder ABOVE denizen/)
python -m http.server 8080
```

> Use `npm start` when you want **Save to play in the live game** (it runs the
> real server on port **8080**). Use the `python` one-liner when you only want
> to cut/label sprites and download JSON files — it's lighter and always works.

### Open it in a browser

Go to **`http://localhost:8080/`** — that's the game.

> `localhost:8080` just means "the web server running on this computer." If the
> page doesn't load, the server isn't running — go back and start it.

### The one key to remember: **`E`**

Click once on the game so it has focus, then **press `E`**. An editor panel
slides in on the side with two tabs: **Furniture** and **Walls**. Press `E`
again to close it. That's the door to building. Everything in Part 4 lives
behind that key.

### The tool pages (for cutting & naming)

The standalone tools are just other pages on the same server. Open them by
typing the address:

| Tool | Address |
|------|---------|
| Sprite **Cutter** | `http://localhost:8080/sprite-cutter.html` |
| Sprite **Labeler** | `http://localhost:8080/sprite-labeler.html` |
| LimeZu **Sprite Browser** | `http://localhost:8080/tools/limezu-sprite-browser.html` |
| **Tile Inspector** (floors/walls) | `http://localhost:8080/tools/tile-inspector.html` |
| **Room Shell Preview** | `http://localhost:8080/tools/room-preview.html` |
| Single **Preview** (test one sprite) | `http://localhost:8080/tools/limezu-single-preview.html` |
| **Verify Sprites** (visual QA) | `http://localhost:8080/verify-sprites.html` |
| **Catalog Explorer** (overview) | `http://localhost:8080/catalog-explorer.html` |

Bookmark these. A full description of each is in **Part 3**.

---

## Part 2 — Keyboard cheat sheet

These work **inside the game** (`localhost:8080/`) once you've clicked on it.

| Key | What it does |
|-----|--------------|
| **`E`** | Open / close the **editor** (the whole point) |
| **`X`** | **Export / save** what you've built. Furniture tab → saves the furniture layout. Walls tab → downloads the walls file. |
| `D` | *(Walls tab)* **Duplicate** the selected wall piece |
| `Delete` / `Backspace` | *(Walls tab)* **Delete** the selected wall piece |
| `K` | *(Walls tab)* **Cut** a wall (split a long wall in two) |
| Double-click a sprite | *(Furniture tab)* **Delete** that piece of furniture |
| `Enter` | Open player chat (not building — just so you know what it does) |
| `C` | Toggle the office chat panel |
| `Tab` | Toggle the work-activity feed |
| `F` | Toggle "follow" behavior for NPCs |

> ⚠️ Keys are ignored while you're typing in a text box. If `E` does nothing,
> click an empty part of the game first so no text field is focused.

---

## Part 3 — The tools, one by one

Each tool does **one** job. Using the wrong tool on the wrong art pack is the
#1 cause of sprites looking like garbage (stripes, half a chair, magenta
squares). The decision table at the end of this Part tells you which to use.

### 3a. Sprite Cutter — `sprite-cutter.html`
**Use it to:** draw a box around one object on a **sheet** (mainly the Modern
Office sheet) and record its exact pixel position.
- You see the big sheet. You drag a rectangle around one desk/chair/etc.
- It records the crop box (`x, y, width, height`).
- Best for the **Modern Office** sheets where many objects share one image.

### 3b. Sprite Labeler — `sprite-labeler.html`
**Use it to:** go through every cut piece and **type a name + type** for it.
- Loads the auto-detected boxes from the Modern Office sheet.
- For each card you set a **Catalog ID** (e.g. `desk_pod`, `chair_office`) and a
  **Type** (`surface`, `seat`, `decor`, `furniture`, `partition`).
- Cards with an **overlap** badge are sharing pixels with another sprite — nudge
  the box until the badge disappears.
- **Save catalog** downloads the labeled file. (Engineer merges it in — see
  [CATALOG_WORKFLOW.md](CATALOG_WORKFLOW.md).)

### 3c. LimeZu Sprite Browser — `tools/limezu-sprite-browser.html`
**Use it to:** name the **LimeZu Singles** (Japanese, gym, kitchen, lounge…).
- These come as **one PNG per object** already cut — you don't draw boxes, you
  just **name** them.
- Filter by theme, scroll the thumbnails, and for each one type:
  - **Display name** — `kotatsu_blue`, `shoji_door`, `gym_treadmill`
  - **Footprint** — how many tiles wide × tall (used for spacing)
  - **Depth** — usually `1.5`
- Saves to `data/limezu-labels.json`.
- It also has an **Atlas lookup** so you can see where the piece sits in the
  full theme picture.

### 3d. Tile Inspector — `tools/tile-inspector.html`
**Use it to:** pick the right **floor and wall** tiles for the shell.
- Floors and walls aren't "objects," they're tiles on a grid. This tool shows
  the grid and the number (`frame` index) of whichever tile you hover/click.
- Click the floor/wall you want → copy the `frame` number → it goes into
  `data/room-builder-tiles.json`.
- If a floor shows up as **magenta squares** in the game, the frame number is
  wrong — fix it here.

### 3e. Room Shell Preview — `tools/room-preview.html`
**Use it to:** preview an **empty room** (floor + walls only, no furniture) to
confirm the shell looks right before you furnish it.

### 3f. Single Preview — `tools/limezu-single-preview.html`
**Use it to:** load **one** sprite by itself and confirm it isn't broken or
pointing at a missing file. Great for a quick "does this asset even work?"

### 3g. Verify Sprites — `verify-sprites.html`
**Use it to:** see **every** catalog entry cropped at once, as a contact sheet.
This is your final QA pass — scroll through and spot anything that looks cut
off, doubled, or wrong before you ship.

### 3h. Catalog Explorer — `catalog-explorer.html`
**Use it to:** understand the whole catalog system and the naming schema. Good
orientation read; you won't edit here.

### Which tool? (decision table)

```
What are you working with?
│
├─ A LimeZu themed object (Japanese, gym, kitchen, lounge, library, conference)
│     → it's a "Single" (one PNG).  Name it in:  limezu-sprite-browser.html
│
├─ A Modern Office desk / chair / monitor (the current HQ look)
│     → it's on a big SHEET.  Cut: sprite-cutter.html   Name: sprite-labeler.html
│
├─ The floor or the walls of a room (the empty shell)
│     → it's a TILE.  Pick frame number in:  tile-inspector.html
│
└─ Placing already-named things into a room / drawing boundaries
      → don't use these pages at all.  Open the game, press E.  (Part 4)
```

> **Golden rule:** never draw cut-boxes on a LimeZu *theme* sheet. The theme
> sheets (`themes/japanese.png`, etc.) are **lookup pictures only**. The real,
> game-ready pieces are the **Singles** — one file each — and they're already
> cut. You only *name* them. (Full reasoning in
> [LIMEZU_PLACEMENT.md](LIMEZU_PLACEMENT.md).)

---

## Part 4 — Build a room (the in-game editor)

This is Job B. Everything here happens in the game with **`E`**.

### Step 1 — Open the editor
Open `http://localhost:8080/`, click the game, press **`E`**. The panel appears
with **Furniture** and **Walls** tabs.

### Step 2 — Lay the walls / boundaries (Walls tab)
Click the **Walls** tab. This is where you draw the room's outline and the
invisible boundaries that stop characters walking through walls.

- **Tools** (buttons in the panel): *Draw*, add a horizontal **band**, add a
  vertical **face**, add a **corner**, add a **T-junction**.
- **Draw** a wall by clicking start → end.
- **Click** a wall to select it. **Double-click** to delete. **Triple-click**
  to cycle which layer you're viewing (bands / sides / joints / all).
- Selected wall: **`D`** duplicates it, **`Delete`** removes it, **`K`** cuts a
  long wall into two so you can make a doorway gap.
- **Rebuild perimeter box** makes a fresh rectangular room outline in one click —
  good starting point, then carve doorways with `K`.
- **Snap** keeps pieces aligned to the grid (leave it **on** — straight walls).

> **Boundaries = walls.** In Denizen the wall pieces *are* the collision. If a
> character walks through where a wall should be, you're missing a wall segment
> there. Use **Show Collisions** (below) to see the invisible boxes.

### Step 3 — Place the furniture (Furniture tab)
Click the **Furniture** tab. You'll see a searchable list of every **named**
catalog item (this is why Job A matters — unnamed sprites don't appear here).

- **Search** for an item by name (`desk`, `couch`, `plant`…).
- **Click an item, then click the floor** where it should go — it drops there.
  (Drag also works.)
- **Double-click a placed piece to delete it.**
- **Snap** keeps things on the grid so rows of desks line up.
- **Layer filter** dims everything except one type so you can focus.
- **Show Collisions** paints red boxes over everything solid and blue over
  blocked walking cells — use this to confirm there's a clear path between
  desks and that boundaries are where you expect.

> **Spacing tip:** leave at least **2 tiles (about 32px)** of walking room
> between facing desks, and keep wall props **1 tile inside** the wall line (on
> the floor, not buried in the wall). Don't guess — copy the spacing from the
> reference pictures in Part 5.

### Step 4 — Save (`X`)
Press **`X`**.
- On the **Furniture** tab: the layout is **saved to the running game**
  (and a backup file `furniture_catalog_openplan_edited.json` downloads, and it's
  copied to your clipboard). Reload the page and your furniture is still there.
- On the **Walls** tab: a file `openplan_walls_edited.json` downloads. Hand this
  to the engineer (or drop it into `data/openplan_walls.json`) to make the walls
  permanent.

That's a full room: shell → boundaries → furniture → save.

---

## Part 5 — Match the reference rooms (copy the artist)

You don't have to invent layouts. LimeZu shipped **finished example rooms** —
use them as the picture you're copying. They live in
`assets/limezu/examples/`:

| Reference room | Files (open them in an image viewer) |
|----------------|--------------------------------------|
| Generic interior | `generic_preview.png`, `generic_layer1.png`, `generic_layer2.png` |
| Gym | `gym_preview.png`, `gym_layer1.png`, `gym_layer2.png` |
| Japanese house | `japanese_preview.png`, `japanese_layer1.png`, `japanese_layer2.png` |
| TV studio | `studio_preview.png`, `studio_layer1.png`, `studio_layer2.png`, `studio_layer3.png` |
| Office building | `office_building_ex1.png`, `office_building_ex2.png` |

How to read them:
- **`_preview.png`** = the finished room. This is your target.
- **`_layer1.png`** = just the shell (floor + walls). Build this first (Steps 1–2).
- **`_layer2.png`** = just the furniture, on top. Place these next (Step 3).

Stacking layer1 then layer2 in your head **is** the build order, and it's the
correct front-to-back drawing order too.

### The original packs on itch.io (where the art came from)

When you need a cleaner, bigger view of an object — or to confirm what a piece
is "supposed" to be — open the artist's store pages. These are the source packs
the `assets/limezu/` art was exported from:

| Pack | Link | Covers (folder) |
|------|------|-----------------|
| Modern **Interiors** | https://limezu.itch.io/moderninteriors | base furniture, the Singles system |
| Modern **Exteriors** | https://limezu.itch.io/modernexteriors | streets, buildings, vehicles → `assets/limezu/exteriors/` |
| Modern **Office** | https://limezu.itch.io/modernoffice | the HQ desks/chairs → Modern Office sheets |
| Modern **User Interface** | https://limezu.itch.io/modernuserinterface | UI / HUD art → `assets/limezu/ui/` |
| Modern **Farm** | https://limezu.itch.io/modernfarm | crops, animals, fences → `assets/limezu/farm/` |

The itch pages also show the artist's own demo rooms — those are great spacing
references. **Copy the artist's spacing; don't reinvent it.**

> Naming authority is **you**. LimeZu never labels `Singles_42`. Whatever you
> type in the Sprite Browser becomes the official name in our world. Pick clear,
> consistent names (`gym_treadmill`, not `thing3`).

---

## Part 6 — A clean day's workflow (start to finish)

A repeatable loop you can hand to a helper:

1. **Start the server** — `npm start` in `denizen/`, open `http://localhost:8080/`.
2. **Decide the room** — pick a target from `assets/limezu/examples/` (Part 5).
   Open its `_preview.png` next to your browser.
3. **Name any missing pieces (Job A).** Anything in the target you don't already
   have:
   - LimeZu theme object → `tools/limezu-sprite-browser.html`, name it, **Save**.
   - Modern Office piece → `sprite-cutter.html` then `sprite-labeler.html`, **Save**.
   - New floor/wall tile → `tools/tile-inspector.html`, copy the frame number.
4. **QA the cuts** — open `verify-sprites.html`, scroll, make sure nothing looks
   cut off or doubled. Fix in the tool from step 3 if it does.
5. **Build the room (Job B).** In the game press **`E`**:
   - **Walls tab:** outline the room, carve doorways (`K`), set boundaries.
   - **Furniture tab:** search + place each piece to match the preview. Turn on
     **Show Collisions** to check the walking paths.
6. **Save** — press **`X`** on each tab.
7. **Hand off the files** — give the engineer the downloaded
   `openplan_walls_edited.json` and `furniture_catalog_openplan_edited.json`
   (plus any `limezu-labels.json` from the browser). These are the only outputs
   that matter.

### What you produce (the deliverables)

| File | Comes from | What it is |
|------|-----------|------------|
| `data/limezu-labels.json` | LimeZu Sprite Browser | Your names for LimeZu Singles |
| labeled catalog export | Sprite Labeler | Names for Modern Office sheet pieces |
| `furniture_catalog_openplan_edited.json` | Game editor, `X` on Furniture tab | Where every piece of furniture sits |
| `openplan_walls_edited.json` | Game editor, `X` on Walls tab | The walls / boundaries |

Nothing else needs to be touched. If any of these look right in the game, you're
done — the engineer wires them in permanently.

---

## Part 7 — When something looks wrong

| You see… | It means… | Fix |
|----------|-----------|-----|
| Furniture isn't in the editor list | It was never **named** | Name it (Part 3) — Job A before Job B |
| Sprite shows as **stripes / smear** | Cut at the wrong grid size | Re-cut; for LimeZu use the **Single**, never a theme-sheet crop |
| **Magenta** squares on floor/walls | Wrong tile frame number | `tools/tile-inspector.html`, copy correct frame |
| Only **half** an object shows | It's a multi-tile object placed as one tile | Use the bigger Single, or place the matching tiles next to each other |
| Character **walks through** a wall | Missing boundary segment | Walls tab → add a wall there; **Show Collisions** to confirm |
| Desks form an **invisible wall** | Collision boxes too wide | Engineer caps desk collision at 64px — flag it (see [SCENE.md](SCENE.md)) |

For the full diagnosis tree, see **[SPRITE_FIX_GUIDE.md](SPRITE_FIX_GUIDE.md)**.
For *why* LimeZu files behave this way, see
**[LIMEZU_PLACEMENT.md](LIMEZU_PLACEMENT.md)**.

---

## One-paragraph summary (tape this to the monitor)

> Start the server (`npm start`), open **`localhost:8080`**. Press **`E`** to
> open the editor. **Walls tab** = draw the room outline and boundaries (`K`
> cuts doorways, `Delete` removes). **Furniture tab** = search a named item,
> click the floor to place it (double-click to delete). Press **`X`** to save.
> To add a *new* object the game doesn't know yet: LimeZu pieces get named in
> `tools/limezu-sprite-browser.html`; Modern Office pieces get cut in
> `sprite-cutter.html` and named in `sprite-labeler.html`. Copy room layouts
> from the pictures in `assets/limezu/examples/`. Hand the downloaded JSON files
> to the engineer. That's the whole job.
