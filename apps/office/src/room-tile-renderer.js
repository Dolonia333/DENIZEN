/**
 * RoomTileRenderer.js
 *
 * Paints a room SHELL (floor + walls) from the LimeZu Modern Interiors
 * "Room Builder" sheets. This is the missing layer that makes rooms feel like
 * rooms — the existing RoomAssembly only places furniture on top.
 *
 * Layer stack (Phaser depth):
 *   floor   →  depth base+0   (filled floor tiles)
 *   shadow  →  depth base+1   (optional base-of-wall shadow)
 *   walls   →  depth base+2   (9-slice 3D wall shell)
 * Furniture from RoomAssembly should sit at depth base+10 and up.
 *
 * Tile indices come from data/room-builder-tiles.json — LimeZu ships no
 * documentation, so those are seed values verified via tools/tile-inspector.html.
 * A missing/out-of-range frame renders as a magenta placeholder rather than
 * crashing, so a wrong index is obvious on screen and easy to fix.
 */

const TILE = 16;

export class RoomTileRenderer {
  /**
   * Register the Room Builder spritesheets with the loader. Call inside the
   * scene's preload(). Safe to call once; keys are namespaced rb_*.
   */
  static preload(scene, base = 'assets/limezu/room-builder') {
    const sheets = {
      rb_floors:   `${base}/floors.png`,
      rb_walls:    `${base}/walls.png`,
      rb_walls_3d: `${base}/walls_3d.png`,
      rb_shadows:  `${base}/floor_shadows.png`,
    };
    for (const [key, path] of Object.entries(sheets)) {
      if (!scene.textures.exists(key)) {
        scene.load.spritesheet(key, path, { frameWidth: TILE, frameHeight: TILE });
      }
    }
  }

  /**
   * @param {Phaser.Scene} scene
   * @param {object} catalog – parsed data/room-builder-tiles.json
   */
  constructor(scene, catalog) {
    this.scene = scene;
    this.cat = catalog || {};
    this._sheetKey = {
      floors: 'rb_floors',
      walls: 'rb_walls',
      walls_3d: 'rb_walls_3d',
      shadows: 'rb_shadows',
    };
    this._placed = [];
  }

  /** Map a logical sheet name from the catalog to a loaded texture key. */
  _key(sheetName) {
    return this._sheetKey[sheetName] || `rb_${sheetName}`;
  }

  /**
   * Place one 16px tile. Falls back to a magenta placeholder square if the
   * frame is missing, so bad indices are visible instead of silently blank.
   *
   * `wide` (optional) hides the 1px navy outline baked onto one side of LimeZu
   * plain-wall tiles: the tile is drawn 1px wider and shifted so it overlaps a
   * neighbour, covering that neighbour's seam. Combined with draw order (depth),
   * navy survives only at the true room edges — matching LimeZu's seamless rooms.
   *   wide = 'left'  → navy on the tile's left  → extend right, keep on top toward left
   *   wide = 'right' → navy on the tile's right → extend left,  keep on top toward right
   */
  _tile(sheetKey, frame, x, y, depth, wide, wideV) {
    let obj;
    const tex = this.scene.textures.get(sheetKey);
    const frameCount = tex ? tex.frameTotal - 1 : 0; // -1: Phaser adds __BASE
    if (!tex || frame == null || frame < 0 || frame >= frameCount) {
      obj = this.scene.add.rectangle(x, y, TILE, TILE, 0xff00ff, 0.6).setOrigin(0, 0);
    } else {
      const dx = wide === 'right' ? -1 : 0;
      // wideV='up' extends the tile 1px upward so it covers the bottom-navy
      // (base-molding) seam of the tile above it when side walls stack.
      const dy = wideV === 'up' ? -1 : 0;
      obj = this.scene.add.image(x + dx, y + dy, sheetKey, frame).setOrigin(0, 0);
      const w = wide ? TILE + 1 : TILE;
      const h = wideV ? TILE + 1 : TILE;
      if (wide || wideV) obj.setDisplaySize(w, h);
    }
    obj.setDepth(depth);
    this._placed.push(obj);
    return obj;
  }

