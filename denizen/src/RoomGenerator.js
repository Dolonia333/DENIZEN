/**
 * RoomGenerator.js
 *
 * Procedural room generator that uses the furniture catalog to build
 * room templates algorithmically. Output is a standard template object
 * compatible with RoomAssembly.renderRoom().
 *
 * Usage:
 *   const gen = new RoomGenerator(catalogData);
 *   const template = gen.generate({ purpose: 'workspace', occupants: 4, width: 384, height: 320 });
 *   // template = { items: [{id, x, y, instanceId, ...}, ...] }
 *   // Inject into RoomAssembly: assembly.templates['generated_xyz'] = template;
 *   // Then: assembly.renderRoom('generated_xyz', originX, originY);
 */

const CELL = 32; // grid cell size in pixels

// ─── Catalog Intelligence ────────────────────────────────────────────────

/**
 * Group catalog objects by type and build lookup indices.
 * @param {object} objects - furniture_catalog_openplan.json .objects
 * @returns {{ byType, byAction, desks, chairs, deskSetups, plants, whiteboards, all }}
 */
/** Official Modern Office singles — one PNG per object, already cut by LimeZu. */
function isOfficialSingle(def) {
  return def?.source_type === 'single_file'
    && String(def.url_path || '').includes('/modern_office/named/');
}

/**
 * Sheet rectangles in the openplan catalog often bleed into the next cell
 * (a "desk" that is really a wall, a "shelf" that includes a chair). When a
 * category has official singles, use only those.
 */
function preferOfficial(list) {
  const official = (list || []).filter(isOfficialSingle);
  return official.length ? official : (list || []);
}

function buildPalette(objects) {
  const byType = {};
  const byAction = {};
  const all = {};

  for (const [id, def] of Object.entries(objects)) {
    const entry = { id, ...def };
    all[id] = entry;

    const t = def.type || 'unknown';
    if (!byType[t]) byType[t] = [];
    byType[t].push(entry);

    if (def.action) {
      if (!byAction[def.action]) byAction[def.action] = [];
      byAction[def.action].push(entry);
    }
  }

  const furnitureAndDecor = [...(byType.furniture || []), ...(byType.decor || [])];

  // Convenience groups. Official singles win so a generated room never
  // places a rectangle that was sliced across two sprites.
  const desks = preferOfficial(
    (byType.surface || []).filter((e) => (
      isOfficialSingle(e)
        ? /^desk_/.test(e.id) && !/setup|printer|coffee/.test(e.id)
        : e.action === 'use_computer'
    )),
  );
  const chairs = preferOfficial(
    (byType.seat || []).filter((e) => isOfficialSingle(e) || e.action === 'seat'),
  );
  const frontChairs = chairs.filter(e => /front/.test(e.id));
  const backChairs = chairs.filter(e => /back/.test(e.id));
  const sideChairs = chairs.filter(e => /side/.test(e.id));
  const deskSetups = preferOfficial(
    furnitureAndDecor.filter((e) => /desk_setup/.test(e.id)),
  );
  const plants = preferOfficial(furnitureAndDecor.filter(e => /plant/.test(e.id)));
  const whiteboards = preferOfficial(furnitureAndDecor.filter(e => /whiteboard/.test(e.id)));
  const wallDecor = preferOfficial(furnitureAndDecor.filter(e =>
    /wall_ac|cert|cork_board|pop_art|ac_unit/.test(e.id)
  ));
  const sofas = preferOfficial((byType.furniture || []).filter(e => /sofa|corner_sofa/.test(e.id)));
  const vendingMachines = preferOfficial((byType.furniture || []).filter(e => /vending|coffee_machine|mini_fridge|water_dispenser|coffee_barista|water_cooler/.test(e.id)));
  const bookshelves = preferOfficial((byType.furniture || []).filter(e => /bookshelf|shelf_wood/.test(e.id)));
  const tables = preferOfficial((byType.furniture || []).filter(e => /table/.test(e.id) && !/coffee_station/.test(e.id)));
  const partitions = preferOfficial(byType.partition || []);
  const miscFurniture = preferOfficial((byType.furniture || []).filter(e =>
    /trash_can|paper_shredder|printer|stairs/.test(e.id)
  ));

  return {
    byType, byAction, all,
    desks, chairs, frontChairs, backChairs, sideChairs,
    deskSetups, plants, whiteboards, wallDecor,
    sofas, vendingMachines, bookshelves, tables, partitions, miscFurniture
  };
}

