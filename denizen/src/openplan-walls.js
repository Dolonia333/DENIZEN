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

  /** Horizontal back trim — runs along the top of wall bands (viewed from above). */
  function drawTopTrim(scene, cx, topY, width, face) {
    const objs = [];
    const brick = face === 'brick' || face === 'wall_face_brick';
    if (brick) {
      // GIF brick walls: light top band + dark outline
      objs.push(scene.add.rectangle(cx, topY + TRIM_H / 2, width, TRIM_H, 0xe4e4ec, 1).setDepth(WALL_TRIM_DEPTH));
      objs.push(scene.add.rectangle(cx, topY + 1, width, 2, 0x2a2a38, 1).setDepth(WALL_TRIM_HI_DEPTH));
    } else {
      objs.push(scene.add.rectangle(cx, topY + TRIM_H / 2, width, TRIM_H, TRIM, 1).setDepth(WALL_TRIM_DEPTH));
      objs.push(scene.add.rectangle(cx, topY + TRIM_H - 1, width, 2, TRIM_HI, 1).setDepth(WALL_TRIM_HI_DEPTH));
    }
    return objs;
  }

  /** GIF entryway cut — dark vertical edge where an H-wall ends at a doorway. */
  function drawEntryCutH(scene, x, y) {
    return [
      scene.add.rectangle(x, y + BAND_H / 2, 2, BAND_H, TRIM, 1).setDepth(WALL_CORNER_TRIM_DEPTH),
    ];
  }

  function resolveFaceKeys(face) {
    if (face === 'brick' || face === 'wall_face_brick') {
      return { h: 'wall_face_brick', v: 'wall_face_brick' };
    }
    return { h: 'wall_face', v: 'wall_face_v' };
  }

  function drawHWallWithGaps(scene, startX, y, endX, doorGaps, obstacles, face) {
    const gaps = (doorGaps || [])
      .map((g) => [Math.max(startX, g[0]), Math.min(endX, g[1])])
      .filter(([a, b]) => b - a >= T)
      .sort((a, b) => a[0] - b[0]);
    let cursor = startX;
    const all = [];
    for (const [gx0, gx1] of gaps) {
      // Wall segment ending at doorway — GIF cut on the right edge; floor shows through gap
      if (gx0 > cursor) {
        all.push(...drawHWall(scene, cursor, y, gx0, obstacles, face, {
          leftCut: cursor > startX,
          rightCut: true,
        }));
      }
      cursor = gx1;
    }
    if (endX > cursor) {
      all.push(...drawHWall(scene, cursor, y, endX, obstacles, face, {
        leftCut: cursor > startX,
        rightCut: false,
      }));
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
    const fk = resolveFaceKeys(face);
    const objs = drawTopTrim(scene, startX + w / 2, y, w, face);
    const faceH = BAND_H - TRIM_H;
    objs.push(scene.add.tileSprite(startX + w / 2, y + TRIM_H + faceH / 2, w, faceH, fk.h).setDepth(WALL_FACE_DEPTH));
    objs.push(scene.add.rectangle(startX + w / 2, y + BAND_H - 1, w, 2, SHADOW, 0.5).setDepth(WALL_SHADOW_DEPTH));
    // GIF entryway cuts — dark vertical edge where wall stops at a doorway
    if (cuts?.leftCut) objs.push(...drawEntryCutH(scene, startX + 1, y));
    if (cuts?.rightCut) objs.push(...drawEntryCutH(scene, endX - 1, y));
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
    // Symmetrical edges — equal navy trim on both sides, face centered
    const edgeW = 3;
    const faceW = T - edgeW * 2;
    objs.push(scene.add.rectangle(x + edgeW / 2, y0 + h / 2, edgeW, h, TRIM, 1).setDepth(WALL_TRIM_DEPTH));
    objs.push(scene.add.rectangle(x + T - edgeW / 2, y0 + h / 2, edgeW, h, TRIM, 1).setDepth(WALL_TRIM_DEPTH));
    objs.push(scene.add.tileSprite(x + T / 2, y0 + h / 2, faceW, h, 'wall_face_v').setDepth(WALL_FACE_DEPTH));
    const shadowX = (shadowSide || 'right') === 'left' ? x + 1 : x + T - 1;
    objs.push(scene.add.rectangle(shadowX, y0 + h / 2, 1, h, SHADOW, 0.25).setDepth(WALL_SHADOW_DEPTH));
    // Doorway end caps — thin dark line across thickness (matches H entry cuts)
    if (cuts?.topCut) {
      objs.push(scene.add.rectangle(x + T / 2, y0 + 1, T, 2, TRIM, 1).setDepth(WALL_CORNER_TRIM_DEPTH));
    }
    if (cuts?.bottomCut) {
      objs.push(scene.add.rectangle(x + T / 2, y1 - 1, T, 2, TRIM, 1).setDepth(WALL_CORNER_TRIM_DEPTH));
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

    objs.push(...drawTopTrim(scene, x + T / 2, y, T));
    if (trimLeft) {
      objs.push(scene.add.rectangle(x + TRIM_W / 2, y + BAND_H / 2, TRIM_W, BAND_H, TRIM, 1).setDepth(WALL_CORNER_TRIM_DEPTH));
    }
    if (trimRight) {
      objs.push(scene.add.rectangle(x + T - TRIM_W / 2, y + BAND_H / 2, TRIM_W, BAND_H, TRIM, 1).setDepth(WALL_CORNER_TRIM_DEPTH));
    }

    const faceH = BAND_H - TRIM_H;
    objs.push(scene.add.tileSprite(x + T / 2, y + TRIM_H + faceH / 2, T, faceH, 'wall_face').setDepth(WALL_FACE_DEPTH));
    objs.push(scene.add.rectangle(x + T / 2, y + BAND_H - 1, T, 2, SHADOW, 0.5).setDepth(WALL_SHADOW_DEPTH));
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
      if (Array.isArray(data.doorGaps) && data.doorGaps.length) {
        visuals = drawHWallWithGaps(scene, data.startX, data.y, data.endX, data.doorGaps, obstacles, face);
      } else {
        visuals = drawHWall(scene, data.startX, data.y, data.endX, obstacles, face);
      }
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
    segments.forEach((seg) => {
      scene._wallSegments.push(renderSegment(scene, seg, obstacles));
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