  /**
   * Render a room shell.
   *
   * @param {object} spec
   *   x, y        – top-left world pixel position
   *   cols, rows  – room size in 16px tiles (interior + walls)
   *   roomType    – key into catalog.roomTypes (sets floor+wall), OR…
   *   floor       – explicit floor name (overrides roomType)
   *   wall        – explicit wall-style name (overrides roomType)
   *   doors       – [{ side:'north|south|east|west', offset:tiles, span:tiles }]
   *   depthBase   – base Phaser depth (default 0)
   * @returns {{ floor:object[], walls:object[], doors:object[], bounds:object }}
   */
  renderRoom(spec) {
    const {
      x = 0, y = 0, cols = 12, rows = 8,
      roomType = null, doors = [], depthBase = 0,
    } = spec;

    // Resolve floor + wall style (explicit overrides roomType preset).
    const preset = roomType && this.cat.roomTypes ? this.cat.roomTypes[roomType] : null;
    const floorName = spec.floor || preset?.floor || 'wood_light';
    const wallName  = spec.wall  || preset?.wall  || 'office_white';

    const floorDef = (this.cat.floors || {})[floorName];
    const wallDef  = (this.cat.wallStyles || {})[wallName];

    const floorObjs = [], wallObjs = [];
    const isDoor = this._doorPredicate(doors, cols, rows);

    // ── Floor: fill the whole interior with the single fill tile ──────────
    if (floorDef) {
      const fk = this._key(floorDef.sheet);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          floorObjs.push(this._tile(fk, floorDef.frame, x + c*TILE, y + r*TILE, depthBase));
        }
      }
    }

    // ── Walls: 3D perspective shell from walls_3d.png ─────────────────────
    // The back (top) wall is the hero element: its top row uses `topEdge`
    // (white-above + dark-navy outline + face-top — the LimeZu 3D depth) and
    // the rows below use `face` to give the wall visible height. Left/right
    // side walls and the front (bottom) lip use `face` so the room reads as a
    // 3D box you're looking down into.
    if (wallDef) {
      const wk = this._key(wallDef.sheet || 'walls_3d');
      const topThick = Math.max(1, wallDef.topThick || 3);
      const face = wallDef.face;
      const topEdge = (wallDef.topEdge != null) ? wallDef.topEdge : face;
      const navy = wallDef.navySide || null;   // 'left' | 'right' | null

      // Each face tile is drawn 1px wider to overlap a neighbour and cover that
      // neighbour's 1px navy seam. The COVERING tile must render on top. Phaser
      // containers draw in INSERTION order (depth is unreliable inside them), so
      // we order creation by navy side: keep-left → create right→left (leftmost
      // last = on top); keep-right → create left→right (rightmost last = on top).
      const order = (n) => {
        const cs = [];
        for (let c = 0; c < cols; c++) cs.push(c);
        return navy === 'left' ? cs.reverse() : cs;
      };

      // Back wall: topEdge on row 0, face on the rows beneath (gives height).
      // Face rows (band>=1) use wideV='up' to cover the bottom-navy seam of the
      // row above; created top-to-bottom so lower rows render on top.
      for (let band = 0; band < topThick; band++) {
        const yy = y + band*TILE;
        const frame = band === 0 ? topEdge : face;
        const wv = band >= 1 ? 'up' : null;
        for (const c of order()) {
          if (isDoor('north', c, 0)) continue;
          wallObjs.push(this._tile(wk, frame, x + c*TILE, yy, depthBase + 2 + band, navy, wv));
        }
      }

      // Left & right side walls (between back wall and front lip). Created
      // top-to-bottom so each lower tile renders over the one above; wideV='up'
      // makes it cover that tile's bottom-navy seam. The bottommost tile keeps
      // its base-molding navy where the wall meets the floor.
      const sideBottom = spec.openFront === false ? rows - 1 : rows;
      for (let r = topThick; r < sideBottom; r++) {
        const yy = y + r*TILE;
        if (!isDoor('west', 0, r))      wallObjs.push(this._tile(wk, face, x, yy, depthBase + 2, navy, 'up'));
        if (!isDoor('east', cols-1, r)) wallObjs.push(this._tile(wk, face, x + (cols-1)*TILE, yy, depthBase + 2, navy, 'up'));
      }

      // Front (bottom): LimeZu rooms are OPEN at the front — you look down into
      // them. So no tall wall here. Only draw a front lip when openFront is
      // explicitly disabled (e.g. a fully enclosed room).
      if (spec.openFront === false) {
        const by = y + (rows-1)*TILE;
        for (const c of order()) {
          if (isDoor('south', c, rows-1)) continue;
          wallObjs.push(this._tile(wk, face, x + c*TILE, by, depthBase + 2, navy));
        }
      }
    }

    const bounds = { x, y, w: cols*TILE, h: rows*TILE, cols, rows };
    return { floor: floorObjs, walls: wallObjs, doors: this._doorMarkers(doors, x, y, cols, rows), bounds };
  }

  /** Columns in a loaded sheet (for row-offset math). */
  _sheetCols(key) {
    const tex = this.scene.textures.get(key);
    const src = tex?.getSourceImage?.();
    return src ? Math.floor(src.width / TILE) : 24;
  }

  /** Build a fast predicate: is tile (c,r) on `side` a door gap? */
  _doorPredicate(doors, cols, rows) {
    const set = new Set();
    for (const d of doors) {
      const span = d.span || 1, off = d.offset || 0;
      for (let i = 0; i < span; i++) {
        if (d.side === 'north') set.add(`north:${off+i}:0`);
        else if (d.side === 'south') set.add(`south:${off+i}:${rows-1}`);
        else if (d.side === 'west') set.add(`west:0:${off+i}`);
        else if (d.side === 'east') set.add(`east:${cols-1}:${off+i}`);
      }
    }
    return (side, c, r) => set.has(`${side}:${c}:${r}`);
  }

  /** World-space door rectangles (for NPC pathfinding / spawn anchoring). */
  _doorMarkers(doors, x, y, cols, rows) {
    return doors.map(d => {
      const span = d.span || 1, off = d.offset || 0;
      if (d.side === 'north') return { side:'north', x: x+off*TILE, y, w: span*TILE, h: TILE };
      if (d.side === 'south') return { side:'south', x: x+off*TILE, y: y+(rows-1)*TILE, w: span*TILE, h: TILE };
      if (d.side === 'west')  return { side:'west',  x, y: y+off*TILE, w: TILE, h: span*TILE };
      return { side:'east', x: x+(cols-1)*TILE, y: y+off*TILE, w: TILE, h: span*TILE };
    });
  }

  /**
   * Paint a rectangular floor zone (16px tiles) over an existing shell.
   * Used for per-room floor styles (wood lounge, tile break area, etc.).
   */
  fillFloorZone({ x = 0, y = 0, w = 0, h = 0, floor = 'wood_light', depthBase = 0 }) {
    const floorDef = (this.cat.floors || {})[floor];
    if (!floorDef || w <= 0 || h <= 0) return [];
    const fk = this._key(floorDef.sheet);
    const placed = [];
    const cols = Math.ceil(w / TILE);
    const rows = Math.ceil(h / TILE);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        placed.push(this._tile(fk, floorDef.frame, x + c * TILE, y + r * TILE, depthBase));
      }
    }
    return placed;
  }

  /** Destroy every object this renderer placed. */
  clear() {
    this._placed.forEach(o => { try { o.destroy(); } catch (_) {} });
    this._placed = [];
  }
}

// Browser global for the non-module preview page.
if (typeof window !== 'undefined') window.RoomTileRenderer = RoomTileRenderer;