// ─── Grid System ─────────────────────────────────────────────────────────

class OccupancyGrid {
  /**
   * @param {number} widthPx  - room width in pixels
   * @param {number} heightPx - room height in pixels
   */
  constructor(widthPx, heightPx) {
    this.cols = Math.ceil(widthPx / CELL);
    this.rows = Math.ceil(heightPx / CELL);
    this.widthPx = this.cols * CELL;
    this.heightPx = this.rows * CELL;
    // 0 = empty, 1 = occupied
    this.cells = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
  }

  /** Check if a rect (in pixels) fits without overlapping occupied cells. */
  canPlace(x, y, w, h) {
    const c0 = Math.floor(x / CELL);
    const r0 = Math.floor(y / CELL);
    const c1 = Math.ceil((x + w) / CELL);
    const r1 = Math.ceil((y + h) / CELL);
    if (c0 < 0 || r0 < 0 || c1 > this.cols || r1 > this.rows) return false;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (this.cells[r][c]) return false;
      }
    }
    return true;
  }

  /** Mark a rect as occupied. */
  occupy(x, y, w, h) {
    const c0 = Math.floor(x / CELL);
    const r0 = Math.floor(y / CELL);
    const c1 = Math.ceil((x + w) / CELL);
    const r1 = Math.ceil((y + h) / CELL);
    for (let r = Math.max(0, r0); r < Math.min(this.rows, r1); r++) {
      for (let c = Math.max(0, c0); c < Math.min(this.cols, c1); c++) {
        this.cells[r][c] = 1;
      }
    }
  }

  /**
   * Find first open position for an item of given pixel size.
   * Scans left-to-right, top-to-bottom at CELL intervals.
   * @param {number} w - item width px
   * @param {number} h - item height px
   * @param {number} [marginCells=0] - extra cells of margin around the item
   * @returns {{ x: number, y: number } | null}
   */
  findSpot(w, h, marginCells = 0) {
    const mPx = marginCells * CELL;
    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c <= this.cols; c++) {
        const px = c * CELL + mPx;
        const py = r * CELL + mPx;
        if (this.canPlace(px, py, w + mPx * 2, h + mPx * 2)) {
          return { x: px, y: py };
        }
      }
    }
    return null;
  }

  /**
   * Find spots along the top edge (wall-adjacent, for whiteboards/certs).
   * @param {number} w - item width px
   * @param {number} h - item height px
   * @returns {{ x: number, y: number } | null}
   */
  findWallSpot(w, h) {
    for (let c = 0; c <= this.cols; c++) {
      const px = c * CELL;
      if (this.canPlace(px, 0, w, h)) {
        return { x: px, y: 0 };
      }
    }
    return null;
  }

  /**
   * Find an empty corner region.
   * @param {number} w - item width px
   * @param {number} h - item height px
   * @returns {{ x: number, y: number } | null}
   */
  findCornerSpot(w, h) {
    // Try four corners: top-left, top-right, bottom-left, bottom-right
    const corners = [
      { x: 0, y: 0 },
      { x: this.widthPx - w, y: 0 },
      { x: 0, y: this.heightPx - h },
      { x: this.widthPx - w, y: this.heightPx - h },
    ];
    for (const pos of corners) {
      if (pos.x >= 0 && pos.y >= 0 && this.canPlace(pos.x, pos.y, w, h)) {
        return pos;
      }
    }
    return null;
  }
}

// ─── Random Helpers ──────────────────────────────────────────────────────

function pick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _idCounter = 0;
function uid(prefix) {
  return `${prefix}_${++_idCounter}`;
}

// ─── Archetype Recipes ──────────────────────────────────────────────────

/**
 * Each archetype returns a function that populates items[] given a palette, grid, and spec.
 * Items use bottom-center origin, so position (x,y) = center-bottom of the sprite.
 * But template coords are top-left relative; RoomAssembly places with setOrigin(0.5, 1).
 * We store x as the center-x offset and y as the bottom-y offset within the room.
 */

function preferId(pool, id) {
  return (pool || []).find((entry) => entry.id === id) || null;
}

