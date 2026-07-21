/**
 * Openplan wall layout — render, serialize, and editor helpers.
 * Top-down wall illusion: horizontal bands get trim on top; vertical sides get trim on the back edge.
 */
(function () {
  const T = 32;
  const MIN_LEN = 32;
  const TRIM = 0x3a3a50;
  const TRIM_HI = 0xc3d0e6;
  const SHADOW = 0x9a9ab0;
  const TRIM_H = 8;
  const TRIM_W = 8;
  const BAND_H = T * 2;

  function snap(v, on) {
    return on ? Math.round(v / 4) * 4 : Math.round(v);
  }

  // Wall visuals stay behind furniture/characters (Y-sort starts ~10).
  const WALL_FACE_DEPTH = 1.0;
  const WALL_SHADOW_DEPTH = 1.05;
  const WALL_TRIM_DEPTH = 1.2;
  const WALL_TRIM_HI_DEPTH = 1.25;
  const WALL_CORNER_TRIM_DEPTH = 1.3;

  const CAP = 9;
  const WHITE = 0xfdfdfd;
  const VOID = 0x1e1e2e;

  // ── LimeZu wall BLOCKS (Room_Builder_Office_32x32.png) ────────────────
  // Walls are 9-slice BLOCKS, not tiles: [left edge][middle...][right edge]
  // columns whose cap, navy outline, and face are ONE continuous painting.
  // Composing from rectangles or a tiled 32px strip creates seams — instead
  // each segment bakes ONE canvas texture from the block columns.
  // Anatomy per column (64px block): 32px cap row (navy 2 / white 8 /
  // navy 2 / face start) + 32px face row whose BOTTOM 2px are the block's
  // closing navy border. The repeatable face region is therefore 30px —
  // repeating the full row would leak the border into the wall as a line.
  // Mirrors tools/office-wall-kit.py + data/office-wall-kit.json.
  // Pixel-measured from Office_Design_1/2 (3-agent scan, native 16px scale
  // doubled to ours): faced H walls are EXACTLY 2 tile rows — cap row +
  // one face row = 64px. No repeat row (the earlier 94px walls were the
  // "too thick" defect). South/map-edge walls are cap-only. Interior V
  // walls are a 32px SOLID WHITE slab (2px navy/28 white/2 navy — no dark
  // core); exterior V walls a 14px ribbon (2/10/2) against the void.
  const BLOCK = {
    white: { y: 352 },
    brick: { y: 288 },
  };
  const BLOCK_COLS = { left: 0, mid: 32, right: 64, single: 96 };
  const CAP_ROW = 32;
  const FACE_ROW = 32;

  function buildHSegTexture(scene, w, style) {
    const key = `wallseg_${style}_${Math.round(w)}`;
    if (scene.textures.exists(key)) return key;
    const src = scene.textures.get('room_builder')?.getSourceImage();
    if (!src) return null;
    const spec = BLOCK[style] || BLOCK.white;
    const by = spec.y;
    // Exactly the 2-row block = 64px = BAND_H — visuals equal collision.
    const texH = CAP_ROW + FACE_ROW;
    const t = scene.textures.createCanvas(key, Math.round(w), texH);
    const ctx = t.context;
    ctx.imageSmoothingEnabled = false;
    const n = Math.max(1, Math.ceil(w / T));
    const drawCol = (sx, dx, colW) => {
      ctx.drawImage(src, sx, by, colW, CAP_ROW, dx, 0, colW, CAP_ROW);
      ctx.drawImage(src, sx, by + CAP_ROW, colW, FACE_ROW, dx, CAP_ROW, colW, FACE_ROW);
    };
    if (n === 1) {
      drawCol(BLOCK_COLS.single, 0, Math.min(T, w));
    } else {
      for (let i = 1; i < n - 1; i++) drawCol(BLOCK_COLS.mid, i * T, T);
      drawCol(BLOCK_COLS.left, 0, T);
      drawCol(BLOCK_COLS.right, Math.round(w) - T, T); // flush right, over mid
    }
    t.refresh();
    return key;
  }

  /** Horizontal back trim — kept for API compat; new style draws caps in drawHWall. */
  function drawTopTrim(scene, cx, topY, width, face) {
    return [
      scene.add.rectangle(cx, topY + CAP / 2, width, CAP, WHITE, 1).setDepth(WALL_TRIM_DEPTH),
    ];
  }

  /** Doorway end cap — white edge down the full face where an H-wall stops. */
  function drawEntryCutH(scene, x, y) {
    const h = BAND_H + FACE_OVERHANG;
    return [
      scene.add.rectangle(x, y + h / 2, 3, h, WHITE, 1).setDepth(WALL_CORNER_TRIM_DEPTH),
    ];
  }

  function resolveFaceKeys(face) {
    if (face === 'brick' || face === 'wall_face_brick') {
      return { h: 'wall_face_brick', v: 'wall_face_brick' };
    }
    return { h: 'wall_face', v: 'wall_face_v' };
  }

  /** Split [startX,endX] by gap ranges → kept sub-ranges. */
  function splitByGaps(startX, endX, gaps) {
    const gs = (gaps || [])
      .map((g) => [Math.max(startX, g[0]), Math.min(endX, g[1])])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    const out = [];
    let cursor = startX;
    for (const [g0, g1] of gs) {
      if (g0 > cursor) out.push([cursor, g0]);
      cursor = Math.max(cursor, g1);
    }
    if (endX > cursor) out.push([cursor, endX]);
    return out;
  }

  // Cap-only strip (navy/white/navy, 12px) — keeps the top ribbon flowing
  // continuously across face gaps where a dividing wall slices through
  // (Office_Design_1: the cap never breaks at junctions; the FACE does).
  const CAP_STRIP_H = 12;
  function buildCapTexture(scene, w, style) {
    const key = `wallcap_${style}_${Math.round(w)}`;
    if (scene.textures.exists(key)) return key;
    const src = scene.textures.get('room_builder')?.getSourceImage();
    if (!src) return null;
    const by = (BLOCK[style] || BLOCK.white).y;
    const t = scene.textures.createCanvas(key, Math.round(w), CAP_STRIP_H);
    const ctx = t.context;
    ctx.imageSmoothingEnabled = false;
    for (let dx = 0; dx < w; dx += T) {
      ctx.drawImage(src, BLOCK_COLS.mid, by, Math.min(T, w - dx), CAP_STRIP_H, dx, 0, Math.min(T, w - dx), CAP_STRIP_H);
    }
    t.refresh();
    return key;
  }

  function drawHWallWithGaps(scene, startX, y, endX, doorGaps, obstacles, face, faceGaps) {
    const all = [];
    const brick = face === 'brick' || face === 'wall_face_brick';
    const style = brick ? 'brick' : 'white';
    // South/map-edge walls show CAP ONLY (the face would look away from
    // camera) with void beneath — measured 6px native cap over black.
    const worldH = scene._wallWorldH || 720;
    const southExterior = y + BAND_H >= worldH;
    // VISUALS split by door gaps AND face gaps (dividing walls slicing
    // through) — every kept piece is a full block with baked edge borders.
    const allGaps = [...(doorGaps || []), ...(faceGaps || [])];
    for (const [a, b] of splitByGaps(startX, endX, allGaps)) {
      if (b - a < 8) continue;
      if (southExterior) {
        const capKey = buildCapTexture(scene, b - a, style);
        if (capKey) all.push(scene.add.image(a, y, capKey).setOrigin(0, 0).setDepth(WALL_TRIM_DEPTH));
        all.push(scene.add.rectangle(a + (b - a) / 2, y + CAP_STRIP_H + (worldH - y - CAP_STRIP_H) / 2, b - a, worldH - y - CAP_STRIP_H, VOID, 1).setDepth(WALL_FACE_DEPTH));
        continue;
      }
      const texKey = buildHSegTexture(scene, b - a, style);
      if (texKey) all.push(scene.add.image(a, y, texKey).setOrigin(0, 0).setDepth(WALL_FACE_DEPTH));
    }
    // Cap ribbon stays continuous across FACE gaps only (not door gaps)
    for (const [a, b] of (faceGaps || [])) {
      const ga = Math.max(startX, a), gb = Math.min(endX, b);
      if (gb - ga < 4) continue;
      const capKey = buildCapTexture(scene, gb - ga, style);
      if (capKey) all.push(scene.add.image(ga, y, capKey).setOrigin(0, 0).setDepth(WALL_TRIM_DEPTH));
    }
    // COLLISION split by door gaps only — face gaps stay blocked (the
    // dividing wall's own body occupies them).
    for (const [a, b] of splitByGaps(startX, endX, doorGaps || [])) {
      if (b - a < T) continue;
      const obs = scene.add.rectangle(a + (b - a) / 2, y + T, b - a, BAND_H, 0x000000, 0);
      scene.physics.add.existing(obs, true);
      obstacles.push(obs);
      all.push(obs);
    }
    return all;
  }

  function drawVWallWithGaps(scene, x, startY, endY, doorGaps, shadowSide, obstacles) {
    const y0 = Math.min(startY, endY);
    const y1 = Math.max(startY, endY);
    const gaps = (doorGaps || [])
      .map((g) => [Math.max(y0, g[0]), Math.min(y1, g[1])])
      .filter(([a, b]) => b - a >= T)
      .sort((a, b) => a[0] - b[0]);
    let cursor = y0;
    const all = [];
    for (const [gy0, gy1] of gaps) {
      if (gy0 > cursor) {
        all.push(...drawVWall(scene, x, cursor, gy0, shadowSide, obstacles, {
          topCut: cursor > y0,
          bottomCut: true,
        }));
      }
      cursor = gy1;
    }
    if (y1 > cursor) {
      all.push(...drawVWall(scene, x, cursor, y1, shadowSide, obstacles, {
        topCut: cursor > y0,
        bottomCut: false,
      }));
    }
    return all;
  }

  function drawHWall(scene, startX, y, endX, obstacles, face, cuts) {
    const w = endX - startX;
    if (w <= 0) return [];
    const objs = [];
    const brick = face === 'brick' || face === 'wall_face_brick';
    // ONE baked image per segment, composed from the official wall block
    // columns — continuous art, no seams, edge columns close each end
    // (including the ends created by door gaps).
    const texKey = buildHSegTexture(scene, w, brick ? 'brick' : 'white');
    if (texKey) {
      objs.push(scene.add.image(startX, y, texKey).setOrigin(0, 0).setDepth(WALL_FACE_DEPTH));
    }
    // GIF entryway cuts — dark vertical edge where wall stops at a doorway
    // Door-gap ends need no extra cap: the block's left/right edge columns
    // already close every segment end with the official outline art.
    const obs = scene.add.rectangle(startX + w / 2, y + T, w, BAND_H, 0x000000, 0);
    scene.physics.add.existing(obs, true);
    obstacles.push(obs);
    objs.push(obs);
    return objs;
  }

  function drawVWall(scene, x, startY, endY, shadowSide, obstacles, cuts) {
    const y0 = Math.min(startY, endY);
    const y1 = Math.max(startY, endY);
    const h = y1 - y0;
    if (h <= 0) return [];
    const objs = [];
    // Website-example look: white caps on both room-facing sides, dark
    // void between (wall body). Caps 8px, void fills the rest of T=32.
    // Junction rule (Office_Design_1): a V wall meeting an H wall flows
    // down FROM the cap line — the H face is sliced at this x (renderLayout
    // face gaps), so the V extends UP through the face zone to just below
    // the continuous cap ribbon. Collision keeps the original extent.
    let vy0 = y0;
    (scene._wallHBands || []).forEach((b) => {
      if (y0 >= b.y && y0 <= b.y + BAND_H && x + T > b.x0 && x < b.x1) {
        vy0 = b.y + CAP_STRIP_H;
      }
    });
    const vh = y1 - vy0;
    const NAVY = TRIM;
    const worldW = scene._wallWorldW || 1280;
    const exterior = x <= 0 || x + T >= worldW;
    if (vh > 0) {
      if (exterior) {
        // Map-edge vertical: thin 14px ribbon (2 navy / 10 white / 2 navy)
        // on the room side, void filling the rest of the lane (measured
        // 7px native against black).
        const rx = x <= 0 ? x + T - 14 : x;
        const vxOther = x <= 0 ? x : x + 14;
        objs.push(scene.add.rectangle(vxOther + (T - 14) / 2, vy0 + vh / 2, T - 14, vh, VOID, 1).setDepth(WALL_FACE_DEPTH));
        objs.push(scene.add.rectangle(rx + 1, vy0 + vh / 2, 2, vh, NAVY, 1).setDepth(WALL_TRIM_DEPTH));
        objs.push(scene.add.rectangle(rx + 7, vy0 + vh / 2, 10, vh, WHITE, 1).setDepth(WALL_TRIM_DEPTH));
        objs.push(scene.add.rectangle(rx + 13, vy0 + vh / 2, 2, vh, NAVY, 1).setDepth(WALL_TRIM_DEPTH));
      } else {
        // Interior dividing wall: SOLID WHITE slab, one tile thick —
        // 2px navy / 28px white / 2px navy. No dark core (measured).
        objs.push(scene.add.rectangle(x + 1, vy0 + vh / 2, 2, vh, NAVY, 1).setDepth(WALL_TRIM_DEPTH));
        objs.push(scene.add.rectangle(x + T / 2, vy0 + vh / 2, T - 4, vh, WHITE, 1).setDepth(WALL_TRIM_DEPTH));
        objs.push(scene.add.rectangle(x + T - 1, vy0 + vh / 2, 2, vh, NAVY, 1).setDepth(WALL_TRIM_DEPTH));
      }
    }
    // Doorway end caps — white edge across the wall thickness
    if (cuts?.topCut) {
      objs.push(scene.add.rectangle(x + T / 2, y0 + 1.5, T, 3, WHITE, 1).setDepth(WALL_CORNER_TRIM_DEPTH));
    }
    if (cuts?.bottomCut) {
      objs.push(scene.add.rectangle(x + T / 2, y1 - 1.5, T, 3, WHITE, 1).setDepth(WALL_CORNER_TRIM_DEPTH));
    }
    const obs = scene.add.rectangle(x + T / 2, y0 + h / 2, T, h, 0x000000, 0);
    scene.physics.add.existing(obs, true);
    obstacles.push(obs);
    objs.push(obs);
    return objs;
  }

  function drawBoxCorner(scene, x, y, role, obstacles) {
    const objs = [];
    const trimLeft = role === 'tl' || role === 'bl';
    const trimRight = role === 'tr' || role === 'br';

    // Corners draw NOTHING in the example style: H faces run continuously
    // and V walls join them below the face — stamping a corner block onto
    // the painted face is exactly the seam the examples never have. The
    // corner keeps only its collision body.
    const obs = scene.add.rectangle(x + T / 2, y + T, T, BAND_H, 0x000000, 0);
    scene.physics.add.existing(obs, true);
    obstacles.push(obs);
    objs.push(obs);
    return objs;
  }

  function drawTJunction(scene, x, y, obstacles) {
    // Procedural join — never use RB white outline sprites (look like random L-blocks)
    const objs = [];
    const edgeW = 3;
    const faceW = T - edgeW * 2;
    objs.push(...drawTopTrim(scene, x + T / 2, y, T));
    objs.push(scene.add.rectangle(x + edgeW / 2, y + BAND_H / 2, edgeW, BAND_H, TRIM, 1).setDepth(WALL_TRIM_DEPTH));
    objs.push(scene.add.rectangle(x + T - edgeW / 2, y + BAND_H / 2, edgeW, BAND_H, TRIM, 1).setDepth(WALL_TRIM_DEPTH));
    const faceH = BAND_H - TRIM_H;
    objs.push(scene.add.tileSprite(x + T / 2, y + TRIM_H + faceH / 2, faceW, faceH, 'wall_face').setDepth(WALL_FACE_DEPTH));
    const obs = scene.add.rectangle(x + T / 2, y + T, T, BAND_H, 0x000000, 0);
    scene.physics.add.existing(obs, true);
    if (obstacles?.push) obstacles.push(obs);
    else if (obstacles?.add) obstacles.add(obs);
    objs.push(obs);
    return objs;
  }

  function segmentBounds(seg) {
    if (seg.type === 'h') {
      const w = Math.max(0, seg.endX - seg.startX);
      return { x: seg.startX, y: seg.y, w, h: T * 2, cx: seg.startX + w / 2, cy: seg.y + T };
    }
    if (seg.type === 'v') {
      const y0 = Math.min(seg.startY, seg.endY);
      const y1 = Math.max(seg.startY, seg.endY);
      const h = Math.max(0, y1 - y0);
      return { x: seg.x, y: y0, w: T, h, cx: seg.x + T / 2, cy: y0 + h / 2 };
    }
    if (seg.type === 'corner' || seg.type === 'tjunction') {
      return { x: seg.x, y: seg.y, w: T, h: T * 2, cx: seg.x + T / 2, cy: seg.y + T };
    }
    return { x: 0, y: 0, w: T, h: T, cx: 0, cy: 0 };
  }

  function renderSegment(scene, seg, obstacles) {
    const data = { ...seg };
    const face = data.face || null;
    let visuals = [];
    if (data.type === 'h') {
      visuals = drawHWallWithGaps(
        scene, data.startX, data.y, data.endX,
        data.doorGaps || [], obstacles, face, data.__faceGaps || []
      );
    } else if (data.type === 'v') {
      if (Array.isArray(data.doorGaps) && data.doorGaps.length) {
        visuals = drawVWallWithGaps(scene, data.x, data.startY, data.endY, data.doorGaps, data.shadowSide || 'right', obstacles);
      } else {
        visuals = drawVWall(scene, data.x, data.startY, data.endY, data.shadowSide || 'right', obstacles);
      }
    } else if (data.type === 'corner') {
      visuals = drawBoxCorner(scene, data.x, data.y, data.role || 'tr', obstacles);
    } else if (data.type === 'tjunction') {
      visuals = drawTJunction(scene, data.x, data.y, obstacles);
    }
    const bounds = segmentBounds(data);
    const hit = scene.add.rectangle(bounds.cx, bounds.cy, Math.max(bounds.w, 8), Math.max(bounds.h, 8), 0x4ade80, 0);
    hit.setDepth(50);
    return {
      instanceId: data.instanceId,
      data,
      visuals,
      hit,
      handles: [],
      obstacle: visuals.find((o) => o.body && o.body.immovable) || null,
    };
  }

  function destroySegment(scene, entry) {
    if (!entry) return;
    entry.handles.forEach((h) => h.destroy());
    entry.handles = [];
    if (entry.hit) entry.hit.destroy();
    entry.visuals.forEach((v) => {
      if (v?.body?.immovable) {
        if (Array.isArray(scene._obstacles)) {
          const idx = scene._obstacles.indexOf(v);
          if (idx >= 0) scene._obstacles.splice(idx, 1);
        }
        try { scene.obstacles?.remove?.(v, true, true); } catch (_) {}
      }
      try { v.destroy(); } catch (_) {}
    });
    entry.visuals = [];
    entry.obstacle = null;
  }

  function renderLayout(scene, layout, obstacles) {
    if (!Array.isArray(scene._wallSegments)) scene._wallSegments = [];
    scene._wallSegments.forEach((e) => destroySegment(scene, e));
    scene._wallSegments = [];
    const segments = Array.isArray(layout?.segments) ? layout.segments : [];
    scene._wallWorldW = layout?.info?.worldSize?.w || 1280;
    scene._wallWorldH = layout?.info?.worldSize?.h || 720;
    // Junction model from Office_Design_1: a dividing wall SLICES THROUGH
    // the horizontal wall it meets — the H face breaks into per-room
    // segments (each closed by its baked edge border) while the cap ribbon
    // stays continuous, and the V wall flows down from the cap line.
    scene._wallHBands = segments
      .filter((s) => s.type === 'h')
      .map((s) => ({
        y: s.y,
        x0: Math.min(s.startX, s.endX),
        x1: Math.max(s.startX, s.endX),
        brick: s.face === 'brick' || s.face === 'wall_face_brick',
      }));
    const vSegs = segments.filter((s) => s.type === 'v');
    segments.forEach((seg) => {
      let seg2 = seg;
      if (seg.type === 'h') {
        const x0 = Math.min(seg.startX, seg.endX);
        const x1 = Math.max(seg.startX, seg.endX);
        const faceGaps = vSegs
          .filter((v) => {
            const vy0 = Math.min(v.startY, v.endY);
            const vy1 = Math.max(v.startY, v.endY);
            const crosses = vy0 <= seg.y + BAND_H && vy1 >= seg.y + T;
            return crosses && v.x + T > x0 && v.x < x1;
          })
          .map((v) => [v.x, v.x + T]);
        if (faceGaps.length) seg2 = { ...seg, __faceGaps: faceGaps };
      }
      scene._wallSegments.push(renderSegment(scene, seg2, obstacles));
    });
    syncAutoCorners(scene, obstacles);
    return scene._wallSegments;
  }

  function replaceSegment(scene, instanceId, newData, obstacles) {
    const idx = scene._wallSegments.findIndex((e) => e.instanceId === instanceId);
    if (idx < 0) return null;
    const old = scene._wallSegments[idx];
    destroySegment(scene, old);
    const entry = renderSegment(scene, { ...old.data, ...newData, instanceId }, obstacles);
    scene._wallSegments[idx] = entry;
    return entry;
  }

  function removeSegment(scene, instanceId, obstacles) {
    const idx = scene._wallSegments.findIndex((e) => e.instanceId === instanceId);
    if (idx < 0) return false;
    destroySegment(scene, scene._wallSegments[idx]);
    scene._wallSegments.splice(idx, 1);
    return true;
  }

  function layoutFromScene(scene, info) {
    const segments = (scene._wallSegments || []).map((e) => {
      const d = { ...e.data };
      delete d._comment;
      return d;
    });
    return { info: info || {}, segments };
  }

  function splitSegment(seg, worldX, worldY) {
    if (seg.type === 'h') {
      const cut = Math.round(worldX);
      if (cut <= seg.startX + MIN_LEN || cut >= seg.endX - MIN_LEN) return null;
      const a = { ...seg, instanceId: `${seg.instanceId}_a_${Date.now()}`, endX: cut };
      const b = { ...seg, instanceId: `${seg.instanceId}_b_${Date.now()}`, startX: cut };
      return [a, b];
    }
    if (seg.type === 'v') {
      const cut = Math.round(worldY);
      if (cut <= seg.startY + MIN_LEN || cut >= seg.endY - MIN_LEN) return null;
      const a = { ...seg, instanceId: `${seg.instanceId}_a_${Date.now()}`, endY: cut };
      const b = { ...seg, instanceId: `${seg.instanceId}_b_${Date.now()}`, startY: cut };
      return [a, b];
    }
    return null;
  }

  function duplicateSegment(seg, offset = 32) {
    const copy = JSON.parse(JSON.stringify(seg));
    copy.instanceId = `${seg.instanceId || seg.type}_copy_${Date.now()}`;
    if (copy.type === 'h') {
      copy.startX += offset;
      copy.endX += offset;
      copy.y += offset;
    } else if (copy.type === 'v') {
      copy.x += offset;
      copy.startY += offset;
      copy.endY += offset;
    } else {
      copy.x += offset;
      copy.y += offset;
    }
    return copy;
  }

  function defaultSegment(type, worldX, worldY, snapOn = true) {
    const id = `wall_new_${Date.now()}`;
    const x = snap(worldX, snapOn);
    const y = snap(worldY, snapOn);
    if (type === 'h' || type === 'band') {
      // y = top edge of wall band (dark trim at y+4, light blue face below)
      return { instanceId: id, type: 'h', startX: x - 96, y, endX: x + 96 };
    }
    if (type === 'v' || type === 'face') {
      return { instanceId: id, type: 'v', x, startY: y, endY: y + 192, shadowSide: 'right' };
    }
    if (type === 'corner') {
      return { instanceId: id, type: 'corner', x, y, role: 'tr' };
    }
    if (type === 'tjunction') {
      return { instanceId: id, type: 'tjunction', x, y, side: 'right' };
    }
    return { instanceId: id, type: 'h', startX: x - 96, y, endX: x + 96 };
  }

  function lCornerFromDrag(ax, ay, bx, by) {
    const right = bx >= ax;
    const down = by >= ay;
    if (right && down) return { x: ax, y: ay, role: 'tl', shadowSide: 'right' };
    if (!right && down) return { x: ax - T, y: ay, role: 'tr', shadowSide: 'left' };
    if (right && !down) return { x: ax, y: ay, role: 'bl', shadowSide: 'right' };
    return { x: ax - T, y: ay, role: 'br', shadowSide: 'left' };
  }

  /** Build wall segment(s) from a click-drag (H, V, or L when both axes exceed MIN_LEN). */
  function segmentsFromDrag(x0, y0, x1, y1, snapOn = true) {
    const ax = snap(x0, snapOn);
    const ay = snap(y0, snapOn);
    const bx = snap(x1, snapOn);
    const by = snap(y1, snapOn);
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    const id = `wall_new_${Date.now()}`;
    if (dx < MIN_LEN && dy < MIN_LEN) return [];

    if (dx >= MIN_LEN && dy >= MIN_LEN) {
      const hStart = Math.min(ax, bx);
      const hEnd = Math.max(ax, bx);
      const vTop = Math.min(ay, by);
      const vBot = Math.max(ay, by);
      const corner = lCornerFromDrag(ax, ay, bx, by);
      return [
        { instanceId: `${id}_h`, type: 'h', startX: hStart, endX: hEnd, y: ay, label: 'Wall band' },
        {
          instanceId: `${id}_v`,
          type: 'v',
          x: ax,
          startY: vTop,
          endY: vBot,
          shadowSide: corner.shadowSide,
          label: 'Wall side',
        },
        {
          instanceId: `${id}_c`,
          type: 'corner',
          x: corner.x,
          y: corner.y,
          role: corner.role,
          label: 'Corner L',
        },
      ];
    }

    if (dx >= dy) {
      const startX = Math.min(ax, bx);
      const endX = Math.max(ax, bx);
      if (endX - startX < MIN_LEN) return [];
      const y = Math.min(ay, by);
      return [{ instanceId: id, type: 'h', startX, endX, y, label: 'Wall band' }];
    }

    const x = Math.min(ax, bx);
    const startY = Math.min(ay, by);
    const endY = Math.max(ay, by);
    if (endY - startY < MIN_LEN) return [];
    return [{ instanceId: id, type: 'v', x, startY, endY, shadowSide: 'right', label: 'Wall side' }];
  }

  function segmentFromDrag(x0, y0, x1, y1, snapOn = true) {
    const segs = segmentsFromDrag(x0, y0, x1, y1, snapOn);
    return segs.length ? segs[0] : null;
  }

  function drawSinglePreview(scene, seg, alpha = 0.45) {
    const objs = [];
    if (!seg) return objs;
    if (seg.type === 'h') {
      const w = seg.endX - seg.startX;
      if (w <= 0) return objs;
      objs.push(scene.add.rectangle(seg.startX + w / 2, seg.y + TRIM_H / 2, w, TRIM_H, TRIM, alpha).setDepth(70));
      const faceH = BAND_H - TRIM_H;
      objs.push(scene.add.rectangle(seg.startX + w / 2, seg.y + TRIM_H + faceH / 2, w, faceH, 0xc3d0e6, alpha).setDepth(70));
    } else if (seg.type === 'v') {
      const y0 = Math.min(seg.startY, seg.endY);
      const y1 = Math.max(seg.startY, seg.endY);
      const h = y1 - y0;
      if (h <= 0) return objs;
      const edgeW = 3;
      const faceW = T - edgeW * 2;
      objs.push(scene.add.rectangle(seg.x + edgeW / 2, y0 + h / 2, edgeW, h, TRIM, alpha).setDepth(70));
      objs.push(scene.add.rectangle(seg.x + T - edgeW / 2, y0 + h / 2, edgeW, h, TRIM, alpha).setDepth(70));
      objs.push(scene.add.rectangle(seg.x + T / 2, y0 + h / 2, faceW, h, 0xc3d0e6, alpha).setDepth(70));
    } else if (seg.type === 'corner' || seg.type === 'tjunction') {
      const trimLeft = seg.type === 'tjunction' || seg.role === 'tl' || seg.role === 'bl';
      const trimRight = seg.type === 'tjunction' || seg.role === 'tr' || seg.role === 'br';
      objs.push(scene.add.rectangle(seg.x + T / 2, seg.y + TRIM_H / 2, T, TRIM_H, TRIM, alpha).setDepth(70));
      if (trimLeft) {
        objs.push(scene.add.rectangle(seg.x + 1.5, seg.y + BAND_H / 2, 3, BAND_H, TRIM, alpha).setDepth(70));
      }
      if (trimRight) {
        objs.push(scene.add.rectangle(seg.x + T - 1.5, seg.y + BAND_H / 2, 3, BAND_H, TRIM, alpha).setDepth(70));
      }
      const faceH = BAND_H - TRIM_H;
      objs.push(scene.add.rectangle(seg.x + T / 2, seg.y + TRIM_H + faceH / 2, T - 6, faceH, 0xc3d0e6, alpha).setDepth(70));
    }
    return objs;
  }

  function drawPreviewBand(scene, segOrSegs, alpha = 0.45) {
    const segs = Array.isArray(segOrSegs) ? segOrSegs : (segOrSegs ? [segOrSegs] : []);
    return segs.flatMap((seg) => drawSinglePreview(scene, seg, alpha));
  }

  function destroyPreview(objs) {
    (objs || []).forEach((o) => o.destroy());
  }

  function near(a, b, tol = 10) {
    return Math.abs(a - b) <= tol;
  }

  function cornerKey(x, y) {
    return `${Math.round(x / 4) * 4},${Math.round(y / 4) * 4}`;
  }

  /** When a wall band meets a side wall, spawn an L-corner with trim banner. */
  function syncAutoCorners(scene, obstacles) {
    if (!Array.isArray(scene._wallSegments)) return;

    const autoIds = scene._wallSegments
      .filter((e) => e.data.auto || e.data.instanceId?.startsWith('wall_auto_corner_'))
      .map((e) => e.instanceId);
    autoIds.forEach((id) => removeSegment(scene, id, obstacles));

    const hs = scene._wallSegments.filter((e) => e.data.type === 'h').map((e) => e.data);
    const vs = scene._wallSegments.filter((e) => e.data.type === 'v').map((e) => e.data);
    const manualCorners = new Set(
      scene._wallSegments
        .filter((e) => e.data.type === 'corner' && !e.data.auto)
        .map((e) => cornerKey(e.data.x, e.data.y))
    );
    const planned = new Map();

    const plan = (x, y, role, label, key) => {
      const ck = cornerKey(x, y);
      if (manualCorners.has(ck) || planned.has(ck)) return;
      planned.set(ck, {
        instanceId: `wall_auto_corner_${key}`,
        type: 'corner',
        x, y, role,
        label: label || 'Corner (auto)',
        auto: true,
      });
    };

    hs.forEach((h) => {
      vs.forEach((v) => {
        const vTop = Math.min(v.startY, v.endY);
        const vBot = Math.max(v.startY, v.endY);
        // V top meets H band — classic L (band then turn down from junction)
        if (near(h.y, vTop)) {
          if (near(h.endX, v.x)) {
            plan(h.endX - T, h.y, 'tr', 'Corner ↴ right', `${h.instanceId}_${v.instanceId}_tr`);
          }
          if (near(h.startX, v.x)) {
            plan(h.startX, h.y, 'tl', 'Corner ↴ left', `${h.instanceId}_${v.instanceId}_tl`);
          }
        }
        // V bottom meets H band — inverted L (band at bottom of vertical run)
        if (near(h.y, vBot)) {
          if (near(h.endX, v.x)) {
            plan(h.endX - T, h.y, 'br', 'Corner ↱ right', `${h.instanceId}_${v.instanceId}_br`);
          }
          if (near(h.startX, v.x)) {
            plan(h.startX, h.y, 'bl', 'Corner ↱ left', `${h.instanceId}_${v.instanceId}_bl`);
          }
        }
      });
    });

    planned.forEach((seg) => {
      scene._wallSegments.push(renderSegment(scene, seg, obstacles));
    });
  }

  function attachEditorHandles(scene, entry, onHandleDrag, onHandleDragEnd) {
    entry.handles.forEach((h) => h.destroy());
    entry.handles = [];
    const seg = entry.data;
    const makeHandle = (hx, hy, role) => {
      const dot = scene.add.circle(hx, hy, 6, 0xfde047, 0.95).setDepth(60).setStrokeStyle(2, 0x0f172a);
      dot.setInteractive({ draggable: true, useHandCursor: true });
      dot._wallRole = role;
      dot._wallSegmentId = entry.instanceId;
      dot.on('drag', (_p, dragX, dragY) => onHandleDrag(entry.instanceId, role, dragX, dragY));
      if (onHandleDragEnd) dot.on('dragend', onHandleDragEnd);
      entry.handles.push(dot);
      return dot;
    };

    if (seg.type === 'h') {
      makeHandle(seg.startX, seg.y + T, 'start');
      makeHandle(seg.endX, seg.y + T, 'end');
    } else if (seg.type === 'v') {
      const y0 = Math.min(seg.startY, seg.endY);
      const y1 = Math.max(seg.startY, seg.endY);
      makeHandle(seg.x + T / 2, y0, 'start');
      makeHandle(seg.x + T / 2, y1, 'end');
    } else {
      makeHandle(seg.x + T / 2, seg.y + T, 'body');
    }
  }

  function segmentWallLayer(seg) {
    if (seg?.type === 'h') return 'bands';
    if (seg?.type === 'v') return 'sides';
    if (seg?.type === 'corner' || seg?.type === 'tjunction') return 'joints';
    return 'all';
  }

  function segmentMatchesWallLayer(seg, layer) {
    if (!layer || layer === 'all') return true;
    return segmentWallLayer(seg) === layer;
  }

  function setEntryLayerVisible(entry, layer) {
    if (!entry) return;
    const visible = segmentMatchesWallLayer(entry.data, layer);
    entry._layerDimmed = !visible;
    const alpha = visible ? 1 : 0.12;
    (entry.visuals || []).forEach((v) => {
      if (typeof v.setAlpha === 'function') v.setAlpha(alpha);
    });
    if (!visible && entry.hit) {
      entry.hit.disableInteractive?.();
      styleEntrySelection(entry, false);
      styleEntryHover(entry, false);
    }
  }

  function styleEntrySelection(entry, selected) {
    if (!entry?.hit || entry._layerDimmed) return;
    entry.hit.setFillStyle(0x4ade80, selected ? 0.32 : 0);
    entry.hit.setStrokeStyle(selected ? 3 : 0, 0xfde047, selected ? 1 : 0);
  }

  function styleEntryHover(entry, hover) {
    if (!entry?.hit || entry._layerDimmed) return;
    if (entry._selected) return;
    entry.hit.setFillStyle(0x38bdf8, hover ? 0.22 : 0);
    entry.hit.setStrokeStyle(hover ? 2 : 0, 0x7dd3fc, hover ? 0.95 : 0);
  }

  function segmentLabel(seg) {
    if (seg?.label) return seg.label;
    if (seg?.type === 'h') return `Wall band ${Math.max(0, seg.endX - seg.startX)}px`;
    if (seg?.type === 'v') return `Side wall ${Math.max(0, Math.abs(seg.endY - seg.startY))}px`;
    if (seg?.type === 'corner') return seg.role ? `Corner ${seg.role}` : 'Corner cap';
    if (seg?.type === 'tjunction') return 'T-junction';
    return seg?.instanceId || 'Wall';
  }

  function segmentBadge(seg) {
    if (seg?.type === 'h') return 'trim + blue';
    if (seg?.type === 'v') return 'back trim + blue';
    if (seg?.type === 'corner') return seg.auto ? 'corner L' : 'corner';
    if (seg?.type === 'tjunction') return 't-junc';
    return seg?.type || '?';
  }

  /** Continuous perimeter box — full-width top/bottom trim bands + side faces. */
  function buildOfficeBoxPreset(width = 1280, height = 720) {
    const bottomY = height - T * 2;
    return [
      { instanceId: 'wall_perim_top', type: 'h', label: 'Perimeter top', startX: 0, y: 0, endX: width },
      { instanceId: 'wall_perim_bottom', type: 'h', label: 'Perimeter bottom', startX: 0, y: bottomY, endX: width },
      { instanceId: 'wall_perim_left', type: 'v', label: 'Perimeter left', x: 0, startY: T * 2, endY: bottomY, shadowSide: 'right' },
      { instanceId: 'wall_perim_right', type: 'v', label: 'Perimeter right', x: width - T, startY: T * 2, endY: bottomY, shadowSide: 'left' },
    ];
  }

  window.OpenplanWalls = {
    T,
    MIN_LEN,
    snap,
    segmentBounds,
    renderLayout,
    renderSegment,
    destroySegment,
    replaceSegment,
    removeSegment,
    layoutFromScene,
    splitSegment,
    duplicateSegment,
    defaultSegment,
    segmentFromDrag,
    segmentsFromDrag,
    drawPreviewBand,
    destroyPreview,
    syncAutoCorners,
    attachEditorHandles,
    segmentWallLayer,
    segmentMatchesWallLayer,
    setEntryLayerVisible,
    styleEntrySelection,
    styleEntryHover,
    segmentLabel,
    segmentBadge,
    buildOfficeBoxPreset,
    TRIM,
  };
})();
