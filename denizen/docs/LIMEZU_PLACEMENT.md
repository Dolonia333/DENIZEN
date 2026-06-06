# LimeZu — What Each File Is, and How to Place Things

LimeZu does **not** ship a spreadsheet that says “Singles_42 = kotatsu.” The pack is visual. This doc is the placement guide Denizen was missing.

---

## The four file types (do not mix them)

| What LimeZu gives you | Path | Use it for |
|----------------------|------|------------|
| **Room shell** | `room-builder/floors.png`, `walls_3d.png` | Empty room: floor + 3D walls only |
| **Theme atlas** | `themes/japanese.png`, `themes/jail.png` | **Lookup only** — find where a prop lives; never grid-slice blindly |
| **Singles** | `singles/japanese/Japanese_Interiors_Singles_*.png` | Place in game — **one PNG per export**, but size varies (16×16 fragment → 48×48 multi-tile) |
| **Home Design** | `examples/japanese_layer1.png`, `layer2.png`, `preview.png` | **Official layout** — the only file LimeZu made that shows spacing + stacking |

There is **no text manifest** from the artist listing sprite names. `Singles_17` is just the 17th export in their folder, not “chair.”

---

## Why your cuts look wrong

### 1. Auto-cutting a big sheet (`extract_sheet_objects.py`, grid catalogs)

Scripts guess rectangles on `themes/*.png` or `Modern_Office_*.png`. That causes:

- **Neighbor bleed** — rect overlaps the next prop  
- **Cut off** — rect too small (only one connected blob of a multi-part desk)  
- **Grid snap** — `--snap` expands to 16/32 grid and grabs extra pixels  

**Fix:** Stop auto-cutting LimeZu theme atlases for gameplay. Use **Singles** or **manual** rects from `sprite-cutter.html`.

### 2. Treating a 16×16 Single as a full piece of furniture

Many `Japanese_Interiors_Singles_*.png` files are **16×16** or **16×32** — one **tile** of a larger object (corner of a table, half a shoji panel). Placing only that file looks “cut off.”

**Fix:** Check size in the browser (see tool below). If the full object in `themes/japanese.png` spans 2×2 or 3×2 tiles, you need **several** Singles placed relative to each other, or use the **Home Design** composite.

### 3. Wrong variant (Shadow vs Shadowless)

LimeZu ships:

- `Theme_Sorter_Singles` — tighter, less shadow padding  
- `Theme_Sorter_Black_Shadow_Singles` — extra transparent padding for ground shadow  

Mixing them in one room looks misaligned. Pick **one** variant per room.

### 4. Wrong depth / origin

Denizen convention (matches Modern Office catalog):

| Rule | Value |
|------|--------|
| Anchor | **Bottom-center** of the sprite (`origin: "bottom"`) |
| World `(x,y)` | Point on the **floor** where the object stands |
| Depth | Floor `0` → walls `2` → furniture `1.5` → decor on desks `2` → NPCs `2.6+` |
| Y-sort | Taller / lower on screen = drawn on top |

LimeZu **Layer 1** in Home Designs = shell (same as Room Builder).  
**Layer 2** = all furniture on top of that shell — same order as Phaser depth above.

### 5. Spacing

LimeZu rooms are on a **16px grid** (at 16×16 scale). From Home Design previews:

- Walk path: at least **2 tiles** (32px) between facing desks  
- Wall props: sit **1 tile** inside the wall line (on the floor row, not in the wall band)  
- Multi-tile objects: anchor the **bottom-center of the footprint**, not the top-left of the PNG  

There is no magic margin in code — copy spacing from `examples/*_preview.png`.

---

## Official workflow (match the artist)

### Step A — Open the reference room

```
assets/limezu/examples/japanese_preview.png   (finished look)
assets/limezu/examples/japanese_layer1.png  (shell only)
assets/limezu/examples/japanese_layer2.png  (furniture only)
```

Stack layer1 + layer2 mentally: that is **z-order** (shell under props).

### Step B — Identify a prop

1. Open `assets/limezu/themes/japanese.png` in **tile-inspector** (`/tools/tile-inspector.html`).  
2. Find the object visually (kotatsu, shoji, etc.).  
3. Note **how many 16px tiles** it covers (e.g. 2 wide × 2 tall).

### Step C — Find the matching Single(s)

1. Open **limezu-sprite-browser** (`/tools/limezu-sprite-browser.html`).  
2. Filter theme `japanese`, scroll thumbnails until the shape matches.  
3. If one Single is too small, the atlas piece was split — place multiple Singles at offsets `(0,0), (16,0), (0,16)…` or pick a larger export (32×32, 48×48).

### Step D — Label it (you are the naming authority)

LimeZu does not name them for you. In the browser, set:

- **Display name** — `kotatsu_blue`, `shoji_door`  
- **Footprint** — tiles wide × tall (for spacing)  
- **Depth** — usually `1.5`

Save → `data/limezu-labels.json` (human-curated, small).

### Step E — Place in game

```json
{
  "id": "kotatsu_blue",
  "x": 240,
  "y": 200,
  "z_index": 1.5
}
```

Use `source_type: "single_file"` from `furniture_catalog_limezu.json` — **no** `x,y,w,h` crop on a sheet.

---

## What Denizen does *not* know automatically

- `master_furniture_catalog.json` — machine-guessed rects and `ai_name: "x japanese"` — **not trustworthy** for placement.  
- `build_master_catalog.py` — scans old `pixel game stuff` paths; many entries are wrong slices.  
- Filename `Singles_42` — **no semantic meaning**.

Only **you** (or `limezu-labels.json` you fill in) know what a sprite is.

---

## Quick reference — depth stack (16×16 room)

```
depth 0     floor tiles (room-builder)
depth 1     floor shadows (optional)
depth 2     wall shell (room-builder 3D walls)
depth 1.5   large furniture (desks, beds, counters)
depth 2     small decor (plants, monitors on desks)
depth 2.6+  NPCs / player
depth 3+    speech bubbles / UI
```

When two furniture pieces overlap, the one with **larger y** (farther down the screen) gets **higher** depth so it draws in front.

---

## Tools (in order)

| Tool | URL | Purpose |
|------|-----|---------|
| Sprite browser | `/tools/limezu-sprite-browser.html` | See every Single, label it, export JSON |
| Tile inspector | `/tools/tile-inspector.html` | Theme atlas + room-builder frame indices |
| Single preview | `/tools/limezu-single-preview.html` | Test one asset loads correctly |
| Sprite cutter | `/sprite-cutter.html` | Manual rect on **office** sheet only |
| Room preview | `/tools/room-preview.html` | Wall/floor shell only |

---

## Rebuild catalog after labels

```powershell
node scripts/build-limezu-singles-catalog.js
```

Merges `data/limezu-labels.json` into catalog entries as `displayName`, `footprint`, `depth`.

---

## If you want pixel-perfect Japanese / studio / jail rooms

Fastest path: use the **preview PNG** as a static background image in Phaser at the correct world position, add collision boxes by hand, then replace props one-by-one with labeled Singles as you identify them.

That matches LimeZu’s own marketing screenshots exactly while you build the catalog.