/**
 * A back-facing chair is taller than the desk. Only the top of the backrest
 * slides under the desk's front lip; the rest of the chair stays visible
 * in front of the desk. Swallowing the backrest (a 16px tuck on a 46px
 * chair) is what made the seats look pasted into the desktop.
 */
const CHAIR_UNDER = 10;
const CHAIR_H = 46;
const CHAIR_TUCK = CHAIR_H - CHAIR_UNDER;
/** Cubicle panel base hides behind the back edge of the desktop. */
const PANEL_H = 42;
const PANEL_INTO_DESK = 8;
const PANEL_ABOVE = PANEL_H - PANEL_INTO_DESK;
const DESK_H_NOMINAL = 38;
const AISLE = 32;
const DESK_TOP0 = 128;
const ROW_STRIDE = PANEL_ABOVE + DESK_H_NOMINAL + CHAIR_TUCK + AISLE;
const SIDE_MARGIN = CELL * 2;
/** Monitor base sits this far below the desk's top edge, on the desktop. */
const MONITOR_ON_DESK = 8;

/**
 * Drop one catalog sprite using bottom-center coordinates.
 * Returns false when the sprite would leave the room or cover something else.
 */
function placeAnchored(items, grid, def, centerX, bottomY, prefix) {
  if (!def) return false;
  const left = Math.round(centerX - def.w / 2);
  const top = bottomY - def.h;
  if (!grid.canPlace(left, top, def.w, def.h)) return false;
  items.push({
    id: def.id,
    instanceId: uid(prefix || def.id.slice(0, 8)),
    x: Math.round(centerX),
    y: bottomY,
    z_index: def.depth || 1.4
  });
  grid.occupy(left, top, def.w, def.h);
  return true;
}

function placeWorkstations(items, palette, grid, count, options = {}) {
  // Reference bays use the same white desk down the row. The private office
  // uses the light wood desk instead (options.deskId).
  const deskPool = palette.desks
    .filter(d => d.w <= 128 && d.h <= 96)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (deskPool.length === 0) return 0;

  const desk = preferId(deskPool, options.deskId || 'desk_white_wide')
    || preferId(deskPool, 'desk_white_wide')
    || preferId(deskPool, 'desk_tan_wide')
    || deskPool.find((d) => d.w >= 48 && d.w <= 96)
    || deskPool[0];
  // Desk is up-screen. The sitter faces it, so the camera sees the back of
  // the chair. The grey back chair is the dark office chair in this pack.
  // chair_orange_front shows the seat and faces the camera.
  const chairPool = palette.backChairs.length > 0 ? palette.backChairs : palette.chairs;
  const chair = preferId(chairPool, 'chair_grey_back')
    || preferId(chairPool, 'chair_orange_back')
    || chairPool[0]
    || null;
  // Two separate monitors. The combined "desk setup" sprite is as tall as
  // the cubicle panel, so it covers the divider instead of sitting on the desk.
  const monitor = palette.all.monitor_white_on || null;
  const wantDivider = options.divider !== false;
  const divider = wantDivider
    ? (preferId(palette.partitions, 'partition_grey_block')
      || palette.partitions.find((p) => p.w >= 48 && p.w <= 96)
      || null)
    : null;

  const deskW = desk.w;
  const deskH = desk.h;
  const tuck = chair ? Math.max(CHAIR_UNDER, chair.h - CHAIR_UNDER) : 0;
  // Panels the same width as the desk butt into one cubicle wall.
  const slotW = (divider && Math.abs(divider.w - deskW) <= 2)
    ? Math.ceil(deskW / CELL) * CELL
    : (Math.ceil(deskW / CELL) + 1) * CELL;
  const panelAbove = divider ? Math.max(0, divider.h - PANEL_INTO_DESK) : 0;
  const rowStride = panelAbove + deskH + tuck + AISLE;
  // Panel top has to clear the wall-art band (whiteboard / AC on row 0–1).
  const deskTop0 = divider ? Math.max(DESK_TOP0, CELL * 2 + panelAbove) : CELL * 2;
  const monitorOffsetY = -(deskH - MONITOR_ON_DESK);

  let placed = 0;
  let curY = deskTop0;
  const perRow = Math.max(1, Math.floor((grid.widthPx - SIDE_MARGIN * 2) / slotW));

  while (placed < count) {
    let rowPlaced = 0;
    for (let i = 0; i < perRow && placed < count; i++) {
      const deskLeft = SIDE_MARGIN + i * slotW;
      if (deskLeft + deskW > grid.widthPx - SIDE_MARGIN + 1) break;
      if (!grid.canPlace(deskLeft, curY, deskW, deskH + tuck)) continue;

      const cx = deskLeft + Math.floor(deskW / 2);
      const deskId = uid('desk');
      items.push({
        id: desk.id,
        instanceId: deskId,
        x: cx,
        y: curY + deskH,
        z_index: 1.6
      });
      grid.occupy(deskLeft, curY, deskW, deskH);

      if (chair) {
        // Under the desk so the front lip covers the top of the backrest.
        items.push({
          id: chair.id,
          instanceId: uid('chair'),
          x: cx,
          y: curY + deskH + tuck,
          z_index: 1.4
        });
        grid.occupy(
          cx - Math.floor(chair.w / 2),
          curY + deskH,
          chair.w,
          tuck,
        );
      }

      if (monitor) {
        const spread = Math.max(12, Math.round(monitor.w / 2));
        for (const ox of [-spread, spread]) {
          items.push({
            id: monitor.id,
            instanceId: uid('mon'),
            parentInstanceId: deskId,
            parent_offset_x: ox,
            parent_offset_y: monitorOffsetY,
            z_index: 2.2,
            x: 0,
            y: 0
          });
        }
      }

      // Panel stands behind the desktop. Its base tucks behind the desk
      // back edge; depth stays under the desk and the monitors.
      if (divider) {
        const divBottom = curY + PANEL_INTO_DESK;
        const divTop = divBottom - divider.h;
        items.push({
          id: divider.id,
          instanceId: uid('div'),
          x: cx,
          y: divBottom,
          z_index: 1.2
        });
        if (divTop >= 0) grid.occupy(deskLeft, divTop, divider.w, divider.h);
      }

      rowPlaced++;
      placed++;
    }

    if (rowPlaced === 0) break;
    curY += rowStride;
  }
  return placed;
}

