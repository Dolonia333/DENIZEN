(function ensurePhaserGlobal() {
  if (typeof Phaser !== 'undefined') return;
  try {
    if (typeof module !== 'undefined' && module && module.exports) {
      globalThis.Phaser = module.exports.Phaser || module.exports;
    }
  } catch (_) {}
  if (typeof Phaser === 'undefined') {
    console.error('[OfficeScene] Phaser is not defined — cannot start office');
    try {
      const paint = () => {
        const el = document.getElementById('denizen-load-banner') || document.createElement('div');
        el.id = 'denizen-load-banner';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(127,29,29,0.95);color:#fecaca;text-align:center;padding:12px;font:13px ui-monospace,monospace';
        el.innerHTML = '<strong>Office engine missing</strong> — Phaser did not load. Soften Brave Shields for denizen.dolonia.cloud, then Ctrl+Shift+R. <span>(boot v4)</span>';
        if (!el.parentNode) (document.body || document.documentElement).appendChild(el);
      };
      if (document.body) paint();
      else document.addEventListener('DOMContentLoaded', paint);
    } catch (_) {}
  }
})();

function applySavedPlacementsToScene(scene, savedPlacements) {
  if (!scene || !Array.isArray(savedPlacements) || !savedPlacements.length) return;
  const byId = new Map(savedPlacements.map((p) => [p.instanceId || p.id, p]));
  scene._interactables?.forEach((entry) => {
    if (entry.parentInstanceId || !entry.sprite) return;
    const pl = byId.get(entry.instanceId);
    if (!pl) return;
    entry.sprite.x = pl.x;
    entry.sprite.y = pl.y;
    if (entry.obstacle) {
      entry.obstacle.x = pl.x;
      entry.obstacle.y = pl.y;
      if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
    }
    if (entry.def?._placement) {
      entry.def._placement.x = pl.x;
      entry.def._placement.y = pl.y;
    }
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
    if (entry.obstacle) {
      entry.obstacle.x = entry.sprite.x;
      entry.obstacle.y = entry.sprite.y;
      if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
    }
  });
  if (scene.pathfinder?.rebuildFromScene) scene.pathfinder.rebuildFromScene(scene);
}

function notifyOfficeFurnitureReady(scene) {
  if (!scene || scene._furnitureReadyNotified) return;
  if (!scene._interactables?.length) return;
  scene._furnitureReadyNotified = true;
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
    return profile?.isCompactPhone ? 2.05 : 1.95;
  }
  if (profile?.isTablet) return 1.85;
  return 2.35;
}

