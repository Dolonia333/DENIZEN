// Phaser loads asynchronously (local-first loader in index.html) — office-scene
// parses before it's ready. startOfficeWhenPhaserReady() at the bottom of this
// file waits for the loader's verdict; nothing here may touch Phaser eagerly.

function applySavedPlacementsToScene(scene, savedPlacements) {
  if (!scene || !Array.isArray(savedPlacements) || !savedPlacements.length) return;
  const byId = new Map(savedPlacements.map((p) => [p.instanceId || p.id, p]));
  scene._interactables?.forEach((entry) => {
    if (entry.parentInstanceId || !entry.sprite) return;
    const pl = byId.get(entry.instanceId);
    if (!pl) return;
    entry.sprite.x = pl.x;
    entry.sprite.y = pl.y;
    applyPlacementTransform(entry.sprite, pl, entry.def);
    if (entry.obstacle) {
      entry.obstacle.x = pl.x;
      entry.obstacle.y = pl.y;
      if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
    }
    if (entry.def?._placement) {
      entry.def._placement.x = pl.x;
      entry.def._placement.y = pl.y;
      entry.def._placement.rotation = pl.rotation;
      entry.def._placement.scale = pl.scale;
      entry.def._placement.flipX = pl.flipX;
      entry.def._placement.flipY = pl.flipY;
    }
    refreshFurnitureDepth(entry);
  });
  savedPlacements.forEach((pl) => {
    if (!pl.parentInstanceId) return;
    const entry = scene._interactables?.find((it) => it.instanceId === (pl.instanceId || pl.id));
    const parent = scene._interactables?.find((it) => it.instanceId === pl.parentInstanceId);
    if (!entry?.sprite || !parent?.sprite) return;
    const offsetY = pl.parent_offset_y !== undefined
      ? pl.parent_offset_y
      : (entry.def?.parent_offset_y !== undefined ? entry.def.parent_offset_y : -8);
    entry.sprite.x = parent.sprite.x;
    entry.sprite.y = parent.sprite.y + offsetY;
    applyPlacementTransform(entry.sprite, pl, entry.def);
    if (entry.obstacle) {
      entry.obstacle.x = entry.sprite.x;
      entry.obstacle.y = entry.sprite.y;
      if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
    }
    refreshFurnitureDepth(entry);
  });
  if (scene.pathfinder?.rebuildFromScene) scene.pathfinder.rebuildFromScene(scene);
  scene._depthDirty = true;
}

/** Apply rotation / scale / flip from a placement record onto a Phaser image. */
function applyPlacementTransform(sprite, placement, def) {
  if (!sprite) return;
  const rot = Number(placement?.rotation) || 0;
  const scale = Number(placement?.scale);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  sprite.setAngle(rot);
  sprite.setFlipX(!!placement?.flipX);
  sprite.setFlipY(!!placement?.flipY);
  if (def?.source_type === 'single_file') {
    const dw = (def.display_w || 32) * s;
    const dh = (def.display_h || 48) * s;
    sprite.setDisplaySize(dw, dh);
  } else {
    sprite.setScale(s);
  }
}

/**
 * Furniture draws above openplan wall visuals (~1.0–1.35).
 * Slight Y bias keeps overlapping pieces sorted until full Y-sort runs.
 * Stacked desk items are rebased after Y-sort via restackDeskChildren().
 */
function furnitureRenderDepth(y, def, placement) {
  const id = String(placement?.id || '');
  const wallMount = !!(
    placement?.wallMount
    || def?.wall_mount
    || /whiteboard|cork|ac_unit|cert_|pop_art|painting|poster|wall_screen|clock|wall_ac|wall_brick|wall_panel/i.test(id)
  );
  // Floor paint tiles sit just above zone tileSprites (0 / 0.1), under furniture.
  if (def?.type === 'floor' || def?.category === 'floors') {
    return 0.5 + (Number(y) || 0) / 100000;
  }
  // Wall-hung props sit just above OpenplanWalls (~1.0–1.35). Ignore catalog
  // depth:2.2 so they don't Y-sort like tall floor furniture.
  if (wallMount) {
    return 1.55 + (Number(y) || 0) / 10000;
  }
  const base = typeof def?.depth === 'number' ? def.depth : 1.5;
  let depth = Math.max(base, 2.0) + (Number(y) || 0) / 10000;
  // Bias stackables slightly so they win ties before parent rebasing runs.
  if (placement?.parentInstanceId || def?.stack_on === 'surface' || def?.stack_on === 'desk') {
    depth += 0.35;
  }
  return depth;
}

function refreshFurnitureDepth(entry) {
  if (!entry?.sprite) return;
  const placement = entry.def?._placement || entry;
  const parentId = entry.parentInstanceId || placement?.parentInstanceId;
  if (parentId && entry.sprite.scene) {
    const parent = entry.sprite.scene._interactables?.find((it) => it.instanceId === parentId);
    if (parent?.sprite) {
      entry.sprite.setDepth((parent.sprite.depth || 10) + 8);
      return;
    }
  }
  const depth = furnitureRenderDepth(entry.sprite.y, entry.def, placement);
  entry.sprite.setDepth(depth);
}

/** Keep monitors/lamps/etc. above the desk they sit on (Y-sort alone puts them behind). */
function restackDeskChildren(scene) {
  if (!scene?._interactables?.length) return;
  const byParent = new Map();
  scene._interactables.forEach((entry) => {
    if (!entry?.parentInstanceId || !entry.sprite) return;
    if (!byParent.has(entry.parentInstanceId)) byParent.set(entry.parentInstanceId, []);
    byParent.get(entry.parentInstanceId).push(entry);
  });
  byParent.forEach((children, parentId) => {
    const parent = scene._interactables.find((it) => it.instanceId === parentId);
    if (!parent?.sprite) return;
    // Large gap above parent so later Y-sorts / other furniture can't bury desk items.
    const base = (parent.sprite.depth || 10) + 8;
    children.sort((a, b) => (a.sprite.y - b.sprite.y) || String(a.instanceId).localeCompare(String(b.instanceId)));
    children.forEach((child, i) => {
      child.sprite.setDepth(base + i * 0.05);
    });
  });
  // Lift un-parented stackables that are visually sitting on a desk.
  const desks = scene._interactables.filter((e) => (
    e?.sprite
    && !e.parentInstanceId
    && (
      e.def?.type === 'surface'
      || e.def?.category === 'desks'
      || e.def?.category === 'tables'
      || /^(desk_|table_|cubicle_desk)/i.test(String(e.id || ''))
    )
  ));
  scene._interactables.forEach((entry) => {
    if (!entry?.sprite || entry.parentInstanceId) return;
    const stack = entry.def?.stack_on;
    const looksStackable = stack === 'surface' || stack === 'desk'
      || entry.def?.category === 'desk_items'
      || /monitor|laptop|lamp|keyboard|phone|papers|mug/i.test(String(entry.id || ''));
    if (!looksStackable) return;
    let best = null;
    desks.forEach((desk) => {
      const dx = Math.abs(entry.sprite.x - desk.sprite.x);
      const dy = entry.sprite.y - desk.sprite.y;
      const reachX = Math.max(48, (desk.sprite.displayWidth || 32) * 0.75);
      if (dx <= reachX && dy >= -120 && dy <= 40) {
        if (!best || desk.sprite.depth > best.sprite.depth) best = desk;
      }
    });
    if (best) {
      entry.sprite.setDepth((best.sprite.depth || 10) + 8);
    }
  });
}

function notifyOfficeFurnitureReady(scene) {
  if (!scene || scene._furnitureReadyNotified) return;
  if (!scene._interactables?.length) return;
  scene._furnitureReadyNotified = true;
  scene._depthDirty = true;
  if (scene._pathfinder) {
    scene._pathfinder.buildFromScene(scene);
    scene._pathfinder.carveDoorwayGaps?.();
  }
  scene._agentManager?.onOfficeFurnitureReady?.();
}

function getPlayfieldDeviceProfile() {
  const dp = globalThis.DenizenDeviceProfile;
  if (dp?.get) return dp.get();
  const touch = !!globalThis.__DenizenIsTouch;
  const phone = touch && globalThis.DenizenMobilePlay?.isPhoneLike?.();
  return {
    isPhone: phone,
    isTablet: touch && !phone,
    tier: phone ? 'phone' : (touch ? 'tablet' : 'desktop'),
  };
}

function playfieldZoomForProfile(profile) {
  const dp = globalThis.DenizenDeviceProfile;
  if (dp?.playfieldZoomFor) return dp.playfieldZoomFor(profile);
  if (profile?.isPhone || profile?.tier === 'phone-compact') {
    if (profile?.isLandscape) return 1.55;
    return profile?.isCompactPhone ? 1.95 : 1.85;
  }
  if (profile?.isTablet) return profile?.isLandscape ? 1.85 : 2.15;
  return 2.75;
}

function createOfficeSceneClass() {
class OfficeScene extends Phaser.Scene {
  constructor() {
    super('OfficeScene');
  }

  _applyPlayfieldCamera() {
    const cam = this.cameras?.main;
    if (!cam) return;
    // Scripted cutscenes (?demo=investor|tour) own the camera — don't fight them.
    if (this._agentManager?._demoMode) return;
    cam.setZoom(playfieldZoomForProfile(getPlayfieldDeviceProfile()));
    // Soft follow — hard-lock (1,1) + roundPixels made walking read as judder.
    if (this.player) {
      cam.startFollow(this.player, true, 0.16, 0.16);
      try { cam.setRoundPixels(false); } catch (_) {}
    }
    try { this.scale?.refresh?.(); } catch (_) {}
  }

  /** Walk sprite is 32×64 at scale 1; sit sprite is 16×32 at scale 2 — always reset on stand. */
  _restorePlayerWalkSprite(frame = 20) {
    const p = this.player;
    if (!p) return;
    if (p.texture?.key !== 'dolo') p.setTexture('dolo');
    p.setScale(1);
    if (frame != null) p.setFrame(frame);
    if (this._sitOrigDepth !== undefined) {
      p.setDepth(this._sitOrigDepth);
      this._sitOrigDepth = undefined;
    }
    if (p.body) {
      p.body.setSize(14, 10);
      p.body.setOffset(9, 54);
    }
  }

  preload() {
    // --- Loading screen ---
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.add.text(w / 2, h / 2 - 50, 'DOLONIA', {
      fontSize: '24px', fontFamily: 'monospace', color: '#4ade80', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(w / 2, h / 2 - 25, 'AI Office Simulator', {
      fontSize: '11px', fontFamily: 'monospace', color: '#64748b',
    }).setOrigin(0.5);
    const barBg = this.add.rectangle(w / 2, h / 2 + 10, 260, 14, 0x1e293b).setOrigin(0.5);
    barBg.setStrokeStyle(1, 0x334155);
    const barFill = this.add.rectangle(w / 2 - 128, h / 2 + 10, 0, 10, 0x4ade80).setOrigin(0, 0.5);
    const pctText = this.add.text(w / 2, h / 2 + 32, '0%', {
      fontSize: '10px', fontFamily: 'monospace', color: '#94a3b8',
    }).setOrigin(0.5);
    const statusText = this.add.text(w / 2, h / 2 + 48, '', {
      fontSize: '9px', fontFamily: 'monospace', color: '#475569',
    }).setOrigin(0.5);
    this._loadingUI = [barBg, barFill, pctText, statusText];

    this.load.on('progress', (v) => {
      barFill.width = 256 * v;
      // Phaser text can throw if the font atlas isn't ready yet during preload.
      if (pctText?.active) {
        try { pctText.setText(Math.round(v * 100) + '%'); } catch (_) {}
      }
      try { window.__DenizenChatBootstrap?.setLoadPct?.(v * 100); } catch (_) {}
    });
    this.load.on('fileprogress', (file) => {
      if (statusText?.active) {
        try { statusText.setText(file.key || ''); } catch (_) {}
      }
    });

    // Helpful in-browser diagnostics so missing assets don't look like a silent blue screen.
    this._loadErrors = [];
    this.load.on('loaderror', (file) => {
      const key = file?.key || '(unknown-key)';
      const src = file?.src || file?.url || '(unknown-src)';
      this._loadErrors.push({ key, src });
      // eslint-disable-next-line no-console
      console.error('ASSET LOAD ERROR', key, src);
    });

    // Interior floor tileset (MV-style, treated as 32x32 grid)
    this.load.image(
      'floor_tiles',
      'assets/Floors_TILESET_A2.png'
    );
    // Modern Office Room Builder — floor + wall tiles matching the furniture art style
    this.load.image(
      'room_builder',
      'assets/Room_Builder_Office_32x32.png'
    );
    // Modern UI Style 2 — gray UI panels for dialog boxes
    this.load.image(
      'ui_style2',
      'assets/Modern_UI_Style_2_32x32.png'
    );
    // Interior walls tileset (used for office walls/trim when needed)
    this.load.image(
      'wall_tiles',
      'assets/Walls_TILESET_A4.png'
    );
    // Core JSON catalogs
    const catalogV = 'cat27breakroom';
    this.load.json('furniture_catalog_openplan', `./data/furniture_catalog_openplan.json?v=${catalogV}`);
    this.load.json('openplan_walls', `./data/openplan_walls.json?v=${catalogV}`);
    this.load.json('office_blueprint', `./data/office_blueprint.json?v=${catalogV}`);
    this.load.json('room_templates', `./data/room-templates.json?v=${catalogV}`);
    this.load.json('sprite_map_modern_office', `./data/sprite-map-modern-office.json?v=${catalogV}`);
    // Modern Office Revamped — main spritesheet for ALL furniture
    this.load.image(
      'mo_black_shadow_32',
      'assets/Modern_Office_Black_Shadow_32x32.png?v=2'
    );
    // Unused sheets removed to prevent loader stall (were loading 90+ files)

    // Singles for open-plan are loaded on demand in create() when a placement needs them.

    // Player: full 4-direction sheet from paid RPG Maker XP (32x48 per frame)
    this.load.spritesheet(
      'player_xp',
      'assets/Adam.png',
      { frameWidth: 32, frameHeight: 48 }
    );

    // Dolo: Character Generator 2.0 sprite (32x64 per frame, 24 cols x 1 row)
    this.load.spritesheet(
      'dolo',
      'assets/Dolo.png',
      { frameWidth: 32, frameHeight: 64 }
    );

    // Dolo phone animation (32x64 per frame, 12 frames, single row)
    this.load.spritesheet(
      'dolo_phone',
      'assets/Dolo_phone.png',
      { frameWidth: 32, frameHeight: 64 }
    );

    // Dolo sit animation (16x32 per frame, 12 frames = 6 poses × 2 directions)
    // Each pair: [left-facing, right-facing]
    this.load.spritesheet(
      'dolo_sit',
      'assets/Dolo_sit.png',
      { frameWidth: 16, frameHeight: 32 }
    );

    // Robber: security threat visualization NPC (16x32 per frame, 24 cols x 1 row)
    // Character Generator 2.0 format — smaller scale, needs 2x display
    this.load.spritesheet(
      'robber',
      'assets/rober.png',
      { frameWidth: 16, frameHeight: 32 }
    );

    const roster = globalThis.DenizenNpcRoster;
    if (!roster) {
      console.error('[OfficeScene] DenizenNpcRoster missing — load src/npc-roster.js before office-scene.js');
    }
    const xpNames = roster ? roster.assetNames : [];
    const npcAssetV = 'roster2';

    xpNames.forEach((name) => {
      this.load.spritesheet(
        `xp_${name.toLowerCase()}`,
        `assets/${name}.png?v=${npcAssetV}`,
        { frameWidth: 32, frameHeight: 48 }
      );
    });

    const urlParams = new URLSearchParams(window.location.search);
    const layoutParam = urlParams.get('layout') || 'openplan';

    // --- Preload singles used in the current layout from the master catalog ---
    const fCatKey = layoutParam === 'promo'
      ? 'furniture_catalog_promo'
      : (layoutParam === 'openplan' ? 'furniture_catalog_openplan' : 'furniture_catalog');
    
    // Some logic loads world generator which handles its own things, but for handcrafted layouts
    // we can parse our own JSONs. Wait, if URL params change what JSON we need, we should ideally
    // fetch the JSON synchronously or rely on the cached 'furniture_catalog' etc.
    // However, during preload(), `this.cache.json.get` is definitely valid because it loads these static definitions.
    // Wait, let's just use Phaser's loader in create() if we need to. Actually, it's safer to load all required singles here.
    // Let's do a trick: we will just load ALL known singles referenced in ALL 3 furniture_catalogs, as well as scene_recipes.
    // It's a small number of strings (maybe 50 singles total).
    
    const tryPreloadSingles = (catKey) => {
        const cat = this.cache.json.get(catKey);
        if(!cat || !cat.placements) return;
        const master = this.cache.json.get('master_furniture_catalog');
        if(!master || !master.objects) return;
        
        cat.placements.forEach(pl => {
             const def = master.objects[pl.id];
             if(def && def.source_type === 'single_file') {
                 // url_path is like "assets/Modern_Office_Revamped/.../foo.png"
                 const fullUrl = def.url_path.replace(/\\/g, '/');
                 if(!this.textures.exists(`single_${pl.id}`)) {
                     this.load.image(`single_${pl.id}`, fullUrl);
                 }
             }
        });
    }
    
    // For safety, let's wait until create() to do dynamic loading if we have to, 
    // OR just rely on preload() catching them if we fetched the JSONs beforehand. 
    // Wait! `preload` is exactly where we do this, but `this.cache` is populated *after* preload.
    // So we can't read the catalog in preload unless we use a Boot scene.
    // Let's just do dynamic loading in create().
  }

  create() {
    try { console.log('[BootTiming] create() start', performance.now()); } catch (_) {}
    // Drop HTML + Phaser load chrome as soon as the scene starts — don't wait
    // for AgentOfficeManager / PlayerChat or a hung login waiter.
    try { window.__DenizenChatBootstrap?.setLoadPct?.(100); } catch (_) {}
    if (this._loadingUI) {
      this._loadingUI.forEach(obj => obj.destroy());
      this._loadingUI = null;
    }
    // Also remove the DOLONIA title text objects created in preload
    this.children.list.filter(c => c.type === 'Text' && (c.text === 'DOLONIA' || c.text === 'AI Office Simulator')).forEach(t => t.destroy());

    // Text at 1× with pixelArt. Resolution 2 looked sharper in theory but
    // nearest-neighbor sampling puts a bright/white fringe around every glyph.
    if (!this._textFactoryPatched) {
      const factory = this.add;
      const origText = factory.text.bind(factory);
      factory.text = function (x, y, content, style) {
        const t = origText(x, y, content, style);
        if (t && typeof t.setResolution === 'function') t.setResolution(1);
        return t;
      };
      this._textFactoryPatched = true;
    }

    // If anything failed to load, show it on-screen immediately.
    if (Array.isArray(this._loadErrors) && this._loadErrors.length > 0) {
      const msg = this._loadErrors
        .slice(0, 8)
        .map((e) => `- ${e.key}: ${e.src}`)
        .join('\n');
      this.add.text(16, 16, `Missing assets (${this._loadErrors.length})\n${msg}`, {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
        fontSize: '14px',
        color: '#fecaca'
      }).setDepth(2000);
      // Continue anyway so you can still see floor/UI.
    }

    // Seeded world generation: visit /?seed=YOURSEED
    const urlParams = new URLSearchParams(window.location.search);
    const seedParam = urlParams.get('seed');
    const layoutParam = urlParams.get('layout') || 'openplan'; // default to openplan
    const modeParam = urlParams.get('mode'); // 'city', 'officegen', etc.
    const width = 1280;
    const height = 720;
    const tileSize = 32;

    // --- Early exit: full LimeZu multi-zone city world (?world=full) ---
    // Must run before ANY office drawing (floor tileSprites start ~110 lines
    // down) so the city isn't painted over by the 1280×720 office floor.
    if (urlParams.get('world') === 'full') {
      import('./src/full-world.js?v=fw16')
        .then((m) => m.buildFullWorld(this))
        .catch((err) => {
          console.error('[OfficeScene] full-world load failed:', err);
          this.add.text(24, 24, `Full world failed to load: ${err.message}`, {
            fontSize: '14px', color: '#fecaca'
          }).setDepth(9999).setScrollFactor(0);
        });
      return;
    }

    // ========================================================
    // Room Builder tile system — floors, wall faces, wall outlines, shadows
    // Based on Room_Builder_Office_32x32.png (512×448, 16×14 tiles)
    // ========================================================
    const rbImg = this.textures.get('room_builder')?.getSourceImage();

    // Helper: cut a single 32×32 tile from the Room Builder sheet
    const cutRBTile = (key, sx, sy, sw, sh) => {
      sw = sw || 32; sh = sh || 32;
      if (this.textures.exists(key)) this.textures.remove(key);
      const t = this.textures.createCanvas(key, sw, sh);
      t.context.imageSmoothingEnabled = false;
      if (rbImg) t.context.drawImage(rbImg, sx, sy, sw, sh, 0, 0, sw, sh);
      t.refresh();
    };

    // --- Wall Outline pieces (top half of Room Builder — white/black structural lines) ---
    cutRBTile('wall_top_h',      32,  0);    // Horizontal wall outline — tile (1,0)
    cutRBTile('wall_top_v',      128, 0);    // Vertical wall outline — tile (4,0)
    cutRBTile('wall_corner_tl',  32,  32);   // Corner top-left — tile (1,1)
    cutRBTile('wall_corner_tr',  64,  32);   // Corner top-right — tile (2,1)
    cutRBTile('wall_tjunc_l',    32,  64);   // T-junction left — tile (1,2)
    cutRBTile('wall_tjunc_r',    64,  64);   // T-junction right — tile (2,2)
    cutRBTile('wall_fill',       320, 0);    // Solid white fill — tile (10,0) for thick walls

    // --- Wall Face textures (Room Builder bottom rows — designed for simple tiling) ---
    cutRBTile('wall_face_grey',  0,   224);  // Grey/concrete — standard office wall
    cutRBTile('wall_face_purple', 0,  160);  // Purple/patterned — decorative/feature walls
    cutRBTile('wall_shadow',     96,  160);  // Shadow strip — right side of vertical walls for 3D
    cutRBTile('wall_panel_white', 0, 352);   // Catalog white panel (editor tile)

    // --- Procedural wall trim + face textures matching the reference ---
    // Reference colors sampled: trim=#3a3a50, face=#c3dee6 (lavender-blue)
    const makeWallTex = (key, w, h, fillFn) => {
      if (this.textures.exists(key)) this.textures.remove(key);
      const t = this.textures.createCanvas(key, w, h);
      fillFn(t.context, w, h);
      t.refresh();
    };

    // OFFICIAL Room Builder Office white wall (sheet rows 11-12, sampled):
    //   y0-2 navy #3a3a50 · y2-10 WHITE top face · y10-12 navy · pale
    //   lavender face #dbd4e1 with 2px texture stripes · 2px navy base.
    // The old procedural draws (#c3d0e6 blue face, navy-only trim) never
    // matched the pack's example offices — these crops are the real art.
    // wall_cap_official: the 12px top cap (navy+white+navy), tiled by
    // openplan-walls.js drawTopTrim.
    cutRBTile('wall_cap_official', 0, 352, 32, 12);
    // Face tile: face-only column of the white wall block (tile 4,11)
    cutRBTile('wall_face', 128, 352);
    cutRBTile('wall_face_v', 128, 352);
    // Legacy consumers of the old navy trim strip keep a texture
    makeWallTex('wall_trim_h', 32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#3a3a50';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4a4a62';
      ctx.fillRect(0, h - 2, w, 2);
    });

    // Zoomed tan brick for lower-room back walls (skip huge white band in RB tile)
    const makeGifBrickFace = (key) => {
      if (this.textures.exists(key)) this.textures.remove(key);
      const t = this.textures.createCanvas(key, 32, 32);
      const ctx = t.context;
      ctx.imageSmoothingEnabled = false;
      if (rbImg) {
        ctx.drawImage(rbImg, 2, 300, 28, 20, 0, 0, 32, 32);
      } else {
        ctx.fillStyle = '#988878';
        ctx.fillRect(0, 0, 32, 32);
      }
      t.refresh();
    };
    makeGifBrickFace('wall_face_brick');

    // --- Floor tiles from Room Builder ---
    cutRBTile('floor_rb_office', 320, 160);  // Grey grid/tile — standard office
    cutRBTile('floor_rb_dark',   320, 224);  // Dark grey/concrete — hallways, storage
    cutRBTile('floor_rb_wood',   448, 160);  // Wood/parquet — boss office, breakroom

    // Fallback procedural textures (in case Room Builder image fails)
    const makeCheckerTex = (key, c1, c2) => {
      if (this.textures.exists(key)) return; // don't overwrite RB tiles
      const t = this.textures.createCanvas(key, 64, 64);
      t.context.fillStyle = c1; t.context.fillRect(0, 0, 64, 64);
      t.context.fillStyle = c2; t.context.fillRect(32, 0, 32, 32); t.context.fillRect(0, 32, 32, 32);
      t.refresh();
    };

    // LAYER 1: Floor — seamless tileSprites per zone (hand-tuned layout)
    this.add.tileSprite(width / 2, height / 2, width, height, 'floor_rb_office').setDepth(0);

    const blueprintFloors = this.cache.json.get('office_blueprint')?.floors;
    const floorZones = Array.isArray(blueprintFloors) && blueprintFloors.length
      ? blueprintFloors
          .filter((z) => z.id !== 'base')
          .map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h, tex: z.tex }))
      : [
          { x: 32, y: 64, w: 816, h: 384, tex: 'floor_rb_office' },
          { x: 880, y: 64, w: 368, h: 192, tex: 'floor_rb_wood' },
          { x: 880, y: 320, w: 368, h: 128, tex: 'floor_rb_office' },
          { x: 32, y: 512, w: 256, h: 144, tex: 'floor_rb_wood' },
          { x: 384, y: 512, w: 464, h: 144, tex: 'floor_rb_wood' },
          { x: 880, y: 512, w: 368, h: 144, tex: 'floor_rb_wood' },
        ];
    floorZones.forEach(z => {
      this.add.tileSprite(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, z.tex).setDepth(0.1);
    });

    // Keep corridor/clinic textures for the non-openplan layout fallback
    const makeSingleTileTex = (texKey, sx, sy) => {
      if (this.textures.exists(texKey)) this.textures.remove(texKey);
      const t = this.textures.createCanvas(texKey, 32, 32);
      t.context.imageSmoothingEnabled = false;
      t.context.clearRect(0, 0, 32, 32);
      if (rbImg) {
        t.context.drawImage(rbImg, sx, sy, 32, 32, 0, 0, 32, 32);
      } else {
        t.context.fillStyle = texKey === 'clinic_single' ? '#b0c4de' : '#888888';
        t.context.fillRect(0, 0, 32, 32);
      }
      t.refresh();
    };
    makeSingleTileTex('corridor_single', 0, 224);
    makeSingleTileTex('clinic_single', 0, 160);

    // --- Early exit: pure procedural office interior demo ---
    if (modeParam === 'officegen') {
      Promise.all([
        import('./src/city/interiorGenerator.js'),
        import('./src/city/phaserAdapter.js')
      ]).then(([interiors, adapter]) => {
        const layout = interiors.generateOfficeInterior({
          seed: seedParam || 'default',
          buildingId: 'demo_office',
          width: 24,
          height: 16
        });

        const catalog = this.cache.json.get('interiors_prefabs');
        const prefabSprites = {};

        if (catalog && catalog.prefabs && catalog.sheets) {
          Object.entries(catalog.prefabs).forEach(([id, def]) => {
            const sheetInfo = catalog.sheets[def.sheet];
            if (!sheetInfo) return;
            const imageKey = sheetInfo.imageKey;
            if (!this.textures.exists(imageKey)) return;
            const img = this.textures.get(imageKey).getSourceImage();
            const { x, y, w, h } = def.rect;
            const texKey = `int_${id}`;
            if (this.textures.exists(texKey)) this.textures.remove(texKey);
            const canvasTex = this.textures.createCanvas(texKey, w, h);
            canvasTex.context.imageSmoothingEnabled = false;
            canvasTex.context.drawImage(img, x, y, w, h, 0, 0, w, h);
            canvasTex.refresh();

            prefabSprites[id] = ({ scene, x: px, y: py }) => {
              const originY = def.origin === 'center' ? 0.5 : 1;
              return scene.add.image(px, py, texKey).setOrigin(0.5, originY);
            };
          });
        }

        adapter.renderInteriorPhaser(this, layout, prefabSprites);
      });
      // Skip the rest of create() for this mode.
      return;
    }

    // --- Room Assembly system mode: render perfect rooms without broken sprites ---
    if (modeParam === 'assembly') {
      Promise.all([
        import('./src/RoomAssembly.js'),
        import('./src/RoomGenerator.js')
      ]).then(([assemblyModule, generatorModule]) => {
        const RoomAssembly = assemblyModule.RoomAssembly || assemblyModule.default;
        const RoomGenerator = generatorModule.RoomGenerator || generatorModule.default;
        
        // Initialize assembly system
        const assembly = new RoomAssembly(this);
        const catalogData = this.cache.json.get('furniture_catalog_openplan');
        const roomTemplatesData = this.cache.json.get('room_templates');
        const masterData = this.cache.json.get('master_furniture_catalog');
        
        if (!assembly.initialize(catalogData, roomTemplatesData, masterData)) {
          console.error('❌ Failed to initialize RoomAssembly');
          return;
        }
        
        // List available templates
        assembly.listTemplates();
        
        // Procedural room generation: ?generate=workspace&occupants=6
        const generateParam = new URLSearchParams(window.location.search).get('generate');
        const generator = new RoomGenerator(catalogData);
        this.roomGenerator = generator; // expose for console debugging

        // Render a test room - default to the rebuilt reference layout
        let templateName = new URLSearchParams(window.location.search).get('template') || 'reference_office_main';

        if (generateParam) {
          const occupants = parseInt(new URLSearchParams(window.location.search).get('occupants') || '4', 10);
          const genWidth = parseInt(new URLSearchParams(window.location.search).get('rw') || '0', 10) || undefined;
          const genHeight = parseInt(new URLSearchParams(window.location.search).get('rh') || '0', 10) || undefined;
          templateName = generator.generateAndRegister(assembly, {
            purpose: generateParam,
            occupants,
            width: genWidth,
            height: genHeight
          });
          console.log(`🏗️ Generated template: ${templateName}`);
        }

        const isReferenceTemplate = templateName === 'reference_office_main';
        // Anchor compact reference composition near the middle so camera can frame it tightly.
        // Reference template uses catalog-placement coords directly (origin at 0,0).
        const originX = isReferenceTemplate ? 0 : 140;
        const originY = isReferenceTemplate ? 0 : 120;
        assembly.renderRoom(templateName, originX, originY);

        // Assembly-specific wall pass: cleaner enclosing walls for the rebuilt template zone.
        // This avoids relying on generic map walls that may feel disconnected from template content.
        const T = 32;
        const drawAsmHWall = (startX, y, endX) => {
          if (endX <= startX) return;
          const w = endX - startX;
          const trimH = 4;
          const wallH = T * 2;

          // Keep wall depths below furniture so props are never visually clipped.
          this.add.rectangle(startX + w / 2, y + trimH / 2, w, trimH, 0x2a3550, 1).setDepth(1.1);
          this.add.rectangle(startX + w / 2, y + trimH + (wallH - trimH) / 2, w, wallH - trimH, 0xe8e8ec, 1).setDepth(0.8);
        };
        const drawAsmVWall = (x, startY, endY) => {
          if (endY <= startY) return;
          const h = endY - startY;
          const trimW = 4;

          // Continuous vertical trim + connected body + subtle right shadow.
          this.add.rectangle(x + trimW / 2, startY + h / 2, trimW, h, 0x2a3550, 1).setDepth(1.1);
          this.add.rectangle(x + trimW + (T - trimW) / 2, startY + h / 2, T - trimW, h, 0xe8e8ec, 1).setDepth(0.8);
          this.add.rectangle(x + T - 1, startY + h / 2, 2, h, 0x6d7384, 0.55).setDepth(0.9);
        };
        const drawAsmHWallWithGaps = (startX, y, endX, gaps = []) => {
          const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
          let cursor = startX;
          sorted.forEach(([gx0, gx1]) => {
            drawAsmHWall(cursor, y, Math.max(cursor, gx0));
            cursor = Math.max(cursor, gx1);
          });
          drawAsmHWall(cursor, y, endX);
        };
        const drawAsmVWallWithGaps = (x, startY, endY, gaps = []) => {
          const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
          let cursor = startY;
          sorted.forEach(([gy0, gy1]) => {
            drawAsmVWall(x, cursor, Math.max(cursor, gy0));
            cursor = Math.max(cursor, gy1);
          });
          drawAsmVWall(x, cursor, endY);
        };

        // Zone covers all template content. Template items span world x:172–614, y:104–550.
        // Zone covers all catalog placements: items span x:52–1228, y:72–700.
        const zoneX = isReferenceTemplate ? 16 : (originX - 92);
        const zoneY = isReferenceTemplate ? 32 : (originY - 96);
        const zoneW = isReferenceTemplate ? 1264 : 840;
        const zoneH = isReferenceTemplate ? 700 : 430;

        // Outer enclosure top wall (always drawn)
        drawAsmHWall(zoneX, zoneY, zoneX + zoneW);
        if (!isReferenceTemplate) {
          drawAsmHWallWithGaps(zoneX, zoneY + zoneH - T * 2, zoneX + zoneW, [[zoneX + 320, zoneX + 430]]);
          drawAsmVWall(zoneX, zoneY + T * 2, zoneY + zoneH - T * 2);
          drawAsmVWallWithGaps(zoneX + zoneW - T, zoneY + T * 2, zoneY + zoneH - T * 2, [[zoneY + 224, zoneY + 300]]);

          // Manager-room box on upper-right with a door gap in its bottom wall.
          const mgrX = zoneX + 470;
          const mgrY = zoneY + 44;
          const mgrW = 260;
          const mgrH = 210;
          drawAsmHWall(mgrX, mgrY, mgrX + mgrW);
          drawAsmVWall(mgrX, mgrY + T * 2, mgrY + mgrH);
          drawAsmVWall(mgrX + mgrW - T, mgrY + T * 2, mgrY + mgrH);
          drawAsmHWallWithGaps(mgrX, mgrY + mgrH - T * 2, mgrX + mgrW, [[mgrX + 86, mgrX + 166]]);
        }

        if (isReferenceTemplate) {
          drawAsmHWall(zoneX, zoneY + zoneH - T * 2, zoneX + zoneW);
          drawAsmVWall(zoneX, zoneY + T * 2, zoneY + zoneH - T * 2);
          drawAsmVWall(zoneX + zoneW - T, zoneY + T * 2, zoneY + zoneH - T * 2);
        }

        // Assembly-mode character pass: keep a visible player + a few NPCs.
        const ensureAnimSet = (prefix, key) => {
          const mk = (name, frames, frameRate) => {
            const k = `${prefix}_${name}`;
            if (this.anims.exists(k)) return k;
            this.anims.create({ key: k, frames, frameRate, repeat: -1 });
            return k;
          };
          return {
            walkDown: mk('walk_down', this.anims.generateFrameNumbers(key, { start: 0, end: 3 }), 8),
            walkLeft: mk('walk_left', this.anims.generateFrameNumbers(key, { start: 4, end: 7 }), 8),
            walkRight: mk('walk_right', this.anims.generateFrameNumbers(key, { start: 8, end: 11 }), 8),
            walkUp: mk('walk_up', this.anims.generateFrameNumbers(key, { start: 12, end: 15 }), 8)
          };
        };

        const playerAnims = ensureAnimSet('asm_player_xp', 'player_xp');
        const playerStartX = isReferenceTemplate ? 300 : (originX + 250);
        const playerStartY = isReferenceTemplate ? 260 : (originY + 228);
        this.player = this.physics.add.sprite(playerStartX, playerStartY, 'player_xp', 1);
        this.player.setCollideWorldBounds(true).setDepth(2.6).setScale(2);
        // Shrink physics body to foot hitbox
        this.player.body.setSize(12, 10);
        this.player.body.setOffset(2, 14);
        // Match the main update() animation contract.
        this._playerAnimKey = (name) => `asm_player_xp_${name}`;
        this.player.setFrame(0);
        this.cursors = this.input.keyboard.createCursorKeys();
        this.interactKeys = this.input.keyboard.addKeys({ E: 'E', SPACE: 'SPACE' });
        // Don't let Phaser preventDefault these keys — they must reach focused
        // HTML inputs (login modal / chat). See the matching note in the main
        // create() path below; the body can't scroll so this is safe.
        this.input.keyboard.clearCaptures();
        this._installRawMoveKeys();
        this._installCanvasRefocus();
        this.playerState = 'walk';
        this.playerLocked = false;
        this.facing = 'down';
        // Dirty flag — set true whenever any character moves, cleared after Y-sort runs
        this._depthDirty = true;

        this.npcs = [];
        const npcKeys = ['xp_abby', 'xp_alex', 'xp_bob', 'xp_dan'];
        const npcPoints = isReferenceTemplate
          ? [
                { x: 200, y: 210 },
                { x: 400, y: 390 },
                { x: 640, y: 590 },
                { x: 980, y: 270 }
            ]
          : [
              { x: originX + 8, y: originY + 64 },
              { x: originX + 140, y: originY + 64 },
              { x: originX + 270, y: originY + 64 },
              { x: originX + 598, y: originY + 162 }
            ];
        npcKeys.forEach((texKey, i) => {
          if (!this.textures.exists(texKey)) return;
          const p = npcPoints[i];
          const npcAnims = ensureAnimSet(`asm_${texKey}`, texKey);
          const npc = this.physics.add.sprite(p.x, p.y, texKey, 1);
          npc.setDepth(2.6).setScale(2);
          // Shrink physics body to small foot hitbox so NPCs navigate between desks
          npc.body.setSize(12, 10);    // small collision box (scaled: 24x20)
          npc.body.setOffset(2, 14);   // anchor to feet (bottom of 16x24 base sprite)
          npc._animKey = (name) => `asm_${texKey}_${name}`;
          npc.ai = {
            mode: 'wander',
            facing: 'down',
            nextWanderAt: 0,
            wanderTarget: { x: p.x, y: p.y },
            followOffset: { x: (i % 2) * 24 - 12, y: Math.floor(i / 2) * 20 - 10 }
          };
          npc.setFrame(0);
          this.npcs.push(npc);
        });

        if (isReferenceTemplate) {
           const cam = this.cameras.main;
           cam.setBounds(zoneX - 32, zoneY - 32, zoneW + 64, zoneH + 64);
           const playProfile = getPlayfieldDeviceProfile();
           // Same tier zoom as the main office — do not force desktop to 1.0 (too far out).
           cam.setZoom(playfieldZoomForProfile(playProfile));
           if (this.player) {
             cam.startFollow(this.player, true, 1, 1);
           } else {
             cam.centerOn(zoneX + zoneW / 2, zoneY + zoneH / 2);
           }
        }
        
        // Store assembly instance on scene for debugging/inspection
        this.roomAssembly = assembly;
      }).catch(err => {
        console.error('❌ Failed to load RoomAssembly module:', err);
      });
      // Skip the rest of create() for this mode.
      return;
    }

    // If a seed was provided, generate and render a world layout and skip the handcrafted walls.
    if (seedParam) {
      // Seeded / generated view: render world asynchronously, but still run character setup.
      // We skip the handcrafted wall layout below so the generated content can be seen clearly.
      this._skipHandcraftedLayout = true;
      Promise.all([
        import('./src/world/generator.js'),
        import('./src/world/renderer.js'),
        import('./src/world/debug.js')
      ]).then(([gen, rend, dbg]) => {
        gen.generateWorld({
          seed: seedParam,
          prefabs: [],
          config: {
            roomCount: 6,
            corridorWidth: 120,
            outdoorEnabled: true,
            layoutMode: 'recipes',
            defaultTheme: 'modern_office',
            defaultRoomType:
              layoutParam === 'reception'
                ? 'reception_lobby'
                : layoutParam === 'small_office'
                  ? 'small_office'
                  : layoutParam === 'reference_office'
                    ? 'reference_office'
                    : 'openplan_bullpen'
          }
        })
          .then((world) => {
            rend.renderWorld(this, world, { rooms: 'floor_single', corridor: 'corridor_single', clinic: 'clinic_single' });
            const debugWorld = urlParams.get('debug') === '1';
            if (debugWorld) dbg.drawWorldDebug(this, world);

            // Spawn furniture from world.objects.
            // reference_office: use Modern Office (mo_black_shadow_32) so it looks like the promo.
            // Other layouts: use interiors prefab catalog (XP sheets).
            let useModernOffice = layoutParam === 'reference_office';
            const openplanCatalog = this.cache.json.get('furniture_catalog_openplan');
            const catalog = this.cache.json.get('interiors_prefabs');

            if (useModernOffice && openplanCatalog && openplanCatalog.objects && Array.isArray(world.objects)) {
              const prefabToCatalog = {
                desk_cluster_2x2: 'desk_pod',
                office_chair: 'chair_office',
                pc_monitor: 'monitor',
                plant_pot: 'plant_pot',
                bookshelf: 'bookshelf',
                printer: 'printer'
              };
              const sheetKey = 'mo_black_shadow_32';
              if (!this.textures.exists(sheetKey)) {
                useModernOffice = false;
              }
              if (useModernOffice) {
                const img = this.textures.get(sheetKey).getSourceImage();
                const built = new Set();
                world.objects.forEach((obj) => {
                  const catalogId = prefabToCatalog[obj.prefabId];
                  if (!catalogId) return;
                  const def = openplanCatalog.objects[catalogId];
                  if (!def || def.sheet !== sheetKey) return;
                  const w = def.w || 32;
                  const h = def.h || 32;
                  const texKey = `mo_ref_${catalogId}`;
                  if (!built.has(texKey)) {
                    built.add(texKey);
                    if (this.textures.exists(texKey)) this.textures.remove(texKey);
                    const canvasTex = this.textures.createCanvas(texKey, w, h);
                    canvasTex.context.imageSmoothingEnabled = false;
                    canvasTex.context.drawImage(img, def.x, def.y, w, h, 0, 0, w, h);
                    canvasTex.refresh();
                  }
                  const originY = (def.origin === 'center') ? 0.5 : 1;
                  const s = this.add.image(obj.x, obj.y, texKey).setOrigin(0.5, originY);
                  s.setDepth(def.depth != null ? def.depth : (def.type === 'decor' ? 2 : 1.5));
                });
              }
            }
            if (!useModernOffice && catalog && catalog.prefabs && catalog.sheets && Array.isArray(world.objects)) {
              const prefabSprites = {};
              Object.entries(catalog.prefabs).forEach(([id, def]) => {
                const sheetInfo = catalog.sheets[def.sheet];
                if (!sheetInfo) return;
                const imageKey = sheetInfo.imageKey;
                if (!this.textures.exists(imageKey)) return;
                const img = this.textures.get(imageKey).getSourceImage();
                const { x, y, w, h } = def.rect;
                const texKey = `int_${id}`;
                if (this.textures.exists(texKey)) this.textures.remove(texKey);
                const canvasTex = this.textures.createCanvas(texKey, w, h);
                canvasTex.context.imageSmoothingEnabled = false;
                canvasTex.context.drawImage(img, x, y, w, h, 0, 0, w, h);
                canvasTex.refresh();

                prefabSprites[id] = ({ scene, x: px, y: py }) => {
                  const originY = def.origin === 'center' ? 0.5 : 1;
                  return scene.add.image(px, py, texKey).setOrigin(0.5, originY);
                };
              });

              world.objects.forEach((obj) => {
                const def = catalog.prefabs[obj.prefabId];
                const factory = prefabSprites[obj.prefabId];
                if (!def || !factory) return;
                const s = factory({ scene: this, x: obj.x, y: obj.y });
                const depth = def.type === 'decor' ? 2 : 1.5;
                s.setDepth(depth);
              });
            }
          });
      });
      // Fall through so player/NPC setup runs.
    }

    // Collect all static collision obstacles (walls + furniture bases).
    // Must exist before wall creation (drawWallRectTiles pushes into it).
    this._obstacles = [];
    this.obstacles = this.physics.add.staticGroup();
    // Any push onto _obstacles also joins the Arcade staticGroup the player collides with.
    const _obsList = this._obstacles;
    const _obsGroup = this.obstacles;
    const _origPush = _obsList.push.bind(_obsList);
    _obsList.push = (...items) => {
      for (const o of items) {
        if (!o) continue;
        _origPush(o);
        try { _obsGroup.add(o); } catch (_) {}
      }
      return _obsList.length;
    };
    this._obstacleSink = {
      push: (o) => { if (o) _obsList.push(o); },
      add: (o) => { if (o) _obsList.push(o); },
    };

    // Shared layout measurements (used for spawn points, etc.)
    const corridorY = 260;
    const corridorH = 140;
    const bottomY = corridorY + corridorH + 16;
    const bottomH = height - bottomY - 24;

    // Layout override: open-plan office uses proper 3-layer wall system.
    if (layoutParam === 'promo' || this._skipHandcraftedLayout || layoutParam === 'openplan') {
      // LAYER 2 & 3: Wall layout from data/openplan_walls.json (editable in wall editor mode)
      const wallLayout = this.cache.json.get('openplan_walls');
      if (window.OpenplanWalls && wallLayout) {
        this._wallLayoutInfo = wallLayout.info || {};
        this._wallLayoutSegments = wallLayout.segments || [];
        window.OpenplanWalls.renderLayout(this, wallLayout, this._obstacleSink);
      } else {
        console.warn('[OfficeScene] openplan_walls.json or OpenplanWalls missing — no walls drawn');
      }

      // Continue with character setup + furniture placement.
    } else {
    try { console.log('[BootTiming] before office layout / world-gen', performance.now()); } catch (_) {}
    // --- Office layout (tile-based): rooms + corridor like the reference screenshot ---
    // We render walls using a solid wall tile from `wall_tiles`, and keep collisions via static rectangles.
    // Wall tile: Room Builder Office — white office wall panel at pixel (0, 0) in the Room Builder sheet
    // The top-left of the Room Builder sheet has clean white wall sections with dark blue trim lines.
    const wallTileSize = 32;
    if (this.textures.exists('wall_single')) this.textures.remove('wall_single');
    const wallSingle = this.textures.createCanvas('wall_single', wallTileSize, wallTileSize);
    wallSingle.context.imageSmoothingEnabled = false;
    wallSingle.context.clearRect(0, 0, wallTileSize, wallTileSize);
    if (rbImg) {
      // Room Builder wall: solid white wall fill tile at pixel (320, 0)
      wallSingle.context.drawImage(rbImg, 320, 0, 32, 32, 0, 0, wallTileSize, wallTileSize);
    } else {
      wallSingle.context.fillStyle = '#d4c8b8';
      wallSingle.context.fillRect(0, 0, wallTileSize, wallTileSize);
    }
    wallSingle.refresh();

    const drawWallRectTiles = (x, y, w, h) => {
      const tx0 = Math.floor(x / wallTileSize);
      const ty0 = Math.floor(y / wallTileSize);
      const tx1 = Math.ceil((x + w) / wallTileSize);
      const ty1 = Math.ceil((y + h) / wallTileSize);
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          this.add.image(tx * wallTileSize, ty * wallTileSize, 'wall_single')
            .setOrigin(0, 0)
            .setDepth(5);
        }
      }
      // Collision
      const obstacle = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0);
      this.physics.add.existing(obstacle, true);
      this._obstacles.push(obstacle);
    };

    // Outer border (tile walls)
    drawWallRectTiles(0, 0, width, 24);
    drawWallRectTiles(0, 0, 24, height);
    drawWallRectTiles(width - 24, 0, 24, height);
    drawWallRectTiles(0, height - 24, width, 24);

    // Corridor top/bottom boundaries
    drawWallRectTiles(0, corridorY - 16, width, 16);
    drawWallRectTiles(0, corridorY + corridorH, width, 16);

    // Top row: 3 small rooms (dividers)
    const roomTopY = 24;
    const roomH = corridorY - roomTopY - 16;
    const roomW = Math.floor((width - 24 * 2 - 40 * 2) / 3);
    const gap = 40;
    let rx = 24 + gap;
    for (let i = 0; i < 3; i++) {
      drawWallRectTiles(rx - 8, roomTopY, 8, roomH);
      drawWallRectTiles(rx + roomW, roomTopY, 8, roomH);
      drawWallRectTiles(rx - 8, roomTopY, roomW + 16, 8);
      rx += roomW + gap;
    }

    // Bottom-left security room divider + bottom-right room boundary
    drawWallRectTiles(24, bottomY, Math.floor(width * 0.58), 8);
    drawWallRectTiles(Math.floor(width * 0.58), bottomY, 8, bottomH);
    drawWallRectTiles(Math.floor(width * 0.58) + 8, bottomY, width - (Math.floor(width * 0.58) + 8) - 24, 8);

    // Corridor floor strip (dark) + clinic room floor (blue) to match reference.
    const corridorFloor = this.add.tileSprite(width / 2, corridorY + corridorH / 2, width - 48, corridorH, 'corridor_single');
    corridorFloor.setDepth(1);
    // Clinic room = bottom-right area
    const clinicX0 = Math.floor(width * 0.58) + 8;
    const clinicW = width - clinicX0 - 24;
    const clinicFloor = this.add.tileSprite(
      clinicX0 + clinicW / 2,
      bottomY + bottomH / 2,
      clinicW,
      bottomH,
      'clinic_single'
    );
    clinicFloor.setDepth(0.5);
    }

    // Arcade physics
    this.physics.world.setBounds(0, 0, width, height);

    // Unified animation registration for all XP characters.
    // Registers walk + idle anims for any texture key. Safe to call multiple times.
    const registerXpAnims = (texKey) => {
      const makeKey = (k) => `${texKey}:${k}`;
      if (!this.textures.exists(texKey)) return makeKey;
      const defs = {
        // Slightly higher frame rate so legs match the snappier walk speed.
        walk_down:  { frames: [0, 1, 2, 3],   fps: 13, loop: true },
        walk_left:  { frames: [4, 5, 6, 7],   fps: 13, loop: true },
        walk_right: { frames: [8, 9, 10, 11], fps: 13, loop: true },
        walk_up:    { frames: [12, 13, 14, 15], fps: 13, loop: true },
        idle_down:  { frames: [0],  fps: 0, loop: true },
        idle_left:  { frames: [4],  fps: 0, loop: true },
        idle_right: { frames: [8],  fps: 0, loop: true },
        idle_up:    { frames: [12], fps: 0, loop: true }
      };
      if (!this.anims.exists(makeKey('walk_down'))) {
        Object.entries(defs).forEach(([name, def]) => {
          this.anims.create({
            key: makeKey(name),
            frames: this.anims.generateFrameNumbers(texKey, { frames: def.frames }),
            frameRate: def.fps,
            repeat: def.loop === false ? 0 : -1
          });
        });
      }
      return makeKey;
    };

    // Register XP animations for NPCs
    registerXpAnims('player_xp');

    // --- Dolo: Character Generator 2.0 (24 cols x 1 row, 32x64 frames) ---
    // 4 dirs × 6 frames: RIGHT(0-5), UP(6-11), LEFT(12-17), DOWN(18-23)
    // Idle = frame 0 of each direction (neutral standing pose)
    const registerDoloAnims = () => {
      const texKey = 'dolo';
      const makeKey = (k) => `${texKey}:${k}`;
      const defs = {
        idle_right: { frames: [2],                     fps: 1 },
        idle_up:    { frames: [8],                     fps: 1 },
        idle_left:  { frames: [14],                    fps: 1 },
        // frame 22, not 20. Measured against the canonical down idle pose
        // (dolonia.png f74): frame 20 is 208px off — a mid-stride walk frame —
        // while 22 is 61px, the closest in the row. Down is the DEFAULT facing,
        // so this is the idle pose the player sees most of the time.
        idle_down:  { frames: [22],                    fps: 1 },
        walk_right: { frames: [0, 1, 2, 3, 4, 5],     fps: 13 },
        walk_up:    { frames: [6, 7, 8, 9, 10, 11],   fps: 13 },
        walk_left:  { frames: [12, 13, 14, 15, 16, 17], fps: 13 },
        walk_down:  { frames: [18, 19, 20, 21, 22, 23], fps: 13 }
      };
      Object.entries(defs).forEach(([name, def]) => {
        this.anims.create({
          key: makeKey(name),
          frames: this.anims.generateFrameNumbers(texKey, { frames: def.frames }),
          frameRate: def.fps,
          repeat: -1
        });
      });
      return makeKey;
    };
    this._playerAnimKey = registerDoloAnims();

    // --- Dolo phone animations (3 phases) ---
    // phone_open: pull out phone (frames 0-5), play once
    this.anims.create({
      key: 'dolo:phone_open',
      frames: this.anims.generateFrameNumbers('dolo_phone', { start: 0, end: 5 }),
      frameRate: 8,
      repeat: 0
    });
    // phone_idle: looking at phone (frames 4-5), loop
    this.anims.create({
      key: 'dolo:phone_idle',
      frames: this.anims.generateFrameNumbers('dolo_phone', { frames: [4, 5] }),
      frameRate: 3,
      repeat: -1
    });
    // phone_close: put phone away (frames 6-11), play once
    this.anims.create({
      key: 'dolo:phone_close',
      frames: this.anims.generateFrameNumbers('dolo_phone', { start: 6, end: 11 }),
      frameRate: 8,
      repeat: 0
    });

    // --- Dolo sit animations (16x32 frames, 12 total = 6 poses × 2 dirs) ---
    // Pairs: [left, right] for each pose. Poses 0-2 = sit down, 3-4 = idle, 5 = variant
    // sit_down_left: frames 0,2,4 (even = left), play once
    this.anims.create({
      key: 'dolo:sit_down_left',
      frames: this.anims.generateFrameNumbers('dolo_sit', { frames: [0, 2, 4] }),
      frameRate: 6,
      repeat: 0
    });
    // sit_down_right: frames 1,3,5 (odd = right), play once
    this.anims.create({
      key: 'dolo:sit_down_right',
      frames: this.anims.generateFrameNumbers('dolo_sit', { frames: [1, 3, 5] }),
      frameRate: 6,
      repeat: 0
    });
    // sit_idle_left: last left pose loops
    this.anims.create({
      key: 'dolo:sit_idle_left',
      frames: this.anims.generateFrameNumbers('dolo_sit', { frames: [4, 6, 8] }),
      frameRate: 2,
      repeat: -1
    });
    // sit_idle_right: last right pose loops
    this.anims.create({
      key: 'dolo:sit_idle_right',
      frames: this.anims.generateFrameNumbers('dolo_sit', { frames: [5, 7, 9] }),
      frameRate: 2,
      repeat: -1
    });
    // stand_up_left: reverse of sit down
    this.anims.create({
      key: 'dolo:stand_up_left',
      frames: this.anims.generateFrameNumbers('dolo_sit', { frames: [4, 2, 0] }),
      frameRate: 6,
      repeat: 0
    });
    // stand_up_right: reverse of sit down
    this.anims.create({
      key: 'dolo:stand_up_right',
      frames: this.anims.generateFrameNumbers('dolo_sit', { frames: [5, 3, 1] }),
      frameRate: 6,
      repeat: 0
    });

    // --- Robber: Character Generator 2.0 (same layout as Dolo) ---
    // 4 dirs × 6 frames: RIGHT(0-5), UP(6-11), LEFT(12-17), DOWN(18-23)
    const registerRobberAnims = () => {
      const texKey = 'robber';
      const makeKey = (k) => `${texKey}:${k}`;
      const defs = {
        idle_right: { frames: [2],                     fps: 1 },
        idle_up:    { frames: [8],                     fps: 1 },
        idle_left:  { frames: [14],                    fps: 1 },
        idle_down:  { frames: [20],                    fps: 1 },
        walk_right: { frames: [0, 1, 2, 3, 4, 5],     fps: 13 },
        walk_up:    { frames: [6, 7, 8, 9, 10, 11],   fps: 13 },
        walk_left:  { frames: [12, 13, 14, 15, 16, 17], fps: 13 },
        walk_down:  { frames: [18, 19, 20, 21, 22, 23], fps: 13 },
      };
      Object.entries(defs).forEach(([name, def]) => {
        this.anims.create({
          key: makeKey(name),
          frames: this.anims.generateFrameNumbers(texKey, { frames: def.frames }),
          frameRate: def.fps,
          repeat: -1,
        });
      });
    };
    registerRobberAnims();

    // --- Player character (Dolo) ---
    // Character Generator 2.0 sprites are 16x32, designed for LimeZu 32x32 tileset
    this.player = this.physics.add.sprite(310, 200, 'dolo', 0);
    this.player.setOrigin(0.5, 1);
    this.player.setScale(1); // native 32x64, natural proportions
    this.player.setCollideWorldBounds(true);
    this.player.setFrame(20); // front-facing idle (down) - 3rd frame is standing pose
    // Shrink physics body to foot hitbox
    this.player.body.setSize(14, 10);
    this.player.body.setOffset(9, 54);
    // Keep max velocity above walk speed (touch can push ~700+).
    this.player.body.setMaxVelocity(800, 800);
    this.player.setDrag(0, 0);
    const scale = 1; // used by NPCs below

    // Camera: Pokémon-style — hard-lock follow, tier zoom, clamp to world
    this.cameras.main.setBounds(0, 0, 1280, 720);
    this._applyPlayfieldCamera();
    this._onDeviceProfileChange = () => this._applyPlayfieldCamera();
    window.addEventListener('denizen-device-profile-change', this._onDeviceProfileChange);

    // --- NPCs: spawn all XP characters and make them wander/follow-chain ---
    this.npcs = [];
    let npcKeys = [
      'xp_abby',
      'xp_alex',
      'xp_bob',
      'xp_dan',
      'xp_jenny',
      'xp_lucy',
      'xp_bouncer',
      'xp_conference_man',
      'xp_conference_woman',
      'xp_edward',
      'xp_josh',
      'xp_molly',
      'xp_oscar',
      'xp_pier',
      'xp_rob',
      'xp_roki'
    ];
    const roster = globalThis.DenizenNpcRoster;
    if (roster && roster.entries && roster.entries.length > 0) {
      npcKeys = roster.entries.map(e => 'xp_' + e.folder);
    }

    // Spawn NPCs at desk chairs in the open office and spread others around rooms.
    const deskSpawns = [
      { x: 128, y: 156 }, { x: 196, y: 156 }, { x: 388, y: 156 }, { x: 456, y: 156 },
      { x: 648, y: 156 }, { x: 716, y: 156 }, { x: 128, y: 296 }, { x: 196, y: 296 },
      { x: 388, y: 296 }, { x: 456, y: 296 }, { x: 648, y: 296 }, { x: 716, y: 296 },
      { x: 388, y: 406 }, { x: 456, y: 406 }, { x: 648, y: 406 }, { x: 716, y: 406 }
    ];
    const otherSpawns = [
      { x: 1060, y: 160 }, { x: 520, y: 320 }, { x: 620, y: 580 }, { x: 1040, y: 390 },
      { x: 300, y: 300 }, { x: 700, y: 350 }, { x: 950, y: 580 }, { x: 440, y: 530 }
    ];
    // Always spawn the full roster. Light-perf used to cap at 6–12 and
    // people vanished from the floor; pathfinding/sep already throttle cost.
    const npcCount = layoutParam === 'reference_office' ? 2 : npcKeys.length;
    try {
      console.log('[Office] spawning NPCs', npcCount, '/', npcKeys.length, npcKeys.join(','));
    } catch (_) {}
    npcKeys.slice(0, npcCount).forEach((texKey, i) => {
      if (!this.textures.exists(texKey)) {
        try { console.warn('[Office] missing texture, skip NPC', texKey); } catch (_) {}
        return;
      }
      const spawn = i < deskSpawns.length ? deskSpawns[i] : otherSpawns[i - deskSpawns.length] || { x: Phaser.Math.Between(120, 1100), y: Phaser.Math.Between(120, 600) };
      const x = spawn.x + Phaser.Math.Between(-10, 10);
      const y = spawn.y + Phaser.Math.Between(-10, 10);
      const npc = this.physics.add.sprite(x, y, texKey, 8);
      npc.setOrigin(0.5, 1);
      npc.setScale(scale);
      // Furniture/desk anchors are resolved a moment later. Keep the generic
      // spawn pose hidden so users never see the roster pop from spawn points
      // back into chairs during boot.
      npc.setVisible(false);
      npc._bootHidden = true;
      npc.setCollideWorldBounds(true);
      npc.setDrag(700, 700);
      // Cap must sit above wander/follow speed + separation so NPCs aren't soft-clamped.
      npc.body.setMaxVelocity(320, 320);
      // Shrink physics body to small foot hitbox so NPCs navigate between desks
      npc.body.setSize(10, 8);
      npc.body.setOffset(3, 16);
      npc.ai = {
        // Hold still during boot. AgentOfficeManager assigns the real desk and
        // seated pose once furniture anchors are ready; starting in wander
        // made NPCs walk briefly, then visibly snap back to their chairs.
        mode: 'agent_task',
        facing: 'right',
        taskState: 'loading',
        taskTarget: { x, y },
        nextWanderAt: Number.POSITIVE_INFINITY,
        wanderTarget: { x, y },
        followOffset: { x: (i % 4) * 32 - 48, y: Math.floor(i / 4) * 28 - 28 }
      };
      npc._animKey = registerXpAnims(texKey);
      this.npcs.push(npc);
      this.time.delayedCall(8000, () => {
        // Failsafe only: AgentActions normally reveals the NPC as soon as its
        // real chair pose is applied.
        if (npc._bootHidden) {
          npc._bootHidden = false;
          npc.setVisible(true);
        }
      });
    });

    // Hotkeys: F = toggle follow-chain. (Wander toggle moved off W so W can
    // drive player movement — see WASD setup below.)
    this.aiKeys = this.input.keyboard.addKeys('F');
    this.aiKeys.F.on('down', () => {
      this.npcs.forEach((n) => { n.ai.mode = 'follow'; });
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    // WASD movement, in addition to the arrow keys.
    this.wasd = this.input.keyboard.addKeys({ up: 'W', left: 'A', down: 'S', right: 'D' });
    this.interactKeys = this.input.keyboard.addKeys({ E: 'E', SPACE: 'SPACE' });
    // Are we typing in an HTML field (chat / login)? When so, the update loop
    // ignores movement + interact keys so they reach the field instead of
    // driving the player.
    this._typingInField = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    // createCursorKeys()/addKeys() register a preventDefault capture for W, A,
    // S, D, E, Space and the arrows. That capture fires on the global keydown
    // BEFORE a focused HTML input receives the character, so it silently eats
    // those keys in the login modal and chat box — most visibly W and Space.
    // The login modal mounts before this scene's create() runs, so the old
    // focusin → disableGlobalCapture() hook never got a chance to release the
    // capture for that first field. The page body is fixed / overflow:hidden,
    // so none of these keys can scroll anything; clear the captures outright so
    // every key reaches a focused field. The Key objects still track isDown, so
    // movement keeps working.
  const _kbd = this.input.keyboard;
    _kbd.clearCaptures();
    // Do NOT call disableGlobalCapture() on input focus — it detaches Phaser's
    // key listeners entirely, so WASD/arrows stop updating isDown while phone or
    // chat fields hold focus (and sometimes forever if focusout never fires).
    this._installRawMoveKeys();
    this._installCanvasRefocus();
    this.events.on('postupdate', this._applyRawKeyMovement, this);
    this.playerState = 'walk'; // 'walk' | 'interacting'
    this.playerLocked = false;

    this.dialogBox = null;

    // Track which way the player is facing for better idle behavior.
    // Possible values: 'down', 'up', 'left', 'right'
    this.facing = 'right';

    try { console.log('[BootTiming] before furniture loader', performance.now()); } catch (_) {}
    // --- Universal Object Loader (furniture_catalog = pixel-perfect slicing, bottom anchor, decor stacking) ---
    this.furnitureDecorSprites = [];
    this._placedCatalogSprites = {}; // instanceId -> sprite for decor parent lookup
    if (!Array.isArray(this._obstacles)) this._obstacles = [];
    this._interactables = []; // { id, sprite, def, taskId? }
    // In reference_office seeded mode, furniture is already placed from the recipe; skip duplicate placements.
    const skipCatalogPlacements = this._skipHandcraftedLayout && layoutParam === 'reference_office';
    const furnitureCatalog = skipCatalogPlacements
      ? null
      : this.cache.json.get('furniture_catalog_openplan');

    const defaultPlacements = furnitureCatalog?.placements;
    const layoutSid = globalThis.DenizenVisitorSession?.getSessionId?.();
    const layoutUrl = layoutSid
      ? `/api/layout?session_id=${encodeURIComponent(layoutSid)}`
      : '/api/layout';

    const spawnLayoutExtras = (saved, attempt = 0) => {
      const items = saved?.items;
      if (!Array.isArray(items) || !items.length) return;
      // DenizenLiveFurniture is defined by the editor tail closure, which
      // boots on a retry loop — wait for it instead of dropping NPC items.
      if (!window.DenizenLiveFurniture?.spawn) {
        if (attempt < 40) setTimeout(() => spawnLayoutExtras(saved, attempt + 1), 300);
        return;
      }
      items.forEach((item) => {
        const placement = item.prefabId
          ? {
            id: item.prefabId,
            instanceId: item.instanceId || `saved_${item.prefabId}_${item.x}_${item.y}`,
            x: item.x,
            y: item.y,
          }
          : item;
        try { window.DenizenLiveFurniture.spawn(placement); } catch (_) {}
      });
      console.log('[OfficeScene] Applied per-office layout extras (' + items.length + ' items)');
    };

    const beginCatalogPlacements = (placementList) => {
      if (this._catalogPlacementsStarted) return;
      const placements = placementList;
      const catalogObjects = furnitureCatalog?.objects;
      const sliceMargin = (furnitureCatalog?.info?.slice_margin_px !== undefined) ? furnitureCatalog.info.slice_margin_px : 0;
      if (!catalogObjects || !Array.isArray(placements) || !placements.length) return;
      this._catalogPlacementsStarted = true;

      // Build texture for each object id from catalog (pixel x,y,w,h; optional 2px margin for shadows)
      // Master catalog support: defs might originate in master_furniture_catalog instead of local objects
      const masterCatalog = this.cache.json.get('master_furniture_catalog');
      const masterObjs = masterCatalog ? masterCatalog.objects : {};
      
      const requiresDynamicLoad = new Set();

      placements.forEach((pl) => {
        const id = pl.id;
        let def = id ? catalogObjects[id] : null;
        if (!def && id && masterObjs[id]) def = masterObjs[id];
        if (!def) return;
        
        if (def.source_type === 'single_file') {
           // Singles are preloaded in preload() as single_${catalog object id}.
           if (!this.textures.exists(`single_${pl.id}`) && def.url_path) {
             const fullUrl = def.url_path.replace(/\\/g, '/');
             requiresDynamicLoad.add({ id: pl.id, url: fullUrl });
           }
           return;
        }

        const sheetKey = def.sheet;
        if (!sheetKey || !this.textures.exists(sheetKey)) return;
        const img = this.textures.get(sheetKey).getSourceImage();
        let sx = def.rect ? def.rect.x : (def.x || 0);
        let sy = def.rect ? def.rect.y : (def.y || 0);
        let sw = Math.max(1, def.rect ? def.rect.w : (def.w || 16));
        let sh = Math.max(1, def.rect ? def.rect.h : (def.h || 16));
        if (sliceMargin > 0) {
          const ms = sliceMargin;
          sx = Math.max(0, sx - ms);
          sy = Math.max(0, sy - ms);
          sw = Math.min(img.width - sx, sw + 2 * ms);
          sh = Math.min(img.height - sy, sh + 2 * ms);
        }
        const texKey = `cat_${pl.id}`;
        if (this.textures.exists(texKey)) return;
        const canvasTex = this.textures.createCanvas(texKey, sw, sh);
        canvasTex.context.imageSmoothingEnabled = false;
        canvasTex.context.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        canvasTex.refresh();
      });

      // Define a helper to actually place the objects once assets are ready
      const finalizePlacements = () => {
        // Place furniture first (bottom-center = placement x,y)
        placements.forEach((pl) => {
          if (pl.parentInstanceId) return; // decor placed after
          let def = catalogObjects[pl.id];
          if (!def && masterObjs[pl.id]) def = masterObjs[pl.id];

          let texKey = `cat_${pl.id}`;
          if (def && def.source_type === 'single_file') texKey = `single_${pl.id}`;

          if (!def || !this.textures.exists(texKey)) return;
          const originY = def.origin === 'center' ? 0.5 : 1;
          const depth = furnitureRenderDepth(pl.y, def, pl);
          const s = this.add.image(pl.x, pl.y, texKey).setOrigin(0.5, originY).setDepth(depth);
          if (def.source_type === 'single_file') {
            const dw = def.display_w || 32;
            const dh = def.display_h || 48;
            s.setDisplaySize(dw, dh);
          }
          applyPlacementTransform(s, pl, def);
          this.furnitureDecorSprites.push({ sprite: s, depth });
          const instanceId = pl.instanceId || pl.id;
          this._placedCatalogSprites[instanceId] = s;
          const interactable = { id: pl.id, instanceId, sprite: s, def: { ...def, _placement: pl }, obstacle: null, parentInstanceId: null };

          // Footprint collision: base hitbox only (Y-sort handles walk-behind).
          // On-desk / stackables / wall-mount decor skip bodies via shouldCollide.
          const engine = window.DenizenMapEngine;
          const wantsCollision = engine
            ? engine.shouldCollide(def, pl)
            : (!/couch|sofa|bench/i.test(String(pl.id || '')) && def.type !== 'decor' && def.type !== 'seat' && s.displayWidth >= 48);
          if (wantsCollision) {
            const b = engine
              ? engine.resolveCollisionBounds(def, s.displayWidth, s.displayHeight)
              : { width: Math.min(s.displayWidth, 64), height: 16, offsetX: 0, offsetY: 0 };
            const foot = engine?.footprintWorldRect
              ? engine.footprintWorldRect(s.x, s.y, b)
              : { x: pl.x, y: pl.y - 8, width: b.width, height: b.height };
            const obstacle = this.add.rectangle(foot.x, foot.y, foot.width, foot.height, 0x000000, 0);
            this.physics.add.existing(obstacle, true);
            this._obstacleSink.push(obstacle);
            interactable.obstacle = obstacle;
          }
          this._interactables.push(interactable);
        });
        
        // Place decor on parent + offset (smart stacking)
        placements.forEach((pl) => {
          if (!pl.parentInstanceId) return;
          let def = catalogObjects[pl.id];
          if (!def && masterObjs[pl.id]) def = masterObjs[pl.id];
          
          const parentSprite = this._placedCatalogSprites[pl.parentInstanceId];
          
          let texKey = `cat_${pl.id}`;
          if (def && def.source_type === 'single_file') texKey = `single_${pl.id}`;

          if (!def || !parentSprite || !this.textures.exists(texKey)) return;
          const offsetY = pl.parent_offset_y !== undefined ? pl.parent_offset_y : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
          const offsetX = pl.parent_offset_x !== undefined ? pl.parent_offset_x : (def.parent_offset_x !== undefined ? def.parent_offset_x : 0);
          const px = parentSprite.x + offsetX;
          const py = parentSprite.y + offsetY;
          const depth = furnitureRenderDepth(py, def, pl);
          const originY = def.origin === 'center' ? 0.5 : 1;
          const s = this.add.image(px, py, texKey).setOrigin(0.5, originY).setDepth(depth);
          if (def.source_type === 'single_file') {
            const dw = def.display_w || 32;
            const dh = def.display_h || 48;
            s.setDisplaySize(dw, dh);
          }
          applyPlacementTransform(s, pl, def);
          this.furnitureDecorSprites.push({ sprite: s, depth });
          const instanceId = pl.instanceId || pl.id;
          this._interactables.push({ id: pl.id, instanceId, sprite: s, def: { ...def, _placement: pl }, obstacle: null, parentInstanceId: pl.parentInstanceId || null });
        });

        // Fix decor depth: ensure decor items (laptops, monitors, etc.) render above
        // any surface (desk) they visually sit on. Checks if decor is above and near a surface.
        // Skip wall-hung props — they must stay in the wall band (~1.55), not desk stack depth.
        const surfaces = this._interactables.filter(it => it.def?.type === 'surface');
        const decors = this._interactables.filter(it => it.def?.type === 'decor');
        decors.forEach(decor => {
          if (!decor.sprite) return;
          const pl = decor.def?._placement || decor;
          if (pl?.wallMount || decor.def?.wall_mount || window.DenizenMapEngine?.isWallMount?.(decor.id, decor.def, pl)) {
            return;
          }
          const dx = decor.sprite.x, dy = decor.sprite.y;
          surfaces.forEach(surf => {
            if (!surf.sprite) return;
            const sx = surf.sprite.x, sy = surf.sprite.y;
            const sw = surf.sprite.displayWidth / 2 + 40;
            // Decor is above the surface (up to 100px) and horizontally overlapping
            if (Math.abs(dx - sx) < sw && dy < sy && dy > sy - 100) {
              if (decor.sprite.depth <= surf.sprite.depth) {
                decor.sprite.setDepth(surf.sprite.depth + 8);
              }
            }
          });
        });
        // Re-assert wall-mount depths after any Y-sort / desk rebases.
        this._interactables.forEach((it) => {
          const pl = it.def?._placement || it;
          if (!it.sprite) return;
          if (pl?.wallMount || it.def?.wall_mount || window.DenizenMapEngine?.isWallMount?.(it.id, it.def, pl)) {
            it.sprite.setDepth(furnitureRenderDepth(it.sprite.y, it.def, pl));
          }
        });
      };
      
      const placeMissingSingles = () => {
        placements.forEach((pl) => {
          const def = catalogObjects[pl.id] || masterObjs[pl.id];
          if (!def || def.source_type !== 'single_file') return;
          const texKey = `single_${pl.id}`;
          if (!this.textures.exists(texKey)) return;
          const instanceId = pl.instanceId || pl.id;
          if (this._placedCatalogSprites[instanceId]) return;

          let x = pl.x;
          let y = pl.y;
          if (pl.parentInstanceId) {
            const parentSprite = this._placedCatalogSprites[pl.parentInstanceId];
            if (!parentSprite) return;
            const offsetY = pl.parent_offset_y !== undefined ? pl.parent_offset_y : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
            const offsetX = pl.parent_offset_x !== undefined ? pl.parent_offset_x : (def.parent_offset_x !== undefined ? def.parent_offset_x : 0);
            x = parentSprite.x + offsetX;
            y = parentSprite.y + offsetY;
          }
          const depth = furnitureRenderDepth(y, def, pl);
          const originY = def.origin === 'center' ? 0.5 : 1;
          const s = this.add.image(x, y, texKey).setOrigin(0.5, originY).setDepth(depth);
          s.setDisplaySize(def.display_w || 32, def.display_h || 48);
          applyPlacementTransform(s, pl, def);
          this.furnitureDecorSprites.push({ sprite: s, depth });
          this._placedCatalogSprites[instanceId] = s;
          const interactable = {
            id: pl.id,
            instanceId,
            sprite: s,
            def: { ...def, _placement: pl },
            obstacle: null,
            parentInstanceId: pl.parentInstanceId || null
          };
          const engine = window.DenizenMapEngine;
          if (!pl.parentInstanceId && engine?.shouldCollide?.(def, pl)) {
            const b = engine.resolveCollisionBounds(def, s.displayWidth, s.displayHeight);
            const foot = engine.footprintWorldRect(s.x, s.y, b);
            const obstacle = this.add.rectangle(foot.x, foot.y, foot.width, foot.height, 0x000000, 0);
            this.physics.add.existing(obstacle, true);
            this._obstacleSink.push(obstacle);
            interactable.obstacle = obstacle;
          }
          this._interactables.push(interactable);
        });
      };

      const runPlacements = () => {
        // Place spritesheet furniture immediately — never block on loader inside create().
        finalizePlacements();
        if (requiresDynamicLoad.size === 0) return;

        const pending = [...requiresDynamicLoad].filter((req) => !this.textures.exists(`single_${req.id}`));
        if (pending.length === 0) {
          placeMissingSingles();
          return;
        }

        pending.forEach((req) => {
          this.load.image(`single_${req.id}`, req.url);
        });
        this.load.once('complete', placeMissingSingles);
        if (!this.load.isLoading()) this.load.start();
      };
      runPlacements();
      notifyOfficeFurnitureReady(this);
    };

    // Street-door dressing at the south wall gap (x 608-672): exit sign +
    // doormat. The gap itself comes from wall_perim_bottom doorGaps.
    this.add.text(640, 660, 'EXIT', {
      fontFamily: 'monospace', fontSize: '9px', color: '#22c55e',
      backgroundColor: '#0f172a', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setDepth(1.4).setResolution(2);
    this.add.rectangle(640, 706, 56, 22, 0x8b7355, 1).setDepth(0.6);
    this.add.rectangle(640, 706, 50, 16, 0xa08563, 1).setDepth(0.61);

    if (furnitureCatalog) {
      fetch(layoutUrl)
        .then((r) => (r.ok ? r.json() : null))
        .then((saved) => {
          const savedPlacements = Array.isArray(saved?.placements) ? saved.placements : null;
          const use = savedPlacements?.length ? savedPlacements : defaultPlacements;
          // Prefer walls saved with the live layout (editor edits) over catalog JSON
          if (saved?.walls?.segments?.length && window.OpenplanWalls) {
            this._wallLayoutInfo = saved.walls.info || this._wallLayoutInfo || {};
            window.OpenplanWalls.renderLayout(this, saved.walls, this._obstacleSink || this._obstacles);
            console.log('[OfficeScene] Loaded saved walls (' + saved.walls.segments.length + ' segments)');
          }
          beginCatalogPlacements(use);
          if (savedPlacements?.length) {
            if (this._editorState) {
              this._editorState.placements = JSON.parse(JSON.stringify(savedPlacements));
            }
            console.log('[OfficeScene] Loaded saved placements (' + savedPlacements.length + ' items)');
          }
          spawnLayoutExtras(saved);
        })
        .catch(() => beginCatalogPlacements(defaultPlacements));
    } else {
      // Fallback: object-defs (tile-index) + desk/computer placement
      const BASE_GRID = 16;
      const SHEET_TILE = 32;
      const TILES_PER_ROW = 24;
      const od = this.cache.json.get('object_defs');
      const objects = (od && od.objects) ? od.objects : {};
      const sheetTex = this.textures.get('office_tiles')?.getSourceImage();
      if (sheetTex && Object.keys(objects).length > 0) {
        const furniture = [];
        const decor = [];
        Object.entries(objects).forEach(([key, obj]) => {
          const topLeftIndex = obj.topLeftIndex ?? 0;
          const w = Math.max(1, obj.w ?? 1);
          const h = Math.max(1, obj.h ?? 1);
          const pixelW = w * BASE_GRID;
          const pixelH = h * BASE_GRID;
          const col = topLeftIndex % TILES_PER_ROW;
          const row = Math.floor(topLeftIndex / TILES_PER_ROW);
          const sx = col * SHEET_TILE;
          const sy = row * SHEET_TILE;
          const texKey = `obj_${key}`;
          if (this.textures.exists(texKey)) this.textures.remove(texKey);
          const canvasTex = this.textures.createCanvas(texKey, pixelW, pixelH);
          canvasTex.context.imageSmoothingEnabled = false;
          canvasTex.context.drawImage(sheetTex, sx, sy, pixelW, pixelH, 0, 0, pixelW, pixelH);
          canvasTex.refresh();
          const depth = typeof obj.depth === 'number' ? obj.depth : (obj.type === 'decor' ? 2 : 1.5);
          const entry = { key, texKey, pixelW, pixelH, depth, render_offset: obj.render_offset || { x: 0, y: 0 }, type: obj.type, pivot: obj.pivot || 'bottom' };
          if (obj.type === 'decor') decor.push(entry);
          else furniture.push(entry);
        });
        const place = (entry, worldX, worldY) => {
          const x = worldX + (entry.render_offset?.x || 0);
          const y = worldY + (entry.render_offset?.y || 0);
          const originY = entry.pivot === 'center' ? 0.5 : 1;
          const s = this.add.image(x, y, entry.texKey).setOrigin(0.5, originY).setDepth(entry.depth);
          this.furnitureDecorSprites.push({ sprite: s, depth: entry.depth });

          if (entry.type !== 'decor') {
            const obstacle = this.add.rectangle(x, y, s.displayWidth, 16, 0x000000, 0);
            obstacle.setOrigin(0.5, 1);
            this.physics.add.existing(obstacle, true);
            this._obstacles.push(obstacle);
          }
        };
        const deskXY = { x: 400, y: 400 };
        const computerXY = { x: 400, y: 400 };
        furniture.forEach((entry) => place({ ...entry, render_offset: { x: 0, y: 0 } }, deskXY.x, deskXY.y));
        decor.forEach((entry) => place(entry, computerXY.x, computerXY.y));
      }
    }

    // Hook up collisions: player + NPCs vs furniture/wall obstacles (staticGroup).
    // Re-assert after furniture finishes loading too (async catalog placements).
    const wireObstacleColliders = () => {
      if (!this.obstacles || !this.player) return;
      if (this._obstacleCollidersWired) return;
      this._obstacleCollidersWired = true;
      this.physics.add.collider(this.player, this.obstacles);
      if (Array.isArray(this.npcs)) {
        this.npcs.forEach((npc) => this.physics.add.collider(npc, this.obstacles));
      }
    };
    wireObstacleColliders();
    this._wireObstacleColliders = wireObstacleColliders;

    try { console.log('[BootTiming] after furniture loader / before world clock', performance.now()); } catch (_) {}
    // --- World clock + HUD ---
    class WorldClock {
      constructor({ startHour = 9, startMinute = 0, minuteStep = 1, tickMs = 2000 } = {}) {
        this.hour = startHour;
        this.minute = startMinute;
        this.minuteStep = minuteStep;
        this.tickMs = tickMs;
        this._acc = 0;
        this._lastEmitted = null;
      }
      update(deltaMs) {
        this._acc += deltaMs;
        let changed = false;
        while (this._acc >= this.tickMs) {
          this._acc -= this.tickMs;
          this.minute += this.minuteStep;
          while (this.minute >= 60) { this.minute -= 60; this.hour = (this.hour + 1) % 24; }
          changed = true;
        }
        return changed;
      }
      toString() {
        const hh = String(this.hour).padStart(2, '0');
        const mm = String(this.minute).padStart(2, '0');
        return `${hh}:${mm}`;
      }
      isLate() { return this.hour >= 22; }
    }
    // The world opens at the player's LOCAL time, so arriving in the afternoon
    // gives you an afternoon office. This used to hardcode 17:00 with a ~10
    // game-min/sec demo clock, so EVERY session opened at dusk reading
    // "17:00 SUNSET" and then cycled a whole day every ~1.9 real minutes.
    // 1 game-min per 2s is ambient instead: a full day takes ~48 real minutes.
    // ?clock=fast restores the old behaviour for demos and recordings where
    // showing night→morning quickly is the point.
    const _fastClock = /[?&]clock=fast(&|$)/.test(window.location.search);
    const _now = new Date();
    this.worldClock = new WorldClock(_fastClock
      ? { startHour: 17, startMinute: 0, tickMs: 800, minuteStep: 10 }
      : { startHour: _now.getHours(), startMinute: _now.getMinutes(), tickMs: 2000, minuteStep: 1 });
    try { window.DenizenCityTod?.apply?.(this.worldClock.hour, this.worldClock.minute); } catch (_) {}
    // DOM HUD (#denizen-tod-hud) is the visible clock — keep a hidden Phaser mirror for dialogs
    this.timeText = this.add.text(16, 44, `Time: ${this.worldClock.toString()}`, {
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
      fontSize: '14px',
      color: '#e5e7eb'
    }).setDepth(1000).setScrollFactor(0).setAlpha(0);

    // Find a bed to highlight at night
    this._bedInteractable = this._interactables.find((it) => it?.def?.action === 'sleep') || null;

    // --- Task model (AI workflow stubs) ---
    this._tasks = this.cache.json.get('tasks')?.tasks || [];
    this._currentTask = null;

    // --- OpenClaw Gateway Bridge ---
    if (window.GatewayBridge && window.NpcAgentController) {
      this._gatewayBridge = new window.GatewayBridge();
      // Expose the bridge + the scene globally so the parallel
      // worldstate-bridge module (src/openclaw-worldstate-bridge.js) can
      // attach without us threading them through any constructor.
      window.__DenizenGatewayBridge = this._gatewayBridge;
      window.__DenizenScene = this;
      this._npcAgentCtrl = new window.NpcAgentController(this, this._gatewayBridge);
      this._npcAgentCtrl.init();
      this._gatewayBridge.connect();
      console.log('[OfficeScene] OpenClaw Gateway Bridge initialized');

      // In-game chat panel (press C to toggle)
      if (window.OpenClawChat) {
        this._openclawChat = new window.OpenClawChat(this._gatewayBridge);
        this.input.keyboard.on('keydown-C', () => {
          // Don't toggle if typing in any input
          if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
          if (document.activeElement?.id === 'openclaw-chat-input') return;
          this._openclawChat.toggle();
        });
      }
    }

    try { console.log('[BootTiming] before agent office manager', performance.now()); } catch (_) {}
    // --- Agent Office Manager (AI agent coordination system) ---
    if (window.AgentActions && window.AgentOfficeManager) {
      this._agentActions = new window.AgentActions(this);
      this._agentManager = new window.AgentOfficeManager(this, this._agentActions);
      // If demo mode, flag it before init so initial behaviors are skipped
      const demoCheck = new URLSearchParams(window.location.search);
      if (demoCheck.get('demo') === 'investor') {
        this._agentManager._demoMode = true;
      }
      this._agentManager.init();
      console.log('[OfficeScene] Agent Office Manager initialized');

      // --- Work Output Feed (live NPC activity HUD, Tab to toggle) ---
      // denizen-lazy-scripts.js also constructs this if it loads first — never
      // build a second one or the duplicate toggle button swallows all taps.
      if (window.WorkFeedPanel && !this._workFeed) {
        this._workFeed = new window.WorkFeedPanel(this);
        console.log('[OfficeScene] Work Feed initialized (press Tab to toggle)');
      }

      // --- Player Chat System (talk to NPCs) ---
      if (window.PlayerChat) {
        if (window.__DenizenPlayerChat && typeof window.__DenizenPlayerChat.upgrade === 'function') {
          window.__DenizenPlayerChat.upgrade(this, this._agentManager);
          this._playerChat = window.__DenizenPlayerChat;
        } else {
          this._playerChat = new window.PlayerChat(this, this._agentManager);
          window.__DenizenPlayerChat = this._playerChat;
        }

        // Enter / T — open chat with facing NPC, or toggle chat
        this.input.keyboard.on('keydown-ENTER', () => {
          if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
          const facing = this._playerChat._findFacingNpc?.();
          if (facing) {
            const rawKey = facing.texture?.key;
            const name = this._agentManager?.NPC_NAMES?.[rawKey] || rawKey;
            Promise.resolve(this._playerChat.openWithNpc(rawKey, name)).catch((err) => {
              console.warn('[OfficeScene] openWithNpc failed:', err?.message || err);
            });
            return;
          }
          this._playerChat.toggle();
        });

        this.input.keyboard.on('keydown-T', () => {
          if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
          this._playerChat.toggle();
        });

        console.log('[OfficeScene] Player Chat initialized (press Enter or T to talk to NPCs)');
        this._installNpcChatHandlers();
        try { window.__DenizenChatBootstrap?.setLoadPct?.(100); } catch (_) {}
      } else {
        // Fallback: T key uses old prompt dialog
        this.input.keyboard.on('keydown-T', () => {
          if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
          const text = prompt('Say to CTO:');
          if (text && this._agentManager) {
            this._agentManager.ceoSpeak(text);
          }
        });
      }
    }

    // --- Scripted Demo cutscenes (camera pull-back) ---
    // Only these values start DemoScene (which zooms to 1× and stopFollow):
    //   ?demo=investor  — 20s research vignette
    //   ?demo=tour      — 60s feature tour
    // Public live demo uses ?demo=1 / ?mode=demo (public-demo-mode.js) and must
    // keep the playfield zoom + player follow. Treating demo=1 as investor
    // used to zoom the whole office out ~3s after load; walking then felt
    // "stuck zoomed out" because follow was already stopped.
    const demoParams = new URLSearchParams(window.location.search);
    const demoKind = (demoParams.get('demo') || '').trim().toLowerCase();
    if (demoKind === 'investor' || demoKind === 'tour') {
      const startDemo = () => {
        if (!window.DemoScene) return;
        const demo = new window.DemoScene(this, this._agentManager);
        if (demoKind === 'tour' && typeof demo.startTour === 'function') {
          demo.startTour();
          console.log('[OfficeScene] 60s tour triggered via ?demo=tour');
        } else {
          demo.start();
          console.log('[OfficeScene] Investor demo triggered via ?demo=investor');
        }
      };
      if (window.DemoScene) {
        this.time.delayedCall(3000, startDemo);
      } else if (window.DenizenLazyScripts) {
        window.DenizenLazyScripts.load(['./src/demo-scene.js']).then(() => {
          this.time.delayedCall(3000, startDemo);
        });
      }
    }

    // Non-critical panels (briefing, proposals, city debug) after office is interactive.
    if (window.DenizenLazyScripts) {
      window.DenizenLazyScripts.afterOffice();
    }

    try { console.log('[BootTiming] before pathfinding registration', performance.now()); } catch (_) {}
    // --- Pathfinding System ---
    if (window.OfficePathfinder && window.NpcPathFollower) {
      const perf = window.DenizenDeviceProfile?.lightPerf?.() || {};
      const cellSize = perf.pathCellSize || 8;
      const maxIter = perf.pathMaxIterations || null;
      this._pathfinder = new window.OfficePathfinder(1280, 720, cellSize, maxIter);
      try {
        if (perf.light) console.log('[Perf] path grid cell', cellSize, 'maxIter', maxIter || 6000);
      } catch (_) {}
      // Install tap-to-move as soon as the follower exists (don't wait on path build).
      this._playerPathFollower = new window.NpcPathFollower(this.player, this._pathfinder);
      this._installTapToMove();
      // Build the grid after a short delay so all furniture/walls are placed
      this.time.delayedCall(500, () => {
        this._pathfinder.buildFromScene(this);
        if (this._pathfinder.carveDoorwayGaps) {
          this._pathfinder.carveDoorwayGaps();
        } else {
          // Legacy inline carve (pre-carveDoorwayGaps builds)
          const cs = this._pathfinder.cellSize || 8;
          const gapX0 = 285, gapX1 = 390;
          const gapY0 = 420, gapY1 = 530;
          for (let py = gapY0; py <= gapY1; py += cs / 2) {
            for (let px = gapX0; px <= gapX1; px += cs / 2) {
              const g = this._pathfinder.toGrid(px, py);
              if (g.x >= 0 && g.x < this._pathfinder.cols && g.y >= 0 && g.y < this._pathfinder.rows) {
                this._pathfinder.grid[g.y * this._pathfinder.cols + g.x] = 0;
              }
            }
          }
        }

        // Attach path followers to all NPCs + snap any bad spawns (e.g. inside breakroom walls)
        if (Array.isArray(this.npcs)) {
          this.npcs.forEach(npc => {
            npc._pathFollower = new window.NpcPathFollower(npc, this._pathfinder);
            const snapped = this._pathfinder.forceSnapToWalkable(npc);
            if (snapped && npc.ai) {
              npc.ai.wanderTarget = { x: snapped.x, y: snapped.y };
            }
          });
        }
        console.log('[OfficeScene] Pathfinding system initialized (with door gap fix)');
      });
    }

    // Global robust unstick helper — can be called from anywhere (actions, manager, console)
    // Also exposed as window.DenizenUnstick(npcKeyOrSprite) for console use
    this._unstickNpc = (npc) => {
      if (typeof npc === 'string') {
        npc = (this.npcs || []).find(n => (n.npcKey === npc) || (n.texture && n.texture.key === npc));
      }
      if (!npc) return false;
      const pf = npc._pathFollower;
      if (pf && typeof pf.forceUnstick === 'function') {
        pf.forceUnstick(null);
      } else if (npc.body) {
        npc.body.setVelocity(0, 0);
      }
      // Always try grid snap
      if (this._pathfinder) {
        const s = this._pathfinder.forceSnapToWalkable(npc);
        if (s) {
          npc.x = s.x; npc.y = s.y;
        }
      }
      // Force back to wander so it doesn't stay frozen in a bad task
      if (npc.ai) {
        npc.ai.mode = 'wander';
        npc.ai.taskState = null;
        npc.ai.taskTarget = null;
        npc.ai.nextWanderAt = (this.time?.now || Date.now()) + 120;
        npc.ai.wanderTarget = null;
      }
      if (npc.body) npc.body.setVelocity(0, 0);
      return true;
    };

    window.DenizenUnstick = (key) => {
      const sc = window.game && window.game.scene && window.game.scene.scenes && window.game.scene.scenes[0];
      if (sc && sc._unstickNpc) return sc._unstickNpc(key);
      return false;
    };

    window.DenizenUnlockMovement = () => {
      const sc = window.game?.scene?.scenes?.[0];
      if (!sc) return false;
      // Never tear down the map editor — canvas clicks use this unlock path for focus recovery.
      if (window.__DenizenEditorActive) return false;
      sc.playerLocked = false;
      sc.playerState = 'walk';
      sc._playerOnPhone = false;
      sc._playerSitting = false;
      sc._phonePhase = 'none';
      sc._sitPhase = 'none';
      try {
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
          el.blur();
        }
        sc.input?.keyboard?.enableGlobalCapture?.();
        sc.input?.keyboard?.clearCaptures?.();
        window.__DenizenGameInputBlocked = false;
        if (sc.input) sc.input.enabled = true;
        window.game?.loop?.resume?.();
      } catch (_) {}
      const r = window.__DenizenRawMoveKeys || {};
      const keysHeld = !!(r.up || r.down || r.left || r.right);
      if (sc.player?.body && !keysHeld) sc.player.body.setVelocity(0, 0);
      if (sc.player?.texture?.key === 'dolo_phone') {
        sc.player.setTexture('dolo');
        sc.player.setFrame(20);
      }
      if (sc.player && (sc.player.texture?.key === 'dolo_sit' || sc.player.scaleX !== 1)) {
        sc._restorePlayerWalkSprite?.(20);
      }
      return true;
    };

    window.DenizenDebugFreeze = () => {
      const sc = window.game?.scene?.scenes?.[0];
      const loop = window.game?.loop;
      return {
        playerLocked: sc?.playerLocked,
        playerState: sc?.playerState,
        playerOnPhone: sc?._playerOnPhone,
        playerSitting: sc?._playerSitting,
        hasCursors: !!sc?.cursors,
        hasPlayerBody: !!sc?.player?.body,
        inputEnabled: window.game?.input?.enabled,
        modalOpen: document.documentElement.dataset.denizenModal === 'open',
        inputBlockedFlag: !!window.__DenizenGameInputBlocked,
        loopPaused: !!loop?.isPaused,
        activeElement: document.activeElement?.tagName + (document.activeElement?.id ? `#${document.activeElement.id}` : ''),
        editorActive: !!window.__DenizenEditorActive,
        rawMove: { ...(window.__DenizenRawMoveKeys || {}) },
      };
    };

    try { console.log('[BootTiming] before security monitor', performance.now()); } catch (_) {}
    // --- Security Monitor + Robber Controller ---
    if (typeof window.initBouncerSecurity === 'function') {
      window.initBouncerSecurity(this);
    } else if (!this._securityMonitor && window.SecurityMonitor && window.RobberController) {
      // Minimal fallback while deferred security scripts are still loading.
      this._securityMonitor = new window.SecurityMonitor();
      this._robberCtrl = new window.RobberController(this, this._securityMonitor);
      this._robberCtrl.init();
      this._securityMonitor.connect();
      console.log('[OfficeScene] Security Monitor + Robber Controller initialized (fallback)');
    }

    // Phone animation toggle (P key) — 3 phases: open → idle → close
    this._playerOnPhone = false;
    this._phonePhase = 'none'; // none | opening | idle | closing
    this.input.keyboard.on('keydown-P', () => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (!this._playerOnPhone) {
        this._playerOnPhone = true;
        this._phonePhase = 'opening';
        this._playerOnPhoneWallSince = Date.now();
        this.player.setTexture('dolo_phone');
        this.player.play('dolo:phone_open');
        this.player.once('animationcomplete-dolo:phone_open', () => {
          if (this._playerOnPhone) {
            this._phonePhase = 'idle';
            this.player.play('dolo:phone_idle');
          }
        });
      } else {
        // Close phone: play close animation, then return to normal
        this._phonePhase = 'closing';
        this.player.play('dolo:phone_close');
        this.player.once('animationcomplete-dolo:phone_close', () => {
          this._playerOnPhone = false;
          this._phonePhase = 'none';
          this.player.setTexture('dolo');
          this.player.setFrame(20); // idle down
        });
      }
    });

    // Sit interaction — find nearest chair/seat, sit down or stand up
    this._playerSitting = false;
    this._sitPhase = 'none'; // none | sitting_down | idle | standing_up
    this._sitChair = null; // reference to chair we're sitting on
    this._sitReturnPos = null; // where to stand up to

    // Sit interaction (F key) — find nearest chair/seat, sit down or stand up
    this.input.keyboard.on('keydown-F', () => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (this._playerOnPhone) return; // can't sit while on phone

      if (!this._playerSitting) {
        // Find nearest seat within 40px
        const seats = (this._interactables || []).filter(i => {
          const def = i.def;
          return def && (def.type === 'seat' || (def.name && /chair|couch|sofa|seat|bench/i.test(def.name)));
        });
        let nearest = null;
        let nearDist = 60;
        seats.forEach(s => {
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.sprite.x, s.sprite.y);
          if (d < nearDist) { nearDist = d; nearest = s; }
        });

        if (!nearest) return; // no seat nearby

        // Save return position and start sitting
        this._sitReturnPos = { x: this.player.x, y: this.player.y };
        this._sitChair = nearest;
        this._playerSitting = true;
        this._sitPhase = 'sitting_down';

        // Determine sit direction based on chair position relative to player
        const chairX = nearest.sprite.x;
        const sitDir = chairX < this.player.x ? 'left' : 'right';
        this._sitDir = sitDir;

        // Snap player to chair position with offset based on chair type
        this.player.body.setVelocity(0, 0);
        this.player.x = nearest.sprite.x;

        // Front-facing chairs (chair_*_front_*): player sits slightly below chair center
        // Back-facing chairs (chair_*_back_*): player sits at chair center
        const isFront = /front/i.test(nearest.id);
        const yOffset = isFront ? 12 : 0;
        this.player.y = nearest.sprite.y + yOffset;

        // Switch to sit sprite (16x32 frames, scale 2x to match 32x64 walk sprite)
        this.player.setTexture('dolo_sit');
        this.player.setScale(2);
        // Save original depth and adjust for sitting
        this._sitOrigDepth = this.player.depth;
        if (isFront) {
          // Front-facing chair: Dolo renders behind chair sprite
          this.player.setDepth(nearest.sprite.depth - 0.1);
        }
        this.player.play(`dolo:sit_down_${sitDir}`);
        this.player.once(`animationcomplete-dolo:sit_down_${sitDir}`, () => {
          if (this._playerSitting) {
            this._sitPhase = 'idle';
            this.player.play(`dolo:sit_idle_${sitDir}`);
          }
        });
      } else {
        // Stand up
        this._sitPhase = 'standing_up';
        const dir = this._sitDir || 'right';
        this.player.play(`dolo:stand_up_${dir}`);
        this.player.once(`animationcomplete-dolo:stand_up_${dir}`, () => {
          this._playerSitting = false;
          this._sitPhase = 'none';
          this._sitChair = null;

          this._restorePlayerWalkSprite(20);

          // Move player slightly away from chair so they don't re-trigger
          if (this._sitReturnPos) {
            this.player.x = this._sitReturnPos.x;
            this.player.y = this._sitReturnPos.y;
            this._sitReturnPos = null;
          }
        });
      }
    });

    this._installCanvasRefocus();
    try {
      const canvas = this.game?.canvas;
      if (canvas) {
        canvas.setAttribute('tabindex', '0');
        canvas.style.outline = 'none';
      }
    } catch (_) {}

    // Login / pairing modals call game.input.enabled=false; if the game booted after
    // closeModal(), input can stay off forever — restore when no modal is open.
    if (document.documentElement.dataset.denizenModal !== 'open') {
      window.__DenizenGameInputBlocked = false;
      if (this.input) this.input.enabled = true;
    }
  }

  _showTapMarker(worldX, worldY) {
    if (this._tapMarker) {
      this._tapMarker.destroy();
      this._tapMarker = null;
    }
    const ring = this.add.circle(worldX, worldY, 10, 0x4ade80, 0.45);
    ring.setStrokeStyle(2, 0x22c55e, 0.9);
    ring.setDepth(9000);
    this._tapMarker = ring;
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: 550,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        ring.destroy();
        if (this._tapMarker === ring) this._tapMarker = null;
      },
    });
  }

  _installRawMoveKeys() {
    if (window.__DenizenRawMoveKeys) return;
    window.__DenizenRawMoveKeys = { up: false, down: false, left: false, right: false };
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right',
    };
    const set = (e, on) => {
      const dir = map[e.key];
      if (!dir) return;
      const chatInput = document.getElementById('player-chat-input');
      if (chatInput && document.activeElement === chatInput) return;
      window.__DenizenRawMoveKeys[dir] = on;
    };
    window.addEventListener('keydown', (e) => set(e, true), true);
    window.addEventListener('keyup', (e) => set(e, false), true);
    window.addEventListener('blur', () => {
      Object.keys(window.__DenizenRawMoveKeys).forEach((k) => { window.__DenizenRawMoveKeys[k] = false; });
    });
  }

  _installCanvasRefocus() {
    if (this._canvasRefocusInstalled) return;
    this._canvasRefocusInstalled = true;
    const canvas = this.game?.canvas;
    if (!canvas) return;
    const refocus = () => {
      if (window.__DenizenEditorActive) return;
      try {
        window.DenizenMovementGuard?.unlock?.();
      } catch (_) {}
      try {
        window.__DenizenGameInputBlocked = false;
        if (this.game?.input) this.game.input.enabled = true;
      } catch (_) {}
      const el = document.activeElement;
      const isField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!isField) return;
      // Clicking the world should return control to Phaser (not trap WASD in phone fields).
      if (document.documentElement.classList.contains('denizen-phone-open')) return;
      if (document.documentElement.classList.contains('denizen-chat-open')) return;
      try {
        el.blur();
        this.input?.keyboard?.enableGlobalCapture?.();
        this.input?.keyboard?.clearCaptures?.();
      } catch (_) {}
    };
    canvas.addEventListener('pointerdown', refocus);
  }

  /** Convert a DOM pointer on the game canvas into world coords (handles CSS scale + camera zoom). */
  _worldPointFromClient(clientX, clientY) {
    const canvas = this.game?.canvas;
    const cam = this.cameras?.main;
    if (!canvas || !cam) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const sx = (clientX - rect.left) / rect.width;
    const sy = (clientY - rect.top) / rect.height;
    if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return null;
    const view = cam.worldView;
    return {
      x: view.x + sx * view.width,
      y: view.y + sy * view.height,
    };
  }

  _unlockPlayerForTapMove() {
    try {
      window.__DenizenGameInputBlocked = false;
      if (this.game?.input) this.game.input.enabled = true;
      window.DenizenMovementGuard?.unlock?.();
    } catch (_) {}
    if (this._editorHandlers) return false;
    if (this.playerLocked || this._playerSitting || this._playerOnPhone) {
      this.playerLocked = false;
      this._playerOnPhone = false;
      this._phonePhase = 'none';
      this._sitPhase = 'none';
      if (this._playerSitting) {
        try { this._restorePlayerWalkSprite?.(20); } catch (_) {}
        this._playerSitting = false;
        this._sitChair = null;
        if (this._sitReturnPos) {
          this.player.x = this._sitReturnPos.x;
          this.player.y = this._sitReturnPos.y;
          this._sitReturnPos = null;
        }
      }
      if (this.player?.texture?.key === 'dolo_phone') {
        try {
          this.player.setTexture('dolo');
          this.player.setFrame(20);
        } catch (_) {}
      }
    }
    return true;
  }

  /** Shared tap-to-move — Phaser pointer OR DOM canvas tap. */
  _tapMoveToWorld(tx, ty) {
    if (!(window.__DenizenIsTouch || document.documentElement.classList.contains('denizen-touch'))) return false;
    if (document.documentElement.dataset.denizenModal === 'open') return false;
    if (document.documentElement.classList.contains('denizen-portrait-blocked')) return false;
    if (document.documentElement.classList.contains('denizen-chat-open')) return false;
    if (document.documentElement.classList.contains('denizen-phone-open')) return false;
    if (!this._unlockPlayerForTapMove()) return false;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;

    const now = Date.now();
    // Debounce Phaser pointerdown + DOM pointerdown/touchend double delivery
    if (this._lastDomTapAt && now - this._lastDomTapAt < 140) return true;
    this._lastDomTapAt = now;

    const pf = this._pathfinder;
    const follower = this._playerPathFollower;
    let destX = tx;
    let destY = ty;
    if (follower?.navigateTo) {
      let ok = !!follower.navigateTo(destX, destY);
      if (!ok && pf?._nearestWalkable && pf?.toGrid && pf?.toPixel) {
        try {
          const g = pf.toGrid(destX, destY);
          const near = pf._nearestWalkable(g.x, g.y);
          if (near) {
            const w = pf.toPixel(near.x, near.y);
            destX = w.x;
            destY = w.y;
            ok = !!follower.navigateTo(destX, destY);
          }
        } catch (_) {}
      }
    }
    // Always keep a seek target so a blocked path still walks toward the tap.
    this._tapSeekTarget = { x: destX, y: destY, until: (this.time?.now || 0) + 5200 };
    window.DenizenHaptics?.tap?.();
    if (window.DenizenMobilePlay?.useTapMove?.() || window.__DenizenIsTouch) {
      this._showTapMarker?.(destX, destY);
    }
    return true;
  }

  _installDomTapToMove() {
    if (this._domTapToMoveInstalled) return;
    this._domTapToMoveInstalled = true;
    const canvas = this.game?.canvas;
    if (!canvas) return;
    // Where the gesture began, so a drag can be told from a tap. At pointerdown
    // a tap and the first pixel of an invisible-joystick drag are identical, so
    // firing walk-to-here on DOWN left a stale target fighting the stick.
    let downX = 0;
    let downY = 0;
    const TAP_SLOP = 12;
    const markDown = (x, y) => { downX = x; downY = y; };
    const travelled = (x, y) => Math.hypot(x - downX, y - downY);

    canvas.addEventListener('pointerdown', (e) => markDown(e.clientX, e.clientY), { passive: true });
    canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (t) markDown(t.clientX, t.clientY);
    }, { passive: true });

    const onPointer = (e) => {
      if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
      if (!(window.__DenizenIsTouch || document.documentElement.classList.contains('denizen-touch'))) return;
      if (document.documentElement.dataset.denizenModal === 'open') return;
      if (e.target?.closest?.('#denizen-visitor-name-modal, #denizen-demo-account-modal')) return;
      if (travelled(e.clientX, e.clientY) > TAP_SLOP) return;   // drag, not a tap
      const pt = this._worldPointFromClient(e.clientX, e.clientY);
      if (!pt) return;
      this._tapMoveToWorld(pt.x, pt.y);
    };
    canvas.addEventListener('pointerup', onPointer, { passive: true });
    // iOS Safari sometimes drops pointer events on Canvas2D — touchend is a backup.
    canvas.addEventListener('touchend', (e) => {
      if (!(window.__DenizenIsTouch || document.documentElement.classList.contains('denizen-touch'))) return;
      if (document.documentElement.dataset.denizenModal === 'open') return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      if (travelled(t.clientX, t.clientY) > TAP_SLOP) return;   // drag, not a tap
      const pt = this._worldPointFromClient(t.clientX, t.clientY);
      if (!pt) return;
      this._tapMoveToWorld(pt.x, pt.y);
    }, { passive: true });
  }

  /** Click / tap NPCs to open player chat (wired after PlayerChat + AgentManager exist). */
  _installNpcChatHandlers() {
    if (this._npcChatHandlersInstalled) return;
    this._npcChatHandlersInstalled = true;

    this._openNpcChat = (npc) => {
      const rawKey = npc?.texture?.key;
      if (!rawKey) return;
      const now = Date.now();
      if (this._lastNpcChatKey === rawKey && now - (this._lastNpcChatAt || 0) < 400) return;
      this._lastNpcChatKey = rawKey;
      this._lastNpcChatAt = now;

      const name = this._agentManager?.NPC_NAMES?.[rawKey]
        || globalThis.DenizenNpcRoster?.entries?.find((e) => e.textureKey === rawKey)?.display
        || rawKey;
      const pc = this._playerChat || window.__DenizenPlayerChat;
      if (!pc?.openWithNpc) {
        console.warn('[OfficeScene] PlayerChat not ready for NPC click');
        return;
      }
      Promise.resolve(pc.openWithNpc(rawKey, name)).catch((err) => {
        console.warn('[OfficeScene] openWithNpc failed:', err?.message || err);
      });
      window.DenizenHaptics?.tap?.();
    };

    const onNpcPointer = (npc, pointer, event) => {
      this._openNpcChat(npc);
      if (event) event.stopPropagation();
      if (pointer?.event) pointer.event.stopPropagation();
    };

    const bindNpc = (npc) => {
      if (!npc || npc._npcChatBound) return;
      npc._npcChatBound = true;
      if (!npc.input) {
        npc.setInteractive({ useHandCursor: true, pixelPerfect: false });
      }
      // pointerdown is the GameObject event — gameobjectdown only exists on scene.input.
      npc.on('pointerdown', (pointer, _localX, _localY, event) => {
        onNpcPointer(npc, pointer, event);
      });
    };

    (this.npcs || []).forEach(bindNpc);

    if (!this._npcChatSceneInputBound) {
      this._npcChatSceneInputBound = true;
      this.input.on('gameobjectdown', (pointer, gameObject, _localX, _localY, event) => {
        if (!gameObject || !Array.isArray(this.npcs) || !this.npcs.includes(gameObject)) return;
        onNpcPointer(gameObject, pointer, event);
      });
    }
  }

  _installTapToMove() {
    if (this._tapToMoveInstalled) return;
    this._tapToMoveInstalled = true;
    this._installDomTapToMove();
    this.input.on('pointerdown', (pointer, gameObjects) => {
      if (!(window.__DenizenIsTouch || document.documentElement.classList.contains('denizen-touch'))) return;
      if (document.documentElement.dataset.denizenModal === 'open') return;
      const hitNpc = gameObjects?.some((go) => Array.isArray(this.npcs) && this.npcs.includes(go));
      if (hitNpc) return;
      // Prefer DOM world mapping on touch — Phaser worldX can drift with CSS-scaled canvas.
      if (pointer?.event && Number.isFinite(pointer.event.clientX)) {
        const pt = this._worldPointFromClient(pointer.event.clientX, pointer.event.clientY);
        if (pt) {
          this._tapMoveToWorld(pt.x, pt.y);
          return;
        }
      }
      this._tapMoveToWorld(pointer.worldX, pointer.worldY);
    });
  }

  showNpcDialog(title, body) {
    // Clean up any previous dialog + listeners
    if (this.dialogBox) {
      this.dialogBox.destroy();
      this.dialogBox = null;
    }
    if (this._dialogCloseClick) {
      this.input.off('pointerdown', this._dialogCloseClick);
      this._dialogCloseClick = null;
    }
    if (this._dialogCloseKey) {
      this.input.keyboard.off('keydown-E', this._dialogCloseKey);
      this._dialogCloseKey = null;
    }
    if (this._dialogAutoClose) {
      this._dialogAutoClose.remove(false);
      this._dialogAutoClose = null;
    }

    // Anchor to the camera viewport (not the world) so the dialog stays visible
    // when the phone camera is zoomed in and following the player. With camera
    // zoom z, a scrollFactor-0 object at y renders at (y - h/2) * z + h/2.
    const cam = this.cameras.main;
    const zoom = cam.zoom || 1;
    const panelW = 300;
    const panelH = 80;
    const cx = cam.width / 2;
    const cy = (cam.height - (panelH * zoom) / 2 - 16 - cam.height / 2) / zoom + cam.height / 2;

    const children = [];

    // Semi-transparent dark panel background (simple, compact)
    children.push(this.add.rectangle(cx + 2, cy + 2, panelW, panelH, 0x000000, 0.4));
    children.push(
      this.add.rectangle(cx, cy, panelW, panelH, 0x0f172a, 0.92)
        .setStrokeStyle(1, 0x3b82f6)
    );

    // Title bar background
    children.push(
      this.add.rectangle(cx, cy - panelH/2 + 12, panelW - 4, 20, 0x1e3a5f, 0.85)
        .setOrigin(0.5, 0.5)
    );

    // Title text
    children.push(
      this.add.text(cx - panelW/2 + 10, cy - panelH/2 + 4, title, {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#93c5fd'
      })
    );

    // Body text
    children.push(
      this.add.text(cx - panelW/2 + 10, cy - panelH/2 + 26, body, {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '10px',
        color: '#e2e8f0',
        wordWrap: { width: panelW - 20 }
      })
    );

    // Close hint
    children.push(
      this.add.text(cx + panelW/2 - 8, cy + panelH/2 - 6, 'click to close', {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '8px',
        color: '#64748b'
      }).setOrigin(1, 1)
    );

    this.dialogBox = this.add.container(0, 0, children);
    this.dialogBox.setDepth(1000);
    this.dialogBox.setScrollFactor(0);

    // Close on click anywhere (after a small delay so the opening click doesn't immediately close it)
    const closeDialog = () => {
      if (this.dialogBox) {
        this.dialogBox.destroy();
        this.dialogBox = null;
      }
      if (this._dialogCloseClick) {
        this.input.off('pointerdown', this._dialogCloseClick);
        this._dialogCloseClick = null;
      }
      if (this._dialogCloseKey) {
        this.input.keyboard.off('keydown-E', this._dialogCloseKey);
        this._dialogCloseKey = null;
      }
      if (this._dialogAutoClose) {
        this._dialogAutoClose.remove(false);
        this._dialogAutoClose = null;
      }
      // Interact dialogs (computer / bed / seat) set playerLocked — release on dismiss.
      if (this.playerState === 'interacting') {
        this.playerLocked = false;
        this.playerState = 'walk';
      }
    };

    this.time.delayedCall(200, () => {
      this._dialogCloseClick = closeDialog;
      this.input.on('pointerdown', this._dialogCloseClick);
    });

    // Close on E key
    this._dialogCloseKey = closeDialog;
    this.input.keyboard.on('keydown-E', this._dialogCloseKey);

    // Auto-dismiss after 4 seconds
    this._dialogAutoClose = this.time.delayedCall(4000, closeDialog);
  }

  /**
   * Retry seating at assigned desk — rate-limited so we don't spam useComputer every frame.
   */
  /**
   * Player walk speed in world px/s.
   * Zoom changes on-screen pace; phones get a lower base so tap-to-move
   * doesn't feel like turbo (desktop still stays snappy).
   */
  _playerMoveSpeed() {
    const isPhone = !!window.DenizenDeviceProfile?.isPhone?.();
    const isTablet = !!window.DenizenDeviceProfile?.isTablet?.();
    // Phones were overshooting — base was ~380 with a large zoom boost.
    const base = isPhone ? 250 : isTablet ? 290 : 360;
    const zoom = Math.max(0.85, this.cameras?.main?.zoom || 1);
    const feelTarget = isPhone ? 1.5 : isTablet ? 1.7 : 2.0;
    const feel = feelTarget / zoom;
    const cap = isPhone ? 1.35 : isTablet ? 1.55 : 2.15;
    const floor = isPhone ? 0.95 : 1.0;
    return Math.round(base * Math.min(cap, Math.max(floor, feel)));
  }

  _rawMoveActive() {
    const r = window.__DenizenRawMoveKeys || {};
    return !!(r.up || r.down || r.left || r.right);
  }

  /**
   * Runs after the main update() — reapplies movement from DOM key listeners so
   * phone/sit/playerLocked blocks cannot zero velocity on the same frame.
   */
  _applyRawKeyMovement() {
    if (!this._rawMoveActive()) return;
    const el = document.activeElement;
    const isField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    if (isField) return;
    if (document.documentElement.dataset.denizenModal === 'open') return;
    if (window.__DenizenEditorActive) return;

    const body = this.player?.body;
    if (!body) return;

    try {
      window.__DenizenGameInputBlocked = false;
      if (this.input) this.input.enabled = true;
      this.input?.keyboard?.enableGlobalCapture?.();
      this.game?.loop?.resume?.();
      this.game?.canvas?.focus?.({ preventScroll: true });
    } catch (_) {}

    this.playerLocked = false;
    this.playerState = 'walk';
    // If a cutscene pulled the camera wide and never restored it, snap back
    // the first time the player actually walks (playfield zoom + follow).
    if (!this._agentManager?._demoMode) {
      const cam = this.cameras?.main;
      const want = playfieldZoomForProfile(getPlayfieldDeviceProfile());
      const following = !!(cam && (cam.follow || cam._follow));
      if (cam && (Math.abs((cam.zoom || 1) - want) > 0.05 || !following)) {
        this._applyPlayfieldCamera();
      }
    }
    this._playerOnPhone = false;
    this._phonePhase = 'none';
    this._playerOnPhoneSince = 0;
    this._playerOnPhoneWallSince = 0;
    if (this._playerSitting) {
      this._playerSitting = false;
      this._sitPhase = 'none';
      this._sitChair = null;
      this._restorePlayerWalkSprite(20);
    }
    if (this.player.texture?.key === 'dolo_phone') {
      this.player.setTexture('dolo');
      this.player.setFrame(20);
    }

    const r = window.__DenizenRawMoveKeys;
    const speed = this._playerMoveSpeed?.() || 380;
    let vx = 0;
    let vy = 0;
    if (r.left) vx = -speed;
    else if (r.right) vx = speed;
    if (r.up) vy = -speed;
    else if (r.down) vy = speed;
    if (vx && vy) {
      vx *= 0.707106781;
      vy *= 0.707106781;
    }
    body.setVelocity(vx, vy);
    if (Math.abs(vx) > Math.abs(vy)) {
      this.facing = vx < 0 ? 'left' : 'right';
    } else if (vy) {
      this.facing = vy < 0 ? 'up' : 'down';
    }
    this._depthDirty = true;
    if (this._agentManager) this._agentManager._lastPlayerActiveAt = Date.now();
  }

  _trySeatAtDesk(npc, ai) {
    const now = this.time.now;
    if (ai._seatRetryAt && (now - ai._seatRetryAt) < 6000) return;
    const npcKey = npc.texture?.key;
    if (!npcKey || !this._agentManager?.actions) return;
    const agent = this._agentManager.agents?.get(npcKey);
    if (!agent?.assignedDesk) return;
    if (this._agentManager.actions.isSeatedAtDesk(npcKey, agent.assignedDesk)) return;
    ai._seatRetryAt = now;
    this._agentManager.actions.useComputer(npcKey, agent.assignedDesk, { instant: true });
    agent.status = 'working';
  }

  /**
   * Living-office destinations. Instead of Brownian random hops, an idle NPC
   * picks somewhere a real coworker would actually go — a spot by the
   * coffee/kitchen gear, a bookshelf or plant, a colleague who's currently
   * settled, or an occasional aimless stroll — then DWELLS there for a
   * while (dwell is applied on arrival by the wander loop).
   * Returns { pos, dwellMs, faceNpc? }.
   */
  _pickNpcPoi(npc) {
    // Lazily index interactable furniture into "hangout" spots.
    if (!this._npcPoiSpots || this._npcPoiDirty) {
      this._npcPoiDirty = false;
      const spots = [];
      for (const it of this._interactables || []) {
        const sp = it?.sprite;
        if (!sp) continue;
        const id = String(it.id || '');
        const action = String(it.def?.action || '');
        // Things worth loitering near — appliances, shelves, greenery, seats.
        if (action === 'sit' || /coffee|kettle|fridge|sink|plant|flora|shelf|book|printer|water|vending|window|aquarium|radio/i.test(id)) {
          spots.push({ x: sp.x, y: sp.y + 18 });
        }
      }
      this._npcPoiSpots = spots;
    }

    const pf = this._pathfinder;
    const roll = Math.random();

    // ~25%: wander over to a colleague who is settled (seated or dwelling)
    if (roll < 0.25 && Array.isArray(this.npcs)) {
      const settled = this.npcs.filter((o) => {
        if (o === npc || !o.ai) return false;
        const ts = o.ai.taskState;
        const dwelling = o.ai.mode === 'wander' && !o._pathFollower?.isNavigating?.();
        return ts === 'sitting' || ts === 'working' || ts === 'reading' || dwelling;
      });
      if (settled.length) {
        const other = settled[Math.floor(Math.random() * settled.length)];
        const approach = pf?.findGoodApproachNear?.(other.x, other.y, 20, 40)
          || { x: other.x + (npc.x > other.x ? 24 : -24), y: other.y };
        return { pos: approach, dwellMs: Phaser.Math.Between(3500, 9000), faceNpc: other };
      }
    }

    // ~40%: hang out at a furniture spot (coffee corner, shelf, plant, …)
    if (roll < 0.65 && this._npcPoiSpots.length) {
      const spot = this._npcPoiSpots[Math.floor(Math.random() * this._npcPoiSpots.length)];
      const pos = pf?.findWalkableNear?.(spot.x, spot.y, 40) || spot;
      return { pos, dwellMs: Phaser.Math.Between(5000, 14000) };
    }

    // Rest: a short aimless stroll with a brief pause at the end.
    let pos = pf?.sampleSafeWalkTarget?.(npc.x, npc.y, 180, 14) || null;
    if (!pos) {
      const wx = Phaser.Math.Between(140, 1140);
      const wy = Phaser.Math.Between(170, 620);
      pos = pf?.findWalkableNear?.(wx, wy, 48) || { x: wx, y: wy };
    }
    return { pos, dwellMs: Phaser.Math.Between(1800, 5200) };
  }

  update(time, delta) {
    const modalOpen = document.documentElement.dataset.denizenModal === 'open';
    if (!modalOpen && this.input && this.input.enabled === false) {
      window.__DenizenGameInputBlocked = false;
      this.input.enabled = true;
      try {
        this.input.keyboard?.enableGlobalCapture?.();
        this.input.keyboard?.clearCaptures?.();
      } catch (_) {}
    }
    if (this.game?.loop?.isPaused) {
      try { this.game.loop.resume(); } catch (_) {}
    }
    // Lazy-init cursors if create() was interrupted (assembly async) or keyboard
    // plugin came up late — never bail the whole frame; NPC AI must keep ticking.
    if (!this.cursors && this.input?.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      if (!this.wasd) {
        this.wasd = this.input.keyboard.addKeys({ up: 'W', left: 'A', down: 'S', right: 'D' });
      }
      if (!this.interactKeys) {
        this.interactKeys = this.input.keyboard.addKeys({ E: 'E', SPACE: 'SPACE' });
      }
      this.input.keyboard.clearCaptures();
    }
    const speed = this._playerMoveSpeed();
    const body = this.player?.body;
    const hasPlayer = !!body;

    // World clock tick + late-night hint + city day/night CSS (24h loop → morning again)
    const clockDelta = (typeof delta === 'number' && delta > 0)
      ? delta
      : (this.game?.loop?.delta || 16);
    if (this.worldClock && this.worldClock.update(clockDelta)) {
      if (this.timeText) this.timeText.setText(`Time: ${this.worldClock.toString()}`);
      try {
        window.DenizenCityTod?.apply?.(this.worldClock.hour, this.worldClock.minute);
      } catch (_) {}
      // Reset late-night one-shots each new day so the loop can repeat
      if (this.worldClock.hour >= 5 && this.worldClock.hour < 21) {
        this._didYawn = false;
        if (this._bedInteractable?.sprite?.clearTint) this._bedInteractable.sprite.clearTint();
      }
      if (this.worldClock.isLate() && this._bedInteractable?.sprite) {
        const t = (this.time.now % 600) / 600;
        const on = t < 0.5;
        this._bedInteractable.sprite.setTint(on ? 0xfff3b0 : 0xffffff);
        if (!this._didYawn) {
          this._didYawn = true;
          this.showNpcDialog('Adam', 'Yawn... It’s getting late. Maybe I should sleep.');
        }
      }
    }

    // Street exit: the south wall has a door gap at x 608-672 — walking
    // through it steps outside into the full LimeZu city (?world=full),
    // spawning at the Denizen HQ building's entrance.
    if (this.player && !this._exitingToCity
        && this.player.y > 700 && this.player.x > 600 && this.player.x < 680) {
      this._exitingToCity = true;
      try { window.location.href = '/office?demo=1&world=full&entry=office'; } catch (_) {}
    }

    // Y-depth for characters only (cheap). Full furniture re-sort is rare —
    // every-frame full sort with 18 NPCs + desks was a major hitch source.
    this._depthFrame = (this._depthFrame || 0) + 1;
    const depthEvery = 2; // ~30 Hz depth updates at 60fps
    if ((this._depthFrame % depthEvery) === 0 || this._depthDirty) {
      this._depthDirty = false;
      const sittingNpcSet = this._agentActions?._sittingNpcs || new Map();
      const chars = [];
      if (this.player) chars.push(this.player);
      if (Array.isArray(this.npcs)) {
        for (let i = 0; i < this.npcs.length; i++) {
          const n = this.npcs[i];
          if (n) chars.push(n);
        }
      }
      chars.sort((a, b) => (a.y - b.y));
      for (let i = 0; i < chars.length; i++) {
        const s = chars[i];
        const key = s.texture?.key;
        if (key && sittingNpcSet.has(key)) continue;
        // Band 200+ keeps people above furniture roots (~10–180 typical).
        s.setDepth(200 + i);
      }
      sittingNpcSet.forEach((sitData, npcKey) => {
        const npc = this.npcs?.find(n => n.texture?.key === npcKey);
        if (!npc || !sitData.chairSprite) return;
        const chairDepth = sitData.chairSprite.depth;
        if (sitData.chairInfo?.backFacing) {
          npc.setDepth(chairDepth - 0.5);
        } else {
          npc.setDepth(chairDepth + 0.5);
        }
      });
    }

    if (hasPlayer) {
    // Interaction: press E/Space near object in front of player (or mobile Action button).
    // Ignore E/Space while typing in a field so chat/login keep those keystrokes.
    const touchInteract = !!(window.__DenizenTouchState?.interact);
    const interactTyping = this._typingInField ? this._typingInField() : false;
    const editorBlocksInteract = window.__DenizenEditorActive || (() => {
      const host = String(window.location.hostname || '').toLowerCase();
      const onLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
      const onDolonia = host === 'denizen.dolonia.cloud' || host.endsWith('.dolonia.cloud');
      return onLocalhost || onDolonia
        || new URLSearchParams(window.location.search).has('editor');
    })();
    const interactPressed = (!editorBlocksInteract && ((!interactTyping) && (this.interactKeys?.E?.isDown || this.interactKeys?.SPACE?.isDown))) || touchInteract;
    if (!this._interactWasDown) this._interactWasDown = false;
    const justPressed = interactPressed && !this._interactWasDown;
    this._interactWasDown = interactPressed;

    const facingVec = (() => {
      if (this.facing === 'up') return { x: 0, y: -1 };
      if (this.facing === 'down') return { x: 0, y: 1 };
      if (this.facing === 'left') return { x: -1, y: 0 };
      return { x: 1, y: 0 };
    })();

    const standUp = () => {
      this.playerLocked = false;
      this.playerState = 'walk';
    };

    if (justPressed && !this.playerLocked && Array.isArray(this._interactables)) {
      const isTouch = !!window.__DenizenIsTouch;
      const maxDistDefault = isTouch ? 96 : 64;
      const dotThreshold = isTouch ? 0.1 : 0.25;
      let best = null;
      for (const it of this._interactables) {
        if (!it?.sprite) continue;
        const def = it.def || {};
        const maxDist = def.interact_distance ?? maxDistDefault;
        const dx = it.sprite.x - this.player.x;
        const dy = it.sprite.y - this.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist) continue;
        // must be roughly in front of player (dot product)
        const dot = (dx / (dist || 1)) * facingVec.x + (dy / (dist || 1)) * facingVec.y;
        if (dot < dotThreshold) continue;
        if (!best || dist < best.dist) best = { it, dist };
      }

      if (best) {
        window.DenizenHaptics?.impact?.();
        const { it } = best;
        const def = it.def || {};
        if (def.action === 'use_computer' || def.action === 'use_it') {
          const task = (this._tasks || []).find((t) => t.id === 'pc_research') || null;
          this._currentTask = task;
          const label = task?.label || 'Accessing Computer';
          this.showNpcDialog(
            'Computer',
            `${label}\nTime: ${this.worldClock?.toString?.() || ''}\n\n`
            + 'Walk up to a teammate and press E to chat — they can research and draft work from their desk. '
            + 'Team visitors can also assign tasks from the CRM panel.',
          );
          this.facing = 'down';
        } else if (def.action === 'sleep') {
          this.showNpcDialog('Bed', `Sleeping... Time: ${this.worldClock?.toString?.() || ''}`);
          const snap = def.snap_offset || { x: 0, y: 0 };
          this.player.setPosition(it.sprite.x + (snap.x || 0), it.sprite.y + (snap.y || 0));
          this.facing = 'down';
        } else if (def.type === 'seat' || String(it.id).includes('bench')) {
          this.showNpcDialog('Seat', 'Sitting...');
          this.player.setPosition(it.sprite.x, it.sprite.y - Math.floor(it.sprite.displayHeight * 0.55));
          this.facing = 'down';
        }
      }
    } else if (justPressed && this.playerLocked) {
      standUp();
    }

    // If interacting, any movement key stands up.
    const chatMove = this._chatMoveKeys || {};
    const touchMove = window.__DenizenTouchState || {};
    const typing = this._typingInField ? this._typingInField() : false;
    const chatInput = document.getElementById('player-chat-input');
    const chatFieldFocused = chatInput && document.activeElement === chatInput;
    const cursors = this.cursors;
    const rawMove = window.__DenizenRawMoveKeys || {};
    const useRawMove = !chatFieldFocused && !typing;
    const leftKey = (!typing && (cursors?.left?.isDown || this.wasd?.left?.isDown)) || !!chatMove.left || !!touchMove.left || (useRawMove && !!rawMove.left);
    const rightKey = (!typing && (cursors?.right?.isDown || this.wasd?.right?.isDown)) || !!chatMove.right || !!touchMove.right || (useRawMove && !!rawMove.right);
    const upKey = (!typing && (cursors?.up?.isDown || this.wasd?.up?.isDown)) || !!chatMove.up || !!touchMove.up || (useRawMove && !!rawMove.up);
    const downKey = (!typing && (cursors?.down?.isDown || this.wasd?.down?.isDown)) || !!chatMove.down || !!touchMove.down || (useRawMove && !!rawMove.down);

    const anyMoveKey = leftKey || rightKey || upKey || downKey;
    if (anyMoveKey) {
      if (this._playerOnPhone) {
        this._playerOnPhone = false;
        this._phonePhase = 'none';
        this._playerOnPhoneSince = 0;
        this._playerOnPhoneWallSince = 0;
        if (this.player.texture?.key === 'dolo_phone') {
          this.player.setTexture('dolo');
          this.player.setFrame(20);
        }
      }
      if (this._playerSitting) {
        this._playerSitting = false;
        this._sitPhase = 'none';
        this._sitChair = null;
        this._restorePlayerWalkSprite(20);
        if (this._sitReturnPos) {
          this.player.x = this._sitReturnPos.x;
          this.player.y = this._sitReturnPos.y;
          this._sitReturnPos = null;
        }
      }
    }

    // Pressing a movement (arrow) key stands you up from sitting/interacting.
    if (this.playerLocked && (leftKey || rightKey || upKey || downKey)) {
      standUp();
    }

    // Movement is blocked ONLY while sitting/interacting (playerLocked). The
    // chat box no longer freezes the player at all — arrow keys still drive
    // movement even while the input is focused (the input lets them through),
    // so you can type AND walk at the same time. Don't return early: NPC AI,
    // physics, and bubbles must keep running below.
    let moving = false;
    const rawActive = this._rawMoveActive();
    if (this.playerLocked && !rawActive) {
      body.setVelocity(0, 0);
      this.player.anims.stop();
    } else {
      body.setVelocity(0);

      const left = leftKey;
      const right = rightKey;
      const up = upKey;
      const down = downKey;
      const manualMove = left || right || up || down;
      const pathFollower = this._playerPathFollower;

      if (manualMove) {
        this._tapSeekTarget = null;
        if (pathFollower?.isNavigating()) pathFollower.stop();
        if (left) {
          body.setVelocityX(-speed);
          moving = true;
          this.facing = 'left';
        } else if (right) {
          body.setVelocityX(speed);
          moving = true;
          this.facing = 'right';
        }

        if (up) {
          body.setVelocityY(-speed);
          moving = true;
          if (!left && !right) this.facing = 'up';
        } else if (down) {
          body.setVelocityY(speed);
          moving = true;
          if (!left && !right) this.facing = 'down';
        }
      } else if (pathFollower?.isNavigating()) {
        const vel = pathFollower.update(speed, delta);
        if (vel) {
          body.setVelocity(vel.vx, vel.vy);
          moving = true;
          if (Math.abs(vel.vx) > Math.abs(vel.vy)) {
            this.facing = vel.vx < 0 ? 'left' : 'right';
          } else {
            this.facing = vel.vy < 0 ? 'up' : 'down';
          }
        }
      } else if (this._tapSeekTarget && this.time.now < this._tapSeekTarget.until) {
        const tx = this._tapSeekTarget.x;
        const ty = this._tapSeekTarget.y;
        const dx = tx - this.player.x;
        const dy = ty - this.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 12) {
          this._tapSeekTarget = null;
          body.setVelocity(0, 0);
        } else {
          body.setVelocity((dx / dist) * speed, (dy / dist) * speed);
          moving = true;
          if (Math.abs(dx) > Math.abs(dy)) this.facing = dx < 0 ? 'left' : 'right';
          else this.facing = dy < 0 ? 'up' : 'down';
        }
      } else if (this._tapSeekTarget) {
        this._tapSeekTarget = null;
      }
    }

    if (this._playerSitting && !this._rawMoveActive()) {
      this.player.body.setVelocity(0, 0);
    } else if (this._playerOnPhone && !this._rawMoveActive()) {
      const wall = this._playerOnPhoneWallSince || (this._playerOnPhoneWallSince = Date.now());
      const phoneAge = Date.now() - wall;
      if (phoneAge > 5000 || moving) {
        this._playerOnPhone = false;
        this._phonePhase = 'none';
        this._playerOnPhoneSince = 0;
        this._playerOnPhoneWallSince = 0;
        if (this.player.texture?.key === 'dolo_phone') {
          this.player.setTexture('dolo');
          this.player.setFrame(20);
        }
      } else if (!moving) {
        this.player.body.setVelocity(0, 0);
      }
    } else if (moving) {
      this._playerOnPhoneSince = 0;
      // Cancel phone if player starts moving
      const baseKey = (dir) => {
        const fn = this._playerAnimKey;
        return fn ? fn(`walk_${dir}`) : `player_xp:walk_${dir}`;
      };
      // Ensure walk texture + scale (sit uses dolo_sit at 2×)
      if (this.player.texture?.key === 'dolo_sit' || this.player.scaleX !== 1) {
        this._restorePlayerWalkSprite(null);
      } else if (this.player.texture.key !== 'dolo') {
        this.player.setTexture('dolo');
      }
      if (this.facing === 'up') {
        this.player.anims.play(baseKey('up'), true);
      } else if (this.facing === 'down') {
        this.player.anims.play(baseKey('down'), true);
      } else if (this.facing === 'left') {
        this.player.anims.play(baseKey('left'), true);
      } else if (this.facing === 'right') {
        this.player.anims.play(baseKey('right'), true);
      }
    } else {
      // Idle: play idle animation or hold first walk frame for that direction.
      if (this.player.texture?.key === 'dolo_sit' || this.player.scaleX !== 1) {
        this._restorePlayerWalkSprite(null);
      } else if (this.player.texture.key !== 'dolo') {
        this.player.setTexture('dolo');
      }
      const idleKey = (dir) => {
        const fn = this._playerAnimKey;
        return fn ? fn(`idle_${dir}`) : `player_xp:idle_${dir}`;
      };
      if (this.facing === 'up') {
        this.player.anims.play(idleKey('up'), true);
      } else if (this.facing === 'down') {
        this.player.anims.play(idleKey('down'), true);
      } else if (this.facing === 'left') {
        this.player.anims.play(idleKey('left'), true);
      } else if (this.facing === 'right') {
        this.player.anims.play(idleKey('right'), true);
      }
    }

    } // hasPlayer — NPC AI continues below even while player spawns async

    // --- Sit prompt: show "Press F" when near a chair ---
    if (hasPlayer && !this._playerSitting && !this._playerOnPhone) {
      const seats = (this._interactables || []).filter(i => {
        const def = i.def;
        return def && (def.type === 'seat' || (def.name && /chair|couch|sofa|seat|bench/i.test(def.name)));
      });
      let nearSeat = null;
      let nearDist = 60;
      seats.forEach(s => {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.sprite.x, s.sprite.y);
        if (d < nearDist) { nearDist = d; nearSeat = s; }
      });
      if (nearSeat && !this._sitPrompt) {
        this._sitPrompt = this.add.text(0, 0, '[F] Sit', {
          fontSize: '10px', fontFamily: 'monospace', color: '#ffffff',
          backgroundColor: '#00000088', padding: { x: 3, y: 2 }
        }).setDepth(9999).setOrigin(0.5, 1);
      }
      if (this._sitPrompt) {
        if (nearSeat) {
          this._sitPrompt.setVisible(true);
          this._sitPrompt.setPosition(nearSeat.sprite.x, nearSeat.sprite.y - 20);
        } else {
          this._sitPrompt.setVisible(false);
        }
      }
    } else if (this._sitPrompt) {
      this._sitPrompt.setVisible(false);
    }

    // --- Talk prompt: show "[Enter] Talk" when near an NPC and facing them ---
    if (hasPlayer && this._playerChat && !this._playerChat.isOpen) {
      let talkNpc = this._playerChat._findFacingNpc();
      if (talkNpc && !this._talkPrompt) {
        this._talkPrompt = this.add.text(0, 0, '[Enter] Talk', {
          fontSize: '10px', fontFamily: 'monospace', color: '#4ade80',
          backgroundColor: '#00000088', padding: { x: 3, y: 2 }
        }).setDepth(9999).setOrigin(0.5, 1);
      }
      if (this._talkPrompt) {
        if (talkNpc) {
          this._talkPrompt.setVisible(true);
          this._talkPrompt.setPosition(talkNpc.x, talkNpc.y - 56);
        } else {
          this._talkPrompt.setVisible(false);
        }
      }
    } else if (this._talkPrompt) {
      this._talkPrompt.setVisible(false);
    }

    // --- NPC AI (always run local wander / desk walks — lightOffice only gates LLM thinks) ---
    if (Array.isArray(this.npcs)) {
      const now = this.time.now;
      const followDistance = 44;
      // Floor pace — a 32px character at 160px/s crossed 5 body-lengths a
      // second, which read as everyone rushing. ~105 is a calm office walk
      // (and matches the walk-cycle frame rate); follow stays quicker so
      // an NPC summoned to the player doesn't dawdle.
      const followSpeed = 150;
      const wanderSpeed = 105;

      // Separation — O(n²); throttle + soft strength so walkers don't jitter.
      // Kept small relative to walk speed: with axis-aligned Manhattan paths
      // a big sideways push made walkers drift diagonally off their lane.
      const SEP_RADIUS = 22;
      const SEP_RADIUS_SQ = SEP_RADIUS * SEP_RADIUS;
      const SEP_STRENGTH = 20;
      const sepEvery = (window.DenizenDeviceProfile?.lightPerf?.()?.sepEveryNFrames) || 3;
      this._sepFrame = (this._sepFrame || 0) + 1;
      const runSep = sepEvery <= 1 || (this._sepFrame % sepEvery) === 0;
      // Cache last sep push per npc so we can reuse between frames (smoother).
      if (!this._sepCache) this._sepCache = new WeakMap();
      const _applySeparation = (npc, vx, vy) => {
        if (!runSep) {
          const cached = this._sepCache.get(npc);
          if (cached) return { vx: vx + cached.sx * 0.6, vy: vy + cached.sy * 0.6 };
          return { vx, vy };
        }
        let sx = 0, sy = 0;
        let speedScale = 1;
        for (let j = 0; j < this.npcs.length; j++) {
          const other = this.npcs[j];
          if (!other || other === npc) continue;
          const oai = other.ai;
          if (oai && (oai.taskState === 'sitting' || oai.taskState === 'reading')) continue;
          const dx = npc.x - other.x;
          const dy = npc.y - other.y;
          const dsq = dx * dx + dy * dy;
          if (dsq === 0 || dsq > SEP_RADIUS_SQ) continue;
          const d = Math.sqrt(dsq);
          const strength = (1 - d / SEP_RADIUS) * SEP_STRENGTH;
          sx += (dx / d) * strength;
          sy += (dy / d) * strength;
          // Head-on aisle encounter: one deterministic walker yields instead
          // of both pushing into each other and jittering. Texture-key order
          // keeps the same NPC yielding for the whole encounter.
          const ovx = other.body?.velocity?.x || 0;
          const ovy = other.body?.velocity?.y || 0;
          const closing = vx * ovx + vy * ovy < 0;
          const myKey = String(npc.texture?.key || '');
          const otherKey = String(other.texture?.key || '');
          if (d < 18 && closing && myKey > otherKey) speedScale = Math.min(speedScale, 0.22);
        }
        this._sepCache.set(npc, { sx, sy });
        return { vx: vx * speedScale + sx, vy: vy * speedScale + sy };
      };
      // Soft-blend velocity so path turns don't hard-snap every frame.
      const _setSmoothVel = (npc, vx, vy) => {
        if (!npc?.body) return;
        const curVx = npc.body.velocity.x || 0;
        const curVy = npc.body.velocity.y || 0;
        // Higher blend = snappier; 0.28 keeps corners smooth with 18 walkers.
        const blend = 0.28;
        npc.body.setVelocity(
          curVx + (vx - curVx) * blend,
          curVy + (vy - curVy) * blend,
        );
      };

      this.npcs.forEach((npc, idx) => {
        const ai = npc.ai;
        if (!ai) return;
        // Multiplayer mirror — walk smoothly toward host targets (don't zero velocity).
        if (npc._mpMirrorUntil && this.time.now < npc._mpMirrorUntil) {
          this._driveMirroredNpc(npc);
          return;
        }
        // Non-sim-host: don't invent wander (host broadcasts poses).
        if (window.__DenizenIsSimHost === false && this._agentManager?._simHostKnown) {
          if (ai.mode === 'wander' && !npc._pathFollower?.isNavigating?.()) {
            if (npc.body) npc.body.setVelocity(0, 0);
            return;
          }
        }

        // Helper: use pathfinding if available, otherwise straight-line
        const pf = npc._pathFollower;
        const usePathfinding = !!pf;

        // --- Physics-aware unstick: if body is blocked, nudge perpendicular ---
        const b = npc.body.blocked;
        if (!b.none && (b.left || b.right || b.up || b.down)) {
          ai._physicsStuckTime = (ai._physicsStuckTime || 0) + delta;
          ai._totalPhysicsStuck = (ai._totalPhysicsStuck || 0) + delta;

          // If stuck on physics for 1.5+ seconds total, abandon current task.
          // Faster recovery → NPCs visibly unstick instead of grinding on walls.
          if (ai._totalPhysicsStuck > 1500) {
            npc.body.setVelocity(0, 0);
            if (pf) pf.stop();
            ai._totalPhysicsStuck = 0;
            ai._physicsStuckTime = 0;
            const inCeoTalk = ai.taskState === 'reporting'
              || (ai._ceoConvoUntil && ai._ceoConvoUntil > now);
            if (inCeoTalk) {
              // Don't wander off while talking to the CEO.
            } else if (ai.mode === 'agent_task') {
              if (this._unstickNpc) this._unstickNpc(npc);
              else {
                ai.taskState = 'idle';
                ai.mode = 'wander';
                ai.nextWanderAt = now + 900;
              }
            } else if (ai.mode === 'wander') {
              ai.wanderTarget = null;
              ai.nextWanderAt = now + 400;
            }
          } else if (ai._physicsStuckTime > 450) {
            // Gentle unstick — big random jumps looked like glitching.
            const nudge = 6;
            if (b.left || b.right) {
              npc.y += (Math.random() > 0.5 ? nudge : -nudge);
            }
            if (b.up || b.down) {
              npc.x += (Math.random() > 0.5 ? nudge : -nudge);
            }
            // Force repath at most once per unstick
            if (pf && pf.waypoints) {
              const dest = pf.waypoints[pf.waypoints.length - 1];
              if (dest) pf.navigateTo(dest.x, dest.y);
            } else if (ai.mode === 'wander' && ai.wanderTarget) {
              if (pf) pf.navigateTo(ai.wanderTarget.x, ai.wanderTarget.y);
            }
            ai._physicsStuckTime = 0;
          }
        } else {
          ai._physicsStuckTime = 0;
          ai._totalPhysicsStuck = 0;
        }

        // === Robust position-based stuck watchdog (catches soft stucks pathfinder didn't see) ===
        // If the NPC should be moving but hasn't made real progress for >~2.2s, force unstick + fresh wander.
        // Be gentler when the goal is the player (reporting/talk/ceo convo) — just repath to a fresh approach spot.
        // Only count as "wants to move" while actually navigating a path.
        // Plain `mode === 'wander'` also matched NPCs deliberately DWELLING
        // at a spot (coffee corner, a colleague's desk), so the watchdog
        // kicked every resting NPC after 2.2s and sent them somewhere new —
        // that constant churn was why the floor never looked settled.
        const wantsToMove = (ai.mode === 'wander' && (npc._pathFollower?.isNavigating?.() ?? true))
          || (ai.mode === 'agent_task' && ai.taskState === 'walking');
        const nearPlayer = this.player && ai.taskTarget && Math.hypot(ai.taskTarget.x - this.player.x, ai.taskTarget.y - this.player.y) < 120;
        const isCeoApproach = nearPlayer || ai.taskState === 'reporting' || (ai._ceoConvoUntil && ai._ceoConvoUntil > now);
        if (wantsToMove) {
          ai._immobileCheck = ai._immobileCheck || { x: npc.x, y: npc.y, t: now, time: 0 };
          const moved = Math.hypot(npc.x - ai._immobileCheck.x, npc.y - ai._immobileCheck.y);
          if (now - ai._immobileCheck.t > 820) {
            if (moved < 3.5) {
              ai._immobileCheck.time = (ai._immobileCheck.time || 0) + (now - ai._immobileCheck.t);
              if (ai._immobileCheck.time > 2200) {
                if (isCeoApproach && this.player && this._pathfinder) {
                  // Don't abort the conversation — just get a fresh good spot next to current player pos
                  const fresh = this._pathfinder.findGoodApproachNear(this.player.x, this.player.y, 26, 68) || { x: this.player.x + (Math.random() > 0.5 ? 36 : -36), y: this.player.y };
                  npc.ai.taskTarget = fresh;
                  if (npc._pathFollower) npc._pathFollower.navigateTo(fresh.x, fresh.y);
                  ai._immobileCheck = { x: npc.x, y: npc.y, t: now, time: 0 };
                  // small jitter to break contact
                  npc.x += (Math.random() - 0.5) * 10;
                  npc.y += (Math.random() - 0.5) * 8;
                } else {
                  const texKey = npc.texture?.key;
                  const agent = texKey ? this._agentManager?.agents?.get(texKey) : null;
                  const npcName = agent?.name || (texKey ? texKey.replace(/^xp_/, '') : null);
                  if (npcName && typeof globalThis.DenizenReportFriction === 'function') {
                    globalThis.DenizenReportFriction(npcName, 'pathfinding', {
                      code: 'IMMOBILE',
                      message: 'immobile watchdog fired after 2.2s while wanting to move',
                    });
                  }
                  // Hard unstick for normal wander/task
                  if (this._unstickNpc) this._unstickNpc(npc);
                  if (this._pathfinder && npc.ai) {
                    const fresh = this._pathfinder.sampleSafeWalkTarget(npc.x, npc.y, 200, 10) || { x: 300 + Math.random()*600, y: 220 + Math.random()*280 };
                    npc.ai.wanderTarget = fresh;
                    npc.ai.nextWanderAt = now + 80;
                    if (npc._pathFollower) npc._pathFollower.navigateTo(fresh.x, fresh.y);
                    npc.ai.mode = 'wander';
                    npc.ai.taskState = null;
                  }
                  ai._immobileCheck = { x: npc.x, y: npc.y, t: now, time: 0 };
                }
              }
            } else {
              ai._immobileCheck = { x: npc.x, y: npc.y, t: now, time: 0 };
            }
          }
        } else {
          ai._immobileCheck = { x: npc.x, y: npc.y, t: now, time: 0 };
        }

        if (ai.mode === 'agent_task') {
          // Freeze only when truly seated / reading / reporting — not taskState 'working'
          // (that label was set when pathing ended near a desk without seating, which caused random freezes).
          const isStationary = ai.taskState === 'sitting' || ai.taskState === 'reading' || ai.taskState === 'reporting';
          if (isStationary) {
            npc.body.setVelocity(0, 0);
            // Don't continue to movement logic — skip to animation section
          } else {
          // AI agent task: walk to assigned position and stay
          // Fallback to NPC's assigned desk or spawn position, not a hardcoded center
          const t = ai.taskTarget || ai._assignedDeskPos || ai._spawnPos || { x: npc.x, y: npc.y };
          const dist = Math.hypot(t.x - npc.x, t.y - npc.y);

          if (dist > 10) {
            if (usePathfinding) {
              // Start pathfinding if not already navigating to this target
              if (!pf.isNavigating() || ai._lastTarget?.x !== t.x || ai._lastTarget?.y !== t.y) {
                pf.navigateTo(t.x, t.y);
                ai._lastTarget = { x: t.x, y: t.y };
              }
              const vel = pf.update(wanderSpeed, delta);
              if (vel) {
                const sep = _applySeparation(npc, vel.vx, vel.vy);
                _setSmoothVel(npc, sep.vx, sep.vy);
                if (ai.taskState !== 'walking') ai.taskState = 'walking';
              } else {
                // Path follower returned null — arrived or gave up
                npc.body.setVelocity(0, 0);
                const distToTarget = ai.taskTarget ? Phaser.Math.Distance.Between(npc.x, npc.y, ai.taskTarget.x, ai.taskTarget.y) : 0;
                ai._lastTarget = null;
                if (distToTarget > 60) {
                  // Gave up — too far from target, go back to idle instead of faking work
                  if (this._unstickNpc) this._unstickNpc(npc);
                  else {
                    ai.mode = 'wander';
                    ai.taskState = null;
                    ai.taskTarget = null;
                  }
                } else if (ai.taskState === 'walking' && ai._sitSnap) {
                  npc.x = ai._sitSnap.x;
                  npc.y = ai._sitSnap.y;
                  ai.facing = ai._sitSnap.facing;
                  ai.taskState = 'sitting';
                  ai._sitSnap = null;
                } else if (ai.taskState === 'walking') {
                  this._trySeatAtDesk(npc, ai);
                }
              }
            } else {
              const rawVx = ((t.x - npc.x) / dist) * wanderSpeed;
              const rawVy = ((t.y - npc.y) / dist) * wanderSpeed;
              const sep = _applySeparation(npc, rawVx, rawVy);
              _setSmoothVel(npc, sep.vx, sep.vy);
              if (ai.taskState !== 'walking') ai.taskState = 'walking';
            }
          } else {
            npc.body.setVelocity(0, 0);
            if (pf) pf.stop();
            if (ai.taskState === 'walking') {
              if (ai._sitSnap) {
                npc.x = ai._sitSnap.x;
                npc.y = ai._sitSnap.y;
                ai.facing = ai._sitSnap.facing;
                ai.taskState = 'sitting';
                ai._sitSnap = null;
              } else {
                this._trySeatAtDesk(npc, ai);
              }
            }
          }
          } // close isStationary else
        } else if (ai.mode === 'follow') {
          const offset = ai.followOffset || { x: 0, y: 0 };
          const targetX = this.player.x + offset.x;
          const targetY = this.player.y + offset.y;
          const dist = Math.hypot(targetX - npc.x, targetY - npc.y);

          if (dist > followDistance) {
            if (usePathfinding) {
              // Re-path every 500ms while following (player moves)
              if (!ai._followRepath || now - ai._followRepath > 500) {
                pf.navigateTo(targetX, targetY);
                ai._followRepath = now;
              }
              const vel = pf.update(followSpeed, delta);
              if (vel) {
                const sep = _applySeparation(npc, vel.vx, vel.vy);
                _setSmoothVel(npc, sep.vx, sep.vy);
              } else {
                npc.body.setVelocity(0, 0);
              }
            } else {
              const rawVx = ((targetX - npc.x) / dist) * followSpeed;
              const rawVy = ((targetY - npc.y) / dist) * followSpeed;
              const sep = _applySeparation(npc, rawVx, rawVy);
              _setSmoothVel(npc, sep.vx, sep.vy);
            }
          } else {
            npc.body.setVelocity(0, 0);
            if (pf) pf.stop();
          }
        } else {
          // Wander mode — pick a new random walkable destination
          // (Desk return is AgentManager._forceReturnToDesks + think decisions —
          //  do not auto-hijack wander every frame while status is "working".)
          if (now >= ai.nextWanderAt) {
            // Living-office routine: pick a meaningful destination; the real
            // dwell timer is set on ARRIVAL (below), this is just a ceiling
            // so a lost path can't leave the NPC parked forever.
            const poi = this._pickNpcPoi(npc);
            ai._poi = poi;
            ai._poiArrived = false;
            ai.wanderTarget = poi.pos;
            ai.nextWanderAt = now + 30000;
            if (usePathfinding) {
              const found = pf.navigateTo(poi.pos.x, poi.pos.y);
              if (!found) {
                ai._poi = null;
                ai.nextWanderAt = now + 500;
              }
            }
          }

          // Per-NPC pace so the floor doesn't march in lockstep.
          if (ai._paceMul == null) ai._paceMul = 0.85 + Math.random() * 0.3;
          const npcWanderSpeed = wanderSpeed * ai._paceMul;

          // Applied when a POI leg finishes: rest there for a while and turn
          // toward whoever/whatever we came to see.
          const _arriveAtPoi = () => {
            if (ai._poiArrived) return;
            ai._poiArrived = true;
            const dwell = ai._poi?.dwellMs || Phaser.Math.Between(1500, 4000);
            ai.nextWanderAt = now + dwell;
            const other = ai._poi?.faceNpc;
            if (other?.ai) {
              const ddx = other.x - npc.x;
              const ddy = other.y - npc.y;
              ai.facing = Math.abs(ddx) > Math.abs(ddy)
                ? (ddx < 0 ? 'left' : 'right')
                : (ddy < 0 ? 'up' : 'down');
              // A settled-but-standing colleague glances back. (Seated ones
              // keep their sit pose — their frame is owned by the seat.)
              const otherDwelling = other.ai.mode === 'wander' && !other._pathFollower?.isNavigating?.();
              if (otherDwelling) {
                other.ai.facing = Math.abs(ddx) > Math.abs(ddy)
                  ? (ddx < 0 ? 'right' : 'left')
                  : (ddy < 0 ? 'down' : 'up');
              }
            }
          };

          if (usePathfinding && pf.isNavigating()) {
            const vel = pf.update(npcWanderSpeed, delta);
            if (vel) {
              const sep = _applySeparation(npc, vel.vx, vel.vy);
              _setSmoothVel(npc, sep.vx, sep.vy);
            } else {
              // Arrived (or path lost close enough) — settle in.
              npc.body.setVelocity(0, 0);
              _arriveAtPoi();
            }
          } else if (!usePathfinding) {
            const dx = ai.wanderTarget.x - npc.x;
            const dy = ai.wanderTarget.y - npc.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 12) {
              const rawVx = (dx / dist) * npcWanderSpeed;
              const rawVy = (dy / dist) * npcWanderSpeed;
              const sep = _applySeparation(npc, rawVx, rawVy);
              _setSmoothVel(npc, sep.vx, sep.vy);
            } else {
              npc.body.setVelocity(0, 0);
              _arriveAtPoi();
            }
          } else {
            // Not navigating — either dwelling at a POI (rest until the
            // dwell timer elapses) or the path failed (retry soon).
            npc.body.setVelocity(0, 0);
            if (!ai._poiArrived) {
              if (ai._poi) _arriveAtPoi();
              else ai.nextWanderAt = Math.min(ai.nextWanderAt || 0, now + 280);
            }
          }
        }

        // Animations based on velocity — only change when facing changes (less anim thrash).
        const vx = npc.body.velocity.x;
        const vy = npc.body.velocity.y;
        const npcMoving = Math.abs(vx) > 4 || Math.abs(vy) > 4;
        if (npcMoving) {
          let nextFacing = ai.facing;
          if (Math.abs(vx) > Math.abs(vy)) {
            nextFacing = vx < 0 ? 'left' : 'right';
          } else {
            nextFacing = vy < 0 ? 'up' : 'down';
          }
          if (nextFacing !== ai.facing || !npc.anims?.isPlaying) {
            ai.facing = nextFacing;
            if (ai.facing === 'up') npc.anims.play(npc._animKey('walk_up'), true);
            else if (ai.facing === 'down') npc.anims.play(npc._animKey('walk_down'), true);
            else if (ai.facing === 'left') npc.anims.play(npc._animKey('walk_left'), true);
            else npc.anims.play(npc._animKey('walk_right'), true);
          }
        } else {
          const idleFrame = ai.facing === 'up' ? 12 : ai.facing === 'down' ? 0 : ai.facing === 'left' ? 4 : 8;
          if (npc.anims?.isPlaying) npc.anims.stop();
          if (npc.frame?.name !== idleFrame && npc.frame?.name !== String(idleFrame)) {
            try { npc.setFrame(idleFrame); } catch (_) {}
          }
        }
      });
    }

    // Update agent controller bubbles
    if (this._npcAgentCtrl) {
      this._npcAgentCtrl.updateBubbles();
    }

    // Update agent office manager (AI agent coordination)
    if (this._agentManager) {
      this._agentManager.update(delta);
    }

    // Multiplayer remote visitor sprites
    this._updateRemotePlayers(delta);

    // Update player chat bubbles
    if (this._playerChat) {
      this._playerChat.updateBubbles();
    }

    // Update robber controller (security threat visualization)
    if (this._robberCtrl) {
      this._robberCtrl.update(this.time.now, delta);
    }
  }

  // ---- Multiplayer remote visitors ----

  _ensureRemotePlayers() {
    if (!this._remotePlayers) this._remotePlayers = new Map();
  }

  /** Drop any remote sprites that are actually us (stale anon/sess echo). */
  purgeSelfRemotePlayers() {
    this._ensureRemotePlayers();
    const selfKey = window.__DenizenPresenceKey || this._agentManager?._presenceKey;
    const ghosts = Array.isArray(window.__DenizenPresenceGhosts)
      ? window.__DenizenPresenceGhosts
      : [];
    if (selfKey) this.removeRemotePlayer(selfKey);
    ghosts.forEach((g) => this.removeRemotePlayer(g));

    const myName = (globalThis.DenizenVisitorSession?.getDisplayName?.()
      || window.__DenizenVisitorDisplayName
      || '').trim().toLowerCase();
    if (!this.player) return;

    const isPlaceholderName = (n) => {
      const s = String(n || '').trim().toLowerCase();
      return !s || s === 'guest' || s === 'demo guest' || s === 'demoguest';
    };

    [...this._remotePlayers.keys()].forEach((id) => {
      const entry = this._remotePlayers.get(id);
      if (!entry) return;
      const n = String(entry.displayName || '').trim().toLowerCase();
      const dx = (entry.targetX || entry.sprite?.x || 0) - this.player.x;
      const dy = (entry.targetY || entry.sprite?.y || 0) - this.player.y;
      const dist2 = dx * dx + dy * dy;
      // Placeholder "Guest" next to you is always a self-echo — remove it.
      if (isPlaceholderName(n) && dist2 < (720 * 720)) {
        this.removeRemotePlayer(id);
        return;
      }
      // Same display name near local avatar = second "me"
      if (myName && n && n === myName && dist2 < (400 * 400)) {
        this.removeRemotePlayer(id);
      }
    });
  }

  /** True when this pose is our own presence echoing back as a remote. */
  _isSelfEchoPose(pose) {
    const id = String(pose?.sessionId || '').trim();
    if (!id) return true;
    const selfKey = window.__DenizenPresenceKey || this._agentManager?._presenceKey;
    if (selfKey && id === selfKey) return true;
    const ghosts = window.__DenizenPresenceGhosts;
    if (Array.isArray(ghosts) && ghosts.includes(id)) return true;

    const myName = (globalThis.DenizenVisitorSession?.getDisplayName?.()
      || window.__DenizenVisitorDisplayName
      || '').trim().toLowerCase();
    const poseName = String(pose.displayName || '').trim().toLowerCase();
    const isPlaceholder = !poseName || poseName === 'guest' || poseName === 'demo guest' || poseName === 'demoguest';
    if (!this.player) return isPlaceholder;
    const dx = (Number(pose.x) || 0) - this.player.x;
    const dy = (Number(pose.y) || 0) - this.player.y;
    const dist2 = dx * dx + dy * dy;
    if (isPlaceholder && dist2 < (720 * 720)) return true;
    if (myName && poseName && myName === poseName && dist2 < (400 * 400)) return true;
    return false;
  }

  upsertRemotePlayer(pose) {
    this._ensureRemotePlayers();
    const id = String(pose?.sessionId || '').trim();
    if (!id) return;
    if (this._isSelfEchoPose(pose)) {
      this.removeRemotePlayer(id);
      return;
    }

    let entry = this._remotePlayers.get(id);
    const x = Number(pose.x) || 0;
    const y = Number(pose.y) || 0;
    const facing = pose.facing || 'down';
    const anim = pose.anim || 'idle';
    const name = String(pose.displayName || 'Guest').slice(0, 24);


    if (!entry) {
      if (!this.textures.exists('dolo')) return;
      const sprite = this.physics.add.sprite(x, y, 'dolo', 20);
      sprite.setOrigin(0.5, 1);
      sprite.setScale(1);
      sprite.setDepth(10);
      sprite.body.moves = false;
      sprite.body.enable = false;
      // Compact remote-player tag — world-space text next to ~32px sprites
      // at 2-3x camera zoom, so 11px + fat padding loomed over heads.
      const label = this.add.text(x, y - 38, name, {
        fontSize: '8px',
        fontFamily: 'Segoe UI, system-ui, -apple-system, sans-serif',
        fontStyle: 'bold',
        color: '#0f172a',
        backgroundColor: '#fffffff5',
        padding: { x: 4, y: 2 },
        align: 'center',
      });
      label.setOrigin(0.5, 1);
      label.setDepth(9995);
      label.setAlpha(0.98);
      if (typeof label.setResolution === 'function') {
        try {
          const light = globalThis.DenizenDeviceProfile?.lightPerf?.()?.light
            || globalThis.DenizenDeviceProfile?.wantsLightPerf?.();
          label.setResolution(light ? 1 : 2);
        } catch (_) {
          label.setResolution(2);
        }
      }
      entry = {
        id,
        sprite,
        label,
        targetX: x,
        targetY: y,
        facing,
        anim,
        displayName: name,
      };
      this._remotePlayers.set(id, entry);
    } else {
      entry.targetX = x;
      entry.targetY = y;
      entry.facing = facing;
      entry.anim = anim;
      if (name && entry.displayName !== name) {
        entry.displayName = name;
        entry.label?.setText(name);
      }
    }
    this._playRemoteAnim(entry);
  }

  removeRemotePlayer(sessionId) {
    this._ensureRemotePlayers();
    const id = String(sessionId || '').trim();
    const entry = this._remotePlayers.get(id);
    if (!entry) return;
    try { entry.sprite?.destroy(); } catch (_) {}
    try { entry.label?.destroy(); } catch (_) {}
    this._remotePlayers.delete(id);
  }

  applyRemotePlayersSnapshot(players = []) {
    this._ensureRemotePlayers();
    const keep = new Set();
    (players || []).forEach((p) => {
      const id = String(p.sessionId || '').trim();
      if (!id) return;
      if (this._isSelfEchoPose(p)) {
        this.removeRemotePlayer(id);
        return;
      }
      keep.add(id);
      this.upsertRemotePlayer(p);
    });
    [...this._remotePlayers.keys()].forEach((id) => {
      if (!keep.has(id)) this.removeRemotePlayer(id);
    });
    this.purgeSelfRemotePlayers();
  }

  _playRemoteAnim(entry) {
    if (!entry?.sprite || !this._playerAnimKey) return;
    const dir = entry.facing || 'down';
    const moving = entry.anim === 'walk' || entry.anim === 'walking';
    const key = this._playerAnimKey(moving ? `walk_${dir}` : `idle_${dir}`);
    if (this.anims.exists(key)) {
      try { entry.sprite.anims.play(key, true); } catch (_) {}
    }
  }

  _updateRemotePlayers(delta) {
    if (!this._remotePlayers || this._remotePlayers.size === 0) return;
    // Scrub self-echo often — Guest doubles stick to the player while walking.
    this._selfPurgeAt = this._selfPurgeAt || 0;
    const now = this.time?.now || Date.now();
    if (now - this._selfPurgeAt > 400) {
      this._selfPurgeAt = now;
      this.purgeSelfRemotePlayers();
      if (!this._remotePlayers.size) return;
    }
    const dt = Math.min(0.05, (delta || 16) / 1000);
    const lerp = 1 - Math.pow(0.001, dt); // snappy follow
    this._remotePlayers.forEach((entry) => {
      const sp = entry.sprite;
      if (!sp || !sp.active) return;
      const dx = entry.targetX - sp.x;
      const dy = entry.targetY - sp.y;
      sp.x += dx * Math.min(1, lerp * 14);
      sp.y += dy * Math.min(1, lerp * 14);
      if (entry.label) {
        entry.label.x = sp.x;
        entry.label.y = sp.y - 38;
      }
    });
  }

  /**
   * Drive an NPC toward the latest host pose target with continuous velocity
   * (avoids the old stop/snap/stop stutter from ~5 Hz pose packets).
   */
  _driveMirroredNpc(npc) {
    if (!npc?.body) return;
    const tx = npc._mpTargetX;
    const ty = npc._mpTargetY;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
      npc.body.setVelocity(0, 0);
      return;
    }
    const dx = tx - npc.x;
    const dy = ty - npc.y;
    const dist = Math.hypot(dx, dy);
    const ai = npc.ai;
    if (dist < 3.5) {
      npc.body.setVelocity(0, 0);
      npc.x = tx;
      npc.y = ty;
      if (ai && npc._animKey) {
        const idleFrame = ai.facing === 'up' ? 12 : ai.facing === 'down' ? 0 : ai.facing === 'left' ? 4 : 8;
        if (npc.frame?.name !== idleFrame) {
          try { npc.setFrame(idleFrame); npc.anims.stop(); } catch (_) {}
        }
      }
      return;
    }
    // Match wander speed; catch-up a bit when behind the host sample.
    const speed = dist > 48 ? 175 : dist > 18 ? 145 : 120;
    const vx = (dx / dist) * speed;
    const vy = (dy / dist) * speed;
    npc.body.setVelocity(vx, vy);
    if (!ai || !npc._animKey) return;
    if (Math.abs(vx) > Math.abs(vy)) ai.facing = vx < 0 ? 'left' : 'right';
    else ai.facing = vy < 0 ? 'up' : 'down';
    try {
      if (ai.facing === 'up') npc.anims.play(npc._animKey('walk_up'), true);
      else if (ai.facing === 'down') npc.anims.play(npc._animKey('walk_down'), true);
      else if (ai.facing === 'left') npc.anims.play(npc._animKey('walk_left'), true);
      else npc.anims.play(npc._animKey('walk_right'), true);
    } catch (_) {}
  }

  /**
   * Mirror host NPC poses (non-host clients). Set targets only — scene update
   * walks toward them with velocity so motion stays continuous between packets.
   */
  applyNpcPoses(npcs = []) {
    if (!Array.isArray(npcs) || !Array.isArray(this.npcs)) return;
    const byKey = new Map();
    this.npcs.forEach((npc) => {
      const key = npc?.texture?.key;
      if (key) byKey.set(key, npc);
    });
    npcs.forEach((pose) => {
      const key = pose.key || pose.id || pose.npcKey;
      const npc = byKey.get(key);
      if (!npc) return;
      const tx = Number(pose.x);
      const ty = Number(pose.y);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      // Soft-correct big desyncs (late join / tab focus) without every-tick snaps.
      const gap = Math.hypot(tx - npc.x, ty - npc.y);
      if (gap > 160) {
        npc.x = tx;
        npc.y = ty;
        if (npc.body) {
          try { npc.body.setVelocity(0, 0); } catch (_) {}
        }
      }
      // Stop inventing a different path — host owns destination.
      if (npc._pathFollower?.isNavigating?.()) {
        try { npc._pathFollower.stop(); } catch (_) {}
      }
      npc._mpTargetX = tx;
      npc._mpTargetY = ty;
      npc._mpMirrorUntil = this.time.now + 450;
      if (pose.facing && npc.ai) npc.ai.facing = pose.facing;
      if (pose.taskState && npc.ai) npc.ai.taskState = pose.taskState;
    });
  }
}

  return OfficeScene;
}

if (window.DenizenLazyScripts?.loadDeferred) {
  window.DenizenLazyScripts.loadDeferred();
}

function preferCanvasRenderer() {
  try {
    const q = new URLSearchParams(window.location.search);
    // WebGL texture uploads during office create() have been hanging/OOMing
    // browsers in the wild (Brave, low-RAM machines, and others we couldn't
    // pin down). Canvas2D is plenty for a 2D pixel-art office, so it's the
    // default now — pass ?webgl=1 to opt back into WebGL.
    if (q.get('webgl') === '1') return false;
  } catch (_) {}
  return true;
}

function bootOfficeGame() {
  if (window.game || window.__DenizenOfficeBooting) return;
  window.__DenizenOfficeBooting = true;

  const OfficeScene = createOfficeSceneClass();
  const useCanvas = preferCanvasRenderer();
  const perf = (typeof window.DenizenDeviceProfile?.lightPerf === 'function')
    ? window.DenizenDeviceProfile.lightPerf()
    : { light: false, targetFps: 0 };
  try {
    window.__DenizenLightPerf = !!perf.light;
    if (perf.light) console.log('[Perf] light office profile ON', perf);
  } catch (_) {}
  const _touchLayout = (() => {
    try {
      if (document.documentElement.classList.contains('denizen-touch')) return true;
    } catch (_) {}
    return !!window.__DenizenIsTouch;
  })();
  const config = {
    type: useCanvas ? Phaser.CANVAS : Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: document.getElementById('game-container') || 'game-container',
    backgroundColor: '#020617',
    pixelArt: true,
    scale: {
      pauseOnBlur: false,
      // Touch devices let the canvas follow its CSS box instead of staying a
      // fixed 1280x720. On a 375x812 phone the 16:9 lock rendered the game at
      // 355x200 — 25% of the screen, with 602px dead below — and it rendered
      // 1280x720 pixels just to shrink them into 355x200. RESIZE fixes both:
      // a tall box shows more world, and the backing store matches what is
      // actually displayed. Desktop keeps the framing the office was laid out
      // for. The `||` is deliberate: __DenizenIsTouch and the denizen-touch
      // class come from two different detectors, and if they ever disagree a
      // RESIZE canvas still matches whatever box CSS produces, whereas a fixed
      // canvas in a non-16:9 box would stretch.
      ...(_touchLayout ? { mode: Phaser.Scale.RESIZE } : {}),
    },
    // Snap every draw to whole pixels. Without this, NPCs at fractional
    // coordinates (e.g. x=156.7) render their name labels at sub-pixel
    // offsets, and nearest-neighbor sampling (from pixelArt:true) smears
    // each tiny 6-7px glyph across two display pixels → blurry text that
    // shifts as the NPC walks. roundPixels:true fixes it for free.
    roundPixels: true,
    loader: {
      // Keep Brave from opening too many asset sockets at once (OOM / hang).
      maxParallelDownloads: 4,
      maxRetries: 2,
      // Abort hung asset requests so preload cannot sit on DOLONIA forever.
      timeout: 20000,
    },
    physics: {
      default: 'arcade',
      arcade: { debug: false }
    },
    scene: [OfficeScene]
  };
  // Soft FPS hint on phones / weak hardware — do NOT use forceSetTimeOut
  // (setTimeout pacing feels laggy and makes walking read as "slow").
  if (perf.targetFps && perf.targetFps > 0) {
    config.fps = { target: perf.targetFps, min: 20, forceSetTimeOut: false };
  }

  const banner = document.getElementById('denizen-load-banner');
  const showBootError = (msg) => {
    window.__DenizenOfficeBooting = false;
    console.error('[OfficeScene]', msg);
    if (!banner) return;
    banner.style.display = '';
    banner.style.background = 'rgba(127, 29, 29, 0.95)';
    banner.style.color = '#fecaca';
    banner.innerHTML = `<strong>Office failed</strong> — ${msg} <span id="denizen-boot-tag">(boot v7)</span>`;
  };

  if (typeof Phaser === 'undefined') {
    showBootError('Phaser is undefined after script load. Soften Brave Shields, then hard-refresh.');
    return;
  }
  if (!document.getElementById('game-container')) {
    showBootError('Missing #game-container in the page.');
    return;
  }

  try {
    window.game = new Phaser.Game(config);
    console.log('[OfficeScene] Phaser.Game created', Phaser.VERSION, useCanvas ? 'CANVAS' : 'AUTO');
    try { window.__DenizenChatBootstrap?.setLoadPct?.(1); } catch (_) {}
  } catch (err) {
    // WebGL can throw on some locked-down GPUs — retry pure Canvas.
    try {
      config.type = Phaser.CANVAS;
      window.game = new Phaser.Game(config);
      console.warn('[OfficeScene] WebGL failed; fell back to Canvas', err?.message || err);
    } catch (err2) {
      showBootError(`Phaser.Game crashed: ${err2?.message || err2}`);
    }
  }
}

function showPhaserBlockedBanner() {
  console.error('[OfficeScene] Phaser failed to load — blocked script or missing /vendor/phaser/phaser.min.js');
  try {
    const el = document.getElementById('denizen-load-banner') || document.createElement('div');
    el.id = 'denizen-load-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100001;background:rgba(127,29,29,0.95);color:#fecaca;text-align:center;padding:10px;font:12px ui-monospace,monospace';
    el.innerHTML = '<strong>Office engine blocked</strong> — Phaser did not load. In Brave: click the lion icon → Shields Down for this site, then Ctrl+Shift+R.';
    if (!el.parentNode) document.body.appendChild(el);
    window.__DenizenChatBootstrap?.setLoadPct?.(100);
  } catch (_) {}
}

function startOfficeWhenPhaserReady() {
  if (typeof Phaser !== 'undefined') {
    bootOfficeGame();
    return;
  }
  // Dynamic loader in index.html may still be fetching (local → CDN fallback).
  if (window.__DenizenPhaserLoadDone) {
    showPhaserBlockedBanner();
    return;
  }
  const onReady = (ok) => {
    if (ok && typeof Phaser !== 'undefined') bootOfficeGame();
    else showPhaserBlockedBanner();
  };
  const prev = window.__onDenizenPhaserReady;
  window.__onDenizenPhaserReady = (ok) => {
    try { if (typeof prev === 'function') prev(ok); } catch (_) {}
    onReady(ok);
  };
  let tries = 0;
  const poll = setInterval(() => {
    tries += 1;
    if (typeof Phaser !== 'undefined') {
      clearInterval(poll);
      bootOfficeGame();
      return;
    }
    if (window.__DenizenPhaserLoadDone || tries >= 80) {
      clearInterval(poll);
      showPhaserBlockedBanner();
    }
  }, 100);
}

startOfficeWhenPhaserReady();

// ========== DRAG & DROP EDITOR MODE ==========
// Editor: Ctrl+Shift+E (or Cmd+Shift+E on Mac). Never plain E — that letter is
// needed for chat / forms / spelling. ?editor=1 still auto-opens the editor.
(function editorBoot() {
  // The game boots asynchronously (Phaser CDN + boot function), so this tail
  // IIFE can parse BEFORE window.game exists. Bailing permanently here left
  // the map editor AND window.DenizenLiveFurniture undefined whenever the
  // race lost — which is why NPC-placed furniture never rendered. Retry
  // until the game is up instead.
  if (typeof Phaser === 'undefined' || !window.game) {
    setTimeout(editorBoot, 250);
    return;
  }
  const DOUBLE_CLICK_MS = 260;
  const WALL_MULTI_CLICK_MS = 420;
  const WALL_LAYER_ORDER = ['all', 'bands', 'sides', 'joints'];
  const WALL_LAYER_LABELS = {
    all: 'All pieces',
    bands: 'Bands only',
    sides: 'Sides only',
    joints: 'Joints only',
  };
  let editorActive = false;
  let editorMode = 'furniture';
  let selectedSprite = null;
  /** Multi-select: all currently-selected root sprites. selectedSprite mirrors the last one for compat. */
  let selectedSprites = [];
  let selectionGfx = null;
  let selectionRotateHandle = null;
  let editorGridGfx = null;
  let editorPrefs = (window.DenizenMapEditorPro?.loadPrefs?.()) || { favorites: [], recent: [], onboardingDismissed: false, showGrid: true };
  let catalogCategory = 'surface';
  let catalogSearchTimer = null;
  const CATALOG_LIST_LIMIT = 64;
  let savedCameraState = null;
  let spacePanning = false;
  let panPointerActive = false;
  let panPointerStart = null;
  let panCameraStart = null;
  let selectedWallEntry = null;
  let wallCutMode = false;
  let wallPendingType = null;
  let wallTool = 'draw';
  let wallDrawStart = null;
  let wallDrawPreview = [];
  let wallLayerFilter = 'all';
  let wallHoveredEntry = null;
  let wallClickStreak = { id: null, count: 0, at: 0 };
  let editorUI = null;
  let layerFilter = 'all';
  let lastPointerTarget = null;
  let lastPointerAt = 0;
  /** Sims-style translucent preview while a catalog item is pending placement. */
  let placeGhost = null;
  let pendingPlaceRotation = 0;
  const MAX_EDITOR_UNDO = 40;
  let editorUndoStack = [];
  let editorRedoStack = [];
  let dragUndoSnapshot = null;
  let dragOrigin = null;
  let restoringEditorHistory = false;
  let editorChromeCollapsed = !!(editorPrefs.chromeCollapsed);

  function getScene() {
    return window.game?.scene?.scenes?.[0];
  }

  function getCatalog(scene) {
    return scene?.cache?.json?.get('furniture_catalog_openplan') || null;
  }

  function clonePlacements(placements) {
    return JSON.parse(JSON.stringify(Array.isArray(placements) ? placements : []));
  }

  function captureEditorSnapshot(label = 'edit', { includeWalls = true, includeFurniture = true } = {}) {
    const scene = getScene();
    if (!scene) return null;
    const state = initEditorState(scene);
    const OW = getOpenplanWalls();
    return {
      label,
      kind: includeWalls && !includeFurniture
        ? 'walls'
        : includeFurniture && !includeWalls
          ? 'furniture'
          : 'both',
      placements: includeFurniture ? clonePlacements(state.placements) : null,
      nextId: state.nextId,
      walls: includeWalls && OW ? OW.layoutFromScene(scene, scene._wallLayoutInfo || {}) : null,
    };
  }

  function updateUndoButtons() {
    const undoBtn = document.getElementById('ed-undo-btn');
    const redoBtn = document.getElementById('ed-redo-btn');
    const undoLabel = editorUndoStack.length
      ? editorUndoStack[editorUndoStack.length - 1].label
      : '';
    const redoLabel = editorRedoStack.length
      ? editorRedoStack[editorRedoStack.length - 1].label
      : '';
    if (undoBtn) {
      undoBtn.disabled = editorUndoStack.length === 0;
      undoBtn.title = undoLabel ? `Undo ${undoLabel} (Ctrl/⌘Z)` : 'Nothing to undo';
      undoBtn.setAttribute('aria-disabled', undoBtn.disabled ? 'true' : 'false');
    }
    if (redoBtn) {
      redoBtn.disabled = editorRedoStack.length === 0;
      redoBtn.title = redoLabel ? `Redo ${redoLabel} (Ctrl/⌘⇧Z)` : 'Nothing to redo';
      redoBtn.setAttribute('aria-disabled', redoBtn.disabled ? 'true' : 'false');
    }
  }

  function pushEditorUndo(label, opts) {
    if (restoringEditorHistory) return;
    // Default: furniture-only snapshots. Wall tools use pushWallUndo().
    const options = opts || { includeWalls: false, includeFurniture: true };
    const snap = captureEditorSnapshot(label, options);
    if (!snap) return;
    editorUndoStack.push(snap);
    if (editorUndoStack.length > MAX_EDITOR_UNDO) editorUndoStack.shift();
    editorRedoStack = [];
    updateUndoButtons();
  }

  function pushWallUndo(label) {
    pushEditorUndo(label, { includeWalls: true, includeFurniture: false });
    const scene = getScene();
    if (scene) scheduleLayoutSave(scene);
  }

  function clearAllFurnitureEntries(scene) {
    if (!scene?._interactables) return;
    // Destroy without recursive syncInfo spam / pathfinder thrash.
    const all = [...(scene._interactables || [])];
    all.forEach((entry) => {
      try {
        removeObstacle(scene, entry.obstacle);
        if (entry.sprite) entry.sprite.destroy();
        delete scene._placedCatalogSprites?.[entry.instanceId];
      } catch (_) {}
    });
    scene._interactables = [];
    scene.furnitureDecorSprites = [];
    scene._placedCatalogSprites = {};
    const state = initEditorState(scene);
    state.placements = [];
  }

  function restoreWallsFromSnapshot(scene, walls) {
    const OW = getOpenplanWalls();
    if (!OW || !walls) return;
    // renderLayout already clears existing segments — don't removeSegment first
    // (that left orphaned physics bodies and broke the map).
    OW.renderLayout(scene, walls, scene._obstacles);
    selectedWallEntry = null;
    if (editorMode === 'walls') refreshWallEditorInteraction(scene);
    renderWallSegmentList();
  }

  function restoreEditorSnapshot(snapshot) {
    const scene = getScene();
    if (!scene || !snapshot) return;
    restoringEditorHistory = true;
    try {
      clearFurnitureSelection();
      const state = initEditorState(scene);
      state.pendingCatalogId = null;
      destroyPlaceGhost();

      const restoreFurniture = snapshot.placements != null
        && (snapshot.kind === 'furniture' || snapshot.kind === 'both' || snapshot.kind == null);
      const restoreWalls = snapshot.walls != null
        && (snapshot.kind === 'walls' || snapshot.kind === 'both');

      if (restoreFurniture) {
        clearAllFurnitureEntries(scene);
        state.placements = clonePlacements(snapshot.placements);
        state.nextId = snapshot.nextId || 1;
        const catalog = getCatalog(scene);
        const parents = state.placements.filter((p) => !p.parentInstanceId && !p._comment);
        const children = state.placements.filter((p) => p.parentInstanceId);
        const placeAll = () => {
          parents.forEach((placement) => makePlacementSprite(scene, placement));
          children.forEach((placement) => makePlacementSprite(scene, placement));
          scene._depthDirty = true;
        };
        // Preload any missing single-file textures before placing.
        const missing = [];
        state.placements.forEach((pl) => {
          if (pl._comment) return;
          const def = catalog?.objects?.[pl.id];
          if (def?.source_type !== 'single_file') return;
          const key = `single_${pl.id}`;
          if (scene.textures.exists(key)) return;
          const url = String(def.url_path || '').replace(/\\/g, '/');
          if (!url) return;
          missing.push({ key, url });
        });
        if (missing.length) {
          missing.forEach(({ key, url }) => scene.load.image(key, url));
          scene.load.once('complete', () => {
            placeAll();
            scene._agentManager?.refreshDeskAnchorsAfterLayoutChange?.();
          });
          if (!scene.load.isLoading()) scene.load.start();
        } else {
          placeAll();
        }
      }
      if (restoreWalls) {
        restoreWallsFromSnapshot(scene, snapshot.walls);
      }

      scene._depthDirty = true;
      scene._agentManager?.refreshDeskAnchorsAfterLayoutChange?.();
      // Quiet save — avoid flashing "Saving…" mid-undo.
      scheduleLayoutSave(scene);
      const selected = document.getElementById('ed-selected');
      if (selected) selected.textContent = 'Nothing selected';
      refreshEditorStatusChrome();
    } finally {
      restoringEditorHistory = false;
      updateUndoButtons();
    }
  }

  function undoEditorChange() {
    if (!editorActive || !editorUndoStack.length) {
      syncInfo('Nothing to undo');
      return;
    }
    const scene = getScene();
    if (!scene) return;
    const snap = editorUndoStack.pop();
    // Capture current state matching what the undo snapshot contains.
    const current = captureEditorSnapshot('redo', {
      includeFurniture: snap.placements != null,
      includeWalls: snap.walls != null && snap.kind !== 'furniture',
    });
    if (current) {
      current.kind = snap.kind || current.kind;
      editorRedoStack.push(current);
    }
    restoreEditorSnapshot(snap);
    syncInfo(`Undid ${snap.label}`);
  }

  function redoEditorChange() {
    if (!editorActive || !editorRedoStack.length) {
      syncInfo('Nothing to redo');
      return;
    }
    const scene = getScene();
    if (!scene) return;
    const snap = editorRedoStack.pop();
    const current = captureEditorSnapshot('undo', {
      includeFurniture: snap.placements != null,
      includeWalls: snap.walls != null && snap.kind !== 'furniture',
    });
    if (current) {
      current.kind = snap.kind || current.kind;
      editorUndoStack.push(current);
    }
    restoreEditorSnapshot(snap);
    syncInfo(`Redid ${snap.label}`);
  }

  function initEditorState(scene) {
    if (scene._editorState) return scene._editorState;
    const catalog = getCatalog(scene);
    const placements = clonePlacements(catalog?.placements);
    let nextId = 1;
    for (const p of placements) {
      const m = String(p.instanceId || '').match(/_(\d+)$/);
      if (m) nextId = Math.max(nextId, Number(m[1]) + 1);
    }
    scene._editorState = {
      placements,
      nextId,
      pendingCatalogId: null
    };
    return scene._editorState;
  }

  function syncInfo(text) {
    const info = document.getElementById('ed-info');
    if (info) info.textContent = text;
    refreshEditorStatusChrome();
  }

  function refreshEditorStatusChrome() {
    const scene = getScene();
    const modeEl = document.getElementById('ed-status-mode');
    const panel = document.getElementById('ed-status-panel');
    if (!modeEl || !panel) return;
    const pending = scene?._editorState?.pendingCatalogId;
    let mode = 'idle';
    let label = 'Ready';
    if (editorMode === 'walls') {
      mode = 'walls';
      label = 'Walls';
    } else if (pending) {
      mode = 'placing';
      label = 'Placing';
    } else if (selectedSprite) {
      mode = 'selected';
      label = 'Selected';
    }
    modeEl.textContent = label;
    panel.dataset.mode = mode;
  }

  function getOpenplanWalls() {
    return window.OpenplanWalls;
  }

  function wallEditorHint(extra = '') {
    const layer = WALL_LAYER_LABELS[wallLayerFilter] || 'All pieces';
    const base = `Layer: ${layer} · click=select · double-click=delete · triple-click=cycle layer`;
    return extra ? `${extra} — ${base}` : base;
  }

  function syncWallLayerUi() {
    const sel = document.getElementById('ed-wall-layer');
    if (sel && sel.value !== wallLayerFilter) sel.value = wallLayerFilter;
  }

  function applyWallLayerFilter(scene) {
    const OW = getOpenplanWalls();
    if (!OW || !scene?._wallSegments) return;
    scene._wallSegments.forEach((entry) => OW.setEntryLayerVisible(entry, wallLayerFilter));
    if (selectedWallEntry?._layerDimmed) selectWallEntry(null);
    syncWallLayerUi();
    renderWallSegmentList();
    refreshWallEditorInteraction(scene);
  }

  function cycleWallLayerFilter() {
    const idx = WALL_LAYER_ORDER.indexOf(wallLayerFilter);
    wallLayerFilter = WALL_LAYER_ORDER[(idx + 1) % WALL_LAYER_ORDER.length];
    const scene = getScene();
    applyWallLayerFilter(scene);
    syncInfo(wallEditorHint(`Switched to ${WALL_LAYER_LABELS[wallLayerFilter]}`));
  }

  function setWallLayerFilter(layer) {
    if (!WALL_LAYER_ORDER.includes(layer)) return;
    wallLayerFilter = layer;
    applyWallLayerFilter(getScene());
    syncInfo(wallEditorHint());
  }

  function registerWallClick(entryOrBgId) {
    const now = performance.now();
    const id = entryOrBgId;
    if (wallClickStreak.id === id && now - wallClickStreak.at <= WALL_MULTI_CLICK_MS) {
      wallClickStreak.count += 1;
    } else {
      wallClickStreak = { id, count: 1, at: now };
    }
    wallClickStreak.at = now;
    return wallClickStreak.count;
  }

  function resetWallClickStreak() {
    wallClickStreak = { id: null, count: 0, at: 0 };
  }

  function handleWallEntryClick(scene, entry) {
    const OW = getOpenplanWalls();
    if (!OW || !entry || entry._layerDimmed) return false;
    const clicks = registerWallClick(entry.instanceId);
    if (clicks >= 3) {
      resetWallClickStreak();
      cycleWallLayerFilter();
      return true;
    }
    if (clicks === 2) {
      resetWallClickStreak();
      const id = entry.instanceId;
      const label = OW.segmentLabel(entry.data);
      pushWallUndo(`delete ${label}`);
      if (selectedWallEntry === entry) selectedWallEntry = null;
      OW.removeSegment(scene, id, scene._obstacles);
      syncWallCorners(scene);
      syncInfo(wallEditorHint(`Deleted ${label}`));
      return true;
    }
    selectWallEntry(entry);
    return true;
  }

  function selectWallEntry(entry) {
    const OW = getOpenplanWalls();
    const scene = getScene();
    if (!OW || !scene) return;
    if (selectedWallEntry) {
      selectedWallEntry._selected = false;
      OW.styleEntrySelection(selectedWallEntry, false);
    }
    selectedWallEntry = entry && !entry._layerDimmed ? entry : null;
    if (selectedWallEntry) {
      selectedWallEntry._selected = true;
      OW.styleEntrySelection(selectedWallEntry, true);
      const d = selectedWallEntry.data;
      syncInfo(wallEditorHint(`${OW.segmentLabel(d)} (${OW.segmentBadge(d)})`));
    } else {
      syncInfo(wallEditorHint('Click a wall to select'));
    }
    renderWallSegmentList();
    refreshWallEditorInteraction(scene);
  }

  function renderWallSegmentList() {
    const scene = getScene();
    const OW = getOpenplanWalls();
    const list = document.getElementById('ed-wall-segment-list');
    if (!list || !OW || !scene?._wallSegments) return;
    const items = [...scene._wallSegments].sort((a, b) => {
      const order = { h: 0, corner: 1, tjunction: 2, v: 3 };
      return (order[a.data.type] ?? 9) - (order[b.data.type] ?? 9);
    });
    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<div class="wall-list-empty">No wall pieces — draw one or rebuild the perimeter box.</div>';
      return;
    }
    const countEl = document.getElementById('ed-wall-count');
    if (countEl) countEl.textContent = `(${items.length})`;
    items.forEach((entry) => {
      const d = entry.data;
      const dimmed = !OW.segmentMatchesWallLayer(d, wallLayerFilter);
      const row = document.createElement('div');
      row.className = 'wall-list-item';
      if (selectedWallEntry === entry) row.classList.add('active');
      if (dimmed) row.classList.add('dimmed');
      row.innerHTML = `
        <div class="wall-list-main">
          <span class="wall-list-badge">${OW.segmentBadge(d)}</span>
          <span class="wall-list-name">${OW.segmentLabel(d)}</span>
        </div>
        <button type="button" class="wall-list-del" title="Delete">×</button>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('wall-list-del')) return;
        if (dimmed) return;
        handleWallEntryClick(scene, entry);
      });
      row.querySelector('.wall-list-del').addEventListener('click', (e) => {
        e.stopPropagation();
        const id = entry.instanceId;
        pushWallUndo(`delete ${OW.segmentLabel(d)}`);
        if (selectedWallEntry === entry) selectedWallEntry = null;
        OW.removeSegment(scene, id, scene._obstacles);
        syncWallCorners(scene);
        syncInfo(`Deleted ${OW.segmentLabel(d)}`);
      });
      list.appendChild(row);
    });
  }

  function rebuildPerimeterBox() {
    const scene = getScene();
    const OW = getOpenplanWalls();
    if (!scene || !OW) return;
    pushWallUndo('rebuild perimeter');
    const removeIds = (scene._wallSegments || [])
      .filter((e) => (
        e.data.instanceId?.startsWith('wall_perim_')
        || e.data.type === 'corner'
      ))
      .map((e) => e.instanceId);
    removeIds.forEach((id) => OW.removeSegment(scene, id, scene._obstacles));
    OW.buildOfficeBoxPreset(1280, 720).forEach((seg) => {
      scene._wallSegments.push(OW.renderSegment(scene, seg, scene._obstacles));
    });
    selectedWallEntry = null;
    refreshWallEditorInteraction(scene);
    renderWallSegmentList();
    syncInfo('Rebuilt perimeter box — full-width top/bottom trim + side faces');
  }

  function refreshWallEditorInteraction(scene) {
    const OW = getOpenplanWalls();
    if (!OW || !scene?._wallSegments) return;
    scene._wallSegments.forEach((entry) => {
      OW.setEntryLayerVisible(entry, wallLayerFilter);
      entry._selected = selectedWallEntry === entry;
      OW.styleEntrySelection(entry, entry._selected);
      entry.handles.forEach((h) => h.destroy());
      entry.handles = [];
      if (!entry.hit) return;
      entry.hit.removeAllListeners?.();
      entry.hit.removeInteractive();
      if (editorMode !== 'walls') return;
      if (entry._layerDimmed) return;

      entry.hit.setInteractive({ draggable: true, useHandCursor: true });
      entry._wallDragged = false;
      entry.hit.on('pointerdown', () => {
        entry._wallDragged = false;
      });
      entry.hit.on('pointerover', () => {
        if (wallHoveredEntry && wallHoveredEntry !== entry) {
          OW.styleEntryHover(wallHoveredEntry, false);
        }
        wallHoveredEntry = entry;
        OW.styleEntryHover(entry, true);
      });
      entry.hit.on('pointerout', () => {
        if (wallHoveredEntry === entry) wallHoveredEntry = null;
        OW.styleEntryHover(entry, false);
      });
      entry.hit.on('pointerup', () => {
        if (entry._wallDragged) return;
        handleWallEntryClick(scene, entry);
      });
      entry.hit.on('dragstart', () => {
        entry._wallDragged = true;
        resetWallClickStreak();
        selectWallEntry(entry);
        pushWallUndo(`move ${OW.segmentLabel(entry.data)}`);
        entry._dragStart = { ...entry.data };
      });
      entry.hit.on('drag', (_p, dragX, dragY) => {
        const start = entry._dragStart;
        if (!start) return;
        const snapOn = window._editorSnap;
        const id = entry.instanceId;
        if (start.type === 'h') {
          const w = start.endX - start.startX;
          const nx = OW.snap(dragX - w / 2, snapOn);
          const ny = OW.snap(dragY - OW.T, snapOn);
          OW.replaceSegment(scene, id, { startX: nx, endX: nx + w, y: ny }, scene._obstacles);
        } else if (start.type === 'v') {
          const h = Math.abs(start.endY - start.startY);
          const nx = OW.snap(dragX - OW.T / 2, snapOn);
          const ny = OW.snap(dragY - h / 2, snapOn);
          OW.replaceSegment(scene, id, { x: nx, startY: ny, endY: ny + h }, scene._obstacles);
        } else {
          OW.replaceSegment(scene, id, {
            x: OW.snap(dragX - OW.T / 2, snapOn),
            y: OW.snap(dragY - OW.T, snapOn),
          }, scene._obstacles);
        }
        selectedWallEntry = scene._wallSegments.find((e) => e.instanceId === id) || null;
      });
      entry.hit.on('dragend', () => {
        entry._dragStart = null;
        entry._wallDragged = false;
        syncWallCorners(scene);
      });

      if (selectedWallEntry !== entry) return;

      OW.attachEditorHandles(scene, entry, (segmentId, role, dragX, dragY) => {
        const e = scene._wallSegments.find((x) => x.instanceId === segmentId);
        if (!e) return;
        const snapOn = window._editorSnap;
        const seg = { ...e.data };
        if (seg.type === 'h') {
          if (role === 'start') seg.startX = OW.snap(dragX, snapOn);
          if (role === 'end') seg.endX = OW.snap(dragX, snapOn);
          if (seg.endX - seg.startX < OW.MIN_LEN) return;
        } else if (seg.type === 'v') {
          if (role === 'start') seg.startY = OW.snap(dragY, snapOn);
          if (role === 'end') seg.endY = OW.snap(dragY, snapOn);
          if (Math.abs(seg.endY - seg.startY) < OW.MIN_LEN) return;
        }
        OW.replaceSegment(scene, segmentId, seg, scene._obstacles);
        selectedWallEntry = scene._wallSegments.find((x) => x.instanceId === segmentId) || null;
      }, () => syncWallCorners(scene));
    });
  }

  function clearWallDrawPreview() {
    const OW = getOpenplanWalls();
    if (OW) OW.destroyPreview(wallDrawPreview);
    wallDrawPreview = [];
    wallDrawStart = null;
  }

  function syncWallCorners(scene) {
    const OW = getOpenplanWalls();
    if (!OW || !scene) return;
    OW.syncAutoCorners(scene, scene._obstacles);
    refreshWallEditorInteraction(scene);
    renderWallSegmentList();
  }

  function placeWallSegmentData(scene, seg) {
    const OW = getOpenplanWalls();
    if (!OW || !scene || !seg) return null;
    pushWallUndo(`place ${OW.segmentLabel(seg)}`);
    const entry = OW.renderSegment(scene, seg, scene._obstacles);
    scene._wallSegments.push(entry);
    OW.syncAutoCorners(scene, scene._obstacles);
    const placed = scene._wallSegments.find((e) => e.instanceId === entry.instanceId) || entry;
    selectWallEntry(placed);
    refreshWallEditorInteraction(scene);
    renderWallSegmentList();
    return placed;
  }

  function placeWallSegmentsData(scene, segs) {
    const OW = getOpenplanWalls();
    if (!OW || !scene || !segs?.length) return null;
    pushWallUndo(segs.length > 1 ? 'place L-wall' : `place ${OW.segmentLabel(segs[0])}`);
    let last = null;
    segs.forEach((seg) => {
      const entry = OW.renderSegment(scene, seg, scene._obstacles);
      scene._wallSegments.push(entry);
      last = entry;
    });
    OW.syncAutoCorners(scene, scene._obstacles);
    if (last) selectWallEntry(last);
    refreshWallEditorInteraction(scene);
    renderWallSegmentList();
    return last;
  }

  function addWallSegment(scene, type, worldX, worldY) {
    const OW = getOpenplanWalls();
    if (!OW || !scene) return null;
    return placeWallSegmentData(scene, OW.defaultSegment(type, worldX, worldY, window._editorSnap));
  }

  function setWallTool(tool) {
    wallTool = tool;
    wallCutMode = false;
    wallPendingType = tool === 'draw' ? null : tool;
    clearWallDrawPreview();
    const cutBtn = document.getElementById('ed-wall-cut-btn');
    if (cutBtn) {
      cutBtn.textContent = 'Cut Tool: OFF';
      cutBtn.classList.remove('active-tool');
    }
    document.querySelectorAll('[data-wall-tool]').forEach((btn) => {
      btn.classList.toggle('active-tool', btn.dataset.wallTool === tool);
    });
    const hints = {
      draw: 'Drag across → band (trim on top) · up/down → side wall (trim on back edge) · diagonal → L with corner joint.',
      band: 'Click map — wall band: top trim + light blue face (64px tall)',
      face: 'Click map — side wall: back-edge trim + light blue face (top-down view)',
      corner: 'Click map — corner cap (trim + blue face, 32px wide)',
      tjunction: 'Click map — T-junction cap where walls meet',
      cut: 'Select a wall, then click where to split (doorway gap)',
    };
    syncInfo(wallEditorHint(hints[tool] || hints.draw));
  }

  function duplicateSelectedWall() {
    const scene = getScene();
    const OW = getOpenplanWalls();
    if (!scene || !OW || !selectedWallEntry) return;
    pushWallUndo(`duplicate ${OW.segmentLabel(selectedWallEntry.data)}`);
    const copy = OW.duplicateSegment(selectedWallEntry.data, 32);
    const entry = OW.renderSegment(scene, copy, scene._obstacles);
    scene._wallSegments.push(entry);
    selectWallEntry(entry);
    refreshWallEditorInteraction(scene);
    syncInfo(`Duplicated → ${copy.instanceId}`);
  }

  function deleteSelectedWall() {
    const scene = getScene();
    const OW = getOpenplanWalls();
    if (!scene || !OW || !selectedWallEntry) return;
    const id = selectedWallEntry.instanceId;
    const label = OW.segmentLabel(selectedWallEntry.data);
    pushWallUndo(`delete ${label}`);
    OW.removeSegment(scene, id, scene._obstacles);
    selectedWallEntry = null;
    syncWallCorners(scene);
    syncInfo(`Deleted ${label}`);
  }

  function cutSelectedWallAt(worldX, worldY) {
    const scene = getScene();
    const OW = getOpenplanWalls();
    if (!scene || !OW || !selectedWallEntry) return;
    const parts = OW.splitSegment(selectedWallEntry.data, worldX, worldY);
    if (!parts) {
      syncInfo('Cut failed — click closer to middle of segment (min 32px each side)');
      return;
    }
    pushWallUndo(`cut ${OW.segmentLabel(selectedWallEntry.data)}`);
    OW.removeSegment(scene, selectedWallEntry.instanceId, scene._obstacles);
    parts.forEach((p) => scene._wallSegments.push(OW.renderSegment(scene, p, scene._obstacles)));
    selectedWallEntry = scene._wallSegments[scene._wallSegments.length - 1];
    syncWallCorners(scene);
    syncInfo(`Cut into ${parts.length} segments`);
  }

  window._editorExportWalls = function () {
    const scene = getScene();
    const OW = getOpenplanWalls();
    if (!scene || !OW) return;
    const layout = OW.layoutFromScene(scene, scene._wallLayoutInfo || {});
    const output = JSON.stringify(layout, null, 2);
    // Persist walls into the live layout so reload keeps edits
    flushLayoutSave(scene);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(output).catch(() => {});
    }
    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'openplan_walls_edited.json';
    a.click();
    URL.revokeObjectURL(url);
    syncInfo('Walls saved to server + downloaded JSON');
  };

  function setEditorMode(mode) {
    editorMode = mode === 'walls' ? 'walls' : 'furniture';
    const scene = getScene();
    const catPanel = document.getElementById('editor-catalog');
    const wallPanel = document.getElementById('editor-wall-tools');
    const tabF = document.getElementById('ed-tab-furniture');
    const tabW = document.getElementById('ed-tab-walls');
    const furnitureTools = document.getElementById('ed-furniture-tools');
    if (catPanel) catPanel.style.display = editorMode === 'furniture' ? 'flex' : 'none';
    if (wallPanel) wallPanel.style.display = editorMode === 'walls' ? 'flex' : 'none';
    if (furnitureTools) furnitureTools.style.display = editorMode === 'furniture' ? 'flex' : 'none';
    if (tabF) {
      tabF.classList.toggle('active', editorMode === 'furniture');
      tabF.setAttribute('aria-selected', editorMode === 'furniture' ? 'true' : 'false');
    }
    if (tabW) {
      tabW.classList.toggle('active', editorMode === 'walls');
      tabW.setAttribute('aria-selected', editorMode === 'walls' ? 'true' : 'false');
    }
    wallCutMode = false;
    clearWallDrawPreview();
    syncEditorChromeLayout();
    if (editorMode === 'walls') {
      destroyPlaceGhost();
      destroySelectionOverlay();
      setWallTool('draw');
      if (scene?._interactables) {
        scene._interactables.forEach((entry) => {
          if (entry.sprite) entry.sprite.removeInteractive();
        });
      }
      applyWallLayerFilter(scene);
      syncInfo(wallEditorHint());
    } else {
      selectWallEntry(null);
      if (scene?._wallSegments) {
        scene._wallSegments.forEach((entry) => {
          getOpenplanWalls()?.styleEntrySelection(entry, false);
          entry.handles.forEach((h) => h.destroy());
          entry.handles = [];
          entry.hit?.removeInteractive();
        });
      }
      if (scene?._interactables) {
        scene._interactables.forEach((entry) => prepareSpriteForEditing(scene, entry));
      }
      syncPlaceGhost(scene);
      updateSelectionOverlay();
      syncInfo('Pick a catalog item — ghost follows your cursor. Click the map to place.');
    }
    refreshEditorStatusChrome();
  }

  function destroyPlaceGhost() {
    if (placeGhost?.sprite) {
      try { placeGhost.sprite.destroy(); } catch (_) {}
    }
    placeGhost = null;
  }

  function applyGhostTransform() {
    if (!placeGhost?.sprite) return;
    applyPlacementTransform(placeGhost.sprite, {
      rotation: placeGhost.rotation,
      scale: placeGhost.scale || 1,
      flipX: !!placeGhost.flipX,
      flipY: !!placeGhost.flipY,
    }, placeGhost.def);
  }

  function ensureSingleTexture(scene, catalogId, def, onReady) {
    const singleKey = `single_${catalogId}`;
    if (scene.textures.exists(singleKey)) {
      onReady?.(singleKey);
      return singleKey;
    }
    const url = String(def.url_path || '').replace(/\\/g, '/');
    if (!url) return null;
    scene.load.image(singleKey, url);
    scene.load.once('complete', () => {
      if (scene.textures.exists(singleKey)) onReady?.(singleKey);
    });
    if (!scene.load.isLoading()) scene.load.start();
    return null;
  }

  function syncPlaceGhost(scene) {
    if (!scene || !editorActive || editorMode !== 'furniture') {
      destroyPlaceGhost();
      return;
    }
    const state = initEditorState(scene);
    const catalogId = state.pendingCatalogId;
    if (!catalogId) {
      destroyPlaceGhost();
      return;
    }
    const def = getCatalog(scene)?.objects?.[catalogId];
    if (!def) {
      destroyPlaceGhost();
      return;
    }

    const buildGhost = (texKey) => {
      if (!texKey || !scene.textures.exists(texKey)) return;
      if (placeGhost?.catalogId === catalogId && placeGhost.sprite?.texture?.key === texKey) {
        applyGhostTransform();
        return;
      }
      const prevX = placeGhost?.sprite?.x;
      const prevY = placeGhost?.sprite?.y;
      destroyPlaceGhost();
      const originY = def.origin === 'center' ? 0.5 : 1;
      const sprite = scene.add.image(prevX || 0, prevY || 0, texKey)
        .setOrigin(0.5, originY)
        .setDepth(12000)
        .setAlpha(0.55);
      if (def.source_type === 'single_file') {
        sprite.setDisplaySize(def.display_w || 32, def.display_h || 48);
      }
      placeGhost = {
        sprite,
        catalogId,
        def,
        rotation: pendingPlaceRotation,
        scale: 1,
        flipX: false,
        flipY: false,
      };
      applyGhostTransform();
    };

    if (def.source_type === 'single_file') {
      ensureSingleTexture(scene, catalogId, def, (key) => {
        const st = initEditorState(scene);
        if (st.pendingCatalogId === catalogId) buildGhost(key);
      });
      const existing = `single_${catalogId}`;
      if (scene.textures.exists(existing)) buildGhost(existing);
      return;
    }

    buildGhost(ensureCatalogTexture(scene, catalogId, def));
  }

  function updatePlaceGhostAt(worldX, worldY) {
    if (!placeGhost?.sprite) return;
    const scene = getScene();
    const def = placeGhost.def;
    const MEP = window.DenizenMapEditorPro;
    const engine = window.DenizenMapEngine;
    const isWall = !!(MEP?.isWallMount?.(placeGhost.catalogId, def) || engine?.isWallMount?.(placeGhost.catalogId, def));
    const desk = scene && !isWall && isStackableDecor(placeGhost.catalogId, def)
      ? findDeskUnderPoint(scene, worldX, worldY, { maxDist: 64 })
      : null;
    if (desk) {
      const oy = def?.parent_offset_y !== undefined ? def.parent_offset_y : -18;
      placeGhost.sprite.x = snapCoord(worldX);
      placeGhost.sprite.y = snapCoord(desk.sprite.y + oy);
      placeGhost.sprite.clearTint();
      placeGhost.sprite.setTint(0x7dd3fc);
      syncInfo(`On desk: ${desk.id} — click to place lamp/decor on top`);
      return;
    }
    if (isWall && scene) {
      const segments = scene._wallLayoutSegments
        || scene.cache?.json?.get('openplan_walls')?.segments
        || [];
      const snapped = engine?.snapWallMount?.(worldX, worldY, segments)
        || { x: snapCoord(worldX), y: snapCoord(worldY), wallMount: false };
      placeGhost.sprite.x = snapped.x;
      placeGhost.sprite.y = snapped.y;
      placeGhost.sprite.clearTint();
      if (snapped.wallMount) {
        placeGhost.sprite.setTint(0xa7f3d0);
        syncInfo(`On wall — click to hang ${placeGhost.catalogId}`);
      }
      return;
    }
    placeGhost.sprite.x = snapCoord(worldX);
    placeGhost.sprite.y = snapCoord(worldY);
    if (!scene || !MEP) return;
    const bounds = MEP.spriteWorldBounds(placeGhost.sprite);
    const colliding = MEP.placementCollides(scene, bounds, [placeGhost.sprite]);
    if (colliding) {
      placeGhost.sprite.setTint(0xff6666);
      syncInfo(`Overlaps — still placeable · ${placeGhost.catalogId} · ${Math.round(placeGhost.rotation)}°`);
    } else {
      placeGhost.sprite.clearTint();
    }
  }

  function rotatePlaceGhost(deltaDeg) {
    if (!placeGhost) return false;
    placeGhost.rotation = (((placeGhost.rotation + deltaDeg) % 360) + 360) % 360;
    pendingPlaceRotation = placeGhost.rotation;
    applyGhostTransform();
    syncInfo(`Ghost ${placeGhost.catalogId} · ${Math.round(placeGhost.rotation)}° — click map to place · scroll/,/. rotate`);
    return true;
  }

  function setPendingCatalog(id) {
    const scene = getScene();
    if (!scene) return;
    const state = initEditorState(scene);
    state.pendingCatalogId = id || null;
    if (id && selectedSprites.length) {
      clearFurnitureSelection();
    }
    if (!id) pendingPlaceRotation = 0;
    const selected = document.getElementById('ed-selected');
    if (selected) {
      selected.textContent = state.pendingCatalogId
        ? `Armed: ${state.pendingCatalogId} · ${Math.round(pendingPlaceRotation)}° — click map to drop`
        : (selectedSprite ? selected.textContent : 'Nothing selected');
    }
    document.querySelectorAll('#ed-catalog-list .cat-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.catalogId === state.pendingCatalogId);
    });
    syncPlaceGhost(scene);
    if (state.pendingCatalogId) {
      syncInfo(`Placing ${state.pendingCatalogId} — move mouse, scroll to rotate, click to drop`);
    } else {
      refreshEditorStatusChrome();
    }
  }

  function getCanvasWorldPoint(scene, clientX, clientY) {
    const canvas = scene?.game?.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // Canvas is CSS-scaled (e.g. 1080×607.5 display vs 1280×720 buffer).
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const screenX = (clientX - rect.left) * scaleX;
    const screenY = (clientY - rect.top) * scaleY;
    return scene.cameras.main.getWorldPoint(screenX, screenY);
  }

  function snapCoord(value) {
    return window._editorSnap ? Math.round(value / 4) * 4 : Math.round(value);
  }

  function ensureCatalogTexture(scene, catalogId, def) {
    if (!scene || !def) return null;
    if (def.source_type === 'single_file') {
      const singleKey = `single_${catalogId}`;
      if (scene.textures.exists(singleKey)) return singleKey;
      // Texture not loaded yet — caller should queue a load; don't silently fail forever.
      return null;
    }

    const texKey = `cat_${catalogId}`;
    if (scene.textures.exists(texKey)) return texKey;

    const sheetKey = def.sheet;
    if (!sheetKey || !scene.textures.exists(sheetKey)) return null;
    const img = scene.textures.get(sheetKey).getSourceImage();
    const catalog = getCatalog(scene);
    const sliceMargin = (catalog?.info?.slice_margin_px !== undefined) ? catalog.info.slice_margin_px : 0;
    let sx = def.rect ? def.rect.x : (def.x || 0);
    let sy = def.rect ? def.rect.y : (def.y || 0);
    let sw = Math.max(1, def.rect ? def.rect.w : (def.w || 16));
    let sh = Math.max(1, def.rect ? def.rect.h : (def.h || 16));
    if (sliceMargin > 0) {
      sx = Math.max(0, sx - sliceMargin);
      sy = Math.max(0, sy - sliceMargin);
      sw = Math.min(img.width - sx, sw + sliceMargin * 2);
      sh = Math.min(img.height - sy, sh + sliceMargin * 2);
    }
    const canvasTex = scene.textures.createCanvas(texKey, sw, sh);
    canvasTex.context.imageSmoothingEnabled = false;
    canvasTex.context.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    canvasTex.refresh();
    return texKey;
  }

  function loadSingleThenPlace(scene, catalogId, def, worldX, worldY) {
    const url = String(def.url_path || '').replace(/\\/g, '/');
    if (!url) {
      syncInfo(`Missing url_path for ${catalogId}`);
      return null;
    }
    const singleKey = `single_${catalogId}`;
    syncInfo(`Loading ${catalogId}…`);
    scene.load.image(singleKey, url);
    scene.load.once('complete', () => {
      addCatalogPlacement(scene, catalogId, worldX, worldY);
    });
    if (!scene.load.isLoading()) scene.load.start();
    return null;
  }

  function buildCatalogPreview(scene, catalogId, def, size = 64) {
    // Named singles: use the PNG URL directly so thumbs work without Phaser preload.
    if (def?.source_type === 'single_file') {
      const url = String(def.url_path || '').replace(/\\/g, '/');
      if (url) {
        const img = document.createElement('img');
        img.src = url.startsWith('/') || url.startsWith('http') ? url : `./${url}`;
        img.alt = def.displayName || catalogId;
        img.width = size;
        img.height = size;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.cssText = [
          `width:${size}px`,
          `height:${size}px`,
          'object-fit:contain',
          'image-rendering:pixelated',
          'image-rendering:crisp-edges',
          'background:rgba(255,255,255,0.04)',
          'border-radius:6px',
        ].join(';');
        img.onerror = () => {
          img.style.opacity = '0.25';
          img.title = `Missing: ${url}`;
        };
        return img;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    const pad = size - 8;

    const sheetKey = def?.sheet;
    if (!sheetKey || !scene?.textures?.exists(sheetKey)) return canvas;
    const img = scene.textures.get(sheetKey).getSourceImage();
    const sx = def.rect ? def.rect.x : (def.x || 0);
    const sy = def.rect ? def.rect.y : (def.y || 0);
    const sw = Math.max(1, def.rect ? def.rect.w : (def.w || 16));
    const sh = Math.max(1, def.rect ? def.rect.h : (def.h || 16));
    const scale = Math.min(pad / sw, pad / sh, 1);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    try {
      ctx.drawImage(img, sx, sy, sw, sh, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
    } catch (_) { /* bad crop */ }
    return canvas;
  }

  function renderCategoryChips() {
    const row = document.getElementById('ed-cat-chips');
    const MEP = window.DenizenMapEditorPro;
    if (!row || !MEP) return;
    row.innerHTML = '';
    MEP.CATEGORIES.forEach((cat) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ed-cat-chip';
      chip.textContent = cat.label;
      chip.dataset.catId = cat.id;
      chip.classList.toggle('active', catalogCategory === cat.id);
      chip.addEventListener('click', () => {
        catalogCategory = cat.id;
        renderCategoryChips();
        renderCatalogList();
      });
      row.appendChild(chip);
    });
  }

  function renderRoomTemplates() {
    const row = document.getElementById('ed-template-row');
    const MEP = window.DenizenMapEditorPro;
    if (!row || !MEP) return;
    row.innerHTML = '';
    MEP.getRoomTemplates().forEach((tpl) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ed-template-btn';
      btn.textContent = tpl.label;
      btn.title = tpl.hint || tpl.label;
      btn.addEventListener('click', () => placeRoomTemplate(tpl));
      row.appendChild(btn);
    });
  }

  /** Places a template item without arming the ghost/pending-place UI (used for batch template drops). */
  function placeTemplateItem(scene, catalogId, worldX, worldY) {
    const catalog = getCatalog(scene);
    const def = catalog?.objects?.[catalogId];
    if (!def || (def.source_type === 'single_file' && !scene.textures.exists(`single_${catalogId}`))) return null;
    const state = initEditorState(scene);
    const placement = {
      id: catalogId,
      instanceId: `editor_${catalogId}_${state.nextId++}`,
      x: snapCoord(worldX),
      y: snapCoord(worldY),
      rotation: 0,
      scale: 1,
      flipX: false,
      flipY: false,
    };
    state.placements.push(placement);
    return makePlacementSprite(scene, placement);
  }

  function placeRoomTemplate(tpl) {
    const scene = getScene();
    if (!scene || !tpl?.placements?.length) return;
    const catalog = getCatalog(scene);
    const cam = scene.cameras.main;
    const cx = cam ? cam.scrollX + cam.width / 2 : 640;
    const cy = cam ? cam.scrollY + cam.height / 2 : 360;
    const valid = tpl.placements.filter((p) => catalog?.objects?.[p.id]);
    if (!valid.length) {
      syncInfo(`Template "${tpl.label}" — no matching catalog items found`);
      return;
    }
    pushEditorUndo(`place template ${tpl.label}`);
    const placed = [];
    valid.forEach((p) => {
      const entry = placeTemplateItem(scene, p.id, cx + (p.x || 0), cy + (p.y || 0));
      if (entry) placed.push(entry);
    });
    if (!placed.length) {
      syncInfo(`Template "${tpl.label}" — failed to place any items`);
      return;
    }
    selectedSprites.forEach((sprite) => {
      if (sprite && typeof sprite.clearTint === 'function') sprite.clearTint();
    });
    selectedSprites = placed.map((entry) => entry.sprite);
    selectedSprite = selectedSprites[selectedSprites.length - 1];
    placed.forEach((entry) => {
      if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x66ff99);
    });
    updateSelectionOverlay();
    scene._depthDirty = true;
    scheduleLayoutSave(scene);
    syncInfo(`Placed template "${tpl.label}" (${placed.length}/${tpl.placements.length} items)`);
  }

  function createEditorGrid(scene) {
    destroyEditorGrid();
    if (!scene || !editorPrefs.showGrid) return;
    const MEP = window.DenizenMapEditorPro;
    if (!MEP) return;
    editorGridGfx = scene.add.graphics();
    MEP.drawEditorGrid(editorGridGfx, scene.scale?.width || 1280, scene.scale?.height || 720);
  }

  function destroyEditorGrid() {
    if (editorGridGfx) {
      try { editorGridGfx.destroy(); } catch (_) {}
    }
    editorGridGfx = null;
  }

  function toggleEditorGrid() {
    editorPrefs = { ...editorPrefs, showGrid: !editorPrefs.showGrid };
    window.DenizenMapEditorPro?.savePrefs?.(editorPrefs);
    createEditorGrid(getScene());
    const btn = document.getElementById('ed-grid-btn');
    if (btn) {
      btn.textContent = 'Grid';
      btn.classList.toggle('ed-btn-primary', editorPrefs.showGrid);
    }
  }

  function zoomEditorCamera(deltaZoom) {
    const scene = getScene();
    if (!scene) return;
    const cam = scene.cameras.main;
    const z = Math.min(2, Math.max(0.5, Math.round((cam.zoom + deltaZoom) * 100) / 100));
    cam.setZoom(z);
    syncInfo(`Zoom ${Math.round(z * 100)}%`);
  }

  function resetEditorCamera() {
    const scene = getScene();
    if (!scene) return;
    scene.cameras.main.setZoom(1);
    if (savedCameraState) {
      scene.cameras.main.scrollX = savedCameraState.scrollX;
      scene.cameras.main.scrollY = savedCameraState.scrollY;
    }
    syncInfo('View reset');
  }

  function endCameraPan() {
    panPointerActive = false;
    panPointerStart = null;
    panCameraStart = null;
    spacePanning = false;
  }

  function updateOnboardingStrip() {
    const strip = document.getElementById('ed-onboard');
    if (!strip) return;
    strip.style.display = editorPrefs.onboardingDismissed ? 'none' : 'flex';
  }

  function dismissOnboardingStrip() {
    editorPrefs = { ...editorPrefs, onboardingDismissed: true };
    window.DenizenMapEditorPro?.savePrefs?.(editorPrefs);
    updateOnboardingStrip();
  }

  function applyEditorChromeCollapsed() {
    if (!editorUI) return;
    editorUI.classList.toggle('ed-chrome-collapsed', !!editorChromeCollapsed);
    const btn = document.getElementById('ed-collapse-btn');
    if (btn) btn.textContent = editorChromeCollapsed ? 'Show UI' : 'Hide UI';
    syncEditorChromeLayout();
  }

  /** Keep catalog/wall sidebar below the measured toolbar height (no overlap). */
  function syncEditorChromeLayout() {
    if (!editorUI) return;
    const tb = document.getElementById('editor-toolbar');
    if (!tb) return;
    // Wait a frame so flex wrap / collapsed chrome settle before measuring.
    requestAnimationFrame(() => {
      if (!editorUI || !tb.isConnected) return;
      const h = Math.ceil(tb.getBoundingClientRect().height);
      if (h > 0) editorUI.style.setProperty('--ed-toolbar-h', `${h}px`);
    });
  }

  function toggleEditorChrome() {
    editorChromeCollapsed = !editorChromeCollapsed;
    editorPrefs = { ...editorPrefs, chromeCollapsed: editorChromeCollapsed };
    window.DenizenMapEditorPro?.savePrefs?.(editorPrefs);
    applyEditorChromeCollapsed();
    if (!editorChromeCollapsed) setEditorMode(editorMode);
    syncInfo(editorChromeCollapsed
      ? 'UI hidden — press Tab or Show UI to bring panels back'
      : 'UI restored');
  }

  function setSaveStatus(text, tone = 'idle') {
    const el = document.getElementById('ed-save-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function selectAllFurniture() {
    const scene = getScene();
    if (!scene?._interactables) return;
    const roots = scene._interactables.filter((entry) => !entry.parentInstanceId && entry.sprite);
    if (!roots.length) return;
    selectedSprites.forEach((sprite) => {
      if (sprite && typeof sprite.clearTint === 'function') sprite.clearTint();
    });
    selectedSprites = roots.map((entry) => entry.sprite);
    selectedSprite = selectedSprites[selectedSprites.length - 1];
    roots.forEach((entry) => {
      if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x66ff99);
    });
    setPendingCatalog(null);
    syncSelectedReadout(roots[roots.length - 1]);
    updateSelectionOverlay();
    syncInfo(`Selected all ${roots.length} furniture item(s)`);
  }

  function nudgeSelectedFurniture(key) {
    const scene = getScene();
    if (!scene) return;
    const entries = getSelectedFurnitureEntries(scene);
    if (!entries.length) return;
    const step = 4;
    let dx = 0;
    let dy = 0;
    if (key === 'ArrowUp') dy = -step;
    else if (key === 'ArrowDown') dy = step;
    else if (key === 'ArrowLeft') dx = -step;
    else if (key === 'ArrowRight') dx = step;
    if (!dx && !dy) return;
    pushEditorUndo(entries.length > 1 ? `nudge ${entries.length} items` : `nudge ${entries[0].id}`);
    entries.forEach((entry) => {
      entry.sprite.x += dx;
      entry.sprite.y += dy;
      refreshFurnitureDepth(entry);
      if (entry.obstacle) {
        entry.obstacle.x = entry.sprite.x;
        entry.obstacle.y = entry.sprite.y;
        if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
      }
      writeTransformToPlacement(entry);
    });
    syncSelectedReadout(entries[0]);
    updateSelectionOverlay();
    scene._depthDirty = true;
    scheduleLayoutSave(scene);
  }

  function renderCatalogList() {
    const scene = getScene();
    const list = document.getElementById('ed-catalog-list');
    if (!scene || !list) return;
    const catalog = getCatalog(scene);
    const state = initEditorState(scene);
    const MEP = window.DenizenMapEditorPro;
    const query = (document.getElementById('ed-search')?.value || '').trim().toLowerCase();
    const allEntries = Object.entries(catalog?.objects || {});
    let entries = MEP
      ? MEP.filterCatalogEntries(allEntries, { query, category: catalogCategory, prefs: editorPrefs })
      : allEntries
        .filter(([id, def]) => !query || id.toLowerCase().includes(query) || String(def.type || '').toLowerCase().includes(query))
        .sort((a, b) => a[0].localeCompare(b[0]));

    const totalMatched = entries.length;
    if (entries.length > CATALOG_LIST_LIMIT) {
      entries = entries.slice(0, CATALOG_LIST_LIMIT);
    }

    const countEl = document.getElementById('ed-catalog-count');
    if (countEl) {
      if (!query && catalogCategory === 'all' && totalMatched > CATALOG_LIST_LIMIT) {
        countEl.textContent = `Showing ${entries.length} of ${totalMatched} — pick a category or search`;
      } else if (totalMatched > entries.length) {
        countEl.textContent = `Showing ${entries.length} of ${totalMatched} matches`;
      } else {
        countEl.textContent = `${totalMatched} item${totalMatched === 1 ? '' : 's'}`;
      }
    }

    const frag = document.createDocumentFragment();
    list.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'cat-empty';
      empty.textContent = catalogCategory === 'favorites'
        ? 'No favorites yet — click ☆ on an item.'
        : catalogCategory === 'recent'
        ? 'Nothing placed yet this session.'
        : 'No matches.';
      list.appendChild(empty);
      return;
    }
    entries.forEach(([id, def]) => {
      const item = document.createElement('div');
      item.className = 'cat-item';
      item.dataset.catalogId = id;
      item.draggable = true;
      if (state.pendingCatalogId === id) item.classList.add('active');

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'cat-thumb-wrap';
      thumbWrap.appendChild(buildCatalogPreview(scene, id, def, 48));
      if (MEP?.isWallMount?.(id, def)) {
        const badge = document.createElement('span');
        badge.className = 'cat-badge';
        badge.textContent = 'wall';
        thumbWrap.appendChild(badge);
      }
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'cat-star';
      const isFav = (editorPrefs.favorites || []).includes(id);
      starBtn.textContent = isFav ? '★' : '☆';
      starBtn.classList.toggle('active', isFav);
      starBtn.title = isFav ? 'Remove favorite' : 'Add to favorites';
      starBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        editorPrefs = MEP ? MEP.toggleFavorite(editorPrefs, id) : editorPrefs;
        renderCatalogList();
      });
      thumbWrap.appendChild(starBtn);
      item.appendChild(thumbWrap);

      const meta = document.createElement('div');
      meta.className = 'cat-meta';
      const label = def.displayName || id;
      const typeBits = [def.type || 'unknown'];
      if (def.stack_on === 'surface' || def.stack_on === 'desk') typeBits.push('on desk');
      meta.innerHTML = `<div class="cat-name" title="${id}">${label}</div><div class="cat-type">${typeBits.join(' · ')}</div>`;
      item.appendChild(meta);

      item.addEventListener('click', () => setPendingCatalog(id));
      item.addEventListener('dragstart', (event) => {
        setPendingCatalog(id);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', id);
      });
      frag.appendChild(item);
    });
    list.appendChild(frag);
  }

  function scheduleCatalogListRender() {
    if (catalogSearchTimer) clearTimeout(catalogSearchTimer);
    catalogSearchTimer = setTimeout(() => {
      catalogSearchTimer = null;
      renderCatalogList();
    }, 140);
  }

  function createEditorUI() {
    if (editorUI) return;
    editorUI = document.createElement('div');
    editorUI.id = 'editor-ui';
    editorUI.innerHTML = `
      <style>
        #editor-ui {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 200000;
          font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
          color: #f8fafc;
          --ed-toolbar-h: 132px;
          --ed-sidebar-w: 340px;
        }
        #editor-toolbar {
          pointer-events: auto;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 4;
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px 14px 12px;
          overflow: hidden;
          background:
            linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.96) 100%);
          border-bottom: 1px solid rgba(148, 163, 184, 0.28);
          box-shadow: 0 10px 28px rgba(2, 6, 23, 0.35);
        }
        #editor-toolbar .ed-row {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        #editor-toolbar .ed-row-top { gap: 12px; }
        #editor-toolbar .ed-row-tools {
          flex-wrap: wrap;
          padding-top: 2px;
        }
        #editor-toolbar .ed-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        #editor-toolbar .ed-brand-mark {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #38bdf8;
          box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.18);
        }
        #editor-toolbar .title {
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #e2e8f0;
        }
        #editor-mode-tabs {
          display: inline-flex;
          gap: 4px;
          padding: 3px;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.75);
          border: 1px solid rgba(148, 163, 184, 0.22);
          flex-shrink: 0;
        }
        #editor-mode-tabs button {
          min-height: 34px;
          min-width: 96px;
          padding: 0 14px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: #cbd5e1;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        #editor-mode-tabs button:hover {
          background: rgba(148, 163, 184, 0.12);
          color: #fff;
        }
        #editor-mode-tabs button.active {
          background: #38bdf8;
          color: #0f172a;
        }
        #ed-status-panel {
          flex: 1;
          min-width: 220px;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 4px 10px;
          align-items: center;
          padding: 8px 12px;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.72);
          border: 1px solid rgba(148, 163, 184, 0.22);
        }
        #ed-status-panel[data-mode="placing"] {
          border-color: rgba(56, 189, 248, 0.55);
          background: rgba(14, 116, 144, 0.28);
        }
        #ed-status-panel[data-mode="selected"] {
          border-color: rgba(74, 222, 128, 0.5);
          background: rgba(21, 128, 61, 0.22);
        }
        #ed-status-panel[data-mode="walls"] {
          border-color: rgba(251, 191, 36, 0.45);
          background: rgba(146, 64, 14, 0.22);
        }
        #ed-status-mode {
          grid-row: 1 / span 2;
          align-self: stretch;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 72px;
          padding: 0 10px;
          border-radius: 8px;
          background: rgba(248, 250, 252, 0.08);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #f8fafc;
        }
        #ed-status-panel[data-mode="placing"] #ed-status-mode { background: #38bdf8; color: #0f172a; }
        #ed-status-panel[data-mode="selected"] #ed-status-mode { background: #4ade80; color: #052e16; }
        #ed-status-panel[data-mode="walls"] #ed-status-mode { background: #fbbf24; color: #422006; }
        #ed-info {
          font-size: 13px;
          font-weight: 600;
          line-height: 1.25;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #ed-selected {
          font-size: 12px;
          line-height: 1.25;
          color: #cbd5e1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #editor-toolbar .ed-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          margin-left: auto;
        }
        #editor-toolbar .ed-group {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.55);
          border: 1px solid rgba(148, 163, 184, 0.18);
        }
        #editor-toolbar .ed-group-label {
          padding: 0 6px 0 8px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #94a3b8;
          flex-shrink: 0;
        }
        #editor-toolbar button,
        #editor-toolbar select {
          min-height: 36px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: rgba(51, 65, 85, 0.9);
          color: #f8fafc;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
        }
        #editor-toolbar button:hover,
        #editor-toolbar select:hover {
          background: rgba(71, 85, 105, 0.95);
          border-color: rgba(226, 232, 240, 0.35);
        }
        #editor-toolbar button:active {
          transform: translateY(1px);
        }
        #editor-toolbar button:focus-visible,
        #editor-toolbar select:focus-visible {
          outline: 2px solid #38bdf8;
          outline-offset: 2px;
        }
        #editor-toolbar button:disabled,
        #editor-toolbar button[aria-disabled="true"] {
          opacity: 0.38;
          cursor: not-allowed;
          transform: none;
        }
        #editor-toolbar .ed-btn-primary {
          background: #0ea5e9;
          border-color: #38bdf8;
          color: #0f172a;
        }
        #editor-toolbar .ed-btn-primary:hover {
          background: #38bdf8;
        }
        #editor-toolbar .ed-btn-danger {
          background: #b91c1c;
          border-color: #f87171;
        }
        #editor-toolbar .ed-btn-danger:hover {
          background: #dc2626;
        }
        #editor-toolbar .ed-btn-warn {
          background: #c2410c;
          border-color: #fb923c;
        }
        #editor-toolbar .ed-btn-ghost {
          background: transparent;
        }
        #editor-toolbar .ed-kbd {
          display: inline-block;
          margin-left: 6px;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(15, 23, 42, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.12);
          font-size: 10px;
          font-weight: 700;
          color: #e2e8f0;
          vertical-align: 1px;
        }
        #editor-toolbar #ed-layer {
          min-width: 120px;
        }
        #editor-toolbar .ed-hint {
          margin-left: auto;
          font-size: 11px;
          color: #94a3b8;
          white-space: nowrap;
        }
        #editor-wall-tools {
          pointer-events: auto;
          position: fixed;
          top: var(--ed-toolbar-h);
          right: 0;
          width: var(--ed-sidebar-w);
          height: calc(100vh - var(--ed-toolbar-h));
          z-index: 3;
          background: rgba(15, 23, 42, 0.97);
          border-left: 1px solid rgba(148, 163, 184, 0.2);
          display: none;
          flex-direction: column;
          padding: 14px;
          gap: 10px;
          box-sizing: border-box;
        }
        #editor-wall-tools button {
          background: rgba(51, 65, 85, 0.85);
          color: #f8fafc;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          text-align: left;
        }
        #editor-wall-tools button.active-tool {
          border-color: rgba(56, 189, 248, 0.9);
          background: rgba(14, 165, 233, 0.2);
        }
        #editor-wall-tools .wall-help {
          font-size: 12px;
          color: #cbd5e1;
          line-height: 1.45;
        }
        .wall-piece-btn {
          display: grid;
          grid-template-columns: 52px 1fr;
          gap: 10px;
          align-items: center;
          text-align: left;
        }
        .wall-swatch {
          width: 48px;
          height: 40px;
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.15);
          image-rendering: pixelated;
        }
        .wall-swatch-band { background: #c3d0e6; position: relative; }
        .wall-swatch-band::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 8px;
          background: #3a3a50;
        }
        .wall-swatch-face { background: #c3d0e6; position: relative; }
        .wall-swatch-face::before {
          content: '';
          position: absolute;
          top: 0; left: 0; bottom: 0;
          width: 8px;
          background: #3a3a50;
        }
        .wall-swatch-corner { background: #c3d0e6; position: relative; }
        .wall-swatch-corner::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 6px;
          background: #3a3a50;
        }
        .wall-swatch-draw {
          background: repeating-linear-gradient(
            135deg,
            rgba(56,189,248,0.28),
            rgba(56,189,248,0.28) 6px,
            rgba(255,255,255,0.06) 6px,
            rgba(255,255,255,0.06) 12px
          );
        }
        .wall-piece-label { font-weight: 600; font-size: 12px; }
        .wall-piece-desc { font-size: 10px; opacity: 0.7; margin-top: 2px; }
        #ed-wall-segment-list {
          flex: 1;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-height: 120px;
          max-height: 36vh;
          margin-top: 4px;
        }
        .wall-list-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px;
          cursor: pointer;
        }
        .wall-list-item.active {
          border-color: rgba(56,189,248,0.85);
          background: rgba(14,165,233,0.14);
        }
        .wall-list-item.dimmed {
          opacity: 0.38;
        }
        #ed-wall-layer {
          width: 100%;
          margin-top: 6px;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid rgba(148,163,184,0.25);
          background: rgba(15,23,42,0.7);
          color: #e2e8f0;
          font-size: 13px;
        }
        .wall-click-help {
          font-size: 11px;
          color: #94a3b8;
          margin: 6px 0 0;
          line-height: 1.45;
        }
        .wall-list-main { flex: 1; min-width: 0; }
        .wall-list-badge {
          display: inline-block;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(74,222,128,0.2);
          color: #bbf7d0;
          margin-right: 6px;
        }
        .wall-list-name { font-size: 11px; font-weight: 600; }
        .wall-list-del {
          background: rgba(239,68,68,0.35);
          border: none;
          color: #fff;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
        }
        .wall-list-empty { font-size: 11px; opacity: 0.65; padding: 8px 4px; }
        #ed-wall-rebuild-btn {
          background: rgba(59,130,246,0.45);
          border: 1px solid rgba(147,197,253,0.5);
        }
        #editor-catalog {
          pointer-events: auto;
          position: fixed;
          top: var(--ed-toolbar-h);
          right: 0;
          width: var(--ed-sidebar-w);
          height: calc(100vh - var(--ed-toolbar-h));
          z-index: 3;
          background: rgba(15, 23, 42, 0.97);
          border-left: 1px solid rgba(148, 163, 184, 0.2);
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        #editor-catalog-head {
          padding: 12px 14px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.18);
          display: grid;
          gap: 8px;
        }
        #editor-catalog-head .ed-side-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        #editor-catalog-head .ed-side-title {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #94a3b8;
        }
        #ed-workflow-btn {
          min-height: 28px;
          padding: 0 10px;
          border-radius: 7px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: rgba(15, 23, 42, 0.65);
          color: #cbd5e1;
          font-size: 11px;
          font-weight: 650;
          cursor: pointer;
        }
        #ed-workflow-btn:hover {
          border-color: rgba(56, 189, 248, 0.55);
          color: #e0f2fe;
        }
        #ed-catalog-count {
          font-size: 10px;
          color: #64748b;
        }
        #ed-search {
          min-height: 38px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: rgba(15, 23, 42, 0.8);
          color: #f8fafc;
          font-size: 13px;
        }
        #ed-search::placeholder { color: #64748b; }
        #ed-catalog-list {
          overflow: auto;
          padding: 12px;
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr;
        }
        .cat-item {
          display: grid;
          grid-template-columns: 48px 1fr;
          gap: 10px;
          align-items: center;
          padding: 8px 10px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 10px;
          cursor: grab;
          user-select: none;
        }
        .cat-item:hover {
          border-color: rgba(148, 163, 184, 0.4);
          background: rgba(255, 255, 255, 0.07);
        }
        .cat-item.active {
          border-color: rgba(56, 189, 248, 0.9);
          background: rgba(14, 165, 233, 0.16);
          box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.25);
        }
        .cat-thumb-wrap {
          position: relative;
          width: 48px;
          height: 48px;
          flex-shrink: 0;
        }
        .cat-item canvas,
        .cat-item img {
          width: 48px;
          height: 48px;
          object-fit: contain;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 6px;
        }
        .cat-badge {
          position: absolute;
          left: 2px;
          bottom: 2px;
          font-size: 8px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(56, 189, 248, 0.85);
          color: #0f172a;
        }
        .cat-star {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: rgba(15, 23, 42, 0.85);
          color: #94a3b8;
          font-size: 13px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .cat-star.active {
          color: #fde047;
          border-color: rgba(253, 224, 71, 0.6);
        }
        .cat-name {
          font-size: 13px;
          font-weight: 600;
          word-break: break-word;
          color: #f8fafc;
        }
        .cat-type {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 2px;
        }
        .cat-empty {
          padding: 24px 8px;
          font-size: 12px;
          color: #94a3b8;
          text-align: center;
        }
        #ed-cat-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .ed-cat-chip {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: rgba(51, 65, 85, 0.7);
          color: #cbd5e1;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .ed-cat-chip:hover {
          background: rgba(71, 85, 105, 0.9);
        }
        .ed-cat-chip.active {
          background: #38bdf8;
          border-color: #38bdf8;
          color: #0f172a;
        }
        #ed-template-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .ed-template-btn {
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: rgba(51, 65, 85, 0.7);
          color: #f8fafc;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .ed-template-btn:hover {
          background: rgba(71, 85, 105, 0.9);
        }
        #ed-onboard {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 6px 12px;
          margin: 0 -14px -12px;
          background: rgba(14, 116, 144, 0.28);
          border-top: 1px solid rgba(56, 189, 248, 0.35);
          font-size: 12px;
          color: #e0f2fe;
        }
        #ed-onboard button {
          min-height: 26px;
          padding: 0 10px;
          font-size: 11px;
        }
        #editor-ui.ed-chrome-collapsed #ed-furniture-tools,
        #editor-ui.ed-chrome-collapsed #ed-onboard,
        #editor-ui.ed-chrome-collapsed #editor-catalog,
        #editor-ui.ed-chrome-collapsed #editor-wall-tools {
          display: none !important;
        }
        #editor-ui.ed-chrome-collapsed #editor-toolbar {
          right: 0;
          padding: 6px 12px;
          gap: 6px;
        }
        #editor-ui.ed-chrome-collapsed #ed-status-panel {
          min-width: 160px;
        }
        #ed-collapse-btn {
          min-width: 40px;
        }
        #ed-save-status {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 6px;
          color: #94a3b8;
          background: rgba(15, 23, 42, 0.5);
        }
        #ed-save-status[data-tone="saving"] { color: #fbbf24; }
        #ed-save-status[data-tone="saved"] { color: #4ade80; }
        #ed-save-status[data-tone="error"] { color: #f87171; }
        html.denizen-editor-open #denizen-work-feed-toggle,
        html.denizen-editor-open #denizen-office-hq-toggle,
        html.denizen-editor-open #denizen-work-feed,
        html.denizen-editor-open #denizen-office-hq-overlay,
        html.denizen-editor-open #denizen-office-level-chip {
          display: none !important;
        }
      </style>
      <div id="editor-toolbar">
        <div class="ed-row ed-row-top">
          <div class="ed-brand">
            <span class="ed-brand-mark" aria-hidden="true"></span>
            <span class="title">Map editor</span>
          </div>
          <div id="editor-mode-tabs" role="tablist" aria-label="Editor mode">
            <button type="button" id="ed-tab-furniture" class="active" role="tab" aria-selected="true">Furniture</button>
            <button type="button" id="ed-tab-walls" role="tab" aria-selected="false">Walls</button>
          </div>
          <div id="ed-status-panel" data-mode="idle" aria-live="polite">
            <span id="ed-status-mode">Ready</span>
            <span id="ed-info">Pick an item from the catalog, then click the map to place it.</span>
            <span id="ed-selected">Nothing selected</span>
          </div>
          <div class="ed-actions">
            <span id="ed-save-status" data-tone="idle">Saved</span>
            <button type="button" id="ed-collapse-btn" title="Collapse / expand editor panels (Tab)">Hide UI</button>
            <button type="button" id="ed-undo-btn" disabled title="Nothing to undo">Undo<span class="ed-kbd">⌘Z</span></button>
            <button type="button" id="ed-redo-btn" disabled title="Nothing to redo">Redo<span class="ed-kbd">⇧⌘Z</span></button>
            <button type="button" id="ed-snap-btn" class="ed-btn-primary" title="Snap placements to grid">Snap on</button>
            <button type="button" id="ed-export-btn" class="ed-btn-primary" title="Save layout to server (X)">Save<span class="ed-kbd">X</span></button>
            <button type="button" id="ed-exit-btn" class="ed-btn-ghost" title="Save & exit editor (⌘⇧E)">Exit<span class="ed-kbd">⌘⇧E</span></button>
          </div>
        </div>
        <div class="ed-row ed-row-tools" id="ed-furniture-tools">
          <div class="ed-group" aria-label="Transform tools">
            <span class="ed-group-label">Transform</span>
            <button type="button" id="ed-rotate-btn" title="Rotate 90° (scroll or , / .) — Shift+click for 15°">Rotate 90°<span class="ed-kbd">,</span></button>
            <button type="button" id="ed-scale-down-btn" title="Shrink ([)">−</button>
            <button type="button" id="ed-scale-up-btn" title="Grow (])">+</button>
            <button type="button" id="ed-flip-btn" title="Flip horizontal (F)">Flip</button>
          </div>
          <div class="ed-group" aria-label="Selection tools">
            <span class="ed-group-label">Item</span>
            <button type="button" id="ed-clear-btn" title="Clear selection / cancel place (Esc)">Deselect</button>
            <button type="button" id="ed-delete-btn" class="ed-btn-danger" title="Delete selected (Del)">Delete</button>
            <button type="button" id="ed-duplicate-btn" title="Duplicate selection (Ctrl/⌘D)">Duplicate</button>
            <button type="button" id="ed-stack-desk-btn" title="Snap selected lamp/monitor onto nearby desk">Put on desk</button>
          </div>
          <div class="ed-group" aria-label="Align tools">
            <span class="ed-group-label">Align</span>
            <button type="button" id="ed-align-left-btn" title="Align left (2+)">L</button>
            <button type="button" id="ed-align-center-btn" title="Align center (2+)">C</button>
            <button type="button" id="ed-align-right-btn" title="Align right (2+)">R</button>
            <button type="button" id="ed-align-top-btn" title="Align top (2+)">T</button>
            <button type="button" id="ed-align-bottom-btn" title="Align bottom (2+)">B</button>
            <button type="button" id="ed-dist-h-btn" title="Distribute horizontally (3+)">H</button>
            <button type="button" id="ed-dist-v-btn" title="Distribute vertically (3+)">V</button>
          </div>
          <div class="ed-group" aria-label="View filters">
            <span class="ed-group-label">View</span>
            <select id="ed-layer" title="Filter furniture layers" aria-label="Layer filter">
              <option value="all">All layers</option>
              <option value="floor">Floor items</option>
              <option value="wall_decor">Wall decor</option>
              <option value="surface">Desks</option>
              <option value="seat">Chairs</option>
              <option value="partition">Dividers</option>
              <option value="decor">Decor / monitors</option>
              <option value="furniture">Furniture</option>
            </select>
            <button type="button" id="ed-collision-btn" class="ed-btn-warn" title="Toggle collision overlays">Collisions</button>
            <button type="button" id="ed-grid-btn" title="Toggle grid overlay">Grid</button>
            <button type="button" id="ed-zoom-out-btn" title="Zoom out (Ctrl+scroll)">−</button>
            <button type="button" id="ed-zoom-in-btn" title="Zoom in (Ctrl+scroll)">+</button>
            <button type="button" id="ed-zoom-reset-btn" title="Reset zoom/pan">Reset</button>
          </div>
        </div>
        <div id="ed-onboard">
          <span><strong>1</strong> Pick catalog → <strong>2</strong> Place on map → <strong>3</strong> Drag to adjust</span>
          <button type="button" id="ed-onboard-dismiss">Dismiss</button>
        </div>
      </div>
      <aside id="editor-wall-tools">
        <div style="font-weight:700;">Wall pieces</div>
        <p class="wall-help">Top-down walls: <strong>bands</strong> get trim on top; <strong>side walls</strong> get trim on the back edge. Drag diagonally for an <strong>L-joint</strong> (band + side + corner cap).</p>
        <label style="font-size:11px;font-weight:600;margin-top:6px;">Edit layer</label>
        <select id="ed-wall-layer" title="Isolate wall types while editing">
          <option value="all">All pieces</option>
          <option value="bands">Bands only (horizontal)</option>
          <option value="sides">Sides only (vertical)</option>
          <option value="joints">Joints only (corners + T)</option>
        </select>
        <p class="wall-click-help"><strong>Click</strong> select/highlight · <strong>Double-click</strong> delete · <strong>Triple-click</strong> cycle layer (map or list)</p>
        <button type="button" class="wall-piece-btn active-tool" data-wall-tool="draw" id="ed-wall-draw">
          <div class="wall-swatch wall-swatch-draw"></div>
          <div><div class="wall-piece-label">Draw wall (drag map)</div><div class="wall-piece-desc">Across → band · up/down → side · diagonal → L</div></div>
        </button>
        <button type="button" class="wall-piece-btn" data-wall-tool="band" id="ed-wall-add-h">
          <div class="wall-swatch wall-swatch-band"></div>
          <div><div class="wall-piece-label">Wall band</div><div class="wall-piece-desc">Dark trim + light blue face</div></div>
        </button>
        <button type="button" class="wall-piece-btn" data-wall-tool="face" id="ed-wall-add-v">
          <div class="wall-swatch wall-swatch-face"></div>
          <div><div class="wall-piece-label">Side wall face</div><div class="wall-piece-desc">Back-edge trim + light blue face</div></div>
        </button>
        <button type="button" class="wall-piece-btn" data-wall-tool="corner" id="ed-wall-add-corner">
          <div class="wall-swatch wall-swatch-corner"></div>
          <div><div class="wall-piece-label">Corner cap</div><div class="wall-piece-desc">Trim + face at a corner</div></div>
        </button>
        <button type="button" class="wall-piece-btn" data-wall-tool="tjunction" id="ed-wall-add-tj">
          <div class="wall-swatch wall-swatch-corner"></div>
          <div><div class="wall-piece-label">T-junction</div><div class="wall-piece-desc">Where three walls meet</div></div>
        </button>
        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;" />
        <button type="button" id="ed-wall-rebuild-btn">↻ Rebuild perimeter box</button>
        <p class="wall-help" style="margin:0;">Fixes cut-off corners — one continuous trim bar on top &amp; bottom, side faces on left/right.</p>
        <div style="font-weight:700;margin-top:8px;">All pieces <span id="ed-wall-count" style="opacity:0.6;font-weight:400;"></span></div>
        <div id="ed-wall-segment-list"></div>
        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;" />
        <button type="button" id="ed-wall-dup-btn">Duplicate selected (D)</button>
        <button type="button" id="ed-wall-cut-btn">Cut Tool: OFF</button>
        <button type="button" id="ed-wall-del-btn">Delete selected (Del)</button>
        <button type="button" id="ed-wall-export-btn">Save walls</button>
      </aside>
      <aside id="editor-catalog">
        <div id="editor-catalog-head">
          <div class="ed-side-title-row">
            <div class="ed-side-title">Catalog</div>
            <button type="button" id="ed-workflow-btn" title="Open Office Build tools (sprite labeling, verify)">Tools</button>
          </div>
          <input id="ed-search" type="search" placeholder="Search furniture…" autocomplete="off" spellcheck="false" />
          <div id="ed-catalog-count"></div>
          <div id="ed-cat-chips"></div>
          <div class="ed-side-title">Room templates</div>
          <div id="ed-template-row"></div>
        </div>
        <div id="ed-catalog-list"></div>
      </aside>
    `;
    document.body.appendChild(editorUI);

    document.getElementById('ed-layer').addEventListener('change', (event) => {
      layerFilter = event.target.value;
      updateLayerVisibility();
    });
    document.getElementById('ed-search').addEventListener('input', scheduleCatalogListRender);
    document.getElementById('ed-tab-furniture').addEventListener('click', () => setEditorMode('furniture'));
    document.getElementById('ed-tab-walls').addEventListener('click', () => setEditorMode('walls'));
    document.getElementById('ed-export-btn').addEventListener('click', () => {
      if (editorMode === 'walls') window._editorExportWalls();
      else window._editorExport();
    });
    document.getElementById('ed-exit-btn')?.addEventListener('click', () => {
      disableEditor();
    });
    document.getElementById('ed-undo-btn')?.addEventListener('click', () => undoEditorChange());
    document.getElementById('ed-redo-btn')?.addEventListener('click', () => redoEditorChange());
    document.getElementById('ed-workflow-btn')?.addEventListener('click', () => {
      window.open('/workflow-dashboard.html', '_blank');
    });
    updateUndoButtons();
    document.getElementById('ed-wall-layer')?.addEventListener('change', (e) => {
      setWallLayerFilter(e.target.value);
    });
    document.getElementById('ed-wall-rebuild-btn').addEventListener('click', () => rebuildPerimeterBox());
    document.getElementById('ed-wall-draw').addEventListener('click', () => setWallTool('draw'));
    document.getElementById('ed-wall-add-h').addEventListener('click', () => setWallTool('band'));
    document.getElementById('ed-wall-add-v').addEventListener('click', () => setWallTool('face'));
    document.getElementById('ed-wall-add-corner').addEventListener('click', () => setWallTool('corner'));
    document.getElementById('ed-wall-add-tj').addEventListener('click', () => setWallTool('tjunction'));
    document.getElementById('ed-wall-dup-btn').addEventListener('click', () => duplicateSelectedWall());
    document.getElementById('ed-wall-del-btn').addEventListener('click', () => deleteSelectedWall());
    document.getElementById('ed-wall-export-btn').addEventListener('click', () => window._editorExportWalls());
    document.getElementById('ed-wall-cut-btn').addEventListener('click', (event) => {
      wallCutMode = !wallCutMode;
      wallPendingType = null;
      wallTool = wallCutMode ? 'cut' : 'draw';
      clearWallDrawPreview();
      document.querySelectorAll('[data-wall-tool]').forEach((btn) => btn.classList.remove('active-tool'));
      event.currentTarget.textContent = `Cut Tool: ${wallCutMode ? 'ON' : 'OFF'}`;
      event.currentTarget.classList.toggle('active-tool', wallCutMode);
      syncInfo(wallCutMode
        ? 'Cut: select a wall, then click where to split (doorway gap)'
        : 'Cut tool off — use Draw wall to add pieces');
      if (!wallCutMode) setWallTool('draw');
    });
    document.getElementById('ed-snap-btn').addEventListener('click', (event) => {
      window._editorSnap = !window._editorSnap;
      event.currentTarget.textContent = window._editorSnap ? 'Snap on' : 'Snap off';
      event.currentTarget.classList.toggle('ed-btn-primary', !!window._editorSnap);
    });
    document.getElementById('ed-rotate-btn')?.addEventListener('click', (event) => {
      transformSelected({ rotationDelta: event.shiftKey ? 15 : 90 });
    });
    document.getElementById('ed-scale-down-btn')?.addEventListener('click', () => transformSelected({ scaleFactor: 0.9 }));
    document.getElementById('ed-scale-up-btn')?.addEventListener('click', () => transformSelected({ scaleFactor: 1.1 }));
    document.getElementById('ed-flip-btn')?.addEventListener('click', () => transformSelected({ flipX: true }));
    document.getElementById('ed-delete-btn')?.addEventListener('click', () => deleteSelectedFurniture());
    document.getElementById('ed-clear-btn').addEventListener('click', () => {
      clearFurnitureSelection();
      setPendingCatalog(null);
    });
    document.getElementById('ed-duplicate-btn')?.addEventListener('click', () => duplicateSelectedFurniture());
    document.getElementById('ed-stack-desk-btn')?.addEventListener('click', () => snapSelectedOntoDesk());
    document.getElementById('ed-align-left-btn')?.addEventListener('click', () => alignSelectedFurniture('left'));
    document.getElementById('ed-align-center-btn')?.addEventListener('click', () => alignSelectedFurniture('center'));
    document.getElementById('ed-align-right-btn')?.addEventListener('click', () => alignSelectedFurniture('right'));
    document.getElementById('ed-align-top-btn')?.addEventListener('click', () => alignSelectedFurniture('top'));
    document.getElementById('ed-align-bottom-btn')?.addEventListener('click', () => alignSelectedFurniture('bottom'));
    document.getElementById('ed-dist-h-btn')?.addEventListener('click', () => alignSelectedFurniture('distributeH'));
    document.getElementById('ed-dist-v-btn')?.addEventListener('click', () => alignSelectedFurniture('distributeV'));
    document.getElementById('ed-collapse-btn')?.addEventListener('click', () => toggleEditorChrome());
    applyEditorChromeCollapsed();
    const gridBtn = document.getElementById('ed-grid-btn');
    if (gridBtn) {
      gridBtn.textContent = 'Grid';
      gridBtn.classList.toggle('ed-btn-primary', editorPrefs.showGrid);
      gridBtn.addEventListener('click', () => toggleEditorGrid());
    }
    document.getElementById('ed-zoom-in-btn')?.addEventListener('click', () => zoomEditorCamera(0.1));
    document.getElementById('ed-zoom-out-btn')?.addEventListener('click', () => zoomEditorCamera(-0.1));
    document.getElementById('ed-zoom-reset-btn')?.addEventListener('click', () => resetEditorCamera());
    document.getElementById('ed-onboard-dismiss')?.addEventListener('click', () => dismissOnboardingStrip());
    renderCategoryChips();
    renderRoomTemplates();
    updateOnboardingStrip();
    setSaveStatus('Saved', 'saved');
    syncEditorChromeLayout();
    if (!editorUI._edLayoutResizeBound) {
      editorUI._edLayoutResizeBound = true;
      window.addEventListener('resize', syncEditorChromeLayout);
    }

    // Collision box visualization toggle
    let collisionVisible = false;
    let collisionGraphics = null;
    document.getElementById('ed-collision-btn').addEventListener('click', (event) => {
      const scene = getScene();
      if (!scene) return;
      collisionVisible = !collisionVisible;
      event.currentTarget.textContent = collisionVisible ? 'Hide collisions' : 'Collisions';
      event.currentTarget.classList.toggle('ed-btn-warn', !collisionVisible);
      event.currentTarget.classList.toggle('ed-btn-primary', collisionVisible);

      if (collisionVisible) {
        // Draw collision boxes as red rectangles
        if (!collisionGraphics) {
          collisionGraphics = scene.add.graphics();
        }
        collisionGraphics.clear();
        collisionGraphics.setDepth(9999);

        (scene._obstacles || []).forEach(obs => {
          if (!obs || !obs.body) return;
          const bx = obs.body.x;
          const by = obs.body.y;
          const bw = obs.body.width;
          const bh = obs.body.height;
          // Red fill with transparency
          collisionGraphics.fillStyle(0xff0000, 0.3);
          collisionGraphics.fillRect(bx, by, bw, bh);
          // Red border
          collisionGraphics.lineStyle(1, 0xff0000, 0.8);
          collisionGraphics.strokeRect(bx, by, bw, bh);
        });

        // Also show pathfinding grid blocked cells in blue
        if (scene._pathfinder) {
          const pf = scene._pathfinder;
          const cs = pf.cellSize;
          collisionGraphics.fillStyle(0x0066ff, 0.15);
          for (let gy = 0; gy < pf.rows; gy++) {
            for (let gx = 0; gx < pf.cols; gx++) {
              if (!pf.isWalkable(gx, gy)) {
                collisionGraphics.fillRect(gx * cs, gy * cs, cs, cs);
              }
            }
          }
        }
      } else {
        if (collisionGraphics) {
          collisionGraphics.clear();
        }
      }
    });

    renderCatalogList();
  }

  function removeEditorUI() {
    if (editorUI) { editorUI.remove(); editorUI = null; }
  }

  /** "Floor items" groups surface/furniture/seat; "Wall decor" picks up wall-mounted decor via isWallMount. */
  function matchesLayerFilter(entry) {
    if (layerFilter === 'all') return true;
    const MEP = window.DenizenMapEditorPro;
    const isWall = !!MEP?.isWallMount?.(entry.id, entry.def);
    if (layerFilter === 'floor') return !isWall;
    if (layerFilter === 'wall_decor') return isWall;
    return entry.def?.type === layerFilter;
  }

  function updateLayerVisibility() {
    const scene = getScene();
    if (!scene || !scene._interactables) return;
    scene._interactables.forEach((it) => {
      if (!it.sprite || !it.def) return;
      it.sprite.setAlpha(matchesLayerFilter(it) ? 1 : 0.2);
    });
  }

  window._editorSnap = true;

  function getSelectedFurnitureEntry(scene) {
    if (!selectedSprite || !scene?._interactables) return null;
    return scene._interactables.find((item) => item.sprite === selectedSprite) || null;
  }

  /** All currently-selected interactable entries (optionally include desk-top children). */
  function getSelectedFurnitureEntries(scene, { includeChildren = false } = {}) {
    if (!scene?._interactables || !selectedSprites.length) return [];
    const sprites = new Set(selectedSprites);
    return scene._interactables.filter((item) => (
      sprites.has(item.sprite)
      && (includeChildren || !item.parentInstanceId)
    ));
  }

  function localSpriteBounds(sprite) {
    if (!sprite) return null;
    const MEP = window.DenizenMapEditorPro;
    if (MEP?.spriteWorldBounds) return MEP.spriteWorldBounds(sprite);
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

  function isStackableDecor(id, def) {
    if (!def) return false;
    if (def.stack_on === 'surface' || def.stack_on === 'desk') return true;
    if (def.stack_on === 'none' || def.wall_mount) return false;
    if (def.type === 'floor' || def.category === 'floors') return false;
    const MEP = window.DenizenMapEditorPro;
    if (MEP?.isWallMount?.(id, def)) return false;
    // Explicit non-stackables
    if (def.type === 'surface' || def.type === 'seat' || def.type === 'partition') return false;
    if (/chair|sofa|couch|partition|divider|bookshelf|cabinet|cooler|printer|trash|plant_tall|plant_bush|water/i.test(String(id || ''))) {
      return false;
    }
    // Decor + common desk-top names (even if mis-typed as furniture)
    if (def.type === 'decor') return true;
    return /lamp|monitor|laptop|keyboard|mouse|phone|mug|book|paper|folder|desk_setup|pc_|computer|screen|notepad|pen|stapler|photo|frame_small|desk_item/i.test(String(id || ''));
  }

  function isDeskLike(entry) {
    if (!entry?.def) return false;
    // Never treat desk-top items as desks (even if name contains workstation/desk_setup).
    if (entry.def.stack_on === 'surface' || entry.def.stack_on === 'desk') return false;
    if (entry.def.category === 'desk_items') return false;
    if (entry.def.type === 'surface') return true;
    if (entry.def.category === 'desks' || entry.def.category === 'tables') return true;
    const id = String(entry.id || '');
    if (/monitor|lamp|laptop|keyboard|phone|printer_dual|papers|mug|mouse/i.test(id)) return false;
    return /^(desk_|table_|counter_|reception_)/i.test(id)
      || /cubicle_desk|(^|_)desk($|_)/i.test(id);
  }

  function findDeskUnderPoint(scene, x, y, { maxDist = 72 } = {}) {
    const desks = (scene._interactables || []).filter((e) => isDeskLike(e) && e.sprite && !e.parentInstanceId);
    let best = null;
    let bestScore = Infinity;
    desks.forEach((desk) => {
      const b = localSpriteBounds(desk.sprite);
      if (!b) return;
      // Prefer horizontal overlap with desk top half (where items sit).
      const padX = Math.max(20, b.w * 0.35);
      const padY = Math.max(24, b.h * 0.55);
      const inside = x >= b.left - padX && x <= b.right + padX && y >= b.top - padY && y <= b.bottom + padY;
      const dx = x - b.cx;
      const dy = y - (b.top + b.h * 0.35);
      const dist = Math.hypot(dx, dy);
      const score = inside ? dist * 0.25 : dist;
      if ((inside || dist <= maxDist) && score < bestScore) {
        bestScore = score;
        best = desk;
      }
    });
    return best;
  }

  function attachEntryToDesk(scene, entry, desk, { offsetX = 0, offsetY = null } = {}) {
    if (!entry?.sprite || !desk?.sprite) return false;
    const state = initEditorState(scene);
    const placement = state.placements.find((p) => (p.instanceId || p.id) === entry.instanceId);
    if (!placement) return false;
    const def = entry.def || {};
    const oy = offsetY != null
      ? offsetY
      : (placement.parent_offset_y !== undefined
        ? placement.parent_offset_y
        : (def.parent_offset_y !== undefined ? def.parent_offset_y : -18));
    placement.parentInstanceId = desk.instanceId;
    placement.parent_offset_y = oy;
    placement.x = Math.round(desk.sprite.x + offsetX);
    placement.y = Math.round(desk.sprite.y + oy);
    entry.parentInstanceId = desk.instanceId;
    entry.sprite.x = placement.x;
    entry.sprite.y = placement.y;
    entry.sprite.setDepth((desk.sprite.depth || 10) + 8);
    if (entry.def) entry.def._placement = { ...entry.def._placement, ...placement };
    if (entry.obstacle) {
      removeObstacle(scene, entry.obstacle);
      entry.obstacle = null;
    }
    // Child items shouldn't be independently draggable away from desk without detach —
    // keep interactive for select, but parent drag still moves them via existing child sync.
    prepareSpriteForEditing(scene, entry);
    scene._depthDirty = true;
    return true;
  }

  function detachEntryFromDesk(scene, entry) {
    if (!entry?.parentInstanceId) return false;
    const state = initEditorState(scene);
    const placement = state.placements.find((p) => (p.instanceId || p.id) === entry.instanceId);
    if (placement) {
      delete placement.parentInstanceId;
      delete placement.parent_offset_y;
      placement.x = Math.round(entry.sprite.x);
      placement.y = Math.round(entry.sprite.y);
    }
    entry.parentInstanceId = null;
    if (entry.def?._placement) {
      delete entry.def._placement.parentInstanceId;
      delete entry.def._placement.parent_offset_y;
    }
    refreshFurnitureDepth(entry);
    if (!entry.obstacle) entry.obstacle = addObstacle(scene, entry.sprite, entry.def);
    prepareSpriteForEditing(scene, entry);
    return true;
  }

  function snapSelectedOntoDesk() {
    const scene = getScene();
    if (!scene || editorMode !== 'furniture') return;
    const selected = getSelectedFurnitureEntries(scene, { includeChildren: true })
      .filter((e) => e?.sprite && !isDeskLike(e));
    if (!selected.length) {
      syncInfo('Select a monitor/lamp/item (not the desk), stand it over a desk, then Put on desk');
      return;
    }
    pushEditorUndo('put on desk');
    let attached = 0;
    selected.forEach((entry) => {
      // Always allow attach for selected non-desk items — labels are often wrong.
      const desk = findDeskUnderPoint(scene, entry.sprite.x, entry.sprite.y, { maxDist: 140 });
      if (!desk) return;
      if (attachEntryToDesk(scene, entry, desk)) attached += 1;
    });
    updateSelectionOverlay();
    scheduleLayoutSave(scene);
    syncInfo(attached
      ? `Snapped ${attached} item(s) onto desk — they move with the desk now`
      : 'No desk found nearby — drag the item onto a desk first, then click Put on desk');
  }

  function destroySelectionOverlay() {
    if (selectionGfx) {
      try { selectionGfx.destroy(); } catch (_) {}
    }
    selectionGfx = null;
    if (selectionRotateHandle) {
      try { selectionRotateHandle.destroy(); } catch (_) {}
    }
    selectionRotateHandle = null;
  }

  /** Green outline per selected sprite + a rotate handle above the combined bounds. */
  function updateSelectionOverlay() {
    const scene = getScene();
    destroySelectionOverlay();
    if (!scene || !editorActive || editorMode !== 'furniture' || !selectedSprites.length) return;
    const MEP = window.DenizenMapEditorPro;
    if (!MEP) return;
    const gfx = scene.add.graphics().setDepth(20000);
    selectedSprites.forEach((sprite) => {
      const b = MEP.spriteWorldBounds(sprite);
      if (!b) return;
      gfx.lineStyle(2, 0x4ade80, 0.95);
      gfx.strokeRect(b.left, b.top, b.w, b.h);
    });
    selectionGfx = gfx;
    const entries = getSelectedFurnitureEntries(scene);
    const bounds = MEP.selectionBounds(entries.length ? entries : selectedSprites.map((sprite) => ({ sprite })));
    if (!bounds) return;
    const handleX = bounds.cx;
    const handleY = bounds.top - 18;
    gfx.lineStyle(2, 0xfde047, 0.9);
    gfx.lineBetween(bounds.cx, bounds.top, handleX, handleY);
    const handle = scene.add.circle(handleX, handleY, 7, 0xfde047, 0.95)
      .setDepth(20001)
      .setStrokeStyle(2, 0x0f172a);
    handle.setInteractive({ useHandCursor: true });
    handle.on('pointerdown', (pointer) => {
      try { pointer.event?.stopPropagation?.(); } catch (_) {}
      transformSelected({ rotationDelta: 90 });
    });
    selectionRotateHandle = handle;
  }

  function clearFurnitureSelection() {
    selectedSprites.forEach((sprite) => {
      if (sprite && typeof sprite.clearTint === 'function') sprite.clearTint();
    });
    selectedSprites = [];
    selectedSprite = null;
    destroySelectionOverlay();
    const selected = document.getElementById('ed-selected');
    if (selected) selected.textContent = 'Nothing selected';
    refreshEditorStatusChrome();
  }

  function selectFurnitureEntry(entry, { keepPending = false, additive = false } = {}) {
    if (!entry?.sprite) return;
    if (additive) {
      const idx = selectedSprites.indexOf(entry.sprite);
      if (idx >= 0) {
        if (typeof entry.sprite.clearTint === 'function') entry.sprite.clearTint();
        selectedSprites.splice(idx, 1);
        selectedSprite = selectedSprites[selectedSprites.length - 1] || null;
      } else {
        selectedSprites.push(entry.sprite);
        selectedSprite = entry.sprite;
        if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x66ff99);
      }
    } else {
      selectedSprites.forEach((sprite) => {
        if (sprite !== entry.sprite && typeof sprite.clearTint === 'function') sprite.clearTint();
      });
      selectedSprites = [entry.sprite];
      selectedSprite = entry.sprite;
      if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x66ff99);
    }
    if (!keepPending) setPendingCatalog(null);
    syncSelectedReadout(entry);
    updateSelectionOverlay();
  }

  function syncSelectedReadout(entry) {
    const selected = document.getElementById('ed-selected');
    if (!selected) return;
    if (selectedSprites.length > 1) {
      selected.textContent = `${selectedSprites.length} items selected`;
      syncInfo(`${selectedSprites.length} items selected — Align/Distribute, Duplicate, or Delete`);
      return;
    }
    if (!entry?.sprite) return;
    const pl = entry.def?._placement || {};
    const rot = Math.round(Number(pl.rotation) || entry.sprite.angle || 0);
    const scale = Number(pl.scale);
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    selected.textContent = `${entry.id} · x:${Math.round(entry.sprite.x)} y:${Math.round(entry.sprite.y)} · ${rot}° · ×${s.toFixed(2)}${pl.flipX ? ' · flipped' : ''}`;
    syncInfo(`Editing ${entry.id} — drag to move, scroll to rotate, use Transform tools`);
  }

  function writeTransformToPlacement(entry) {
    if (!entry?.sprite) return;
    const scene = getScene();
    const state = initEditorState(scene);
    const placement = state.placements.find((item) => (item.instanceId || item.id) === entry.instanceId);
    if (!placement) return;
    placement.x = Math.round(entry.sprite.x);
    placement.y = Math.round(entry.sprite.y);
    placement.rotation = Math.round(((entry.sprite.angle % 360) + 360) % 360);
    const scale = Number(placement.scale);
    placement.scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    placement.flipX = !!entry.sprite.flipX;
    placement.flipY = !!entry.sprite.flipY;
    if (entry.def) entry.def._placement = { ...entry.def._placement, ...placement };
  }

  function transformSelected({ rotationDelta = 0, scaleFactor = 1, flipX = false, flipY = false } = {}) {
    const scene = getScene();
    if (!scene || editorMode !== 'furniture') return;

    // Sims catalog ghost: rotate/scale the preview before placing.
    if (placeGhost && initEditorState(scene).pendingCatalogId) {
      if (rotationDelta) rotatePlaceGhost(rotationDelta);
      if (scaleFactor !== 1) {
        placeGhost.scale = Math.min(4, Math.max(0.25, (placeGhost.scale || 1) * scaleFactor));
        applyGhostTransform();
      }
      if (flipX) placeGhost.flipX = !placeGhost.flipX;
      if (flipY) placeGhost.flipY = !placeGhost.flipY;
      if (flipX || flipY) applyGhostTransform();
      return;
    }

    const entries = getSelectedFurnitureEntries(scene);
    if (!entries.length) {
      syncInfo('Select a placed sprite first (click it on the map)');
      return;
    }
    pushEditorUndo(entries.length > 1 ? `transform ${entries.length} items` : `transform ${entries[0].id}`);
    const state = initEditorState(scene);
    entries.forEach((entry) => {
      if (!entry?.sprite) return;
      const placement = state.placements.find((item) => (item.instanceId || item.id) === entry.instanceId)
        || { id: entry.id, instanceId: entry.instanceId, x: entry.sprite.x, y: entry.sprite.y };
      if (!state.placements.includes(placement)) state.placements.push(placement);

      let rot = Number(placement.rotation) || 0;
      let scale = Number(placement.scale);
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;
      rot = (((rot + rotationDelta) % 360) + 360) % 360;
      scale = Math.min(4, Math.max(0.25, scale * scaleFactor));
      if (flipX) placement.flipX = !placement.flipX;
      if (flipY) placement.flipY = !placement.flipY;
      placement.rotation = Math.round(rot);
      placement.scale = Math.round(scale * 100) / 100;

      applyPlacementTransform(entry.sprite, placement, entry.def);
      refreshFurnitureDepth(entry);
      if (entry.obstacle) {
        entry.obstacle.x = entry.sprite.x;
        entry.obstacle.y = entry.sprite.y;
        // Keep collision roughly matching visual width after scale.
        if (entry.obstacle.body && typeof entry.obstacle.setSize === 'function') {
          const collW = Math.min(Math.max(entry.sprite.displayWidth, 16), 128);
          entry.obstacle.setSize(collW, 16);
          entry.obstacle.body.updateFromGameObject();
        } else if (entry.obstacle.body) {
          entry.obstacle.body.updateFromGameObject();
        }
      }
      if (entry.def) entry.def._placement = { ...entry.def._placement, ...placement };
      if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x66ff99);
    });
    syncSelectedReadout(entries[0]);
    updateSelectionOverlay();
    scene._depthDirty = true;
    scheduleLayoutSave(scene);
  }

  function deleteSelectedFurniture() {
    const scene = getScene();
    if (!scene || editorMode !== 'furniture') return;
    const entries = getSelectedFurnitureEntries(scene);
    if (!entries.length) {
      syncInfo('Select a sprite to delete (click it, or double-click to delete)');
      return;
    }
    if (entries.length >= 2 && !confirm(`Delete ${entries.length} item(s)? Undo can restore.`)) {
      return;
    }
    pushEditorUndo(entries.length > 1 ? `delete ${entries.length} items` : `delete ${entries[0].id}`);
    entries.forEach((entry) => removeEntry(scene, entry));
    clearFurnitureSelection();
    scheduleLayoutSave(scene);
  }

  /** Clone each selected root entry with a +24,+24 offset and select the copies. */
  function duplicateSelectedFurniture() {
    const scene = getScene();
    if (!scene || editorMode !== 'furniture') return;
    const entries = getSelectedFurnitureEntries(scene);
    if (!entries.length) {
      syncInfo('Select item(s) to duplicate first');
      return;
    }
    pushEditorUndo(entries.length > 1 ? `duplicate ${entries.length} items` : `duplicate ${entries[0].id}`);
    const state = initEditorState(scene);
    const created = [];
    entries.forEach((entry) => {
      const source = state.placements.find((item) => (item.instanceId || item.id) === entry.instanceId);
      const base = source ? { ...source } : {
        id: entry.id,
        x: entry.sprite.x,
        y: entry.sprite.y,
        rotation: entry.sprite.angle,
      };
      delete base._comment;
      const placement = {
        ...base,
        instanceId: `editor_${entry.id}_${state.nextId++}`,
        x: Math.round((base.x ?? entry.sprite.x) + 24),
        y: Math.round((base.y ?? entry.sprite.y) + 24),
      };
      state.placements.push(placement);
      const newEntry = makePlacementSprite(scene, placement);
      if (newEntry) created.push(newEntry);
    });
    if (created.length) {
      selectedSprites.forEach((sprite) => {
        if (sprite && typeof sprite.clearTint === 'function') sprite.clearTint();
      });
      selectedSprites = created.map((entry) => entry.sprite);
      selectedSprite = selectedSprites[selectedSprites.length - 1];
      created.forEach((entry) => {
        if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x66ff99);
      });
      syncSelectedReadout(created[created.length - 1]);
      updateSelectionOverlay();
      scene._depthDirty = true;
      scheduleLayoutSave(scene);
      syncInfo(`Duplicated ${created.length} item(s) — offset +24,+24`);
    }
  }

  /**
   * Align/distribute selected items.
   * Align L/C/R/T/B line items up to the first selected item's edge/center.
   * Dist H/V evenly spaces 3+ items between the outer items.
   */
  function alignSelectedFurniture(mode) {
    const scene = getScene();
    if (!scene || editorMode !== 'furniture') return;
    const entries = getSelectedFurnitureEntries(scene, { includeChildren: true })
      .filter((entry) => entry?.sprite);
    if (entries.length < 2) {
      syncInfo('Align needs 2+ selected — Shift-click items, then Align L/C/R');
      return;
    }
    if ((mode === 'distributeH' || mode === 'distributeV') && entries.length < 3) {
      syncInfo('Distribute needs 3+ selected items');
      return;
    }

    pushEditorUndo(`align ${mode}`);
    const withBounds = entries.map((entry) => ({
      entry,
      bounds: localSpriteBounds(entry.sprite),
      order: selectedSprites.indexOf(entry.sprite),
    })).filter((e) => e.bounds);
    withBounds.sort((a, b) => a.order - b.order);
    if (withBounds.length < 2) {
      syncInfo('Could not read item bounds — try selecting again');
      return;
    }

    const applyMove = (entry, x, y) => {
      if (entry.parentInstanceId) {
        const parent = scene._interactables.find((it) => it.instanceId === entry.parentInstanceId);
        if (parent?.sprite) {
          entry.sprite.x = Math.round(x);
          entry.sprite.y = Math.round(y);
          const state = initEditorState(scene);
          const placement = state.placements.find((p) => (p.instanceId || p.id) === entry.instanceId);
          if (placement) {
            placement.x = Math.round(x);
            placement.y = Math.round(y);
            placement.parent_offset_y = Math.round(y - parent.sprite.y);
          }
          entry.sprite.setDepth((parent.sprite.depth || 10) + 8);
          if (entry.def) entry.def._placement = { ...entry.def._placement, ...placement };
          return;
        }
      }
      entry.sprite.x = Math.round(x);
      entry.sprite.y = Math.round(y);
      refreshFurnitureDepth(entry);
      if (entry.obstacle) {
        entry.obstacle.x = entry.sprite.x;
        entry.obstacle.y = entry.sprite.y;
        if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
      }
      writeTransformToPlacement(entry);
      const state = initEditorState(scene);
      state.placements.forEach((placementItem) => {
        if (placementItem.parentInstanceId !== entry.instanceId) return;
        const child = scene._interactables.find((it) => it.instanceId === (placementItem.instanceId || placementItem.id));
        if (!child?.sprite) return;
        const oy = placementItem.parent_offset_y !== undefined
          ? placementItem.parent_offset_y
          : (child.def?.parent_offset_y !== undefined ? child.def.parent_offset_y : -18);
        child.sprite.x = entry.sprite.x;
        child.sprite.y = entry.sprite.y + oy;
        child.sprite.setDepth((entry.sprite.depth || 10) + 8);
      });
    };

    const anchor = withBounds[0];
    if (mode === 'left') {
      withBounds.forEach(({ entry, bounds }) => {
        applyMove(entry, entry.sprite.x + (anchor.bounds.left - bounds.left), entry.sprite.y);
      });
    } else if (mode === 'right') {
      withBounds.forEach(({ entry, bounds }) => {
        applyMove(entry, entry.sprite.x + (anchor.bounds.right - bounds.right), entry.sprite.y);
      });
    } else if (mode === 'center') {
      withBounds.forEach(({ entry, bounds }) => {
        applyMove(entry, entry.sprite.x + (anchor.bounds.cx - bounds.cx), entry.sprite.y);
      });
    } else if (mode === 'top') {
      withBounds.forEach(({ entry, bounds }) => {
        applyMove(entry, entry.sprite.x, entry.sprite.y + (anchor.bounds.top - bounds.top));
      });
    } else if (mode === 'bottom') {
      withBounds.forEach(({ entry, bounds }) => {
        applyMove(entry, entry.sprite.x, entry.sprite.y + (anchor.bounds.bottom - bounds.bottom));
      });
    } else if (mode === 'distributeH') {
      const sorted = [...withBounds].sort((a, b) => a.bounds.cx - b.bounds.cx);
      const first = sorted[0].bounds.cx;
      const last = sorted[sorted.length - 1].bounds.cx;
      const step = (last - first) / (sorted.length - 1);
      sorted.forEach((e, i) => {
        applyMove(e.entry, e.entry.sprite.x + (first + step * i - e.bounds.cx), e.entry.sprite.y);
      });
    } else if (mode === 'distributeV') {
      const sorted = [...withBounds].sort((a, b) => a.bounds.cy - b.bounds.cy);
      const first = sorted[0].bounds.cy;
      const last = sorted[sorted.length - 1].bounds.cy;
      const step = (last - first) / (sorted.length - 1);
      sorted.forEach((e, i) => {
        applyMove(e.entry, e.entry.sprite.x, e.entry.sprite.y + (first + step * i - e.bounds.cy));
      });
    }

    scene._depthDirty = true;
    scene._agentManager?.refreshDeskAnchorsAfterLayoutChange?.();
    updateSelectionOverlay();
    scheduleLayoutSave(scene);
    const labels = {
      left: 'left edges → first selected',
      right: 'right edges → first selected',
      center: 'centers → first selected',
      top: 'tops → first selected',
      bottom: 'bottoms → first selected',
      distributeH: 'even horizontal spacing',
      distributeV: 'even vertical spacing',
    };
    syncInfo(`Aligned ${entries.length} items — ${labels[mode] || mode}`);
  }

  function addObstacle(scene, sprite, def, placement) {
    const engine = window.DenizenMapEngine;
    const pl = placement || def?._placement || {};
    if (engine?.shouldCollide) {
      if (!engine.shouldCollide(def, pl)) return null;
    } else if (def.type === 'decor' || def.type === 'seat' || sprite.displayWidth < 48) {
      return null;
    }
    const b = engine?.resolveCollisionBounds
      ? engine.resolveCollisionBounds(def, sprite.displayWidth, sprite.displayHeight)
      : { width: Math.min(sprite.displayWidth, 64), height: 16 };
    const foot = engine?.footprintWorldRect
      ? engine.footprintWorldRect(sprite.x, sprite.y, b)
      : { x: sprite.x, y: sprite.y - b.height / 2, width: b.width, height: b.height };
    const obstacle = scene.add.rectangle(foot.x, foot.y, foot.width, foot.height, 0x000000, 0);
    scene.physics.add.existing(obstacle, true);
    if (scene._obstacleSink) scene._obstacleSink.push(obstacle);
    else scene._obstacles.push(obstacle);
    return obstacle;
  }

  function removeObstacle(scene, obstacle) {
    if (!obstacle) return;
    if (Array.isArray(scene._obstacles)) {
      const idx = scene._obstacles.indexOf(obstacle);
      if (idx >= 0) scene._obstacles.splice(idx, 1);
    }
    try { scene.obstacles?.remove?.(obstacle, true, true); } catch (_) {}
    try { obstacle.destroy(); } catch (_) {}
  }

  // NPC placements (POST /api/place-furniture) use the server's whitelist ids
  // (desk_2x2, office_chair, …) which are NOT catalog object ids — without
  // this translation every NPC-placed item silently rendered as nothing.
  // rug/phone_booth/standing_desk have no catalog art; nearest stand-ins.
  const NPC_PREFAB_ALIASES = {
    desk_small: 'box_desk',
    desk_2x2: 'cubicle_desk',
    office_chair: 'chair_black_back',
    monitor: 'monitor_dual_sheet',
    plant_small: 'plant_potted',
    plant_large: 'plant_floor_leafy',
    whiteboard: 'whiteboard_1x2',
    bookshelf: 'bookshelf_short',
    coffee_machine: 'coffee_machine',
    water_cooler: 'water_cooler',
    couch: 'sofa_2person',
    rug: 'floor_tile_beige',
    standing_desk: 'cubicle_desk_front',
    phone_booth: 'shelf_metal_empty',
    meeting_table: 'table_wood_long',
  };

  function makePlacementSprite(scene, placement) {
    const catalog = getCatalog(scene);
    let defId = placement.id;
    let def = catalog?.objects?.[defId];
    if (!def && NPC_PREFAB_ALIASES[defId]) {
      defId = NPC_PREFAB_ALIASES[defId];
      def = catalog?.objects?.[defId];
    }
    if (!def) return null;
    const texKey = ensureCatalogTexture(scene, defId, def);
    if (!texKey) return null;

    const isChild = !!placement.parentInstanceId;
    let x = placement.x;
    let y = placement.y;
    if (isChild) {
      const parentSprite = scene._placedCatalogSprites[placement.parentInstanceId];
      if (!parentSprite) return null;
      const offsetY = placement.parent_offset_y !== undefined
        ? placement.parent_offset_y
        : (def.parent_offset_y !== undefined ? def.parent_offset_y : -18);
      // Keep horizontal offset from placement; only lock Y to desk surface.
      x = placement.x != null ? placement.x : parentSprite.x;
      y = parentSprite.y + offsetY;
      placement.y = y;
      placement.parent_offset_y = offsetY;
    }

    const depth = furnitureRenderDepth(y, def, placement);
    const originY = def.origin === 'center' ? 0.5 : 1;
    const sprite = scene.add.image(x, y, texKey).setOrigin(0.5, originY).setDepth(depth);
    if (def.source_type === 'single_file') {
      const dw = def.display_w || def.w || 32;
      const dh = def.display_h || def.h || 48;
      sprite.setDisplaySize(dw, dh);
    }
    applyPlacementTransform(sprite, placement, def);
    if (isChild) {
      const parentEntry = scene._interactables.find((it) => it.instanceId === placement.parentInstanceId);
      if (parentEntry?.sprite) sprite.setDepth((parentEntry.sprite.depth || 10) + 8);
    }
    scene.furnitureDecorSprites.push({ sprite, depth: sprite.depth });

    const instanceId = placement.instanceId || placement.id;
    const obstacle = isChild ? null : addObstacle(scene, sprite, def, placement);
    const entry = {
      id: placement.id,
      instanceId,
      sprite,
      def: { ...def, _placement: placement },
      obstacle,
      parentInstanceId: placement.parentInstanceId || null
    };
    scene._placedCatalogSprites[instanceId] = sprite;
    scene._interactables.push(entry);
    if (editorActive) prepareSpriteForEditing(scene, entry);
    updateLayerVisibility();
    return entry;
  }

  function removeEntry(scene, entry) {
    if (!scene || !entry) return;
    const state = initEditorState(scene);
    const children = scene._interactables.filter((item) => item.parentInstanceId === entry.instanceId);
    children.forEach((child) => removeEntry(scene, child));

    removeObstacle(scene, entry.obstacle);
    if (entry.sprite) entry.sprite.destroy();
    delete scene._placedCatalogSprites[entry.instanceId];
    scene._interactables = scene._interactables.filter((item) => item !== entry);
    scene.furnitureDecorSprites = scene.furnitureDecorSprites.filter((item) => item.sprite !== entry.sprite);
    state.placements = state.placements.filter((placement) => (placement.instanceId || placement.id) !== entry.instanceId);
    syncInfo(`Deleted ${entry.id} [${entry.instanceId}]`);
  }

  function addCatalogPlacement(scene, catalogId, worldX, worldY) {
    const catalog = getCatalog(scene);
    const def = catalog?.objects?.[catalogId];
    if (!def) {
      syncInfo(`Unknown catalog id: ${catalogId}`);
      return null;
    }

    if (def.source_type === 'single_file' && !scene.textures.exists(`single_${catalogId}`)) {
      return loadSingleThenPlace(scene, catalogId, def, worldX, worldY);
    }

    pushEditorUndo(`place ${catalogId}`);
    const state = initEditorState(scene);
    const MEP = window.DenizenMapEditorPro;
    const engine = window.DenizenMapEngine;
    const isWall = !!(MEP?.isWallMount?.(catalogId, def) || engine?.isWallMount?.(catalogId, def));
    const desk = !isWall && isStackableDecor(catalogId, def)
      ? findDeskUnderPoint(scene, worldX, worldY, { maxDist: 64 })
      : null;
    const parentOffsetY = desk
      ? (def.parent_offset_y !== undefined ? def.parent_offset_y : -18)
      : null;
    let placeX = desk ? desk.sprite.x + (worldX - desk.sprite.x) * 0.35 : worldX;
    let placeY = desk ? desk.sprite.y + parentOffsetY : worldY;
    let wallMount = false;
    if (isWall && !desk) {
      const segments = scene._wallLayoutSegments
        || scene.cache?.json?.get('openplan_walls')?.segments
        || [];
      const snapped = engine?.snapWallMount?.(worldX, worldY, segments)
        || { x: snapCoord(worldX), y: snapCoord(worldY), wallMount: false };
      placeX = snapped.x;
      placeY = snapped.y;
      wallMount = !!snapped.wallMount;
    }
    const placement = {
      id: catalogId,
      instanceId: `editor_${catalogId}_${state.nextId++}`,
      x: snapCoord(placeX),
      y: snapCoord(placeY),
      rotation: Math.round(
        (placeGhost?.catalogId === catalogId ? placeGhost.rotation : pendingPlaceRotation) || 0
      ),
      scale: placeGhost?.catalogId === catalogId && placeGhost.scale
        ? Math.round(placeGhost.scale * 100) / 100
        : 1,
      flipX: !!(placeGhost?.catalogId === catalogId && placeGhost.flipX),
      flipY: !!(placeGhost?.catalogId === catalogId && placeGhost.flipY),
    };
    if (wallMount) placement.wallMount = true;
    if (desk) {
      placement.parentInstanceId = desk.instanceId;
      placement.parent_offset_y = parentOffsetY;
      placement.x = snapCoord(worldX);
      placement.y = snapCoord(desk.sprite.y + parentOffsetY);
    }
    state.placements.push(placement);
    const entry = makePlacementSprite(scene, placement);
    if (entry) {
      if (desk) {
        entry.parentInstanceId = desk.instanceId;
        entry.sprite.setDepth((desk.sprite.depth || 10) + 8);
        if (entry.obstacle) {
          removeObstacle(scene, entry.obstacle);
          entry.obstacle = null;
        }
      }
      editorPrefs = window.DenizenMapEditorPro?.pushRecent?.(editorPrefs, catalogId) || editorPrefs;
      selectFurnitureEntry(entry, { keepPending: true });
      state.pendingCatalogId = catalogId;
      syncPlaceGhost(scene);
      if (placeGhost?.sprite) {
        placeGhost.sprite.x = placement.x;
        placeGhost.sprite.y = placement.y;
      }
      const selected = document.getElementById('ed-selected');
      if (selected) {
        selected.textContent = desk
          ? `On desk: ${catalogId} → ${desk.id}`
          : `Armed: ${catalogId} · ${placement.rotation}° — click to place another`;
      }
      scene._depthDirty = true;
      syncInfo(desk
        ? `Placed ${catalogId} on ${desk.id} — moves with the desk`
        : `Placed ${catalogId} at x:${placement.x} y:${placement.y} · ${placement.rotation}°`);
      scheduleLayoutSave(scene);
    } else {
      syncInfo(`Failed to place ${catalogId} (texture missing)`);
    }
    return entry;
  }

  function prepareSpriteForEditing(scene, entry) {
    if (!entry?.sprite || !scene?.input) return;
    entry.sprite.removeInteractive();
    if (entry.parentInstanceId) {
      entry.sprite.setInteractive({ useHandCursor: true });
      return;
    }
    entry.sprite.setInteractive({ draggable: true, useHandCursor: true });
    // Phaser 3: setInteractive({draggable:true}) is not always enough — register explicitly.
    scene.input.setDraggable(entry.sprite, true);
  }

  /** Login / visitor modals sit above the canvas and steal all pointer events. */
  function suppressEditorBlockers() {
    const modal = document.getElementById('denizen-visitor-name-modal');
    if (modal && modal.style.display !== 'none') {
      modal.dataset.editorSuppressed = '1';
      modal.style.display = 'none';
    }
    if (document.documentElement.dataset.denizenModal === 'open') {
      document.documentElement.dataset.editorClearedModal = '1';
      delete document.documentElement.dataset.denizenModal;
    }
    globalThis.DenizenPublicDemo?.setBannerVisible?.(false);
  }

  function restoreEditorBlockers() {
    const modal = document.getElementById('denizen-visitor-name-modal');
    if (modal?.dataset.editorSuppressed === '1') {
      modal.style.display = '';
      delete modal.dataset.editorSuppressed;
    }
    if (document.documentElement.dataset.editorClearedModal === '1') {
      document.documentElement.dataset.denizenModal = 'open';
      delete document.documentElement.dataset.editorClearedModal;
    }
    // Do not re-show the demo banner after editor exit — that used to leave
    // denizen-public-demo-banner-open stuck and stretch the level chip.
  }

  let saveLayoutTimer = null;
  let layoutSaveDirty = false;
  let layoutSaveInFlight = null;

  function buildPlacementSnapshot(scene) {
    const catalog = getCatalog(scene);
    if (!catalog) return null;
    const state = initEditorState(scene);
    const updated = state.placements.map((placement) => {
      if (placement._comment) return placement;
      const instanceId = placement.instanceId || placement.id;
      const entry = scene._interactables.find((item) => item.instanceId === instanceId);
      if (!entry || entry.parentInstanceId) return placement;
      return {
        ...placement,
        x: Math.round(entry.sprite.x),
        y: Math.round(entry.sprite.y),
        rotation: Math.round(((Number(placement.rotation) || entry.sprite.angle || 0) % 360 + 360) % 360),
        scale: (() => {
          const s = Number(placement.scale);
          return Number.isFinite(s) && s > 0 ? Math.round(s * 100) / 100 : 1;
        })(),
        flipX: !!entry.sprite.flipX,
        flipY: !!entry.sprite.flipY,
      };
    });
    const OW = getOpenplanWalls();
    const walls = OW ? OW.layoutFromScene(scene, scene._wallLayoutInfo || {}) : null;
    return { catalog, placements: updated, walls };
  }

  function persistLayoutPlacements(scene, { quiet = false } = {}) {
    const snap = buildPlacementSnapshot(scene);
    if (!snap) return Promise.resolve(false);
    const body = JSON.stringify({
      catalogId: 'furniture_catalog_openplan',
      placements: snap.placements,
      walls: snap.walls || undefined,
    });
    setSaveStatus('Saving…', 'saving');
    layoutSaveInFlight = fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).then((r) => {
      if (r.ok) {
        layoutSaveDirty = false;
        if (!quiet) syncInfo('Layout saved to server');
        setSaveStatus('Saved', 'saved');
        return true;
      }
      if (!quiet) syncInfo('Failed to save layout to server');
      setSaveStatus('Save failed', 'error');
      return false;
    }).catch(() => {
      if (!quiet) syncInfo('Failed to save layout to server');
      setSaveStatus('Save failed', 'error');
      return false;
    }).finally(() => {
      layoutSaveInFlight = null;
    });
    return layoutSaveInFlight;
  }

  function scheduleLayoutSave(scene) {
    if (!scene) return;
    layoutSaveDirty = true;
    clearTimeout(saveLayoutTimer);
    setSaveStatus('Saving…', 'saving');
    saveLayoutTimer = setTimeout(() => persistLayoutPlacements(scene, { quiet: true }), 600);
  }

  /** Flush pending autosave immediately (editor exit / page unload). */
  function flushLayoutSave(scene, { quiet = false } = {}) {
    clearTimeout(saveLayoutTimer);
    saveLayoutTimer = null;
    if (!scene) return Promise.resolve(false);
    if (!layoutSaveDirty && !layoutSaveInFlight) {
      // Still persist once on exit so walls/furniture match what you see.
      return persistLayoutPlacements(scene, { quiet });
    }
    if (layoutSaveInFlight) return layoutSaveInFlight;
    return persistLayoutPlacements(scene, { quiet });
  }

  window.DenizenSaveLayout = function(options = {}) {
    const scene = getScene();
    if (!scene) return Promise.resolve(false);
    return flushLayoutSave(scene, { quiet: !!options.quiet });
  };

  window._editorExport = function() {
    const scene = getScene();
    if (!scene) return;
    const snap = buildPlacementSnapshot(scene);
    if (!snap) return;
    const output = JSON.stringify({ ...snap.catalog, placements: snap.placements }, null, 2);

    flushLayoutSave(scene);

    // Also keep existing clipboard + download behavior
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(output).then(() => {
        syncInfo('Copied updated catalog JSON to clipboard');
      });
    }

    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'furniture_catalog_openplan_edited.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  function enableEditor() {
    const scene = getScene();
    if (!scene) return;
    if (editorActive) return;
    if (!Array.isArray(scene._interactables)) scene._interactables = [];
    editorActive = true;
    window.__DenizenEditorActive = true;
    document.documentElement.classList.add('denizen-editor-open');
    editorUndoStack = [];
    editorRedoStack = [];
    dragUndoSnapshot = null;
    dragOrigin = null;
    suppressEditorBlockers();
    initEditorState(scene);
    createEditorUI();
    renderCatalogList();
    updateUndoButtons();
    savedCameraState = {
      zoom: scene.cameras.main.zoom,
      scrollX: scene.cameras.main.scrollX,
      scrollY: scene.cameras.main.scrollY,
    };
    createEditorGrid(scene);
    updateOnboardingStrip();

    scene._editorWasLocked = scene.playerLocked;
    scene.playerLocked = true;

    // NPCs/player steal pointer hits — disable their input while editing.
    if (scene.player?.disableInteractive) scene.player.disableInteractive();
    else if (scene.player?.removeInteractive) scene.player.removeInteractive();
    (scene.npcs || []).forEach((npc) => {
      if (npc?.disableInteractive) npc.disableInteractive();
      else if (npc?.removeInteractive) npc.removeInteractive();
    });

    scene._interactables.forEach((entry) => prepareSpriteForEditing(scene, entry));

    const isFurnitureSprite = (gameObject) => (
      editorMode === 'furniture'
      && scene._interactables?.some((item) => item.sprite === gameObject)
    );

    const syncEntryChildrenAndPlacement = (entry, gameObject) => {
      refreshFurnitureDepth(entry);
      if (entry.obstacle) {
        entry.obstacle.x = gameObject.x;
        entry.obstacle.y = gameObject.y;
        if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
      }
      const state = initEditorState(scene);
      const placement = state.placements.find((item) => (item.instanceId || item.id) === entry.instanceId);
      if (placement) {
        placement.x = Math.round(gameObject.x);
        placement.y = Math.round(gameObject.y);
      }
      state.placements.forEach((placementItem) => {
        if (placementItem.parentInstanceId !== entry.instanceId) return;
        const childEntry = scene._interactables.find((item) => item.instanceId === (placementItem.instanceId || placementItem.id));
        if (!childEntry?.sprite) return;
        const def = childEntry.def || {};
        const offsetY = placementItem.parent_offset_y !== undefined
          ? placementItem.parent_offset_y
          : (def.parent_offset_y !== undefined ? def.parent_offset_y : -18);
        childEntry.sprite.x = gameObject.x;
        childEntry.sprite.y = gameObject.y + offsetY;
        refreshFurnitureDepth(childEntry);
        if (childEntry.obstacle) {
          childEntry.obstacle.x = childEntry.sprite.x;
          childEntry.obstacle.y = childEntry.sprite.y;
          if (childEntry.obstacle.body) childEntry.obstacle.body.updateFromGameObject();
        }
      });
    };

    const onDragStart = (pointer, gameObject) => {
      if (!isFurnitureSprite(gameObject)) return;
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      // Keep multi-select when dragging an already-selected item.
      if (entry && !selectedSprites.includes(gameObject)) {
        selectFurnitureEntry(entry, { additive: !!pointer?.event?.shiftKey });
      } else if (entry) {
        selectedSprite = entry.sprite;
        if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x00ff00);
      }
      if (typeof gameObject.setTint === 'function') gameObject.setTint(0x00ff00);
      dragUndoSnapshot = captureEditorSnapshot(
        selectedSprites.length > 1 ? `move ${selectedSprites.length} items` : `move ${entry?.id || 'item'}`
      );
      dragOrigin = { x: gameObject.x, y: gameObject.y };
      // Snapshot starting positions for group drag.
      scene._editorGroupDrag = getSelectedFurnitureEntries(scene)
        .filter((item) => !item.parentInstanceId)
        .map((item) => ({ entry: item, x: item.sprite.x, y: item.sprite.y }));
      if (!scene._editorGroupDrag.some((item) => item.entry.sprite === gameObject) && entry) {
        scene._editorGroupDrag.push({ entry, x: gameObject.x, y: gameObject.y });
      }
    };

    const onDrag = (pointer, gameObject, dragX, dragY) => {
      if (!isFurnitureSprite(gameObject)) return;
      const nextX = window._editorSnap ? snapCoord(dragX) : dragX;
      const nextY = window._editorSnap ? snapCoord(dragY) : dragY;
      const dx = nextX - (dragOrigin?.x ?? gameObject.x);
      const dy = nextY - (dragOrigin?.y ?? gameObject.y);
      const group = scene._editorGroupDrag;
      if (group && group.length > 1) {
        group.forEach(({ entry, x, y }) => {
          if (!entry?.sprite) return;
          entry.sprite.x = window._editorSnap ? snapCoord(x + dx) : x + dx;
          entry.sprite.y = window._editorSnap ? snapCoord(y + dy) : y + dy;
          if (typeof entry.sprite.setTint === 'function') entry.sprite.setTint(0x00ff00);
          syncEntryChildrenAndPlacement(entry, entry.sprite);
        });
        syncInfo(`Moving ${group.length} items`);
      } else {
        gameObject.x = nextX;
        gameObject.y = nextY;
        const entry = scene._interactables.find((item) => item.sprite === gameObject);
        if (entry) {
          syncEntryChildrenAndPlacement(entry, gameObject);
          syncInfo(`${entry.id} [${entry.instanceId}] x:${Math.round(gameObject.x)} y:${Math.round(gameObject.y)}`);
        }
      }
      updateSelectionOverlay();
    };

    const onDragEnd = (pointer, gameObject) => {
      if (!isFurnitureSprite(gameObject)) return;
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      const moved = dragOrigin
        && (Math.abs(gameObject.x - dragOrigin.x) > 0.5 || Math.abs(gameObject.y - dragOrigin.y) > 0.5);
      if (moved && dragUndoSnapshot && !restoringEditorHistory) {
        editorUndoStack.push(dragUndoSnapshot);
        if (editorUndoStack.length > MAX_EDITOR_UNDO) editorUndoStack.shift();
        editorRedoStack = [];
        updateUndoButtons();
      }
      dragUndoSnapshot = null;
      dragOrigin = null;
      const group = scene._editorGroupDrag || [];
      scene._editorGroupDrag = null;
      if (group.length > 1) {
        group.forEach(({ entry: item }) => {
          if (!item) return;
          writeTransformToPlacement(item);
          refreshFurnitureDepth(item);
          if (typeof item.sprite?.setTint === 'function') item.sprite.setTint(0x66ff99);
        });
        syncSelectedReadout(entry || group[0]?.entry);
      } else if (entry) {
        writeTransformToPlacement(entry);
        refreshFurnitureDepth(entry);
        if (typeof gameObject.setTint === 'function') gameObject.setTint(0x66ff99);
        syncSelectedReadout(entry);
      } else if (typeof gameObject.clearTint === 'function') {
        gameObject.clearTint();
      }
      updateSelectionOverlay();
      scene._depthDirty = true;
      scene._agentManager?.refreshDeskAnchorsAfterLayoutChange?.();
      scheduleLayoutSave(scene);
    };

    const onWallPointerMove = (pointer) => {
      if (!editorActive) return;
      if (editorMode === 'furniture') {
        if (initEditorState(scene).pendingCatalogId) {
          if (!placeGhost) syncPlaceGhost(scene);
          updatePlaceGhostAt(pointer.worldX, pointer.worldY);
        }
        return;
      }
      if (editorMode !== 'walls' || !wallDrawStart) return;
      const OW = getOpenplanWalls();
      if (!OW) return;
      OW.destroyPreview(wallDrawPreview);
      const segs = OW.segmentsFromDrag(
        wallDrawStart.x, wallDrawStart.y,
        pointer.worldX, pointer.worldY,
        window._editorSnap
      );
      wallDrawPreview = OW.drawPreviewBand(scene, segs, 0.5);
    };

    const onWheel = (pointer, currentlyOver, deltaX, deltaY) => {
      if (!editorActive) return;
      if (!deltaY) return;
      const zoomChord = !!(pointer.event?.ctrlKey || pointer.event?.metaKey);
      if (zoomChord) {
        try { pointer.event?.preventDefault?.(); } catch (_) {}
        zoomEditorCamera(deltaY > 0 ? -0.1 : 0.1);
        return;
      }
      if (editorMode !== 'furniture') return;
      try { pointer.event?.preventDefault?.(); } catch (_) {}
      const delta = deltaY > 0 ? 90 : -90;
      if (placeGhost && initEditorState(scene).pendingCatalogId) {
        rotatePlaceGhost(delta);
        return;
      }
      transformSelected({ rotationDelta: delta });
    };

    const onWallPointerUp = (pointer) => {
      if (!editorActive || editorMode !== 'walls') return;
      const OW = getOpenplanWalls();
      if (!OW) return;

      if (wallDrawStart) {
        const start = { ...wallDrawStart };
        const segs = OW.segmentsFromDrag(
          start.x, start.y,
          pointer.worldX, pointer.worldY,
          window._editorSnap
        );
        clearWallDrawPreview();
        if (segs.length) {
          resetWallClickStreak();
          placeWallSegmentsData(scene, segs);
          const label = segs.length > 2
            ? `L-wall (${segs.length} pieces with corner joint)`
            : segs.length > 1
            ? `L-wall (${segs.length} pieces)`
            : `${segs[0].type === 'h' ? 'wall band' : 'side wall'} (${
              segs[0].type === 'h'
                ? segs[0].endX - segs[0].startX
                : Math.abs(segs[0].endY - segs[0].startY)
            }px)`;
          syncInfo(wallEditorHint(`Placed ${label}`));
          return;
        }
        if (wallTool === 'draw' && !wallCutMode && !wallPendingType) {
          const moved = Math.hypot(pointer.worldX - start.x, pointer.worldY - start.y);
          if (moved < 6) {
            const clicks = registerWallClick('__bg__');
            if (clicks >= 3) {
              resetWallClickStreak();
              cycleWallLayerFilter();
            } else if (clicks === 1) {
              selectWallEntry(null);
            }
          }
        }
        return;
      }

      if (wallTool === 'draw' && !wallCutMode && !wallPendingType) {
        const clicks = registerWallClick('__bg__');
        if (clicks >= 3) {
          resetWallClickStreak();
          cycleWallLayerFilter();
        } else if (clicks === 1) {
          selectWallEntry(null);
        }
      }
    };

    const onPointerDown = (pointer, currentlyOver) => {
      if (!editorActive) return;
      if (editorMode === 'walls') {
        if (currentlyOver && currentlyOver.length > 0) return;
        if (wallCutMode && selectedWallEntry) {
          cutSelectedWallAt(pointer.worldX, pointer.worldY);
          return;
        }
        if (wallPendingType && wallPendingType !== 'draw') {
          addWallSegment(scene, wallPendingType, pointer.worldX, pointer.worldY);
          return;
        }
        if (wallTool === 'draw' && !wallCutMode) {
          wallDrawStart = { x: pointer.worldX, y: pointer.worldY };
        }
        return;
      }
      const state = initEditorState(scene);
      if (!state.pendingCatalogId) return;
      if (currentlyOver && currentlyOver.length > 0) return;
      addCatalogPlacement(scene, state.pendingCatalogId, pointer.worldX, pointer.worldY);
    };

    const onGameObjectDown = (pointer, gameObject) => {
      if (!editorActive) return;
      if (editorMode === 'walls') return;
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      if (!entry) return;
      const now = performance.now();
      if (lastPointerTarget === gameObject && now - lastPointerAt <= DOUBLE_CLICK_MS) {
        const count = getSelectedFurnitureEntries(scene).length;
        if (count >= 2 && !confirm(`Delete ${count} item(s)? Undo can restore.`)) {
          lastPointerTarget = null;
          lastPointerAt = 0;
          return;
        }
        pushEditorUndo(`delete ${entry.id}`);
        selectedSprites = selectedSprites.filter((s) => s !== gameObject);
        if (selectedSprite === gameObject) selectedSprite = selectedSprites[selectedSprites.length - 1] || null;
        removeEntry(scene, entry);
        scheduleLayoutSave(scene);
        lastPointerTarget = null;
        lastPointerAt = 0;
        const selected = document.getElementById('ed-selected');
        if (selected) selected.textContent = selectedSprites.length ? selected.textContent : 'Nothing selected';
        updateSelectionOverlay();
        refreshEditorStatusChrome();
        return;
      }
      lastPointerTarget = gameObject;
      lastPointerAt = now;
      const additive = !!(pointer.event?.shiftKey);
      selectFurnitureEntry(entry, { additive });
    };

    const onPanPointerDown = (pointer) => {
      if (!editorActive) return;
      const isMiddle = pointer.button === 1;
      if (!isMiddle && !spacePanning) return;
      panPointerActive = true;
      panPointerStart = { x: pointer.x, y: pointer.y };
      panCameraStart = { x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY };
    };
    const onPanPointerMove = (pointer) => {
      if (!panPointerActive || !panPointerStart || !panCameraStart) return;
      const cam = scene.cameras.main;
      cam.scrollX = panCameraStart.x - (pointer.x - panPointerStart.x) / cam.zoom;
      cam.scrollY = panCameraStart.y - (pointer.y - panPointerStart.y) / cam.zoom;
    };
    const onPanPointerUp = () => {
      panPointerActive = false;
      panPointerStart = null;
      panCameraStart = null;
    };

    const canvas = scene.game?.canvas;
    const dropTarget = document.getElementById('game-container') || canvas;
    const onCanvasDragOver = (event) => {
      if (!editorActive) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onCanvasDrop = (event) => {
      if (!editorActive) return;
      event.preventDefault();
      event.stopPropagation();
      const catalogId = event.dataTransfer.getData('text/plain');
      if (!catalogId) return;
      const point = getCanvasWorldPoint(scene, event.clientX, event.clientY);
      if (!point) return;
      addCatalogPlacement(scene, catalogId, point.x, point.y);
    };

    scene._editorHandlers = {
      onDragStart, onDrag, onDragEnd, onPointerDown, onGameObjectDown,
      onCanvasDragOver, onCanvasDrop, onWallPointerMove, onWallPointerUp, onWheel,
      onPanPointerDown, onPanPointerMove, onPanPointerUp,
      dropTarget,
    };
    scene.input.on('dragstart', onDragStart);
    scene.input.on('drag', onDrag);
    scene.input.on('dragend', onDragEnd);
    scene.input.on('pointerdown', onPointerDown);
    scene.input.on('pointerdown', onPanPointerDown);
    scene.input.on('pointermove', onWallPointerMove);
    scene.input.on('pointermove', onPanPointerMove);
    scene.input.on('pointerup', onWallPointerUp);
    scene.input.on('pointerup', onPanPointerUp);
    scene.input.on('wheel', onWheel);
    scene.input.on('gameobjectdown', onGameObjectDown);
    if (dropTarget) {
      dropTarget.addEventListener('dragover', onCanvasDragOver);
      dropTarget.addEventListener('drop', onCanvasDrop);
    }
    setEditorMode('furniture');
    scene._depthDirty = true;
    refreshEditorStatusChrome();
    syncInfo('Pick a catalog item — ghost follows your cursor. Click the map to place.');
  }

  function disableEditor() {
    const scene = getScene();
    // Flush furniture + wall edits before tearing down editor handlers
    if (scene) {
      flushLayoutSave(scene, { quiet: false });
    }
    editorActive = false;
    window.__DenizenEditorActive = false;
    document.documentElement.classList.remove('denizen-editor-open');
    document.documentElement.classList.remove('denizen-public-demo-banner-open');
    const chip = document.getElementById('denizen-office-level-chip');
    if (chip) {
      chip.style.top = '';
      chip.style.height = '';
      chip.style.display = '';
    }
    editorUndoStack = [];
    editorRedoStack = [];
    dragUndoSnapshot = null;
    dragOrigin = null;
    destroyPlaceGhost();
    pendingPlaceRotation = 0;
    clearFurnitureSelection();
    destroyEditorGrid();
    endCameraPan();
    if (scene && savedCameraState) {
      scene.cameras.main.setZoom(savedCameraState.zoom);
      scene.cameras.main.scrollX = savedCameraState.scrollX;
      scene.cameras.main.scrollY = savedCameraState.scrollY;
    }
    savedCameraState = null;
    restoreEditorBlockers();
    removeEditorUI();

    if (!scene) return;

    scene.playerLocked = scene._editorWasLocked ?? false;
    const handlers = scene._editorHandlers;
    if (handlers) {
      scene.input.off('dragstart', handlers.onDragStart);
      scene.input.off('drag', handlers.onDrag);
      scene.input.off('dragend', handlers.onDragEnd);
      scene.input.off('pointerdown', handlers.onPointerDown);
      scene.input.off('pointerdown', handlers.onPanPointerDown);
      scene.input.off('pointermove', handlers.onWallPointerMove);
      scene.input.off('pointermove', handlers.onPanPointerMove);
      scene.input.off('pointerup', handlers.onWallPointerUp);
      scene.input.off('pointerup', handlers.onPanPointerUp);
      scene.input.off('wheel', handlers.onWheel);
      scene.input.off('gameobjectdown', handlers.onGameObjectDown);
      if (handlers.dropTarget) {
        handlers.dropTarget.removeEventListener('dragover', handlers.onCanvasDragOver);
        handlers.dropTarget.removeEventListener('drop', handlers.onCanvasDrop);
      }
      scene._editorHandlers = null;
    }

    if (scene._interactables) {
      scene._interactables.forEach((entry) => {
        if (entry.sprite) {
          entry.sprite.setAlpha(1);
          entry.sprite.removeInteractive();
        }
      });
    }
    if (scene._wallSegments) {
      scene._wallSegments.forEach((entry) => {
        getOpenplanWalls()?.styleEntrySelection(entry, false);
        entry.handles.forEach((h) => h.destroy());
        entry.handles = [];
        entry.hit?.removeInteractive();
      });
    }
    selectedWallEntry = null;
    editorMode = 'furniture';
    wallCutMode = false;
    wallPendingType = null;
    wallTool = 'draw';
    clearWallDrawPreview();
  }

  window.DenizenDisableEditor = disableEditor;
  window.DenizenEnableEditor = enableEditor;

  // Don't lose edits if the tab closes mid-debounce
  window.addEventListener('beforeunload', () => {
    if (!layoutSaveDirty) return;
    const scene = getScene();
    if (!scene) return;
    const snap = buildPlacementSnapshot(scene);
    if (!snap) return;
    try {
      navigator.sendBeacon?.(
        '/api/layout',
        new Blob([JSON.stringify({
          catalogId: 'furniture_catalog_openplan',
          placements: snap.placements,
          walls: snap.walls || undefined,
        })], { type: 'application/json' })
      );
    } catch (_) {}
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (!layoutSaveDirty) return;
    const scene = getScene();
    if (scene) flushLayoutSave(scene, { quiet: true });
  });

  function editorAllowedByUrl() {
    const host = String(window.location.hostname || '').toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const onLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    const onDolonia = host === 'denizen.dolonia.cloud' || host.endsWith('.dolonia.cloud');
    return onLocalhost || onDolonia || params.has('editor');
  }

  function maybeAutoOpenEditor() {
    if (editorActive) return true;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('editor') || !editorAllowedByUrl()) return false;
    const scene = getScene();
    if (!scene?.sys?.isActive?.()) return false;
    enableEditor();
    return editorActive;
  }

  let autoEditorAttempts = 0;
  const autoEditorTimer = setInterval(() => {
    autoEditorAttempts += 1;
    if (maybeAutoOpenEditor() || autoEditorAttempts > 160) {
      clearInterval(autoEditorTimer);
    }
  }, 200);

  function isTypingInFormField(target) {
    const el = target || document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') return true;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    // Chat / phone / modals sometimes focus a wrapper; walk up a few levels.
    return !!el.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], .dzp-chat, .player-chat, [role="textbox"]');
  }

  document.addEventListener('keydown', (e) => {
    if (isTypingInFormField(e.target) || isTypingInFormField(document.activeElement)) return;
    // Editor toggle: Ctrl+Shift+E / Cmd+Shift+E only — never plain E.
    if ((e.key === 'e' || e.key === 'E') && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (document.documentElement.dataset.denizenModal === 'open' && editorActive) return;
      if (!editorAllowedByUrl()) return;
      e.preventDefault();
      e.stopPropagation();
      if (editorActive) disableEditor();
      else enableEditor();
      return;
    }
    if (!editorActive) return;

    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleEditorChrome();
      return;
    }

    if (e.code === 'Space' && !e.repeat) {
      spacePanning = true;
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redoEditorChange();
      else undoEditorChange();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redoEditorChange();
      return;
    }
    if ((e.ctrlKey || e.metaKey || e.altKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      if (editorMode === 'walls') duplicateSelectedWall();
      else duplicateSelectedFurniture();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && editorMode === 'furniture') {
      e.preventDefault();
      selectAllFurniture();
      return;
    }

    if (e.key === 'x' || e.key === 'X') {
      if (editorMode === 'walls') window._editorExportWalls();
      else window._editorExport();
      return;
    }

    if (editorMode === 'furniture') {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPendingCatalog(null);
        clearFurnitureSelection();
        syncInfo('Placement cancelled');
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        nudgeSelectedFurniture(e.key);
        return;
      }
      if (e.key === ',' || e.key === '<') {
        e.preventDefault();
        transformSelected({ rotationDelta: -90 });
        return;
      }
      if (e.key === '.' || e.key === '>') {
        e.preventDefault();
        transformSelected({ rotationDelta: 90 });
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        transformSelected({ rotationDelta: e.shiftKey ? -15 : 15 });
        return;
      }
      if (e.key === ']' || e.key === '=' || e.key === '+') {
        e.preventDefault();
        transformSelected({ scaleFactor: 1.1 });
        return;
      }
      if (e.key === '[' || e.key === '-' || e.key === '_') {
        e.preventDefault();
        transformSelected({ scaleFactor: 0.9 });
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        transformSelected({ flipX: true });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedFurniture();
        return;
      }
      return;
    }

    if (editorMode !== 'walls') return;
    if (e.key === 'd' || e.key === 'D') {
      duplicateSelectedWall();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelectedWall();
    }
    if (e.key === 'k' || e.key === 'K') {
      document.getElementById('ed-wall-cut-btn')?.click();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spacePanning = false;
  });

  // Public bridge for NPC-driven live furniture mutations. Exposed so
  // src/agent-office-manager.js can spawn / remove sprites in response
  // to `furniture_placed` / `furniture_removed` WS broadcasts without
  // requiring a page reload. We deliberately go through the same
  // makePlacementSprite/removeEntry pipeline the editor uses so the
  // spawned items are first-class: pathfinder obstacles get added, the
  // depth/origin rules apply, and the entry shows up in _interactables
  // for the next _sendOfficeState mirror.
  window.DenizenLiveFurniture = {
    spawn(placement) {
      const scene = getScene();
      if (!scene || !placement || !placement.id) return null;
      const entry = makePlacementSprite(scene, placement);
      if (entry) updateLayerVisibility();
      return entry;
    },
    remove(instanceId) {
      const scene = getScene();
      if (!scene || !instanceId) return false;
      const entry = scene._interactables?.find((it) => it.instanceId === instanceId);
      if (!entry) return false;
      removeEntry(scene, entry);
      return true;
    },
  };
})();