/**
 * Wall chart, AC, cooler, and corner plants — the pieces that show up in
 * both reference rooms, placed where the workstation grid left a hole.
 */
function placeReferenceDecor(items, palette, grid) {
  const ac = preferId(palette.wallDecor, 'wall_ac_white');
  const board = preferId(palette.whiteboards, 'whiteboard_line_chart')
    || preferId(palette.whiteboards, 'whiteboard_large')
    || palette.whiteboards.find((w) => w.h <= 36 && !/tray|smudge|marker/.test(w.id));
  const cooler = preferId(palette.vendingMachines, 'water_cooler');
  const leafy = preferId(palette.plants, 'plant_floor_leafy') || palette.plants[0];
  const bushy = preferId(palette.plants, 'plant_floor_bushy') || leafy;

  if (ac) placeAnchored(items, grid, ac, SIDE_MARGIN + Math.floor(ac.w / 2), ac.h, 'ac');
  if (board) {
    const boardX = SIDE_MARGIN + (ac ? ac.w + CELL : 0) + Math.floor(board.w / 2);
    placeAnchored(items, grid, board, boardX, board.h, 'board');
  }

  // Cooler stands in the bottom-right corner, inset past the wall tile,
  // not beside a desk. The old mid-wall spot sat on the first cubicle row.
  if (cooler) {
    const cx = grid.widthPx - 16 - Math.ceil(cooler.w / 2) - 4;
    const bottom = grid.heightPx - 16;
    placeAnchored(items, grid, cooler, cx, bottom, 'cooler');
  }

  const corners = [
    { def: leafy, x: 16 + Math.ceil((leafy?.w || 32) / 2) + 4, y: grid.heightPx - 16 },
  ];
  for (const spot of corners) {
    if (!spot.def) continue;
    placeAnchored(items, grid, spot.def, spot.x, spot.y, 'plant');
  }
}