function createOfficeSceneClass() {
class OfficeScene extends Phaser.Scene {
  constructor() {
    super('OfficeScene');
  }

  _applyPlayfieldCamera() {
    const cam = this.cameras?.main;
    if (!cam) return;
    cam.setZoom(playfieldZoomForProfile(getPlayfieldDeviceProfile()));
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
    const catalogV = 'cat3';
    this.load.json('tiles_catalog', `./tiles-catalog.json?v=${catalogV}`);
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

    // Make EVERY Text object render at 2x internal resolution. pixelArt:true
    // forces NEAREST sampling on text textures too, so tiny 6-7px task
    // labels / speech bubbles / status indicators look blurry: Phaser
    // rasterises them at native 1x with antialiasing, then nearest-neighbor
    // downsamples → smeared glyphs. Bumping resolution to 2 makes the
    // internal raster 2x larger; the GPU downsample then preserves the
    // glyph edges cleanly. Wrap the factory so we don't have to add
    // .setResolution(2) to every single .add.text() call in the codebase.
    if (!this._textFactoryPatched) {
      const factory = this.add;
      const origText = factory.text.bind(factory);
      factory.text = function (x, y, content, style) {
        const t = origText(x, y, content, style);
        if (t && typeof t.setResolution === 'function') t.setResolution(2);
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

    const tileCatalog = this.cache.json.get('tiles_catalog') || { tiles: [] };
    const tiles = Array.isArray(tileCatalog.tiles) ? tileCatalog.tiles : [];

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

    // --- Procedural wall trim + face textures matching the reference ---
    // Reference colors sampled: trim=#3a3a50, face=#c3dee6 (lavender-blue)
    // We create simple colored canvas textures for consistent appearance.
    const makeWallTex = (key, w, h, fillFn) => {
      if (this.textures.exists(key)) this.textures.remove(key);
      const t = this.textures.createCanvas(key, w, h);
      fillFn(t.context, w, h);
      t.refresh();
    };

    // Horizontal wall trim — dark navy-blue strip (top of wall)
    makeWallTex('wall_trim_h', 32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#3a3a50';
      ctx.fillRect(0, 0, w, h);
      // Subtle bottom edge highlight
      ctx.fillStyle = '#4a4a62';
      ctx.fillRect(0, h - 2, w, 2);
    });

    // Wall face tile — lavender/blue-grey surface (body of wall)
    makeWallTex('wall_face', 32, 32, (ctx, w, h) => {
      // Base lavender
      ctx.fillStyle = '#c3d0e6';
      ctx.fillRect(0, 0, w, h);
      // Subtle horizontal line texture (like mortar lines)
      ctx.fillStyle = '#b8c4db';
      for (let y = 7; y < h; y += 8) {
        ctx.fillRect(0, y, w, 1);
      }
      // Slight vertical variation
      ctx.fillStyle = '#cddaec';
      ctx.fillRect(0, 0, w, 2);
    });

    // Vertical wall face (same color, subtle vertical mortar lines)
    makeWallTex('wall_face_v', 32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#c3d0e6';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b8c4db';
      for (let x = 7; x < w; x += 8) {
        ctx.fillRect(x, 0, 1, h);
      }
    });

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
          { x: 880, y: 320, w: 368, h: 128, tex: 'floor_rb_dark' },
          { x: 32, y: 512, w: 256, h: 144, tex: 'floor_rb_wood' },
          { x: 384, y: 512, w: 464, h: 144, tex: 'floor_rb_office' },
          { x: 880, y: 512, w: 368, h: 144, tex: 'floor_rb_dark' },
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
           if (playProfile.isPhone) {
             cam.setZoom(playfieldZoomForProfile(playProfile));
             cam.startFollow(this.player, true, 0.12, 0.12);
           } else {
             // Full openplan zone 1264×700. Zoom 1.0 fits in a 1280×720 viewport.
             cam.setZoom(playProfile.isTablet ? playfieldZoomForProfile(playProfile) : 1.0);
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
        window.OpenplanWalls.renderLayout(this, wallLayout, this._obstacles);
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
        walk_down:  { frames: [0, 1, 2, 3],   fps: 10, loop: true },
        walk_left:  { frames: [4, 5, 6, 7],   fps: 10, loop: true },
        walk_right: { frames: [8, 9, 10, 11], fps: 10, loop: true },
        walk_up:    { frames: [12, 13, 14, 15], fps: 10, loop: true },
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
        idle_down:  { frames: [20],                    fps: 1 },
        walk_right: { frames: [0, 1, 2, 3, 4, 5],     fps: 10 },
        walk_up:    { frames: [6, 7, 8, 9, 10, 11],   fps: 10 },
        walk_left:  { frames: [12, 13, 14, 15, 16, 17], fps: 10 },
        walk_down:  { frames: [18, 19, 20, 21, 22, 23], fps: 10 }
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
        walk_right: { frames: [0, 1, 2, 3, 4, 5],     fps: 10 },
        walk_up:    { frames: [6, 7, 8, 9, 10, 11],   fps: 10 },
        walk_left:  { frames: [12, 13, 14, 15, 16, 17], fps: 10 },
        walk_down:  { frames: [18, 19, 20, 21, 22, 23], fps: 10 },
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
    const scale = 1; // used by NPCs below

    // Camera: device-tier zoom, follow player, clamp to world bounds
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
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
    const npcCount = layoutParam === 'reference_office' ? 2 : Math.min(20, npcKeys.length);
    npcKeys.slice(0, npcCount).forEach((texKey, i) => {
      if (!this.textures.exists(texKey)) return;
      const spawn = i < deskSpawns.length ? deskSpawns[i] : otherSpawns[i - deskSpawns.length] || { x: Phaser.Math.Between(120, 1100), y: Phaser.Math.Between(120, 600) };
      const x = spawn.x + Phaser.Math.Between(-10, 10);
      const y = spawn.y + Phaser.Math.Between(-10, 10);
      const npc = this.physics.add.sprite(x, y, texKey, 8);
      npc.setOrigin(0.5, 1);
      npc.setScale(scale);
      npc.setCollideWorldBounds(true);
      npc.setDrag(900, 900);
      npc.body.setMaxVelocity(160, 160);
      // Shrink physics body to small foot hitbox so NPCs navigate between desks
      npc.body.setSize(10, 8);
      npc.body.setOffset(3, 16);
      npc.ai = {
        mode: 'wander',
        facing: 'right',
        nextWanderAt: 0,
        wanderTarget: { x, y },
        followOffset: { x: (i % 4) * 32 - 48, y: Math.floor(i / 4) * 28 - 28 }
      };
      npc._animKey = registerXpAnims(texKey);
      this.npcs.push(npc);
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

    const spawnLayoutExtras = (saved) => {
      const items = saved?.items;
      if (!Array.isArray(items) || !items.length || !window.DenizenLiveFurniture?.spawn) return;
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
          const depth = typeof def.depth === 'number' ? def.depth : 1.5;
          const originY = def.origin === 'center' ? 0.5 : 1;
          const s = this.add.image(pl.x, pl.y, texKey).setOrigin(0.5, originY).setDepth(depth);
          if (def.source_type === 'single_file') {
            const dw = def.display_w || 32;
            const dh = def.display_h || 48;
            s.setDisplaySize(dw, dh);
          }
          this.furnitureDecorSprites.push({ sprite: s, depth });
          const instanceId = pl.instanceId || pl.id;
          this._placedCatalogSprites[instanceId] = s;
          const interactable = { id: pl.id, instanceId, sprite: s, def: { ...def, _placement: pl }, obstacle: null, parentInstanceId: null };

          // Auto-collision box: only large furniture blocks movement (not chairs/seats/small items).
          // Cap collision width at 64px to prevent wide desk groups from creating invisible walls.
          // Also allow walking around couches/sofas in break/reception areas.
          const idLower = String(pl.id || '').toLowerCase();
          const isSofaLike = /couch|sofa|bench/i.test(idLower);
          if (!isSofaLike && def.type !== 'decor' && def.type !== 'seat' && s.displayWidth >= 48) {
            const collW = Math.min(s.displayWidth, 64);
            const obstacle = this.add.rectangle(pl.x, pl.y, collW, 16, 0x000000, 0);
            obstacle.setOrigin(0.5, 1);
            this.physics.add.existing(obstacle, true);
            this._obstacles.push(obstacle);
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
          const depth = typeof def.depth === 'number' ? def.depth : 2;
          const originY = def.origin === 'center' ? 0.5 : 1;
          const s = this.add.image(parentSprite.x, parentSprite.y + offsetY, texKey).setOrigin(0.5, originY).setDepth(depth);
          if (def.source_type === 'single_file') {
            const dw = def.display_w || 32;
            const dh = def.display_h || 48;
            s.setDisplaySize(dw, dh);
          }
          this.furnitureDecorSprites.push({ sprite: s, depth });
          const instanceId = pl.instanceId || pl.id;
          this._interactables.push({ id: pl.id, instanceId, sprite: s, def: { ...def, _placement: pl }, obstacle: null, parentInstanceId: pl.parentInstanceId || null });
        });

        // Fix decor depth: ensure decor items (laptops, monitors, etc.) render above
        // any surface (desk) they visually sit on. Checks if decor is above and near a surface.
        const surfaces = this._interactables.filter(it => it.def?.type === 'surface');
        const decors = this._interactables.filter(it => it.def?.type === 'decor');
        decors.forEach(decor => {
          if (!decor.sprite) return;
          const dx = decor.sprite.x, dy = decor.sprite.y;
          surfaces.forEach(surf => {
            if (!surf.sprite) return;
            const sx = surf.sprite.x, sy = surf.sprite.y;
            const sw = surf.sprite.displayWidth / 2 + 40;
            // Decor is above the surface (up to 100px) and horizontally overlapping
            if (Math.abs(dx - sx) < sw && dy < sy && dy > sy - 100) {
              if (decor.sprite.depth <= surf.sprite.depth) {
                decor.sprite.setDepth(surf.sprite.depth + 0.5);
              }
            }
          });
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

          const depth = typeof def.depth === 'number' ? def.depth : 1.5;
          const originY = def.origin === 'center' ? 0.5 : 1;
          let x = pl.x;
          let y = pl.y;
          if (pl.parentInstanceId) {
            const parentSprite = this._placedCatalogSprites[pl.parentInstanceId];
            if (!parentSprite) return;
            const offsetY = pl.parent_offset_y !== undefined ? pl.parent_offset_y : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
            x = parentSprite.x;
            y = parentSprite.y + offsetY;
          }
          const s = this.add.image(x, y, texKey).setOrigin(0.5, originY).setDepth(depth);
          s.setDisplaySize(def.display_w || 32, def.display_h || 48);
          this.furnitureDecorSprites.push({ sprite: s, depth });
          this._placedCatalogSprites[instanceId] = s;
          this._interactables.push({
            id: pl.id,
            instanceId,
            sprite: s,
            def: { ...def, _placement: pl },
            obstacle: null,
            parentInstanceId: pl.parentInstanceId || null
          });
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

    if (furnitureCatalog) {
      fetch(layoutUrl)
        .then((r) => (r.ok ? r.json() : null))
        .then((saved) => {
          const savedPlacements = Array.isArray(saved?.placements) ? saved.placements : null;
          const use = savedPlacements?.length ? savedPlacements : defaultPlacements;
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

    // Hook up collisions: player + NPCs vs furniture obstacles. Decor stays non-blocking.
    if (Array.isArray(this._obstacles) && this._obstacles.length > 0) {
      this._obstacles.forEach((o) => {
        this.physics.add.collider(this.player, o);
        if (Array.isArray(this.npcs)) this.npcs.forEach((npc) => this.physics.add.collider(npc, o));
      });
    }

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
    this.worldClock = new WorldClock({ startHour: 9, startMinute: 0, tickMs: 2000 });
    this.timeText = this.add.text(16, 44, `Time: ${this.worldClock.toString()}`, {
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
      fontSize: '14px',
      color: '#e5e7eb'
    }).setDepth(1000).setScrollFactor(0);

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
      if (window.WorkFeedPanel) {
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

    // --- Demo Mode ---
    // Two scenarios:
    //   ?demo=investor  — original 20s research vignette
    //   ?demo=tour      — 60s feature tour with voice + agent-bus + threats + n8n tasks
    const demoParams = new URLSearchParams(window.location.search);
    const demoKind = demoParams.get('demo');
    if (demoKind) {
      const startDemo = () => {
        if (!window.DemoScene) return;
        const demo = new window.DemoScene(this, this._agentManager);
        if (demoKind === 'tour' && typeof demo.startTour === 'function') {
          demo.startTour();
          console.log('[OfficeScene] 60s tour triggered via ?demo=tour');
        } else {
          demo.start();
          console.log(`[OfficeScene] Investor demo triggered via ?demo=${demoKind}`);
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
      // cellSize omitted — defaults to 8 in pathfinding.js (finer paths).
      this._pathfinder = new window.OfficePathfinder(1280, 720);
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
        this._playerPathFollower = new window.NpcPathFollower(this.player, this._pathfinder);
        this._installTapToMove();
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
      if (typeof window.DenizenDisableEditor === 'function') window.DenizenDisableEditor();
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
      try {
        window.DenizenMovementGuard?.unlock?.();
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
    this.input.on('pointerdown', (pointer, gameObjects) => {
      if (!window.__DenizenIsTouch) return;
      if (document.documentElement.classList.contains('denizen-portrait-blocked')) return;
      if (this.playerLocked || this._editorHandlers) return;
      if (document.documentElement.classList.contains('denizen-chat-open')) return;
      const hitNpc = gameObjects?.some((go) => Array.isArray(this.npcs) && this.npcs.includes(go));
      if (hitNpc) return;
      if (this._playerPathFollower?.navigateTo(pointer.worldX, pointer.worldY)) {
        window.DenizenHaptics?.tap?.();
        if (window.DenizenMobilePlay?.useTapMove?.()) {
          this._showTapMarker(pointer.worldX, pointer.worldY);
        }
      }
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
    const speed = 220;
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
    const speed = 220;
    const body = this.player?.body;
    const hasPlayer = !!body;

    // World clock tick + late-night hint
    if (this.worldClock && this.worldClock.update(this.game.loop.delta)) {
      if (this.timeText) this.timeText.setText(`Time: ${this.worldClock.toString()}`);
      if (this.worldClock.isLate() && this._bedInteractable?.sprite) {
        // highlight bed (simple pulse tint)
        const t = (this.time.now % 600) / 600;
        const on = t < 0.5;
        this._bedInteractable.sprite.setTint(on ? 0xfff3b0 : 0xffffff);
        if (!this._didYawn) {
          this._didYawn = true;
          this.showNpcDialog('Adam', 'Yawn... It’s getting late. Maybe I should sleep.');
        }
      }
    }

    // Automated Z-sorting (Y-sorting): only runs when _depthDirty is true.
    // Mark dirty whenever the player or any NPC is moving (non-zero velocity).
    if (!this._depthDirty) {
      const pv = this.player?.body?.velocity;
      if (pv && (Math.abs(pv.x) > 1 || Math.abs(pv.y) > 1)) {
        this._depthDirty = true;
      } else if (Array.isArray(this.npcs)) {
        for (const npc of this.npcs) {
          const v = npc.body?.velocity;
          if (v && (Math.abs(v.x) > 1 || Math.abs(v.y) > 1)) { this._depthDirty = true; break; }
        }
      }
    }
    if (this._depthDirty) {
      this._depthDirty = false;
      const isCharacter = (s) => s === this.player || (Array.isArray(this.npcs) && this.npcs.includes(s));
      const sittingNpcSet = this._agentActions?._sittingNpcs || new Map();
      const isSittingNpc = (s) => {
        if (!isCharacter(s) || s === this.player) return false;
        const key = s.texture?.key;
        return key && sittingNpcSet.has(key);
      };
      const sortY = (s) => {
        const baseY = s.y + (s.displayHeight * (1 - s.originY));
        return isCharacter(s) ? baseY + 1 : baseY;
      };
      const sortable = [];
      if (this.player) sortable.push(this.player);
      if (Array.isArray(this.npcs)) sortable.push(...this.npcs);
      if (Array.isArray(this.furnitureDecorSprites)) sortable.push(...this.furnitureDecorSprites.map((e) => e.sprite).filter(Boolean));
      sortable.sort((a, b) => sortY(a) - sortY(b));
      sortable.forEach((s, i) => {
        if (isSittingNpc(s)) return;
        s.setDepth(10 + i);
      });
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

    // --- NPC AI ---
    const lightOffice = window.__DenizenLightOffice !== false
      && this._agentManager?._officeConfig?.lightOffice !== false;
    if (Array.isArray(this.npcs) && !lightOffice) {
      const now = this.time.now;
      const followDistance = 44;
      const followSpeed = 140;
      const wanderSpeed = 90;

      // #1 — Separation steering. For each walking NPC we add a small repulsion
      // from any neighbor within SEP_RADIUS px. Stationary NPCs (sitting,
      // working, reading) are ignored as neighbors so you can still walk up to
      // talk to someone at their desk.
      const SEP_RADIUS = 24;
      const SEP_RADIUS_SQ = SEP_RADIUS * SEP_RADIUS;
      const SEP_STRENGTH = 55; // px/s max repulsion magnitude
      const _applySeparation = (npc, vx, vy) => {
        let sx = 0, sy = 0;
        for (let j = 0; j < this.npcs.length; j++) {
          const other = this.npcs[j];
          if (!other || other === npc) continue;
          const oai = other.ai;
          // Don't push AWAY from seated targets — we want to be ABLE to approach them.
          if (oai && (oai.taskState === 'sitting' || oai.taskState === 'working' || oai.taskState === 'reading')) continue;
          const dx = npc.x - other.x;
          const dy = npc.y - other.y;
          const dsq = dx * dx + dy * dy;
          if (dsq === 0 || dsq > SEP_RADIUS_SQ) continue;
          const d = Math.sqrt(dsq);
          // Falloff: closer = stronger, scaled to SEP_STRENGTH at d=0, 0 at d=SEP_RADIUS
          const strength = (1 - d / SEP_RADIUS) * SEP_STRENGTH;
          sx += (dx / d) * strength;
          sy += (dy / d) * strength;
        }
        return { vx: vx + sx, vy: vy + sy };
      };

      this.npcs.forEach((npc, idx) => {
        const ai = npc.ai;
        if (!ai) return;

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
                ai.nextWanderAt = now + 2000;
              }
            } else if (ai.mode === 'wander') {
              ai.wanderTarget = null;
              ai.nextWanderAt = now + 1000;
            }
          } else if (ai._physicsStuckTime > 200) {
            // Nudge perpendicular to the blocked direction
            const nudge = 20;
            if (b.left || b.right) {
              npc.y += (Math.random() > 0.5 ? nudge : -nudge);
            }
            if (b.up || b.down) {
              npc.x += (Math.random() > 0.5 ? nudge : -nudge);
            }
            // Force repath
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
        const wantsToMove = (ai.mode === 'wander') || (ai.mode === 'agent_task' && ai.taskState === 'walking');
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
                npc.body.setVelocity(sep.vx, sep.vy);
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
              npc.body.setVelocity(sep.vx, sep.vy);
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
                npc.body.setVelocity(sep.vx, sep.vy);
              } else {
                npc.body.setVelocity(0, 0);
              }
            } else {
              const rawVx = ((targetX - npc.x) / dist) * followSpeed;
              const rawVy = ((targetY - npc.y) / dist) * followSpeed;
              const sep = _applySeparation(npc, rawVx, rawVy);
              npc.body.setVelocity(sep.vx, sep.vy);
            }
          } else {
            npc.body.setVelocity(0, 0);
            if (pf) pf.stop();
          }
        } else {
          const npcKey = npc.texture?.key;
          const deskAgent = npcKey ? this._agentManager?.agents?.get(npcKey) : null;
          if (deskAgent?.assignedDesk && deskAgent.status === 'working' && ai.mode === 'wander') {
            ai.mode = 'agent_task';
            ai.taskState = 'walking';
            ai.taskTarget = ai._assignedDeskPos || deskAgent._assignedDeskPos || ai.taskTarget;
            npc.body.setVelocity(0, 0);
          } else {
          // Wander mode — pick a new random walkable destination
          if (now >= ai.nextWanderAt) {
            ai.nextWanderAt = now + Phaser.Math.Between(2200, 5800);
            let target = null;

            if (this._pathfinder) {
              // Prefer smart sampling away from current position
              target = this._pathfinder.sampleSafeWalkTarget(npc.x, npc.y, 160, 16);
            }
            if (!target) {
              // Fallback old random + snap — allow lower y for breakroom/reception
              let wx = Phaser.Math.Between(140, 1140);
              let wy = Phaser.Math.Between(170, 620);
              if (this._pathfinder) {
                const s = this._pathfinder.findWalkableNear(wx, wy, 48);
                if (s) target = s;
              }
              if (!target) target = { x: wx, y: wy };
            }
            ai.wanderTarget = target;
            if (usePathfinding) {
              const found = pf.navigateTo(target.x, target.y);
              if (!found) {
                // Path impossible even after smart pick — pick again very soon + jitter
                ai.nextWanderAt = now + 280;
                const jx = (Math.random() - 0.5) * 18;
                const jy = (Math.random() - 0.5) * 18;
                npc.x = Phaser.Math.Clamp(npc.x + jx, 60, 1220);
                npc.y = Phaser.Math.Clamp(npc.y + jy, 80, 640);
              }
            }
          }

          if (usePathfinding && pf.isNavigating()) {
            const vel = pf.update(wanderSpeed, delta);
            if (vel) {
              const sep = _applySeparation(npc, vel.vx, vel.vy);
              npc.body.setVelocity(sep.vx, sep.vy);
            } else {
              // Arrived or path lost — pick a new target soon
              npc.body.setVelocity(0, 0);
              ai.nextWanderAt = Math.min(ai.nextWanderAt || 0, now + 420);
            }
          } else if (!usePathfinding) {
            const dx = ai.wanderTarget.x - npc.x;
            const dy = ai.wanderTarget.y - npc.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 12) {
              const rawVx = (dx / dist) * wanderSpeed;
              const rawVy = (dy / dist) * wanderSpeed;
              const sep = _applySeparation(npc, rawVx, rawVy);
              npc.body.setVelocity(sep.vx, sep.vy);
            } else {
              npc.body.setVelocity(0, 0);
            }
          } else {
            // Not navigating (path failed) — pick a new target soon
            npc.body.setVelocity(0, 0);
            ai.nextWanderAt = Math.min(ai.nextWanderAt || 0, now + 420);
          }
          }
        }

        // Animations based on velocity
        const vx = npc.body.velocity.x;
        const vy = npc.body.velocity.y;
        const npcMoving = Math.abs(vx) > 2 || Math.abs(vy) > 2;
        if (npcMoving) {
          if (Math.abs(vx) > Math.abs(vy)) {
            ai.facing = vx < 0 ? 'left' : 'right';
          } else {
            ai.facing = vy < 0 ? 'up' : 'down';
          }
          if (ai.facing === 'up') npc.anims.play(npc._animKey('walk_up'), true);
          else if (ai.facing === 'down') npc.anims.play(npc._animKey('walk_down'), true);
          else if (ai.facing === 'left') npc.anims.play(npc._animKey('walk_left'), true);
          else npc.anims.play(npc._animKey('walk_right'), true);
        } else {
          // idle frames: up=12 down=0 left=4 right=8
          // Skip redundant setFrame() calls — only update when facing changes
          const idleFrame = ai.facing === 'up' ? 12 : ai.facing === 'down' ? 0 : ai.facing === 'left' ? 4 : 8;
          if (npc.frame?.name !== idleFrame) {
            npc.setFrame(idleFrame);
            npc.anims.stop();
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
      this._agentManager.update();
    }

    // Update player chat bubbles
    if (this._playerChat) {
      this._playerChat.updateBubbles();
    }

    // Update robber controller (security threat visualization)
    if (this._robberCtrl) {
      this._robberCtrl.update(this.time.now, delta);
    }
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
  const config = {
    type: useCanvas ? Phaser.CANVAS : Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: document.getElementById('game-container') || 'game-container',
    backgroundColor: '#020617',
    pixelArt: true,
    scale: {
      pauseOnBlur: false,
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
// Editor: Ctrl+Shift+E (localhost) or plain E when ?editor=1 is in the URL.
// Double-click a placed sprite to delete it. Press X to export the updated placements.
(function() {
  if (typeof Phaser === 'undefined' || !window.game) return;
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

  function getScene() {
    return window.game?.scene?.scenes?.[0];
  }

  function getCatalog(scene) {
    return scene?.cache?.json?.get('furniture_catalog_openplan') || null;
  }

  function clonePlacements(placements) {
    return JSON.parse(JSON.stringify(Array.isArray(placements) ? placements : []));
  }

  function initEditorState(scene) {
    if (scene._editorState) return scene._editorState;
    const catalog = getCatalog(scene);
    scene._editorState = {
      placements: clonePlacements(catalog?.placements),
      nextId: 1,
      pendingCatalogId: null
    };
    return scene._editorState;
  }

  function syncInfo(text) {
    const info = document.getElementById('ed-info');
    if (info) info.textContent = text;
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
    syncInfo('Exported openplan_walls.json — paste into data/openplan_walls.json');
  };

  function setEditorMode(mode) {
    editorMode = mode === 'walls' ? 'walls' : 'furniture';
    const scene = getScene();
    const catPanel = document.getElementById('editor-catalog');
    const wallPanel = document.getElementById('editor-wall-tools');
    const tabF = document.getElementById('ed-tab-furniture');
    const tabW = document.getElementById('ed-tab-walls');
    if (catPanel) catPanel.style.display = editorMode === 'furniture' ? 'flex' : 'none';
    if (wallPanel) wallPanel.style.display = editorMode === 'walls' ? 'flex' : 'none';
    if (tabF) tabF.classList.toggle('active', editorMode === 'furniture');
    if (tabW) tabW.classList.toggle('active', editorMode === 'walls');
    wallCutMode = false;
    clearWallDrawPreview();
    if (editorMode === 'walls') {
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
      syncInfo('Drag a catalog sprite into the room or click to place.');
    }
  }

  function setPendingCatalog(id) {
    const scene = getScene();
    if (!scene) return;
    const state = initEditorState(scene);
    state.pendingCatalogId = id || null;
    const selected = document.getElementById('ed-selected');
    if (selected) {
      selected.textContent = state.pendingCatalogId
        ? `Selected: ${state.pendingCatalogId} (${getCatalog(scene)?.objects?.[state.pendingCatalogId]?.type || 'unknown'})`
        : 'Selected: none';
    }
    document.querySelectorAll('#ed-catalog-list .cat-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.catalogId === state.pendingCatalogId);
    });
  }

  function getCanvasWorldPoint(scene, clientX, clientY) {
    const canvas = scene?.game?.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return scene.cameras.main.getWorldPoint(screenX, screenY);
  }

  function snapCoord(value) {
    return window._editorSnap ? Math.round(value / 4) * 4 : Math.round(value);
  }

  function ensureCatalogTexture(scene, catalogId, def) {
    if (!scene || !def) return null;
    if (def.source_type === 'single_file') {
      const singleKey = `single_${catalogId}`;
      return scene.textures.exists(singleKey) ? singleKey : null;
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

  function buildCatalogPreview(scene, catalogId, def) {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 48, 48);

    if (def.source_type === 'single_file') {
      const singleKey = `single_${catalogId}`;
      if (scene.textures.exists(singleKey)) {
        const img = scene.textures.get(singleKey).getSourceImage();
        const scale = Math.min(40 / img.width, 40 / img.height, 1);
        const dw = Math.max(1, Math.round(img.width * scale));
        const dh = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, Math.round((48 - dw) / 2), Math.round((48 - dh) / 2), dw, dh);
      }
      return canvas;
    }

    const sheetKey = def.sheet;
    if (!sheetKey || !scene.textures.exists(sheetKey)) return canvas;
    const img = scene.textures.get(sheetKey).getSourceImage();
    const sx = def.rect ? def.rect.x : (def.x || 0);
    const sy = def.rect ? def.rect.y : (def.y || 0);
    const sw = Math.max(1, def.rect ? def.rect.w : (def.w || 16));
    const sh = Math.max(1, def.rect ? def.rect.h : (def.h || 16));
    const scale = Math.min(40 / sw, 40 / sh, 1);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    ctx.drawImage(img, sx, sy, sw, sh, Math.round((48 - dw) / 2), Math.round((48 - dh) / 2), dw, dh);
    return canvas;
  }

  function renderCatalogList() {
    const scene = getScene();
    const list = document.getElementById('ed-catalog-list');
    if (!scene || !list) return;
    const catalog = getCatalog(scene);
    const state = initEditorState(scene);
    const query = (document.getElementById('ed-search')?.value || '').trim().toLowerCase();
    const entries = Object.entries(catalog?.objects || {})
      .filter(([id, def]) => {
        if (!query) return true;
        return id.toLowerCase().includes(query) || (def.type || '').toLowerCase().includes(query);
      })
      .sort((a, b) => a[0].localeCompare(b[0]));

    list.innerHTML = '';
    entries.forEach(([id, def]) => {
      const item = document.createElement('div');
      item.className = 'cat-item';
      item.dataset.catalogId = id;
      item.draggable = true;
      if (state.pendingCatalogId === id) item.classList.add('active');
      item.appendChild(buildCatalogPreview(scene, id, def));

      const meta = document.createElement('div');
      meta.className = 'cat-meta';
      meta.innerHTML = `<div class="cat-name">${id}</div><div class="cat-type">${def.type || 'unknown'}</div>`;
      item.appendChild(meta);

      item.addEventListener('click', () => setPendingCatalog(id));
      item.addEventListener('dragstart', (event) => {
        setPendingCatalog(id);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', id);
      });
      list.appendChild(item);
    });
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
          z-index: 9999;
          font-family: 'Segoe UI', system-ui, sans-serif;
          color: #fff;
        }
        #editor-toolbar {
          pointer-events: auto;
          position: fixed;
          top: 0;
          left: 0;
          right: 320px;
          height: 38px;
          background: rgba(233, 69, 96, 0.96);
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          font-size: 12px;
        }
        #editor-toolbar .title { font-weight: 700; font-size: 14px; }
        #editor-toolbar .info,
        #editor-toolbar .selected {
          background: rgba(0, 0, 0, 0.28);
          padding: 2px 8px;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }
        #editor-toolbar button,
        #editor-toolbar select,
        #editor-toolbar input {
          background: rgba(0, 0, 0, 0.32);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 11px;
        }
        #editor-toolbar button { cursor: pointer; }
        #editor-toolbar .spacer { margin-left: auto; opacity: 0.72; }
        #editor-mode-tabs { display: flex; gap: 4px; }
        #editor-mode-tabs button.active {
          background: rgba(253, 224, 71, 0.35);
          border-color: rgba(253, 224, 71, 0.9);
        }
        #editor-wall-tools {
          pointer-events: auto;
          position: fixed;
          top: 0;
          right: 0;
          width: 320px;
          height: 100vh;
          background: rgba(15, 23, 42, 0.96);
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          display: none;
          flex-direction: column;
          padding: 12px;
          gap: 10px;
        }
        #editor-wall-tools button {
          background: rgba(0, 0, 0, 0.32);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 12px;
          cursor: pointer;
          text-align: left;
        }
        #editor-wall-tools button.active-tool {
          border-color: rgba(253, 224, 71, 0.9);
          background: rgba(253, 224, 71, 0.14);
        }
        #editor-wall-tools .wall-help {
          font-size: 11px;
          opacity: 0.75;
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
            rgba(253,224,71,0.25),
            rgba(253,224,71,0.25) 6px,
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
          border-color: rgba(253,224,71,0.85);
          background: rgba(253,224,71,0.12);
        }
        .wall-list-item.dimmed {
          opacity: 0.38;
        }
        #ed-wall-layer {
          width: 100%;
          margin-top: 6px;
          padding: 6px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.25);
          color: #e2e8f0;
          font-size: 12px;
        }
        .wall-click-help {
          font-size: 10px;
          opacity: 0.72;
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
          width: 26px;
          height: 26px;
          border-radius: 4px;
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
          top: 0;
          right: 0;
          width: 320px;
          height: 100vh;
          background: rgba(15, 23, 42, 0.96);
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
        }
        #editor-catalog-head {
          padding: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: grid;
          gap: 8px;
        }
        #ed-catalog-list {
          overflow: auto;
          padding: 10px;
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr;
        }
        .cat-item {
          display: grid;
          grid-template-columns: 52px 1fr;
          gap: 10px;
          align-items: center;
          padding: 8px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          cursor: grab;
          user-select: none;
        }
        .cat-item.active {
          border-color: rgba(253, 224, 71, 0.9);
          background: rgba(253, 224, 71, 0.14);
        }
        .cat-item canvas {
          width: 48px;
          height: 48px;
          image-rendering: pixelated;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 6px;
        }
        .cat-name {
          font-size: 12px;
          font-weight: 600;
          word-break: break-word;
        }
        .cat-type {
          font-size: 11px;
          opacity: 0.7;
          margin-top: 2px;
        }
      </style>
      <div id="editor-toolbar">
        <span class="title">EDITOR</span>
        <div id="editor-mode-tabs">
          <button type="button" id="ed-tab-furniture" class="active">Furniture</button>
          <button type="button" id="ed-tab-walls">Walls</button>
        </div>
        <span class="info" id="ed-info">Drag a catalog sprite into the room or click to place.</span>
        <span class="selected" id="ed-selected">Selected: none</span>
        <select id="ed-layer">
          <option value="all">All Layers</option>
          <option value="surface">Desks</option>
          <option value="seat">Chairs</option>
          <option value="partition">Dividers</option>
          <option value="decor">Decor/Monitors</option>
          <option value="furniture">Furniture</option>
        </select>
        <button id="ed-export-btn">Export (X)</button>
        <button id="ed-workflow-btn" title="Open workflow dashboard">Workflow</button>
        <button id="ed-snap-btn">Snap: ON</button>
        <button id="ed-clear-btn">Clear Selection</button>
        <button id="ed-collision-btn" style="background:#e74c3c;">Show Collisions</button>
        <span class="spacer">E=editor (localhost) | Ctrl+Shift+E or ?editor+E | X=export</span>
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
        <button type="button" id="ed-wall-export-btn">Export walls JSON (X)</button>
      </aside>
      <aside id="editor-catalog">
        <div id="editor-catalog-head">
          <div style="font-weight:700;">Catalog</div>
          <input id="ed-search" type="text" placeholder="Search by id or type" />
        </div>
        <div id="ed-catalog-list"></div>
      </aside>
    `;
    document.body.appendChild(editorUI);

    document.getElementById('ed-layer').addEventListener('change', (event) => {
      layerFilter = event.target.value;
      updateLayerVisibility();
    });
    document.getElementById('ed-search').addEventListener('input', renderCatalogList);
    document.getElementById('ed-tab-furniture').addEventListener('click', () => setEditorMode('furniture'));
    document.getElementById('ed-tab-walls').addEventListener('click', () => setEditorMode('walls'));
    document.getElementById('ed-export-btn').addEventListener('click', () => {
      if (editorMode === 'walls') window._editorExportWalls();
      else window._editorExport();
    });
    document.getElementById('ed-workflow-btn')?.addEventListener('click', () => {
      window.open('/workflow-dashboard.html', '_blank');
    });
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
      event.currentTarget.textContent = `Snap: ${window._editorSnap ? 'ON' : 'OFF'}`;
    });
    document.getElementById('ed-clear-btn').addEventListener('click', () => setPendingCatalog(null));

    // Collision box visualization toggle
    let collisionVisible = false;
    let collisionGraphics = null;
    document.getElementById('ed-collision-btn').addEventListener('click', (event) => {
      const scene = getScene();
      if (!scene) return;
      collisionVisible = !collisionVisible;
      event.currentTarget.textContent = collisionVisible ? 'Hide Collisions' : 'Show Collisions';
      event.currentTarget.style.background = collisionVisible ? '#27ae60' : '#e74c3c';

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

  function updateLayerVisibility() {
    const scene = getScene();
    if (!scene || !scene._interactables) return;
    scene._interactables.forEach(it => {
      if (!it.sprite || !it.def) return;
      if (layerFilter === 'all') {
        it.sprite.setAlpha(1);
      } else if (it.def.type === layerFilter) {
        it.sprite.setAlpha(1);
      } else {
        it.sprite.setAlpha(0.2);
      }
    });
  }

  window._editorSnap = true;

  function addObstacle(scene, sprite, def) {
    if (def.type === 'decor' || def.type === 'seat' || sprite.displayWidth < 48) return null;
    const obstacle = scene.add.rectangle(sprite.x, sprite.y, sprite.displayWidth, 16, 0x000000, 0);
    obstacle.setOrigin(0.5, 1);
    scene.physics.add.existing(obstacle, true);
    scene._obstacles.push(obstacle);
    return obstacle;
  }

  function removeObstacle(scene, obstacle) {
    if (!obstacle) return;
    if (Array.isArray(scene._obstacles)) {
      scene._obstacles = scene._obstacles.filter((item) => item !== obstacle);
    }
    obstacle.destroy();
  }

  function makePlacementSprite(scene, placement) {
    const catalog = getCatalog(scene);
    const def = catalog?.objects?.[placement.id];
    if (!def) return null;
    const texKey = ensureCatalogTexture(scene, placement.id, def);
    if (!texKey) return null;

    const isChild = !!placement.parentInstanceId;
    let x = placement.x;
    let y = placement.y;
    if (isChild) {
      const parentSprite = scene._placedCatalogSprites[placement.parentInstanceId];
      if (!parentSprite) return null;
      const offsetY = placement.parent_offset_y !== undefined
        ? placement.parent_offset_y
        : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
      x = parentSprite.x;
      y = parentSprite.y + offsetY;
    }

    const depth = typeof def.depth === 'number' ? def.depth : (isChild ? 2 : 1.5);
    const originY = def.origin === 'center' ? 0.5 : 1;
    const sprite = scene.add.image(x, y, texKey).setOrigin(0.5, originY).setDepth(depth);
    if (def.source_type === 'single_file') {
      sprite.setDisplaySize(def.display_w || 32, def.display_h || 48);
    }
    scene.furnitureDecorSprites.push({ sprite, depth });

    const instanceId = placement.instanceId || placement.id;
    const obstacle = isChild ? null : addObstacle(scene, sprite, def);
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
    if (!def) return null;

    const state = initEditorState(scene);
    const placement = {
      id: catalogId,
      instanceId: `editor_${catalogId}_${state.nextId++}`,
      x: snapCoord(worldX),
      y: snapCoord(worldY)
    };
    state.placements.push(placement);
    const entry = makePlacementSprite(scene, placement);
    if (entry) {
      selectedSprite = entry.sprite;
      syncInfo(`Placed ${catalogId} at x:${placement.x} y:${placement.y}`);
    }
    return entry;
  }

  function prepareSpriteForEditing(scene, entry) {
    if (!entry?.sprite) return;
    entry.sprite.removeInteractive();
    if (entry.parentInstanceId) {
      entry.sprite.setInteractive({ useHandCursor: true });
      return;
    }
    entry.sprite.setInteractive({ draggable: true, useHandCursor: true });
  }

  let saveLayoutTimer = null;

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
      };
    });
    return { catalog, placements: updated };
  }

  function persistLayoutPlacements(scene, { quiet = false } = {}) {
    const snap = buildPlacementSnapshot(scene);
    if (!snap) return Promise.resolve(false);
    const body = JSON.stringify({
      catalogId: 'furniture_catalog_openplan',
      placements: snap.placements,
    });
    return fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).then((r) => {
      if (r.ok) {
        if (!quiet) syncInfo('Layout saved to server');
        return true;
      }
      if (!quiet) syncInfo('Failed to save layout to server');
      return false;
    }).catch(() => {
      if (!quiet) syncInfo('Failed to save layout to server');
      return false;
    });
  }

  function scheduleLayoutSave(scene) {
    clearTimeout(saveLayoutTimer);
    saveLayoutTimer = setTimeout(() => persistLayoutPlacements(scene, { quiet: true }), 600);
  }

  window.DenizenSaveLayout = function(options = {}) {
    const scene = getScene();
    if (!scene) return Promise.resolve(false);
    return persistLayoutPlacements(scene, { quiet: !!options.quiet });
  };

  window._editorExport = function() {
    const scene = getScene();
    if (!scene) return;
    const snap = buildPlacementSnapshot(scene);
    if (!snap) return;
    const output = JSON.stringify({ ...snap.catalog, placements: snap.placements }, null, 2);

    persistLayoutPlacements(scene);

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
    if (!Array.isArray(scene._interactables)) scene._interactables = [];
    editorActive = true;
    window.__DenizenEditorActive = true;
    initEditorState(scene);
    createEditorUI();
    renderCatalogList();

    scene._editorWasLocked = scene.playerLocked;
    scene.playerLocked = true;

    scene._interactables.forEach((entry) => prepareSpriteForEditing(scene, entry));

    const isFurnitureSprite = (gameObject) => (
      editorMode === 'furniture'
      && scene._interactables?.some((item) => item.sprite === gameObject)
    );

    const onDragStart = (pointer, gameObject) => {
      if (!isFurnitureSprite(gameObject)) return;
      selectedSprite = gameObject;
      if (typeof gameObject.setTint === 'function') gameObject.setTint(0x00ff00);
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      if (entry) {
        syncInfo(`${entry.id} [${entry.instanceId}] x:${Math.round(gameObject.x)} y:${Math.round(gameObject.y)}`);
      }
    };

    const onDrag = (pointer, gameObject, dragX, dragY) => {
      if (!isFurnitureSprite(gameObject)) return;
      if (window._editorSnap) {
        gameObject.x = snapCoord(dragX);
        gameObject.y = snapCoord(dragY);
      } else {
        gameObject.x = dragX;
        gameObject.y = dragY;
      }
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      if (entry) {
        syncInfo(`${entry.id} [${entry.instanceId}] x:${Math.round(gameObject.x)} y:${Math.round(gameObject.y)}`);
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

        initEditorState(scene).placements.forEach((placementItem) => {
          if (placementItem.parentInstanceId === entry.instanceId) {
            const childEntry = scene._interactables.find((item) => item.instanceId === (placementItem.instanceId || placementItem.id));
            if (childEntry && childEntry.sprite) {
              const def = childEntry.def || {};
              const offsetY = placementItem.parent_offset_y !== undefined
                ? placementItem.parent_offset_y
                : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
              childEntry.sprite.x = gameObject.x;
              childEntry.sprite.y = gameObject.y + offsetY;
              if (childEntry.obstacle) {
                childEntry.obstacle.x = childEntry.sprite.x;
                childEntry.obstacle.y = childEntry.sprite.y;
                if (childEntry.obstacle.body) childEntry.obstacle.body.updateFromGameObject();
              }
            }
          }
        });
      }
    };

    const onDragEnd = (pointer, gameObject) => {
      if (!isFurnitureSprite(gameObject)) return;
      if (typeof gameObject.clearTint === 'function') gameObject.clearTint();
      scene._agentManager?.refreshDeskAnchorsAfterLayoutChange?.();
      scheduleLayoutSave(scene);
    };

    const onWallPointerMove = (pointer) => {
      if (!editorActive || editorMode !== 'walls' || !wallDrawStart) return;
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
        removeEntry(scene, entry);
        lastPointerTarget = null;
        lastPointerAt = 0;
        return;
      }
      lastPointerTarget = gameObject;
      lastPointerAt = now;
      selectedSprite = gameObject;
      syncInfo(`${entry.id} [${entry.instanceId}] x:${Math.round(gameObject.x)} y:${Math.round(gameObject.y)}`);
    };

    const canvas = scene.game?.canvas;
    const onCanvasDragOver = (event) => {
      if (!editorActive) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onCanvasDrop = (event) => {
      if (!editorActive) return;
      event.preventDefault();
      const catalogId = event.dataTransfer.getData('text/plain');
      if (!catalogId) return;
      const point = getCanvasWorldPoint(scene, event.clientX, event.clientY);
      if (!point) return;
      addCatalogPlacement(scene, catalogId, point.x, point.y);
    };

    scene._editorHandlers = {
      onDragStart, onDrag, onDragEnd, onPointerDown, onGameObjectDown,
      onCanvasDragOver, onCanvasDrop, onWallPointerMove, onWallPointerUp,
    };
    scene.input.on('dragstart', onDragStart);
    scene.input.on('drag', onDrag);
    scene.input.on('dragend', onDragEnd);
    scene.input.on('pointerdown', onPointerDown);
    scene.input.on('pointermove', onWallPointerMove);
    scene.input.on('pointerup', onWallPointerUp);
    scene.input.on('gameobjectdown', onGameObjectDown);
    if (canvas) {
      canvas.addEventListener('dragover', onCanvasDragOver);
      canvas.addEventListener('drop', onCanvasDrop);
    }
    setEditorMode('furniture');
  }

  function disableEditor() {
    const scene = getScene();
    if (!scene) return;
    editorActive = false;
    window.__DenizenEditorActive = false;
    removeEditorUI();

    scene.playerLocked = scene._editorWasLocked ?? false;
    const handlers = scene._editorHandlers;
    if (handlers) {
      scene.input.off('dragstart', handlers.onDragStart);
      scene.input.off('drag', handlers.onDrag);
      scene.input.off('dragend', handlers.onDragEnd);
      scene.input.off('pointerdown', handlers.onPointerDown);
      scene.input.off('pointermove', handlers.onWallPointerMove);
      scene.input.off('pointerup', handlers.onWallPointerUp);
      scene.input.off('gameobjectdown', handlers.onGameObjectDown);
      if (scene.game?.canvas) {
        scene.game.canvas.removeEventListener('dragover', handlers.onCanvasDragOver);
        scene.game.canvas.removeEventListener('drop', handlers.onCanvasDrop);
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

  document.addEventListener('keydown', (e) => {
    if (document.documentElement.dataset.denizenModal === 'open') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'e' || e.key === 'E') {
      const host = String(window.location.hostname || '').toLowerCase();
      const params = new URLSearchParams(window.location.search);
      const onLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
      const onDolonia = host === 'denizen.dolonia.cloud' || host.endsWith('.dolonia.cloud');
      const allowEditor = onLocalhost || onDolonia || params.has('editor');
      if (!allowEditor) return;
      const plainE = !e.ctrlKey && !e.metaKey && !e.altKey;
      const toggleChord = (e.ctrlKey && e.shiftKey) || (plainE && (onLocalhost || onDolonia || params.has('editor')));
      if (!toggleChord) return;
      e.preventDefault();
      e.stopPropagation();
      if (editorActive) disableEditor();
      else enableEditor();
    }
    if (e.key === 'x' || e.key === 'X') {
      if (!editorActive) return;
      if (editorMode === 'walls') window._editorExportWalls();
      else window._editorExport();
    }
    if (!editorActive || editorMode !== 'walls') return;
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
