/**
 * Map editor helpers — categories, prefs, templates, collision, grid.
 * Used by the office-scene editor IIFE.
 */
(function () {
  const PREFS_KEY = 'denizen_map_editor_prefs_v1';
  const GRID = 16;

  const CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'recent', label: 'Recent' },
    { id: 'favorites', label: '★ Favs' },
    { id: 'surface', label: 'Desks' },
    { id: 'desk_items', label: 'On desk' },
    { id: 'seat', label: 'Chairs' },
    { id: 'furniture', label: 'Furniture' },
    { id: 'partition', label: 'Dividers' },
    { id: 'decor', label: 'Decor' },
    { id: 'wall', label: 'Wall art' },
  ];

  const WALL_MOUNT_RE = /whiteboard|cork|ac_unit|cert_|pop_art|painting|poster|wall_screen|clock/i;

  function defaultPrefs() {
    return {
      favorites: [],
      recent: [],
      onboardingDismissed: false,
      showGrid: true,
    };
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return defaultPrefs();
      return { ...defaultPrefs(), ...JSON.parse(raw) };
    } catch (_) {
      return defaultPrefs();
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  function pushRecent(prefs, catalogId) {
    if (!catalogId) return prefs;
    const recent = [catalogId, ...(prefs.recent || []).filter((id) => id !== catalogId)].slice(0, 12);
    const next = { ...prefs, recent };
    savePrefs(next);
    return next;
  }

  function toggleFavorite(prefs, catalogId) {
    const set = new Set(prefs.favorites || []);
    if (set.has(catalogId)) set.delete(catalogId);
    else set.add(catalogId);
    const next = { ...prefs, favorites: [...set] };
    savePrefs(next);
    return next;
  }

  function isWallMount(id, def) {
    return !!(def?.wall_mount || WALL_MOUNT_RE.test(String(id || '')));
  }

  function categoryFor(id, def) {
    if (isWallMount(id, def)) return 'wall';
    if (def?.stack_on === 'surface' || def?.stack_on === 'desk') return 'desk_items';
    if (def?.category === 'desk_items') return 'desk_items';
    return def?.type || 'furniture';
  }

  function filterCatalogEntries(entries, { query, category, prefs }) {
    const q = String(query || '').trim().toLowerCase();
    const favs = new Set(prefs?.favorites || []);
    const recent = prefs?.recent || [];
    let list = entries.filter(([, def]) => !def?.editor_hidden);
    if (category === 'favorites') {
      list = list.filter(([id]) => favs.has(id));
    } else if (category === 'recent') {
      const byId = new Map(entries);
      list = recent.map((id) => (byId.has(id) ? [id, byId.get(id)] : null)).filter(Boolean);
    } else if (category && category !== 'all') {
      list = list.filter(([id, def]) => categoryFor(id, def) === category);
    }
    if (q) {
      list = list.filter(([id, def]) => {
        const dn = String(def.displayName || '').toLowerCase();
        const cat = String(def.category || '').toLowerCase();
        return id.toLowerCase().includes(q)
          || dn.includes(q)
          || cat.includes(q)
          || String(def.type || '').toLowerCase().includes(q)
          || (isWallMount(id, def) && 'wall'.includes(q));
      });
    }
    if (category !== 'recent') {
      // Prefer named Modern Office singles, then displayName, then id.
      list = [...list].sort((a, b) => {
        const score = (id, def) => {
          let s = 0;
          if (def?.source_type === 'single_file' && def?.theme === 'modern_office') s += 2;
          if (def?.displayName) s += 1;
          if (def?.editor_hidden) s -= 5;
          return s;
        };
        const ds = score(b[0], b[1]) - score(a[0], a[1]);
        if (ds) return ds;
        const an = (a[1].displayName || a[0]).toLowerCase();
        const bn = (b[1].displayName || b[0]).toLowerCase();
        return an.localeCompare(bn);
      });
    }
    return list;
  }

  /** Starter kits — sparse clusters using common catalog ids (missing ids skipped). */
  function getRoomTemplates() {
    return [
      {
        id: 'desk_pod',
        label: 'Desk pod',
        hint: 'Desk + chair + monitor',
        placements: [
          { id: 'desk_pod', x: 0, y: 0 },
          { id: 'chair_office', x: 0, y: 36 },
          { id: 'monitor', x: 0, y: -10 },
        ],
      },
      {
        id: 'meeting_corner',
        label: 'Meeting corner',
        hint: 'Table + chairs',
        placements: [
          { id: 'table_meeting', x: 0, y: 0 },
          { id: 'chair_office', x: -40, y: 28 },
          { id: 'chair_office', x: 40, y: 28 },
          { id: 'chair_office', x: -40, y: -28 },
          { id: 'chair_office', x: 40, y: -28 },
        ],
      },
      {
        id: 'lounge',
        label: 'Lounge',
        hint: 'Sofa + plant + table',
        placements: [
          { id: 'couch', x: 0, y: 0 },
          { id: 'plant_pot', x: 56, y: 8 },
          { id: 'coffee_table', x: 0, y: 40 },
        ],
      },
      {
        id: 'reception',
        label: 'Reception',
        hint: 'Counter + plant',
        placements: [
          { id: 'reception_desk', x: 0, y: 0 },
          { id: 'plant_pot', x: 64, y: 0 },
          { id: 'chair_office', x: 0, y: 40 },
        ],
      },
    ];
  }

  function spriteWorldBounds(sprite) {
    if (!sprite) return null;
    const w = sprite.displayWidth || 32;
    const h = sprite.displayHeight || 32;
    const ox = sprite.originX ?? 0.5;
    const oy = sprite.originY ?? 1;
    return {
      left: sprite.x - w * ox,
      right: sprite.x + w * (1 - ox),
      top: sprite.y - h * oy,
      bottom: sprite.y + h * (1 - oy),
      cx: sprite.x,
      cy: sprite.y,
      w,
      h,
    };
  }

  function rectsOverlap(a, b, pad = 2) {
    if (!a || !b) return false;
    return !(
      a.right + pad < b.left
      || a.left - pad > b.right
      || a.bottom + pad < b.top
      || a.top - pad > b.bottom
    );
  }

  function placementCollides(scene, bounds, ignoreSprites = []) {
    if (!bounds || !scene) return false;
    const ignore = new Set(ignoreSprites);
    const entries = scene._interactables || [];
    for (const entry of entries) {
      if (!entry?.sprite || ignore.has(entry.sprite) || entry.parentInstanceId) continue;
      const other = spriteWorldBounds(entry.sprite);
      if (rectsOverlap(bounds, other, 4)) return true;
    }
    for (const obs of scene._obstacles || []) {
      if (!obs?.body) continue;
      const b = {
        left: obs.body.x,
        right: obs.body.x + obs.body.width,
        top: obs.body.y,
        bottom: obs.body.y + obs.body.height,
      };
      // Only treat tall wall-like obstacles as blockers for ghost (height > 20).
      if (obs.body.height > 20 && rectsOverlap(bounds, b, 0)) return true;
    }
    return false;
  }

  function drawEditorGrid(gfx, width, height, step = GRID, color = 0x38bdf8, alpha = 0.12) {
    if (!gfx) return;
    gfx.clear();
    gfx.lineStyle(1, color, alpha);
    for (let x = 0; x <= width; x += step) {
      gfx.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += step) {
      gfx.lineBetween(0, y, width, y);
    }
    gfx.setDepth(0.05);
  }

  function selectionBounds(entries) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    let count = 0;
    for (const entry of entries) {
      const b = spriteWorldBounds(entry?.sprite);
      if (!b) continue;
      left = Math.min(left, b.left);
      right = Math.max(right, b.right);
      top = Math.min(top, b.top);
      bottom = Math.max(bottom, b.bottom);
      count += 1;
    }
    if (!count) return null;
    return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top };
  }

  window.DenizenMapEditorPro = {
    GRID,
    CATEGORIES,
    loadPrefs,
    savePrefs,
    pushRecent,
    toggleFavorite,
    isWallMount,
    categoryFor,
    filterCatalogEntries,
    getRoomTemplates,
    spriteWorldBounds,
    placementCollides,
    drawEditorGrid,
    selectionBounds,
  };
})();