function placeConferenceLayout(items, palette, grid, chairCount) {
  // Center the conference table
  const table = palette.all['conference_table'];
  if (!table) return;

  const cx = Math.floor(grid.widthPx / 2);
  const cy = Math.floor(grid.heightPx / 2);
  const tblId = uid('conf_tbl');

  items.push({
    id: 'conference_table',
    instanceId: tblId,
    x: cx,
    y: cy + Math.floor(table.h / 2)
  });
  grid.occupy(cx - Math.floor(table.w / 2), cy - Math.floor(table.h / 2), table.w, table.h);

  // Place chairs around the table
  const positions = [];
  const spacing = 80;

  // Chairs above table (back-facing, facing down at table)
  const topY = cy - Math.floor(table.h / 2) - 12;
  // Chairs below table (front-facing, facing up at table)
  const botY = cy + Math.floor(table.h / 2) + 44;
  // Side chairs
  const leftX = cx - Math.floor(table.w / 2) - 36;
  const rightX = cx + Math.floor(table.w / 2) + 36;

  const halfSeats = Math.floor(chairCount / 2);
  const topSpacing = table.w / (halfSeats + 1);
  const botSpacing = table.w / (Math.max(1, chairCount - halfSeats) + 1);

  for (let i = 0; i < halfSeats; i++) {
    const chairX = cx - Math.floor(table.w / 2) + Math.floor(topSpacing * (i + 1));
    positions.push({ x: chairX, y: topY, pool: palette.backChairs.length > 0 ? palette.backChairs : palette.chairs });
  }
  for (let i = 0; i < chairCount - halfSeats; i++) {
    const chairX = cx - Math.floor(table.w / 2) + Math.floor(botSpacing * (i + 1));
    positions.push({ x: chairX, y: botY, pool: palette.frontChairs.length > 0 ? palette.frontChairs : palette.chairs });
  }

  // If 6+ chairs, add side chairs
  if (chairCount >= 6 && palette.sideChairs.length >= 2) {
    const sideLeft = palette.sideChairs.find(c => /left/.test(c.id));
    const sideRight = palette.sideChairs.find(c => /right/.test(c.id));
    if (sideLeft) {
      positions.push({ x: leftX, y: cy, pool: [sideLeft] });
    }
    if (sideRight) {
      positions.push({ x: rightX, y: cy, pool: [sideRight] });
    }
  }

  positions.slice(0, chairCount).forEach(pos => {
    const chair = pick(pos.pool);
    if (chair) {
      items.push({
        id: chair.id,
        instanceId: uid('ch'),
        x: pos.x,
        y: pos.y
      });
    }
  });

  // Place whiteboards along top wall
  const wb = pick(palette.whiteboards);
  if (wb) {
    items.push({
      id: wb.id,
      instanceId: uid('wb'),
      x: cx,
      y: CELL
    });
  }
}

function placeBreakroomLayout(items, palette, grid) {
  let curX = CELL;

  // Vending machines along top wall
  const vendingPool = shuffle(palette.vendingMachines);
  for (let i = 0; i < Math.min(3, vendingPool.length); i++) {
    const v = vendingPool[i];
    if (curX + v.w <= grid.widthPx - CELL) {
      items.push({
        id: v.id,
        instanceId: uid('vend'),
        x: curX + Math.floor(v.w / 2),
        y: CELL + v.h
      });
      grid.occupy(curX, CELL, v.w, v.h);
      curX += v.w + CELL;
    }
  }

  // Sofas along bottom
  const sofaPool = shuffle(palette.sofas);
  let sofaX = CELL;
  const sofaY = grid.heightPx - CELL;
  for (let i = 0; i < Math.min(2, sofaPool.length); i++) {
    const s = sofaPool[i];
    if (sofaX + s.w <= grid.widthPx - CELL) {
      items.push({
        id: s.id,
        instanceId: uid('sofa'),
        x: sofaX + Math.floor(s.w / 2),
        y: sofaY
      });
      grid.occupy(sofaX, sofaY - s.h, s.w, s.h);
      sofaX += s.w + CELL;
    }
  }

  // Small table between sofas
  const tbl = pick(palette.tables);
  if (tbl && sofaX + tbl.w <= grid.widthPx) {
    items.push({
      id: tbl.id,
      instanceId: uid('tbl'),
      x: Math.floor(grid.widthPx / 2),
      y: sofaY - CELL
    });
  }
}

