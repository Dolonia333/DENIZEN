/**
 * Map engine — PlacedObject helpers, grid snap, put-on-desk, Y-sort footY,
 * and footprint collision bounds for 2.5D Arcade Physics.
 *
 * Critical rule: Y-sort controls draw order; physics bodies control blocking.
 */
(function () {
  'use strict';

  const GRID = 32;
  const SNAP = 4;
  const WALL_MOUNT_RE = /whiteboard|cork|ac_unit|cert_|pop_art|painting|poster|wall_screen|clock|wall_ac|wall_brick|wall_panel|wall_tile/i;

  function snapValue(v, step = SNAP) {
    return Math.round(Number(v) / step) * step;
  }

  function snapToGrid(worldX, worldY, opts = {}) {
    const fine = opts.fineSnap != null ? opts.fineSnap : SNAP;
    const tile = opts.grid != null ? opts.grid : GRID;
    const pixelX = snapValue(worldX, fine);
    const pixelY = snapValue(worldY, fine);
    return {
      gridX: Math.floor(pixelX / tile),
      gridY: Math.floor(pixelY / tile),
      pixelX,
      pixelY,
    };
  }

  function pixelToGrid(pixelX, pixelY, tile = GRID) {
    return {
      gridX: Math.floor(Number(pixelX) / tile),
      gridY: Math.floor(Number(pixelY) / tile),
    };
  }

  function gridToPixel(gridX, gridY, tile = GRID) {
    return {
      pixelX: Number(gridX) * tile + tile / 2,
      pixelY: Number(gridY) * tile + tile,
    };
  }

  function isWallMount(id, def, placement) {
    return !!(
      placement?.wallMount
      || def?.wall_mount
      || WALL_MOUNT_RE.test(String(id || ''))
    );
  }

  /**
   * Snap wall-hung props onto the nearest horizontal wall band face.
   * Feet land ~hangOffset below the wall's top Y so the sprite sits in the face strip.
   */
  function snapWallMount(worldX, worldY, segments, opts = {}) {
    const hangOffset = opts.hangOffset != null ? Number(opts.hangOffset) : 56;
    const maxDist = opts.maxDist != null ? Number(opts.maxDist) : 56;
    const x = snapValue(worldX);
    const y = snapValue(worldY);
    let best = null;
    let bestScore = Infinity;
    (segments || []).forEach((seg) => {
      if (seg?.type !== 'h') return;
      const x0 = Number(seg.startX);
      const x1 = Number(seg.endX);
      if (!(x + 8 >= x0 && x - 8 <= x1)) return;
      // Skip door gaps
      const gaps = seg.doorGaps || [];
      if (gaps.some(([a, b]) => x >= a && x <= b)) return;
      const targetY = snapValue(Number(seg.y) + hangOffset);
      const score = Math.abs(y - targetY);
      if (score <= maxDist && score < bestScore) {
        bestScore = score;
        best = {
          x,
          y: targetY,
          wallMount: true,
          wallSegmentId: seg.instanceId || null,
        };
      }
    });
    return best || { x, y, wallMount: false, wallSegmentId: null };
  }

  function mapType(def, placement) {
    if (placement?.parentInstanceId || def?.stack_on === 'surface' || def?.stack_on === 'desk') {
      return 'on-desk';
    }
    if (isWallMount(placement?.id || def?.single_id, def, placement)) return 'wall';
    if (def?.type === 'overhead') return 'overhead';
    if (def?.type === 'floor') return 'floor';
    return def?.type === 'seat' ? 'furniture' : (def?.type || 'furniture');
  }

  function createPlacedObject({ catalogId, worldX, worldY, def, instanceId, parentInstanceId, parent_offset_x, parent_offset_y }) {
    const snapped = snapToGrid(worldX, worldY);
    const displayH = Number(def?.display_h || def?.h || def?.rect?.h || 32);
    return {
      id: instanceId || `${catalogId}_${snapped.pixelX}_${snapped.pixelY}`,
      catalogId,
      type: mapType(def, { parentInstanceId, id: catalogId }),
      gridX: snapped.gridX,
      gridY: snapped.gridY,
      pixelX: snapped.pixelX,
      pixelY: snapped.pixelY,
      pivotY: Number(def?.pivotY) || displayH,
      children: [],
      parentInstanceId: parentInstanceId || null,
      parent_offset_x: parent_offset_x != null ? Number(parent_offset_x) : undefined,
      parent_offset_y: parent_offset_y != null ? Number(parent_offset_y) : undefined,
      def: def || null,
    };
  }

  function findSurfaceUnderPoint(surfaces, worldX, worldY) {
    if (!Array.isArray(surfaces) || !surfaces.length) return null;
    let best = null;
    let bestScore = Infinity;
    surfaces.forEach((surf) => {
      const sx = surf.pixelX ?? surf.x ?? surf.sprite?.x;
      const sy = surf.pixelY ?? surf.y ?? surf.sprite?.y;
      const sw = surf.displayWidth ?? surf.sprite?.displayWidth ?? 48;
      const sh = surf.displayHeight ?? surf.sprite?.displayHeight ?? 32;
      if (sx == null || sy == null) return;
      const dx = Math.abs(worldX - sx);
      const dy = worldY - sy;
      if (dx <= Math.max(24, sw * 0.6) && dy >= -sh && dy <= 24) {
        const score = dx + Math.abs(dy);
        if (score < bestScore) {
          bestScore = score;
          best = surf;
        }
      }
    });
    return best;
  }

  function tryPutOnDesk(obj, surfaces, { mode = false, offsetY = -18 } = {}) {
    if (!obj) return obj;
    if (!mode) return obj;
    const surface = findSurfaceUnderPoint(surfaces, obj.pixelX, obj.pixelY);
    if (!surface) return obj;
    const parentId = surface.id || surface.instanceId;
    return {
      ...obj,
      type: 'on-desk',
      parentInstanceId: parentId,
      parent_offset_x: obj.pixelX - (surface.pixelX ?? surface.x ?? 0),
      parent_offset_y: offsetY,
      pixelX: surface.pixelX ?? surface.x,
      pixelY: (surface.pixelY ?? surface.y) + offsetY,
      children: [],
    };
  }

  function buildRenderTree(placements) {
    const list = Array.isArray(placements) ? placements : [];
    const byId = new Map();
    const roots = [];
    list.forEach((pl) => {
      const node = {
        ...pl,
        id: pl.instanceId || pl.id,
        catalogId: pl.id || pl.catalogId,
        pixelX: pl.x ?? pl.pixelX,
        pixelY: pl.y ?? pl.pixelY,
        children: [],
      };
      byId.set(node.id, node);
    });
    byId.forEach((node) => {
      const parentId = node.parentInstanceId;
      if (parentId && byId.has(parentId)) {
        byId.get(parentId).children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  function footY(obj) {
    if (!obj) return 0;
    const y = Number(obj.pixelY ?? obj.y ?? obj.sprite?.y) || 0;
    // Bottom-origin sprites: feet are at y. Optional pivotY is informational.
    return y;
  }

  function sortByFootY(items) {
    return [...(items || [])].sort((a, b) => footY(a) - footY(b) || String(a.id || '').localeCompare(String(b.id || '')));
  }

  /**
   * Footprint body size/offset for a bottom-origin sprite (Phaser top-left body space).
   * Prefer def.collisionBounds; else bottom third, width capped at 64.
   */
  function resolveCollisionBounds(def, displayW, displayH) {
    const w = Math.max(1, Number(displayW) || 32);
    const h = Math.max(1, Number(displayH) || 32);
    const custom = def?.collisionBounds;
    if (custom && typeof custom === 'object') {
      const width = Math.max(4, Number(custom.width) || Math.min(w, 64));
      const height = Math.max(4, Number(custom.height) || Math.max(8, Math.round(h / 3)));
      const offsetX = custom.offsetX != null ? Number(custom.offsetX) : (w - width) / 2;
      const offsetY = custom.offsetY != null ? Number(custom.offsetY) : (h - height);
      return { width, height, offsetX, offsetY };
    }
    // A shallow lip across the full width. The old third-height box, capped
    // at 64px wide, left the ends of a desk open (people walked across them)
    // and pushed the stop line out into the aisle.
    const height = Math.min(12, h);
    const width = Math.max(8, w);
    return {
      width,
      height,
      offsetX: (w - width) / 2,
      offsetY: h - height,
    };
  }

  /**
   * Foot hitbox for a bottom-origin character frame.
   * XP sheets are 32×48. A box at (3, 16) sits in the chest, so the sprite
   * keeps moving after the body has "hit" and the head is all that clears a desk.
   */
  function footBodyForFrame(frameW, frameH) {
    const w = Math.max(8, Number(frameW) || 32);
    const h = Math.max(8, Number(frameH) || 48);
    const width = Math.max(8, Math.round(w * 0.38));
    const height = Math.max(6, Math.round(Math.min(10, h * 0.18)));
    return {
      width,
      height,
      offsetX: Math.round((w - width) / 2),
      offsetY: h - height,
    };
  }

  function applyFootBody(sprite) {
    if (!sprite?.body || typeof sprite.body.setSize !== 'function') return null;
    const frameW = sprite.frame?.realWidth || sprite.frame?.width || 32;
    const frameH = sprite.frame?.realHeight || sprite.frame?.height || 48;
    const spec = footBodyForFrame(frameW, frameH);
    sprite.body.setSize(spec.width, spec.height);
    sprite.body.setOffset(spec.offsetX, spec.offsetY);
    return spec;
  }

  function shouldCollide(def, placement) {
    if (!def && !placement) return false;
    if (placement?.parentInstanceId) return false;
    const stack = def?.stack_on;
    if (stack === 'surface' || stack === 'desk') return false;
    if (isWallMount(placement?.id || def?.single_id, def, placement)) return false;
    if (def?.type === 'floor' || def?.category === 'floors') return false;
    if (def?.type === 'decor' && !def?.collisionBounds) return false;
    if (def?.type === 'seat' && !def?.collisionBounds) return false;
    return true;
  }

  /** World-space center of a footprint rect for a bottom-origin sprite at (x, y). */
  function footprintWorldRect(spriteX, spriteY, bounds) {
    const height = bounds.height;
    const width = bounds.width;
    return {
      x: spriteX,
      y: spriteY - height / 2,
      width,
      height,
    };
  }

  window.DenizenMapEngine = {
    GRID,
    SNAP,
    snapValue,
    snapToGrid,
    snapWallMount,
    pixelToGrid,
    gridToPixel,
    createPlacedObject,
    tryPutOnDesk,
    findSurfaceUnderPoint,
    buildRenderTree,
    footY,
    sortByFootY,
    resolveCollisionBounds,
    footBodyForFrame,
    applyFootBody,
    shouldCollide,
    footprintWorldRect,
    isWallMount,
    mapType,
  };
})();
