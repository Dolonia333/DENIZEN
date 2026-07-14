/* Pixel Spaces side-view — polished closer to itch example */
(() => {
  const PACK = './PixelSpaces';
  const W = 980;
  const H = 420;
  const SCALE = 2;

  /** Channel id → room slot key on the map. */
  function chKey(channelId) {
    return `ch_${String(channelId || '').trim()}`;
  }

  function channelLabel(ch) {
    const name = String(ch?.name || 'channel').slice(0, 22);
    const type = String(ch?.type || '').toLowerCase();
    if (type === 'voice' || type === 'stage') return `🔊 ${name}`;
    return `#${name}`;
  }

  function shortLabel(text, max = 18) {
    const s = String(text || '');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  /** Deterministic string hash — same channel id always yields the same seed,
   *  so room decor is stable across reloads but varies room to room. */
  function hashSeed(str) {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i += 1) {
      h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function seededPick(seed, arr, salt = 0) {
    if (!arr.length) return undefined;
    return arr[(seed + salt) % arr.length];
  }

  const PRESENCE_URL = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get('presence');
      if (q) return q;
    } catch (_) { /* ignore */ }
    try {
      const stored = JSON.parse(localStorage.getItem('denizen-discord-map') || '{}');
      if (stored.presenceUrlResolved) return stored.presenceUrlResolved;
      if (stored.presenceUrl) {
        const gid = stored.guildId;
        try {
          const u = new URL(stored.presenceUrl);
          if (!u.pathname || u.pathname === '/') u.pathname = '/presence';
          if (gid) u.searchParams.set('guildId', gid);
          return u.toString();
        } catch (_) {
          return stored.presenceUrl;
        }
      }
    } catch (_) { /* ignore */ }
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5180/presence';
    }
    return `${location.origin}/api/discord/map/presence`;
  })();
  const PRESENCE_POLL_MS = 1500;

  const ME_DISCORD_ID = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get('me');
      if (q) return String(q).trim();
      const cfg = JSON.parse(localStorage.getItem('denizen-discord-map') || '{}');
      return String(cfg.discordUserId || '').trim();
    } catch (_) {
      return '';
    }
  })();

  const IS_TOUCH = (() => {
    if (window.__DiscordMapIsTouch) return true;
    try {
      return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    } catch (_) {
      return false;
    }
  })();

  function touchInput() {
    return window.__DiscordMapTouch || null;
  }

  function defaultOutdoorHint() {
    return IS_TOUCH ? '◀ ▶ walk · ▲ enter at doors' : 'Walk to a door · ↑ / W enter · ↓ / S leave';
  }

  function defaultIndoorHint() {
    return IS_TOUCH ? '◀ ▶ move · ▲ ▼ stairs · ▼ leave' : '↓ / S leave · ↑ stairs · A/D walk';
  }

  const LR = `${PACK}/Furniture/Living Room`;
  const KIT = `${PACK}/Furniture/Kitchen`;
  const BR = `${PACK}/Furniture/Bedroom`;
  const OBJ = `${PACK}/Objects/Living Room`;
  const OBR = `${PACK}/Objects/Bedroom`;
  const INF = `${PACK}/Infrastructure`;
  const BG = `${PACK}/Backgrounds`;

  const ASSETS = {
    // Backgrounds / outdoor
    cloud: `${BG}/Cloud_1.png`,
    cloudSm: `${BG}/Cloud_small_3.png`,
    mountainL: `${BG}/Mountain_large_1.png`,
    mountainM: `${BG}/Mountain_medium_1.png`,
    mountainS: `${BG}/Mountain_small_1.png`,
    tree: `${BG}/Tree_medium.png`,
    houseRed: `${BG}/House_large_red.png`,
    houseBeige: `${BG}/House_small_beige.png`,
    houseBlue: `${BG}/House_small_blue.png`,
    houseGreen: `${BG}/House_small_green.png`,
    // Infrastructure (interaction anchors — keep intact)
    door: `${INF}/Door_wood_opened.png`,
    doorClosed: `${INF}/Door_wood_closed.png`,
    doorGlass: `${INF}/Door_glass_opened.png`,
    elevClosed: `${INF}/Elevator_closed.png`,
    elevOpen: `${INF}/Elevator_opened.png`,
    stairs: `${INF}/Stairs.png`,
    light1: `${PACK}/Furniture/Light_1.png`,
    light2: `${PACK}/Furniture/Light_2.png`,
    // Couches — large 2-seat (6 colors)
    couchBlue: `${LR}/Couch_large_2_blue.png`,
    couchGreen: `${LR}/Couch_large_2_green.png`,
    couchRed: `${LR}/Couch_large_2_red.png`,
    couchGrey: `${LR}/Couch_large_2_grey.png`,
    couchYellow: `${LR}/Couch_large_2_yellow.png`,
    couchDark: `${LR}/Couch_large_2_darkgrey.png`,
    // Couches — small front (for tight kits)
    couchSmall: `${LR}/Couch_small_2_blue.png`,
    couchSmallG: `${LR}/Couch_small_2_green.png`,
    couchSmallR: `${LR}/Couch_small_2_red.png`,
    couchSmallY: `${LR}/Couch_small_2_yellow.png`,
    couchSmallGr: `${LR}/Couch_small_2_grey.png`,
    // Tables
    table: `${LR}/Table_medium.png`,
    tableLong: `${LR}/Table_long.png`,
    coffee: `${LR}/Coffee_table_1.png`,
    coffee2: `${LR}/Coffee_table_2.png`,
    // Office (dev channels)
    desk: `${LR}/Drawerdesk.png`,
    desk2: `${LR}/Drawerdesk_2.png`,
    officechairBlue: `${LR}/Officechair_blue.png`,
    officechairRed: `${LR}/Officechair_red.png`,
    officechairPurple: `${LR}/Officechair_purple.png`,
    officechairOrange: `${LR}/Officechair_orange.png`,
    // Shelves / books (library)
    bookshelf: `${LR}/Bookshelf_1.png`,
    bookshelf2: `${LR}/Bookshelf_2.png`,
    bookshelfSm: `${LR}/Bookshelf_small.png`,
    shelfLarge: `${LR}/Shelf_large.png`,
    shelfMedium: `${LR}/Shelf_medium.png`,
    // Stools (cafe/bar)
    stoolBlue: `${LR}/Stool_blue.png`,
    stoolRed: `${LR}/Stool_red.png`,
    stoolYellow: `${LR}/Stool_yellow.png`,
    stoolGreen: `${LR}/Stool_green.png`,
    // Windows / curtains (wall decor)
    windowSq: `${LR}/Window_square.png`,
    windowCircle: `${LR}/Window_circle.png`,
    windowGlass: `${LR}/Window_glass.png`,
    windowSmall: `${LR}/Window_small.png`,
    curtain: `${LR}/Curtain_medium_green.png`,
    curtainR: `${LR}/Curtain_medium_red.png`,
    curtainB: `${LR}/Curtain_medium_blue.png`,
    curtainY: `${LR}/Curtain_medium_yellow.png`,
    // Bedroom
    bed: `${BR}/Bed_red.png`,
    bedBlue: `${BR}/Bed_blue.png`,
    bedGreen: `${BR}/Bed_green.png`,
    lamp: `${BR}/Lamp_stand_1.png`,
    lamp2: `${BR}/Lamp_stand_2.png`,
    lamp3: `${BR}/Lamp_stand_3.png`,
    cabinet: `${BR}/Cabinet_1.png`,
    drawer: `${BR}/Drawer_medium_1_c.png`,
    laptop: `${OBR}/Laptop.png`,
    // Kitchen (food/break channels)
    fridge: `${KIT}/Refrigerator_large_white.png`,
    fridgeBlack: `${KIT}/Refrigerator_large_black.png`,
    sink: `${KIT}/Sink.png`,
    counter: `${KIT}/Countertop.png`,
    counterEnd: `${KIT}/Countertop_end.png`,
    oven: `${KIT}/Oven.png`,
    cupboard: `${KIT}/Cupboard_single.png`,
    // Small floor objects (lived-in life)
    flora: `${OBJ}/Flora_poppy.png`,
    floraAloe: `${OBJ}/Flora_aloe.png`,
    floraFern: `${OBJ}/Flora_fern.png`,
    floraBonsai: `${OBJ}/Flora_bonsai.png`,
    floraRose: `${OBJ}/Flora_rose.png`,
    floraSnake: `${OBJ}/Flora_snake.png`,
    floraSucculent: `${OBJ}/Flora_succulent.png`,
    potGreen: `${OBJ}/Flowerpot_medium_green.png`,
    potRed: `${OBJ}/Flowerpot_medium_red.png`,
    potBlue: `${OBJ}/Flowerpot_medium_blue.png`,
    potYellow: `${OBJ}/Flowerpot_medium_yellow.png`,
    books: `${OBJ}/Books_outside_1.png`,
    books2: `${OBJ}/Books_outside_2.png`,
    aquarium: `${OBJ}/Aquarium.png`,
    terrarium: `${OBJ}/Terrarium.png`,
    radio: `${OBJ}/Radio.png`,
    vaseBlue: `${OBJ}/Vase_blue.png`,
    vasePink: `${OBJ}/Vase_pink.png`,
    trashcan: `${OBJ}/Trashcan.png`,
    clipboard: `${OBJ}/Clipboard_wall.png`,
    box: `${OBR}/Box_blue_large.png`,
    boxSm: `${OBR}/Box_blue_small.png`,
  };

  // 30 pre-made NPC sheets (15 male + 15 female), 16x32 frames, 14 anim rows
  // (row 0 = walk, row 1 = idle). Real characters replace the old 2-sprite crowd.
  const NPC_SHEETS = [];
  for (let i = 1; i <= 15; i += 1) {
    NPC_SHEETS.push({ key: `npc_m${i}`, path: `${PACK}/NPCs/Male/NPC ${i}.png` });
    NPC_SHEETS.push({ key: `npc_f${i}`, path: `${PACK}/NPCs/Female/NPC ${i}.png` });
  }
  // Sheets are a 256x448 grid of 32x32 cells (8 cols x 14 rows), not 16x32 —
  // loading at half-width used to slice each character in two down the middle.
  const NPC_FRAME = { w: 32, h: 32 };
  const NPC_COLS = 8;
  // The character art itself only fills roughly y9-23 of each 32-tall cell
  // (walk/idle rows) — the frame has ~9px of transparent padding below the
  // feet. Anchoring at the frame's true bottom (origin.y = 1) floats the
  // sprite above the floor; anchor at the feet instead so origin (0.5, this)
  // plants the character on the ground line.
  const NPC_FOOT_ORIGIN_Y = 24 / 32;

  // Distinct saturated wall color per room + warm floor strip — the #1 reference
  // signature. Rooms used to all be near-white beige.
  const ROOM_WALL_COLORS = [
    0x2f6f9e, 0xd9862b, 0x3f9e57, 0xc0433d, 0x7d54ad,
    0xc99a22, 0x2f9e93, 0xc4577e, 0x4560c0, 0xb5642f,
    0x4a8fb0, 0x8a5a3c, 0x5b9e6a, 0x9e4d6e, 0x6a5aa0,
  ];
  const ROOM_FLOOR_STRIP = 0x7a5a3c; // warm wood baseboard

  // Channel-name -> themed furniture kit. Each kit is a set of {key,xf(0-1),depth,
  // scaleMul?}. Keys resolve against ASSETS (arrays = seeded pick a variant).
  // This is the semantic art direction the design panel converged on: a server
  // reads like a real building (library, dev office, cafe, lounge...) not 8 clones.
  const KITS = {
    lounge: [
      { key: ['couchBlue', 'couchGreen', 'couchRed', 'couchYellow'], xf: 0.22, depth: 23 },
      { key: 'coffee', xf: 0.5, depth: 24 },
      { key: ['lamp', 'lamp2', 'lamp3'], xf: 0.74, depth: 22 },
      { key: ['floraFern', 'floraSnake', 'floraAloe'], xf: 0.9, depth: 24 },
    ],
    library: [
      { key: 'bookshelf', xf: 0.14, depth: 22 },
      { key: 'bookshelf2', xf: 0.34, depth: 22 },
      { key: ['couchSmall', 'couchSmallGr'], xf: 0.62, depth: 23 },
      { key: ['books', 'books2'], xf: 0.84, depth: 24 },
      { key: ['floraBonsai', 'floraSucculent'], xf: 0.93, depth: 24 },
    ],
    office: [
      { key: ['desk', 'desk2'], xf: 0.22, depth: 22 },
      { key: 'laptop', xf: 0.22, depth: 24, offY: -13 },
      { key: ['officechairBlue', 'officechairRed', 'officechairPurple', 'officechairOrange'], xf: 0.4, depth: 23 },
      { key: 'shelfMedium', xf: 0.66, depth: 22 },
      { key: ['floraSucculent', 'flora'], xf: 0.9, depth: 24 },
    ],
    cafe: [
      { key: 'counter', xf: 0.16, depth: 22 },
      { key: 'counterEnd', xf: 0.31, depth: 22 },
      { key: ['stoolRed', 'stoolYellow', 'stoolBlue', 'stoolGreen'], xf: 0.5, depth: 23 },
      { key: 'radio', xf: 0.72, depth: 24 },
      { key: ['potRed', 'potYellow'], xf: 0.9, depth: 24 },
    ],
    kitchen: [
      { key: 'fridge', xf: 0.14, depth: 22 },
      { key: 'counter', xf: 0.36, depth: 22 },
      { key: 'oven', xf: 0.52, depth: 22 },
      { key: 'sink', xf: 0.68, depth: 22 },
      { key: 'trashcan', xf: 0.9, depth: 24 },
    ],
    reception: [
      { key: 'tableLong', xf: 0.28, depth: 22 },
      { key: 'clipboard', xf: 0.28, depth: 24, offY: -16, wall: true },
      { key: ['floraRose', 'floraFern'], xf: 0.6, depth: 24 },
      { key: ['couchSmall', 'couchSmallY'], xf: 0.82, depth: 23 },
    ],
    cozy: [
      { key: ['bedBlue', 'bedGreen', 'bed'], xf: 0.24, depth: 23 },
      { key: ['lamp2', 'lamp3'], xf: 0.5, depth: 22 },
      { key: 'drawer', xf: 0.68, depth: 22 },
      { key: ['floraAloe', 'floraSnake'], xf: 0.9, depth: 24 },
    ],
    gallery: [
      { key: 'aquarium', xf: 0.2, depth: 23 },
      { key: 'terrarium', xf: 0.46, depth: 23 },
      { key: ['vaseBlue', 'vasePink'], xf: 0.68, depth: 24 },
      { key: ['floraBonsai', 'floraRose'], xf: 0.88, depth: 24 },
    ],
  };
  const KIT_NAMES = Object.keys(KITS);

  // Pick a kit name for a channel: keyword on name first, then type, then seed.
  function kitForChannel(name, type, seed) {
    const n = String(name || '').toLowerCase();
    const test = (re) => re.test(n);
    if (type === 'voice' || type === 'stage') {
      // Voice = social spaces (never bedrooms). Meeting/conference rooms get the
      // long-table reception kit; the rest are lounges/cafes.
      if (test(/(meet|conf|stand.?up|board|call|stage|podium)/)) return 'reception';
      return seededPick(seed, ['lounge', 'cafe']);
    }
    if (test(/(read|doc|wiki|book|faq|resource|guide|rule|info)/)) return 'library';
    if (test(/(dev|code|eng|build|git|ci|ops|cmd|tech|bug|deploy|infra)/)) return 'office';
    if (test(/(cafe|coffee|food|snack|lunch|bar|drink)/)) return 'cafe';
    if (test(/(kitchen|cook|recipe|meal)/)) return 'kitchen';
    if (test(/(welcome|start|rule|announce|intro|lobby|front|greet)/)) return 'reception';
    if (test(/(art|gallery|show|media|photo|design|pet|fish)/)) return 'gallery';
    if (test(/(general|chat|hang|off.?topic|random|talk|lounge|social)/)) return 'lounge';
    if (test(/(afk|sleep|quiet|zzz|away|vent|feel)/)) return 'cozy';
    return seededPick(seed, KIT_NAMES);
  }

  class ExampleMapScene extends Phaser.Scene {
    constructor() {
      super('example');
    }

    preload() {
      Object.entries(ASSETS).forEach(([k, p]) => this.load.image(k, p));
      // 30 pre-made NPC sheets (16x32 frames): row 0 walk, row 1 idle.
      NPC_SHEETS.forEach((n) => this.load.spritesheet(n.key, n.path, { frameWidth: NPC_FRAME.w, frameHeight: NPC_FRAME.h }));
      // Missing-asset diagnostics so a bad path shows in console instead of silently vanishing.
      this.load.on('loaderror', (file) => console.warn('[map] asset failed:', file.key, file.src));
    }

    create() {
      this.groundY = 318;
      this.mapWidth = W;

      this.livePeople = new Map();
      this.roomSlots = new Map();
      this.floors = new Map();
      this.doors = [];
      this.stairs = [];
      this.passages = [];
      this.buildings = [];
      this.indoors = null;
      this.enterCooldown = 0;
      this._sceneMinY = 0; // tallest building's roof, tracked as buildings draw
      this.presenceEl = document.getElementById('presence-status');
      this.hintEl = document.getElementById('enter-hint');

      Object.keys(this.textures.list).forEach((key) => {
        if (key === '__DEFAULT' || key === '__MISSING') return;
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      });

      this.buildSky();
      this.buildFarMountains();
      this.buildDistantSkyline();
      this.makeAnims();

      this.bootstrapLayout().then(() => {
        this.spawnDecorNpcs();
        this.startPresenceLoop();
        this.setupPlayer();
        this.cameras.main.fadeIn(500, 126, 200, 232);
      }).catch(() => {
        this.drawGround();
        this.drawEmptyBuilding(20, this.groundY, 'Discord');
        this.setupPlayer();
        this.startPresenceLoop();
      });
    }

    setupPlayer() {
      // NPC frames are 32x32 cells; the character art itself is a small chibi
      // bust roughly x11-21,y9-23 within each cell (not flush to the edges).
      // The collision body is a small box over the legs, anchored at the
      // feet (NPC_FOOT_ORIGIN_Y) so the character actually stands on the
      // floor line instead of floating above it.
      this.playerSheet = NPC_SHEETS.find((n) => this.textures.exists(n.key))?.key || NPC_SHEETS[0].key;
      this.player = this.physics.add.sprite(160, this.groundY - 1, this.playerSheet, 0)
        .setScale(SCALE)
        .setOrigin(0.5, NPC_FOOT_ORIGIN_Y)
        .setDepth(45)
        .setCollideWorldBounds(true);
      this.player.body.setSize(12, 8).setOffset(10, 16);
      const mw = this.mapWidth || W;
      // Tall stacked-floor buildings can extend above y=0; widen bounds so
      // the camera can actually scroll up to follow the player onto upper
      // floors instead of clamping at the canvas top.
      const topBound = Math.min(0, this._sceneMinY ?? 0);
      this.physics.world.setBounds(0, topBound, mw + 40, H - topBound);
      this.cameras.main.setBounds(0, topBound, mw + 40, H - topBound);
      this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
      const narrow = window.innerWidth < 640;
      this.outdoorZoom = IS_TOUCH && narrow ? 0.98 : 1.1;
      this.indoorZoom = IS_TOUCH && narrow ? 1.38 : 1.55;
      this.cameras.main.setZoom(this.outdoorZoom);
      this.cameras.main.setDeadzone(narrow ? 60 : 90, narrow ? 36 : 50);

      this.playerTag = this.add.text(0, 0, 'you', {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 5, y: 2 },
      }).setOrigin(0.5, 1).setDepth(46).setResolution(3);

      const floor = this.add.rectangle(mw / 2, this.groundY + 24, mw + 120, 48, 0x000000, 0);
      this.physics.add.existing(floor, true);
      this.physics.add.collider(this.player, floor);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
      });

      this.roomEl = document.getElementById('room-label');
      if (this.roomEl) this.roomEl.textContent = 'lobby';
      this.setEnterHint(defaultOutdoorHint());
    }

    async bootstrapLayout() {
      let data = { rooms: [], guildName: 'Discord' };
      try {
        const res = await fetch(PRESENCE_URL, { cache: 'no-store' });
        if (res.ok) data = await res.json();
      } catch (_) { /* offline — draw placeholder */ }

      const rooms = Array.isArray(data.rooms) ? data.rooms : [];
      const voice = rooms.filter((r) => r.type === 'voice' || r.type === 'stage');
      const text = rooms.filter((r) => r.type === 'text' || r.type === 'forum');
      const guildName = data.guildName || 'Discord';

      const titleEl = document.getElementById('map-title');
      if (titleEl && guildName) titleEl.textContent = guildName;

      let x = 20;
      this.buildings = [];

      if (voice.length) {
        const bw = 290;
        this.drawVoiceBuilding(x, this.groundY, voice, guildName);
        this.buildings.push({ left: x, right: x + bw, kind: 'voice', channels: voice, label: 'Voice' });
        x += bw + 36;
      }

      const perBuilding = 4;
      const textPalettes = [0, 1, 2];
      for (let i = 0; i < text.length; i += perBuilding) {
        const chunk = text.slice(i, i + perBuilding);
        const bw = 290;
        const title = i === 0 ? guildName : `${guildName} · pt ${Math.floor(i / perBuilding) + 1}`;
        this.drawTextBuilding(x, this.groundY, title, chunk, textPalettes[(i / perBuilding) % textPalettes.length]);
        this.buildings.push({ left: x, right: x + bw, kind: 'text', channels: chunk, label: title });
        x += bw + 20;
      }

      if (!voice.length && !text.length) {
        this.drawEmptyBuilding(x, this.groundY, guildName);
        x += 320;
      }

      this.mapWidth = Math.max(W, x + 100);
      this.drawGround();
      this.add.image(this.mapWidth - 70, this.groundY - 1, 'tree').setScale(2.8).setOrigin(0.5, 1).setDepth(18);
      this.add.image(this.mapWidth - 30, this.groundY - 1, 'pot').setScale(SCALE).setOrigin(0.5, 1).setDepth(18);
    }

    buildSky() {
      this.cameras.main.setBackgroundColor('#6eb8de');

      // Soft sky bands (top → horizon) — fills behind parallax layers
      const bands = [
        { y: 0, h: 70, c: 0x5aa8d4 },
        { y: 70, h: 60, c: 0x6eb8de },
        { y: 130, h: 55, c: 0x87c9e8 },
        { y: 185, h: 50, c: 0xa3d8ef },
        { y: 235, h: 70, c: 0xc2e6f5 },
      ];
      bands.forEach((b, i) => {
        this.add.rectangle(W / 2, b.y + b.h / 2, W * 3, b.h + 4, b.c)
          .setScrollFactor(0)
          .setDepth(-200 + i);
      });

      // Horizon haze
      this.add.rectangle(W / 2, this.groundY - 28, W * 3, 56, 0xe8f6fc, 0.35)
        .setScrollFactor(0.15)
        .setDepth(-170);

      // Soft sun
      const sunX = 110;
      const sunY = 58;
      this.add.circle(sunX, sunY, 22, 0xfff3c0, 0.55).setScrollFactor(0.08).setDepth(-165);
      this.add.circle(sunX, sunY, 14, 0xffe08a, 0.9).setScrollFactor(0.08).setDepth(-164);

      const sprinkle = (x, y, key, sc, drift, scroll = 0.2) => {
        const shadow = this.add.image(x, y + 2, key)
          .setTint(0xffffff)
          .setAlpha(0.22)
          .setScale(sc * 1.05)
          .setDepth(-126)
          .setScrollFactor(scroll);
        const c = this.add.image(x, y, key)
          .setScale(sc)
          .setAlpha(0.95)
          .setDepth(-125)
          .setScrollFactor(scroll);
        this.tweens.add({
          targets: [shadow, c],
          x: `+=${drift}`,
          duration: 16000 + Math.random() * 10000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      };
      sprinkle(80, 36, 'cloud', 2.6, 40, 0.12);
      sprinkle(220, 28, 'cloudSm', 3.0, -32, 0.16);
      sprinkle(400, 44, 'cloud', 2.3, 48, 0.14);
      sprinkle(560, 24, 'cloudSm', 3.2, -26, 0.18);
      sprinkle(720, 40, 'cloud', 2.1, 34, 0.15);
      sprinkle(310, 58, 'cloudSm', 1.9, 20, 0.22);
      sprinkle(850, 34, 'cloudSm', 2.4, -18, 0.13);
    }

    buildFarMountains() {
      // Far muted ridge (full width)
      const far = [
        [40, 1.1], [140, 0.95], [260, 1.3], [380, 1.05],
        [520, 1.35], [650, 1.15], [780, 1.0], [900, 1.2],
      ];
      far.forEach(([x, sc], i) => {
        const key = i % 3 === 0 ? 'mountainL' : (i % 3 === 1 ? 'mountainM' : 'mountainS');
        this.add.image(x, this.groundY - 6, key)
          .setScale(sc)
          .setOrigin(0.5, 1)
          .setTint(0xb8c4d8)
          .setAlpha(0.55)
          .setDepth(-100)
          .setScrollFactor(0.28);
      });

      // Mid mountains — denser around/behind buildings
      const mid = [
        [-20, 1.2, 'mountainM'], [90, 1.45, 'mountainL'], [200, 1.1, 'mountainS'],
        [470, 1.35, 'mountainL'], [580, 1.2, 'mountainM'], [690, 1.4, 'mountainL'],
        [820, 1.15, 'mountainS'],
      ];
      mid.forEach(([x, sc, key], i) => {
        this.add.image(x, this.groundY - 4, key)
          .setScale(sc)
          .setOrigin(0.5, 1)
          .setAlpha(0.82 + (i % 3) * 0.04)
          .setDepth(-90 - (i % 2))
          .setScrollFactor(0.4);
      });

      // Soft rolling hills peek between buildings (fills empty cyan bands)
      const hills = this.add.graphics().setDepth(-84).setScrollFactor(0.52);
      const drawHill = (cx, baseY, w, h, color, alpha) => {
        hills.fillStyle(color, alpha);
        hills.fillEllipse(cx, baseY, w, h);
      };
      drawHill(150, this.groundY + 8, 160, 48, 0x6a8a6e, 0.55);
      drawHill(310, this.groundY + 10, 120, 40, 0x5e7e62, 0.45);
      drawHill(640, this.groundY + 6, 140, 44, 0x628666, 0.5);
      drawHill(780, this.groundY + 10, 100, 36, 0x587858, 0.4);
    }

    buildDistantSkyline() {
      // Soft city silhouettes far left / between / right of HQ
      const g = this.add.graphics().setDepth(-95).setScrollFactor(0.32).setAlpha(0.4);
      const base = this.groundY - 8;
      const blocks = [
        [8, 36], [28, 58], [48, 44], [70, 72], [92, 40],
        [270, 48], [288, 66], [560, 52], [580, 70], [600, 42],
        [760, 55], [780, 38], [800, 64],
      ];
      blocks.forEach(([x, h], i) => {
        g.fillStyle(i % 2 ? 0x8a6a78 : 0x9a8070, 1);
        g.fillRect(x, base - h, 18, h);
        // tiny windows
        g.fillStyle(0xffe6a0, 0.25);
        for (let wy = base - h + 6; wy < base - 8; wy += 10) {
          g.fillRect(x + 4, wy, 3, 3);
          g.fillRect(x + 10, wy, 3, 3);
        }
      });

      // Distant pack houses (faint scenery, not competing with HQ)
      this.add.image(18, this.groundY - 1, 'houseBeige')
        .setScale(1.15).setOrigin(0.5, 1).setDepth(-86).setAlpha(0.55).setScrollFactor(0.48);
      this.add.image(860, this.groundY - 1, 'houseRed')
        .setScale(0.95).setOrigin(0.5, 1).setDepth(-86).setAlpha(0.5).setScrollFactor(0.5);
      this.add.image(820, this.groundY - 1, 'tree')
        .setScale(1.8).setOrigin(0.5, 1).setDepth(-85).setAlpha(0.7).setScrollFactor(0.55);
    }

    /** Solid terrain under the walk line — continuous earth, not a floating slab. */
    drawGround() {
      const g = this.add.graphics().setDepth(8);
      const top = this.groundY;
      const width = (this.mapWidth || W) + 160;

      // Thick sidewalk slab (keeps buildings from looking like they float)
      g.fillStyle(0x6e6578, 1);
      g.fillRect(-50, top - 2, width, 22);
      g.fillStyle(0x8a8294, 1);
      g.fillRect(-50, top - 2, width, 5);
      g.fillStyle(0x4a4254, 1);
      g.fillRect(-50, top + 16, width, 4);

      // Sidewalk tile seams
      g.lineStyle(1, 0x3a3444, 0.45);
      for (let tx = -40; tx < (this.mapWidth || W) + 60; tx += 28) {
        g.lineBetween(tx, top - 1, tx, top + 18);
      }

      // Grass fringe on top of slab
      g.fillStyle(0x4fa85a, 1);
      g.fillRect(-50, top - 7, width, 6);
      g.fillStyle(0x6bc86e, 1);
      g.fillRect(-50, top - 7, width, 2);

      // Continuous earth under slab → fills camera bottom
      const layers = [
        [0x5a4058, 24],
        [0x4a344a, 28],
        [0x3a283a, 34],
        [0x2a1c2c, 44],
        [0x1c121e, 140],
      ];
      let y = top + 20;
      layers.forEach(([c, h]) => {
        g.fillStyle(c, 1);
        g.fillRect(-50, y, width, h);
        y += h;
      });

      // Soft strata strokes
      g.lineStyle(2, 0x120a12, 0.28);
      for (let ly = top + 40; ly < top + 210; ly += 16) {
        g.lineBetween(-40, ly, W + 80, ly + 2);
      }

      // Dirt pebbles
      g.fillStyle(0x7a6080, 0.25);
      for (let i = 0; i < 55; i += 1) {
        g.fillRect(
          -10 + (i * 41) % (W + 20),
          top + 28 + (i * 17) % 150,
          2 + (i % 3),
          2,
        );
      }

      // Building foot shadows onto the slab
      g.fillStyle(0x000000, 0.28);
      g.fillEllipse(165, top + 14, 310, 16);
      g.fillEllipse(475, top + 14, 330, 16);

      // Grass tufts along the walk edge
      const grass = this.add.graphics().setDepth(11);
      grass.fillStyle(0x5ed86a, 1);
      for (let gx = 10; gx < W; gx += 11) {
        if (gx > 18 && gx < 315) continue;
        if (gx > 325 && gx < 630) continue;
        const h = 4 + (gx % 5);
        grass.fillRect(gx, top - 7 - h, 2, h);
        grass.fillRect(gx + 3, top - 9 - h, 2, h + 2);
      }
    }

    channelBadge(x, y, label, depth = 27) {
      return this.add.text(x, y, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#0b0f14',
        backgroundColor: '#ffffff',
        padding: { x: 6, y: 4 },
      }).setOrigin(0, 0).setDepth(depth).setResolution(Math.max(2, window.devicePixelRatio || 2));
    }

    buildingTitle(x, y, label, { color = '#ffffff', bg = '#222222', depth = 28 } = {}) {
      return this.add.text(x, y, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color,
        backgroundColor: bg,
        padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setDepth(depth).setResolution(Math.max(2, window.devicePixelRatio || 2));
    }

    stripLabel(x, y, label, { color = '#ffffff', bg = '#222222cc', depth = 28 } = {}) {
      return this.add.text(x, y, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color,
        backgroundColor: bg,
        padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 0).setDepth(depth).setResolution(Math.max(2, window.devicePixelRatio || 2));
    }

    slotPointsForRoom(x0, w, floorY, count = 3) {
      const pts = [];
      for (let i = 0; i < count; i += 1) {
        pts.push([x0 + 24 + (i % 3) * Math.max(28, w / 3), floorY - 1 - Math.floor(i / 3) * 4]);
      }
      return pts;
    }

    drawVoiceBuilding(left, groundY, channels, guildName) {
      const g = this.add.graphics().setDepth(20);
      const bw = 290;
      const gap = channels.length > 4 ? 8 : 0;
      const cols = channels.length > 4 ? 2 : 1;
      const rows = Math.ceil(channels.length / cols);
      const roomW = cols === 1
        ? bw - 32
        : Math.floor((bw - 32 - gap) / cols);
      const minRoomH = 84;
      const doorStrip = 54;
      const totalRoomsHeight = rows * minRoomH + (rows - 1) * gap;
      const bh = Math.max(320, totalRoomsHeight + doorStrip + 32);
      const top = groundY - bh;
      this._sceneMinY = Math.min(this._sceneMinY ?? 0, top - 30);
      const title = channels.length === 1
        ? shortLabel(channelLabel(channels[0]), 24)
        : 'Voice Channels';

      g.fillStyle(0x000000, 0.22);
      g.fillRect(left + 8, groundY - 6, bw, 10);
      g.fillStyle(0x5865f2, 1);
      g.fillRect(left, top, bw, bh);
      g.fillStyle(0x3c45c0, 1);
      g.fillRect(left + bw - 14, top, 14, bh);
      g.lineStyle(3, 0x1a1f4a, 1);
      g.strokeRect(left, top, bw, bh);
      g.fillStyle(0x7289da, 1);
      g.fillRect(left - 6, top - 10, bw + 12, 12);
      g.lineStyle(3, 0x1a1f4a, 1);
      g.strokeRect(left - 6, top - 10, bw + 12, 12);
      g.fillStyle(0x4a5bd3, 1);
      g.fillRect(left - 8, top - 18, bw + 16, 8);
      g.lineStyle(2, 0x1a1f4a, 1);
      g.strokeRect(left - 8, top - 18, bw + 16, 8);

      this.buildingTitle(left + bw / 2, top - 22, title, {
        color: '#eef0ff', bg: '#3c45c0',
      });

      const rowCount = Math.max(rows, 3);
      const innerTop = top + 12;
      const innerH = bh - doorStrip - 16;
      const rawRoomH = Math.max(48, Math.floor((innerH - (rowCount - 1) * gap) / rowCount));
      const roomH = Math.min(rawRoomH, 120);
      const actualRoomsHeight = rowCount * roomH + (rowCount - 1) * gap;
      const yBase = innerTop + Math.floor((innerH - actualRoomsHeight) / 2);
      const totalSlots = rowCount * cols;

      for (let idx = 0; idx < totalSlots; idx += 1) {
        const isPlaceholder = idx >= channels.length;
        const col = cols === 1 ? 0 : idx % cols;
        const row = cols === 1 ? idx : Math.floor(idx / cols);
        const x0 = left + 16 + col * (roomW + gap);
        const y0 = yBase + row * (roomH + gap);
        const h = row === rowCount - 1
          ? top + bh - doorStrip - y0
          : roomH - 4;
        const roomKey = isPlaceholder ? `vc_placeholder_${idx}` : chKey(channels[idx].id);
        const label = isPlaceholder ? '' : channelLabel(channels[idx]);
        const fill = isPlaceholder ? 0xc2c6e6 : this.roomWallColor(roomKey);

        this.cutawayRoom(g, x0, y0, roomW, h, fill, () => {
          if (!isPlaceholder) {
            const floor = y0 + h - 2;
            this.decorateRoom(channels[idx], x0, y0, roomW, h, floor);
            this.addRoomSlots(roomKey, this.slotPointsForRoom(x0, roomW, floor, 4));
          }
        });

        if (!isPlaceholder) {
          this.channelBadge(x0 + 4, y0 + 4, shortLabel(label, cols === 1 ? 20 : 14));
          this.registerFloor({
            id: roomKey,
            roomKey,
            floorY: y0 + h - 3,
            minX: x0 + 10,
            maxX: x0 + roomW - 10,
            label,
          });
        }

        if (idx === 0 && !isPlaceholder) {
          this.registerDoor({ x: left + 42, floorId: roomKey, radius: 18 });
        }
        if (cols === 2 && idx === 1 && !isPlaceholder) {
          this.registerDoor({ x: left + bw - 48, floorId: roomKey, radius: 18 });
        }
      }

      this.placeEntrance(g, left + 42, groundY, 'door', 0x3c45c0, 26);
      if (cols === 2 && channels.length > 1) {
        this.placeEntrance(g, left + bw - 48, groundY, 'door', 0x3c45c0, 26);
      }
      this.stripLabel(left + bw / 2, groundY - doorStrip + 6, `${shortLabel(guildName, 14)} · VC · ↑ enter`, {
        color: '#eef0ff', bg: '#2b3190',
      });
    }

    drawTextBuilding(left, groundY, title, channels, paletteIndex = 0) {
      const palettes = [
        { shell: 0x45b866, side: 0x2f8f4a, roof: 0x359a52, stroke: 0x12301a, titleBg: '#b8f0c8', titleFg: '#102818', lintel: 0x2a5534 },
        { shell: 0x3db4a8, side: 0x2a8f86, roof: 0x45c4b8, stroke: 0x0f3530, titleBg: '#b8f0ea', titleFg: '#0a2824', lintel: 0x2a5548 },
        { shell: 0xe8943a, side: 0xc47a2a, roof: 0xf0a850, stroke: 0x4a3010, titleBg: '#ffe8c8', titleFg: '#3a2208', lintel: 0x553822 },
      ];
      const pal = palettes[paletteIndex % palettes.length];
      const fills = [0xead9b8, 0xe8dcc4, 0xe4eaf0, 0xf0e0c0];
      const g = this.add.graphics().setDepth(20);
      const bw = 290;
      const bh = 228;
      const top = groundY - bh;
      this._sceneMinY = Math.min(this._sceneMinY ?? 0, top - 30);
      const gap = 6;
      const roomW = (bw - 32 - gap) / 2;
      const doorStrip = 54;
      const upperH = 74;
      const lowerTop = top + 94;
      const lowerH = bh - (lowerTop - top) - doorStrip;
      const padX = left + 16;

      g.fillStyle(0x000000, 0.22);
      g.fillRect(left + 8, groundY - 6, bw, 10);
      g.fillStyle(pal.shell, 1);
      g.fillRect(left, top, bw, bh);
      g.fillStyle(pal.side, 1);
      g.fillRect(left + bw - 14, top, 14, bh);
      g.lineStyle(3, pal.stroke, 1);
      g.strokeRect(left, top, bw, bh);
      g.fillStyle(pal.roof, 1);
      g.fillRect(left - 6, top - 10, bw + 12, 12);
      g.lineStyle(3, pal.stroke, 1);
      g.strokeRect(left - 6, top - 10, bw + 12, 12);

      this.buildingTitle(left + bw / 2, top - 22, shortLabel(title, 22), {
        color: pal.titleFg, bg: pal.titleBg,
      });

      const grid = [
        { x: padX, y: top + 12, w: roomW, h: upperH },
        { x: padX + roomW + gap, y: top + 12, w: roomW, h: upperH },
        { x: padX, y: lowerTop, w: roomW, h: lowerH },
        { x: padX + roomW + gap, y: lowerTop, w: roomW, h: lowerH },
      ];

      channels.slice(0, 4).forEach((ch, idx) => {
        const slot = grid[idx];
        const roomKey = chKey(ch.id);
        const label = channelLabel(ch);
        this.cutawayRoom(g, slot.x, slot.y, slot.w, slot.h, this.roomWallColor(roomKey), () => {
          const floor = slot.y + slot.h - 2;
          this.decorateRoom(ch, slot.x, slot.y, slot.w, slot.h, floor);
          this.addRoomSlots(roomKey, this.slotPointsForRoom(slot.x, slot.w, floor, 3));
        });
        this.channelBadge(slot.x + 4, slot.y + 4, shortLabel(label, 16));
        this.registerFloor({
          id: roomKey,
          roomKey,
          floorY: slot.y + slot.h - 3,
          minX: slot.x + 8,
          maxX: slot.x + slot.w - 8,
          label,
        });
      });

      const firstKey = channels[0] ? chKey(channels[0].id) : null;
      const doorX = left + 40;
      const elevX = left + bw - 44;
      if (firstKey) {
        this.placeEntrance(g, doorX, groundY, 'door', pal.lintel, 26);
        this.registerDoor({ x: doorX, floorId: firstKey, radius: 18 });
      }
      if (channels[1]) {
        this.placeEntrance(g, elevX, groundY, 'elev', pal.lintel, 26);
        this.registerDoor({ x: elevX, floorId: chKey(channels[1].id), radius: 20 });
      }
      if (channels[0] && channels[2]) {
        this.registerStairs({
          x: padX + roomW * 0.5,
          fromFloorId: chKey(channels[2].id),
          toFloorId: chKey(channels[0].id),
          radius: 18,
        });
      }
      if (channels[1] && channels[3]) {
        this.registerStairs({
          x: padX + roomW + gap + roomW * 0.5,
          fromFloorId: chKey(channels[3].id),
          toFloorId: chKey(channels[1].id),
          radius: 18,
        });
      }
      if (channels[2] && channels[3]) {
        this.registerPassage({
          fromFloorId: chKey(channels[2].id),
          toFloorId: chKey(channels[3].id),
          x: padX + roomW + gap / 2,
          radius: 14,
        });
      }
      if (channels[0] && channels[1]) {
        this.registerPassage({
          fromFloorId: chKey(channels[0].id),
          toFloorId: chKey(channels[1].id),
          x: padX + roomW + gap / 2,
          radius: 14,
        });
      }

      this.stripLabel(left + bw / 2, groundY - doorStrip + 6, 'Text · ↑ enter', {
        color: '#e8ffe8', bg: '#1e4a2a',
      });
    }

    drawEmptyBuilding(left, groundY, guildName) {
      const g = this.add.graphics().setDepth(20);
      const bw = 290;
      const bh = 228;
      const top = groundY - bh;
      g.fillStyle(0x5865f2, 1);
      g.fillRect(left, top, bw, bh);
      g.lineStyle(3, 0x1a1f4a, 1);
      g.strokeRect(left, top, bw, bh);
      this.buildingTitle(left + bw / 2, top - 22, shortLabel(guildName, 20), {
        color: '#eef0ff', bg: '#3c45c0',
      });
      this.add.text(left + bw / 2, top + bh / 2, 'No channels yet\nAdd text or voice\nchannels in Discord', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '13px',
        color: '#eef0ff',
        align: 'center',
      }).setOrigin(0.5).setDepth(25).setResolution(2);
    }

    placeEntrance(g, cx, groundY, kind = 'door', lintelColor = 0x2a5534, depth = 26) {
      const key = kind === 'elev' ? 'elevClosed' : 'door';
      // Door leaf 13×23, elev 26×23 — keep character-scale, slim recess padding
      const scale = SCALE;
      const dw = (kind === 'elev' ? 26 : 13) * scale;
      const dh = 23 * scale;
      const frameW = Math.ceil(dw + 8);
      const frameH = Math.ceil(dh + 5);
      const fx = Math.round(cx - frameW / 2);
      const fy = Math.round(groundY - frameH);

      // Lintel / header brick
      g.fillStyle(lintelColor, 1);
      g.fillRect(fx - 2, fy - 5, frameW + 4, 6);
      g.lineStyle(2, 0x0a0806, 1);
      g.strokeRect(fx - 2, fy - 5, frameW + 4, 6);

      // Outer recess (deep shadow)
      g.fillStyle(0x0c0a08, 1);
      g.fillRect(fx, fy, frameW, frameH);

      // Side jambs (thin)
      g.fillStyle(0x3a2e22, 1);
      g.fillRect(fx, fy, 2, frameH);
      g.fillRect(fx + frameW - 2, fy, 2, frameH);

      // Back wall inside doorway
      g.fillStyle(0x1a1510, 1);
      g.fillRect(fx + 2, fy + 2, frameW - 4, frameH - 2);

      // Threshold sitting on ground
      g.fillStyle(0x2c2118, 1);
      g.fillRect(fx - 1, groundY - 2, frameW + 2, 3);
      g.fillStyle(0x000000, 0.22);
      g.fillRect(fx, groundY, frameW, 2);

      g.lineStyle(2, 0x0a0806, 1);
      g.strokeRect(fx, fy, frameW, frameH);

      this.add.image(cx, groundY - 1, key)
        .setScale(scale)
        .setOrigin(0.5, 1)
        .setDepth(depth);

      return { fx, fy, frameW, frameH, dw, dh };
    }

    /** Place furniture sitting on a floor line (origin bottom-center). */
    furn(key, x, floorY, depth = 23, scale = SCALE) {
      if (!this.textures.exists(key)) return null;
      return this.add.image(x, floorY, key)
        .setScale(scale)
        .setOrigin(0.5, 1)
        .setDepth(depth);
    }

    /** Place wall-mounted decor hanging from the room's top edge (origin top-center). */
    wallDecor(key, x, topY, depth = 21, scale = SCALE) {
      if (!this.textures.exists(key)) return null;
      return this.add.image(x, topY, key)
        .setScale(scale)
        .setOrigin(0.5, 0)
        .setDepth(depth);
    }

    /** Wall color for a room, deterministic per channel id. */
    roomWallColor(roomKey) {
      return ROOM_WALL_COLORS[hashSeed(roomKey) % ROOM_WALL_COLORS.length];
    }

    /**
     * Decorate a room with a channel-THEMED furniture kit (library/office/cafe/
     * lounge/...) chosen from the channel name + type, plus seeded wall decor.
     * Deterministic per channel id so a room always looks the same across reloads.
     */
    decorateRoom(ch, slotX, slotY, slotW, slotH, floorY) {
      const roomKey = chKey(ch.id);
      const seed = hashSeed(roomKey);
      const kitName = kitForChannel(ch.name, ch.type, seed);
      const kit = KITS[kitName] || KITS.lounge;

      kit.forEach((item, idx) => {
        const key = Array.isArray(item.key) ? seededPick(seed, item.key, idx * 7 + 1) : item.key;
        const x = slotX + item.xf * slotW;
        if (item.wall) {
          this.wallDecor(key, x, slotY + 6, item.depth, SCALE * (item.scaleMul || 1));
        } else {
          const sp = this.furn(key, x, floorY + (item.offY || 0), item.depth, SCALE * (item.scaleMul || 1));
          if (sp && item.offY) sp.setDepth(item.depth); // laptop-on-desk etc.
        }
      });

      // Back-wall decor — only when the room is tall enough (window ~30px at
      // SCALE 2). Window OR curtains, never stacked (both are bold in this pack).
      if (slotH >= 70) {
        const wallX = slotX + slotW * 0.5;
        const wallTop = slotY + 6;
        if (seed % 3 === 0) {
          const winKey = seededPick(seed, ['windowSq', 'windowCircle', 'windowGlass', 'windowSmall'], 11);
          this.wallDecor(winKey, wallX, wallTop, 21);
        } else if (seed % 3 === 1) {
          const curtainKey = seededPick(seed, ['curtain', 'curtainR', 'curtainB', 'curtainY'], 17);
          const spread = Math.min(slotW * 0.3, 34);
          this.wallDecor(curtainKey, wallX - spread, wallTop, 21);
          this.wallDecor(curtainKey, wallX + spread, wallTop, 21);
        } else {
          // clipboard/notice on the wall for a lived-in office/reception feel
          this.wallDecor('clipboard', wallX + slotW * 0.28, wallTop + 2, 21);
        }
      }
    }

    cutawayRoom(g, x, y, w, h, fill, decorate) {
      g.fillStyle(fill, 1);
      g.fillRect(x, y, w, h);
      g.fillStyle(0xc4a882, 1);
      g.fillRect(x + 1, y + h - 6, w - 2, 5);
      g.fillStyle(0x000000, 0.12);
      g.fillRect(x, y + h - 8, w, 2);
      g.lineStyle(3, 0x101010, 1);
      g.strokeRect(x, y, w, h);
      // Soft glass highlight (not fake window panes — each rectangle is one Discord channel)
      g.fillStyle(0xffffff, 0.1);
      g.fillRect(x + 3, y + 3, 8, h - 12);
      if (decorate) decorate();
    }

    makeAnims() {
      // Each NPC sheet is an 8-col x 14-row grid of 32x32 cells (frame index =
      // row*8+col). Row 0 = MOVE (4 real frames, cols 0-3, then a "MOVE" text
      // label drawn in col4 — NOT a 5th frame). Row 1 = IDLE (only 3 real
      // frames, cols 0-2; col3 holds the "IDLE" label). Including a label
      // column in the loop flashed the sheet's own text captions in-game.
      NPC_SHEETS.forEach((n) => {
        if (this.anims.exists(`${n.key}_walk`)) return;
        if (!this.textures.exists(n.key)) return;
        this.anims.create({
          key: `${n.key}_walk`,
          frames: this.anims.generateFrameNumbers(n.key, { start: 0, end: 3 }),
          frameRate: 8,
          repeat: -1,
        });
        this.anims.create({
          key: `${n.key}_idle`,
          frames: this.anims.generateFrameNumbers(n.key, { start: NPC_COLS, end: NPC_COLS + 2 }),
          frameRate: 2,
          repeat: -1,
        });
      });
    }

    /** Deterministic NPC sheet key for a user/seed, spread across all 30. */
    npcSheetFor(seedStr) {
      const list = NPC_SHEETS.filter((n) => this.textures.exists(n.key));
      if (!list.length) return NPC_SHEETS[0].key;
      return list[hashSeed(seedStr) % list.length].key;
    }

    spawnChar(x, y, sheet, idle, label, depth = 30) {
      const sp = this.add.sprite(x, y, sheet, 0)
        .setScale(SCALE)
        .setOrigin(0.5, NPC_FOOT_ORIGIN_Y)
        .setDepth(depth);
      sp.anims.play(idle);
      this.tweens.add({
        targets: sp,
        y: y - 1.5,
        duration: 700 + Math.random() * 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      if (label) {
        this.add.text(x, y - 22, label, {
          fontFamily: 'Segoe UI, Tahoma, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#000000',
          padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 1).setDepth(depth + 1).setResolution(3);
      }
      return sp;
    }

    addRoomSlots(roomKey, points) {
      if (!this.roomSlots) this.roomSlots = new Map();
      const list = this.roomSlots.get(roomKey) || [];
      for (const [x, y] of points) {
        list.push({ x, y, takenBy: null });
      }
      this.roomSlots.set(roomKey, list);
    }

    resolveRoomKey(person) {
      const cid = String(person.channelId || '').trim();
      if (cid) return chKey(cid);
      return null;
    }

    claimSlot(roomKey, userId) {
      const slots = this.roomSlots.get(roomKey) || [];
      let slot = slots.find((s) => s.takenBy === userId);
      if (slot) return slot;
      slot = slots.find((s) => !s.takenBy);
      if (!slot) {
        // Overflow: invent a nearby seat from first slot
        const base = slots[0] || { x: 100, y: this.groundY };
        const i = slots.length;
        slot = {
          x: base.x + (i % 5) * 14,
          y: base.y - Math.floor(i / 5) * 2,
          takenBy: null,
        };
        slots.push(slot);
        this.roomSlots.set(roomKey, slots);
      }
      slot.takenBy = userId;
      return slot;
    }

    releaseSlot(roomKey, userId) {
      const slots = this.roomSlots.get(roomKey) || [];
      for (const s of slots) {
        if (s.takenBy === userId) s.takenBy = null;
      }
    }

    setPresenceStatus(text, ok = true) {
      if (!this.presenceEl) return;
      this.presenceEl.textContent = text;
      this.presenceEl.dataset.ok = ok ? '1' : '0';
    }

    startPresenceLoop() {
      const tick = async () => {
        try {
          const res = await fetch(PRESENCE_URL, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          this.applyPresence(data);
          const voiceN = (data.people || []).filter((p) => p.channelType === 'voice' || p.channelType === 'stage').length;
          const textN = (data.people || []).length - voiceN;
          this.setPresenceStatus(`live · ${voiceN} in VC · ${textN} text`, true);
        } catch (err) {
          this.setPresenceStatus('offline · start discord-bot', false);
        }
      };
      tick();
      this.time.addEvent({ delay: PRESENCE_POLL_MS, loop: true, callback: tick });
    }

    applyPresence(data) {
      const want = new Map();
      for (const p of data.people || []) {
        const roomKey = this.resolveRoomKey(p);
        if (!roomKey) continue;
        want.set(String(p.userId), {
          userId: String(p.userId),
          displayName: String(p.displayName || 'member').slice(0, 16),
          roomKey,
          soft: !!p.soft || (p.channelType !== 'voice' && p.channelType !== 'stage'),
        });
      }

      // Despawn people who left
      for (const [userId, live] of [...this.livePeople.entries()]) {
        if (!want.has(userId)) {
          this.releaseSlot(live.roomKey, userId);
          live.sprite?.destroy();
          live.tag?.destroy();
          this.livePeople.delete(userId);
        }
      }

      // Spawn / move
      for (const [userId, person] of want) {
        const existing = this.livePeople.get(userId);
        if (existing && existing.roomKey !== person.roomKey) {
          this.releaseSlot(existing.roomKey, userId);
          existing.sprite?.destroy();
          existing.tag?.destroy();
          this.livePeople.delete(userId);
        }
        if (!this.livePeople.has(userId)) {
          this.spawnLivePerson(person);
        } else {
          const live = this.livePeople.get(userId);
          if (live.tag && live.tag.text !== person.displayName && live.tag.text !== `${person.displayName} (you)`) {
          const isMe = ME_DISCORD_ID && String(person.userId) === ME_DISCORD_ID;
          live.tag.setText(isMe ? `${person.displayName} (you)` : person.displayName);
          live.tag.setBackgroundColor(isMe ? '#16a34a' : (person.soft ? '#334155' : '#5865f2'));
        }
          live.sprite.setAlpha(person.soft ? 0.72 : 1);
        }
      }
    }

    spawnLivePerson(person) {
      const slot = this.claimSlot(person.roomKey, person.userId);
      const isMe = ME_DISCORD_ID && String(person.userId) === ME_DISCORD_ID;
      // Each real Discord user gets a distinct-but-stable avatar from the 30 sheets.
      const sheet = isMe ? this.playerSheet : this.npcSheetFor(String(person.userId));
      const idle = `${sheet}_idle`;
      const voiceRoom = person.roomKey && person.roomKey.startsWith('ch_') && person.soft === false;
      const depth = voiceRoom ? 34 : 30;
      const label = isMe ? `${person.displayName} (you)` : person.displayName;

      const sprite = this.add.sprite(slot.x, slot.y, sheet, 0)
        .setScale(SCALE)
        .setOrigin(0.5, NPC_FOOT_ORIGIN_Y)
        .setDepth(depth)
        .setAlpha(0);
      sprite.anims.play(idle);

      const tag = this.add.text(slot.x, slot.y - 40, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: isMe ? '#16a34a' : (person.soft ? '#334155' : '#5865f2'),
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5, 1).setDepth(depth + 1).setResolution(3).setAlpha(0);

      this.tweens.add({
        targets: [sprite, tag],
        alpha: person.soft ? 0.72 : 1,
        duration: 280,
        ease: 'Sine.easeOut',
      });
      this.tweens.add({
        targets: sprite,
        y: slot.y - 1.5,
        duration: 700 + Math.random() * 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.tweens.add({
        targets: tag,
        y: slot.y - 41.5,
        duration: 700 + Math.random() * 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.livePeople.set(person.userId, {
        sprite,
        tag,
        roomKey: person.roomKey,
        soft: person.soft,
      });
    }

    spawnDecorNpcs() {
      const mw = this.mapWidth || W;
      const avail = NPC_SHEETS.filter((n) => this.textures.exists(n.key) && n.key !== this.playerSheet);
      if (!avail.length) return;
      // A lively street: idle bystanders + a couple of strollers, all distinct
      // sprites, seeded by position so the crowd is stable across reloads.
      const idleSpots = [24, 96, mw * 0.42, mw - 60, mw - 150].filter((x) => x > 0 && x < mw);
      idleSpots.forEach((x, i) => {
        const sheet = avail[(hashSeed('idle' + i + Math.round(x)) % avail.length)].key;
        const sp = this.spawnChar(x, this.groundY, sheet, `${sheet}_idle`, null, 40);
        if (i % 2 === 0) sp.setFlipX(true);
      });
      // Two strollers pacing different stretches of the street.
      const strollers = mw > 500 ? [[mw * 0.55, mw * 0.68, 4200], [mw * 0.2, mw * 0.34, 5200]] : [];
      strollers.forEach(([x0, x1, dur], i) => {
        const sheet = avail[(hashSeed('walk' + i) % avail.length)].key;
        const walker = this.spawnChar(x0, this.groundY, sheet, `${sheet}_walk`, null, 40);
        this.tweens.add({
          targets: walker,
          x: x1,
          duration: dur,
          yoyo: true,
          repeat: -1,
          onYoyo: () => walker.setFlipX(true),
          onRepeat: () => walker.setFlipX(false),
        });
      });
    }

    registerFloor(def) {
      this.floors.set(def.id, def);
    }

    registerDoor(def) {
      this.doors.push({
        x: def.x,
        floorId: def.floorId,
        radius: def.radius || 16,
        outdoorX: def.outdoorX ?? def.x,
      });
    }

    registerStairs(def) {
      this.stairs.push({
        x: def.x,
        fromFloorId: def.fromFloorId,
        toFloorId: def.toFloorId,
        radius: def.radius || 18,
      });
    }

    registerPassage(def) {
      if (!this.passages) this.passages = [];
      const radius = def.radius || 12;
      this.passages.push({
        x: def.x,
        fromFloorId: def.fromFloorId,
        toFloorId: def.toFloorId,
        radius,
      });
      // Each room's walkable minX/maxX stops a few px short of the shared
      // wall, so the passage trigger point (sitting in that gap) was never
      // actually reachable — the per-frame clamp pinned the player just
      // short of it, so crossing silently failed or glitched. fromFloorId is
      // always the left-hand room and toFloorId the right-hand room at this
      // call site, so extend each room's bound toward the passage.
      const from = this.floors.get(def.fromFloorId);
      const to = this.floors.get(def.toFloorId);
      if (from) from.maxX = Math.max(from.maxX, def.x + radius);
      if (to) to.minX = Math.min(to.minX, def.x - radius);
    }

    setEnterHint(text) {
      if (this.hintEl) this.hintEl.textContent = text || '';
    }

    nearbyDoor() {
      if (this.indoors) return null;
      const px = this.player.x;
      let best = null;
      let bestD = 999;
      for (const d of this.doors) {
        const dist = Math.abs(px - d.x);
        if (dist <= d.radius && dist < bestD) {
          best = d;
          bestD = dist;
        }
      }
      return best;
    }

    nearbyStairs() {
      if (!this.indoors) return null;
      const px = this.player.x;
      const cur = this.indoors.floorId;
      for (const s of this.stairs) {
        if (Math.abs(px - s.x) > s.radius) continue;
        if (s.fromFloorId === cur) return { ...s, targetFloorId: s.toFloorId, dir: 'up' };
        if (s.toFloorId === cur) return { ...s, targetFloorId: s.fromFloorId, dir: 'down' };
      }
      return null;
    }

    nearbyPassage() {
      if (!this.indoors || !this.passages) return null;
      const px = this.player.x;
      const cur = this.indoors.floorId;
      for (const p of this.passages) {
        if (Math.abs(px - p.x) > p.radius) continue;
        if (p.fromFloorId === cur) return { ...p, targetFloorId: p.toFloorId };
        if (p.toFloorId === cur) return { ...p, targetFloorId: p.fromFloorId };
      }
      return null;
    }

    enterFloor(floorId, fromOutdoorX = null) {
      const floor = this.floors.get(floorId);
      if (!floor) return;
      const outdoorX = fromOutdoorX != null ? fromOutdoorX : this.player.x;
      this.indoors = { floorId, outdoorX };
      const spawnX = Phaser.Math.Clamp(this.player.x, floor.minX, floor.maxX);
      this.player.setPosition(spawnX, floor.floorY);
      this.player.setDepth(44);
      this.playerTag.setDepth(45);
      this.cameras.main.setZoom(this.indoorZoom);
      this.setEnterHint(defaultIndoorHint());
    }

    leaveBuilding() {
      if (!this.indoors) return;
      const outX = this.indoors.outdoorX;
      this.indoors = null;
      this.player.setPosition(outX, this.groundY - 1);
      this.player.setDepth(45);
      this.playerTag.setDepth(46);
      this.cameras.main.setZoom(this.outdoorZoom);
      this.setEnterHint(defaultOutdoorHint());
    }

    goToFloor(floorId) {
      const floor = this.floors.get(floorId);
      if (!floor || !this.indoors) return;
      this.indoors.floorId = floorId;
      const x = Phaser.Math.Clamp(this.player.x, floor.minX, floor.maxX);
      this.player.setPosition(x, floor.floorY);
    }

    tryEnterExit() {
      if (this.enterCooldown > 0) return;
      const touch = touchInput();
      const up = Phaser.Input.Keyboard.JustDown(this.cursors.up)
        || Phaser.Input.Keyboard.JustDown(this.wasd.up)
        || (touch && touch.consumeEnter());
      const down = Phaser.Input.Keyboard.JustDown(this.cursors.down)
        || Phaser.Input.Keyboard.JustDown(this.wasd.down)
        || (touch && touch.consumeExit());

      if (!this.indoors) {
        if (up) {
          const door = this.nearbyDoor();
          if (door) {
            this.enterFloor(door.floorId, door.outdoorX);
            this.enterCooldown = 220;
          }
        }
        return;
      }

      const stairs = this.nearbyStairs();
      if (up && stairs && stairs.dir === 'up') {
        this.goToFloor(stairs.targetFloorId);
        this.enterCooldown = 220;
        return;
      }
      if (down && stairs && stairs.dir === 'down') {
        this.goToFloor(stairs.targetFloorId);
        this.enterCooldown = 220;
        return;
      }
      if (down) {
        this.leaveBuilding();
        this.enterCooldown = 220;
      }
    }

    update() {
      if (!this.player?.body) return;
      if (this.enterCooldown > 0) this.enterCooldown -= this.game.loop.delta;

      this.tryEnterExit();

      let vx = 0;
      const touch = touchInput();
      if (this.cursors.left.isDown || this.wasd.left.isDown || touch?.left) vx = -1;
      if (this.cursors.right.isDown || this.wasd.right.isDown || touch?.right) vx = 1;
      this.player.setVelocityX(vx * 110);

      if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        if (floor) {
          this.player.y = floor.floorY;
          // Soft room edges — auto-cross passages
          const passage = this.nearbyPassage();
          if (passage && ((vx > 0 && this.player.x > passage.x - 2) || (vx < 0 && this.player.x < passage.x + 2))) {
            const next = this.floors.get(passage.targetFloorId);
            if (next) {
              this.indoors.floorId = passage.targetFloorId;
              this.player.y = next.floorY;
            }
          }
          const cur = this.floors.get(this.indoors.floorId);
          if (cur) {
            this.player.x = Phaser.Math.Clamp(this.player.x, cur.minX, cur.maxX);
          }
        }
      } else {
        this.player.y = this.groundY - 1;
      }

      if (vx) {
        this.player.anims.play(`${this.playerSheet}_walk`, true);
        this.player.setFlipX(vx < 0);
      } else {
        this.player.anims.play(`${this.playerSheet}_idle`, true);
      }
      this.playerTag.setPosition(this.player.x, this.player.y - 34);

      // Zone label
      let zone = 'lobby';
      if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        zone = floor?.label || this.indoors.floorId;
        const n = [...this.livePeople.values()].filter((p) => p.roomKey === floor?.roomKey).length;
        if (n) zone = `${zone} (${n})`;
        const doorHint = this.nearbyStairs();
        if (doorHint?.dir === 'up') this.setEnterHint(IS_TOUCH ? '▲ go upstairs' : '↑ climb upstairs');
        else if (doorHint?.dir === 'down') this.setEnterHint(IS_TOUCH ? '▼ go downstairs · or leave' : '↓ go downstairs · or leave');
        else this.setEnterHint(defaultIndoorHint());
      } else {
        const x = this.player.x;
        if (this.nearbyDoor()) this.setEnterHint(IS_TOUCH ? '▲ enter building' : '↑ / W enter building');
        else {
          const b = (this.buildings || []).find((bd) => x >= bd.left - 10 && x <= bd.right + 10);
          if (b) {
            const names = (b.channels || []).slice(0, 2).map((c) => channelLabel(c)).join(' · ');
            zone = names || b.label || b.kind;
            this.setEnterHint(IS_TOUCH ? 'Walk to door · ▲ enter' : 'Walk to a door · ↑ enter');
          } else if (x > (this.mapWidth || W) - 120) {
            zone = 'AFK · park';
            this.setEnterHint('');
          } else {
            this.setEnterHint(defaultOutdoorHint());
          }
        }
      }
      if (this.roomEl) this.roomEl.textContent = zone;
    }
  }

  function bootPhaser() {
    const host = document.getElementById('game-host');
    const bootW = Math.max(W, host?.clientWidth || W);
    const bootH = Math.max(H, host?.clientHeight || H);

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: bootW,
      height: bootH,
      backgroundColor: '#7ec8e8',
      pixelArt: false,
      antialias: true,
      roundPixels: true,
      physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
      scale: {
        mode: Phaser.Scale.ENVELOP,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: W,
        height: H,
      },
      scene: ExampleMapScene,
    });

    window.addEventListener('resize', () => {
      try { game.scale.refresh(); } catch (_) { /* ignore */ }
    });

    if (host && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        try { game.scale.refresh(); } catch (_) { /* ignore */ }
      });
      ro.observe(host);
    }
  }

  requestAnimationFrame(() => requestAnimationFrame(bootPhaser));
})();