function placeManagerLayout(items, palette, grid) {
  // Desk in upper-center area
  const desk = pick(palette.desks.filter(d => d.w >= 64 && d.w <= 128));
  if (!desk) return;

  const cx = Math.floor(grid.widthPx / 2);
  const deskY = CELL * 4;
  const deskId = uid('mgr_desk');

  items.push({
    id: desk.id,
    instanceId: deskId,
    x: cx,
    y: deskY + desk.h
  });
  grid.occupy(cx - Math.floor(desk.w / 2), deskY, desk.w, desk.h);

  // Chair behind desk
  const chair = pick(palette.chairs.filter(c => /orange|back/.test(c.id))) || pick(palette.chairs);
  if (chair) {
    items.push({
      id: chair.id,
      instanceId: uid('mgr_ch'),
      x: cx,
      y: deskY + desk.h + 56
    });
  }

  // Desk setup on desk
  const setup = pick(palette.deskSetups);
  if (setup) {
    items.push({
      id: setup.id,
      instanceId: uid('mgr_setup'),
      parentInstanceId: deskId,
      x: 0,
      y: 0
    });
  }

  // Bookshelf on left wall
  const shelf = pick(palette.bookshelves);
  if (shelf) {
    items.push({
      id: shelf.id,
      instanceId: uid('mgr_shelf'),
      x: CELL + Math.floor(shelf.w / 2),
      y: CELL * 3 + shelf.h
    });
    grid.occupy(CELL, CELL * 3, shelf.w, shelf.h);
  }

  // Sofa at bottom
  const sofa = pick(palette.sofas);
  if (sofa) {
    items.push({
      id: sofa.id,
      instanceId: uid('mgr_sofa'),
      x: cx,
      y: grid.heightPx - CELL
    });
  }
}

function placeReceptionLayout(items, palette, grid) {
  const cx = Math.floor(grid.widthPx / 2);

  // Reception desk center
  const desk = palette.all['box_desk'] || pick(palette.desks);
  if (desk) {
    const deskId = uid('rc_desk');
    items.push({
      id: desk.id,
      instanceId: deskId,
      x: cx,
      y: CELL * 4 + desk.h
    });
    grid.occupy(cx - Math.floor(desk.w / 2), CELL * 4, desk.w, desk.h);

    const chair = pick(palette.backChairs.length > 0 ? palette.backChairs : palette.chairs);
    if (chair) {
      items.push({
        id: chair.id,
        instanceId: uid('rc_ch'),
        x: cx,
        y: CELL * 4 + desk.h + 48
      });
    }

    const setup = pick(palette.deskSetups);
    if (setup) {
      items.push({
        id: setup.id,
        instanceId: uid('rc_setup'),
        parentInstanceId: deskId,
        x: 0, y: 0
      });
    }
  }

  // Waiting row at bottom
  const waitRow = palette.all['waiting_row_4'];
  if (waitRow) {
    items.push({
      id: 'waiting_row_4',
      instanceId: uid('rc_wait1'),
      x: cx - 80,
      y: grid.heightPx - CELL * 2
    });
    items.push({
      id: 'waiting_row_4',
      instanceId: uid('rc_wait2'),
      x: cx + 80,
      y: grid.heightPx - CELL * 2
    });
  }
}

function placeStorageLayout(items, palette, grid) {
  // Bookshelves along walls
  let curX = CELL;
  const shelfPool = shuffle(palette.bookshelves);
  for (let i = 0; i < Math.min(3, shelfPool.length); i++) {
    const s = shelfPool[i];
    if (curX + s.w <= grid.widthPx - CELL) {
      items.push({
        id: s.id,
        instanceId: uid('st_shelf'),
        x: curX + Math.floor(s.w / 2),
        y: grid.heightPx - CELL
      });
      grid.occupy(curX, grid.heightPx - s.h - CELL, s.w, s.h);
      curX += s.w + CELL;
    }
  }

  // Printer + shredder on one side
  const printer = palette.all['printer_paper'] || pick(palette.miscFurniture.filter(m => /printer/.test(m.id)));
  if (printer) {
    items.push({
      id: printer.id,
      instanceId: uid('st_print'),
      x: CELL + Math.floor(printer.w / 2),
      y: CELL * 3 + printer.h
    });
  }

  const shredder = pick(palette.miscFurniture.filter(m => /shredder/.test(m.id)));
  if (shredder) {
    items.push({
      id: shredder.id,
      instanceId: uid('st_shred'),
      x: CELL * 4 + Math.floor(shredder.w / 2),
      y: CELL * 3 + shredder.h
    });
  }
}

// ─── Decor Pass ──────────────────────────────────────────────────────────

function addDecorPass(items, palette, grid) {
  // Plants in corners
  const plantPool = shuffle(palette.plants);
  let plantIdx = 0;

  const plant = () => plantPool[plantIdx++ % Math.max(1, plantPool.length)];

  // Floor corners only. A plant whose bottom sits on the back wall
  // draws up through the whiteboard.
  const corners = [
    { x: CELL, y: grid.heightPx - CELL },
    { x: grid.widthPx - CELL * 2, y: grid.heightPx - CELL },
    { x: CELL, y: CELL * 5 },
    { x: grid.widthPx - CELL * 2, y: CELL * 5 },
  ];

  for (const pos of corners) {
    if (plantPool.length === 0) break;
    const p = plant();
    if (p && grid.canPlace(pos.x, pos.y - p.h, p.w, p.h)) {
      items.push({
        id: p.id,
        instanceId: uid('plant'),
        x: pos.x + Math.floor(p.w / 2),
        y: pos.y
      });
      grid.occupy(pos.x, pos.y - p.h, p.w, p.h);
    }
  }

  // Wall decor along the top edge. Marker trays and smudge boards are
  // tall desk-height sprites; they cover the cubicle screen.
  const wallPool = shuffle(
    [...palette.whiteboards, ...palette.wallDecor]
      .filter((wd) => wd.h <= 36 && !/tray|smudge/.test(wd.id))
  );
  let wallX = CELL * 2;
  let wallPlaced = 0;
  for (const wd of wallPool) {
    if (wallPlaced >= 3) break;
    if (wallX + wd.w > grid.widthPx - CELL) break;
    if (grid.canPlace(wallX, 0, wd.w, wd.h)) {
      items.push({
        id: wd.id,
        instanceId: uid('wall'),
        x: wallX + Math.floor(wd.w / 2),
        y: wd.h, // bottom-origin, so y = height from top
        z_index: wd.depth || 1.2
      });
      grid.occupy(wallX, 0, wd.w, wd.h);
      wallX += wd.w + CELL;
      wallPlaced++;
    }
  }

  // Trash can near desks if not already placed
  const hasTrash = items.some(i => /trash/.test(i.id));
  if (!hasTrash) {
    // The sheet rect still labeled trash_can is a chair. Only an official
    // single is safe to drop into a generated room.
    const trash = palette.miscFurniture.find((m) => /trash/.test(m.id) && isOfficialSingle(m));
    if (trash) {
      const spot = grid.findSpot(trash.w, trash.h);
      if (spot) {
        items.push({
          id: trash.id,
          instanceId: uid('trash'),
          x: spot.x + Math.floor(trash.w / 2),
          y: spot.y + trash.h
        });
        grid.occupy(spot.x, spot.y, trash.w, trash.h);
      }
    }
  }
}

// ─── Optional: Partition Pass ────────────────────────────────────────────

function addPartitions(items, palette, grid, deskCount) {
  if (deskCount < 4 || palette.partitions.length === 0) return;

  // Try to place dividers between desk rows
  const divider = pick(palette.partitions.filter(p => p.w <= 160));
  if (!divider) return;

  // Place up to 2 dividers at mid-height
  const midY = Math.floor(grid.heightPx / 2);
  for (let pass = 0; pass < 2; pass++) {
    const dx = CELL * 2 + pass * Math.floor(grid.widthPx / 2);
    if (grid.canPlace(dx, midY, divider.w, divider.h)) {
      items.push({
        id: divider.id,
        instanceId: uid('div'),
        x: dx + Math.floor(divider.w / 2),
        y: midY + divider.h,
        z_index: 1.7
      });
      grid.occupy(dx, midY, divider.w, divider.h);
    }
  }
}

/** Width and height for a cubicle bay that can hold `occupants` desks. */
function baySize(occupants) {
  const cols = Math.min(Math.max(occupants, 1), 3);
  const rows = Math.ceil(Math.max(occupants, 1) / cols);
  const slotW = 64;
  const width = SIDE_MARGIN * 2 + cols * slotW;
  const height = DESK_TOP0 + (rows - 1) * ROW_STRIDE + (DESK_H_NOMINAL + CHAIR_TUCK) + SIDE_MARGIN;
  return {
    width: Math.ceil(width / CELL) * CELL,
    height: Math.ceil(height / CELL) * CELL
  };
}

// ─── Main Generator ─────────────────────────────────────────────────────

export class RoomGenerator {
  /**
   * @param {object} catalogData - furniture_catalog_openplan.json (full object with .objects)
   */
  constructor(catalogData) {
    const objects = catalogData?.objects || catalogData || {};
    this.palette = buildPalette(objects);
    this._counter = 0;
  }

  /**
   * Generate a room template.
   * @param {object} spec
   * @param {string} spec.purpose    - 'workspace' | 'conference' | 'breakroom' | 'manager_office' | 'reception' | 'storage'
   * @param {number} [spec.width]    - room width in px (default: auto-sized)
   * @param {number} [spec.height]   - room height in px (default: auto-sized)
   * @param {number} [spec.occupants] - number of NPCs (for workspace/conference)
   * @param {string} [spec.activity]  - primary activity hint
   * @returns {{ description: string, items: Array<object> }}
   */
  generate(spec) {
    const purpose = spec.purpose || 'workspace';
    const occupants = spec.occupants || 4;

    // Auto-size room based on purpose and occupants
    const size = this._autoSize(purpose, occupants, spec.width, spec.height);
    const grid = new OccupancyGrid(size.width, size.height);
    const items = [];

    // Reset ID counter for this generation
    _idCounter = this._counter;

    switch (purpose) {
      case 'workspace':
        placeWorkstations(items, this.palette, grid, occupants);
        break;
      case 'cubicle_bay':
        placeWorkstations(items, this.palette, grid, occupants, { divider: true });
        placeReferenceDecor(items, this.palette, grid);
        break;
      case 'private_office':
        placeWorkstations(items, this.palette, grid, 1, { divider: false, deskId: 'desk_tan_wide' });
        placeReferenceDecor(items, this.palette, grid);
        break;
      case 'conference':
        placeConferenceLayout(items, this.palette, grid, Math.max(4, occupants));
        break;
      case 'breakroom':
        placeBreakroomLayout(items, this.palette, grid);
        break;
      case 'manager_office':
        placeManagerLayout(items, this.palette, grid);
        break;
      case 'reception':
        placeReceptionLayout(items, this.palette, grid);
        break;
      case 'storage':
        placeStorageLayout(items, this.palette, grid);
        break;
      default:
        console.warn(`⚠️ Unknown room purpose: ${purpose}, falling back to workspace`);
        placeWorkstations(items, this.palette, grid, occupants);
        break;
    }

    // Cubicle and private rooms already got the reference decor set.
    // The other archetypes still take the general pass.
    if (purpose !== 'cubicle_bay' && purpose !== 'private_office') {
      addDecorPass(items, this.palette, grid);
    }

    this._counter = _idCounter;

    const template = {
      description: `Generated ${purpose} room (${grid.widthPx}x${grid.heightPx}, ${occupants} occupants)`,
      width: grid.widthPx,
      height: grid.heightPx,
      items
    };

    console.log(`🏗️ Generated '${purpose}' — ${items.length} items in ${grid.widthPx}x${grid.heightPx}px`);
    return template;
  }

  /**
   * Generate and register a room directly into a RoomAssembly instance.
   * @param {RoomAssembly} assembly - initialized RoomAssembly
   * @param {object} spec - same as generate()
   * @param {string} [name] - template name (auto-generated if omitted)
   * @returns {string} the template name
   */
  generateAndRegister(assembly, spec, name) {
    const templateName = name || `gen_${spec.purpose}_${Date.now()}`;
    const template = this.generate(spec);
    assembly.templates[templateName] = template;
    return templateName;
  }

  /** Auto-size a room based on purpose and occupant count. */
  _autoSize(purpose, occupants, userW, userH) {
    if (userW && userH) return { width: userW, height: userH };

    const defaults = {
      workspace: {
        width: Math.max(384, Math.ceil(occupants / 2) * 192),
        height: Math.max(384, Math.ceil(occupants / 2) * 192 + 128)
      },
      cubicle_bay: baySize(occupants),
      private_office: { width: 384, height: 288 },
      conference: { width: 384, height: 320 },
      breakroom: { width: 384, height: 288 },
      manager_office: { width: 320, height: 288 },
      reception: { width: 384, height: 320 },
      storage: { width: 320, height: 256 }
    };

    const d = defaults[purpose] || defaults.workspace;
    return {
      width: userW || d.width,
      height: userH || d.height
    };
  }
}

// Also export for CommonJS / test usage
export default RoomGenerator;
