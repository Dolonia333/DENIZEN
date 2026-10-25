/* aislop-ignore-file complexity/file-too-large — tracked decomposition; see .aislop/config.yml */
/* Pixel Spaces side-view — polished closer to itch example */
(() => {
  const PACK = './PixelSpaces';
  const FULL = './PixelSpacesFull';
  const IA = `${FULL}/Individual Assets`;
  const EXP = `${FULL}/Expansions`;
  const PACKS_EXTRA = './PacksExtra';
  // Official UI pack folders (https://netherzapdos.itch.io/pixel-spaces)
  const UI_ROOT = `${FULL}/UI`;
  const UI_BTN = `${UI_ROOT}/Buttons, Sliders, Panels, Frames, Selection`;
  const UI_EMOTE = `${UI_ROOT}/Emotes`;
  const UI_BUBBLE = `${UI_ROOT}/Chat Bubbles`;
  const UI_ICON = `${UI_ROOT}/Icons`;
  const UI_CURSOR = `${UI_ROOT}/Cursor`;
  const W = 980;
  const H = 420;
  const SCALE = 2;

  /** Channel id → room slot key on the map. */
  function chKey(channelId) {
    return `ch_${String(channelId || '').trim()}`;
  }

  /** Full Discord channel label (emoji preserved) for tooltips / zone HUD. */
  function channelLabel(ch) {
    const name = String(ch?.name || 'channel');
    const type = String(ch?.type || '').toLowerCase();
    if (type === 'voice' || type === 'stage') return `🔊 ${name}`;
    return `#${name}`;
  }

  /** Strip decorative emoji/symbols so facade plaques stay readable. */
  function displayChannelName(raw) {
    let s = String(raw || '');
    try {
      s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '');
      s = s.replace(/[^\p{L}\p{N}\s\-_.]/gu, '');
    } catch (_) {
      s = s.replace(/[^\w\s\-_.]/g, '');
    }
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^[\s\-_.]+|[\s\-_.]+$/g, '').trim();
    return s || 'channel';
  }

  /** Short plaque text from a channel or from an existing channelLabel string. */
  function plaqueChannelLabel(chOrLabel) {
    if (chOrLabel && typeof chOrLabel === 'object') {
      const type = String(chOrLabel.type || '').toLowerCase();
      const clean = displayChannelName(chOrLabel.name);
      if (type === 'voice' || type === 'stage') return clean;
      return `#${clean}`;
    }
    let s = String(chOrLabel || '');
    const voice = /^🔊/.test(s);
    if (voice) s = s.replace(/^🔊\s*/, '');
    if (s.startsWith('#')) s = s.slice(1);
    const clean = displayChannelName(s);
    return voice ? clean : `#${clean}`;
  }

  function graphemes(text) {
    const s = String(text || '');
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
      }
    } catch (_) { /* ignore */ }
    return Array.from(s);
  }

  function shortLabel(text, max = 18) {
    const chars = graphemes(text);
    if (chars.length <= max) return chars.join('');
    return `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
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

  const MAP_GRANT = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get('map_grant');
      if (q) return String(q).trim();
    } catch (_) { /* ignore */ }
    try {
      const stored = JSON.parse(localStorage.getItem('denizen-discord-map') || '{}');
      return String(stored.mapGrant || stored.map_grant || '').trim();
    } catch (_) {
      return '';
    }
  })();

  // Denizen visitor session — same key index.html's saveSession() writes.
  // Lets the server resolve "is this viewer a tracked member of this guild"
  // for the membership access path, alongside the team-code MAP_GRANT above.
  const SESSION = (() => {
    try {
      const stored = JSON.parse(localStorage.getItem('denizen-discord-session') || '{}');
      return {
        id: String(stored.session_id || '').trim(),
        token: String(stored.session_token || '').trim(),
      };
    } catch (_) {
      return { id: '', token: '' };
    }
  })();

  const PRESENCE_URL = (() => {
    const pageGuildId = (() => {
      try {
        return String(new URLSearchParams(window.location.search).get('guildId') || '').trim();
      } catch (_) {
        return '';
      }
    })();
    const withAuth = (raw) => {
      try {
        const u = new URL(raw, location.origin);
        if (pageGuildId && !u.searchParams.get('guildId')) {
          u.searchParams.set('guildId', pageGuildId);
        }
        if (MAP_GRANT && !u.searchParams.get('map_grant')) {
          u.searchParams.set('map_grant', MAP_GRANT);
        }
        return u.toString();
      } catch (_) {
        return raw;
      }
    };
    try {
      const q = new URLSearchParams(window.location.search).get('presence');
      if (q) return withAuth(q);
    } catch (_) { /* ignore */ }
    try {
      const stored = JSON.parse(localStorage.getItem('denizen-discord-map') || '{}');
      if (stored.presenceUrlResolved) return withAuth(stored.presenceUrlResolved);
      if (stored.presenceUrl) {
        const gid = pageGuildId || stored.guildId;
        try {
          const u = new URL(stored.presenceUrl);
          if (!u.pathname || u.pathname === '/') u.pathname = '/presence';
          if (gid) u.searchParams.set('guildId', gid);
          return withAuth(u.toString());
        } catch (_) {
          return withAuth(stored.presenceUrl);
        }
      }
    } catch (_) { /* ignore */ }
    // Prefer the Denizen server proxy (works even when the bot presence
    // sidecar on :5180 is down / EADDRINUSE). Bot direct URL is a fallback.
    return withAuth(`${location.origin}/api/discord/map/presence`);
  })();
  const PRESENCE_POLL_MS = 1500;

  function presenceFetchInit() {
    const headers = {};
    if (MAP_GRANT) headers['x-map-grant'] = MAP_GRANT;
    // Session id alone is enough — Discord demo logins never mint a session
    // token, and requiring both locked those viewers out of the membership
    // path (server verifies the token only when the session has one stored).
    if (SESSION.id) {
      headers['x-session-id'] = SESSION.id;
      if (SESSION.token) headers['x-session-token'] = SESSION.token;
    }
    return { cache: 'no-store', headers };
  }

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
    return IS_TOUCH
      ? '◀ ▶ rooms · ▲ climb · hold ▲ sit · ▼ leave'
      : 'A/D rooms · ↑ climb floors/roof · E sit · ↓ leave';
  }

  /** Furniture keys the player can sit / lie on. */
  const SIT_KEYS = new Set([
    'couchBlue', 'couchGreen', 'couchRed', 'couchGrey', 'couchYellow', 'couchDark',
    'couchSmall', 'couchSmallG', 'couchSmallR', 'couchSmallY', 'couchSmallGr',
    'officechairBlue', 'officechairRed', 'officechairPurple', 'officechairOrange',
    'stoolBlue', 'stoolRed', 'stoolYellow', 'stoolGreen', 'stool', 'stoolB',
    'bed', 'bedBlue', 'bedGreen', 'bedRed', 'bedYellow', 'bedHosp', 'bunkBottom',
    'throneRed', 'throneBlue', 'throneGreen', 'thronePurple', 'throneYellow',
    'chairHalloween', 'waitChairSolo', 'waitChairSoloRed',
  ]);
  const BED_KEYS = new Set(['bed', 'bedBlue', 'bedGreen', 'bedRed', 'bedYellow', 'bedHosp', 'bunkBottom', 'bunkTop']);

  const LR = `${PACK}/Furniture/Living Room`;
  const KIT = `${PACK}/Furniture/Kitchen`;
  const BR = `${PACK}/Furniture/Bedroom`;
  const BA = `${PACK}/Furniture/Bathroom`;
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
    housePurple: `${BG}/House_small_purple.png`,
    houseYellow: `${BG}/House_small_yellow.png`,
    shopBlue: `${BG}/Shop_blue.png`,
    shopRed: `${BG}/Shop_red.png`,
    bush: `${BG}/Bush.png`,
    bushBerry: `${BG}/Bush_berry.png`,
    // Infrastructure (interaction anchors — keep intact)
    // Pack *_closed.png are edge-on 3–6px slivers (side view). Front-facing
    // closed art is *_double.png (25×22). *_opened.png is the ajar leaf.
    // Runtime canvas doorFrontClosed remains a fallback if pack keys miss.
    door: `${INF}/Door_wood_opened.png`,
    doorClosed: `${INF}/Door_wood_closed.png`,
    doorOpen: `${INF}/Door_wood_opened.png`,
    doorWoodDouble: `${INF}/Door_wood_double.png`,
    doorGlass: `${INF}/Door_glass_closed.png`,
    doorGlassOpen: `${INF}/Door_glass_opened.png`,
    doorGlassDouble: `${INF}/Door_glass_double.png`,
    doorGreyOpen: `${INF}/Door_grey_opened.png`,
    doorGreyDouble: `${INF}/Door_grey_double.png`,
    doorGreyClosed: `${INF}/Door_grey_closed.png`,
    elevClosed: `${INF}/Elevator_closed.png`,
    elevOpen: `${INF}/Elevator_opened.png`,
    elevSlightly: `${INF}/Elevator_slightlyOpened.png`,
    roofVents1: `${INF}/Roof_vents_1.png`,
    roofVents2: `${INF}/Roof_vents_2.png`,
    treeRoof1: `${BG}/Tree_rooftop_1.png`,
    treeRoof2: `${BG}/Tree_rooftop_2.png`,
    treeRoofAutumn1: `${BG}/Tree_rooftop_autumn_1.png`,
    treeRoofAutumn2: `${BG}/Tree_rooftop_autumn_2.png`,
    craneRoof: `${BG}/Crane_rooftop.png`,
    // Roof family 1 = tall gable shingles · family 2 = low flat cap (Pixel Spaces)
    // Snow piles layer on top of either family.
    roofSnowC1: `${INF}/Roof_snowpile_connecting_1.png`,
    roofSnowC2: `${INF}/Roof_snowpile_connecting_2.png`,
    roofSnowC3: `${INF}/Roof_snowpile_connecting_3.png`,
    roofSnowE: `${INF}/Roof_snowpile_end.png`,
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
    // Bedroom extras — color beds + wall/surface dressing
    bedRed: `${BR}/Bed_red_front.png`,
    bedYellow: `${BR}/Bed_yellow_front.png`,
    alarmBlue: `${OBR}/Alarm_clock_blue.png`,
    alarmRed: `${OBR}/Alarm_clock_red.png`,
    alarmGreen: `${OBR}/Alarm_clock_green.png`,
    airCon: `${OBR}/Air_conditioner.png`,
    calendar1: `${OBR}/Calendar_1.png`,
    calendar2: `${OBR}/Calendar_2.png`,
    // Bathroom family (previously entirely unused in the pack)
    bathtub: `${BA}/Bathtub.png`,
    glassShower: `${BA}/Glass_shower.png`,
    sinkBath: `${BA}/Sink_bathroom.png`,
    toilet: `${BA}/Toilet.png`,
    towelRail: `${BA}/Towel_rail_multi.png`,
    washMachine: `${BA}/Washing_machine.png`,
    // Sky traffic — blimps + hot-air balloons drift across the skyline
    blimpGreen: `${BG}/Blimp_green.png`,
    blimpPurple: `${BG}/Blimp_purple.png`,
    blimpYellow: `${BG}/Blimp_yellow.png`,
    balloonBlue: `${BG}/Hot_air_balloon_blue.png`,
    balloonGreen: `${BG}/Hot_air_balloon_green.png`,
    balloonPurple: `${BG}/Hot_air_balloon_purple.png`,
    balloonRed: `${BG}/Hot_air_balloon_red.png`,
    balloonYellow: `${BG}/Hot_air_balloon_yellow.png`,
    // Halloween biome — grey storm clouds over spooky sections
    cloudGrey1: `${EXP}/Halloween/Individual Assets/Cloud_grey_1.png`,
    cloudGrey2: `${EXP}/Halloween/Individual Assets/Cloud_grey_2.png`,
    cloudGrey3: `${EXP}/Halloween/Individual Assets/Cloud_grey_3.png`,
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

    // ---- Full-pack expansion themes (category buildings) ----
    tableMed2: `${IA}/Furniture/Living Room/Table_medium_2.png`,
    shelfMed: `${IA}/Furniture/Living Room/Shelf_medium.png`,
    stool: `${IA}/Furniture/Living Room/Stool_red.png`,
    stoolB: `${IA}/Furniture/Living Room/Stool_blue.png`,
    monitor: `${IA}/Objects/Bedroom/Monitor.png`,
    pc: `${IA}/Objects/Bedroom/PC.png`,
    gameConsole: `${IA}/Objects/Bedroom/Game_console.png`,
    trophy: `${IA}/Objects/Bedroom/Trophy.png`,
    trashcanFull: `${IA}/Objects/Living Room/Trashcan.png`,
    floraFernFull: `${IA}/Objects/Living Room/Flora_fern.png`,
    floraBonsaiFull: `${IA}/Objects/Living Room/Flora_bonsai.png`,
    mug: `${IA}/Objects/Kitchen/Mug.png`,
    glassJuice: `${IA}/Objects/Kitchen/Glass_juice.png`,
    benchWood: `${IA}/Backgrounds/Bench_wooden.png`,
    treeWinterSnow: `${IA}/Backgrounds/Tree_winter_large_snow.png`,
    treeWinterMed: `${IA}/Backgrounds/Tree_winter_medium_snow.png`,
    rockMed: `${IA}/Backgrounds/Rock_medium_1.png`,
    rockSm: `${IA}/Backgrounds/Rock_small_1.png`,
    signWood: `${IA}/Backgrounds/Sign_wooden.png`,
    bunkBottom: `${IA}/Furniture/Bedroom/Bunkbed_bottom_front_red.png`,
    bunkTop: `${IA}/Furniture/Bedroom/Bunkbed_top_front_red.png`,
    cabinetFull: `${IA}/Furniture/Bedroom/Cabinet_1.png`,

    cafeSign: `${EXP}/Cafe/Individual Assets/Sign_cafe_large.png`,
    cafeSignBoard: `${EXP}/Cafe/Individual Assets/Sign_cafe_board.png`,
    pastryPink: `${EXP}/Cafe/Individual Assets/Display_pastry_pink.png`,
    pastryBlue: `${EXP}/Cafe/Individual Assets/Display_pastry_blue.png`,
    pastryYellow: `${EXP}/Cafe/Individual Assets/Display_pastry_yellow.png`,
    posterDonut1: `${EXP}/Cafe/Individual Assets/Poster_donut_1.png`,
    posterDonut2: `${EXP}/Cafe/Individual Assets/Poster_donut_4.png`,
    plantHang: `${EXP}/Cafe/Individual Assets/Plant_pot_hanging.png`,
    plantLarge: `${EXP}/Cafe/Individual Assets/Plant_potted_large.png`,
    umbrellaRed: `${EXP}/Cafe/Individual Assets/Umbrella_outdoor_red.png`,
    umbrellaGreen: `${EXP}/Cafe/Individual Assets/Umbrella_outdoor_green.png`,

    arcadeBlue: `${EXP}/Gamer Room/Individual Assets/Arcade_machine_blue.png`,
    arcadeRed: `${EXP}/Gamer Room/Individual Assets/Arcade_machine_red.png`,
    arcadeGreen: `${EXP}/Gamer Room/Individual Assets/Arcade_machine_green.png`,
    arcadeYellow: `${EXP}/Gamer Room/Individual Assets/Arcade_machine_yellow.png`,
    throneRed: `${EXP}/Gamer Room/Individual Assets/Throne_gaming_red.png`,
    throneBlue: `${EXP}/Gamer Room/Individual Assets/Throne_gaming_blue.png`,
    tvGame: `${EXP}/Gamer Room/Individual Assets/TV_mounted_game.png`,
    vendingBlue: `${EXP}/Gamer Room/Individual Assets/Vending_machine_blue.png`,
    vendingRed: `${EXP}/Gamer Room/Individual Assets/Vending_machine_red.png`,
    gLight1: `${EXP}/Gamer Room/Individual Assets/Lights_gaming_triangle_1_purple.png`,
    gLight2: `${EXP}/Gamer Room/Individual Assets/Lights_gaming_triangle_3_blue.png`,
    gLight3: `${EXP}/Gamer Room/Individual Assets/Lights_gaming_triangle_5_green.png`,
    poster10: `${EXP}/Gamer Room/Individual Assets/Poster_10.png`,
    poster11: `${EXP}/Gamer Room/Individual Assets/Poster_11.png`,
    headsetBlue: `${EXP}/Gamer Room/Individual Assets/Headset_gaming_blue.png`,
    micDesk: `${EXP}/Gamer Room/Individual Assets/Microphone_desktop.png`,

    hospSign: `${EXP}/Hospital/Individual Assets/Hospital_sign_large.png`,
    hospLogo: `${EXP}/Hospital/Individual Assets/Hospital_logo.png`,
    bedHosp: `${EXP}/Hospital/Individual Assets/Bed_hospital_front.png`,
    salineStand: `${EXP}/Hospital/Individual Assets/Saline_stand.png`,
    tableSurgery: `${EXP}/Hospital/Individual Assets/Table_surgery.png`,
    tableSteel: `${EXP}/Hospital/Individual Assets/Table_stainless_steel.png`,
    lightSurgery: `${EXP}/Hospital/Individual Assets/Light_surgery_white.png`,
    lightSurgeryBlack: `${EXP}/Hospital/Individual Assets/Light_surgery_black.png`,
    storageMed: `${EXP}/Hospital/Individual Assets/Storage_medical_white.png`,
    computerMed: `${EXP}/Hospital/Individual Assets/Computer_medical_white.png`,
    monitorMedWall: `${EXP}/Hospital/Individual Assets/Monitor_medical_mounted_white.png`,
    monitorMed: `${EXP}/Hospital/Individual Assets/Monitor_medical_white.png`,
    monitorMedBlack: `${EXP}/Hospital/Individual Assets/Monitor_medical_black.png`,
    posterMed: `${EXP}/Hospital/Individual Assets/Poster_medical.png`,

    triceratops: `${EXP}/Museum/Individual Assets/Skeleton_triceratops.png`,
    pillarMuseum: `${EXP}/Museum/Individual Assets/Pillar_museum.png`,
    platformMuseum: `${EXP}/Museum/Individual Assets/Platform_museum.png`,
    statueF: `${EXP}/Museum/Individual Assets/Statue_female.png`,
    statueM: `${EXP}/Museum/Individual Assets/Statue_male.png`,
    monaPixa: `${EXP}/Museum/Individual Assets/Painting_mona_pixa.png`,
    paintingNight: `${EXP}/Museum/Individual Assets/Painting_blocky_night.png`,
    guardRail: `${EXP}/Museum/Individual Assets/Guard_rail_connecting_both.png`,
    itemDisplayL: `${EXP}/Museum/Individual Assets/Item_display_large.png`,
    itemDisplayM: `${EXP}/Museum/Individual Assets/Item_display_medium.png`,
    meteorite1: `${EXP}/Museum/Individual Assets/Meteorite_1.png`,
    megalodonJaw: `${EXP}/Museum/Individual Assets/Megalodon_jaw.png`,
    spaceship: `${EXP}/Museum/Individual Assets/Spaceship.png`,
    sun: `${EXP}/Museum/Individual Assets/Sun.png`,
    earth: `${EXP}/Museum/Individual Assets/Earth.png`,
    mars: `${EXP}/Museum/Individual Assets/Mars.png`,
    jupiter: `${EXP}/Museum/Individual Assets/Jupiter.png`,
    saturn: `${EXP}/Museum/Individual Assets/Saturn.png`,
    neptune: `${EXP}/Museum/Individual Assets/Neptune.png`,
    lightFixture: `${EXP}/Museum/Individual Assets/Light_fixture_1.png`,

    policeSign: `${EXP}/Police Station/Individual Assets/Police_sign_large.png`,
    policeLogo: `${EXP}/Police Station/Individual Assets/Policestation_logo.png`,
    policeDesk: `${EXP}/Police Station/Individual Assets/Police_lobby_desk.png`,
    deskOffice: `${EXP}/Police Station/Individual Assets/Desk_office_medium.png`,
    deskOfficeLong: `${EXP}/Police Station/Individual Assets/Desk_office_long.png`,
    filecabinet: `${EXP}/Police Station/Individual Assets/Filecabinet.png`,
    paperStack: `${EXP}/Police Station/Individual Assets/Paper_stack.png`,
    posterWanted: `${EXP}/Police Station/Individual Assets/Poster_wanted.png`,
    posterWanted2: `${EXP}/Police Station/Individual Assets/Poster_wanted_2.png`,
    portraitOfficer: `${EXP}/Police Station/Individual Assets/Portrait_officer_1.png`,
    waitChairs: `${EXP}/Police Station/Individual Assets/WaitingChair_grouped.png`,
    waitChairSolo: `${EXP}/Police Station/Individual Assets/WaitingChair_solo.png`,
    prisonDoor: `${EXP}/Police Station/Individual Assets/Door_prison_closed.png`,
    clipboardWallSmall: `${EXP}/Police Station/Individual Assets/Clipboard_wall_small.png`,

    fireSign: `${EXP}/Fire Station/Individual Assets/Firestation_sign_large.png`,
    fireLogo: `${EXP}/Fire Station/Individual Assets/Firestation_logo.png`,
    locker: `${EXP}/Fire Station/Individual Assets/Locker.png`,
    uniformHang: `${EXP}/Fire Station/Individual Assets/FirefighterUniform_hanging.png`,
    uniformHang2: `${EXP}/Fire Station/Individual Assets/FirefighterUniform_hanging_2.png`,
    rackEquip: `${EXP}/Fire Station/Individual Assets/Rack_equipment.png`,
    fireExt: `${EXP}/Fire Station/Individual Assets/FireExtinguisher.png`,
    fireHydrant: `${EXP}/Fire Station/Individual Assets/FireHydrant.png`,
    fireAlarm: `${EXP}/Fire Station/Individual Assets/FireAlarm.png`,
    hoseWall: `${EXP}/Fire Station/Individual Assets/Hose_wall_long.png`,
    framedCert: `${EXP}/Fire Station/Individual Assets/FramedCertification.png`,
    boxEmergency: `${EXP}/Fire Station/Individual Assets/Box_emergency.png`,
    portraitFF: `${EXP}/Fire Station/Individual Assets/Portrait_firefighter_1.png`,

    coffin: `${EXP}/Halloween/Individual Assets/Coffin.png`,
    candelabra: `${EXP}/Halloween/Individual Assets/Candles_1.png`,
    candleTable: `${EXP}/Halloween/Individual Assets/Candle_table_1.png`,
    chandelier: `${EXP}/Halloween/Individual Assets/Chandelier_candle.png`,
    cobwebRoom: `${EXP}/Halloween/Individual Assets/Cobweb_room_1.png`,
    cobwebRoom2: `${EXP}/Halloween/Individual Assets/Cobweb_room_2.png`,
    jack1: `${EXP}/Halloween/Individual Assets/JackOLantern_1.png`,
    jack2: `${EXP}/Halloween/Individual Assets/JackOLantern_2.png`,
    pumpkinBasket: `${EXP}/Halloween/Individual Assets/Pumpkin_basket_1.png`,
    portraitDracula: `${EXP}/Halloween/Individual Assets/Portrait_dracula.png`,
    bookshelfDark: `${EXP}/Halloween/Individual Assets/Bookshelf_dark.png`,
    chairHalloween: `${EXP}/Halloween/Individual Assets/Chair_halloween_theme.png`,
    lampGhost: `${EXP}/Halloween/Individual Assets/Lamp_stand_ghost.png`,
    lanternHang: `${EXP}/Halloween/Individual Assets/Lantern_hanging_1.png`,
    treeDeadL: `${EXP}/Halloween/Individual Assets/Tree_dead_large.png`,
    treeDeadM: `${EXP}/Halloween/Individual Assets/Tree_dead_medium.png`,
    moonHW: `${EXP}/Halloween/Individual Assets/Moon.png`,
    ghost1: `${EXP}/Halloween/Individual Assets/Ghost_1.png`,
    bat1: `${EXP}/Halloween/Individual Assets/Bat_1.png`,
    lampPostHW: `${EXP}/Halloween/Individual Assets/LampPost.png`,
    billboardPumpkin: `${EXP}/Halloween/Individual Assets/Billboard_pumpkin.png`,

    xmasTree: `${EXP}/Winter 2023/Individual Assets/XmasTree_decorated.png`,
    snowman1: `${EXP}/Winter 2023/Individual Assets/SnowMan_1.png`,
    snowman2: `${EXP}/Winter 2023/Individual Assets/SnowMan_2.png`,
    snowman3: `${EXP}/Winter 2024/Individual Assets/Snowman_3.png`,
    presentRedL: `${EXP}/Winter 2023/Individual Assets/Present_red_large.png`,
    presentGreenL: `${EXP}/Winter 2023/Individual Assets/Present_green_large.png`,
    presentBlueS: `${EXP}/Winter 2023/Individual Assets/Present_blue_small.png`,
    santaSleigh: `${EXP}/Winter 2024/Individual Assets/SantaSleigh_gifts.png`,
    candyCaneL: `${EXP}/Winter 2023/Individual Assets/CandyCane_large.png`,
    candyStatueR: `${EXP}/Winter 2024/Individual Assets/CandyCane_statue_red_1.png`,
    candyStatueG: `${EXP}/Winter 2024/Individual Assets/CandyCane_statue_green_1.png`,
    snowfort: `${EXP}/Winter 2024/Individual Assets/Snowfort.png`,
    snowballs: `${EXP}/Winter 2024/Individual Assets/Snowballs.png`,
    sled: `${EXP}/Winter 2023/Individual Assets/Sled.png`,
    lampPostW: `${EXP}/Winter 2023/Individual Assets/LampPost.png`,

    // — seeded per-room color/style variants (picked by channel id, so a
    //   given room always looks the same but sibling rooms differ) —
    pastryGreen: `${EXP}/Cafe/Individual Assets/Display_pastry_green.png`,
    pastryRed: `${EXP}/Cafe/Individual Assets/Display_pastry_red.png`,
    pastryPurple: `${EXP}/Cafe/Individual Assets/Display_pastry_purple.png`,
    pastryWhite: `${EXP}/Cafe/Individual Assets/Display_pastry_white.png`,
    posterDonut3: `${EXP}/Cafe/Individual Assets/Poster_donut_2.png`,
    posterDonut4: `${EXP}/Cafe/Individual Assets/Poster_donut_3.png`,
    posterDonut5: `${EXP}/Cafe/Individual Assets/Poster_donut_5.png`,
    umbrellaBlue: `${EXP}/Cafe/Individual Assets/Umbrella_outdoor_blue.png`,
    umbrellaYellow: `${EXP}/Cafe/Individual Assets/Umbrella_outdoor_yellow.png`,

    throneGreen: `${EXP}/Gamer Room/Individual Assets/Throne_gaming_green.png`,
    thronePurple: `${EXP}/Gamer Room/Individual Assets/Throne_gaming_purple.png`,
    throneYellow: `${EXP}/Gamer Room/Individual Assets/Throne_gaming_yellow.png`,
    vendingGreen: `${EXP}/Gamer Room/Individual Assets/Vending_machine_green.png`,
    vendingOrange: `${EXP}/Gamer Room/Individual Assets/Vending_machine_orange.png`,
    vendingYellow: `${EXP}/Gamer Room/Individual Assets/Vending_machine_yellow.png`,
    headsetGreen: `${EXP}/Gamer Room/Individual Assets/Headset_gaming_green.png`,
    headsetPurple: `${EXP}/Gamer Room/Individual Assets/Headset_gaming_purple.png`,
    headsetRed: `${EXP}/Gamer Room/Individual Assets/Headset_gaming_red.png`,
    headsetVR: `${EXP}/Gamer Room/Individual Assets/Headset_VR.png`,
    gLightRed: `${EXP}/Gamer Room/Individual Assets/Lights_gaming_triangle_2_red.png`,
    gLightYellow: `${EXP}/Gamer Room/Individual Assets/Lights_gaming_triangle_4_yellow.png`,

    computerMedBlack: `${EXP}/Hospital/Individual Assets/Computer_medical_black.png`,
    storageMedBlack: `${EXP}/Hospital/Individual Assets/Storage_medical_black.png`,
    monitorMedWallBlack: `${EXP}/Hospital/Individual Assets/Monitor_medical_mounted_black.png`,
    ctScanner: `${EXP}/Hospital/Individual Assets/CT_scanner.png`,

    mercury: `${EXP}/Museum/Individual Assets/Mercury.png`,
    venus: `${EXP}/Museum/Individual Assets/Venus.png`,
    uranus: `${EXP}/Museum/Individual Assets/Uranus.png`,
    meteorite2: `${EXP}/Museum/Individual Assets/Meteorite_2.png`,
    trunkMammoth: `${EXP}/Museum/Individual Assets/Trunk_mammoth.png`,
    itemDisplayS: `${EXP}/Museum/Individual Assets/Item_display_small.png`,

    portraitOfficer2: `${EXP}/Police Station/Individual Assets/Portrait_officer_2.png`,
    portraitOfficer3: `${EXP}/Police Station/Individual Assets/Portrait_officer_3.png`,
    waitChairsRed: `${EXP}/Police Station/Individual Assets/WaitingChair_grouped_red.png`,
    waitChairSoloRed: `${EXP}/Police Station/Individual Assets/WaitingChair_solo_red.png`,
    paperStack2: `${EXP}/Police Station/Individual Assets/Paper_stack_2.png`,
    clipboardLong1: `${EXP}/Police Station/Individual Assets/Clipboard_wall_long_1.png`,
    clipboardLong2: `${EXP}/Police Station/Individual Assets/Clipboard_wall_long_2.png`,

    portraitFF2: `${EXP}/Fire Station/Individual Assets/Portrait_firefighter_2.png`,
    portraitFF3: `${EXP}/Fire Station/Individual Assets/Portrait_firefighter_3.png`,
    hoseWallShort: `${EXP}/Fire Station/Individual Assets/Hose_wall_short.png`,
    fireAxe: `${EXP}/Fire Station/Individual Assets/FireAxe.png`,
    helmetFF: `${EXP}/Fire Station/Individual Assets/Helmet_firefighter.png`,

    jack3: `${EXP}/Halloween/Individual Assets/JackOLantern_3.png`,
    jack4: `${EXP}/Halloween/Individual Assets/JackOLantern_4.png`,
    candelabra2: `${EXP}/Halloween/Individual Assets/Candles_2.png`,
    candelabra3: `${EXP}/Halloween/Individual Assets/Candles_3.png`,
    candleTable2: `${EXP}/Halloween/Individual Assets/Candle_table_2.png`,
    candleTable3: `${EXP}/Halloween/Individual Assets/Candle_table_3.png`,
    pumpkinBasket2: `${EXP}/Halloween/Individual Assets/Pumpkin_basket_2.png`,
    lanternHang2: `${EXP}/Halloween/Individual Assets/Lantern_hanging_2.png`,
    billboardGhosts: `${EXP}/Halloween/Individual Assets/Billboard_ghosts.png`,
    billboardScary: `${EXP}/Halloween/Individual Assets/Billboard_scaryface.png`,
    ghost2: `${EXP}/Halloween/Individual Assets/Ghost_2.png`,
    bat2: `${EXP}/Halloween/Individual Assets/Bat_2.png`,

    presentWhiteL: `${EXP}/Winter 2023/Individual Assets/Present_white_large.png`,
    presentGreenS: `${EXP}/Winter 2023/Individual Assets/Present_green_small.png`,
    snowGlobe: `${EXP}/Winter 2023/Individual Assets/SnowGlobe.png`,
    candyCaneSmall: `${EXP}/Winter 2023/Individual Assets/CandyCane_small.png`,

    crownDig: `${EXP}/Archaeology/Individual Assets/Crown.png`,
    neolithicMask: `${EXP}/Archaeology/Individual Assets/NeolithicMask.png`,
    megalodonTooth: `${EXP}/Archaeology/Individual Assets/MegalodonTooth.png`,
    backpackDig: `${EXP}/Archaeology/Individual Assets/Backpack_large_green.png`,
    pottery2: `${EXP}/Archaeology/Individual Assets/Pottery_ancient_2.png`,
    pottery4: `${EXP}/Archaeology/Individual Assets/Pottery_ancient_4.png`,

    tentDig: `${EXP}/Archaeology/Individual Assets/Tent_large_grey.png`,
    dinoWhole: `${EXP}/Archaeology/Individual Assets/Skeleton_dino_whole.png`,
    dirtPile: `${EXP}/Archaeology/Individual Assets/DirtPile.png`,
    flagRed: `${EXP}/Archaeology/Individual Assets/Flag_marker_red.png`,
    flagBlue: `${EXP}/Archaeology/Individual Assets/Flag_marker_blue.png`,
    pickaxe: `${EXP}/Archaeology/Individual Assets/Pickaxe.png`,
    shovelDig: `${EXP}/Archaeology/Individual Assets/Shovel.png`,
    bucketDig: `${EXP}/Archaeology/Individual Assets/Bucket.png`,
    swordBuried: `${EXP}/Archaeology/Individual Assets/Sword_buried.png`,
    totalStation: `${EXP}/Archaeology/Individual Assets/TotalStation.png`,
    stoneTablet: `${EXP}/Archaeology/Individual Assets/StoneTablet_grey.png`,
    potteryAncient: `${EXP}/Archaeology/Individual Assets/Pottery_ancient_1.png`,
    fossilFish: `${EXP}/Archaeology/Individual Assets/Fossil_fish.png`,

    // ---- Street + sky dressing (previously unused pack assets) ----
    billboard1: `${BG}/Billboard_1.png`,
    billboard2: `${BG}/Billboard_2.png`,
    billboard3: `${BG}/Billboard_3.png`,
    blimpBlue: `${BG}/Blimp_blue.png`,
    blimpRed: `${BG}/Blimp_red.png`,
    fireHydrant: `${EXP}/Fire Station/Individual Assets/FireHydrant.png`,

    // ---- Roof sprite caps (city-block facade grammar; theme-colored) ----
    // Gable (Roof_1) — tall shingles
    roofRedC: `${INF}/Roof_1_red_connecting.png`, roofRedE: `${INF}/Roof_1_red_end.png`,
    roofBlueC: `${INF}/Roof_1_blue_connecting.png`, roofBlueE: `${INF}/Roof_1_blue_end.png`,
    roofGreenC: `${INF}/Roof_1_green_connecting.png`, roofGreenE: `${INF}/Roof_1_green_end.png`,
    roofOrangeC: `${INF}/Roof_1_orange_connecting.png`, roofOrangeE: `${INF}/Roof_1_orange_end.png`,
    roofPurpleC: `${INF}/Roof_1_purple_connecting.png`, roofPurpleE: `${INF}/Roof_1_purple_end.png`,
    roofBlackC: `${INF}/Roof_1_black_connecting.png`, roofBlackE: `${INF}/Roof_1_black_end.png`,
    roofYellowC: `${INF}/Roof_1_yellow_connecting.png`, roofYellowE: `${INF}/Roof_1_yellow_end.png`,
    // Flat / low (Roof_2) — modern slab look
    roof2RedC: `${INF}/Roof_2_red_connecting.png`, roof2RedE: `${INF}/Roof_2_red_end.png`,
    roof2BlueC: `${INF}/Roof_2_blue_connecting.png`, roof2BlueE: `${INF}/Roof_2_blue_end.png`,
    roof2GreenC: `${INF}/Roof_2_green_connecting.png`, roof2GreenE: `${INF}/Roof_2_green_end.png`,
    roof2OrangeC: `${INF}/Roof_2_orange_connecting.png`, roof2OrangeE: `${INF}/Roof_2_orange_end.png`,
    roof2PurpleC: `${INF}/Roof_2_purple_connecting.png`, roof2PurpleE: `${INF}/Roof_2_purple_end.png`,
    roof2GreyC: `${INF}/Roof_2_grey_connecting.png`, roof2GreyE: `${INF}/Roof_2_grey_end.png`,
    roof2YellowC: `${INF}/Roof_2_yellow_connecting.png`, roof2YellowE: `${INF}/Roof_2_yellow_end.png`,

    // ---- Pixel Spaces UI (official pack layout — Tiny Tower / life-sim chrome) ----
    // Pack ref: https://netherzapdos.itch.io/pixel-spaces  → UI expansion
    // Designed for: panels/tabs, status needs, chat bubbles, selection pointers,
    // progress/XP bars, emotes over NPCs — not plain HTML text.
    //
    // Panels & tabs (room plaques + HUD)
    uiTabBlue: `${UI_BTN}/Panel_blue_tab.png`,
    uiTabGreen: `${UI_BTN}/Panel_green_tab.png`,
    uiTabGrey: `${UI_BTN}/Panel_grey_tab.png`,
    uiTabRed: `${UI_BTN}/Panel_red_tab.png`,
    uiTabPurple: `${UI_BTN}/Panel_purple_tab.png`,
    uiTabYellow: `${UI_BTN}/Panel_yellow_tab.png`,
    uiTabOrange: `${UI_BTN}/Panel_orange_tab.png`,
    uiTabWhite: `${UI_BTN}/Panel_white_tab.png`,
    uiPanelBlue: `${UI_BTN}/Panel_blue.png`,
    uiPanelGreen: `${UI_BTN}/Panel_green.png`,
    uiPanelGrey: `${UI_BTN}/Panel_grey.png`,
    uiPanelPurple: `${UI_BTN}/Panel_purple.png`,
    uiPanelYellow: `${UI_BTN}/Panel_yellow.png`,
    uiPanelOrange: `${UI_BTN}/Panel_orange.png`,
    uiPanelRed: `${UI_BTN}/Panel_red.png`,
    uiPanelWhite: `${UI_BTN}/Panel_white.png`,
    uiPanelBlueBg: `${UI_BTN}/Panel_blue_background.png`,
    uiPanelGreyBg: `${UI_BTN}/Panel_grey_background.png`,
    uiPanelShadow: `${UI_BTN}/Panel_shadow.png`,
    // Buttons
    uiButtonBlue: `${UI_BTN}/Button_blue.png`,
    uiButtonBlueLong: `${UI_BTN}/Button_blue_long.png`,
    uiButtonGreen: `${UI_BTN}/Button_green.png`,
    uiButtonGreenLong: `${UI_BTN}/Button_green_long.png`,
    uiButtonGrey: `${UI_BTN}/Button_grey.png`,
    uiButtonYellow: `${UI_BTN}/Button_yellow.png`,
    // Frames
    uiFrameBlue: `${UI_BTN}/Frame_blue.png`,
    uiFrameGreen: `${UI_BTN}/Frame_green.png`,
    uiFrameGrey: `${UI_BTN}/Frame_grey.png`,
    // Area selection rings (under feet when focused)
    selGreen1: `${UI_BTN}/Selection_green_1.png`,
    selGreen2: `${UI_BTN}/Selection_green_2.png`,
    selWhite1: `${UI_BTN}/Selection_white_1.png`,
    // Emotes (float above characters)
    uiStar: `${UI_EMOTE}/Star.png`,
    uiPerson: `${UI_EMOTE}/Person.png`,
    emoteHeart: `${UI_EMOTE}/Heart_green.png`,
    emoteQuestion: `${UI_EMOTE}/Question.png`,
    emoteExclaim: `${UI_EMOTE}/Exclamation_yellow.png`,
    emoteExclaimRed: `${UI_EMOTE}/Exclamation_red.png`,
    emoteFire: `${UI_EMOTE}/Fire.png`,
    emoteGaming: `${UI_EMOTE}/Gaming.png`,
    emoteMoney: `${UI_EMOTE}/Money.png`,
    emoteMedical: `${UI_EMOTE}/Medical_cross.png`,
    emoteThumbsUp: `${UI_EMOTE}/Thumbs_up.png`,
    emoteThumbsDown: `${UI_EMOTE}/Thumbs_down.png`,
    emoteThumbsGold: `${UI_EMOTE}/Thumbs_golden.png`,
    emotePresent: `${UI_EMOTE}/Present.png`,
    emoteSnowflake: `${UI_EMOTE}/Snowflake.png`,
    emoteShovel: `${UI_EMOTE}/Shovel.png`,
    emoteCurrency: `${UI_EMOTE}/Currency.png`,
    // Chat bubbles (speech — pack designed for dialogue/needs)
    uiBubbleWhite: `${UI_BUBBLE}/ChatBubble_white.png`,
    uiBubbleBlue: `${UI_BUBBLE}/ChatBubble_blue.png`,
    uiBubbleGrey: `${UI_BUBBLE}/ChatBubble_grey.png`,
    uiBubbleGreen: `${UI_BUBBLE}/ChatBubble_green.png`,
    uiBubbleYellow: `${UI_BUBBLE}/ChatBubble_yellow.png`,
    uiBubbleOrange: `${UI_BUBBLE}/ChatBubble_orange.png`,
    uiBubblePurple: `${UI_BUBBLE}/ChatBubble_purple.png`,
    uiBubbleRed: `${UI_BUBBLE}/ChatBubble_red.png`,
    uiBubbleXmas: `${UI_BUBBLE}/ChatBubble_xmas.png`,
    uiBubbleShadow: `${UI_BUBBLE}/ChatBubble_shadow.png`,
    // Status needs (Pixel Spaces life-sim icons)
    statusHappy0: `${UI_ICON}/Status_happiness_0.png`,
    statusHappy1: `${UI_ICON}/Status_happiness_1.png`,
    statusHappy2: `${UI_ICON}/Status_happiness_2.png`,
    statusHappy3: `${UI_ICON}/Status_happiness_3.png`,
    statusHappy4: `${UI_ICON}/Status_happiness_4.png`,
    statusHunger: `${UI_ICON}/Status_hunger.png`,
    statusThirst: `${UI_ICON}/Status_thirst.png`,
    statusEnergy: `${UI_ICON}/Status_energy.png`,
    statusHygiene: `${UI_ICON}/Status_hygiene.png`,
    statusComfort0: `${UI_ICON}/Status_comfort_0.png`,
    statusComfort1: `${UI_ICON}/Status_comfort_1.png`,
    statusComfort2: `${UI_ICON}/Status_comfort_2.png`,
    statusCold: `${UI_ICON}/Status_cold.png`,
    // Selection pointers (player / open-mic / focus)
    pointerGreen: `${UI_ICON}/Pointer_green.png`,
    pointerGrey: `${UI_ICON}/Pointer_grey.png`,
    pointerBlue: `${UI_ICON}/Pointer_blue.png`,
    pointerYellow: `${UI_ICON}/Pointer_yellow.png`,
    pointerOrange: `${UI_ICON}/Pointer_orange.png`,
    pointerPurple: `${UI_ICON}/Pointer_purple.png`,
    pointerRed: `${UI_ICON}/Pointer_red.png`,
    pointerWhite: `${UI_ICON}/Pointer_white.png`,
    // HUD icons
    boostIcon: `${UI_ICON}/Boost.png`,
    boostOffIcon: `${UI_ICON}/Boost_off.png`,
    iconPopulation: `${UI_ICON}/Population.png`,
    iconGear: `${UI_ICON}/Gear.png`,
    iconMail: `${UI_ICON}/Mail.png`,
    iconCheck: `${UI_ICON}/Check.png`,
    iconCross: `${UI_ICON}/Cross.png`,
    iconPlus: `${UI_ICON}/Plus.png`,
    iconMinus: `${UI_ICON}/Minus.png`,
    iconClose: `${UI_ICON}/Close.png`,
    iconCurrency: `${UI_ICON}/Currency.png`,
    iconClipboard: `${UI_ICON}/Clipboard.png`,
    iconPackage: `${UI_ICON}/Package.png`,
    iconHammer: `${UI_ICON}/Hammer.png`,
    iconGame: `${UI_ICON}/Game_controller.png`,
    iconArrowUp: `${UI_ICON}/Arrow_up.png`,
    iconArrowDown: `${UI_ICON}/Arrow_down.png`,
    iconArrowLeft: `${UI_ICON}/Arrow_left.png`,
    iconArrowRight: `${UI_ICON}/Arrow_right.png`,
    // Progress bars (needs 0 empty → 5 full) — green = energy/mood, orange = hunger, blue = social
    barEmpty: `${UI_ICON}/Progress_bar_0.png`,
    barEmptyClear: `${UI_ICON}/Progress_bar_0_transparent.png`,
    barGreen1: `${UI_ICON}/Progress_bar_green_1.png`,
    barGreen2: `${UI_ICON}/Progress_bar_green_2.png`,
    barGreen3: `${UI_ICON}/Progress_bar_green_3.png`,
    barGreen4: `${UI_ICON}/Progress_bar_green_4.png`,
    barGreen5: `${UI_ICON}/Progress_bar_green_5.png`,
    barOrange1: `${UI_ICON}/Progress_bar_orange_1.png`,
    barOrange2: `${UI_ICON}/Progress_bar_orange_2.png`,
    barOrange3: `${UI_ICON}/Progress_bar_orange_3.png`,
    barOrange4: `${UI_ICON}/Progress_bar_orange_4.png`,
    barOrange5: `${UI_ICON}/Progress_bar_orange_5.png`,
    barBlue1: `${UI_ICON}/Progress_bar_blue_1.png`,
    barBlue2: `${UI_ICON}/Progress_bar_blue_2.png`,
    barBlue3: `${UI_ICON}/Progress_bar_blue_3.png`,
    barBlue4: `${UI_ICON}/Progress_bar_blue_4.png`,
    barBlue5: `${UI_ICON}/Progress_bar_blue_5.png`,
    barPurple1: `${UI_ICON}/Progress_bar_purple_1.png`,
    barPurple2: `${UI_ICON}/Progress_bar_purple_2.png`,
    barPurple3: `${UI_ICON}/Progress_bar_purple_3.png`,
    barPurple4: `${UI_ICON}/Progress_bar_purple_4.png`,
    barPurple5: `${UI_ICON}/Progress_bar_purple_5.png`,
    // XP bar (day progress / community vibe)
    xpBar0: `${UI_ICON}/XP_bar_0.png`,
    xpBar1: `${UI_ICON}/XP_bar_1.png`,
    xpBar2: `${UI_ICON}/XP_bar_2.png`,
    xpBar3: `${UI_ICON}/XP_bar_3.png`,
    xpBar4: `${UI_ICON}/XP_bar_4.png`,
    xpBar5: `${UI_ICON}/XP_bar_5.png`,
    xpBar6: `${UI_ICON}/XP_bar_6.png`,
    xpBar7: `${UI_ICON}/XP_bar_7.png`,
    xpBar8: `${UI_ICON}/XP_bar_8.png`,
    // Cursors (optional desktop chrome)
    cursor1: `${UI_CURSOR}/cursor_1.png`,
    cursor1Pressed: `${UI_CURSOR}/cursor_1_pressed.png`,
    cursor2: `${UI_CURSOR}/cursor_2.png`,
    cursor2Pressed: `${UI_CURSOR}/cursor_2_pressed.png`,

    // ---- Pixel Platter food (NPCs walk to these sprites and eat them) ----
    foodBurger: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Burger.png`,
    foodPizza: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Pizza.png`,
    foodFries: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/French_fries.png`,
    foodHotdog: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Hotdog_mustard.png`,
    foodHotdogPlain: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Hotdog.png`,
    foodCake: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Cake_red_velvet.png`,
    foodTiramisu: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Tiramisu.png`,
    foodPie: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Pie_pumpkin.png`,
    foodMacarons: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Macarons.png`,
    foodIceCream: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/IceCream_sandwich.png`,
    foodSoda: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Soda.png`,
    foodCreme: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Creme_brulee.png`,
    foodApple: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_apple.png`,
    foodBanana: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_banana.png`,
    foodStrawberry: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_strawberry.png`,
    foodCherry: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_cherry.png`,
    foodGrapes: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_grapes.png`,
    foodKiwi: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_kiwi.png`,
    foodLemon: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_lemon.png`,
    foodOrange: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_orange.png`,
    foodPear: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_pear.png`,
    foodRaspberry: `${PACKS_EXTRA}/PixelPlatter/Pixel Platter/Fruit_raspberry.png`,
  };

  // Pets — Paws & Whiskers free packs (NON-COMMERCIAL).
  // Sheet 1024×64 = 32×32 cells · 8 dirs × 4 frames on row 0 (walk).
  // Frame 3 mirrors frame 1 → cycle 0→1→2→1. Dir: 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW
  // Art feet sit ~6px above cell bottom → use PET_FOOT_ORIGIN_Y so they plant on groundY.
  const PET_FRAME = 32;
  const PET_DIRS = 8;
  const PET_WALK_LEN = 4;
  const PET_FOOT_ORIGIN_Y = 26 / 32; // opaque feet ~y25
  // Smaller than NPCs (SCALE=2)
  const PET_SCALE_DOG = 1.55;
  const PET_SCALE_CAT = 1.22;
  // Advance walk frame every N world-pixels moved (distance-driven = looks like walking)
  const PET_PX_PER_STEP = 5;
  const PET_SHEETS = [
    { key: 'petCat', path: `${PACKS_EXTRA}/Cats/Cat_1_spritesheet_free.png`, scale: PET_SCALE_CAT },
    { key: 'petDog', path: `${PACKS_EXTRA}/Dogs/GoldenRetriever_spritesheet_free.png`, scale: PET_SCALE_DOG },
  ];
  /** Street travel → E/W side profiles (most readable walk). */
  function petDirFromDelta(dx, dy) {
    if (dx === 0 && dy === 0) return 2;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax >= ay * 0.5) return dx > 0 ? 2 : 6; // E / W
    if (ay > ax) return dy > 0 ? 0 : 4;
    if (dx > 0 && dy > 0) return 1;
    if (dx > 0 && dy < 0) return 3;
    if (dx < 0 && dy < 0) return 5;
    return 7;
  }
  function petScaleFor(key) {
    return key === 'petCat' ? PET_SCALE_CAT : PET_SCALE_DOG;
  }
  /** Walk frame indices for a direction: 0,1,2,1 loop. */
  function petWalkFrames(dir) {
    const base = (dir % PET_DIRS) * PET_WALK_LEN;
    return [base, base + 1, base + 2, base + 1];
  }
  function petIdleFrame(dir) {
    return (dir % PET_DIRS) * PET_WALK_LEN;
  }

  const FOOD_KEYS = [
    'foodBurger', 'foodPizza', 'foodFries', 'foodHotdog', 'foodHotdogPlain',
    'foodCake', 'foodTiramisu', 'foodPie', 'foodMacarons', 'foodIceCream',
    'foodSoda', 'foodCreme',
    'foodApple', 'foodBanana', 'foodStrawberry', 'foodCherry', 'foodGrapes',
    'foodKiwi', 'foodLemon', 'foodOrange', 'foodPear', 'foodRaspberry',
  ];
  // Readable at room scale; still smaller than furniture
  const FOOD_SCALE = 1.0; // native pixel size — 1.35 read as oversized props

  /** Soft atmospheric tint per street section (category stretch). */
  const SECTION_ATMOS = [
    { fog: 0x7ec8e8, alpha: 0.045 },
    { fog: 0x9ab8c8, alpha: 0.05 },
    { fog: 0xb8a090, alpha: 0.04 },
    { fog: 0x88b098, alpha: 0.048 },
    { fog: 0xa898c0, alpha: 0.042 },
  ];

  /**
   * Pixel Spaces door family → texture keys.
   * Street uses doubles (true closed front). Climb uses ajar opened leaf + frame.
   * @param {string} [kindOrTheme]
   * @returns {{ family: string, closedKey: string, openKey: string, sideKey: string }}
   */
  function doorFamilyFor(kindOrTheme) {
    const raw = String(kindOrTheme || 'wood').toLowerCase();
    let family = 'wood';
    if (
      raw === 'grey' || raw === 'gray' || raw === 'hospital' || raw === 'police'
      || raw === 'fire' || raw === 'office' || raw.includes('grey') || raw.includes('gray')
    ) {
      family = 'grey';
    } else if (
      raw === 'glass' || raw === 'gamer' || raw === 'museum' || raw.includes('glass')
    ) {
      family = 'glass';
    }
    // Explicit wood / cafe / halloween / default "door"
    if (
      raw === 'wood' || raw === 'door' || raw === 'cafe' || raw === 'halloween'
      || raw === 'dooropen' || raw === 'doorwooddouble'
    ) {
      family = 'wood';
    }
    if (family === 'glass') {
      return { family, closedKey: 'doorGlassDouble', openKey: 'doorGlassOpen', sideKey: 'doorGlass' };
    }
    if (family === 'grey') {
      return { family, closedKey: 'doorGreyDouble', openKey: 'doorGreyOpen', sideKey: 'doorGreyClosed' };
    }
    return { family: 'wood', closedKey: 'doorWoodDouble', openKey: 'doorOpen', sideKey: 'doorClosed' };
  }

  /** Native source size for a door texture (fallback matches old canvas leaf). */
  function doorTexSize(scene, key) {
    try {
      if (key && scene?.textures?.exists?.(key)) {
        const fr = scene.textures.get(key).get();
        if (fr?.width && fr?.height) return { w: fr.width, h: fr.height };
      }
    } catch (_) { /* ignore */ }
    return { w: 14, h: 22 };
  }

  /** Map 0..1 need fill → progress bar key (1 empty-ish … 5 full). */
  function progressBarKey(color, amount01) {
    const a = Math.max(0, Math.min(1, amount01));
    const lvl = a <= 0.05 ? 0 : Math.min(5, Math.max(1, Math.ceil(a * 5)));
    if (lvl === 0) return 'barEmpty';
    return `bar${color}${lvl}`;
  }

  /** Map 0..1 day hour fraction → XP bar frame 0–8. */
  function xpBarKey(amount01) {
    const a = Math.max(0, Math.min(1, amount01));
    const lvl = Math.min(8, Math.round(a * 8));
    return `xpBar${lvl}`;
  }

  /**
   * Dominant Pixel Spaces status icon for a resident (life-sim style).
   * Pack ships Happiness 0–4, Hunger, Energy, Thirst, Hygiene, Comfort.
   */
  function statusIconForResident(r) {
    if (!r?.alive) return 'statusHappy0';
    const n = r.needs || {};
    // High hunger = show hunger icon; low energy = energy; high social need = comfort
    if ((n.hunger ?? 0) > 0.72) return 'statusHunger';
    if ((n.energy ?? 1) < 0.28) return 'statusEnergy';
    if ((n.social ?? 0) > 0.75) return 'statusComfort0';
    if ((n.fun ?? 0) > 0.8) return 'statusComfort1';
    const mood = r.mood != null ? r.mood : 0.55;
    if (mood < 0.25) return 'statusHappy0';
    if (mood < 0.4) return 'statusHappy1';
    if (mood < 0.55) return 'statusHappy2';
    if (mood < 0.75) return 'statusHappy3';
    return 'statusHappy4';
  }

  /** Emote texture for a pose / life event (full pack). */
  function emoteKeyForPose(pose) {
    const map = {
      wave: 'emoteHeart',
      shrug: 'emoteQuestion',
      snicker: 'emoteThumbsUp',
      eat: 'statusHunger',
      eatSit: 'statusHunger',
      jump: 'emoteFire',
      hurt: 'emoteExclaimRed',
      sit: 'statusComfort2',
      lie: 'statusEnergy',
      sleep: 'statusEnergy',
      social: 'emoteHeart',
      play: 'emoteGaming',
      hang: 'emoteThumbsUp',
      visit: 'uiPerson',
      stroll: 'emoteThumbsGold',
      chill: 'statusComfort1',
      home: 'statusComfort2',
      work: 'emoteMoney', // legacy
    };
    return map[pose] || 'emoteHeart';
  }

  const CHAT_BUBBLE_KEYS = [
    'uiBubbleWhite', 'uiBubbleBlue', 'uiBubbleGreen', 'uiBubbleYellow',
    'uiBubbleOrange', 'uiBubblePurple', 'uiBubbleRed', 'uiBubbleGrey',
  ];

  // 30 pre-made NPC sheets (15 male + 15 female), 16x32 frames, 14 anim rows
  // (row 0 = walk, row 1 = idle). Real characters replace the old 2-sprite crowd.
  const NPC_SHEETS = [];
  for (let i = 1; i <= 15; i += 1) {
    NPC_SHEETS.push({ key: `npc_m${i}`, path: `${PACK}/NPCs/Male/NPC ${i}.png` });
    NPC_SHEETS.push({ key: `npc_f${i}`, path: `${PACK}/NPCs/Female/NPC ${i}.png` });
  }
  /**
   * Hospital expansion staff — 160×96 sheets (5 cols × 3 rows of 32×32):
   * row 0 MOVE (4 frames), row 1 IDLE (3), row 2 JUMP (2). Not the premade 8×14 grid.
   */
  const HOSP_NURSE_SHEETS = [
    { key: 'hospNurseBlueF1', path: `${EXP}/Hospital/NPCs/npc_nurse_blue_female_1.png` },
    { key: 'hospNurseBlueF2', path: `${EXP}/Hospital/NPCs/npc_nurse_blue_female_2.png` },
    { key: 'hospNurseBlueF3', path: `${EXP}/Hospital/NPCs/npc_nurse_blue_female_3.png` },
    { key: 'hospNurseBlueM1', path: `${EXP}/Hospital/NPCs/npc_nurse_blue_male_1.png` },
    { key: 'hospNurseBlueM2', path: `${EXP}/Hospital/NPCs/npc_nurse_blue_male_2.png` },
    { key: 'hospNurseBlueM3', path: `${EXP}/Hospital/NPCs/npc_nurse_blue_male_3.png` },
    { key: 'hospNurseGreenF1', path: `${EXP}/Hospital/NPCs/npc_nurse_green_female_1.png` },
    { key: 'hospNurseGreenF2', path: `${EXP}/Hospital/NPCs/npc_nurse_green_female_2.png` },
    { key: 'hospNurseGreenF3', path: `${EXP}/Hospital/NPCs/npc_nurse_green_female_3.png` },
    { key: 'hospNurseGreenM1', path: `${EXP}/Hospital/NPCs/npc_nurse_green_male_1.png` },
    { key: 'hospNurseGreenM2', path: `${EXP}/Hospital/NPCs/npc_nurse_green_male_2.png` },
    { key: 'hospNurseGreenM3', path: `${EXP}/Hospital/NPCs/npc_nurse_green_male_3.png` },
  ];
  const HOSP_SURGEON_SHEETS = [
    { key: 'hospSurgeonM1', path: `${EXP}/Hospital/NPCs/npc_surgeon_male_1.png` },
    { key: 'hospSurgeonM2', path: `${EXP}/Hospital/NPCs/npc_surgeon_male_2.png` },
    { key: 'hospSurgeonM3', path: `${EXP}/Hospital/NPCs/npc_surgeon_male_3.png` },
    { key: 'hospSurgeonF1', path: `${EXP}/Hospital/NPCs/npc_surgeon_female_1.png` },
    { key: 'hospSurgeonF2', path: `${EXP}/Hospital/NPCs/npc_surgeon_female_2.png` },
    { key: 'hospSurgeonF3', path: `${EXP}/Hospital/NPCs/npc_surgeon_female_3.png` },
  ];
  const HOSP_NPC_SHEETS = [...HOSP_NURSE_SHEETS, ...HOSP_SURGEON_SHEETS];
  // Halloween ghost NPCs — same 5×3 MOVE/IDLE/JUMP grid as hospital staff.
  const GHOST_NPC_SHEETS = [1, 2, 3].map((n) => ({
    key: `ghostNpc${n}`,
    path: `${EXP}/Halloween/NPCs/npc_ghost_${n}.png`,
  }));
  const GHOST_NPC_KEYS = GHOST_NPC_SHEETS.map((s) => s.key);
  // Police / Fire / Cafe themed staff — same 160×96 5×3 sheets, all shipped
  // with the pack but never loaded before (their rooms used generic civilians).
  const POLICE_NPC_SHEETS = [];
  const FIRE_NPC_SHEETS = [];
  const CAFE_NPC_SHEETS = [];
  for (let n = 1; n <= 3; n += 1) {
    POLICE_NPC_SHEETS.push(
      { key: `copNpcM${n}`, path: `${EXP}/Police Station/NPCs/Male/npc_cop_male_${n}.png` },
      { key: `copNpcF${n}`, path: `${EXP}/Police Station/NPCs/Female/npc_cop_female_${n}.png` },
    );
    FIRE_NPC_SHEETS.push(
      { key: `fireNpcM${n}`, path: `${EXP}/Fire Station/NPCs/Male/npc_firefighter_male_${n}.png` },
      { key: `fireNpcF${n}`, path: `${EXP}/Fire Station/NPCs/Female/npc_firefighter_female_${n}.png` },
    );
    CAFE_NPC_SHEETS.push(
      { key: `baristaNpcM${n}`, path: `${EXP}/Cafe/Pre-made NPCs/male_npc_barista_${n}.png` },
      { key: `baristaNpcF${n}`, path: `${EXP}/Cafe/Pre-made NPCs/female_npc_barista_${n}.png` },
    );
  }
  const THEMED_NPC_SHEETS = [...POLICE_NPC_SHEETS, ...FIRE_NPC_SHEETS, ...CAFE_NPC_SHEETS];
  // Full-body character sheets in the standard 8×14 premade grid:
  // - skeleton ships with the avatar Body/ set (272px wide — Phaser slices
  //   the left 256, same crop the avatar baker uses)
  // - witch / mummy / vampire are baked from pack layers by
  //   scripts/gen-themed-npcs.mjs into discord-map/baked/
  const COSTUME_NPC_SHEETS = [
    { key: 'skeletonNpc', path: 'PixelSpacesFull/Tilesets & SpriteSheets/NPCs/SpriteSheets/Body/skeleton.png' },
    { key: 'witchNpc', path: 'baked/npc_witch.png' },
    { key: 'mummyNpc', path: 'baked/npc_mummy.png' },
    { key: 'vampireNpc', path: 'baked/npc_vampire.png' },
  ];
  // Premade sheets are a 256x448 grid of 32x32 cells (8 cols x 14 rows), not 16x32 —
  // loading at half-width used to slice each character in two down the middle.
  const NPC_FRAME = { w: 32, h: 32 };
  const NPC_COLS = 8;
  const HOSP_COLS = 5;
  // Ghost/cop/firefighter/barista sheets share the hospital 5×3 pose grid,
  // so they ride the same pose defs and column count.
  const HOSP_SHEET_KEY_RE = /^hosp(Nurse|Surgeon)|^ghostNpc|^copNpc|^fireNpc|^baristaNpc/i;
  function isHospNpcSheet(key) {
    return HOSP_SHEET_KEY_RE.test(String(key || ''));
  }
  /** Native hospital poses (MOVE / IDLE / JUMP). */
  const HOSP_POSE_DEFS = {
    walk: { row: 0, frames: 4, fps: 6, repeat: -1, loop: true },
    idle: { row: 1, frames: 3, fps: 1.4, repeat: -1, loop: true },
    jump: { row: 2, frames: 2, fps: 7, repeat: 0 },
  };
  /** Pose map for a sheet — hospital staff never index past the 5×3 grid. */
  function poseDefsForSheet(sheet) {
    if (!isHospNpcSheet(sheet)) return NPC_POSE_DEFS;
    const defs = { ...HOSP_POSE_DEFS };
    Object.keys(NPC_POSE_DEFS).forEach((pose) => {
      if (defs[pose]) return;
      if (pose === 'wave' || pose === 'shrug' || pose === 'snicker' || pose === 'hurt') {
        defs[pose] = { row: 2, frames: 2, fps: 7, repeat: 0 };
      } else if (pose === 'sitIdle' || pose === 'lieIdle') {
        defs[pose] = { row: 1, frames: 3, fps: 1.4, repeat: -1, loop: true };
      } else {
        // sit / lie / eat one-shots → hold idle frame (no invalid rows)
        defs[pose] = { row: 1, frames: 1, fps: 1, repeat: 0 };
      }
    });
    return defs;
  }
  function sheetColCount(sheet) {
    return isHospNpcSheet(sheet) ? HOSP_COLS : NPC_COLS;
  }
  /**
   * Right-side street door center X — clear of the 14px side-face strip and
   * the double-door frame (~56px @ SCALE 2).
   */
  function streetDoorRightX(left, bw) {
    const halfFrame = Math.ceil((25 * SCALE) / 2) + 6;
    return left + bw - 14 - 6 - halfFrame;
  }
  // The character art itself only fills roughly y9-23 of each 32-tall cell
  // (walk/idle rows) — the frame has ~9px of transparent padding below the
  // feet. Anchoring at the frame's true bottom (origin.y = 1) floats the
  // sprite above the floor; anchor at the feet instead so origin (0.5, this)
  // plants the character on the ground line.
  const NPC_FOOT_ORIGIN_Y = 24 / 32;
  /**
   * Sit/lie art sits higher in the 32px cell than walk/idle (opaque bottom
   * ~y19–20 for sitIdle vs ~y23 for idle). With foot origin at y24, that
   * lifts the butt ~5 texture px × SCALE above the world origin — looks like
   * floating above the cushion. Add this lift when parking on seats/beds.
   */
  const SIT_CONTACT_LIFT = 9;  // (24 - 19.5) * SCALE ≈ 9
  const LIE_CONTACT_LIFT = 5;  // lieIdle bottom ~y21

  /**
   * Full Pixel Spaces premade NPC row map (8 cols × 14 rows, 32×32).
   * Real frame counts skip the trailing label cell on each row.
   * durationMs ≈ (frames / fps) * (repeat+1) * 1000 — used for pose holds.
   */
  // Snappier fps + more repeats so poses read clearly at 2× scale
  const NPC_POSE_DEFS = {
    // Calmer fps so poses read clean (not twitchy)
    walk: { row: 0, frames: 4, fps: 6, repeat: -1, loop: true },
    idle: { row: 1, frames: 3, fps: 1.4, repeat: -1, loop: true },
    jump: { row: 2, frames: 2, fps: 7, repeat: 0 },
    // Sit: slower settle so the lower-in-seat frames read as planting
    sit: { row: 3, frames: 3, fps: 6, repeat: 0 },
    sitIdle: { row: 4, frames: 3, fps: 1.4, repeat: -1, loop: true },
    sitFinish: { row: 5, frames: 3, fps: 7, repeat: 0 },
    lie: { row: 6, frames: 6, fps: 7, repeat: 0 },
    lieIdle: { row: 6, frames: 1, fps: 1, repeat: -1, loop: true, frameOffset: 5 },
    lieFinish: { row: 7, frames: 6, fps: 8, repeat: 0 },
    eat: { row: 8, frames: 2, fps: 5, repeat: 6 },
    eatSit: { row: 9, frames: 2, fps: 5, repeat: 6 },
    hurt: { row: 10, frames: 3, fps: 7, repeat: 0 },
    shrug: { row: 11, frames: 7, fps: 8, repeat: 0 },
    snicker: { row: 12, frames: 2, fps: 5, repeat: 3 },
    wave: { row: 13, frames: 4, fps: 7, repeat: 1 },
  };

  /** World Y for parked sit/lie contact (cushion/mattress). */
  function seatContactY(seat) {
    const isBed = seat?.kind === 'bed';
    const surface = Math.max(2, Math.min(14, seat?.surfaceH != null
      ? seat.surfaceH
      : (isBed ? 4 : 7)));
    const lift = isBed ? LIE_CONTACT_LIFT : SIT_CONTACT_LIFT;
    return (seat.floorY ?? 0) - surface + lift;
  }
  const NPC_ONE_SHOT_POSES = ['jump', 'sit', 'sitFinish', 'lie', 'lieFinish', 'eat', 'eatSit', 'hurt', 'shrug', 'snicker', 'wave'];
  function poseDurationMs(pose) {
    const d = NPC_POSE_DEFS[pose];
    if (!d) return 600;
    if (d.loop || d.repeat < 0) return 900;
    const plays = (d.repeat || 0) + 1;
    return Math.ceil((d.frames / Math.max(1, d.fps)) * plays * 1000) + 60;
  }

  // Distinct saturated wall color per room + warm floor strip — the #1 reference
  // signature. Rooms used to all be near-white beige.
  // ——— Interactable furniture ———
  // Any placed sprite whose ASSETS key appears here becomes a live
  // interactable: SEAT_INFO → press E (or ▲ on touch) to sit, BED_INFO →
  // lie down. The value is the pixel height of the seating/lying surface
  // above the floor line (screen px at SCALE 2), used to park the player
  // sprite on top of the furniture. Registration happens automatically in
  // furn(), so every couch/stool/bed across every kit and theme works.
  // surfaceH = cushion/seat-top height above floor plank (screen px at SCALE 2).
  // Final park Y also adds SIT_CONTACT_LIFT / LIE_CONTACT_LIFT (sheet padding).
  const SEAT_INFO = {
    couchBlue: 6, couchGreen: 6, couchRed: 6, couchGrey: 6, couchYellow: 6, couchDark: 6,
    couchSmall: 6, couchSmallG: 6, couchSmallR: 6, couchSmallY: 6, couchSmallGr: 6,
    stoolBlue: 8, stoolRed: 8, stoolYellow: 8, stoolGreen: 8, stool: 8, stoolB: 8,
    officechairBlue: 7, officechairRed: 7, officechairPurple: 7, officechairOrange: 7,
    throneRed: 8, throneBlue: 8, throneGreen: 8, thronePurple: 8, throneYellow: 8,
    waitChairSolo: 7, waitChairSoloRed: 7, waitChairs: 7, waitChairsRed: 7,
    chairHalloween: 7, benchWood: 5,
  };
  const BED_INFO = {
    bed: 3, bedBlue: 3, bedGreen: 3,
    bedHosp: 4, bunkBottom: 3, tableSurgery: 6, coffin: 2,
  };

  /** Floor hosts that surface props (laptop etc.) can sit on — height = top above floor. */
  const SURFACE_HOSTS = {
    desk: 14, desk2: 14, coffee: 10, coffee2: 10, counter: 14, counterEnd: 14,
    tableLong: 14, tableMed2: 12, deskOffice: 14, policeDesk: 14, filecabinet: 0,
    tableSteel: 8, tableSurgery: 6, drawer: 12,
  };
  /** Props that must sit ON a surface host (not float mid-air). */
  const SURFACE_PROPS = new Set(['laptop', 'books', 'books2', 'radio', 'paperStack', 'paperStack2']);
  /** Tables/counters that get Pixel Platter food dressing. */
  const FOOD_HOST_KEYS = new Set([
    'coffee', 'coffee2', 'counter', 'counterEnd', 'tableLong', 'tableMed2',
    'desk', 'desk2', 'deskOffice', 'policeDesk',
  ]);

  const ROOM_WALL_COLORS = [
    0x2f6f9e, 0xd9862b, 0x3f9e57, 0xc0433d, 0x7d54ad,
    0xc99a22, 0x2f9e93, 0xc4577e, 0x4560c0, 0xb5642f,
    0x4a8fb0, 0x8a5a3c, 0x5b9e6a, 0x9e4d6e, 0x6a5aa0,
  ];
  /** Named wall colors for `,room color` overrides. */
  const ROOM_COLOR_BY_NAME = {
    blue: 0x2f6f9e, teal: 0x2f9e93, green: 0x3f9e57, mint: 0x5b9e6a,
    orange: 0xd9862b, red: 0xc0433d, pink: 0xc4577e, purple: 0x7d54ad,
    lavender: 0x6a5aa0, yellow: 0xc99a22, brown: 0x8a5a3c, slate: 0x4560c0,
  };
  const ROOM_FLOOR_STRIP = 0x7a5a3c; // warm wood baseboard

  // Channel-name -> themed furniture kit. Each kit is a set of {key,xf(0-1),depth,
  // scaleMul?}. Keys resolve against ASSETS (arrays = seeded pick a variant).
  // This is the semantic art direction the design panel converged on: a server
  // reads like a real building (library, dev office, cafe, lounge...) not 8 clones.
  // Layout rule: stairs/elev use the LEFT clear lane (~0.12–0.22).
  // Furniture lives in the mid/right band so the ladder never blocks the room.
  // Kits use layout "slots" left→right after the climb door band (~0.22+).
  // Groups stay together (desk+laptop+chair). Sparse > cluttered.
  const KITS = {
    library: [
      { key: 'bookshelf', xf: 0.34, depth: 22 },
      { key: 'bookshelf2', xf: 0.48, depth: 22 },
      { key: ['couchSmall', 'couchSmallGr'], xf: 0.68, depth: 23, sit: true },
      { key: 'coffee', xf: 0.82, depth: 24 },
      { key: ['floraBonsai', 'floraSucculent'], xf: 0.94, depth: 24 },
      { key: 'clipboard', xf: 0.55, depth: 21, wall: true },
    ],
    office: [
      { key: ['desk', 'desk2'], xf: 0.40, depth: 22 },
      { key: 'laptop', xf: 0.40, depth: 24, onSurface: true },
      { key: ['officechairBlue', 'officechairRed', 'officechairPurple', 'officechairOrange'], xf: 0.56, depth: 23, sit: true },
      { key: 'shelfMedium', xf: 0.78, depth: 22 },
      { key: ['floraSucculent', 'flora'], xf: 0.92, depth: 24 },
      { key: 'clipboard', xf: 0.72, depth: 21, wall: true },
    ],
    cafe: [
      { key: 'counter', xf: 0.36, depth: 22 },
      { key: 'counterEnd', xf: 0.50, depth: 22 },
      { key: ['stoolRed', 'stoolYellow', 'stoolBlue', 'stoolGreen'], xf: 0.64, depth: 23, sit: true },
      { key: ['stoolBlue', 'stoolGreen'], xf: 0.76, depth: 23, sit: true },
      { key: ['potRed', 'potYellow'], xf: 0.90, depth: 24 },
      { key: 'food', xf: 0.43, depth: 25, onSurface: true, food: true },
    ],
    kitchen: [
      { key: 'fridge', xf: 0.32, depth: 22 },
      { key: 'counter', xf: 0.50, depth: 22 },
      { key: 'oven', xf: 0.66, depth: 22 },
      { key: 'sink', xf: 0.82, depth: 22 },
      { key: 'food', xf: 0.50, depth: 25, onSurface: true, food: true },
      { key: ['floraAloe', 'floraSnake'], xf: 0.94, depth: 24 },
    ],
    lounge: [
      { key: ['couchBlue', 'couchGreen', 'couchRed', 'couchYellow'], xf: 0.40, depth: 23, sit: true },
      { key: 'coffee', xf: 0.56, depth: 24, near: 'couch' },
      { key: ['lamp', 'lamp2', 'lamp3'], xf: 0.70, depth: 22 },
      { key: ['floraFern', 'floraSnake', 'floraAloe'], xf: 0.86, depth: 24 },
      { key: 'food', xf: 0.56, depth: 25, onSurface: true, food: true },
      { key: 'clipboard', xf: 0.48, depth: 21, wall: true },
    ],
    reception: [
      { key: 'tableLong', xf: 0.42, depth: 22 },
      { key: 'clipboard', xf: 0.58, depth: 24, wall: true },
      { key: ['couchSmall', 'couchSmallY'], xf: 0.76, depth: 23, sit: true },
      { key: ['floraRose', 'floraFern'], xf: 0.92, depth: 24 },
      { key: 'food', xf: 0.42, depth: 25, onSurface: true, food: true },
    ],
    cozy: [
      { key: ['bedBlue', 'bedGreen', 'bed'], xf: 0.44, depth: 23, sit: true, bed: true },
      { key: ['lamp2', 'lamp3'], xf: 0.66, depth: 22 },
      { key: 'drawer', xf: 0.82, depth: 22 },
      { key: ['floraAloe', 'floraSnake'], xf: 0.92, depth: 24 },
    ],
    gallery: [
      { key: 'aquarium', xf: 0.4, depth: 23 },
      { key: 'terrarium', xf: 0.62, depth: 23 },
      { key: ['floraBonsai', 'floraRose'], xf: 0.88, depth: 24 },
    ],
    // ---- Pack-expansion kits: choosable per channel via `,room kit` ----
    bedroom: [
      { key: ['bed', 'bedBlue', 'bedGreen', 'bedRed', 'bedYellow'], xf: 0.40, depth: 23, sit: true, bed: true },
      { key: 'drawer', xf: 0.60, depth: 22 },
      { key: ['alarmBlue', 'alarmRed', 'alarmGreen'], xf: 0.60, depth: 24, onSurface: true },
      { key: ['lamp', 'lamp2'], xf: 0.78, depth: 22 },
      { key: ['floraSucculent', 'floraAloe'], xf: 0.94, depth: 24 },
      { key: 'airCon', xf: 0.72, depth: 21, wall: true },
      { key: ['calendar1', 'calendar2'], xf: 0.52, depth: 21, wall: true },
    ],
    bathroom: [
      { key: 'bathtub', xf: 0.38, depth: 23 },
      { key: 'sinkBath', xf: 0.56, depth: 22 },
      { key: 'toilet', xf: 0.72, depth: 22 },
      { key: 'washMachine', xf: 0.90, depth: 22 },
      { key: 'towelRail', xf: 0.55, depth: 21, wall: true },
    ],
    games: [
      { key: ['arcadeBlue', 'arcadeRed', 'arcadeGreen', 'arcadeYellow'], xf: 0.36, depth: 22 },
      { key: ['throneRed', 'throneBlue', 'throneGreen', 'thronePurple'], xf: 0.54, depth: 23, sit: true },
      { key: 'tvGame', xf: 0.70, depth: 22 },
      { key: ['vendingBlue', 'vendingRed', 'vendingGreen'], xf: 0.88, depth: 22 },
      { key: ['gLight1', 'gLight2', 'gLight3'], xf: 0.55, depth: 21, wall: true },
    ],
    spooky: [
      { key: 'coffin', xf: 0.38, depth: 23 },
      { key: ['candelabra', 'candelabra2'], xf: 0.54, depth: 22 },
      { key: 'bookshelfDark', xf: 0.70, depth: 22 },
      { key: 'chairHalloween', xf: 0.86, depth: 23, sit: true },
      { key: ['jack1', 'jack2', 'jack3'], xf: 0.94, depth: 24 },
      { key: ['cobwebRoom', 'cobwebRoom2'], xf: 0.60, depth: 21, wall: true },
    ],
    winter: [
      { key: 'xmasTree', xf: 0.38, depth: 23 },
      { key: ['snowman1', 'snowman2'], xf: 0.58, depth: 23 },
      { key: ['presentRedL', 'presentGreenL', 'presentWhiteL'], xf: 0.74, depth: 24 },
      { key: 'sled', xf: 0.90, depth: 23 },
    ],
    museum: [
      { key: ['statueF', 'statueM'], xf: 0.38, depth: 23 },
      { key: ['itemDisplayL', 'itemDisplayM'], xf: 0.58, depth: 22 },
      { key: 'guardRail', xf: 0.76, depth: 24 },
      { key: ['monaPixa', 'paintingNight'], xf: 0.55, depth: 21, wall: true },
    ],
    medical: [
      { key: 'bedHosp', xf: 0.38, depth: 23, sit: true, bed: true },
      { key: 'salineStand', xf: 0.52, depth: 24 },
      { key: 'storageMed', xf: 0.68, depth: 22 },
      { key: 'computerMed', xf: 0.86, depth: 22 },
      { key: 'posterMed', xf: 0.55, depth: 21, wall: true },
    ],
  };
  const KIT_NAMES = Object.keys(KITS);
  // Random fallback pool for unnamed channels — everyday kits only. Seasonal
  // and specialty kits (spooky/winter/museum/medical) are opt-in: picked by
  // channel-name keywords or set explicitly with `,room kit`.
  const KIT_POOL = [
    'library', 'office', 'cafe', 'kitchen', 'lounge', 'reception', 'cozy',
    'gallery', 'bedroom', 'games',
  ];

  // Pick a kit name for a channel: keyword on name first, then type, then seed.
  function kitForChannel(name, type, seed) {
    const n = String(name || '').toLowerCase();
    const test = (re) => re.test(n);
    if (type === 'voice' || type === 'stage') {
      // Voice = social spaces. Meeting/conference rooms get the long-table
      // reception kit; gaming VCs get the arcade; the rest are lounges/cafes.
      if (test(/(meet|conf|stand.?up|board|call|stage|podium)/)) return 'reception';
      if (test(/(game|gaming|arcade|play|rank|league|duo|squad|stream)/)) return 'games';
      if (test(/(afk|sleep|nap|zzz|chill)/)) return 'bedroom';
      return seededPick(seed, ['lounge', 'cafe', 'games']);
    }
    if (test(/(read|doc|wiki|book|faq|resource|guide|rule|info)/)) return 'library';
    if (test(/(dev|code|eng|build|git|ci|ops|cmd|tech|bug|deploy|infra)/)) return 'office';
    if (test(/(cafe|coffee|food|snack|lunch|bar|drink)/)) return 'cafe';
    if (test(/(kitchen|cook|recipe|meal)/)) return 'kitchen';
    if (test(/(welcome|start|rule|announce|intro|lobby|front|greet)/)) return 'reception';
    if (test(/(art|gallery|show|media|photo|design|pet|fish)/)) return 'gallery';
    if (test(/(game|gaming|arcade|play|clip|rank)/)) return 'games';
    if (test(/(spooky|horror|hallow|scary|grave|creep)/)) return 'spooky';
    if (test(/(winter|xmas|christmas|holiday|snow)/)) return 'winter';
    if (test(/(museum|history|exhibit|archive)/)) return 'museum';
    if (test(/(med|health|clinic|doctor|nurse|care)/)) return 'medical';
    if (test(/(bed|sleep|nap|dream)/)) return 'bedroom';
    if (test(/(bath|toilet|wc|wash|shower)/)) return 'bathroom';
    if (test(/(general|chat|hang|off.?topic|random|talk|lounge|social)/)) return 'lounge';
    if (test(/(afk|quiet|zzz|away|vent|feel)/)) return 'cozy';
    return seededPick(seed, KIT_POOL);
  }

  // =========================================================================
  // Category-level theme kits — a whole Discord category becomes one of
  // these themed building shells (cafe/arcade/hospital/museum/police/fire/
  // haunted manor), with each channel inside becoming one room, cycling the
  // kit's 2 recipes. This sits ABOVE the per-channel KITS system above: KITS
  // decorates a "plain" text-building room, THEME_KITS decorates a whole
  // building shell for categories whose name (or an unmatched round-robin
  // slot) calls for a themed set-piece instead of the plain office park.
  // =========================================================================
  const THEME_KITS = {
    cafe: {
      wall: 0xd88a5a, side: 0xb06a40, outline: 0x4a2410, roof: 0xc07048, band: 0x8a4e2c,
      signKey: 'cafeSign', signScale: SCALE,
      stripStyle: { color: '#ffe8d0', bg: '#6a3a1a' },
      roofKey: 'roofOrangeC', plaqueKey: 'uiTabYellow',
      doorFamily: 'wood',
      climbMode: 'door',
      // Elevator lane is the shared left strip (dx 14-58, shaft at 36).
      // Layout logic: dining sets read as table-flanked-by-seats pairs,
      // greenery bookends the right wall, food service runs left-of-center.
      stairsDx: 36,
      recipes: [
        () => ({
          h: 84, fill: 0xf4e0c8, slots: [90, 122, 150, 200],
          items: [
            ['w', 'plantHang', 20, 2],
            ['w', ['posterDonut1', 'posterDonut3', 'posterDonut5'], 100, 6],
            ['w', ['posterDonut2', 'posterDonut4'], 205, 6],
            ['f', 'stool', 76, 1, 0], ['f', 'tableMed2', 100, 1, 0], ['f', 'mug', 100, 1, 22],
            ['f', 'stool', 124, 1, 0],
            ['f', 'stoolB', 166, 1, 0], ['f', 'tableMed2', 190, 1, 0], ['f', 'glassJuice', 190, 1, 22],
            ['f', 'stoolB', 214, 1, 0], ['f', 'floraBonsaiFull', 244, 1, 0],
          ],
        }),
        () => ({
          h: 102, fill: 0xf8ead2, slots: [150, 176, 205, 228],
          items: [
            ['glow', 0xffd8a0, 0.08],
            ['w', 'plantHang', 244, 2], ['w', 'cafeSignBoard', 160, 8],
            ['f', 'fridge', 70, 1, 0], ['f', 'counter', 98, 1, 0], ['f', 'counter', 114, 1, 0],
            ['f', 'counter', 130, 1, 0], ['f', 'counterEnd', 146, 1, 0],
            ['f', ['pastryPink', 'pastryGreen', 'pastryWhite'], 100, 1, 26],
            ['f', ['pastryBlue', 'pastryRed', 'pastryPurple'], 120, 1, 26],
            ['f', ['pastryYellow', 'pastryPink', 'pastryGreen'], 140, 1, 26],
            ['npc', 'cafe-barista', 122],
            ['f', 'stool', 176, 1, 0], ['f', 'tableLong', 200, 1, 0], ['f', 'stool', 226, 1, 0],
            ['f', 'plantLarge', 248, 1, 0],
          ],
        }),
        // Recipe 2 = bakery corner: pastry counter with its own barista and a
        // window table for two.
        () => ({
          h: 90, fill: 0xf6e6ce, slots: [82, 140, 214],
          items: [
            ['w', ['posterDonut4', 'posterDonut1'], 82, 6],
            ['w', 'cafeSignBoard', 152, 8],
            ['w', 'plantHang', 240, 2],
            ['f', 'counter', 70, 1, 0], ['f', 'counterEnd', 86, 1, 0],
            ['f', ['pastryWhite', 'pastryYellow', 'pastryBlue'], 74, 1, 26],
            ['npc', 'cafe-barista-b', 100],
            ['f', 'stoolB', 142, 1, 0], ['f', 'tableMed2', 166, 1, 0],
            ['f', ['mug', 'glassJuice'], 166, 1, 22],
            ['f', 'stool', 190, 1, 0],
            ['f', 'plantLarge', 246, 1, 0],
          ],
        }),
      ],
      outside(scene, left, bw, groundY) {
        const seed = hashSeed(`cafe${left}`);
        scene.furn(seededPick(seed, ['umbrellaRed', 'umbrellaBlue'], 1), left - 34, groundY, 19);
        scene.furn('benchWood', left - 34, groundY, 20);
        scene.furn(seededPick(seed, ['umbrellaGreen', 'umbrellaYellow'], 2), left + bw + 36, groundY, 19);
        scene.furn('benchWood', left + bw + 36, groundY, 20);
      },
    },
    gamer: {
      wall: 0x2a2a3e, side: 0x1c1c2c, outline: 0x0c0c16, roof: 0x3c3c58, band: 0x14142a,
      title: { color: '#c8f8ff', bg: '#1c1c2c' },
      stripStyle: { color: '#c8f8ff', bg: '#14142a' },
      roofKey: 'roofPurpleC', plaqueKey: 'uiTabPurple',
      doorFamily: 'glass',
      climbMode: 'elev',
      // Elevator lane left (shaft at 36). Layout logic: battlestation desk
      // cluster (PC + desk + monitor + mic + throne) center-left, trophy
      // shelf mid-right, second throne facing the mounted TV on the right.
      stairsDx: 36,
      recipes: [
        () => ({
          h: 84, fill: 0x3a3a54, slots: [70, 165, 205],
          items: [
            ['glow', 0x8a6aff, 0.1],
            ['w', ['gLight1', 'gLightRed'], 70, 4],
            ['w', ['poster10', 'poster11'], 125, 4],
            ['w', ['gLight2', 'gLightYellow'], 175, 4],
            ['w', ['poster11', 'poster10'], 230, 4],
            ['f', 'pc', 66, 1, 0],
            ['f', 'deskOfficeLong', 105, 1, 0], ['f', 'monitor', 93, 1, 14], ['f', 'micDesk', 117, 1, 14],
            ['f', ['throneRed', 'throneGreen', 'thronePurple'], 140, 1, 0],
            ['f', 'shelfMed', 190, 1, 0],
            ['f', ['headsetBlue', 'headsetGreen', 'headsetPurple', 'headsetRed', 'headsetVR'], 190, 1, 26],
            ['f', 'trophy', 202, 1, 26],
            ['f', ['throneBlue', 'throneYellow', 'throneGreen'], 225, 1, 0], ['f', 'tvGame', 246, 1, 30],
          ],
        }),
        () => ({
          h: 102, fill: 0x2e2e46, slots: [86, 150, 216, 244],
          items: [
            ['glow', 0x5a8aff, 0.12],
            ['w', ['gLight3', 'gLightYellow'], 85, 4],
            ['w', ['gLight1', 'gLightRed'], 150, 4],
            ['w', ['gLight2', 'gLight3'], 215, 4],
            ['f', ['arcadeBlue', 'arcadeGreen'], 70, 1, 0],
            ['f', ['arcadeRed', 'arcadeYellow'], 102, 1, 0],
            ['f', ['arcadeGreen', 'arcadeBlue'], 134, 1, 0],
            ['f', ['arcadeYellow', 'arcadeRed'], 166, 1, 0],
            ['f', ['vendingBlue', 'vendingGreen', 'vendingYellow'], 200, 1, 0],
            ['f', ['vendingRed', 'vendingOrange'], 232, 1, 0],
            ['f', 'gameConsole', 252, 1, 0], ['f', 'trashcanFull', 184, 1, 0],
          ],
        }),
      ],
    },
    hospital: {
      wall: 0xe8ecf2, side: 0xc0c8d4, outline: 0x2a3444, roof: 0xd8e0ea, band: 0x9aa8ba,
      signKey: 'hospSign', signScale: SCALE * 0.9,
      stripStyle: { color: '#ffffff', bg: '#c0392b' },
      title: { color: '#ffffff', bg: '#c0392b' },
      roofKey: 'roofBlueC', plaqueKey: 'uiTabBlue',
      doorFamily: 'grey',
      climbMode: 'elev',
      // Elevator lane left (shaft at 36).
      // Recipe 0 = OR theater (patient on table + scrub team).
      // Recipe 1 = ward (beds, nurses, rounds doctor, waiting).
      stairsDx: 36,
      recipes: [
        () => ({
          // Operating theater — fixed surgery table (never CT) + full scrub cast.
          h: 98, fill: 0xc8e8e0, slots: [88, 220],
          items: [
            ['glow', 0x7ad0c0, 0.11],
            ['w', ['lightSurgery', 'lightSurgeryBlack'], 150, 2],
            ['w', ['monitorMedWall', 'monitorMedWallBlack'], 108, 6],
            ['w', ['monitorMedWall', 'monitorMedWallBlack'], 192, 6],
            ['w', 'posterMed', 240, 8],
            ['f', ['storageMed', 'storageMedBlack'], 72, 1, 0],
            ['f', 'salineStand', 100, 1, 0],
            // Patient on the table; scrub team rings the OR bed.
            ['f', 'tableSurgery', 150, 1, 0],
            ['npc', 'hospital-or-patient', 150, {
              role: 'patient', bedDx: 150, onSurgery: true, bedKey: 'tableSurgery',
            }],
            ['npc', 'hospital-surgeon-lead', 122, {
              role: 'surgeon', attendDx: 150, side: 'left', onSurgery: true, station: 'lead',
            }],
            ['npc', 'hospital-surgeon-assist', 178, {
              role: 'surgeon', attendDx: 150, side: 'right', onSurgery: true, station: 'assist',
            }],
            ['npc', 'hospital-surgeon-scrub', 150, {
              role: 'surgeon', attendDx: 150, side: 'left', onSurgery: true, station: 'scrub',
              standOffset: 40,
            }],
            ['npc', 'hospital-nurse-or-a', 104, {
              role: 'nurse', attendDx: 150, side: 'left', onSurgery: true, station: 'anes',
              standOffset: 48,
            }],
            ['npc', 'hospital-nurse-or-b', 196, {
              role: 'nurse', attendDx: 150, side: 'right', onSurgery: true, station: 'circ',
              standOffset: 46,
            }],
            ['f', 'tableSteel', 204, 1, 0],
            ['f', 'salineStand', 228, 1, 0],
            ['f', ['monitorMed', 'monitorMedBlack'], 204, 1, 8],
            ['f', ['computerMed', 'computerMedBlack'], 248, 1, 0],
          ],
        }),
        () => ({
          // Patient ward — beds, bedside nurses, rounding surgeon, waiting area.
          h: 108, fill: 0xe8f4f0, slots: [110, 170, 232],
          items: [
            ['glow', 0xc8f0e0, 0.09],
            ['w', 'hospLogo', 160, 6],
            ['w', 'posterMed', 78, 8],
            ['w', ['monitorMedWall', 'monitorMedWallBlack'], 200, 6],
            ['f', 'bedHosp', 78, 1, 0],
            ['npc', 'hospital-patient-a', 78, { role: 'patient', bedDx: 78 }],
            ['npc', 'hospital-nurse-a', 56, { role: 'nurse', attendDx: 78, side: 'left' }],
            ['f', 'salineStand', 102, 1, 0],
            ['f', 'bedHosp', 148, 1, 0],
            ['npc', 'hospital-patient-b', 148, { role: 'patient', bedDx: 148 }],
            ['npc', 'hospital-nurse-b', 170, { role: 'nurse', attendDx: 148, side: 'right' }],
            ['npc', 'hospital-surgeon-rounds', 126, {
              role: 'surgeon', attendDx: 148, side: 'left', station: 'rounds',
            }],
            ['f', 'salineStand', 176, 1, 0],
            ['f', ['computerMed', 'computerMedBlack'], 210, 1, 0],
            ['f', ['storageMed', 'storageMedBlack'], 240, 1, 0],
            ['f', ['waitChairSolo', 'waitChairSoloRed'], 252, 1, 0],
            ['npc', 'hospital-nurse-desk', 228, {
              role: 'nurse', attendDx: 210, side: 'right', station: 'desk', standOffset: 18,
            }],
          ],
        }),
        // Recipe 2 = imaging suite: CT scanner bay with a tech at the console.
        () => ({
          h: 96, fill: 0xdce8f4, slots: [92, 200, 244],
          items: [
            ['glow', 0x9ac0f0, 0.08],
            ['w', ['monitorMedWall', 'monitorMedWallBlack'], 210, 6],
            ['w', 'posterMed', 90, 8],
            ['f', 'salineStand', 100, 1, 0],
            ['f', 'ctScanner', 150, 1, 0],
            ['npc', 'hospital-nurse-imaging', 196, {
              role: 'nurse', attendDx: 150, side: 'right', standOffset: 34,
            }],
            ['f', ['computerMed', 'computerMedBlack'], 226, 1, 0],
            ['f', ['storageMed', 'storageMedBlack'], 252, 1, 0],
          ],
        }),
      ],
      outside(scene, left, bw, groundY) {
        // A nurse on break by the entrance.
        scene.decorNpcQueue.push([`hospital-nurse-break-${left}`, left + bw + 28, groundY]);
      },
    },
    museum: {
      bw: 340,
      wall: 0xd8c8a8, side: 0xb8a888, outline: 0x3a2e1c, roof: 0xc8b896, band: 0x8a7a5a,
      title: { color: '#3a2e1c', bg: '#f0e4c8' },
      stripStyle: { color: '#f8f0d8', bg: '#5a4a30' },
      roofKey: 'roofYellowC', plaqueKey: 'uiTabYellow',
      doorFamily: 'glass',
      climbMode: 'elev',
      // Elevator lane left (shaft at 36). Layout logic: the space wing hangs
      // the solar system in orbit order left→right with exhibit cases below;
      // the fossil hall centers the triceratops on its platform between
      // guard rails, flanked by a statue and a rail-guarded display case.
      stairsDx: 36,
      recipes: [
        () => ({
          h: 90, fill: 0x2a2848, slots: [95, 140, 230],
          items: [
            ['glow', 0x4a4a9a, 0.1],
            ['w', 'sun', 70, 6],
            ['w', ['earth', 'venus'], 108, 18],
            ['w', ['mars', 'mercury'], 138, 10],
            ['w', 'jupiter', 175, 16],
            ['w', ['saturn', 'uranus'], 218, 8],
            ['w', ['neptune', 'uranus'], 255, 20], ['w', 'spaceship', 285, 10],
            ['f', 'itemDisplayM', 90, 1, 0],
            ['f', ['meteorite1', 'meteorite2'], 90, 1, 15],
            ['f', 'itemDisplayL', 195, 1, 0], ['f', 'guardRail', 195, 1, 0],
          ],
        }),
        () => ({
          h: 112, fill: 0xf0e8d0, slots: [95, 125, 240, 268],
          items: [
            ['w', 'lightFixture', 180, 2], ['w', 'monaPixa', 100, 12], ['w', 'paintingNight', 262, 12],
            ['f', 'pillarMuseum', 70, 1, 0], ['f', 'pillarMuseum', 296, 1, 0],
            ['f', 'platformMuseum', 180, 1, 0], ['f', 'triceratops', 180, 1, 6],
            ['f', 'guardRail', 143, 1, 0], ['f', 'guardRail', 217, 1, 0],
            ['f', 'statueF', 97, 1, 0],
            ['f', 'itemDisplayM', 122, 1, 0],
            ['f', ['megalodonJaw', 'trunkMammoth'], 122, 1, 15],
            ['f', 'statueM', 250, 1, 0],
          ],
        }),
        // Recipe 2 = archaeology annex: three display cases in a clean exhibit
        // row, artifact inside each glass, one rail between clusters, docent
        // on the open floor. dx spacing is width-aware: the climb lane
        // reserves x<=~85 (clearX 36 + clearR + halfW), and neighbours need
        // hw1+hw2+6 clearance or placeRoomItems nudges/drops them —
        // itemDisplay S/M/L are 14/16/30px wide (hw 14/16/30 at SCALE).
        () => ({
          h: 96, fill: 0xe8dcc0, slots: [110, 200, 285],
          items: [
            ['w', 'lightFixture', 165, 2],
            ['w', ['clipboardLong1', 'clipboardLong2'], 262, 8],
            ['f', 'itemDisplayS', 92, 1, 0],
            ['f', ['crownDig', 'neolithicMask'], 92, 1, 12],
            ['f', 'guardRail', 130, 1, 0],
            ['f', 'itemDisplayM', 170, 1, 0],
            ['f', ['stoneTablet', 'megalodonTooth'], 170, 1, 12],
            ['f', 'itemDisplayL', 224, 1, 0],
            ['f', ['potteryAncient', 'fossilFish'], 224, 1, 12],
            ['npc', 'museum-docent', 282],
          ],
        }),
      ],
      outside(scene, left, bw, groundY) {
        // Statue flanking the museum entrance.
        scene.furn('statueM', left - 26, groundY, 18);
      },
    },
    police: {
      wall: 0x5a7a9a, side: 0x42607e, outline: 0x14202e, roof: 0x4a6a8a, band: 0x2a4058,
      signKey: 'policeSign', signScale: SCALE * 0.9,
      stripStyle: { color: '#d8e8f8', bg: '#1a2a3a' },
      roofKey: 'roofBlackC', plaqueKey: 'uiTabBlue',
      doorFamily: 'grey',
      climbMode: 'elev',
      // Elevator lane left (shaft at 36). Layout logic: booking room reads
      // left→right as records cabinet, officer desk with paperwork under
      // the duty clipboard/portrait, then the holding cell (bars over the
      // right end with a prisoner bench inside); the lobby pairs wanted
      // posters over the front desk with visitor chairs by the wall.
      stairsDx: 36,
      recipes: [
        () => ({
          h: 84, fill: 0xb8c0c8, slots: [80, 150],
          items: [
            ['w', ['clipboardWallSmall', 'clipboardLong1', 'clipboardLong2'], 90, 6],
            ['w', ['portraitOfficer', 'portraitOfficer2', 'portraitOfficer3'], 150, 6],
            ['f', 'filecabinet', 66, 1, 0],
            ['f', 'deskOffice', 130, 1, 0],
            ['f', ['paperStack', 'paperStack2'], 123, 1, 14],
            ['f', ['waitChairSolo', 'waitChairSoloRed'], 205, 1, 0],
          ],
          bars: true,
        }),
        () => ({
          h: 102, fill: 0xd0d8e0, slots: [72, 110, 185],
          items: [
            ['w', 'posterWanted', 80, 8], ['w', 'posterWanted2', 108, 8], ['w', 'policeLogo', 165, 6],
            ['f', 'filecabinet', 68, 1, 0],
            ['f', 'policeDesk', 160, 1, 0], ['npc', 'police-cop', 160],
            ['f', ['waitChairs', 'waitChairsRed'], 212, 1, 0],
            ['f', 'floraFernFull', 246, 1, 0],
          ],
        }),
        // Recipe 2 = holding cells: barred doors, a guard on watch, and a
        // detainee (civilian sheet on purpose) waiting it out.
        () => ({
          h: 96, fill: 0xa8b0bc, slots: [72, 112],
          items: [
            ['w', ['posterWanted2', 'posterWanted'], 72, 8],
            ['w', 'clipboardWallSmall', 112, 6],
            ['f', ['waitChairSolo', 'waitChairSoloRed'], 92, 1, 0],
            ['npc', 'police-cop-guard', 140],
            ['f', 'prisonDoor', 178, 1, 0],
            ['npc', 'jail-detainee', 206],
            ['f', 'prisonDoor', 240, 1, 0],
          ],
          bars: true,
        }),
      ],
      outside(scene, left, bw, groundY) {
        // Patrol officer out front of the station.
        scene.decorNpcQueue.push([`police-cop-patrol-${left}`, left - 26, groundY]);
      },
    },
    fire: {
      wall: 0xc84a3a, side: 0xa03828, outline: 0x3a0e08, roof: 0xb04030, band: 0x701e14,
      signKey: 'fireSign', signScale: SCALE * 0.85,
      stripStyle: { color: '#ffe0d0', bg: '#701e14' },
      roofKey: 'roofRedC', plaqueKey: 'uiTabRed',
      doorFamily: 'grey',
      climbMode: 'door',
      // Climb door on the left lane (dx ~36). Rooms are too small for elev
      // shafts — a compact door marks inter-floor travel instead.
      stairsDx: 36,
      recipes: [
        () => ({
          h: 84, fill: 0xf0dcc8, slots: [130, 185],
          items: [
            ['w', 'framedCert', 100, 6],
            ['w', ['portraitFF', 'portraitFF2', 'portraitFF3'], 155, 6],
            ['w', ['fireAlarm', 'fireAxe'], 205, 6],
            ['f', 'bunkBottom', 80, 1, 0], ['f', 'bunkTop', 80, 1, 22], ['f', 'cabinetFull', 122, 1, 0],
            ['f', 'boxEmergency', 160, 1, 0], ['f', 'bunkBottom', 226, 1, 0], ['f', 'bunkTop', 226, 1, 22],
          ],
        }),
        () => ({
          h: 102, fill: 0xe0d4c4, slots: [110, 165, 230],
          items: [
            ['glow', 0xffb090, 0.07],
            ['w', ['hoseWall', 'hoseWallShort'], 125, 6],
            ['w', ['uniformHang', 'uniformHang2'], 170, 10],
            ['w', ['uniformHang2', 'uniformHang'], 195, 10],
            ['w', 'fireLogo', 240, 6],
            ['f', 'locker', 70, 1, 0], ['f', 'locker', 96, 1, 0], ['f', 'rackEquip', 126, 1, 0],
            ['f', 'helmetFF', 96, 1, 46],
            ['npc', 'fire-firefighter', 156], ['f', 'fireExt', 216, 1, 0], ['f', 'boxEmergency', 190, 1, 0],
          ],
        }),
        // Recipe 2 = ready bay: locker row, gear rack, two crew on standby.
        () => ({
          h: 96, fill: 0xe8d8c4, slots: [98, 150, 220],
          items: [
            ['glow', 0xffc8a0, 0.06],
            ['w', 'fireLogo', 85, 6],
            ['w', ['clipboardLong1', 'portraitFF2'], 152, 6],
            ['w', ['fireAlarm', 'fireAxe'], 232, 6],
            ['f', 'locker', 66, 1, 0], ['f', 'locker', 92, 1, 0], ['f', 'locker', 118, 1, 0],
            ['f', 'rackEquip', 150, 1, 0], ['f', 'helmetFF', 150, 1, 46],
            ['npc', 'fire-crew-a', 186],
            ['npc', 'fire-crew-b', 226],
            ['f', 'fireExt', 252, 1, 0],
          ],
        }),
      ],
      outside(scene, left, bw, groundY) {
        scene.furn('fireHydrant', left - 30, scene.groundY, 19);
        // A firefighter out by the bay doors.
        scene.decorNpcQueue.push([`fire-crew-street-${left}`, left + (bw || 290) + 26, groundY || scene.groundY]);
      },
    },
    halloween: {
      wall: 0x4a3458, side: 0x362442, outline: 0x140a1c, roof: 0x3a2848, band: 0x241432,
      title: { color: '#ffb858', bg: '#241432' },
      stripStyle: { color: '#ffb858', bg: '#140a1c' },
      roofKey: 'roofBlackC', plaqueKey: 'uiTabPurple',
      doorFamily: 'wood',
      climbMode: 'door',
      // Elevator lane left (shaft at 36; the cobweb stays in the top-left
      // corner above it). Layout logic: attic = coffin flanked by a grave
      // candle, then mummy / ghost-lamp / skeleton spaced down the room;
      // parlor = reading corner (dark bookshelf + candelabra + cursed
      // chair) then witch tending her jack-o-lantern patch on the right.
      stairsDx: 36,
      recipes: [
        // Scene 1 — crypt attic: coffin, grave candles, a REAL pack ghost
        // drifting between the mummy-wrapped caretakers.
        () => ({
          h: 84, fill: 0x584668, slots: [110, 165, 235],
          items: [
            ['glow', 0x8a5aff, 0.08],
            ['w', ['cobwebRoom', 'cobwebRoom2'], 12, 2],
            ['w', ['lanternHang', 'lanternHang2'], 130, 2],
            ['w', ['cobwebRoom2', 'cobwebRoom'], 245, 2],
            ['f', 'coffin', 80, 1, 0],
            ['f', ['candleTable', 'candleTable2', 'candleTable3'], 115, 1, 0],
            ['npc', 'halloween-ghost-attic', 152], ['f', 'lampGhost', 192, 1, 0], ['npc', 'halloween-skeleton', 228],
          ],
        }),
        // Scene 2 — witch's parlor: reading corner + jack-o-lantern patch.
        () => ({
          h: 102, fill: 0x6a5478, slots: [105, 155, 220],
          items: [
            ['glow', 0xff8a30, 0.06],
            ['w', 'chandelier', 150, 2], ['w', 'portraitDracula', 85, 8],
            ['w', ['cobwebRoom', 'cobwebRoom2'], 250, 2],
            ['f', 'bookshelfDark', 70, 1, 0],
            ['f', ['candelabra', 'candelabra2', 'candelabra3'], 102, 1, 0],
            ['f', 'chairHalloween', 132, 1, 0],
            ['npc', 'halloween-witch', 168],
            ['f', ['jack1', 'jack3'], 198, 1, 0],
            ['f', ['jack2', 'jack4'], 218, 1, 0],
            ['f', ['pumpkinBasket', 'pumpkinBasket2'], 242, 1, 0],
          ],
        }),
        // Scene 3 — séance chamber: candelabra ring around the table, dracula
        // watching, two ghosts in attendance.
        () => ({
          h: 96, fill: 0x4a3a5c, slots: [100, 160, 225],
          items: [
            ['glow', 0x9a4aff, 0.10],
            ['w', 'chandelier', 128, 2],
            ['w', 'portraitDracula', 220, 8],
            ['w', ['cobwebRoom', 'cobwebRoom2'], 14, 2],
            ['f', ['candelabra', 'candelabra3'], 74, 1, 0],
            ['f', ['candleTable2', 'candleTable'], 108, 1, 0],
            ['npc', 'halloween-ghost-seer', 142],
            ['npc', 'halloween-vampire-host', 176],
            ['f', ['candleTable3', 'candleTable2'], 200, 1, 0],
            ['npc', 'halloween-ghost-guest', 224],
            ['f', ['candelabra2', 'candelabra'], 248, 1, 0],
          ],
        }),
        // Scene 4 — pumpkin cellar: harvest wall of jacks + the mummy tending
        // baskets under a ghost lamp.
        () => ({
          h: 88, fill: 0x5c4450, slots: [112, 170, 232],
          items: [
            ['glow', 0xff8a30, 0.08],
            ['w', ['lanternHang2', 'lanternHang'], 60, 2],
            ['w', ['cobwebRoom2', 'cobwebRoom'], 246, 2],
            ['f', ['jack1', 'jack2'], 70, 1, 0],
            ['f', ['jack3', 'jack4'], 92, 1, 0],
            ['f', 'lampGhost', 122, 1, 0],
            ['npc', 'halloween-mummy', 156],
            ['f', ['pumpkinBasket', 'pumpkinBasket2'], 192, 1, 0],
            ['f', ['pumpkinBasket2', 'pumpkinBasket'], 216, 1, 0],
            ['npc', 'halloween-ghost-cellar', 240],
          ],
        }),
      ],
      outside(scene, left, bw, groundY) {
        const seed = hashSeed(`hw${left}`);
        // --- Street set dressing ---
        scene.furn('treeDeadL', left - 36, groundY, 18);
        scene.furn('treeDeadM', left + bw + 34, groundY, 18);
        scene.furn('lampPostHW', left + bw + 60, groundY, 19);
        scene.furn(seededPick(seed, ['billboardPumpkin', 'billboardGhosts', 'billboardScary'], 1), left - 62, groundY, 18);
        scene.furn(seededPick(seed, ['jack2', 'jack4', 'pumpkinBasket'], 7), left - 14, groundY, 19);
        // --- Biome sky: moon + drifting grey storm clouds + purple haze ---
        scene.add.image(left + bw / 2, 60, 'moonHW').setScale(SCALE).setDepth(-60);
        const haze = scene.add.graphics().setDepth(-58);
        haze.fillStyle(0x2a1440, 0.16);
        haze.fillRect(left - 40, -140, bw + 120, (groundY - -140) + 20);
        ['cloudGrey1', 'cloudGrey2', 'cloudGrey3'].forEach((ck, i) => {
          if (!scene.textures.exists(ck)) return;
          const cx = left + 30 + i * (bw / 2.4);
          const cy = 34 + ((seed >> i) % 26);
          const cImg = scene.add.image(cx, cy, ck).setScale(2).setDepth(-59).setAlpha(0.9);
          scene.tweens.add({
            targets: cImg, x: cx + 46 + (i * 12), duration: 15000 + i * 4200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
        });
        // --- Ground fog banks rolling along the street ---
        for (let i = 0; i < 2; i += 1) {
          const fog = scene.add.graphics().setDepth(19.5);
          fog.fillStyle(0xb8a8d8, 0.10 + i * 0.04);
          fog.fillEllipse(left + bw * (0.3 + i * 0.4), groundY - 7, bw * 0.7, 22);
          scene.tweens.add({
            targets: fog, x: (i ? -1 : 1) * 30, alpha: 0.5, duration: 5200 + i * 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
        }
        // --- Sky spirits: floating sheet-ghosts + a bat pair ---
        const ghost = scene.add.image(left - 20, groundY - 60, seededPick(seed, ['ghost1', 'ghost2'], 2)).setScale(SCALE).setDepth(19).setAlpha(0.8);
        scene.tweens.add({ targets: ghost, y: groundY - 80, x: left + 30, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        // Pack bat art is drawn ROOSTING (hanging head-down, as bats sleep) —
        // flip vertically so airborne bats read as flying, wings up.
        const bat = scene.add.image(left + bw + 20, groundY - 120, seededPick(seed, ['bat1', 'bat2'], 3)).setScale(SCALE).setDepth(19).setFlipY(true);
        scene.tweens.add({ targets: bat, x: left + bw + 90, y: groundY - 150, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const bat2 = scene.add.image(left - 30, groundY - 160, seededPick(seed, ['bat2', 'bat1'], 5)).setScale(SCALE * 0.8).setDepth(19).setAlpha(0.9).setFlipY(true);
        scene.tweens.add({ targets: bat2, x: left + bw * 0.5, y: groundY - 190, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        // --- A real animated ghost NPC haunting the sidewalk ---
        scene.decorNpcQueue.push([`halloween-ghost-street-${left}`, left + bw * 0.5, groundY]);
      },
    },
  };
  // Round-robin pool for categories whose name matches nothing below —
  // 'plain' keeps today's tasteful per-channel office-park building so a
  // typical dev server still looks like today's map most of the time; the
  // themed set-pieces are sprinkled in for variety.
  const THEME_ROTATION_POOL = ['plain', 'plain', 'cafe', 'gamer', 'hospital', 'museum', 'police', 'fire', 'halloween'];
  const KEYWORD_THEMES = [
    [/cafe|coffee|food|kitchen/i, 'cafe'],
    [/game|gaming|arcade|clip|media/i, 'gamer'],
    [/support|help|health|med|hospital/i, 'hospital'],
    [/art|gallery|showcase|museum|history/i, 'museum'],
    [/mod|admin|staff|report|police|security/i, 'police'],
    [/alert|incident|fire|urgent|emergency/i, 'fire'],
    [/meme|spook|horror|halloween|off-?topic/i, 'halloween'],
  ];
  const SPECIAL_ZONE_THEMES = [
    [/winter|xmas|christmas|holiday|snow/i, 'winterzone'],
    [/dig|archaeo|fossil|excavat|research|\blab\b/i, 'digzone'],
  ];

  // Operating-theater chatter so the scrub team reads as a live team, not props.
  const OR_CHATTER = {
    surgeon: ['Scalpel.', 'Clamp, please.', 'Suction here.', 'Steady…', 'Good exposure.',
      'Retractor.', 'Almost there.', 'Nice and clean.', 'Hold that.', 'Closing up.'],
    nurse: ['BP holding.', 'Sats look good.', 'Sponge count clear.', 'Passing suture.',
      'Vitals stable.', 'Two units ready.', 'More saline?', 'Charting it now.'],
  };

  class ExampleMapScene extends Phaser.Scene {
    constructor() {
      super('example');
    }

    preload() {
      Object.entries(ASSETS).forEach(([k, p]) => this.load.image(k, p));
      // 30 pre-made NPC sheets (16x32 frames): row 0 walk, row 1 idle.
      NPC_SHEETS.forEach((n) => this.load.spritesheet(n.key, n.path, { frameWidth: NPC_FRAME.w, frameHeight: NPC_FRAME.h }));
      HOSP_NPC_SHEETS.forEach((n) => this.load.spritesheet(n.key, n.path, { frameWidth: NPC_FRAME.w, frameHeight: NPC_FRAME.h }));
      GHOST_NPC_SHEETS.forEach((n) => this.load.spritesheet(n.key, n.path, { frameWidth: NPC_FRAME.w, frameHeight: NPC_FRAME.h }));
      THEMED_NPC_SHEETS.forEach((n) => this.load.spritesheet(n.key, n.path, { frameWidth: NPC_FRAME.w, frameHeight: NPC_FRAME.h }));
      COSTUME_NPC_SHEETS.forEach((n) => this.load.spritesheet(n.key, n.path, { frameWidth: NPC_FRAME.w, frameHeight: NPC_FRAME.h }));
      // Street pets — 32x32 frames (Paws & Whiskers free packs).
      PET_SHEETS.forEach((p) => this.load.spritesheet(p.key, p.path, {
        frameWidth: PET_FRAME,
        frameHeight: PET_FRAME,
      }));
      // Missing-asset diagnostics so a bad path shows in console instead of silently vanishing.
      this.load.on('loaderror', (file) => console.warn('[map] asset failed:', file.key, file.src));
    }

    /**
     * Pack "Door_*_closed" sprites are 3–6px edge-on strips. Build a real
     * front-facing leaf. Sized 14×22 so at SCALE=2 the outdoor door (44px)
     * fits the 54px facade strip without poking into the first floor.
     */
    ensureFrontDoorTextures() {
      if (this.textures.exists('doorFrontClosed')) return;
      const w = 14;
      const h = 22;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // Palette matches Door_wood_* (outline #2e222f, wood #e6904e)
      const OUT = '#2e222f';
      const WOOD = '#e6904e';
      const WOOD_DK = '#c46a32';
      const WOOD_LT = '#f0b078';
      const PANEL = '#d47e3e';
      const KNOB = '#f0e6c8';
      const fill = (x, y, ww, hh, c) => {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, ww, hh);
      };
      fill(0, 0, w, h, OUT);
      fill(1, 1, w - 2, h - 2, WOOD);
      fill(2, 2, 1, h - 4, WOOD_LT);
      fill(w - 3, 2, 1, h - 4, WOOD_DK);
      // Upper panel
      fill(3, 3, w - 6, 6, OUT);
      fill(4, 4, w - 8, 4, PANEL);
      fill(5, 4, w - 10, 1, WOOD_LT);
      // Mid rail
      fill(3, 10, w - 6, 2, OUT);
      fill(4, 10, w - 8, 1, WOOD_LT);
      // Lower panel
      fill(3, 13, w - 6, 6, OUT);
      fill(4, 14, w - 8, 4, PANEL);
      fill(5, 14, w - 10, 1, WOOD_LT);
      // Handle
      fill(w - 5, 11, 2, 2, OUT);
      fill(w - 5, 11, 1, 1, KNOB);
      fill(1, h - 2, w - 2, 1, WOOD_DK);

      this.textures.addCanvas('doorFrontClosed', canvas);
      try {
        this.textures.get('doorFrontClosed').setFilter(Phaser.Textures.FilterMode.NEAREST);
      } catch (_) { /* ignore */ }
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
      this.sitables = []; // { x, floorId, kind: 'sit'|'bed', radius }
      this.elevSprites = []; // { x, sprite } outdoor elevators for open/close anim
      this.indoors = null;
      this.enterCooldown = 0;
      this._sitting = null; // { x, floorY, kind } while seated/lying
      this._sceneMinY = 0; // tallest building's roof, tracked as buildings draw
      this.decorNpcQueue = []; // [seed, x, floorY, roomKey, opts?] queued by themed rooms
      this.hospitalRoomKeys = new Set(); // ch_* rooms built with THEME_KITS.hospital
      this._themeRR = 0; // round-robin index for THEME_ROTATION_POOL
      this._missingAssets = new Set();
      this.seats = []; // interactable seats/beds, auto-registered by furn()
      this.foods = []; // interactable food { x, floorY, floorId, key, radius, sprite }
      this.foodHosts = []; // tables/counters that can hold food { x, floorY, floorId, key, surfaceH }
      this.ambientActors = []; // { sprite, sheet, roomKey, busyUntil }
      this.pets = [];
      this.companionPets = new Map();
      this.autoDoors = []; // entrance door sprites that open on approach
      this.elevatorDoors = []; // per-floor elevator shaft doors {x, floorId, img}
      this.seated = null; // { seat, prevDepth } while sitting/lying
      this.presenceEl = document.getElementById('presence-status');
      this.hintEl = document.getElementById('enter-hint');

      Object.keys(this.textures.list).forEach((key) => {
        if (key === '__DEFAULT' || key === '__MISSING') return;
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      });

      this.ensureFrontDoorTextures();

      this.buildSky();
      this.buildFarMountains();
      this.buildDistantSkyline();
      this.makeAnims();
      this.verifyMapSocialAssets();

      this.bootstrapLayout().then((layoutMeta) => {
        this.flushDecorNpcQueue();
        this.seedFoodOnAllTables();
        this.buildPetCellTextures();
        // Anonymous sidewalk cast only — BlockLife named residents stay off (Discord presence wins).
        this.spawnDecorNpcs();
        this.startAmbientLoop();
        this.startPresenceLoop();
        this.setupPlayer();
        this.buildHud(layoutMeta?.guildName || 'Discord', layoutMeta);
        this.cameras.main.fadeIn(500, 126, 200, 232);
      }).catch(() => {
        this.drawGround();
        this.extendBackdrop();
        this.drawEmptyBuilding(20, this.groundY, 'Discord');
        this.seedFoodOnAllTables();
        this.setupPlayer();
        this.buildPetCellTextures();
        this.startAmbientLoop();
        this.startPresenceLoop();
        this.buildHud('Discord');
      });
    }

    /** Expand world + camera bounds so upper floors / rooftops are reachable. */
    refreshCameraBounds() {
      const mw = this.mapWidth || W;
      let topBound = Math.min(0, this._sceneMinY ?? 0);
      // Include every registered floor (rooms + roofs)
      if (this.floors) {
        for (const f of this.floors.values()) {
          if (f?.floorY != null) topBound = Math.min(topBound, f.floorY - 140);
        }
      }
      if (this.player) topBound = Math.min(topBound, this.player.y - 160);
      const bottom = (this.groundY || 318) + 90;
      const height = Math.max(H, bottom - topBound);
      try {
        this.physics.world.setBounds(0, topBound, mw + 40, height);
        this.cameras.main.setBounds(0, topBound, mw + 40, height);
      } catch (_) { /* ignore */ }
      return topBound;
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
      this.refreshCameraBounds();
      // Snappier follow so upper floors / roof don't leave the camera behind.
      // __NO_FOLLOW: test-harness hook (test-shot.html) — lets headless
      // screenshot sweeps pin the camera without follow fighting back.
      if (!window.__NO_FOLLOW) this.cameras.main.startFollow(this.player, true, 0.18, 0.22);
      const narrow = window.innerWidth < 640;
      this.outdoorZoom = IS_TOUCH && narrow ? 0.98 : 1.1;
      this.indoorZoom = IS_TOUCH && narrow ? 1.38 : 1.55;
      this.cameras.main.setZoom(this.outdoorZoom);
      this.layoutHud?.();
      this.cameras.main.setDeadzone(narrow ? 40 : 70, narrow ? 24 : 36);

      this.playerTag = this.add.text(0, 0, 'you', {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 5, y: 2 },
      }).setOrigin(0.5, 1).setDepth(46).setResolution(3);

      // Sit / stand (E) — created once, not every frame
      try {
        this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      } catch (_) {
        this.keyE = null;
      }

      // Emote hotkeys so every sheet row is demo-able on the player
      // 1 jump · 2 wave · 3 shrug · 4 snicker · 5 eat · 6 hurt · F8 cycle all
      this._emoteCycle = 0;
      try {
        const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
        this.emoteKeys = {
          jump: this.input.keyboard.addKey(KeyCodes.ONE),
          wave: this.input.keyboard.addKey(KeyCodes.TWO),
          shrug: this.input.keyboard.addKey(KeyCodes.THREE),
          snicker: this.input.keyboard.addKey(KeyCodes.FOUR),
          eat: this.input.keyboard.addKey(KeyCodes.FIVE),
          hurt: this.input.keyboard.addKey(KeyCodes.SIX),
          cycle: this.input.keyboard.addKey(KeyCodes.F8),
          gallery: this.input.keyboard.addKey(KeyCodes.F9),
        };
      } catch (_) {
        this.emoteKeys = null;
      }

      const mw = this.mapWidth || W;
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

    /**
     * Group channels by their real Discord category, then build one
     * building (or outdoor zone) per category: voice-only categories get
     * the voice lounge, a category whose name matches a themed set-piece
     * (or an unmatched round-robin slot) gets that theme, and everything
     * else keeps the original plain per-channel office-park building.
     */
    async bootstrapLayout() {
      let data = { rooms: [], categories: [], guildName: 'Discord' };
      const tryUrls = [PRESENCE_URL];
      // Local fallback if proxy is 502 and the bot sidecar is actually up.
      if (/localhost|127\.0\.0\.1/.test(location.hostname)) {
        const local = new URL('http://127.0.0.1:5180/presence');
        try {
          const gid = new URL(PRESENCE_URL, location.origin).searchParams.get('guildId');
          if (gid) local.searchParams.set('guildId', gid);
        } catch (_) { /* ignore */ }
        tryUrls.push(local.toString());
      }
      // Retry a few times so a brief bot/proxy blip doesn't lock us on demo city.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        for (const url of tryUrls) {
          try {
            const res = await fetch(url, presenceFetchInit());
            if (res.ok) {
              data = await res.json();
              if (Array.isArray(data.rooms) && data.rooms.length) break;
            }
          } catch (_) { /* try next */ }
        }
        if (Array.isArray(data.rooms) && data.rooms.length) break;
        await new Promise((r) => setTimeout(r, 1200));
      }

      const rooms = (Array.isArray(data.rooms) ? data.rooms : [])
        .filter((r) => r.type !== 'category' && r.type !== 'other');
      const guildName = data.guildName || 'Discord';

      const titleEl = document.getElementById('map-title');
      if (titleEl && guildName) titleEl.textContent = guildName;

      let x = 20;
      this.buildings = [];
      this._themeRR = 0;

      if (!rooms.length) {
        // Offline demo layout so the map isn't a blank blue box — still
        // has street doors + rooms to walk into while presence is down.
        this._layoutFromDemo = true;
        this._layoutFp = '';
        this.drawDemoLayout(x, this.groundY, guildName);
        x += 620;
        this.mapWidth = Math.max(W, x + 340);
        this.drawGround();
        this.extendBackdrop();
        this.drawEndPark(this.mapWidth - 320);
        return { guildName, channelCount: 0, categoryCount: 0 };
      }
      this._layoutFromDemo = false;
      this._layoutFp = (data.rooms || [])
        .map((r) => `${r.id}:${r.name}:${r.type}:${r.categoryId || ''}:${JSON.stringify(r.map || {})}`)
        .sort()
        .join('|');
      // Per-guild room/category map overrides from `,room` bot commands.
      this.roomOverrides = {};
      this.categoryOverrides = {};
      const ro = data.roomOverrides && typeof data.roomOverrides === 'object' ? data.roomOverrides : {};
      const co = data.categoryOverrides && typeof data.categoryOverrides === 'object'
        ? data.categoryOverrides : {};
      Object.assign(this.roomOverrides, ro);
      Object.assign(this.categoryOverrides, co);
      for (const r of rooms) {
        if (r.map && typeof r.map === 'object') {
          this.roomOverrides[String(r.id)] = { ...(this.roomOverrides[String(r.id)] || {}), ...r.map };
        }
      }

      const categoriesMeta = new Map((data.categories || []).map((c) => [c.id, c]));
      const byCat = new Map();
      for (const r of rooms) {
        // An uncategorized voice channel (no Discord category) still gets its
        // own synthetic voice bucket, so a server without categories doesn't
        // lose the dedicated voice lounge to the mixed uncategorized bucket.
        const isVoice = r.type === 'voice' || r.type === 'stage';
        const cid = r.categoryId || (isVoice ? '__uncat_voice__' : '__uncat__');
        if (!byCat.has(cid)) byCat.set(cid, []);
        byCat.get(cid).push(r);
      }
      const catList = [];
      for (const [cid, chans] of byCat) {
        let meta;
        if (cid === '__uncat_voice__') meta = { id: cid, name: 'Voice', position: -2 };
        else if (cid === '__uncat__') meta = { id: cid, name: guildName, position: -1 };
        else meta = categoriesMeta.get(cid) || { id: cid, name: chans[0]?.categoryName || 'channels', position: 0 };
        catList.push({ ...meta, channels: chans });
      }
      catList.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      let plainIdx = 0;
      let sectionIdx = 0;
      const STREET_GAP = 58;
      const advanceStreet = (fromX, bw, seedTag) => {
        const gapStart = fromX + bw;
        this.placeStreetFiller(gapStart, STREET_GAP, hashSeed(seedTag + gapStart));
        return gapStart + STREET_GAP;
      };
      const paintSection = (left, bw) => {
        this.applySectionAtmos(left, bw, sectionIdx);
        sectionIdx += 1;
      };

      for (const cat of catList) {
        const voiceChans = cat.channels.filter((c) => c.type === 'voice' || c.type === 'stage');
        const decision = this.pickTheme(cat);
        const catLabel = this.categoryDisplayName(cat);

        if (decision.kind === 'voice') {
          if (!voiceChans.length) continue;
          const built = this.drawVoiceBuilding(x, this.groundY, voiceChans, catLabel);
          const bw = built?.bw || 290;
          this.buildings.push({ left: x, right: x + bw, kind: 'voice', channels: voiceChans, label: catLabel });
          paintSection(x, bw);
          x = advanceStreet(x, bw, `voice-${cat.id}`);
          continue;
        }

        if (decision.kind === 'zone') {
          if (decision.theme === 'winterzone') {
            this.drawWinterPark(x, this.groundY, { ...cat, name: catLabel });
            paintSection(x, 480);
            x = advanceStreet(x, 480, `winter-${cat.id}`);
          } else {
            this.drawDigSite(x, this.groundY, { ...cat, name: catLabel });
            paintSection(x, 640);
            x = advanceStreet(x, 640, `dig-${cat.id}`);
          }
          continue;
        }

        if (decision.kind === 'themed') {
          const MAX_ROOMS = 2;
          const total = cat.channels.length;
          for (let i = 0; i < total; i += MAX_ROOMS) {
            const chunk = cat.channels.slice(i, i + MAX_ROOMS);
            const suffix = total > MAX_ROOMS ? ` ${Math.floor(i / MAX_ROOMS) + 1}` : '';
            const b = this.buildGenericBuilding(decision.theme, x, `${catLabel}${suffix}`, chunk, i);
            this.buildings.push({ left: x, right: x + b.bw, kind: decision.theme, channels: chunk, label: catLabel });
            paintSection(x, b.bw);
            x = advanceStreet(x, b.bw, `theme-${cat.id}-${i}`);
          }
          continue;
        }

        // Plain: the original per-channel office-park building, chunked at 4.
        const perBuilding = 4;
        for (let i = 0; i < cat.channels.length; i += perBuilding) {
          const chunk = cat.channels.slice(i, i + perBuilding);
          const bw = 290;
          const suffix = cat.channels.length > perBuilding ? ` · pt ${Math.floor(i / perBuilding) + 1}` : '';
          const title = `${catLabel}${suffix}`;
          this.drawTextBuilding(x, this.groundY, title, chunk, plainIdx % 5);
          plainIdx += 1;
          this.buildings.push({ left: x, right: x + bw, kind: 'text', channels: chunk, label: title });
          paintSection(x, bw);
          x = advanceStreet(x, bw, `plain-${cat.id}-${i}`);
        }
      }

      this.mapWidth = Math.max(W, x + 340);
      this.drawGround();
        this.extendBackdrop();
      this.drawEndPark(this.mapWidth - 320);
      return {
        guildName,
        channelCount: rooms.length,
        categoryCount: catList.length,
      };
    }

    /**
     * Soft atmospheric wash per building stretch — sections read distinct along the block.
     */
    applySectionAtmos(left, bw, sectionIdx = 0) {
      const a = SECTION_ATMOS[sectionIdx % SECTION_ATMOS.length];
      if (!a) return;
      const top = Math.min(0, this._sceneMinY ?? 0) - 20;
      const h = (this.groundY || 318) - top + 24;
      const g = this.add.graphics().setDepth(12);
      g.fillStyle(a.fog, a.alpha);
      g.fillRect(left - 6, top, bw + 12, h);
    }

    /**
     * Street rhythm between buildings: background house/shop + bench + tree
     * so the block reads as a city strip, not empty cyan gaps.
     */
    placeStreetFiller(left, gapW, seed) {
      if (gapW < 36) return;
      const gy = this.groundY;
      const mid = left + gapW / 2;
      const houses = ['houseBeige', 'houseBlue', 'houseGreen', 'houseRed', 'housePurple', 'houseYellow', 'shopBlue', 'shopRed']
        .filter((k) => this.textures.exists(k));
      if (houses.length) {
        const hk = seededPick(seed, houses, 1);
        this.add.image(mid - 10, gy - 1, hk)
          .setScale(1.35 + (seed % 3) * 0.08)
          .setOrigin(0.5, 1)
          .setDepth(17)
          .setAlpha(0.92);
      }
      if (this.textures.exists('benchWood') && seed % 3 !== 0) {
        this.furn('benchWood', mid + 18, gy, 19);
      }
      if (this.textures.exists('tree') && seed % 2 === 0) {
        this.add.image(mid + (seed % 2 ? 28 : -28), gy - 1, 'tree')
          .setScale(1.5).setOrigin(0.5, 1).setDepth(16);
      }
      if (this.textures.exists('bush') && seed % 4 === 1) {
        this.add.image(mid - 22, gy - 1, 'bush').setScale(SCALE).setOrigin(0.5, 1).setDepth(16);
      }
      // Street furniture rhythm: lamppost / hydrant / rooftop billboard
      if (this.textures.exists('lampPostW') && seed % 3 === 1) {
        this.add.image(left + 10, gy - 1, 'lampPostW').setScale(SCALE).setOrigin(0.5, 1).setDepth(18);
      }
      if (this.textures.exists('fireHydrant') && seed % 5 === 2) {
        this.add.image(mid + 44, gy - 1, 'fireHydrant').setScale(SCALE).setOrigin(0.5, 1).setDepth(18);
      }
      const bbKeys = ['billboard1', 'billboard2', 'billboard3'].filter((k) => this.textures.exists(k));
      if (bbKeys.length && seed % 4 === 3) {
        // Billboard rides above the filler house like the pack's street scenes.
        this.add.image(mid - 10, gy - 64, seededPick(seed, bbKeys, 3))
          .setScale(SCALE).setOrigin(0.5, 1).setDepth(16).setAlpha(0.85);
      }
    }

    /** Decide a building theme (or special outdoor zone) for one category. */
    pickTheme(cat) {
      // Admin override from `,room theme` (category or any channel in it).
      const catOv = this.categoryOverrides?.[String(cat.id)] || null;
      let forceTheme = catOv?.theme || null;
      if (!forceTheme) {
        for (const ch of cat.channels || []) {
          const ro = this.roomOverrides?.[String(ch.id)];
          if (ro?.theme) { forceTheme = ro.theme; break; }
        }
      }
      if (forceTheme) {
        const t = String(forceTheme).toLowerCase();
        if (t === 'voice') return { kind: 'voice' };
        if (t === 'winterzone' || t === 'digzone') return { kind: 'zone', theme: t };
        if (t === 'plain') return { kind: 'plain' };
        if (THEME_KITS[t]) return { kind: 'themed', theme: t };
      }

      const name = String(cat.name || '').toLowerCase();
      const channels = cat.channels;
      const allVoice = channels.length > 0 && channels.every((c) => c.type === 'voice' || c.type === 'stage');
      if (allVoice || /voice|\bvc\b|\btalk\b/i.test(name)) return { kind: 'voice' };
      for (const [re, theme] of SPECIAL_ZONE_THEMES) {
        if (re.test(name)) return { kind: 'zone', theme };
      }
      for (const [re, theme] of KEYWORD_THEMES) {
        if (re.test(name)) return { kind: 'themed', theme };
      }
      const pick = THEME_ROTATION_POOL[this._themeRR % THEME_ROTATION_POOL.length];
      this._themeRR += 1;
      return pick === 'plain' ? { kind: 'plain' } : { kind: 'themed', theme: pick };
    }

    /** Display name for a category building (`,room title` override). */
    categoryDisplayName(cat) {
      const ov = this.categoryOverrides?.[String(cat?.id)];
      if (ov?.title) return String(ov.title);
      return cat?.name || 'channels';
    }

    /** Room plaque / channel label with optional `,room name` override. */
    roomDisplayLabel(ch) {
      const ov = this.roomOverrides?.[String(ch?.id)];
      if (ov?.label) return String(ov.label);
      return channelLabel(ch);
    }

    /**
     * Generic themed building: shell + stacked cutaway floors + doors, one
     * room per channel (cycling the theme's 2 recipes). Mirrors the shape of
     * drawVoiceBuilding/drawTextBuilding above but data-driven by THEME_KITS
     * instead of a single hand-authored layout.
     */
    drawThemeBuilding(cfg) {
      const g = this.add.graphics().setDepth(20);
      const left = cfg.left;
      const bw = cfg.bw || 290;
      const doorStrip = 54;
      const bandH = 8;
      const roomsH = cfg.rooms.reduce((s, r) => s + r.h, 0);
      const bh = 18 + roomsH + bandH * (cfg.rooms.length - 1) + doorStrip;
      const top = this.groundY - bh;
      this._sceneMinY = Math.min(this._sceneMinY ?? 0, top - 30);
      const padX = left + 16;
      const roomW = bw - 32;

      g.fillStyle(0x000000, 0.22);
      g.fillRect(left + 8, this.groundY - 6, bw, 10);

      g.fillStyle(cfg.wall, 1);
      g.fillRect(left, top, bw, bh);
      g.fillStyle(cfg.side, 1);
      g.fillRect(left + bw - 14, top, 14, bh);
      g.lineStyle(3, cfg.outline, 1);
      g.strokeRect(left, top, bw, bh);

      // Real roof sprites — gable / flat / snow by theme (see pickRoofSpec)
      const roofSpec = cfg.roofSpec || this.pickRoofSpec({
        theme: cfg.theme || cfg.title?.text || '',
        roofKey: cfg.roofKey,
      }, left);
      this.drawRoofCap(left, top, bw, roofSpec);
      cfg._roofStyle = roofSpec.style || 'gable';

      // Dirt foundation slice under the building (grammar #2) — the store
      // reference shows an underground band with roots below every room
      // stack; grounds the facade so it doesn't float on the sidewalk.
      this.drawFoundation(g, left, bw);

      if (cfg.signKey) {
        this.add.image(left + bw / 2, top - 14, cfg.signKey)
          .setScale(cfg.signScale || SCALE).setOrigin(0.5, 1).setDepth(28);
      }
      if (cfg.title) {
        this.buildingTitle(left + bw / 2, top - (cfg.signKey ? 0 : 26), shortLabel(displayChannelName(cfg.title.text), 22), {
          color: cfg.title.color, bg: cfg.title.bg,
        });
      }

      const floorDefs = [];
      let y = top + 12;
      cfg.rooms.forEach((room, idx) => {
        const y0 = y;
        this.cutawayRoom(g, padX, y0, roomW, room.h, room.fill, () => {
          const floorY = y0 + room.h - 2;
          this.placeRoomItems(room, padX, y0, floorY, roomW);
          if (room.slots) {
            this.addRoomSlots(room.roomKey, room.slots.map((dx) => [padX + dx, floorY - 1]));
          }
        });
        this.roomPlaque(padX + 4, y0 + 4, plaqueChannelLabel(room.label), room.roomKey, cfg.plaqueKey, {
          maxW: roomW ? roomW - 12 : 170,
          fullLabel: room.label,
        });
        floorDefs.push({
          id: room.id,
          roomKey: room.roomKey,
          floorY: y0 + room.h - 3,
          minX: padX + 8,
          maxX: padX + roomW - 8,
          label: room.label,
        });
        y += room.h;
        if (idx < cfg.rooms.length - 1) {
          g.fillStyle(cfg.band, 1);
          g.fillRect(left + 2, y + 1, bw - 4, 5);
          y += bandH;
        }
      });

      floorDefs.forEach((f) => this.registerFloor(f));

      const lowest = floorDefs[floorDefs.length - 1];
      const doorX = left + 42;
      const doorX2 = streetDoorRightX(left, bw);
      const doorKind = cfg.doorKind || cfg.doorFamily || cfg.theme || 'wood';
      this.placeEntrance(g, doorX, this.groundY, doorKind, cfg.side, 26);
      this.placeEntrance(g, doorX2, this.groundY, cfg.doorKind2 || doorKind, cfg.side, 26);
      this.registerDoor({ x: doorX, floorId: lowest.id, radius: 18 });
      this.registerDoor({ x: doorX2, floorId: lowest.id, radius: 18 });

      // Storefront: lit windows flanking the centered prompt so the ground
      // band reads as a lobby instead of dead shell.
      const winY = this.groundY - doorStrip + 12;
      [left + bw * 0.3, left + bw * 0.7].forEach((wx) => {
        if (!this.textures.exists('windowSq')) return;
        g.fillStyle(0xfff3c0, 0.25);
        g.fillRect(wx - 11, winY - 1, 22, 20);
        this.add.image(wx, winY, 'windowSq').setOrigin(0.5, 0).setDepth(25).setScale(SCALE);
      });

      for (let i = floorDefs.length - 1; i > 0; i -= 1) {
        // Prefer theme stairsDx; fall back to left climb lane (not room center).
        // Compact climb DOORS — mounted on the left wall of the cutaway.
        const prefer = cfg.stairsDx != null
          ? padX + cfg.stairsDx
          : padX + Math.max(22, roomW * 0.18);
        const doorKind = cfg.doorKind || cfg.doorFamily || cfg.theme || 'wood';
        const climbMode = cfg.climbMode || 'door';
        const sx = this.markClimbDoor(prefer, floorDefs[i].id, doorKind, climbMode) || prefer;
        this.markClimbDoor(prefer, floorDefs[i - 1].id, doorKind, climbMode);
        this.registerStairs({
          x: sx, fromFloorId: floorDefs[i].id, toFloorId: floorDefs[i - 1].id, radius: 32,
        });
      }
      // Walkable rooftop — climb door up from the top floor.
      if (floorDefs.length) {
        const topFloor = floorDefs[0];
        const roofId = `roof_theme_${left}`;
        const roofY = top + 8;
        const prefer = cfg.stairsDx != null
          ? padX + cfg.stairsDx
          : padX + Math.max(22, roomW * 0.18);
        const roofMin = padX + 12;
        const roofMax = padX + roomW - 12;
        this.registerFloor({
          id: roofId,
          roomKey: roofId,
          floorY: roofY,
          minX: roofMin,
          maxX: roofMax,
          label: 'Rooftop',
          isRoof: true,
        });
        this.markRooftopDeck(roofMin, roofMax, roofY);
        // Single-floor buildings need a climb door on the only room; multi-floor
        // already got one in the loop above — only add the roof-side door.
        const doorKind = cfg.doorKind || cfg.doorFamily || cfg.theme || 'wood';
        const climbMode = cfg.climbMode || 'door';
        let sx = prefer;
        if (floorDefs.length === 1) sx = this.markClimbDoor(prefer, topFloor.id, doorKind, climbMode) || prefer;
        this.markClimbDoor(prefer, roofId, doorKind, climbMode);
        this.registerStairs({
          x: sx,
          fromFloorId: topFloor.id,
          toFloorId: roofId,
          radius: 36,
        });
        this.decorateRooftop(roofMin, roofMax, roofY, cfg._roofStyle || 'gable', left);
        this._sceneMinY = Math.min(this._sceneMinY ?? 0, roofY - 100);
      }

      if (cfg.strip) {
        this.stripLabel(left + bw / 2, this.groundY - doorStrip + 6, shortLabel(cfg.strip.text, 26), {
          color: cfg.strip.color, bg: cfg.strip.bg,
        });
      }

      return { left, bw, top, bh, padX, roomW, floorDefs };
    }

    /**
     * Room item placement for THEME_KITS recipes.
     * ['f', key, dx, scale?, dy?]        floor object, bottom-anchored
     * ['w', key, dx, dyFromTop, scale?]  wall/hanging object, top-anchored
     * ['npc', seedStr, dx]               idle decor NPC (full-body cast, seeded)
     * ['glow', color, alpha]             breathing room glow
     * `key` may be an ARRAY of asset keys — a variant is picked by the room's
     * channel-id seed, so a given room always renders the same variant across
     * reloads while sibling rooms of the same theme look different.
     */
    placeRoomItems(room, x0, y0, floorY, roomW) {
      const seed = hashSeed(room.roomKey || room.id || '');
      const floorId = room.roomKey || room.id || null;
      const pick = (key, idx) => (Array.isArray(key) ? seededPick(seed, key, idx * 13 + 5) : key);
      // Climb-door lane — skip floor items that land inside it. Fallback
      // matches markClimbDoor's prefer x so the band is centered on the
      // actual door; clearR = ajar leaf halfW + frame + breathing room.
      const clearX = x0 + (room.stairsDx != null ? room.stairsDx : Math.max(22, roomW * 0.18));
      const clearR = (13 * SCALE) / 2 + 22;
      const placed = []; // { x, halfW }
      const hosts = []; // surface hosts for dy props

      const halfW = (key, sc) => {
        try {
          if (!this.textures.exists(key)) return 14;
          const fr = this.textures.get(key).get();
          return Math.max(8, (fr.width * sc) / 2);
        } catch (_) {
          return 14;
        }
      };
      const collides = (x, hw) => placed.some((p) => Math.abs(p.x - x) < p.halfW + hw + 6);

      // Pass 1: floor-standing props (no dy lift) with footprint spacing
      (room.items || []).forEach((it, idx) => {
        if (it[0] !== 'f') return;
        const [, key, dx, scRaw, dy] = it;
        if (dy > 0) return; // surface props in pass 2
        const k = pick(key, idx);
        const sc = (scRaw || 1) * SCALE;
        let x = x0 + dx;
        const hw = halfW(k, sc);
        // Inside the climb lane → NUDGE right of it, never silently drop.
        // (Dropping deleted every recipe's left-anchor piece — coffins,
        // bookshelves, lockers, filecabinets — for years of recipes whose
        // dx sat within clearR+hw of the lane.)
        if (Math.abs(x - clearX) < clearR + hw) {
          x = clearX + clearR + hw;
        }
        if (x < x0 + 10 + hw || x > x0 + roomW - 10 - hw) return;
        // Nudge right then left to clear overlaps
        let placedOk = false;
        for (let t = 0; t < 8; t += 1) {
          if (!collides(x, hw) && Math.abs(x - clearX) >= clearR + hw) {
            placedOk = true;
            break;
          }
          x += hw + 8;
          if (x > x0 + roomW - 12 - hw) x = (x0 + dx) - (t + 1) * (hw + 8);
        }
        if (!placedOk || collides(x, hw)) return;
        if (x < x0 + 10 + hw || x > x0 + roomW - 10 - hw) return;
        this.furn(k, x, floorY, 23, sc, floorId);
        placed.push({ x, halfW: hw });
        if (SURFACE_HOSTS[k] != null) hosts.push({ x, key: k, surfaceH: SURFACE_HOSTS[k] });
      });

      // Pass 2: lifted props — sit on a desk/table host, or stack on a floor
      // prop at the same x (bunk top). Never float with no support.
      (room.items || []).forEach((it, idx) => {
        if (it[0] !== 'f') return;
        const [, key, dx, scRaw, dy] = it;
        if (!(dy > 0)) return;
        const k = pick(key, idx);
        const sc = (scRaw || 1) * SCALE;
        const preferX = x0 + dx;
        const host = hosts.find((h) => Math.abs(h.x - preferX) < 28)
          || hosts.find((h) => Math.abs(h.x - preferX) < 40);
        if (host) {
          this.furn(k, host.x, floorY - (host.surfaceH || dy), 24, sc, floorId);
          return;
        }
        // Stacked furniture (e.g. bunk top on bunk bottom)
        const base = placed.find((p) => Math.abs(p.x - preferX) < 24);
        if (!base) return;
        this.furn(k, base.x, floorY - dy, 24, sc, floorId);
      });

      // Wall decor occupancy — the room plaque tab (x0 + 4, depth 27) owns
      // the top-left band; skip — never stack — 'w' items that would overlap
      // it or a previously placed wall item. Plaque width is estimated (the
      // plaque is drawn after this runs).
      const plaqueW = Math.min(roomW - 12, 112);
      const placedWall = [{ x: x0 + 4 + plaqueW / 2, halfW: plaqueW / 2 }];
      const wallFree = (x, hw) => !placedWall.some((p) => Math.abs(p.x - x) < p.halfW + hw + 6);

      (room.items || []).forEach((it, idx) => {
        const kind = it[0];
        if (kind === 'w') {
          const [, key, dx, dyTop, sc] = it;
          const k = pick(key, idx);
          const wsc = (sc || 1) * SCALE;
          const hw = halfW(k, wsc);
          if (!wallFree(x0 + dx, hw)) return; // skip rather than stack
          this.wallDecor(k, x0 + dx, y0 + dyTop, 22, wsc);
          placedWall.push({ x: x0 + dx, halfW: hw });
        } else if (kind === 'npc') {
          const [, key, dx, opts] = it;
          const x = x0 + dx;
          if (Math.abs(x - clearX) < clearR) return;
          const roleOpts = opts && typeof opts === 'object' ? { ...opts } : null;
          if (roleOpts?.bedDx != null) roleOpts.bedWorldX = x0 + roleOpts.bedDx;
          if (roleOpts?.attendDx != null) roleOpts.attendWorldX = x0 + roleOpts.attendDx;
          this.decorNpcQueue.push([key, x, floorY, floorId, roleOpts]);
        } else if (kind === 'glow') {
          const [, color, alpha] = it;
          const glow = this.add.rectangle(x0 + roomW / 2, y0 + room.h / 2, roomW - 16, room.h - 12, color, alpha).setDepth(21);
          this.tweens.add({ targets: glow, alpha: alpha + 0.08, duration: 1700, yoyo: true, repeat: -1 });
        }
      });

      // Pixel Platter food on every table/counter host (theme rooms).
      hosts.forEach((h, i) => {
        if (!FOOD_HOST_KEYS.has(h.key)) return;
        const fk = seededPick(seed, FOOD_KEYS, i * 11 + 3);
        this.placeFood(fk, h.x + ((i % 2) ? 4 : -4), floorY - h.surfaceH, 25, FOOD_SCALE, floorId);
        // Second snack on wider counters/tables
        if (h.key === 'tableLong' || h.key === 'counter' || h.key === 'counterEnd') {
          const fk2 = seededPick(seed, FOOD_KEYS, i * 11 + 9);
          this.placeFood(fk2, h.x + 8, floorY - h.surfaceH, 25, FOOD_SCALE, floorId);
        }
      });
    }

    /** Build one themed building for `channels` (already chunked to <= 2).
     *  recipeOffset carries the category-wide channel index so the recipe
     *  rotation continues across chunked buildings — without it every chunk
     *  restarted at recipe 0 and recipes past index 1 never rendered. */
    buildGenericBuilding(theme, left, categoryLabel, channels, recipeOffset = 0) {
      const kit = THEME_KITS[theme];
      const rooms = channels.map((ch, i) => {
        const recipe = kit.recipes[(recipeOffset + i) % kit.recipes.length]();
        const ov = this.roomOverrides?.[String(ch.id)];
        let fill = recipe.fill;
        if (ov?.color) {
          const raw = String(ov.color).trim().toLowerCase().replace(/^#/, '');
          if (ROOM_COLOR_BY_NAME[raw] != null) fill = ROOM_COLOR_BY_NAME[raw];
          else if (/^[0-9a-f]{6}$/i.test(raw)) fill = parseInt(raw, 16);
        }
        return {
          id: chKey(ch.id),
          roomKey: chKey(ch.id),
          label: this.roomDisplayLabel(ch),
          h: recipe.h,
          fill,
          slots: recipe.slots,
          items: recipe.items,
          bars: recipe.bars,
          stairsDx: kit.stairsDx,
        };
      });
      if (theme === 'hospital') {
        if (!this.hospitalRoomKeys) this.hospitalRoomKeys = new Set();
        channels.forEach((ch) => this.hospitalRoomKeys.add(chKey(ch.id)));
      }
      const stripText = theme === 'hospital'
        ? `${shortLabel(displayChannelName(categoryLabel), 18)} · Hospital`
        : shortLabel(displayChannelName(categoryLabel), 28);
      const b = this.drawThemeBuilding({
        left,
        bw: kit.bw,
        wall: kit.wall, side: kit.side, outline: kit.outline, roof: kit.roof, band: kit.band,
        signKey: kit.signKey, signScale: kit.signScale,
        title: kit.signKey ? undefined : { text: categoryLabel, color: kit.title?.color, bg: kit.title?.bg },
        strip: { text: stripText, color: kit.stripStyle.color, bg: kit.stripStyle.bg },
        doorKind: kit.doorFamily || kit.doorKind || theme || 'wood',
        climbMode: kit.climbMode || 'door',
        stairsDx: kit.stairsDx,
        roofKey: kit.roofKey,
        theme, // drives gable vs flat vs snow in pickRoofSpec
        rooms,
      });

      // Holding-cell bars wall the RIGHT end of the room (dx 178-234) so the
      // prisoner bench at 205 sits behind them — the left strip is the
      // shared elevator lane and must stay clear.
      const barsRoomIdx = rooms.findIndex((r) => r.bars);
      if (barsRoomIdx !== -1) {
        const cellsTop = b.top + 12;
        for (let i = 0; i < 9; i += 1) {
          this.add.image(b.padX + 178 + i * 7, cellsTop + rooms[barsRoomIdx].h - 2, 'prisonDoor')
            .setScale(SCALE).setOrigin(0.5, 1).setDepth(24);
        }
      }

      if (typeof kit.outside === 'function') kit.outside(this, b.left, b.bw, this.groundY);
      return b;
    }

    /** Outdoor winter park — no building shell, an open themed zone. */
    /**
     * End-of-block pocket park — an outdoor hangout that closes the street
     * (replaces the old giant scaled tree that read as a green box).
     */
    drawEndPark(left) {
      const gy = this.groundY;
      const g = this.add.graphics().setDepth(9);
      g.fillStyle(0x9ad17c, 0.35);
      g.fillEllipse(left + 150, gy - 2, 320, 16);

      this.add.image(left + 18, gy - 1, 'tree').setScale(1.6).setOrigin(0.5, 1).setDepth(18);
      this.add.image(left + 286, gy - 1, 'tree').setScale(1.4).setOrigin(0.5, 1).setDepth(18);
      if (this.textures.exists('bush')) {
        this.add.image(left + 52, gy - 1, 'bush').setScale(SCALE).setOrigin(0.5, 1).setDepth(17);
        this.add.image(left + 254, gy - 1, 'bush').setScale(SCALE).setOrigin(0.5, 1).setDepth(17);
      }
      if (this.textures.exists('lampPostW')) this.furn('lampPostW', left + 76, gy, 18);

      // Picnic cluster: umbrella over a snack table, sittable benches both sides
      if (this.textures.exists('umbrellaRed')) {
        this.add.image(left + 150, gy - 1, 'umbrellaRed').setScale(SCALE).setOrigin(0.5, 1).setDepth(19);
      }
      this.furn('table', left + 150, gy, 20);
      this.placeFood('foodBurger', left + 143, gy - 26, 25, FOOD_SCALE, null);
      this.placeFood('foodSoda', left + 158, gy - 26, 25, FOOD_SCALE, null);
      this.furn('benchWood', left + 104, gy, 20);
      this.furn('benchWood', left + 196, gy, 20);

      this.stripLabel(left + 150, gy - 74, '🌳 Block Park · outdoor hangout', {
        color: '#14301a', bg: '#e2f4d8',
      });
    }

    drawWinterPark(left, groundY, cat) {
      const g = this.add.graphics().setDepth(9);
      g.fillStyle(0xf0f6fc, 0.9);
      g.fillEllipse(left + 220, groundY - 2, 500, 18);

      this.furn('lampPostW', left - 10, groundY, 19);
      this.furn('xmasTree', left + 60, groundY, 20);
      this.furn('presentRedL', left + 92, groundY, 21);
      this.furn('presentGreenL', left + 108, groundY, 21);
      this.furn('presentBlueS', left + 122, groundY, 21);
      this.furn('presentWhiteL', left + 76, groundY, 21);
      this.furn('presentGreenS', left + 134, groundY, 21);
      this.furn('snowGlobe', left + 442, groundY, 21);
      this.furn('candyCaneSmall', left + 130, groundY, 20);
      this.furn('snowman1', left + 160, groundY, 20);
      this.furn('snowman2', left + 200, groundY, 20);
      this.furn('snowman3', left + 240, groundY, 20);
      this.furn('snowfort', left + 285, groundY, 20);
      this.furn('snowballs', left + 305, groundY, 21);
      this.furn('santaSleigh', left + 360, groundY, 20);
      this.furn('candyStatueR', left + 25, groundY, 20);
      this.furn('candyStatueG', left + 420, groundY, 20);
      this.furn('candyCaneL', left + 330, groundY, 20);
      this.furn('sled', left + 395, groundY, 21);
      this.furn('treeWinterSnow', left + 460, groundY, 18);
      this.furn('treeWinterMed', left - 40, groundY, 18);

      this.decorNpcQueue.push(['winter-santa', left + 345, groundY]);
      this.decorNpcQueue.push(['winter-sweater', left + 180, groundY]);

      const points = [
        [left + 140, groundY - 1], [left + 220, groundY - 1],
        [left + 260, groundY - 1], [left + 310, groundY - 1],
      ];
      cat.channels.forEach((ch) => this.addRoomSlots(chKey(ch.id), points));
      this.stripLabel(left + 220, groundY - 74, `⛄ ${shortLabel(cat.name, 22)} · outdoor hangout`, {
        color: '#1a2a3a', bg: '#e8f4ff',
      });

      for (let i = 0; i < 40; i += 1) {
        const fx = left - 40 + Math.random() * 540;
        const fy = 40 + Math.random() * 240;
        const flake = this.add.circle(fx, fy, 1 + Math.random(), 0xffffff, 0.8).setDepth(30);
        this.tweens.add({
          targets: flake, y: groundY - 4, x: fx + (Math.random() * 40 - 20),
          duration: 5000 + Math.random() * 6000, repeat: -1, delay: Math.random() * 4000,
          onRepeat: () => flake.setY(30 + Math.random() * 60),
        });
      }
    }

    /** Outdoor archaeology dig — open zone, no building shell. */
    drawDigSite(left, groundY, cat) {
      const g = this.add.graphics().setDepth(9);
      g.fillStyle(0xc8a878, 0.9);
      g.fillEllipse(left + 220, groundY - 2, 520, 18);
      g.fillStyle(0x8a6a44, 1);
      g.fillRect(left + 130, groundY - 4, 180, 14);
      g.lineStyle(2, 0x5a4428, 1);
      g.strokeRect(left + 130, groundY - 4, 180, 14);

      this.furn('signWood', left - 20, groundY, 19);
      this.furn('tentDig', left + 50, groundY, 18);
      this.furn('dirtPile', left + 120, groundY, 20);
      this.add.image(left + 220, groundY + 8, 'dinoWhole').setScale(SCALE).setOrigin(0.5, 1).setDepth(21);
      this.furn('flagRed', left + 150, groundY, 21);
      this.furn('flagBlue', left + 290, groundY, 21);
      this.furn('pickaxe', left + 175, groundY, 21);
      this.furn('shovelDig', left + 265, groundY, 21);
      this.furn('bucketDig', left + 320, groundY, 20);
      this.furn('dirtPile', left + 340, groundY, 20);
      this.furn('swordBuried', left + 380, groundY, 20);
      this.furn('totalStation', left + 410, groundY, 20);
      this.furn('itemDisplayM', left + 455, groundY, 20);
      this.furn('fossilFish', left + 455, groundY - 15, 21);
      this.furn('stoneTablet', left + 485, groundY, 20);
      this.furn('potteryAncient', left + 505, groundY, 20);
      this.furn('pottery2', left + 516, groundY, 20);
      this.furn('pottery4', left + 527, groundY, 20);
      this.furn('itemDisplayS', left + 550, groundY, 20);
      this.furn('crownDig', left + 550, groundY - 13, 21);
      this.furn('neolithicMask', left + 575, groundY, 20);
      this.furn('megalodonTooth', left + 594, groundY, 20);
      this.furn('backpackDig', left + 70, groundY, 20);
      this.furn('rockMed', left + 530, groundY, 19);
      this.furn('rockSm', left + 100, groundY, 19);

      this.decorNpcQueue.push(['dig-archaeologist-m', left + 195, groundY]);
      this.decorNpcQueue.push(['dig-archaeologist-f', left + 305, groundY]);

      const points = [
        [left + 160, groundY - 1], [left + 240, groundY - 1],
        [left + 280, groundY - 1], [left + 350, groundY - 1],
      ];
      cat.channels.forEach((ch) => this.addRoomSlots(chKey(ch.id), points));
      this.stripLabel(left + 240, groundY - 74, `⛏️ ${shortLabel(cat.name, 22)} · outdoor hangout`, {
        color: '#3a2e1c', bg: '#f0e4c8',
      });
    }

    /**
     * Spawn every queued themed-room "staff member". Hospital recipes carry
     * role opts so nurses stand at bedside and patients lie in beds — they
     * must not all grab the nearest mattress via staySeated.
     */
    flushDecorNpcQueue() {
      const spawned = [];
      for (const entry of this.decorNpcQueue) {
        const [seed, x, floorY, roomKey, opts] = entry;
        // Real pack ghosts for halloween-ghost seeds — not a reskinned human.
        const isGhost = /^halloween-ghost/.test(String(seed));
        const sheet = isGhost
          ? seededPick(hashSeed(String(seed)), GHOST_NPC_KEYS, 1)
          : this.npcSheetFor(seed);
        const sp = this.spawnChar(x, floorY, sheet, `${sheet}_idle`, null, 31, {
          roomKey: roomKey || null,
          mode: 'life',
        });
        const actor = (this.ambientActors || []).find((a) => a.sprite === sp);
        if (actor) {
          actor.role = opts?.role || null;
          actor.hospOpts = opts || null;
          actor.seedKey = seed;
          if (isGhost) {
            actor.isGhostNpc = true;
            actor.bobPhase = (hashSeed(String(seed)) % 628) / 100;
            actor.staySeated = false;
            sp.setAlpha(0.82);
          }
          if (actor.role === 'patient') actor.staySeated = true;
          if (actor.role === 'nurse' || actor.role === 'surgeon') {
            actor.staySeated = false;
            actor.mode = 'life';
          }
          spawned.push(actor);
        }
      }
      this.decorNpcQueue = [];
      // One shared bob loop keeps every ambient ghost hovering (a tween on
      // the sprite would be killed by wander movement).
      if (spawned.some((a) => a.isGhostNpc) && !this._ghostBobTimer) {
        this._ghostBobTimer = this.time.addEvent({
          delay: 90,
          loop: true,
          callback: () => {
            const t = this.time.now / 260;
            for (const a of this.ambientActors || []) {
              if (!a.isGhostNpc || !a.sprite?.active) continue;
              a.sprite.displayOriginY = a.sprite.height * NPC_FOOT_ORIGIN_Y
                + 1.5 + Math.sin(t + (a.bobPhase || 0)) * 2.5;
            }
          },
        });
      }

      this.time.delayedCall(220, () => {
        for (const actor of spawned) {
          if (!actor?.sprite?.active) continue;
          const role = actor.role;
          if (role === 'patient') {
            const onSurgery = !!(actor.hospOpts?.onSurgery || actor.hospOpts?.bedKey === 'tableSurgery');
            const bed = this.findHospitalBedNear(
              actor.roomKey,
              actor.hospOpts?.bedWorldX ?? actor.sprite.x,
              {
                allowSurgery: onSurgery,
                preferKey: onSurgery ? 'tableSurgery' : 'bedHosp',
              },
            );
            if (bed && !bed.claimedBy) {
              bed.claimedBy = 'ambient';
              bed.ambientPatient = actor;
              actor.staySeated = true;
              this.actorSitOn(actor, bed);
            } else {
              actor.mode = 'idle';
              actor.busyUntil = Number.MAX_SAFE_INTEGER / 4;
            }
            continue;
          }
          if (role === 'nurse' || role === 'surgeon') {
            this.parkHospitalStaff(actor);
            continue;
          }
          // Legacy themed staff (cafe etc.): seat on nearest non-bed furniture
          actor.staySeated = true;
          const candidates = (this.seats || []).filter((s) => {
            if (s.kind === 'bed') return false;
            const yOk = Math.abs((s.floorY || 0) - (actor.floorY || 0)) <= 14;
            const idOk = !s.floorId || s.floorId === actor.roomKey;
            return yOk && idOk && !s.claimedBy;
          }).sort((a, b) => Math.abs(a.x - actor.sprite.x) - Math.abs(b.x - actor.sprite.x));
          const seat = candidates[0];
          if (seat) this.actorSitOn(actor, seat);
          else {
            actor.mode = 'idle';
            actor.busyUntil = Number.MAX_SAFE_INTEGER / 4;
          }
        }
      });
    }

    /** Hospital beds in a room. Patients use bedHosp; OR patients use tableSurgery. */
    findHospitalBedNear(roomKey, worldX, opts = {}) {
      const allowSurgery = opts.allowSurgery !== false;
      const preferKey = opts.preferKey || null;
      let beds = (this.seats || []).filter((s) => (
        s.kind === 'bed'
        && (s.key === 'bedHosp' || (allowSurgery && s.key === 'tableSurgery'))
        && (!roomKey || !s.floorId || s.floorId === roomKey)
      ));
      if (preferKey) {
        const preferred = beds.filter((s) => s.key === preferKey);
        if (preferred.length) beds = preferred;
      }
      if (!beds.length) return null;
      if (worldX == null) return beds.find((b) => !b.claimedBy) || beds[0];
      return beds.slice().sort((a, b) => Math.abs(a.x - worldX) - Math.abs(b.x - worldX))[0];
    }

    findEmptyHospitalBed(roomKey) {
      return (this.seats || []).find((s) => (
        s.kind === 'bed'
        && s.key === 'bedHosp'
        && (!roomKey || !s.floorId || s.floorId === roomKey)
        && !s.claimedBy
      )) || null;
    }

    /** Prefer free bedHosp; otherwise displace an ambient patient. */
    findClaimableHospitalBed(roomKey) {
      const beds = (this.seats || []).filter((s) => (
        s.kind === 'bed'
        && s.key === 'bedHosp'
        && (!roomKey || !s.floorId || s.floorId === roomKey)
      ));
      const empty = beds.find((s) => !s.claimedBy);
      if (empty) return empty;
      return beds.find((s) => s.claimedBy === 'ambient') || null;
    }

    /** Stand nurse/surgeon beside bed or surgery table; never lie on it. */
    parkHospitalStaff(actor) {
      if (!actor?.sprite?.active) return;
      const opts = actor.hospOpts || {};
      const side = opts.side === 'right' ? 1 : -1;

      // Desk / charting nurses stand by the computer — not a bedside post.
      if (opts.station === 'desk') {
        const standX = opts.attendWorldX != null ? opts.attendWorldX : actor.sprite.x;
        actor.sprite.x = standX;
        actor.sprite.y = actor.floorY;
        actor.homeX = standX;
        actor.attendBed = null;
        actor.sprite.setFlipX(side > 0);
        this.playSheetPose(actor.sprite, actor.sheet, 'idle');
        actor.state = 'idle';
        actor.busyUntil = this.time.now + 4000 + Math.random() * 3000;
        return;
      }

      const targetX = opts.attendWorldX != null ? opts.attendWorldX : actor.sprite.x;
      const bed = this.findHospitalBedNear(actor.roomKey, targetX, {
        allowSurgery: true,
        preferKey: opts.onSurgery || opts.bedKey === 'tableSurgery' ? 'tableSurgery' : null,
      });
      // Auto-space attendants along each side of the bed so they never stack
      // on top of each other (each NPC ~32px wide at SCALE 2). The slot is
      // assigned once per actor+bed and reused across re-parks so the OR cast
      // keeps stable, legible positions instead of piling on the same spot.
      let offset;
      if (bed) {
        bed._sideSlots = bed._sideSlots || { '-1': 0, '1': 0 };
        if (actor._bedSlot == null || actor._bedSlotBed !== bed) {
          actor._bedSlot = bed._sideSlots[side];
          actor._bedSlotBed = bed;
          bed._sideSlots[side] += 1;
        }
        offset = 26 + actor._bedSlot * 36; // 36px apart → clear of the sprite
      } else {
        offset = opts.standOffset != null
          ? opts.standOffset
          : (actor.role === 'surgeon' ? 28 : 22);
      }
      const standX = (bed ? bed.x : targetX) + side * offset;
      actor.sprite.x = standX;
      actor.sprite.y = actor.floorY;
      actor.homeX = standX;
      actor.attendBed = bed || null;
      actor.sprite.setFlipX(side > 0); // face toward the bed/table
      this.playSheetPose(actor.sprite, actor.sheet, 'idle');
      actor.state = 'idle';
      const busyBase = (opts.onSurgery || bed?.key === 'tableSurgery') ? 2200 : 4000;
      actor.busyUntil = this.time.now + busyBase + Math.random() * 2800;
    }

    displaceAmbientPatient(bed) {
      if (!bed) return;
      const actor = bed.ambientPatient
        || (this.ambientActors || []).find((a) => a.role === 'patient' && a.seat === bed);
      if (!actor?.sprite) return;
      try { this.tweens.killTweensOf(actor.sprite); } catch (_) { /* ignore */ }
      actor.sprite.setVisible(false);
      actor.seated = false;
      actor.seat = null;
      actor._displaced = true;
      bed.ambientPatient = actor;
    }

    restoreAmbientPatient(bed) {
      if (!bed) return;
      const actor = bed.ambientPatient;
      bed.claimedBy = null;
      if (!actor?.sprite) {
        bed.ambientPatient = null;
        return;
      }
      actor.sprite.setVisible(true);
      actor._displaced = false;
      actor.staySeated = true;
      bed.claimedBy = 'ambient';
      this.actorSitOn(actor, bed);
    }

    /**
     * Put a live Discord member in an empty hospital bed (lieIdle).
     * Returns the seat or null if none free.
     */
    assignLiveHospitalPatient(live, person) {
      if (!live?.sprite || !person?.roomKey) return null;
      if (!this.hospitalRoomKeys?.has(person.roomKey)) return null;
      if (live.hospitalBed && String(live.hospitalBed.claimedBy) === String(person.userId)) {
        return live.hospitalBed;
      }
      const bed = this.findClaimableHospitalBed(person.roomKey);
      if (!bed) return null;
      this.displaceAmbientPatient(bed);
      bed.claimedBy = person.userId;
      live.userId = person.userId;
      live.hospitalBed = bed;
      try { this.tweens.killTweensOf(live.sprite); } catch (_) { /* ignore */ }
      if (live.tag) {
        try { this.tweens.killTweensOf(live.tag); } catch (_) { /* ignore */ }
      }
      if (live.actor) {
        live.actor.role = 'patient';
        live.actor.staySeated = true;
        live.actor.hospitalLive = true;
        this.actorSitOn(live.actor, bed);
      } else {
        live.sprite.x = bed.x;
        live.sprite.y = seatContactY(bed);
        this.playSheetPose(live.sprite, live.sheet, 'lieIdle');
      }
      if (live.tag) {
        live.tag.x = bed.x;
        live.tag.y = bed.floorY - 36;
      }
      return bed;
    }

    releaseLiveHospitalBed(live) {
      const bed = live?.hospitalBed;
      if (!bed) return;
      if (bed.claimedBy === live?.userId || String(bed.claimedBy) === String(live?.userId)) {
        this.restoreAmbientPatient(bed);
      }
      live.hospitalBed = null;
      if (live.actor) {
        live.actor.staySeated = false;
        live.actor.hospitalLive = false;
        if (live.actor.role === 'patient') live.actor.role = null;
      }
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
        .setScrollFactor(0.15, 1)
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
      this.placeSkyTraffic();
    }

    /** Blimps + hot-air balloons drifting slowly across the parallax skyline. */
    placeSkyTraffic() {
      const fleet = [
        'blimpBlue', 'blimpRed', 'blimpGreen', 'blimpPurple', 'blimpYellow',
        'balloonBlue', 'balloonGreen', 'balloonPurple', 'balloonRed', 'balloonYellow',
      ].filter((k) => this.textures.exists(k));
      if (!fleet.length) return;
      const seed = hashSeed('sky-traffic');
      const count = 3;
      for (let i = 0; i < count; i += 1) {
        const key = seededPick(seed, fleet, i * 5 + 1);
        const isBalloon = key.startsWith('balloon');
        const y = 26 + ((seed >> (i + 2)) % 40) + (isBalloon ? 28 : 0);
        const startX = -90 - i * 300;
        const img = this.add.image(startX, y, key)
          .setScale(isBalloon ? 1.6 : 2)
          .setDepth(-122)
          .setAlpha(0.95)
          .setScrollFactor(0.16);
        this.tweens.add({
          targets: img,
          x: 1150,
          duration: 95000 + i * 30000,
          repeat: -1,
          delay: i * 14000,
          onRepeat: () => { img.x = startX; },
        });
        if (isBalloon) {
          this.tweens.add({
            targets: img, y: y + 10, duration: 3800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
        }
      }
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
          .setScrollFactor(0.28, 1);
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
          .setTint(0xaebccf)
          .setAlpha(0.58 + (i % 3) * 0.03)
          .setDepth(-90 - (i % 2))
          .setScrollFactor(0.4, 1);
      });

      // Soft rolling hills peek between buildings (fills empty cyan bands)
      const hills = this.add.graphics().setDepth(-84).setScrollFactor(0.52, 1);
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
      const g = this.add.graphics().setDepth(-95).setScrollFactor(0.32, 1).setAlpha(0.4);
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
        .setScale(1.15).setOrigin(0.5, 1).setDepth(-86).setAlpha(0.55).setScrollFactor(0.48, 1);
      this.add.image(860, this.groundY - 1, 'houseRed')
        .setScale(0.95).setOrigin(0.5, 1).setDepth(-86).setAlpha(0.5).setScrollFactor(0.5, 1);
      this.add.image(820, this.groundY - 1, 'tree')
        .setScale(1.8).setOrigin(0.5, 1).setDepth(-85).setAlpha(0.7).setScrollFactor(0.55, 1);
    }

    /**
     * The hand-tuned sky/mountain/skyline layers only cover parallax space
     * for the first ~900px of camera scroll. Long guilds (and the winter/dig
     * zones at the far end) scrolled past them into bare cyan. Repeat seeded
     * scenery across each layer's full parallax range, and float the unused
     * pack blimps/billboards for extra life.
     */
    extendBackdrop() {
      if (this._backdropExtended) return;
      this._backdropExtended = true;
      const maxScroll = Math.max(0, (this.mapWidth || W) - W * 0.8);
      if (maxScroll < 400) return;
      const need = (sf) => maxScroll * sf + W + 100;
      const rng = (seed) => {
        let s = seed >>> 0;
        return () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
      };

      // Clouds (sf ~0.15) — drift like the intro set
      const cr = rng(0xc10d5);
      for (let x = 950; x < need(0.18); x += 200 + cr() * 220) {
        const key = cr() < 0.5 ? 'cloud' : 'cloudSm';
        if (!this.textures.exists(key)) break;
        const sf = 0.12 + cr() * 0.1;
        const c = this.add.image(x, 22 + cr() * 60, key)
          .setScale(1.8 + cr() * 1.4).setAlpha(0.9)
          .setDepth(-125).setScrollFactor(sf);
        this.tweens.add({
          targets: c, x: `+=${20 + cr() * 40}`,
          duration: 15000 + cr() * 12000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      }

      // Far + mid mountain ridges (sf 0.28 / 0.4)
      const mr = rng(0x307a1);
      const mKeys = ['mountainL', 'mountainM', 'mountainS'].filter((k) => this.textures.exists(k));
      if (mKeys.length) {
        for (let x = 980; x < need(0.28); x += 110 + mr() * 60) {
          this.add.image(x, this.groundY - 6, mKeys[Math.floor(mr() * mKeys.length)])
            .setScale(0.95 + mr() * 0.45).setOrigin(0.5, 1)
            .setTint(0xb8c4d8).setAlpha(0.55)
            .setDepth(-100).setScrollFactor(0.28, 1);
        }
        for (let x = 940; x < need(0.4); x += 130 + mr() * 90) {
          this.add.image(x, this.groundY - 4, mKeys[Math.floor(mr() * mKeys.length)])
            .setScale(1.05 + mr() * 0.4).setOrigin(0.5, 1)
            .setTint(0xaebccf)
            .setAlpha(0.58 + mr() * 0.06)
            .setDepth(-90 - (Math.floor(mr() * 2))).setScrollFactor(0.4, 1);
        }
      }

      // Skyline blocks with lit windows (sf 0.32)
      const sk = this.add.graphics().setDepth(-95).setScrollFactor(0.32, 1).setAlpha(0.4);
      const sr = rng(0x5c11e);
      const base = this.groundY - 8;
      for (let x = 920; x < need(0.32); x += 90 + sr() * 160) {
        const h = 36 + sr() * 40;
        sk.fillStyle(sr() < 0.5 ? 0x8a6a78 : 0x9a8070, 1);
        sk.fillRect(x, base - h, 18, h);
        sk.fillStyle(0xffe6a0, 0.25);
        for (let wy = base - h + 6; wy < base - 8; wy += 10) {
          sk.fillRect(x + 4, wy, 3, 3);
          sk.fillRect(x + 10, wy, 3, 3);
        }
      }

      // Rolling hills (sf 0.52) — fill the band between buildings
      const hg = this.add.graphics().setDepth(-84).setScrollFactor(0.52, 1);
      const hr = rng(0x8111);
      for (let x = 950; x < need(0.52); x += 170 + hr() * 140) {
        hg.fillStyle([0x6a8a6e, 0x5e7e62, 0x628666][Math.floor(hr() * 3)], 0.4 + hr() * 0.15);
        hg.fillEllipse(x, this.groundY + 8, 110 + hr() * 60, 36 + hr() * 14);
      }

      // Pack blimps cruising above the block (sf 0.25)
      ['blimpBlue', 'blimpRed'].forEach((bk, i) => {
        if (!this.textures.exists(bk)) return;
        const bx = 500 + i * Math.max(700, maxScroll * 0.25 * 0.5);
        const b = this.add.image(bx, 40 + i * 26, bk)
          .setScale(SCALE).setDepth(-120).setScrollFactor(0.25);
        this.tweens.add({
          targets: b, x: `+=${120 + i * 60}`,
          duration: 26000 + i * 9000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      });
    }

    /** Solid terrain under the walk line — continuous earth, not a floating slab. */
    drawGround() {
      const g = this.add.graphics().setDepth(8);
      const top = this.groundY;
      const width = (this.mapWidth || W) + 160;

      // ---- Concrete sidewalk (the walk line) ----
      g.fillStyle(0x9aa1ab, 1);
      g.fillRect(-50, top - 2, width, 16);
      g.fillStyle(0xb4bac2, 1);
      g.fillRect(-50, top - 2, width, 3);
      // Sidewalk tile seams
      g.lineStyle(1, 0x6b727c, 0.6);
      for (let tx = -40; tx < (this.mapWidth || W) + 60; tx += 28) {
        g.lineBetween(tx, top - 1, tx, top + 13);
      }
      // Curb face
      g.fillStyle(0x767d87, 1);
      g.fillRect(-50, top + 14, width, 4);
      g.fillStyle(0x4c525a, 1);
      g.fillRect(-50, top + 18, width, 2);

      // Grass fringe behind the sidewalk at the building line
      g.fillStyle(0x4fa85a, 1);
      g.fillRect(-50, top - 7, width, 6);
      g.fillStyle(0x6bc86e, 1);
      g.fillRect(-50, top - 7, width, 2);

      // ---- Asphalt road below the curb — makes the street read as a street
      const roadTop = top + 20;
      const roadH = 40;
      g.fillStyle(0x363a41, 1);
      g.fillRect(-50, roadTop, width, roadH);
      // Subtle wear strips where tires run
      g.fillStyle(0x2e3238, 1);
      g.fillRect(-50, roadTop + 8, width, 6);
      g.fillRect(-50, roadTop + 26, width, 6);
      // Dashed yellow center line
      g.fillStyle(0xd8b13c, 0.95);
      for (let dx = -40; dx < (this.mapWidth || W) + 60; dx += 46) {
        g.fillRect(dx, roadTop + roadH / 2 - 1, 22, 3);
      }
      // Storm drains along the curb + occasional manhole covers
      for (let sx = 90; sx < (this.mapWidth || W); sx += 210) {
        g.fillStyle(0x1c1f24, 1);
        g.fillRect(sx, roadTop + 1, 24, 4);
        g.fillStyle(0x0e1013, 1);
        for (let s = 2; s < 22; s += 5) g.fillRect(sx + s, roadTop + 2, 2, 2);
      }
      for (let mx = 180; mx < (this.mapWidth || W); mx += 470) {
        g.fillStyle(0x23262c, 1);
        g.fillEllipse(mx, roadTop + roadH / 2 + 8, 18, 7);
        g.lineStyle(1, 0x14161a, 0.9);
        g.strokeEllipse(mx, roadTop + roadH / 2 + 8, 18, 7);
      }
      // Road edge line at the bottom
      g.fillStyle(0x24272d, 1);
      g.fillRect(-50, roadTop + roadH - 2, width, 2);

      // Continuous earth under the road → fills camera bottom
      const layers = [
        [0x4a3a34, 26],
        [0x3a2c28, 34],
        [0x2a1f1c, 46],
        [0x1a1210, 140],
      ];
      let y = roadTop + roadH;
      layers.forEach(([c, h]) => {
        g.fillStyle(c, 1);
        g.fillRect(-50, y, width, h);
        y += h;
      });

      // Soft strata strokes in the earth
      g.lineStyle(2, 0x110a08, 0.28);
      for (let ly = roadTop + roadH + 12; ly < roadTop + roadH + 160; ly += 16) {
        g.lineBetween(-40, ly, W + 80, ly + 2);
      }

      // Dirt pebbles
      g.fillStyle(0x6a5548, 0.3);
      for (let i = 0; i < 55; i += 1) {
        g.fillRect(
          -10 + (i * 41) % (W + 20),
          roadTop + roadH + 8 + (i * 17) % 130,
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

    /**
     * Store-style room plaque: cleaned two-line channel name + occupancy stars.
     * Hover / in-room shows the full Discord name (emoji preserved).
     */
    roomPlaque(x, y, label, roomKey, tabKey = 'uiTabGrey', opts = {}) {
      const useTab = this.textures.exists(tabKey) ? tabKey : (this.textures.exists('uiTabGrey') ? 'uiTabGrey' : null);
      const parts = { stars: [] };
      const fullLabel = opts.fullLabel || String(label || '');
      const display = plaqueChannelLabel(opts.fullLabel || label);
      const starsW = 3 * 12 + 4;
      const maxW = opts.maxW || 170;
      const textMax = Math.max(48, maxW - 16 - starsW);
      const text = this.add.text(x + 8, y + 3, display, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#f8fafc',
        wordWrap: { width: textMax },
      }).setOrigin(0, 0).setDepth(28).setResolution(Math.max(2, window.devicePixelRatio || 2));
      const h = Math.max(20, Math.min(36, Math.ceil(text.height) + 6));
      const w = Math.max(56, Math.min(maxW, Math.ceil(text.width) + 16 + starsW));
      if (useTab) {
        parts.tab = this.add.image(x, y, useTab)
          .setOrigin(0, 0).setDepth(27)
          .setDisplaySize(w, h);
      } else {
        const bg = this.add.graphics().setDepth(27);
        bg.fillStyle(0x1e293b, 0.92);
        bg.fillRoundedRect(x, y, w, h, 4);
        parts.tab = bg;
      }
      text.setDepth(28);
      parts.text = text;
      parts.fullLabel = fullLabel;
      parts.displayLabel = display;
      parts.height = h;
      const starY = y + Math.floor(h / 2);
      const starX0 = x + w - starsW;
      for (let i = 0; i < 3; i += 1) {
        const star = this.add.image(starX0 + 6 + i * 12, starY, 'uiStar')
          .setScale(SCALE * 0.85).setDepth(28).setAlpha(0.22);
        parts.stars.push(star);
      }
      parts.width = w;
      // Hit area for hover tooltip
      const zone = this.add.zone(x, y, w, h).setOrigin(0, 0).setDepth(29).setInteractive();
      zone.on('pointerover', () => this.showChannelTooltip(x + w / 2, y - 4, fullLabel));
      zone.on('pointerout', () => this.hideChannelTooltip());
      parts.zone = zone;
      if (roomKey) {
        if (!this._roomPlaques) this._roomPlaques = new Map();
        this._roomPlaques.set(roomKey, parts);
      }
      return parts;
    }

    showChannelTooltip(x, y, fullLabel) {
      const t = String(fullLabel || '').trim();
      if (!t) return;
      if (!this._channelTooltip || !this._channelTooltip.active) {
        this._channelTooltip = this.add.text(x, y, t, {
          fontFamily: 'Segoe UI, Tahoma, sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#f8fafc',
          backgroundColor: '#0f172aee',
          padding: { x: 10, y: 5 },
          wordWrap: { width: 260 },
        }).setOrigin(0.5, 1).setDepth(120).setResolution(Math.max(2, window.devicePixelRatio || 2));
      } else {
        this._channelTooltip.setText(t).setPosition(x, y).setVisible(true);
      }
      this._channelTooltip.setAlpha(1);
    }

    hideChannelTooltip() {
      if (this._channelTooltip?.active) this._channelTooltip.setVisible(false);
    }

    /** When standing in a room, prefer full Discord channel name in the tooltip. */
    syncInRoomChannelTooltip() {
      if (!this.indoors) {
        if (this._channelTooltipFloor) {
          this._channelTooltipFloor = null;
          this.hideChannelTooltip();
        }
        return;
      }
      const floor = this.floors?.get(this.indoors.floorId);
      const roomKey = floor?.roomKey;
      const parts = roomKey && this._roomPlaques?.get(roomKey);
      const full = parts?.fullLabel || floor?.label;
      if (!full) return;
      if (this._channelTooltipFloor === roomKey && this._channelTooltip?.visible) return;
      this._channelTooltipFloor = roomKey;
      const px = this.player?.x || 0;
      const py = (floor?.floorY || this.player?.y || 0) - 48;
      this.showChannelTooltip(px, py, full);
    }

    /** Light up plaque stars to match live occupancy (0–3+). */
    updatePlaqueStars() {
      if (!this._roomPlaques) return;
      const counts = new Map();
      for (const p of this.livePeople?.values() || []) {
        counts.set(p.roomKey, (counts.get(p.roomKey) || 0) + 1);
      }
      for (const [roomKey, parts] of this._roomPlaques) {
        const n = counts.get(roomKey) || 0;
        parts.stars.forEach((s, i) => {
          const lit = i < n;
          if (s.alpha !== (lit ? 1 : 0.25)) s.setAlpha(lit ? 1 : 0.25);
        });
      }
    }

    /**
     * Roof cap from Pixel Spaces infrastructure tiles.
     * Roof_1 end (26×17) has ~9px transparent pad under its ridge band; the
     * connecting tile (16×8) must be lifted by that pad so ridge heights match.
     * Without the lift, ends float as two spikes with a low disconnected bar.
     */
    /**
     * Roof packing knobs (see roof-examples/ + tools/roof-composer.html).
     * Roof_1 end is 26×17: slope cols 0–14, flat ridge cols 15–25 (exactly 8px
     * tall — same as connecting). Ridge align = lift connecting by 9 art px.
     */
    roofRecipeFor(style) {
      if (style === 'flat') {
        return {
          overhang: 6,
          yEndOffset: 2,
          endSrcW: 9,
          endSrcH: 5,
          connSrcH: 4,
          endDepth: 21.1,
          connDepth: 20.6,
        };
      }
      return {
        overhang: 6,
        // Sit eaves on the shell lip (was -12 — floated a clear sky gap).
        yEndOffset: 1,
        endSrcW: 26,
        endSrcH: 17,
        connSrcH: 8,
        // Ridge starts at art col 15 on the end tile.
        ridgeInset: 15,
        // Lower shingle course inset so the triangular eaves stay readable.
        lowerInset: 10,
        connStep: 15,
        endDepth: 21.0,
        connDepth: 20.5,
      };
    }

    drawRoofCap(left, top, bw, roofSpec = 'roofRedC') {
      let style = 'gable';
      let color = 'red';
      let connKey = 'roofRedC';
      let customPieces = null;

      if (typeof roofSpec === 'string') {
        connKey = this.textures.exists(roofSpec) ? roofSpec : 'roofRedC';
        if (/^roof2/i.test(connKey)) style = 'flat';
        const m = connKey.match(/roof2?([A-Z][a-z]+)/);
        if (m) color = m[1].toLowerCase();
        if (roofSpec === 'snow') style = 'snow';
      } else if (roofSpec && typeof roofSpec === 'object') {
        style = roofSpec.style || 'gable';
        color = String(roofSpec.color || 'red').toLowerCase();
        const cap = color.charAt(0).toUpperCase() + color.slice(1);
        if (style === 'flat') {
          connKey = this.textures.exists(`roof2${cap}C`) ? `roof2${cap}C` : 'roof2GreyC';
        } else {
          connKey = this.textures.exists(`roof${cap}C`) ? `roof${cap}C` : 'roofRedC';
        }
        if (Array.isArray(roofSpec.pieces) && roofSpec.pieces.length) {
          customPieces = roofSpec.pieces;
        }
      }

      const isFlat = style === 'flat' || /^roof2/i.test(connKey);
      const endKey = connKey.replace(/C$/, 'E');
      const recipe = (typeof roofSpec === 'object' && roofSpec.parametric)
        ? { ...this.roofRecipeFor(isFlat ? 'flat' : 'gable'), ...roofSpec.parametric }
        : this.roofRecipeFor(isFlat ? 'flat' : 'gable');

      const tileW = 16 * SCALE;
      const endW = (recipe.endSrcW || (isFlat ? 9 : 26)) * SCALE;
      const yEnd = top + recipe.yEndOffset;
      const ridgePad = (recipe.endSrcH - recipe.connSrcH) * SCALE;
      const yRidge = yEnd - ridgePad;
      // Lower course top meets ridge bottom (closes the 1px sky slit).
      const yLower = yEnd - SCALE;
      const overhang = recipe.overhang;
      const endDepth = recipe.endDepth;
      const connDepth = recipe.connDepth;
      const step = Math.max(8, (recipe.connStep || 15) * SCALE);

      const placeRun = (y, runL, runR, depth) => {
        if (!this.textures.exists(connKey) || runR - runL < tileW * 0.5) return;
        for (let x = runL; x <= runR - tileW; x += step) {
          this.add.image(x, y, connKey)
            .setOrigin(0, 1).setDepth(depth).setScale(SCALE);
        }
        this.add.image(runR - tileW, y, connKey)
          .setOrigin(0, 1).setDepth(depth - 0.04).setScale(SCALE);
      };

      if (customPieces) {
        for (const p of customPieces) {
          const kind = p.kind === 'end' ? endKey : (p.kind === 'connecting' ? connKey : null);
          const key = p.key || kind;
          if (!key || !this.textures.exists(key)) continue;
          const img = this.add.image(
            left + Number(p.x) * SCALE,
            top + Number(p.y) * SCALE,
            key,
          ).setOrigin(0, 1)
            .setDepth(p.kind === 'end' ? endDepth : connDepth)
            .setScale(SCALE);
          if (p.flipX) img.setFlipX(true);
        }
      } else if (isFlat) {
        // Flat: fascia + single cap run between end pieces.
        const fascia = this.add.graphics().setDepth(connDepth - 0.25);
        const fx = left - overhang - 1;
        const fw = bw + overhang * 2 + 2;
        fascia.fillStyle(0x1a222c, 1);
        fascia.fillRect(fx, yEnd - 1, fw, 6);
        fascia.fillStyle(0x4a5868, 1);
        fascia.fillRect(fx + 1, yEnd - 4, fw - 2, 3);
        const flatSy = SCALE * 1.6;
        placeRun(yEnd, left - overhang + endW - 2, left + bw + overhang - endW + 2, connDepth);
        if (this.textures.exists(endKey)) {
          this.add.image(left - overhang, yEnd, endKey)
            .setOrigin(0, 1).setDepth(endDepth).setScale(SCALE, flatSy * 0.95);
          this.add.image(left + bw + overhang, yEnd, endKey)
            .setOrigin(1, 1).setDepth(endDepth).setScale(SCALE, flatSy * 0.95).setFlipX(true);
        }
      } else {
        // Gable: dual shingle courses fill the hollow middle, ends on top.
        // Roof_1 connecting is only the 8px ridge strip — one run left a
        // see-through gap under the peak. Lower course closes it; ends keep
        // the classic sloped eaves.
        const spanL = left - overhang;
        const spanR = left + bw + overhang;
        const lowerInset = (recipe.lowerInset || 10) * SCALE;
        const ridgeInset = (recipe.ridgeInset || 15) * SCALE;
        placeRun(yLower, spanL + lowerInset, spanR - lowerInset, connDepth - 0.1);
        placeRun(yRidge, spanL + ridgeInset, spanR - ridgeInset, connDepth);
        if (this.textures.exists(endKey)) {
          this.add.image(spanL, yEnd, endKey)
            .setOrigin(0, 1).setDepth(endDepth).setScale(SCALE);
          this.add.image(spanR, yEnd, endKey)
            .setOrigin(1, 1).setDepth(endDepth).setScale(SCALE).setFlipX(true);
        }
      }

      if (style === 'snow' || (typeof roofSpec === 'object' && roofSpec.snow)) {
        this.drawRoofSnow(left, top, bw, yRidge);
      }

      return {
        style: isFlat ? 'flat' : (style === 'snow' ? 'snow' : 'gable'),
        color,
        y: yRidge,
      };
    }

    /** Layer snow piles along a roof line (Pixel Spaces snowpile tiles). */
    drawRoofSnow(left, top, bw, roofY) {
      const y = (roofY != null ? roofY : top + 2) - 2;
      const tiles = ['roofSnowC1', 'roofSnowC2', 'roofSnowC3'].filter((k) => this.textures.exists(k));
      if (!tiles.length) return;
      const tileW = 16 * SCALE;
      let i = 0;
      for (let x = left + 8; x < left + bw - 16; x += tileW + 2) {
        const key = tiles[i % tiles.length];
        this.add.image(x, y, key)
          .setOrigin(0, 1).setDepth(22).setScale(SCALE).setAlpha(0.95);
        i += 1;
      }
      if (this.textures.exists('roofSnowE')) {
        this.add.image(left + 2, y, 'roofSnowE')
          .setOrigin(0, 1).setDepth(22).setScale(SCALE);
        this.add.image(left + bw - 2, y, 'roofSnowE')
          .setOrigin(1, 1).setDepth(22).setScale(SCALE).setFlipX(true);
      }
    }

    /**
     * Walkable deck props — vary by roof style / seed so each building feels different.
     * style: gable | flat | snow | garden | utility
     */
    decorateRooftop(roofMin, roofMax, roofY, style = 'gable', seed = 0) {
      const mid = (roofMin + roofMax) / 2;
      const span = Math.max(40, roofMax - roofMin);
      const s = hashSeed(String(seed) + style + Math.floor(roofMin));

      // Soft deck planks already drawn by markRooftopDeck
      if (style === 'utility' || style === 'flat') {
        // Flat roofs always get HVAC so the deck doesn't look empty.
        if (this.textures.exists('roofVents1')) {
          this.furn('roofVents1', roofMin + span * 0.22, roofY, 22);
        }
        if (this.textures.exists('roofVents2')) {
          this.furn('roofVents2', roofMin + span * 0.62, roofY, 22);
        }
        if (span > 100 && this.textures.exists('roofVents1')) {
          this.furn('roofVents1', roofMin + span * 0.88, roofY, 22, SCALE * 0.9);
        }
        if (span > 140 && this.textures.exists('craneRoof') && (s % 3 === 0)) {
          this.furn('craneRoof', mid + 20, roofY, 21);
        }
      } else if (style === 'garden' || style === 'gable') {
        // Pitched shingles: no deck props on the cap — trees and white vent
        // boxes standing on the ridge read as a broken roof. Keep it clean.
      } else if (style === 'snow') {
        if (this.textures.exists('roofVents2')) this.furn('roofVents2', mid - 10, roofY, 22);
        // Extra snow blobs on the deck surface
        if (this.textures.exists('roofSnowC2')) {
          this.add.image(roofMin + 20, roofY - 1, 'roofSnowC2')
            .setOrigin(0.5, 1).setDepth(22).setScale(SCALE);
          this.add.image(roofMax - 24, roofY - 1, 'roofSnowC3')
            .setOrigin(0.5, 1).setDepth(22).setScale(SCALE);
        }
      } else {
        // default mix — utility props only, never trees on a roof
        if (this.textures.exists('roofVents1')) this.furn('roofVents1', mid - 18, roofY, 22);
        if (this.textures.exists('roofVents2')) this.furn('roofVents2', mid + 28, roofY, 22);
        if (span > 120 && this.textures.exists('craneRoof') && (s % 3 === 0)) {
          this.furn('craneRoof', mid + 26, roofY, 21);
        }
      }
    }

    /** Pick a roof style/color for a building from theme + seed. */
    pickRoofSpec(themeOrPal, seed = 0) {
      const s = typeof seed === 'number' ? seed : hashSeed(String(seed));
      // Theme-driven defaults
      const theme = String(themeOrPal?.theme || themeOrPal || '').toLowerCase();
      // Snow roofs only when the caller explicitly opts in (winter zone) —
      // never inferred from arbitrary titles (a "snow" channel name is not winter).
      if (themeOrPal?.snow === true || theme === 'winterzone') {
        return { style: 'snow', color: 'blue', snow: true };
      }
      if (theme.includes('hospital') || theme.includes('museum') || theme.includes('office')) {
        return { style: 'flat', color: s % 2 ? 'grey' : 'blue' };
      }
      if (theme.includes('police') || theme.includes('fire')) {
        return { style: 'flat', color: theme.includes('fire') ? 'red' : 'black' };
      }
      if (theme.includes('cafe') || theme.includes('gamer')) {
        return { style: 'gable', color: theme.includes('cafe') ? 'orange' : 'purple' };
      }
      if (theme.includes('halloween')) {
        return { style: 'gable', color: 'black' };
      }
      // From palette roofKey if present
      if (themeOrPal?.roofKey) {
        const k = themeOrPal.roofKey;
        if (/^roof2/i.test(k)) {
          const m = k.match(/roof2([A-Z][a-z]+)/);
          return { style: 'flat', color: (m?.[1] || 'Grey').toLowerCase() };
        }
        const m = k.match(/roof([A-Z][a-z]+)/);
        const colors = ['red', 'blue', 'green', 'orange', 'purple', 'yellow', 'black'];
        // Cycle style by seed: gable / flat / garden gable
        const styles = ['gable', 'gable', 'flat', 'garden'];
        return {
          style: styles[s % styles.length],
          color: (m?.[1] || colors[s % colors.length]).toLowerCase(),
        };
      }
      const colors = ['red', 'blue', 'green', 'orange', 'purple', 'yellow', 'black', 'grey'];
      const styles = ['gable', 'flat', 'garden', 'utility', 'gable'];
      return { style: styles[s % styles.length], color: colors[s % colors.length] };
    }

    /** Underground dirt slice with roots/pebbles beneath a building. */
    drawFoundation(g, left, bw) {
      const top = this.groundY;
      const depthPx = 20; // stop at the road top — dirt over asphalt reads wrong
      g.fillStyle(0x6b4a2f, 1);
      g.fillRect(left + 2, top, bw - 4, depthPx);
      g.fillStyle(0x54381f, 1);
      g.fillRect(left + 2, top + depthPx - 7, bw - 4, 7);
      // roots + pebbles
      g.lineStyle(2, 0x3f2a15, 0.9);
      for (let i = 0; i < Math.floor(bw / 46); i += 1) {
        const rx = left + 16 + i * 46 + ((i * 13) % 9);
        g.lineBetween(rx, top + 3, rx - 5, top + 13);
        g.lineBetween(rx - 5, top + 13, rx + 2, top + 20);
      }
      g.fillStyle(0x8a6a44, 0.9);
      for (let i = 0; i < Math.floor(bw / 24); i += 1) {
        g.fillRect(left + 8 + i * 24 + ((i * 7) % 11), top + 6 + ((i * 5) % 14), 3, 2);
      }
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
      // Spread slots evenly inside the room's walkable band (the old fixed
      // 28px stride overflowed narrow rooms past their right wall) and fold
      // big counts into extra depth rows so crowds form loose clusters.
      const pts = [];
      const perRow = Math.max(3, Math.min(5, Math.ceil(count / 2)));
      const margin = 22;
      const span = Math.max(40, w - margin * 2);
      for (let i = 0; i < count; i += 1) {
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const t = perRow === 1 ? 0.5 : col / (perRow - 1);
        pts.push([x0 + margin + t * span, floorY - 1 - row * 6]);
      }
      return pts;
    }

    drawVoiceBuilding(left, groundY, channels, guildName) {
      const g = this.add.graphics().setDepth(20);
      const occOf = (ch) => Math.max(0, Number(ch?.occupantCount) || 0);
      const totalOcc = channels.reduce((n, ch) => n + occOf(ch), 0);
      // Crowd-driven size: a busy building widens (up to +90px) and each
      // room's height grows with its own occupants, so a full VC reads as a
      // big open hangout instead of the same snug box as an empty channel.
      const bw = 290 + Math.min(90, totalOcc * 8);
      const gap = channels.length > 4 ? 8 : 0;
      const cols = channels.length > 4 ? 2 : 1;
      const rows = Math.ceil(channels.length / cols);
      const roomW = cols === 1
        ? bw - 32
        : Math.floor((bw - 32 - gap) / cols);
      const minRoomH = 84;
      const doorStrip = 54;
      // Single-floor rooms stay snug (84–98px — the size small rooms read
      // best at). A 6+ crowd earns a real second storey: double-height room
      // with a loft platform + ladder instead of one stretched box.
      const LOFT_OCC = 6;
      const desiredH = (ch) => {
        const occ = occOf(ch);
        if (occ >= LOFT_OCC) return 162;
        return Phaser.Math.Clamp(minRoomH + Math.max(0, occ - 1) * 6, minRoomH, 98);
      };
      const rowHeights = [];
      for (let r = 0; r < rows; r += 1) {
        let h = minRoomH;
        for (let c2 = 0; c2 < cols; c2 += 1) {
          const ch = channels[cols === 1 ? r : r * cols + c2];
          if (ch) h = Math.max(h, desiredH(ch));
        }
        rowHeights.push(h);
      }
      const totalRoomsHeight = rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * gap;
      // Content-driven height — a 1-2 channel guild gets a snug clubhouse,
      // not a tower of empty placeholder rooms.
      const bh = totalRoomsHeight + doorStrip + 32;
      const top = groundY - bh;
      this._sceneMinY = Math.min(this._sceneMinY ?? 0, top - 30);
      const title = channels.length === 1
        ? shortLabel(plaqueChannelLabel(channels[0]), 24)
        : 'Voice Channels';

      g.fillStyle(0x000000, 0.22);
      g.fillRect(left + 8, groundY - 6, bw, 10);
      g.fillStyle(0x5865f2, 1);
      g.fillRect(left, top, bw, bh);
      g.fillStyle(0x3c45c0, 1);
      g.fillRect(left + bw - 14, top, 14, bh);
      g.lineStyle(3, 0x1a1f4a, 1);
      g.strokeRect(left, top, bw, bh);
      // Real shingle roof + dirt foundation (same grammar as themed shells)
      this.drawRoofCap(left, top, bw, this.pickRoofSpec({ theme: 'voice', roofKey: 'roofBlueC' }, left));
      this.drawFoundation(g, left, bw);

      this.buildingTitle(left + bw / 2, top - 22, title, {
        color: '#eef0ff', bg: '#3c45c0',
      });

      const rowCount = rows;
      const innerTop = top + 12;
      // Prefix Y offsets from the per-row heights (rooms are no longer uniform).
      const rowY = [];
      let rowAcc = innerTop;
      for (let r = 0; r < rowCount; r += 1) {
        rowY.push(rowAcc);
        rowAcc += rowHeights[r] + gap;
      }
      const totalSlots = rowCount * cols;

      for (let idx = 0; idx < totalSlots; idx += 1) {
        const isPlaceholder = idx >= channels.length;
        const col = cols === 1 ? 0 : idx % cols;
        const row = cols === 1 ? idx : Math.floor(idx / cols);
        const x0 = left + 16 + col * (roomW + gap);
        const y0 = rowY[row];
        const h = row === rowCount - 1
          ? top + bh - doorStrip - y0
          : rowHeights[row] - 4;
        const roomKey = isPlaceholder ? `vc_placeholder_${idx}` : chKey(channels[idx].id);
        const label = isPlaceholder ? '' : this.roomDisplayLabel(channels[idx]);
        const fill = isPlaceholder ? 0xc2c6e6 : this.roomWallColor(roomKey, channels[idx]?.id);

        const occ = isPlaceholder ? 0 : occOf(channels[idx]);
        const hasLoft = !isPlaceholder && occ >= LOFT_OCC;
        // Loft platform surface — upper storey of a packed room.
        const loftY = hasLoft ? y0 + Math.floor(h * 0.52) : 0;

        this.cutawayRoom(g, x0, y0, roomW, h, fill, () => {
          if (!isPlaceholder) {
            const floor = y0 + h - 2;
            // Furniture dresses the LOWER storey; the loft stays open deck.
            this.decorateRoom(channels[idx], x0, y0, roomW, h, floor, {
              clearXf: 0.14,
              roomKey: isPlaceholder ? undefined : chKey(channels[idx].id),
              occupants: occ,
            });
            if (hasLoft) {
              // Wood platform band across the full room width (full-width so
              // anyone wandering at loft height is always standing on it).
              const pg = this.add.graphics().setDepth(22);
              pg.fillStyle(0x6b4a2c, 1);
              pg.fillRect(x0 + 2, loftY - 5, roomW - 4, 7);
              pg.fillStyle(0x9a7040, 1);
              pg.fillRect(x0 + 2, loftY - 5, roomW - 4, 2);
              // Crowd splits across both storeys.
              const lower = this.slotPointsForRoom(
                x0, roomW, floor, Math.max(3, Math.ceil((occ + 2) / 2)),
              );
              const upper = this.slotPointsForRoom(
                x0, roomW, loftY - 3, Math.max(3, Math.floor((occ + 2) / 2)),
              );
              this.addRoomSlots(roomKey, [...lower, ...upper]);
            } else {
              // Stand slots scale with the crowd so people spread out instead
              // of piling on the same four spots.
              this.addRoomSlots(roomKey, this.slotPointsForRoom(
                x0, roomW, floor, Math.max(4, Math.min(8, occ + 2)),
              ));
            }
          }
        });

        if (!isPlaceholder) {
          this.roomPlaque(x0 + 4, y0 + 4, plaqueChannelLabel(label), roomKey, 'uiTabBlue', {
            maxW: roomW - 12,
            fullLabel: label,
          });
          this.registerFloor({
            id: roomKey,
            roomKey,
            floorY: y0 + h - 3,
            minX: x0 + 10,
            maxX: x0 + roomW - 10,
            label,
          });
          if (hasLoft) {
            // The loft is a real walkable floor with a ladder — same climb
            // grammar as themed buildings' storeys/rooftops. The ladder uses
            // the RIGHT lane so it never collides with the building's shared
            // left elevator/climb lane between stacked rooms.
            const loftId = `${roomKey}__loft`;
            this.registerFloor({
              id: loftId,
              roomKey: loftId,
              floorY: loftY - 2,
              minX: x0 + 10,
              maxX: x0 + roomW - 10,
              label: `${label} · loft`,
            });
            const laneX = x0 + roomW - Math.max(26, roomW * 0.14);
            this.markClimbDoor(laneX, roomKey);
            this.markClimbDoor(laneX, loftId);
            this.registerStairs({
              x: laneX, fromFloorId: roomKey, toFloorId: loftId, radius: 28,
            });
          }
        }

        if (idx === 0 && !isPlaceholder) {
          this.registerDoor({ x: left + 42, floorId: roomKey, radius: 18 });
        }
        if (cols === 2 && idx === 1 && !isPlaceholder) {
          this.registerDoor({ x: streetDoorRightX(left, bw), floorId: roomKey, radius: 18 });
        }
      }

      this.placeEntrance(g, left + 42, groundY, 'door', 0x3c45c0, 26);
      if (cols === 2 && channels.length > 1) {
        this.placeEntrance(g, streetDoorRightX(left, bw), groundY, 'door', 0x3c45c0, 26);
      }

      // Side-by-side VC rooms need a walkable middle doorway (same as text buildings).
      if (cols === 2) {
        for (let r = 0; r < rows; r += 1) {
          const leftIdx = r * 2;
          const rightIdx = leftIdx + 1;
          if (rightIdx >= channels.length) continue;
          const leftKey = chKey(channels[leftIdx].id);
          const rightKey = chKey(channels[rightIdx].id);
          const leftFloor = this.floors.get(leftKey);
          const rightFloor = this.floors.get(rightKey);
          if (!leftFloor || !rightFloor) continue;
          this.registerPassage({
            fromFloorId: leftKey,
            toFloorId: rightKey,
            x: left + 16 + roomW + gap / 2,
            radius: 18,
            roomH: rowHeights[r],
            doorKind: 'wood',
          });
        }
        // Vertical travel between stacked VC rows (left & right columns).
        // Tall towers (3+ storeys) ride Pixel Spaces elevators; short stacks
        // keep climb doors.
        const climbMode = rows >= 3 ? 'elev' : 'door';
        for (let r = 0; r + 1 < rows; r += 1) {
          for (const col of [0, 1]) {
            const upperIdx = r * 2 + col;
            const lowerIdx = (r + 1) * 2 + col;
            if (upperIdx >= channels.length || lowerIdx >= channels.length) continue;
            const upperKey = chKey(channels[upperIdx].id);
            const lowerKey = chKey(channels[lowerIdx].id);
            const laneX = left + 16 + col * (roomW + gap) + Math.max(22, roomW * 0.18);
            const sx = this.markClimbDoor(laneX, upperKey, 'wood', climbMode) || laneX;
            this.markClimbDoor(sx, lowerKey, 'wood', climbMode);
            this.registerStairs({
              x: sx,
              fromFloorId: lowerKey,
              toFloorId: upperKey,
              radius: 28,
            });
          }
        }
      }

      // Single-column stacks previously had NO vertical connection at all —
      // rooms were sealed boxes. Same shared left lane: elevators once the
      // tower hits 3+ storeys, climb doors below that.
      if (cols === 1 && rows >= 2) {
        const climbMode = rows >= 3 ? 'elev' : 'door';
        for (let r = 0; r + 1 < rows; r += 1) {
          if (r + 1 >= channels.length) continue;
          const upperKey = chKey(channels[r].id);
          const lowerKey = chKey(channels[r + 1].id);
          if (!this.floors.get(upperKey) || !this.floors.get(lowerKey)) continue;
          const laneX = left + 16 + Math.max(22, roomW * 0.18);
          const sx = this.markClimbDoor(laneX, upperKey, 'wood', climbMode) || laneX;
          this.markClimbDoor(sx, lowerKey, 'wood', climbMode);
          this.registerStairs({
            x: sx,
            fromFloorId: lowerKey,
            toFloorId: upperKey,
            radius: 28,
          });
        }
      }

      const vWinY = groundY - doorStrip + 12;
      [left + bw * 0.3, left + bw * 0.7].forEach((wx) => {
        if (!this.textures.exists('windowCircle')) return;
        g.fillStyle(0xfff3c0, 0.25);
        g.fillRect(wx - 10, vWinY - 1, 20, 20);
        this.add.image(wx, vWinY, 'windowCircle').setOrigin(0.5, 0).setDepth(25).setScale(SCALE);
      });
      this.stripLabel(left + bw / 2, groundY - doorStrip + 6, `${shortLabel(displayChannelName(guildName), 18)} · VC`, {
        color: '#eef0ff', bg: '#2b3190',
      });
      // Width is occupancy-dependent — the street layout needs it back.
      return { bw, bh };
    }

    drawTextBuilding(left, groundY, title, channels, paletteIndex = 0) {
      const palettes = [
        { shell: 0x45b866, side: 0x2f8f4a, roof: 0x359a52, stroke: 0x12301a, titleBg: '#b8f0c8', titleFg: '#102818', lintel: 0x2a5534, roofKey: 'roofGreenC', plaqueKey: 'uiTabGreen' },
        { shell: 0x3db4a8, side: 0x2a8f86, roof: 0x45c4b8, stroke: 0x0f3530, titleBg: '#b8f0ea', titleFg: '#0a2824', lintel: 0x2a5548, roofKey: 'roofBlueC', plaqueKey: 'uiTabBlue' },
        { shell: 0xe8943a, side: 0xc47a2a, roof: 0xf0a850, stroke: 0x4a3010, titleBg: '#ffe8c8', titleFg: '#3a2208', lintel: 0x553822, roofKey: 'roofOrangeC', plaqueKey: 'uiTabYellow' },
        { shell: 0x6a7ec8, side: 0x4a5aa0, roof: 0x7a8ed8, stroke: 0x1a2040, titleBg: '#d8e0ff', titleFg: '#141828', lintel: 0x2a3458, roofKey: 'roofPurpleC', plaqueKey: 'uiTabPurple' },
        { shell: 0xc86a6a, side: 0xa04848, roof: 0xd88080, stroke: 0x401818, titleBg: '#ffd8d8', titleFg: '#281010', lintel: 0x553030, roofKey: 'roofRedC', plaqueKey: 'uiTabRed' },
      ];
      const pal = palettes[paletteIndex % palettes.length];
      const g = this.add.graphics().setDepth(20);
      const bw = 290;
      const gap = 6;
      const doorStrip = 54;
      const roomH = 82;
      const padX = left + 16;
      const innerW = bw - 32;
      const roomW = (innerW - gap) / 2;

      // Dynamic grid: 2 rooms per row, odd last room spans full width — the
      // shell hugs the rooms so there are no dead wall slabs.
      const chans = channels.slice(0, 4);
      const rows = Math.max(1, Math.ceil(chans.length / 2));
      const bh = 12 + rows * roomH + (rows - 1) * gap + doorStrip + 6;
      const top = groundY - bh;
      this._sceneMinY = Math.min(this._sceneMinY ?? 0, top - 30);

      g.fillStyle(0x000000, 0.22);
      g.fillRect(left + 8, groundY - 6, bw, 10);
      g.fillStyle(pal.shell, 1);
      g.fillRect(left, top, bw, bh);
      g.fillStyle(pal.side, 1);
      g.fillRect(left + bw - 14, top, 14, bh);
      g.lineStyle(3, pal.stroke, 1);
      g.strokeRect(left, top, bw, bh);
      const textRoof = this.pickRoofSpec({ theme: title || 'text', roofKey: pal.roofKey }, left + paletteIndex * 17);
      this.drawRoofCap(left, top, bw, textRoof);
      this.drawFoundation(g, left, bw);

      this.buildingTitle(left + bw / 2, top - 22, shortLabel(displayChannelName(title), 22), {
        color: pal.titleFg, bg: pal.titleBg,
      });

      const grid = chans.map((ch, idx) => {
        const row = Math.floor(idx / 2);
        const col = idx % 2;
        const isLastOdd = idx === chans.length - 1 && chans.length % 2 === 1;
        return {
          x: isLastOdd ? padX : padX + col * (roomW + gap),
          y: top + 12 + row * (roomH + gap),
          w: isLastOdd ? innerW : roomW,
          h: roomH,
        };
      });

      chans.forEach((ch, idx) => {
        const slot = grid[idx];
        const roomKey = chKey(ch.id);
        const label = this.roomDisplayLabel(ch);
        this.cutawayRoom(g, slot.x, slot.y, slot.w, slot.h, this.roomWallColor(roomKey, ch.id), () => {
          const floor = slot.y + slot.h - 2;
          this.decorateRoom(ch, slot.x, slot.y, slot.w, slot.h, floor, {
            clearXf: 0.14,
            roomKey,
            occupants: Math.max(0, Number(ch?.occupantCount) || 0),
          });
          this.addRoomSlots(roomKey, this.slotPointsForRoom(
            slot.x, slot.w, floor,
            Math.max(3, Math.min(8, (Number(ch?.occupantCount) || 0) + 2)),
          ));
        });
        this.roomPlaque(slot.x + 4, slot.y + 4, plaqueChannelLabel(label), roomKey, pal.plaqueKey || 'uiTabGreen', {
          maxW: slot.w - 12,
          fullLabel: label,
        });
        this.registerFloor({
          id: roomKey,
          roomKey,
          floorY: slot.y + slot.h - 3,
          minX: slot.x + 8,
          maxX: slot.x + slot.w - 8,
          label,
        });
      });

      // Street-level storefront dressing between the doors: lit windows and
      // planters so the ground band reads as a lobby, not dead shell.
      const lobbyY = groundY - 2;
      const winY = groundY - doorStrip + 12;
      // Two lit windows flank the centered enter-prompt (0.5 stays clear).
      [left + bw * 0.3, left + bw * 0.7].forEach((wx) => {
        if (!this.textures.exists('windowSq')) return;
        g.fillStyle(0xfff3c0, 0.28);
        g.fillRect(wx - 11, winY - 1, 22, 20);
        this.add.image(wx, winY, 'windowSq').setOrigin(0.5, 0).setDepth(25).setScale(SCALE);
      });
      if (this.textures.exists('floraFern')) {
        this.add.image(left + bw * 0.24, lobbyY, 'floraFern').setOrigin(0.5, 1).setDepth(25).setScale(SCALE);
      }

      // Grid-driven wiring: street doors enter the BOTTOM row, stairs link
      // vertical stacks in the clear left lane (right lane when both rows are
      // full pairs), passages join side-by-side rooms, roof off the top row.
      const rowRooms = [];
      chans.forEach((ch, idx) => {
        const r = Math.floor(idx / 2);
        (rowRooms[r] ||= []).push({ ch, key: chKey(ch.id), slot: grid[idx] });
      });
      const bottomRow = rowRooms[rows - 1] || [];
      if (bottomRow[0]) {
        const doorX = left + 40;
        this.placeEntrance(g, doorX, groundY, 'door', pal.lintel, 26);
        this.registerDoor({ x: doorX, floorId: bottomRow[0].key, radius: 18, kind: 'door' });
      }
      if (bottomRow[1]) {
        const doorX2 = streetDoorRightX(left, bw);
        this.placeEntrance(g, doorX2, groundY, 'door', pal.lintel, 26);
        this.registerDoor({ x: doorX2, floorId: bottomRow[1].key, radius: 18, kind: 'door' });
      }

      let leftLaneX = padX + Math.max(20, roomW * 0.2);
      const rightLaneX = padX + roomW + gap + Math.max(20, roomW * 0.2);
      for (let r = 0; r + 1 < rows; r += 1) {
        const upper = rowRooms[r];
        const lower = rowRooms[r + 1];
        if (!upper?.[0] || !lower?.[0]) continue;
        leftLaneX = this.markClimbDoor(leftLaneX, upper[0].key) || leftLaneX;
        this.markClimbDoor(leftLaneX, lower[0].key);
        this.registerStairs({
          x: leftLaneX,
          fromFloorId: lower[0].key,
          toFloorId: upper[0].key,
          radius: 28,
        });
        if (upper[1] && lower[1]) {
          const rx = this.markClimbDoor(rightLaneX, upper[1].key) || rightLaneX;
          this.markClimbDoor(rx, lower[1].key);
          this.registerStairs({
            x: rx,
            fromFloorId: lower[1].key,
            toFloorId: upper[1].key,
            radius: 28,
          });
        }
      }
      rowRooms.forEach((row) => {
        if (row.length === 2) {
          this.registerPassage({
            fromFloorId: row[0].key,
            toFloorId: row[1].key,
            x: padX + roomW + gap / 2,
            radius: 18,
            roomH,
            doorKind: 'wood',
          });
        }
      });

      // Rooftop deck off the top row's left room.
      const topRoom = rowRooms[0]?.[0];
      if (topRoom) {
        const roofId = `roof_${left}`;
        const roofY = top + 8;
        const roofMin = padX + 10;
        const roofMax = padX + innerW - 10;
        this.registerFloor({
          id: roofId,
          roomKey: roofId,
          floorY: roofY,
          minX: roofMin,
          maxX: roofMax,
          label: 'Rooftop',
          isRoof: true,
        });
        this.markRooftopDeck(roofMin, roofMax, roofY);
        // Single-row buildings have no stairs yet — give the top room a lane.
        if (rows === 1) {
          leftLaneX = this.markClimbDoor(leftLaneX, topRoom.key) || leftLaneX;
        }
        this.markClimbDoor(leftLaneX, roofId);
        this.registerStairs({
          x: leftLaneX,
          fromFloorId: topRoom.key,
          toFloorId: roofId,
          radius: 36,
        });
        this.decorateRooftop(roofMin, roofMax, roofY, textRoof.style || 'gable', left);
        this._sceneMinY = Math.min(this._sceneMinY ?? 0, roofY - 100);
      }

      this.stripLabel(left + bw / 2, groundY - doorStrip + 6, 'Text channels', {
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
      // Still place a door so offline mode isn't a dead wall.
      this.placeEntrance(g, left + 42, groundY, 'door', 0x3c45c0, 26);
      this.registerDoor({ x: left + 42, floorId: 'empty_lobby', radius: 18 });
      this.registerFloor({
        id: 'empty_lobby',
        roomKey: 'empty_lobby',
        floorY: groundY - 40,
        minX: left + 20,
        maxX: left + bw - 20,
        label: 'lobby',
      });
    }

    /** Offline / no-presence sample so doors and floors stay testable. */
    drawDemoLayout(left, groundY, guildName) {
      const demoChannels = [
        { id: 'demo-rules', name: 'rules', type: 'text' },
        { id: 'demo-chat', name: 'general', type: 'text' },
        { id: 'demo-mod', name: 'mod', type: 'text' },
        { id: 'demo-lounge', name: 'lounge', type: 'text' },
      ];
      this.drawTextBuilding(left, groundY, `${shortLabel(guildName, 16)} · demo`, demoChannels, 0);
      this.buildings.push({
        left,
        right: left + 290,
        kind: 'text',
        channels: demoChannels,
        label: 'demo',
      });
      // Badge above the roof — never cover street doors
      this.stripLabel(left + 145, groundY - 248, 'Presence offline · demo layout', {
        color: '#ffe8a0', bg: '#3a2a10',
      });
    }

    placeEntrance(g, cx, groundY, kind = 'wood', lintelColor = 0x2a5534, depth = 26) {
      // Street storefront: pack *_double.png (25×22) as closed front-facing leaf.
      // On approach, texture-swap to *_opened.png (no squash of the double).
      this.ensureFrontDoorTextures();
      const fam = doorFamilyFor(kind);
      let closedKey = fam.closedKey;
      let openKey = fam.openKey;
      if (!this.textures.exists(closedKey)) closedKey = 'doorFrontClosed';
      if (!this.textures.exists(openKey)) openKey = closedKey;

      const scale = SCALE;
      const src = doorTexSize(this, closedKey);
      const leafW = src.w * scale;
      const leafH = src.h * scale;
      const jamb = 3;
      const lintelH = 4;
      const frameW = leafW + jamb * 2;
      const frameH = leafH + 2;
      const fx = Math.round(cx - frameW / 2);
      const fy = Math.round(groundY - frameH);

      // Lintel
      g.fillStyle(lintelColor, 1);
      g.fillRect(fx - 2, fy - lintelH, frameW + 4, lintelH);
      g.lineStyle(1, 0x0a0806, 1);
      g.strokeRect(fx - 2, fy - lintelH, frameW + 4, lintelH);

      // Dark recess
      g.fillStyle(0x0c0a08, 1);
      g.fillRect(fx, fy, frameW, frameH);

      // Jambs
      g.fillStyle(0x3a2e22, 1);
      g.fillRect(fx, fy, jamb, frameH);
      g.fillRect(fx + frameW - jamb, fy, jamb, frameH);

      g.fillStyle(0x1a1510, 1);
      g.fillRect(fx + jamb, fy + 1, frameW - jamb * 2, frameH - 2);

      // Threshold
      g.fillStyle(0x2c2118, 1);
      g.fillRect(fx - 2, groundY - 2, frameW + 4, 2);
      g.fillStyle(0x000000, 0.22);
      g.fillRect(fx, groundY, frameW, 1);

      g.lineStyle(1, 0x0a0806, 1);
      g.strokeRect(fx, fy, frameW, frameH);

      // Leaf — left hinge, sits on ground (pack double when available)
      const hingeX = fx + jamb;
      const leaf = this.add.image(hingeX, groundY - 1, closedKey)
        .setOrigin(0, 1)
        .setScale(scale, scale)
        .setDepth(depth);
      this.autoDoors.push({
        x: cx,
        kind: fam.family,
        mode: 'swing',
        indoor: false,
        leaf,
        closedKey,
        openKey,
        swapTexture: closedKey !== openKey && closedKey !== 'doorFrontClosed',
        baseScale: scale,
        openScaleX: scale * 0.22,
        openRadius: 28,
        closeRadius: 40,
        isOpen: false,
        animating: false,
      });
      return {
        fx, fy, frameW, frameH, dw: leafW, dh: leafH,
        sprite: leaf, kind: fam.family,
      };
    }

    /** Place furniture sitting on a floor line (origin bottom-center).
     *  Seats and beds (SEAT_INFO/BED_INFO) auto-register as interactables. */
    furn(key, x, floorY, depth = 23, scale = SCALE, floorId = null) {
      if (!this.textures.exists(key)) {
        this._missingAssets?.add?.(key);
        return null;
      }
      if (SEAT_INFO[key] != null) {
        this.seats.push({
          x, floorY, floorId, surfaceH: SEAT_INFO[key], kind: 'seat', key, radius: 22,
        });
      } else if (BED_INFO[key] != null) {
        this.seats.push({
          x, floorY, floorId, surfaceH: BED_INFO[key], kind: 'bed', key, radius: 28,
        });
      }
      if (FOOD_HOST_KEYS.has(key) && SURFACE_HOSTS[key] != null) {
        if (!this.foodHosts) this.foodHosts = [];
        this.foodHosts.push({
          x, floorY, floorId, key, surfaceH: SURFACE_HOSTS[key],
        });
      }
      return this.add.image(x, floorY, key)
        .setScale(scale)
        .setOrigin(0.5, 1)
        .setDepth(depth);
    }

    /** Place Pixel Platter food as an interactable snack (NPCs + E to eat). */
    placeFood(key, x, floorY, depth = 25, scale = FOOD_SCALE, floorId = null) {
      if (!key || !this.textures.exists(key)) {
        this._missingAssets?.add?.(key || 'food');
        return null;
      }
      const sprite = this.add.image(x, floorY, key)
        .setScale(scale)
        .setOrigin(0.5, 1)
        .setDepth(depth);
      this.foods.push({
        x, floorY, floorId, key, radius: 22, sprite, baseY: floorY, baseScale: scale,
      });
      return sprite;
    }

    /** Put real food sprites on every table/counter that still looks empty. */
    seedFoodOnAllTables() {
      const hosts = this.foodHosts || [];
      if (!hosts.length) {
        console.info('[map] no food hosts (tables/counters) to dress');
        return;
      }
      let seeded = 0;
      hosts.forEach((h, i) => {
        const plateY = h.floorY - (h.surfaceH || 12);
        const has = (this.foods || []).some((f) => (
          Math.abs(f.x - h.x) < 20
          && Math.abs((f.floorY || 0) - plateY) < 14
        ));
        if (has) return;
        const n = (h.key === 'tableLong' || h.key === 'counter' || h.key === 'counterEnd') ? 2 : 1;
        for (let k = 0; k < n; k += 1) {
          const fk = seededPick(hashSeed(`${h.x}:${h.key}`), FOOD_KEYS, i * 13 + k * 5);
          this.placeFood(
            fk,
            h.x + (k === 0 ? -5 : 7),
            plateY,
            25,
            FOOD_SCALE,
            h.floorId || null,
          );
          seeded += 1;
        }
      });
      console.info(`[map] food sprites: ${this.foods.length} total (seeded +${seeded} on tables)`);
    }

    nearestFoodFor(actor) {
      if (!actor?.sprite) return null;
      let best = null;
      let bestD = 1e9;
      const ax = actor.sprite.x;
      const ay = actor.floorY ?? actor.sprite.y;
      for (const f of this.foods || []) {
        if (!f.sprite?.active || f.eaten || f.eating) continue;
        const sameRoom = f.floorId && actor.roomKey && f.floorId === actor.roomKey ? 0 : 90;
        const d = Math.abs(f.x - ax) + Math.abs((f.floorY || ay) - ay) * 0.4 + sameRoom;
        if (d < bestD) { bestD = d; best = f; }
      }
      return best;
    }

    /**
     * Walk to a real Pixel Platter plate and eat it (eat pose + food bob).
     */
    /**
     * Bite sequence on a food sprite: shrink in steps, vanish on the last
     * bite, respawn ~45-65s later. Returns the meal duration in ms. A food
     * already being eaten just returns the duration (no double-shrink).
     */
    eatFoodBites(food, bites = 3, biteMs = 650) {
      const total = bites * biteMs;
      if (!food?.sprite?.active || food.eating || food.eaten) return total;
      food.eating = true;
      const baseY = food.baseY != null ? food.baseY : food.sprite.y;
      const baseSc = food.baseScale != null ? food.baseScale : food.sprite.scaleX;
      try { this.tweens.killTweensOf(food.sprite); } catch (_) { /* ignore */ }
      food.sprite.y = baseY;
      food.sprite.setScale(baseSc);
      for (let b = 1; b <= bites; b += 1) {
        this.time.delayedCall(biteMs * b, () => {
          if (!food.sprite?.active) return;
          if (b < bites) {
            const s = baseSc * (1 - (b / bites) * 0.6);
            food.sprite.setScale(s);
            this.tweens.add({
              targets: food.sprite,
              scaleX: s * 0.82,
              duration: 90,
              yoyo: true,
              ease: 'Sine.easeInOut',
            });
          } else {
            food.sprite.setVisible(false);
            food.eaten = true;
            this.time.delayedCall(45000 + Math.random() * 20000, () => {
              if (!food.sprite?.active) return;
              food.sprite.setVisible(true).setScale(baseSc);
              food.sprite.y = baseY;
              food.eaten = false;
              food.eating = false;
            });
          }
        });
      }
      return total;
    }

    actorEatFood(actor, food, onDone) {
      if (!actor?.sprite?.active || !food) {
        if (typeof onDone === 'function') onDone();
        return;
      }
      const eatHere = () => {
        if (!actor?.sprite?.active) return;
        if (!actor.seated) {
          // Stand BESIDE the plate (not on it) and face it.
          const side = actor.sprite.x <= food.x ? -1 : 1;
          actor.sprite.x = food.x + side * 13;
          const fl = (food.floorId && this.getFloor(food.floorId))
            || this.findFloorAt(food.x, actor.floorY ?? actor.sprite.y);
          if (fl) {
            actor.floorY = fl.floorY;
            actor.sprite.y = fl.floorY;
            actor.roomKey = fl.roomKey || fl.id || actor.roomKey;
          }
        }
        actor.sprite.setFlipX(food.x < actor.sprite.x);
        const pose = actor.seated ? 'eatSit' : 'eat';
        actor.state = 'eat';
        this.setActorBounce(actor, false);
        try { this.showEmote(actor.sprite, 'eat'); } catch (_) { /* ignore */ }
        // The food shrinks bite by bite and vanishes; the chew loop holds
        // for the whole meal instead of one 2-frame nibble.
        const mealMs = this.eatFoodBites(food);
        this.playSheetPose(actor.sprite, actor.sheet, pose, {
          holdMs: mealMs,
          onDone: () => {
            if (!actor.sprite?.active) return;
            if (actor.seated) {
              this.playSheetPose(
                actor.sprite,
                actor.sheet,
                actor.seat?.kind === 'bed' ? 'lieIdle' : 'sitIdle',
              );
              actor.state = 'sit';
            } else {
              this.playSheetPose(actor.sprite, actor.sheet, 'idle');
              actor.state = 'idle';
            }
            if (typeof onDone === 'function') onDone();
          },
        });
        actor.busyUntil = this.time.now + mealMs + 400;
      };

      const dist = Math.abs(actor.sprite.x - food.x);
      const foodFloor = food.floorId ? this.getFloor(food.floorId) : null;
      const targetY = foodFloor?.floorY
        ?? (this.findFloorAt(food.x, food.floorY)?.floorY)
        ?? actor.floorY
        ?? actor.sprite.y;
      const sameBand = Math.abs((actor.floorY ?? actor.sprite.y) - targetY) < 28;
      if (dist > 14 || !sameBand) {
        this.actorNavigateTo(
          actor,
          food.x,
          targetY,
          eatHere,
          20,
          food.floorId || foodFloor?.id || null,
        );
      } else {
        eatHere();
      }
    }

    /**
     * Inter-floor climb — framed pack door OR Pixel Spaces elevator (theme climbMode).
     * @returns {number} door center x (use for stairs / interaction)
     */
    markClimbDoor(preferredX, floorId, doorKind = 'wood', climbMode = 'door') {
      const floor = this.floors.get(floorId);
      if (!floor) return preferredX;

      const useElev = climbMode === 'elev'
        && this.textures.exists('elevClosed')
        && this.textures.exists('elevOpen');

      if (useElev) {
        const sc = SCALE;
        const src = doorTexSize(this, 'elevClosed');
        const leafW = src.w * sc;
        const leafH = src.h * sc;
        const jamb = 3;
        const lintelH = 4;
        const frameW = leafW + jamb * 2;
        const frameH = leafH + 4;
        const edgePad = floor.isRoof ? frameW / 2 + 10 : frameW / 2 + 4;
        let cx = preferredX;
        if (floor.minX != null) cx = Math.max(cx, floor.minX + edgePad);
        if (floor.maxX != null) cx = Math.min(cx, floor.maxX - edgePad);
        // Keep elevators in the left climb lane — never clamp into the right wall.
        if (floor.minX != null && floor.maxX != null) {
          const mid = (floor.minX + floor.maxX) / 2;
          if (preferredX <= mid + 8) {
            cx = Math.min(cx, mid - edgePad);
          }
        }
        if (floor.isRoof) return cx;

        const doorBottomY = floor.floorY - 2;
        const fx = Math.round(cx - frameW / 2);
        const fy = Math.round(doorBottomY - frameH);

        // Shaft alcove so the elev reads as built-in cabin, not a floating slab.
        const g = this.add.graphics().setDepth(21.2);
        g.fillStyle(0x1e2830, 1);
        g.fillRect(fx - 2, fy - lintelH, frameW + 4, lintelH);
        g.fillStyle(0x0a0c10, 1);
        g.fillRect(fx, fy, frameW, frameH);
        g.fillStyle(0x3a4550, 1);
        g.fillRect(fx, fy, jamb, frameH);
        g.fillRect(fx + frameW - jamb, fy, jamb, frameH);
        g.fillStyle(0x2a3038, 1);
        g.fillRect(fx - 1, doorBottomY - 2, frameW + 2, 2);
        g.lineStyle(1, 0x0a0806, 0.9);
        g.strokeRect(fx, fy, frameW, frameH);

        const img = this.add.image(cx, doorBottomY, 'elevClosed')
          .setOrigin(0.5, 1)
          .setScale(sc)
          .setDepth(21.5);
        if (!this.elevatorDoors) this.elevatorDoors = [];
        this.elevatorDoors.push({
          x: cx,
          interactX: preferredX,
          floorId,
          img,
          closedKey: 'elevClosed',
          openKey: this.textures.exists('elevOpen') ? 'elevOpen' : 'elevClosed',
          slightKey: this.textures.exists('elevSlightly') ? 'elevSlightly' : null,
          isOpen: false,
          openRadius: 26,
          closeRadius: 38,
        });
        return cx;
      }

      this.ensureFrontDoorTextures();
      const fam = doorFamilyFor(doorKind);
      let openKey = fam.openKey;
      if (!this.textures.exists(openKey)) openKey = 'doorFrontClosed';

      const sc = SCALE;
      const src = doorTexSize(this, openKey);
      const leafW = src.w * sc;
      const leafH = src.h * sc;
      const jamb = 2;
      const lintelH = 3;
      const frameW = leafW + jamb * 2;
      const frameH = leafH + 2;

      const edgePad = floor.isRoof ? frameW / 2 + 10 : frameW / 2;
      let cx = preferredX;
      if (floor.minX != null) cx = Math.max(cx, floor.minX + edgePad);
      if (floor.maxX != null) cx = Math.min(cx, floor.maxX - edgePad);
      if (floor.isRoof) return cx;

      const doorBottomY = floor.floorY - 2;
      const fx = Math.round(cx - frameW / 2);
      const fy = Math.round(doorBottomY - frameH);

      const g = this.add.graphics().setDepth(21.2);
      g.fillStyle(0x3a2e22, 1);
      g.fillRect(fx - 1, fy - lintelH, frameW + 2, lintelH);
      g.fillStyle(0x0c0a08, 1);
      g.fillRect(fx, fy, frameW, frameH);
      g.fillStyle(0x4a3a2a, 1);
      g.fillRect(fx, fy, jamb, frameH);
      g.fillRect(fx + frameW - jamb, fy, jamb, frameH);
      g.fillStyle(0x1a1510, 1);
      g.fillRect(fx + jamb, fy + 1, frameW - jamb * 2, frameH - 2);
      g.lineStyle(1, 0x0a0806, 0.9);
      g.strokeRect(fx, fy, frameW, frameH);

      const hingeX = fx + jamb;
      const leaf = this.add.image(hingeX, doorBottomY, openKey)
        .setOrigin(0, 1)
        .setScale(sc, sc)
        .setDepth(21.5);

      this.autoDoors.push({
        x: cx,
        interactX: preferredX,
        kind: fam.family,
        mode: 'swing',
        indoor: true,
        floorId,
        leaf,
        closedKey: openKey,
        openKey,
        swapTexture: false,
        baseScale: sc,
        openScaleX: sc * 0.18,
        openRadius: 24,
        closeRadius: 34,
        isOpen: false,
        animating: false,
      });
      return cx;
    }

    /** @deprecated use markClimbDoor — kept so older call sites don't break */
    markStairs(x, floorId) {
      return this.markClimbDoor(x, floorId);
    }

    /** Place wall-mounted decor hanging from the room's top edge (origin top-center). */
    wallDecor(key, x, topY, depth = 21, scale = SCALE) {
      if (!this.textures.exists(key)) return null;
      return this.add.image(x, topY, key)
        .setScale(scale)
        .setOrigin(0.5, 0)
        .setDepth(depth);
    }

    /** Wall color for a room — `,room color` override, else deterministic. */
    roomWallColor(roomKey, channelId = null) {
      const id = channelId != null
        ? String(channelId)
        : String(roomKey || '').replace(/^ch_/, '');
      const ov = this.roomOverrides?.[id];
      if (ov?.color) {
        const raw = String(ov.color).trim().toLowerCase().replace(/^#/, '');
        if (ROOM_COLOR_BY_NAME[raw] != null) return ROOM_COLOR_BY_NAME[raw];
        if (/^[0-9a-f]{6}$/i.test(raw)) return parseInt(raw, 16);
      }
      return ROOM_WALL_COLORS[hashSeed(roomKey) % ROOM_WALL_COLORS.length];
    }

    /**
     * Decorate a room with a channel-THEMED furniture kit.
     * Left climb band empty; footprint packing; surface props on desks only.
     * Small rooms get fewer pieces so layouts stay readable.
     * @param {{ clearXf?: number, roomKey?: string }} [opts]
     */
    decorateRoom(ch, slotX, slotY, slotW, slotH, floorY, opts = {}) {
      const roomKey = opts.roomKey || chKey(ch.id);
      const seed = hashSeed(roomKey);
      const ov = this.roomOverrides?.[String(ch.id)];
      const kitName = (ov?.kit && KITS[ov.kit]) ? ov.kit : kitForChannel(ch.name, ch.type, seed);
      let kit = KITS[kitName] || KITS.lounge;
      // Tiny rooms: drop the last 1–2 props so nothing crams.
      if (slotW < 110) kit = kit.slice(0, Math.min(3, kit.length));
      else if (slotW < 140) kit = kit.slice(0, Math.min(4, kit.length));

      // Climb-door lane: ajar pack leaf (~13×SCALE) + frame jambs — furniture
      // must start clear of the frame's right edge.
      const climbLeafW = 13 * SCALE;
      const climbFramePad = 6;
      const doorLaneRight = slotX + Math.max(20, slotW * 0.2) + climbLeafW / 2 + climbFramePad;
      const clearLeft = Math.max(slotX + Math.max(30, slotW * 0.24), doorLaneRight);
      const leftBound = clearLeft + 20;
      const rightBound = slotX + slotW - 10;
      const usable = Math.max(40, rightBound - leftBound);
      const placed = [];

      const halfW = (key, sc) => {
        try {
          if (!this.textures.exists(key)) return 12;
          const fr = this.textures.get(key).get();
          return Math.max(7, (fr.width * sc) / 2);
        } catch (_) {
          return 12;
        }
      };
      const collides = (x, hw) => placed.some((p) => Math.abs(p.x - x) < p.halfW + hw + 10);

      const floorItems = [];
      const surfaceItems = [];
      const wallItems = [];
      const foodItems = [];
      kit.forEach((item, idx) => {
        if (item.food || item.key === 'food') {
          foodItems.push({ item, key: seededPick(seed, FOOD_KEYS, idx * 9 + 2) });
          return;
        }
        const key = Array.isArray(item.key) ? seededPick(seed, item.key, idx * 7 + 1) : item.key;
        if (item.wall) wallItems.push({ item, key });
        else if (item.onSurface || SURFACE_PROPS.has(key) || item.offY) surfaceItems.push({ item, key });
        else floorItems.push({ item, key });
      });

      const occupants = Math.max(0, Number(opts.occupants) || 0);
      // Quiet big rooms get extra dressing so the space doesn't feel bare…
      if (slotW >= 170 && occupants <= 3) {
        const lampKey = seededPick(seed, ['lamp', 'lamp2', 'lamp3'], 5);
        const plantKey = seededPick(seed, ['floraFern', 'floraAloe', 'floraSnake'], 6);
        floorItems.push({ item: { key: lampKey, xf: 0.30, depth: 22 }, key: lampKey });
        floorItems.push({ item: { key: plantKey, xf: 0.97, depth: 24 }, key: plantKey });
      }
      // …a mid-size crowd gets an extra seat pulled up…
      if (occupants >= 3 && occupants <= 5 && slotW >= 140) {
        const seatKey = seededPick(seed, ['stoolRed', 'stoolYellow', 'stoolBlue', 'stoolGreen'], 8);
        floorItems.push({ item: { key: seatKey, xf: 0.88, depth: 23, sit: true }, key: seatKey });
      }
      // …and a packed room clears the floor so people have room to stand.
      // Surfaces (tables/counters that host food) and wall decor stay.
      if (occupants >= 6) floorItems.splice(2);
      else if (occupants >= 4) floorItems.splice(3);

      // Evenly pack floor items across the usable band (after climb door).
      const n = floorItems.length || 1;
      floorItems.forEach(({ item, key }, i) => {
        const sc = SCALE * (item.scaleMul || 1);
        const hw = halfW(key, sc);
        // Ideal slot: spread evenly in usable width, biased by kit xf.
        const t = (i + 0.55) / n;
        const ideal = leftBound + t * usable;
        const prefer = leftBound + (item.xf - 0.22) / 0.78 * usable;
        let x = Phaser.Math.Clamp((ideal * 0.55 + prefer * 0.45), leftBound + hw, rightBound - hw);

        for (let tries = 0; tries < 14; tries += 1) {
          if (!collides(x, hw)) break;
          x += (tries % 2 === 0 ? 1 : -1) * (hw + 12) * Math.ceil((tries + 1) / 2);
          x = Phaser.Math.Clamp(x, leftBound + hw, rightBound - hw);
        }
        if (collides(x, hw)) return; // skip rather than stack

        this.furn(key, x, floorY, item.depth || 23, sc, roomKey);
        placed.push({ x, halfW: hw, key, surfaceH: SURFACE_HOSTS[key] || 0 });
      });

      // Surface props glued to nearest desk/table
      surfaceItems.forEach(({ item, key }) => {
        const sc = SCALE * (item.scaleMul || 1);
        const host = placed
          .filter((p) => p.surfaceH > 0)
          .sort((a, b) => Math.abs(a.x - (slotX + item.xf * slotW)) - Math.abs(b.x - (slotX + item.xf * slotW)))[0];
        if (!host) return;
        this.furn(key, host.x, floorY - host.surfaceH, item.depth || 24, sc, roomKey);
      });

      // Food on tables/counters (Pixel Platter)
      foodItems.forEach(({ item, key }, fi) => {
        const host = placed
          .filter((p) => p.surfaceH > 0 && FOOD_HOST_KEYS.has(p.key))
          .sort((a, b) => Math.abs(a.x - (slotX + item.xf * slotW)) - Math.abs(b.x - (slotX + item.xf * slotW)))[0]
          || placed.find((p) => p.surfaceH > 0);
        if (!host) return;
        this.placeFood(key, host.x + (fi % 2 ? 3 : -3), floorY - host.surfaceH, item.depth || 25, FOOD_SCALE, roomKey);
      });

      // Room plaque owns the top-left band: wide rooms push wall decor right
      // of it; narrow rooms drop decor a band lower instead.
      const plaqueGuard = slotW < 160 ? 0 : Math.min(slotW * 0.55, 178);
      const wallBandY = slotY + (slotW < 160 ? 28 : 8);
      // Wall decor keeps its own occupancy list (the floor `collides` check
      // doesn't apply up here). Seed it with the plaque zone so nothing
      // straddles the tab, then skip — never stack — overlapping items.
      const wallPlaced = plaqueGuard > 0
        ? [{ x: slotX + plaqueGuard / 2, halfW: plaqueGuard / 2 }]
        : [];
      const wallFree = (x, hw) => !wallPlaced.some((p) => Math.abs(p.x - x) < p.halfW + hw + 6);
      wallItems.forEach(({ item, key }) => {
        const sc = SCALE * (item.scaleMul || 1);
        const hw = halfW(key, sc);
        const x = Phaser.Math.Clamp(
          slotX + Math.max(0.35, item.xf) * slotW,
          Math.max(leftBound + 8, slotX + plaqueGuard + (plaqueGuard > 0 ? hw + 8 : 0)),
          rightBound - 8,
        );
        if (!wallFree(x, hw)) return; // skip rather than stack
        this.wallDecor(key, x, wallBandY, item.depth || 21, sc);
        wallPlaced.push({ x, halfW: hw });
      });

      // One extra piece of wall decor max — window OR clipboard — and only
      // where it clears the plaque and any kit wall item already placed.
      if (slotH >= 72 && usable > 50) {
        const extraKey = seed % 2 === 0
          ? seededPick(seed, ['windowSq', 'windowCircle', 'windowGlass', 'windowSmall'], 11)
          : 'clipboard';
        const ehw = halfW(extraKey, SCALE);
        const wallX = Math.max(leftBound + usable * 0.55, slotX + plaqueGuard + (plaqueGuard > 0 ? ehw + 8 : 14));
        if (wallFree(wallX, ehw)) {
          this.wallDecor(extraKey, wallX, wallBandY + (seed % 2 === 0 ? 0 : 2), 21);
        }
      }
    }

    /** Side-profile doorway between left/right rooms (horizontal passage).
     *  Uses pack Door_*_closed edge-on leaf — NOT a front-facing double. */
    markPassageDoorway(x, floorY, roomH, doorKind = 'wood') {
      this.ensureFrontDoorTextures();
      const fam = doorFamilyFor(doorKind);
      let sideKey = fam.sideKey;
      if (!this.textures.exists(sideKey)) {
        sideKey = this.textures.exists('doorClosed') ? 'doorClosed' : 'doorFrontClosed';
      }
      const sc = SCALE;
      const src = doorTexSize(this, sideKey);
      // Native leaf size — side strips are ~5×22 → ~10×44 at SCALE 2.
      const leafW = Math.max(6, src.w * sc);
      const leafH = src.h * sc;
      // Narrow recess in the shared wall; height matches the leaf, not the room.
      const doorW = Math.max(10, leafW + 4);
      const doorH = Math.min(Math.max(leafH + 4, 42), Math.max(40, (roomH || 82) - 16));
      const top = floorY - doorH;

      const g = this.add.graphics().setDepth(20.8);
      // Soft wall opening (narrow — not a black shaft)
      g.fillStyle(0x0c0a08, 0.75);
      g.fillRect(x - doorW / 2, top, doorW, doorH);
      // Jambs + lintel
      g.fillStyle(0x2a2218, 1);
      g.fillRect(x - doorW / 2 - 2, top, 2, doorH);
      g.fillRect(x + doorW / 2, top, 2, doorH);
      g.fillStyle(0x3a2e22, 1);
      g.fillRect(x - doorW / 2 - 1, top - 3, doorW + 2, 3);
      g.fillStyle(0x2c2118, 1);
      g.fillRect(x - doorW / 2 - 1, floorY - 2, doorW + 2, 2);

      // Edge-on closed leaf at native pack scale (side profile)
      if (this.textures.exists(sideKey)) {
        this.add.image(x - 1, floorY - 1, sideKey)
          .setOrigin(0.5, 1)
          .setScale(sc, sc)
          .setDepth(20.9);
      }
    }

    /** Rooftop floor strip + rail so the roof reads as a walkable place. */
    markRooftopDeck(minX, maxX, floorY) {
      // In front of the shell (20) and roof cap tiles (20.5/21) — at 19 the
      // deck hid behind the facade, leaving the roof door floating in the sky.
      const g = this.add.graphics().setDepth(21.2);
      const w = maxX - minX;
      // Deck plank
      g.fillStyle(0x5a4a38, 1);
      g.fillRect(minX, floorY - 4, w, 6);
      g.fillStyle(0x3a3028, 1);
      g.fillRect(minX, floorY + 1, w, 2);
      // Low rail
      g.lineStyle(2, 0x2a241c, 1);
      g.strokeRect(minX, floorY - 18, w, 14);
      for (let x = minX + 8; x < maxX; x += 16) {
        g.fillStyle(0x3a342c, 1);
        g.fillRect(x, floorY - 16, 2, 12);
      }
      // Small "ROOF" tag — flush on the deck line at the right end, clear
      // of the left-lane climb door.
      this.add.text(maxX - 4, floorY - 3, 'ROOF', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#f8fafc',
        backgroundColor: '#0f172a',
        padding: { x: 4, y: 1 },
      }).setOrigin(1, 1).setDepth(28).setResolution(2).setAlpha(0.85);
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
      // Premades: 8×14 pose grid. Hospital staff: 5×3 (walk/idle/jump + aliases).
      [...NPC_SHEETS, ...HOSP_NPC_SHEETS, ...GHOST_NPC_SHEETS, ...THEMED_NPC_SHEETS, ...COSTUME_NPC_SHEETS].forEach((n) => {
        if (!this.textures.exists(n.key)) return;
        const cols = sheetColCount(n.key);
        const poseDefs = poseDefsForSheet(n.key);
        Object.entries(poseDefs).forEach(([pose, def]) => {
          const key = `${n.key}_${pose}`;
          if (this.anims.exists(key)) return;
          const base = def.row * cols + (def.frameOffset || 0);
          const start = base;
          const end = base + Math.max(0, def.frames - 1);
          let frames;
          if (def.frames === 1) {
            frames = [{ key: n.key, frame: start }];
          } else {
            frames = this.anims.generateFrameNumbers(n.key, { start, end });
          }
          if (!frames || !frames.length) return;
          this.anims.create({
            key,
            frames,
            frameRate: def.fps || 8,
            repeat: def.repeat != null ? def.repeat : 0,
          });
        });
      });
      // Slice each pet cell into its own canvas texture so setTexture always swaps art.
      // (Spritesheet setFrame was effectively a no-op / too subtle in practice.)
      this.buildPetCellTextures();
    }

    /**
     * Assert Pixel Platter foods + emote/eat poses load — logs missing keys once.
     */
    verifyMapSocialAssets() {
      const missingFood = FOOD_KEYS.filter((k) => !this.textures.exists(k));
      if (missingFood.length) {
        console.warn('[map] missing food textures:', missingFood.join(', '));
        missingFood.forEach((k) => this._missingAssets?.add?.(k));
      }
      const socialPoses = ['wave', 'shrug', 'snicker', 'jump', 'hurt', 'eat', 'eatSit'];
      const sheets = NPC_SHEETS.filter((n) => this.textures.exists(n.key));
      if (!sheets.length) {
        console.warn('[map] no NPC sheets loaded — reaction emotes/eat poses unavailable');
        return;
      }
      const sample = sheets[0].key;
      const missingPoses = socialPoses.filter((pose) => !this.anims.exists(`${sample}_${pose}`));
      if (missingPoses.length) {
        console.warn('[map] missing NPC pose anims on', sample, ':', missingPoses.join(', '));
      }
    }

    /**
     * Cut 32×32 cells out of pet sheets into `petDog_c0` … `petDog_c31` (row0 walk).
     * This guarantees frame swaps are visible even if spritesheet frame indexing fails.
     */
    buildPetCellTextures() {
      PET_SHEETS.forEach((p) => {
        if (!this.textures.exists(p.key)) return;
        let src;
        try {
          src = this.textures.get(p.key).getSourceImage();
        } catch (_) {
          return;
        }
        if (!src) return;
        // Only need row 0 (32 cells) for walk/idle of free pack
        for (let i = 0; i < 32; i += 1) {
          const cellKey = `${p.key}_c${i}`;
          if (this.textures.exists(cellKey)) continue;
          const col = i % 32;
          const row = Math.floor(i / 32);
          const canvas = document.createElement('canvas');
          canvas.width = PET_FRAME;
          canvas.height = PET_FRAME;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            src,
            col * PET_FRAME,
            row * PET_FRAME,
            PET_FRAME,
            PET_FRAME,
            0,
            0,
            PET_FRAME,
            PET_FRAME,
          );
          this.textures.addCanvas(cellKey, canvas);
          try {
            this.textures.get(cellKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
          } catch (_) { /* ignore */ }
        }
      });
    }

    /** Show a specific cell of a pet sheet via dedicated canvas texture. */
    setPetCell(sprite, petKey, cellIndex) {
      if (!sprite?.active) return;
      const cellKey = `${petKey}_c${cellIndex}`;
      if (!this.textures.exists(cellKey)) {
        // Fallback to spritesheet frame
        try { sprite.setTexture(petKey, cellIndex); } catch (_) { /* ignore */ }
        return;
      }
      if (sprite.texture?.key !== cellKey) {
        sprite.setTexture(cellKey);
      }
    }

    /**
     * Time-based walk: while moving, hard-swap walk cells every ~90ms.
     * Uses SE/SW dirs (1/7) for horizontal travel — clearest leg motion on street.
     */
    petStep(sprite, petKey, dx, dy, groundY) {
      if (!sprite?.active) return;
      const moving = Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15;
      // Prefer 3/4 views for left/right — more obvious leg cycles than pure E/W
      let d;
      if (Math.abs(dx) >= Math.abs(dy)) d = dx >= 0 ? 1 : 7; // SE / SW
      else d = dy >= 0 ? 0 : 4; // S / N
      if (sprite._petDir !== d) {
        sprite._petDir = d;
        sprite._petStep = 0;
      }
      sprite.setFlipX(false);
      sprite._petKey = petKey;
      sprite._petMoving = moving;

      if (groundY != null) {
        // Plant feet; tiny hop on odd steps sells the walk
        const hop = moving && (sprite._petStep % 2 === 1) ? 1.2 : 0;
        sprite.y = groundY - hop;
      }

      const cycle = petWalkFrames(d);
      if (!moving) {
        this.setPetCell(sprite, petKey, cycle[0]);
        return;
      }
      // Time-based advance (not only distance) so legs always pump while gliding
      const now = this.time.now;
      if (!sprite._petNextStepAt) sprite._petNextStepAt = now;
      if (now >= sprite._petNextStepAt) {
        sprite._petStep = ((sprite._petStep || 0) + 1) % cycle.length;
        sprite._petNextStepAt = now + 90; // ~11 fps walk
      }
      this.setPetCell(sprite, petKey, cycle[sprite._petStep || 0]);
    }

    /**
     * Patrol: ALWAYS cycle walk cells on a timer while the patrol tween runs.
     * Uses dir0 (front) walk frames — clearest leg motion in the free pack.
     * Facing is flipped for left/right (free pack side views barely animate).
     */
    startPetPatrol(sprite, petKey, x0, x1, dur, groundY) {
      sprite._petStep = 0;
      sprite._petDir = 0; // front-facing walk cycle (most obvious legs)
      sprite._petPatrolling = true;
      sprite.setFlipX(false);
      this.setPetCell(sprite, petKey, petWalkFrames(0)[0]);
      sprite.y = groundY;

      // Hard timer — does not depend on tween dx (that was stuck on one frame)
      const ticker = this.time.addEvent({
        delay: 110,
        loop: true,
        callback: () => {
          if (!sprite.active) {
            try { ticker.remove(false); } catch (_) { /* ignore */ }
            return;
          }
          if (!sprite._petPatrolling) {
            this.setPetCell(sprite, petKey, petWalkFrames(0)[0]);
            sprite.y = groundY;
            return;
          }
          const cycle = petWalkFrames(0); // 0,1,2,1 — real leg change on free pack
          sprite._petStep = ((sprite._petStep || 0) + 1) % cycle.length;
          this.setPetCell(sprite, petKey, cycle[sprite._petStep]);
          const hop = (sprite._petStep % 2) ? 1.5 : 0;
          sprite.y = groundY - hop;
        },
      });
      sprite._petTicker = ticker;

      this.tweens.add({
        targets: sprite,
        x: x1,
        duration: dur,
        yoyo: true,
        repeat: -1,
        ease: 'Linear',
        onYoyo: () => { sprite.setFlipX(true); },
        onRepeat: () => { sprite.setFlipX(false); },
        onUpdate: () => {
          // keep planted even if something else moves y
          if (sprite.active && !sprite._petPatrolling) sprite.y = groundY;
        },
      });
    }

    /**
     * Play a named pose on any sprite using a sheet key.
     * Uses duration-based completion (reliable) instead of only animationcomplete.
     */
    playSheetPose(sprite, sheet, pose, opts = {}) {
      if (!sprite?.active || !sheet || !pose) return false;
      const key = `${sheet}_${pose}`;
      const poseDefs = poseDefsForSheet(sheet);
      const cols = sheetColCount(sheet);
      if (!this.anims.exists(key)) {
        // Lazy-create if sheet was loaded late
        if (this.textures.exists(sheet) && poseDefs[pose] && !sheet.startsWith('pet')) {
          const def = poseDefs[pose];
          const base = def.row * cols + (def.frameOffset || 0);
          const frames = def.frames === 1
            ? [{ key: sheet, frame: base }]
            : this.anims.generateFrameNumbers(sheet, { start: base, end: base + def.frames - 1 });
          if (frames?.length) {
            this.anims.create({
              key, frames, frameRate: def.fps || 8,
              repeat: def.repeat != null ? def.repeat : 0,
            });
          }
        }
        if (!this.anims.exists(key)) return false;
      }
      try {
        // Don't stop+restart looping walk/idle every frame — only switch keys
        const cur = sprite.anims.currentAnim?.key;
        if (cur === key && poseDefs[pose]?.loop) return true;
        sprite.anims.play(key, false);
      } catch (_) {
        return false;
      }
      const def = poseDefs[pose];
      const dur = opts.holdMs != null ? opts.holdMs : poseDurationMs(pose);
      const token = (sprite._poseToken = (sprite._poseToken || 0) + 1);
      if (sprite === this.player) {
        this._playerPose = pose;
        // Only hold the update() walk/idle driver for one-shot poses
        if (!def?.loop) this._poseHoldUntil = this.time.now + dur;
        else this._poseHoldUntil = 0;
      }
      if (typeof opts.onDone === 'function' && !def?.loop) {
        this.time.delayedCall(dur, () => {
          if (!sprite?.active || sprite._poseToken !== token) return;
          opts.onDone();
        });
      }
      return true;
    }

    /** Deterministic NPC sheet key for a user/seed, spread across all 30. */
    npcSheetFor(seedStr) {
      const s = String(seedStr || '');
      const fromList = (sheets) => {
        const list = sheets.filter((n) => this.textures.exists(n.key));
        return list.length ? list[hashSeed(s) % list.length].key : null;
      };
      if (/hospital-nurse|hosp-nurse|^nurse/i.test(s)) {
        const k = fromList(HOSP_NURSE_SHEETS);
        if (k) return k;
      }
      if (/hospital-surgeon|hosp-surgeon|^surgeon/i.test(s)) {
        const k = fromList(HOSP_SURGEON_SHEETS);
        if (k) return k;
      }
      // Halloween cast: real skeleton sheet + baked witch/mummy/vampire looks
      // (missing baked sheets fall through to civilians gracefully).
      if (/halloween-skeleton|^skeleton-/i.test(s) && this.textures.exists('skeletonNpc')) return 'skeletonNpc';
      if (/halloween-witch|^witch-/i.test(s) && this.textures.exists('witchNpc')) return 'witchNpc';
      if (/halloween-mummy|^mummy-/i.test(s) && this.textures.exists('mummyNpc')) return 'mummyNpc';
      if (/halloween-vampire|^vampire-/i.test(s) && this.textures.exists('vampireNpc')) return 'vampireNpc';
      // Themed staff wear their real pack uniforms ('-detainee'/'-visitor'
      // style seeds intentionally fall through to civilians).
      if (/police-cop|^cop-/i.test(s)) {
        const k = fromList(POLICE_NPC_SHEETS);
        if (k) return k;
      }
      if (/firefighter|^fire-crew/i.test(s)) {
        const k = fromList(FIRE_NPC_SHEETS);
        if (k) return k;
      }
      if (/barista/i.test(s)) {
        const k = fromList(CAFE_NPC_SHEETS);
        if (k) return k;
      }
      // Patients and everyone else use premade civilians
      const list = NPC_SHEETS.filter((n) => this.textures.exists(n.key));
      if (!list.length) return NPC_SHEETS[0].key;
      return list[hashSeed(s) % list.length].key;
    }

    /** Register pose anims for a dynamically loaded custom avatar sheet. */
    registerSheetAnims(sheetKey) {
      if (!sheetKey || !this.textures.exists(sheetKey)) return;
      Object.entries(NPC_POSE_DEFS).forEach(([pose, def]) => {
        const key = `${sheetKey}_${pose}`;
        if (this.anims.exists(key)) return;
        const base = def.row * NPC_COLS + (def.frameOffset || 0);
        const start = base;
        const end = base + Math.max(0, def.frames - 1);
        let frames;
        if (def.frames === 1) {
          frames = [{ key: sheetKey, frame: start }];
        } else {
          frames = this.anims.generateFrameNumbers(sheetKey, { start, end });
        }
        if (!frames || !frames.length) return;
        this.anims.create({
          key,
          frames,
          frameRate: def.fps || 8,
          repeat: def.repeat != null ? def.repeat : 0,
        });
      });
    }

    /**
     * Load a baked Discord closet sheet (256×448 / 32×32 cells). Falls back to null on 404.
     * @returns {Promise<string|null>} texture key
     */
    ensureCustomSheet(userId, sheetUrl, rev) {
      if (!sheetUrl || !userId) return Promise.resolve(null);
      const key = `custom_${userId}_v${rev || 1}`;
      // A bad texture/anim registration must degrade to "no custom sheet",
      // never throw into applyPresence and take the whole map tick down.
      try {
        if (this.textures.exists(key)) {
          this.registerSheetAnims(key);
          return Promise.resolve(key);
        }
      } catch (_) { return Promise.resolve(null); }
      if (!this._sheetLoading) this._sheetLoading = new Map();
      if (this._sheetLoading.has(key)) return this._sheetLoading.get(key);
      // Negative cache: a failed load (404 / corrupt PNG) stays failed for a
      // few minutes instead of re-fetching on every 1.5s presence poll.
      if (!this._sheetFailedAt) this._sheetFailedAt = new Map();
      const failedAt = this._sheetFailedAt.get(key);
      if (failedAt && Date.now() - failedAt < 5 * 60 * 1000) return Promise.resolve(null);

      const url = /^https?:\/\//i.test(sheetUrl)
        ? sheetUrl
        : `${location.origin}${sheetUrl.startsWith('/') ? '' : '/'}${sheetUrl}`;

      const promise = new Promise((resolve) => {
        let settled = false;
        let onComplete = null;
        let onError = null;
        const done = (val) => {
          if (settled) return;
          settled = true;
          this._sheetLoading.delete(key);
          // Detach both listeners — a once() that never fires (404) leaks one
          // stale listener per failed attempt on the persistent LoaderPlugin.
          try { if (onComplete) this.load.off(`filecomplete-spritesheet-${key}`, onComplete); } catch (_) { /* ignore */ }
          try { if (onError) this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError); } catch (_) { /* ignore */ }
          if (val) this._sheetFailedAt.delete(key);
          else this._sheetFailedAt.set(key, Date.now());
          resolve(val);
        };
        try {
          this.load.spritesheet(key, url, { frameWidth: NPC_FRAME.w, frameHeight: NPC_FRAME.h });
          onComplete = () => {
            try {
              if (this.textures.exists(key)) {
                this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
                this.registerSheetAnims(key);
                done(key);
                return;
              }
            } catch (_) { /* fall through */ }
            done(null);
          };
          onError = (file) => {
            if (file?.key === key) done(null);
          };
          this.load.once(`filecomplete-spritesheet-${key}`, onComplete);
          this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
          this.load.start();
          // Safety timeout if neither event fires
          setTimeout(() => done(this.textures.exists(key) ? key : null), 8000);
        } catch (_) {
          done(null);
        }
      });
      this._sheetLoading.set(key, promise);
      return promise;
    }

    applyLiveSheet(live, sheetKey, pose = 'idle') {
      if (!live?.sprite?.active || !sheetKey || !this.textures.exists(sheetKey)) return;
      if (live.sheet === sheetKey) return;
      live.sheet = sheetKey;
      if (live.actor) live.actor.sheet = sheetKey;
      try {
        live.sprite.setTexture(sheetKey, 0);
        this.playSheetPose(live.sprite, sheetKey, pose);
      } catch (_) { /* ignore */ }
    }

    maybeUpgradeLiveSheet(live, person) {
      const sheetUrl = person?.sheetUrl || person?.avatar?.sheetUrl;
      if (!sheetUrl || !live) return;
      const rev = person.avatarRev || person?.avatar?.rev || 1;
      this.ensureCustomSheet(person.userId, sheetUrl, rev).then((key) => {
        if (key) this.applyLiveSheet(live, key, 'idle');
      });
    }

    /** Spectral hover for ghost avatars: translucent + a gentle origin bob so
     *  the drawn sprite floats above its anchor without fighting the movement
     *  system (x/y stay owned by walk/ambient logic; nameplates stay put).
     *  The bob itself is driven per-tick from the live-chrome loop — a tween
     *  on the sprite would be killed by killTweensOf() whenever they walk. */
    applyGhostFloat(live, person) {
      live.isGhost = person?.avatar?.premade === 'ghost';
    }

    tickGhostFloat(live) {
      if (!live?.isGhost || !live.sprite?.active) return;
      const base = live.sprite.height * NPC_FOOT_ORIGIN_Y;
      // ~1.6s sine bob, ±2.5 source px (×SCALE on screen), lifted slightly so
      // the ghost hovers just off the floor line.
      live.sprite.displayOriginY = base + 1.5 + Math.sin(this.time.now / 260) * 2.5;
    }

    spawnChar(x, y, sheet, idle, label, depth = 30, opts = {}) {
      const sp = this.add.sprite(x, y, sheet, 0)
        .setScale(SCALE)
        .setOrigin(0.5, NPC_FOOT_ORIGIN_Y)
        .setDepth(depth);
      // idle arg may be full key `npc_m1_idle` or pose name
      const poseName = (idle && idle.includes('_'))
        ? idle.slice(sheet.length + 1)
        : (idle || 'idle');
      this.playSheetPose(sp, sheet, poseName);
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
      this.registerAmbient(sp, sheet, {
        roomKey: opts.roomKey || null,
        mode: opts.mode || 'idle',
        homeX: x,
        homeY: y,
        floorY: y,
        depth,
      });
      return sp;
    }

    registerAmbient(sprite, sheet, opts = {}) {
      if (!sprite || !sheet) return null;
      const actor = {
        sprite,
        sheet,
        roomKey: opts.roomKey || null,
        busyUntil: 0,
        mode: opts.mode || 'idle', // idle | stroll | life
        homeX: opts.homeX != null ? opts.homeX : sprite.x,
        homeY: opts.homeY != null ? opts.homeY : sprite.y,
        floorY: opts.floorY != null ? opts.floorY : sprite.y,
        depth: opts.depth != null ? opts.depth : sprite.depth,
        state: 'idle', // idle | walk | sit | eat | social
        seated: false,
        seat: null,
        nextThink: 0,
        bounceTween: null,
      };
      // No idle bob for life residents — it fights sit/lie placement and looks floaty.
      // Tiny bob only for anonymous street extras.
      if (actor.mode !== 'stroll' && actor.mode !== 'life') {
        actor.bounceTween = this.tweens.add({
          targets: sprite,
          y: actor.floorY - 0.8,
          duration: 1100 + Math.random() * 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      this.ambientActors.push(actor);
      return actor;
    }

    dropAmbient(sprite) {
      if (!sprite || !this.ambientActors) return;
      const a = this.ambientActors.find((x) => x.sprite === sprite);
      if (a?.bounceTween) {
        try { a.bounceTween.stop(); } catch (_) { /* ignore */ }
      }
      this.ambientActors = this.ambientActors.filter((x) => x.sprite !== sprite);
    }

    setActorBounce(actor, on) {
      if (!actor) return;
      if (on) {
        if (actor.bounceTween) return;
        actor.bounceTween = this.tweens.add({
          targets: actor.sprite,
          y: (actor.floorY || actor.sprite.y) - 1.2,
          duration: 900 + Math.random() * 400,
          yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      } else if (actor.bounceTween) {
        try { actor.bounceTween.stop(); } catch (_) { /* ignore */ }
        actor.bounceTween = null;
        if (actor.sprite?.active && actor.floorY != null && !actor.seated) {
          actor.sprite.y = actor.floorY;
        }
      }
    }

    /**
     * Float a Pixel Spaces emote (or optional chat-bubble) above a sprite.
     * Matches pack design: emotes for feelings, bubbles for talk.
     */
    showEmote(sprite, pose, opts = {}) {
      if (!sprite?.active) return;
      const depth = (sprite.depth || 30) + 6;
      // Optional speech bubble behind the icon
      if (opts.bubble) {
        const bKey = opts.bubbleKey
          || CHAT_BUBBLE_KEYS[Math.floor(Math.random() * CHAT_BUBBLE_KEYS.length)];
        if (this.textures.exists(bKey)) {
          const bubble = this.add.image(sprite.x, sprite.y - 36, bKey)
            .setScale(SCALE * 1.15)
            .setDepth(depth)
            .setOrigin(0.5, 1);
          if (this.textures.exists('uiBubbleShadow')) {
            const sh = this.add.image(sprite.x + 2, sprite.y - 34, 'uiBubbleShadow')
              .setScale(SCALE * 1.15).setDepth(depth - 1).setOrigin(0.5, 1).setAlpha(0.45);
            this.tweens.add({
              targets: sh, y: sh.y - 14, alpha: 0, duration: 900, ease: 'Cubic.easeOut',
              onComplete: () => { try { sh.destroy(); } catch (_) { /* ignore */ } },
            });
          }
          this.tweens.add({
            targets: bubble, y: bubble.y - 14, alpha: 0, duration: 900, ease: 'Cubic.easeOut',
            onComplete: () => { try { bubble.destroy(); } catch (_) { /* ignore */ } },
          });
        }
      }
      const key = opts.emoteKey || emoteKeyForPose(pose);
      if (!this.textures.exists(key)) return;
      const e = this.add.image(sprite.x, sprite.y - (opts.bubble ? 48 : 34), key)
        .setScale(SCALE * (opts.scale || 1.15))
        .setDepth(depth + 1)
        .setOrigin(0.5, 1);
      this.tweens.add({
        targets: e, y: e.y - 18, alpha: 0, duration: 800, ease: 'Cubic.easeOut',
        onComplete: () => { try { e.destroy(); } catch (_) { /* ignore */ } },
      });
    }

    /** Brief chat bubble (no text) for social beats — pack-accurate. */
    showChatBubble(sprite, colorKey = 'uiBubbleWhite') {
      this.showEmote(sprite, 'social', { bubble: true, bubbleKey: colorKey, emoteKey: 'emoteHeart' });
    }

    /**
     * Brief text speech bubble over an ambient NPC's head (operation chatter,
     * etc.). One bubble per actor at a time; auto-fades. Anchored where the
     * actor stands (hospital staff are mostly parked, so it tracks fine).
     */
    actorSay(actor, text) {
      if (!actor?.sprite?.active || !text) return;
      if (actor._sayObj) { try { actor._sayObj.destroy(); } catch (_) { /* gone */ } actor._sayObj = null; }
      const sp = actor.sprite;
      const label = this.add.text(sp.x, sp.y - 42, String(text), {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '9px',
        color: '#123038',
        backgroundColor: '#eef6f2',
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5, 1).setDepth(62).setResolution(3);
      actor._sayObj = label;
      this.tweens.add({
        targets: label, y: label.y - 5, alpha: 0, delay: 1500, duration: 550,
        onComplete: () => { try { label.destroy(); } catch (_) { /* gone */ } if (actor._sayObj === label) actor._sayObj = null; },
      });
    }

    playAmbientPose(actor, pose, opts = {}) {
      if (!actor?.sprite?.active || !actor.sheet) return false;
      if (this.time.now < (actor.busyUntil || 0) && !opts.force) return false;
      const hold = opts.holdMs != null ? opts.holdMs : poseDurationMs(pose);
      actor.busyUntil = this.time.now + hold + 60;
      actor.state = pose;
      if (opts.emote !== false) this.showEmote(actor.sprite, pose);
      const resume = opts.resume
        || (actor.seated ? (actor.seat?.kind === 'bed' ? 'lieIdle' : 'sitIdle') : 'idle');
      return this.playSheetPose(actor.sprite, actor.sheet, pose, {
        holdMs: hold,
        onDone: () => {
          if (!actor.sprite?.active) return;
          if (typeof opts.onDone === 'function') {
            opts.onDone();
            return;
          }
          this.playSheetPose(actor.sprite, actor.sheet, resume);
          actor.state = actor.seated ? 'sit' : 'idle';
          if (!actor.seated) this.setActorBounce(actor, true);
        },
      });
    }

    /** Floor under a world point, or null if on the outdoor street. */
    findFloorAt(x, y) {
      let best = null;
      let bestD = 28;
      for (const f of this.floors?.values?.() || []) {
        if (f.isRoof) continue;
        if (x < (f.minX ?? 0) - 12 || x > (f.maxX ?? 0) + 12) continue;
        const d = Math.abs((f.floorY ?? 0) - y);
        if (d <= bestD) {
          bestD = d;
          best = f;
        }
      }
      return best;
    }

    isOutdoorY(y) {
      return Math.abs((y ?? 0) - this.groundY) <= 22;
    }

    /** Door that leads into a given floor id / roomKey (street entrances). */
    findDoorForFloor(floorId) {
      if (!floorId) return null;
      const doors = this.doors || [];
      let d = doors.find((x) => x.floorId === floorId);
      if (d) return d;
      // Some floors use roomKey as id
      for (const f of this.floors?.values?.() || []) {
        if ((f.id === floorId || f.roomKey === floorId) && f.id) {
          d = doors.find((x) => x.floorId === f.id || x.floorId === f.roomKey);
          if (d) return d;
        }
      }
      return null;
    }

    /** Stair linking two floors (either direction). */
    findStairBetween(fromId, toId) {
      if (!fromId || !toId) return null;
      return (this.stairs || []).find((s) => (
        (s.fromFloorId === fromId && s.toFloorId === toId)
        || (s.toFloorId === fromId && s.fromFloorId === toId)
      )) || null;
    }

    /** Floor record by id or roomKey. */
    getFloor(id) {
      if (!id || !this.floors) return null;
      return this.floors.get(id) || [...this.floors.values()].find((f) => f.roomKey === id) || null;
    }

    /**
     * Graph edges between outdoor (`__out`) and indoor floors.
     * Same rules as the player: street doors, stairs, horizontal passages.
     */
    buildNavEdges() {
      const edges = []; // { from, to, x, kind: 'door'|'stair'|'passage' }
      for (const d of this.doors || []) {
        const fl = this.getFloor(d.floorId);
        if (!fl) continue;
        edges.push({ from: '__out', to: fl.id, x: d.outdoorX ?? d.x, kind: 'door', door: d });
        edges.push({ from: fl.id, to: '__out', x: d.x, kind: 'door', door: d });
      }
      for (const s of this.stairs || []) {
        edges.push({ from: s.fromFloorId, to: s.toFloorId, x: s.x, kind: 'stair' });
        edges.push({ from: s.toFloorId, to: s.fromFloorId, x: s.x, kind: 'stair' });
      }
      for (const p of this.passages || []) {
        edges.push({ from: p.fromFloorId, to: p.toFloorId, x: p.x, kind: 'passage' });
        edges.push({ from: p.toFloorId, to: p.fromFloorId, x: p.x, kind: 'passage' });
      }
      return edges;
    }

    /**
     * BFS route: outdoor + floors via doors/stairs/passages.
     * Returns node ids from start to goal (inclusive), or null.
     */
    findNavNodePath(startId, goalId) {
      if (startId === goalId) return [startId];
      const edges = this.buildNavEdges();
      const adj = new Map();
      for (const e of edges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from).push(e);
      }
      const q = [startId];
      const prev = new Map([[startId, null]]);
      const prevEdge = new Map();
      while (q.length) {
        const cur = q.shift();
        for (const e of adj.get(cur) || []) {
          if (prev.has(e.to)) continue;
          prev.set(e.to, cur);
          prevEdge.set(e.to, e);
          if (e.to === goalId) {
            const nodes = [goalId];
            const used = [];
            let n = goalId;
            while (n !== startId) {
              used.push(prevEdge.get(n));
              n = prev.get(n);
              nodes.push(n);
            }
            nodes.reverse();
            used.reverse();
            return { nodes, edges: used };
          }
          q.push(e.to);
        }
      }
      return null;
    }

    clampToFloor(x, floor) {
      if (!floor) return x;
      return Phaser.Math.Clamp(x, (floor.minX ?? x) + 4, (floor.maxX ?? x) - 4);
    }

    /**
     * Build grounded waypoints so NPCs never walk at the wrong height in open air.
     * Player rules: street at groundY; enter via door; change floors via stairs/passages.
     */
    planActorPath(fromX, fromY, toX, toY, toFloorId = null) {
      const gy = this.groundY;
      let fromF = this.findFloorAt(fromX, fromY);
      // Prefer actor's known room if feet are near that floor line
      if (!fromF && toFloorId) {
        /* keep outdoor */
      }
      let toF = toFloorId ? this.getFloor(toFloorId) : this.findFloorAt(toX, toY);
      // Explicit outdoor target
      if (this.isOutdoorY(toY) && !toFloorId) toF = null;
      // If target coords are clearly on a floor, prefer that
      if (!toF && !this.isOutdoorY(toY)) {
        toF = this.findFloorAt(toX, toY);
      }

      const fromOut = !fromF || this.isOutdoorY(fromY);
      const toOut = !toF;
      const startId = fromOut ? '__out' : fromF.id;
      const goalId = toOut ? '__out' : toF.id;

      // Same outdoor strip
      if (fromOut && toOut) {
        return [{ x: toX, y: gy, roomKey: null }];
      }

      // Already on same indoor floor
      if (!fromOut && !toOut && fromF.id === toF.id) {
        return [{
          x: this.clampToFloor(toX, toF),
          y: toF.floorY,
          roomKey: toF.roomKey || toF.id,
        }];
      }

      const route = this.findNavNodePath(startId, goalId);
      if (!route) {
        // Fallback: if indoor→outdoor with no door graph, still don't float —
        // walk to current x then only warp at that x (never mid-street at indoor Y)
        if (!fromOut && toOut) {
          return [
            { x: fromX, y: fromF.floorY, roomKey: fromF.roomKey || fromF.id },
            { x: fromX, y: gy, roomKey: null, warp: true },
            { x: toX, y: gy, roomKey: null },
          ];
        }
        if (fromOut && !toOut) {
          // Walk to building x at street, then door warp
          const anyDoor = (this.doors || []).find((d) => this.getFloor(d.floorId)) || (this.doors || [])[0];
          if (anyDoor) {
            const df = this.getFloor(anyDoor.floorId) || toF;
            return [
              { x: anyDoor.outdoorX ?? anyDoor.x, y: gy, roomKey: null },
              {
                x: this.clampToFloor(anyDoor.x, df),
                y: df.floorY,
                roomKey: df.roomKey || df.id,
                warp: true,
              },
              {
                x: this.clampToFloor(toX, toF),
                y: toF.floorY,
                roomKey: toF.roomKey || toF.id,
                warp: df.id !== toF.id,
              },
            ];
          }
        }
        return [{
          x: toX,
          y: toOut ? gy : (toF?.floorY ?? toY),
          roomKey: toOut ? null : (toF?.roomKey || toF?.id || null),
          warp: true,
        }];
      }

      const path = [];
      let curX = fromX;
      let curY = fromOut ? gy : fromF.floorY;
      let curRoom = fromOut ? null : (fromF.roomKey || fromF.id);
      let curNode = startId;

      for (let i = 0; i < route.edges.length; i += 1) {
        const e = route.edges[i];
        const nextNode = e.to;
        const nextFloor = nextNode === '__out' ? null : this.getFloor(nextNode);
        const nextY = nextNode === '__out' ? gy : nextFloor.floorY;
        const nextRoom = nextNode === '__out' ? null : (nextFloor.roomKey || nextFloor.id);

        if (e.kind === 'door') {
          if (curNode === '__out') {
            // Street → walk to door, then enter
            path.push({ x: e.door.outdoorX ?? e.door.x, y: gy, roomKey: null });
            path.push({
              x: this.clampToFloor(e.door.x, nextFloor),
              y: nextY,
              roomKey: nextRoom,
              warp: true,
            });
            curX = this.clampToFloor(e.door.x, nextFloor);
          } else {
            // Indoor → walk to door, then exit to street
            const curFloor = this.getFloor(curNode);
            path.push({
              x: this.clampToFloor(e.door.x, curFloor),
              y: curY,
              roomKey: curRoom,
            });
            path.push({
              x: e.door.outdoorX ?? e.door.x,
              y: gy,
              roomKey: null,
              warp: true,
            });
            curX = e.door.outdoorX ?? e.door.x;
          }
        } else if (e.kind === 'stair') {
          // Walk to shaft on current floor, warp to other floor at same x
          path.push({ x: e.x, y: curY, roomKey: curRoom });
          path.push({ x: e.x, y: nextY, roomKey: nextRoom, warp: true });
          curX = e.x;
        } else if (e.kind === 'passage') {
          // Horizontal room link — walk to doorway, step through
          path.push({ x: e.x, y: curY, roomKey: curRoom });
          if (Math.abs(curY - nextY) > 4) {
            path.push({ x: e.x, y: nextY, roomKey: nextRoom, warp: true });
          } else {
            // Same height: cross a few px into the next room
            const into = nextFloor
              ? this.clampToFloor(e.x + (nextFloor.minX > e.x ? 10 : -10), nextFloor)
              : e.x;
            path.push({ x: into, y: nextY, roomKey: nextRoom });
          }
          curX = e.x;
        }

        curY = nextY;
        curRoom = nextRoom;
        curNode = nextNode;
      }

      // Final walk to target on goal floor / street
      if (toOut) {
        path.push({ x: toX, y: gy, roomKey: null });
      } else {
        path.push({
          x: this.clampToFloor(toX, toF),
          y: toF.floorY,
          roomKey: toF.roomKey || toF.id,
        });
      }
      return path;
    }

    /**
     * Walk along planned waypoints (doors/stairs/passages).
     * Y only changes on warp steps (door enter / stair climb) — never mid-air slides.
     */
    actorNavigateTo(actor, toX, toY, onArrive, speed = 22, toFloorId = null) {
      if (!actor?.sprite?.active) return;
      try { this.tweens.killTweensOf(actor.sprite); } catch (_) { /* ignore */ }
      this.setActorBounce(actor, false);
      actor.seated = false;
      actor.seat = null;
      actor.seatedY = null;
      const fromX = actor.sprite.x;
      const fromY = actor.floorY != null ? actor.floorY : actor.sprite.y;
      const path = this.planActorPath(fromX, fromY, toX, toY, toFloorId);
      actor._navQueue = path;
      actor._navOnArrive = onArrive;
      actor._navSpeed = speed;
      actor.state = 'walk';
      actor.busyUntil = this.time.now + 400;
      this._runNextNavStep(actor);
    }

    _runNextNavStep(actor) {
      if (!actor?.sprite?.active) return;
      const q = actor._navQueue || [];
      if (!q.length) {
        actor.state = 'idle';
        actor._navQueue = null;
        // Stay locked to current floor line
        if (actor.floorY != null) actor.sprite.y = actor.floorY;
        this.playSheetPose(actor.sprite, actor.sheet, 'idle');
        if (typeof actor._navOnArrive === 'function') {
          const cb = actor._navOnArrive;
          actor._navOnArrive = null;
          cb();
        }
        return;
      }
      const step = q.shift();
      actor._navQueue = q;

      // Warp = door enter / stair climb: Y change only at shaft/door x (like the player)
      if (step.warp) {
        actor.sprite.x = step.x;
        actor.sprite.y = step.y;
        actor.floorY = step.y;
        actor.roomKey = step.roomKey ?? null;
        actor.seated = false;
        actor.seatedY = null;
        actor.state = 'walk';
        this.playSheetPose(actor.sprite, actor.sheet, 'idle');
        actor.busyUntil = this.time.now + 200;
        this.time.delayedCall(140, () => this._runNextNavStep(actor));
        return;
      }

      // Horizontal walk on current floor line only. If path Y differs, walk
      // to step.x first, then warp Y there (same rule as doors/stairs).
      const segY = step.y;
      const curY = actor.floorY != null ? actor.floorY : actor.sprite.y;
      if (Math.abs(curY - segY) > 6) {
        this.actorWalkTo(actor, step.x, () => {
          actor.sprite.x = step.x;
          actor.sprite.y = segY;
          actor.floorY = segY;
          actor.roomKey = step.roomKey ?? actor.roomKey;
          actor.busyUntil = this.time.now + 160;
          this.time.delayedCall(120, () => this._runNextNavStep(actor));
        }, actor._navSpeed || 22);
        return;
      }
      this.actorWalkTo(actor, step.x, () => {
        actor.floorY = segY;
        actor.sprite.y = segY;
        actor.roomKey = step.roomKey ?? actor.roomKey;
        this._runNextNavStep(actor);
      }, actor._navSpeed || 22);
    }

    /** Walk on a single floor line (same Y). Prefer actorNavigateTo for multi-floor. */
    actorWalkTo(actor, x, onArrive, speed = 24) {
      if (!actor?.sprite?.active) return;
      try { this.tweens.killTweensOf(actor.sprite); } catch (_) { /* ignore */ }
      this.setActorBounce(actor, false);
      actor.seated = false;
      actor.seat = null;
      actor.seatedY = null;
      actor.state = 'walk';
      // Street extras always use groundY; life actors use their floorY
      let fy = actor.floorY != null ? actor.floorY : actor.sprite.y;
      if (actor.mode !== 'life' || actor.roomKey == null) {
        // Outdoor / street crowd
        if (this.isOutdoorY(fy) || actor.mode === 'stroll' || !actor.roomKey) {
          fy = this.groundY;
        }
      }
      actor.floorY = fy;
      actor.sprite.y = fy;
      actor.sprite.setFlipX(x < actor.sprite.x);
      this.playSheetPose(actor.sprite, actor.sheet, 'walk');
      const dist = Math.abs(x - actor.sprite.x);
      const spd = Math.max(16, Math.min(26, speed));
      const dur = Math.max(900, Math.round((dist / spd) * 1000));
      actor.busyUntil = this.time.now + dur + 100;
      this.tweens.add({
        targets: actor.sprite,
        x,
        duration: dur,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          if (actor.sprite?.active) actor.sprite.y = fy;
        },
        onComplete: () => {
          if (!actor.sprite?.active) return;
          actor.sprite.x = x;
          actor.sprite.y = fy;
          if (typeof onArrive === 'function') onArrive();
          else {
            this.playSheetPose(actor.sprite, actor.sheet, 'idle');
            actor.state = 'idle';
            if (actor.mode !== 'life') this.setActorBounce(actor, true);
          }
        },
      });
    }

    /**
     * Sit / lie on furniture with locked contact point.
     * Sit frames plant higher in the cell than walk/idle — use seatContactY()
     * and ease down from standing so it doesn't pop or float.
     */
    actorSitOn(actor, seat) {
      if (!actor?.sprite || !seat) return;
      this.setActorBounce(actor, false);
      try { this.tweens.killTweensOf(actor.sprite); } catch (_) { /* ignore */ }

      const isBed = seat.kind === 'bed';
      actor.floorY = seat.floorY;
      actor.roomKey = seat.floorId || actor.roomKey;
      const fromY = actor.sprite.y;
      const sitY = seatContactY(seat);

      actor.seated = true;
      actor.seat = seat;
      actor.seatedY = sitY;
      actor.state = 'sit';
      actor.sprite.x = seat.x;
      // Start at standing height, ease onto cushion with the sit frames
      actor.sprite.y = fromY;
      actor.sprite.setDepth(Math.max(actor.depth || 30, 32) + (isBed ? 0 : 2));

      const start = isBed ? 'lie' : 'sit';
      const idle = isBed ? 'lieIdle' : 'sitIdle';
      const settleMs = Math.max(280, poseDurationMs(start) - 40);
      this.tweens.add({
        targets: actor.sprite,
        y: sitY,
        duration: settleMs,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          if (actor.sprite?.active) actor.sprite.x = seat.x;
        },
      });
      this.playSheetPose(actor.sprite, actor.sheet, start, {
        onDone: () => {
          if (!actor.sprite?.active || !actor.seated) return;
          actor.sprite.x = seat.x;
          actor.sprite.y = sitY;
          actor.seatedY = sitY;
          this.playSheetPose(actor.sprite, actor.sheet, idle);
          actor.state = 'sit';
          if (actor.staySeated) {
            actor.busyUntil = Number.MAX_SAFE_INTEGER / 4;
            return;
          }
          const sitMs = 7000 + Math.random() * 6000;
          actor.busyUntil = this.time.now + sitMs;
          this.time.delayedCall(sitMs, () => {
            if (!actor.sprite?.active || !actor.seated || actor.staySeated) return;
            const food = (this.foods || []).find((f) => (
              Math.abs(f.x - actor.sprite.x) < 48
              && (!f.floorId || f.floorId === actor.roomKey || f.floorId === seat.floorId)
            ));
            if (food && !isBed && Math.random() < 0.55) {
              this.actorEatFood(actor, food, () => {
                if (!actor.seated) return;
                actor.sprite.y = sitY;
                this.playSheetPose(actor.sprite, actor.sheet, idle);
                this.time.delayedCall(2500, () => this.actorStandUp(actor));
              });
            } else {
              this.actorStandUp(actor);
            }
          });
        },
      });
      actor.busyUntil = this.time.now + poseDurationMs(start) + 80;
    }

    actorStandUp(actor) {
      if (!actor?.sprite?.active) return;
      const wasBed = actor.seat?.kind === 'bed';
      const fin = wasBed ? 'lieFinish' : 'sitFinish';
      const floorY = actor.floorY != null ? actor.floorY : actor.sprite.y;
      const fromY = actor.sprite.y;
      actor.seated = false;
      actor.seat = null;
      actor.seatedY = null;
      actor.sprite.setDepth(actor.depth || 30);
      // Rise with finish frames (don't hard-snap to floor)
      try { this.tweens.killTweensOf(actor.sprite); } catch (_) { /* ignore */ }
      this.tweens.add({
        targets: actor.sprite,
        y: floorY,
        duration: Math.max(260, poseDurationMs(fin) - 40),
        ease: 'Sine.easeOut',
      });
      this.playSheetPose(actor.sprite, actor.sheet, fin, {
        onDone: () => {
          if (!actor.sprite?.active) return;
          actor.sprite.y = floorY;
          this.playSheetPose(actor.sprite, actor.sheet, 'idle');
          actor.state = 'idle';
          actor.busyUntil = this.time.now + 2200 + Math.random() * 2500;
          if (actor.mode !== 'life') {
            this.setActorBounce(actor, true);
            this.time.delayedCall(2500 + Math.random() * 2000, () => {
              if (actor.sprite?.active && Math.random() < 0.45) this.actorPickWander(actor);
            });
          }
        },
      });
      actor.busyUntil = this.time.now + poseDurationMs(fin) + 80;
      void fromY;
    }

    actorPickWander(actor) {
      if (!actor?.sprite?.active || actor.seated) return;
      if (actor.role === 'nurse' || actor.role === 'surgeon') {
        this.parkHospitalStaff(actor);
        return;
      }
      if (actor.staySeated || actor.hospitalLive) return;
      // Prefer seat → food → home offset
      const seats = (this.seats || []).filter((s) => {
        if (s.kind === 'bed') return false; // beds are assigned by hospital roles / live claim
        if (actor.roomKey && s.floorId && s.floorId !== actor.roomKey) return false;
        if (!actor.roomKey && s.floorId) {
          // street NPCs: only outdoor-ish seats (bench) near ground
          return Math.abs((s.floorY || 0) - (actor.floorY || this.groundY)) < 12;
        }
        return Math.abs((s.floorY || 0) - (actor.floorY || 0)) < 14;
      });
      const foods = (this.foods || []).filter((f) => {
        if (actor.roomKey && f.floorId && f.floorId !== actor.roomKey) return false;
        return Math.abs((f.floorY || 0) - (actor.floorY || 0)) < 40;
      });

      const roll = Math.random();
      if (seats.length && roll < 0.42) {
        const seat = seats[Math.floor(Math.random() * seats.length)];
        this.actorWalkTo(actor, seat.x, () => this.actorSitOn(actor, seat));
        return;
      }
      if (foods.length && roll < 0.72) {
        const food = foods[Math.floor(Math.random() * foods.length)];
        this.actorEatFood(actor, food, () => {
          actor.state = 'idle';
          if (actor.mode !== 'life') this.setActorBounce(actor, true);
        });
        return;
      }
      // Pace near home (smaller steps = calmer pacing)
      const span = actor.roomKey ? 36 : 55;
      const tx = Phaser.Math.Clamp(
        actor.homeX + (Math.random() * 2 - 1) * span,
        actor.homeX - span,
        actor.homeX + span,
      );
      this.actorWalkTo(actor, tx, () => {
        const pose = ['wave', 'shrug', 'snicker', 'jump'][Math.floor(Math.random() * 4)];
        this.playAmbientPose(actor, pose, { force: true });
        actor.busyUntil = Math.max(actor.busyUntil || 0, this.time.now + 2000);
      }, 22);
    }

    startAmbientLoop() {
      if (this._ambientTimer) return;
      this._ambientPoseIdx = 0;
      this._ambientActorIdx = 0;
      // Slower brain tick — fewer simultaneous movers / less emote spam
      this._ambientTimer = this.time.addEvent({
        delay: 1700,
        loop: true,
        callback: () => this.tickAmbient(),
      });
      this.time.delayedCall(500, () => this.tickAmbient());
    }

    tickAmbient() {
      const now = this.time.now;
      const actors = (this.ambientActors || []).filter((a) => a.sprite?.active);
      if (!actors.length) return;

      // Social: pair waves in same room (less frantic)
      if (Math.random() < 0.14) {
        const byRoom = new Map();
        for (const a of actors) {
          if (!a.roomKey || a.seated || a.state === 'walk') continue;
          if (now < a.busyUntil) continue;
          if (!byRoom.has(a.roomKey)) byRoom.set(a.roomKey, []);
          byRoom.get(a.roomKey).push(a);
        }
        for (const group of byRoom.values()) {
          if (group.length < 2) continue;
          // pick closest pair
          let best = null;
          let bestD = 80;
          for (let i = 0; i < group.length; i += 1) {
            for (let j = i + 1; j < group.length; j += 1) {
              const d = Math.abs(group[i].sprite.x - group[j].sprite.x);
              if (d < bestD) { bestD = d; best = [group[i], group[j]]; }
            }
          }
          if (best) {
            const [a, b] = best;
            a.sprite.setFlipX(a.sprite.x > b.sprite.x);
            b.sprite.setFlipX(b.sprite.x > a.sprite.x);
            // Respect busyUntil — no force (cuts wave spam)
            this.playAmbientPose(a, 'wave');
            this.time.delayedCall(280, () => {
              this.playAmbientPose(b, Math.random() < 0.5 ? 'wave' : 'snicker');
            });
            break;
          }
        }
      }

      // Drive 1–2 free actors per tick (was 2–4 — felt like a stampede)
      const free = actors.filter((a) => now >= (a.busyUntil || 0) && a.state !== 'walk');
      const n = Math.min(free.length, 1 + (Math.random() < 0.35 ? 1 : 0));
      for (let k = 0; k < n; k += 1) {
        const actor = free[(this._ambientActorIdx + k) % free.length];
        if (!actor) break;
        this.thinkActor(actor);
      }
      this._ambientActorIdx += Math.max(1, n);
    }

    /** Per-NPC decision: wander / sit / eat / emote. */
    thinkActor(actor) {
      if (!actor?.sprite?.active) return;
      if (actor._displaced) return;

      // Hospital staff: bedside ward care, or scrub-team "operation" loop in the OR.
      if (actor.role === 'nurse' || actor.role === 'surgeon') {
        if (actor.seated) {
          this.actorStandUp(actor);
          this.parkHospitalStaff(actor);
          return;
        }
        const atOr = !!(actor.hospOpts?.onSurgery || actor.attendBed?.key === 'tableSurgery');
        const roll = Math.random();
        if (atOr) {
          // Occasional operation chatter so the team reads as talking to each other.
          if (Math.random() < 0.4) {
            const lines = OR_CHATTER[actor.role] || OR_CHATTER.surgeon;
            this.actorSay(actor, lines[Math.floor(Math.random() * lines.length)]);
          }
          // Operating theater: keep the scrub team busy around the patient.
          if (roll < 0.34) {
            // Lean / gesture over the table (jump≈reach on hospital sheets)
            this.playAmbientPose(actor, Math.random() < 0.55 ? 'jump' : 'wave');
            actor.busyUntil = Math.max(actor.busyUntil || 0, this.time.now + 1800);
          } else if (roll < 0.55 && actor.attendBed) {
            const bedX = actor.attendBed.x;
            const closer = bedX + (actor.sprite.x < bedX ? -10 : 10);
            const returnX = actor.homeX;
            this.actorWalkTo(actor, closer, () => {
              this.playAmbientPose(actor, 'jump');
              this.time.delayedCall(700 + Math.random() * 500, () => {
                if (!actor.sprite?.active || actor._displaced) return;
                this.actorWalkTo(actor, returnX, () => this.parkHospitalStaff(actor), 14);
              });
            }, 14);
          } else if (roll < 0.68 && actor.attendBed) {
            // Nurse checks saline / instruments, then returns
            const peekX = actor.attendBed.x + (Math.random() < 0.5 ? -42 : 42);
            const returnX = actor.homeX;
            this.actorWalkTo(actor, peekX, () => {
              this.time.delayedCall(600 + Math.random() * 700, () => {
                if (!actor.sprite?.active || actor._displaced) return;
                this.actorWalkTo(actor, returnX, () => this.parkHospitalStaff(actor), 14);
              });
            }, 14);
          } else {
            if (actor.homeX != null && Math.abs(actor.sprite.x - actor.homeX) > 6) {
              actor.sprite.x = actor.homeX;
              actor.sprite.y = actor.floorY;
              this.playSheetPose(actor.sprite, actor.sheet, 'idle');
            }
            actor.busyUntil = this.time.now + 1600 + Math.random() * 2200;
          }
          return;
        }
        if (roll < 0.12) {
          this.playAmbientPose(actor, Math.random() < 0.55 ? 'wave' : 'shrug');
          actor.busyUntil = Math.max(actor.busyUntil || 0, this.time.now + 2200);
        } else if (roll < 0.22 && actor.attendBed) {
          // Brief walk to check equipment then return to bedside
          const peekX = (actor.attendBed?.x || actor.homeX) + (Math.random() < 0.5 ? -36 : 36);
          const returnX = actor.homeX;
          this.actorWalkTo(actor, peekX, () => {
            this.time.delayedCall(900 + Math.random() * 800, () => {
              if (!actor.sprite?.active || actor._displaced) return;
              this.actorWalkTo(actor, returnX, () => {
                this.parkHospitalStaff(actor);
              }, 16);
            });
          }, 16);
        } else {
          // Re-anchor at bedside if they drifted
          if (actor.homeX != null && Math.abs(actor.sprite.x - actor.homeX) > 8) {
            actor.sprite.x = actor.homeX;
            actor.sprite.y = actor.floorY;
            this.playSheetPose(actor.sprite, actor.sheet, 'idle');
          }
          actor.busyUntil = this.time.now + 3500 + Math.random() * 4000;
        }
        return;
      }

      if (actor.staySeated) {
        if (actor.seated && Math.random() < 0.08) {
          this.playAmbientPose(actor, Math.random() < 0.5 ? 'snicker' : 'shrug', {
            resume: actor.seat?.kind === 'bed' ? 'lieIdle' : 'sitIdle',
          });
        }
        return;
      }
      if (actor.mode === 'stroll') {
        // Strollers briefly wave mid-pace (rarer)
        if (Math.random() < 0.1) {
          this.playSheetPose(actor.sprite, actor.sheet, 'wave');
          actor.busyUntil = this.time.now + poseDurationMs('wave');
          this.time.delayedCall(poseDurationMs('wave'), () => {
            if (actor.sprite?.active) this.playSheetPose(actor.sprite, actor.sheet, 'walk');
          });
        }
        return;
      }
      if (actor.seated) {
        // Occasional seated emote
        if (Math.random() < 0.12) {
          this.playAmbientPose(actor, Math.random() < 0.5 ? 'snicker' : 'shrug', {
            resume: actor.seat?.kind === 'bed' ? 'lieIdle' : 'sitIdle',
          });
        }
        return;
      }
      const roll = Math.random();
      // More idle emotes, fewer walks — calmer street
      if (roll < 0.28) {
        this.actorPickWander(actor);
      } else if (roll < 0.48) {
        const poses = ['wave', 'shrug', 'snicker', 'jump'];
        this.playAmbientPose(actor, poses[this._ambientPoseIdx % poses.length]);
        this._ambientPoseIdx += 1;
        actor.busyUntil = Math.max(actor.busyUntil || 0, this.time.now + 2200);
      } else {
        // Just chill — extend idle so they don't act next tick
        actor.busyUntil = this.time.now + 2800 + Math.random() * 3200;
      }
    }

    /** Street pets removed — paid companions only (see syncCompanionPets). */
    spawnPets() {
      this.pets = [];
      this.buildPetCellTextures();
    }

    syncCompanionPets(wantPeople) {
      if (!this.companionPets) this.companionPets = new Map();
      const want = new Map();
      for (const p of wantPeople || []) {
        const kind = p.pet?.kind === 'cat' ? 'petCat' : (p.pet?.kind === 'dog' ? 'petDog' : null);
        if (!kind) continue;
        if (!this.textures.exists(kind) && !this.textures.exists(`${kind}_c0`)) continue;
        want.set(String(p.userId), kind);
      }

      for (const [userId, entry] of [...this.companionPets.entries()]) {
        if (!want.has(userId)) {
          try { entry.sprite?.destroy?.(); } catch (_) { /* ignore */ }
          this.companionPets.delete(userId);
        }
      }

      for (const [userId, kind] of want) {
        let entry = this.companionPets.get(userId);
        const owner = this.livePeople?.get(userId);
        if (!owner?.sprite?.active) {
          if (entry) {
            try { entry.sprite?.destroy?.(); } catch (_) { /* ignore */ }
            this.companionPets.delete(userId);
          }
          continue;
        }
        if (!entry || entry.kind !== kind) {
          if (entry?.sprite) {
            try { entry.sprite.destroy(); } catch (_) { /* ignore */ }
          }
          this.buildPetCellTextures();
          const startCell = `${kind}_c${petWalkFrames(1)[0]}`;
          const texKey = this.textures.exists(startCell) ? startCell : kind;
          const ox = owner.sprite.x - 18;
          const oy = owner.sprite.y;
          const sp = this.add.sprite(ox, oy, texKey)
            .setScale(petScaleFor(kind))
            .setOrigin(0.5, PET_FOOT_ORIGIN_Y)
            .setDepth((owner.sprite.depth || 30) - 1);
          sp._petStep = 0;
          sp._petDir = 1;
          sp._petKey = kind;
          entry = { sprite: sp, kind };
          this.companionPets.set(userId, entry);
        }
        this.followCompanionPet(entry, owner);
      }
    }

    followCompanionPet(entry, ownerLive) {
      const sp = entry?.sprite;
      const owner = ownerLive?.sprite;
      if (!sp?.active || !owner?.active) return;
      const behind = owner.flipX ? 22 : -22;
      const tx = owner.x + behind;
      const ty = owner.y;
      const dx = tx - sp.x;
      const dy = ty - sp.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 2) {
        const step = Math.min(dist, 3.2);
        sp.x += (dx / dist) * step;
        sp.y += (dy / dist) * step;
        const dir = petDirFromDelta(dx, dy);
        sp._petDir = dir;
        sp._petStep = ((sp._petStep || 0) + 1) % PET_WALK_LEN;
        const frames = petWalkFrames(dir);
        const cell = `${entry.kind}_c${frames[sp._petStep]}`;
        if (this.textures.exists(cell)) sp.setTexture(cell);
      } else {
        const idle = `${entry.kind}_c${petIdleFrame(sp._petDir || 1)}`;
        if (this.textures.exists(idle)) sp.setTexture(idle);
      }
      sp.setDepth((owner.depth || 30) - 1);
    }

    buildHud(guildName = 'Discord', meta = {}) {
      const label = String(guildName || 'Discord').slice(0, 22);
      const ch = meta.channelCount != null ? meta.channelCount : (this.floors?.size || 0);
      const cats = meta.categoryCount != null ? meta.categoryCount : (this.buildings?.length || 0);
      const D = 500;

      // HUD lives in containers positioned by layoutHud() inside the SAFE
      // visible rect — ENVELOP scaling crops the design edges on wide/tall
      // hosts, so anything anchored to raw W/H falls half off-screen.
      const leftKids = [];
      leftKids.push(this.add.rectangle(88, 20, 176, 40, 0x0f172a, 0.82)
        .setStrokeStyle(1, 0x334155, 0.9));
      if (this.textures.exists('uiPerson')) {
        leftKids.push(this.add.image(14, 16, 'uiPerson').setScale(SCALE).setOrigin(0.5));
      }
      leftKids.push(this.add.text(28, 8, label, {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '12px', fontStyle: 'bold', color: '#f8fafc',
      }).setResolution(2));
      this._hudSub = this.add.text(28, 24, `${cats} blocks · ${ch} rooms`, {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '10px', color: '#94a3b8',
      }).setResolution(2);
      leftKids.push(this._hudSub);
      this._hudNeedRows = [];
      this._hudLeft = this.add.container(0, 0, leftKids)
        .setScrollFactor(0).setDepth(D);

      // Right slot reserved (no fake day clock / XP)
      this._clockText = this.add.text(0, 0, '', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#e2e8f0',
        backgroundColor: '#0f172acc',
        padding: { x: 8, y: 5 },
      }).setOrigin(1, 0).setResolution(2).setVisible(false);
      this._xpBar = null;
      this._hudRight = this.add.container(0, 0, [this._clockText])
        .setScrollFactor(0).setDepth(D + 1);

      // Event strip — thin glass bar (positioned + sized by layoutHud)
      this._eventLogBg = this.add.rectangle(W / 2, H - 16, W - 28, 24, 0x0f172a, 0.75)
        .setScrollFactor(0).setDepth(D).setOrigin(0.5).setVisible(false);
      this._eventLogText = this.add.text(18, H - 23, '', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '11px',
        color: '#cbd5e1',
      }).setScrollFactor(0).setDepth(D + 1).setResolution(2);

      this.layoutHud();
      this.scale.on('resize', () => this.layoutHud());

      // Player: soft bobbing pointer only (selection frames look like broken boxes when scaled)
      if (this.textures.exists('pointerGreen')) {
        this._playerPointer = this.add.image(0, 0, 'pointerGreen')
          .setScale(SCALE).setDepth(48).setOrigin(0.5, 1).setVisible(false);
      }
      this._playerSel = null;
    }

    /**
     * Position HUD containers inside the SAFE visible rect. ENVELOP scaling
     * covers the host and crops the design's edges when aspect ratios differ
     * (a 16:9 phone crops ~230px total off the 980px design width), and the
     * camera zoom crops further — compute both and inset the HUD.
     */
    layoutHud() {
      if (!this._hudLeft) return;
      const pw = this.scale?.parentSize?.width || window.innerWidth || W;
      const ph = this.scale?.parentSize?.height || window.innerHeight || H;
      const cover = Math.max(pw / W, ph / H) || 1;
      const z = this.cameras?.main?.zoom || 1;
      const visW = Math.min(W, pw / cover) / z;
      const visH = Math.min(H, ph / cover) / z;
      const ix = Math.max(0, (W - visW) / 2) + 10;
      const iy = Math.max(0, (H - visH) / 2) + 10;
      this._hudLeft.setPosition(ix, iy);
      if (this._hudRight) this._hudRight.setPosition(W - ix, iy);
      if (this._eventLogBg) {
        this._eventLogBg.setPosition(W / 2, H - iy - 6);
        this._eventLogBg.width = Math.max(120, visW - 28);
      }
      if (this._eventLogText) this._eventLogText.setPosition(ix + 8, H - iy - 13);
    }

    /** Soft green pointer above the name tag (not on top of it). */
    updatePlayerUiChrome() {
      if (!this.player?.active) return;
      if (!this._playerPointer?.active) return;
      // Name tag sits ~32px above feet; keep pointer well clear of it and enter hints
      const bob = Math.sin((this.time?.now || 0) / 320) * 2;
      this._playerPointer
        .setVisible(true)
        .setPosition(this.player.x, this.player.y - 56 + bob)
        .setAlpha(0.9);
    }

    /**
     * Life-sim chrome: one small status icon beside the name (not a stack of tags).
     * Only show when a need is pressured — calm faces stay clean.
     */
    syncResidentChrome(entry) {
      if (!entry?.sprite?.active || !entry.resident) return;
      const r = entry.resident;
      const sp = entry.sprite;
      const sx = sp.x;
      const sy = sp.y;
      const depth = (sp.depth || 36) + 3;

      // Hide the noisy text activity line — status icon replaces it
      if (entry.jobTag?.active) entry.jobTag.setVisible(false);

      const n = r.needs || {};
      const stressed = !r.alive
        || (n.hunger ?? 0) > 0.65
        || (n.energy ?? 1) < 0.35
        || (n.social ?? 0) > 0.78
        || (r.mood ?? 1) < 0.4;
      const iconKey = statusIconForResident(r);

      if (!stressed || !this.textures.exists(iconKey)) {
        if (entry.needIcon?.active) entry.needIcon.setVisible(false);
        return;
      }
      // Sit just left of name tag, not on top of it
      const ix = sx - 14;
      const iy = sy - 38;
      if (!entry.needIcon || !entry.needIcon.active) {
        entry.needIcon = this.add.image(ix, iy, iconKey)
          .setScale(SCALE).setDepth(depth).setOrigin(0.5, 1);
      } else {
        if (entry.needIcon.texture?.key !== iconKey) entry.needIcon.setTexture(iconKey);
        entry.needIcon.setPosition(ix, iy).setVisible(true);
      }
    }

    /** Refresh HUD need bars from average resident needs + day XP. */
    refreshHudNeeds() {
      if (!this.blockLife || !this._hudNeedRows?.length) return;
      const alive = this.blockLife.residents.filter((x) => x.alive);
      if (!alive.length) return;
      const avg = (fn) => alive.reduce((s, r) => s + fn(r), 0) / alive.length;
      const food = 1 - avg((r) => r.needs?.hunger ?? 0.5);
      const rest = avg((r) => r.needs?.energy ?? 0.5);
      const social = 1 - avg((r) => r.needs?.social ?? 0.5);
      const vals = [food, rest, social];
      this._hudNeedRows.forEach((row, i) => {
        const key = progressBarKey(row.color, vals[i] ?? 0.5);
        if (row.bar?.active && this.textures.exists(key)) row.bar.setTexture(key);
      });
      if (this._xpBar?.active) {
        const dayFrac = ((this.blockLife.hour || 0) + 1) / 24;
        const xk = xpBarKey(dayFrac);
        if (this.textures.exists(xk)) this._xpBar.setTexture(xk);
      }
    }

    // ——— Block life sim (named residents, needs, relationships, day/night) ———

    startBlockLife(layoutMeta = {}) {
      // Fake named neighbors (Mira/Pax/…) disabled — Discord-first map.
      return;
      if (typeof window.BlockLife === 'undefined' || !window.BlockLife.createWorld) {
        console.warn('[map] block-life.js not loaded — residents disabled');
        return;
      }
      const sheets = NPC_SHEETS.filter((n) => this.textures.exists(n.key)).map((n) => n.key);
      const roomKeys = [...(this.floors?.keys?.() || [])].filter((k) => !String(k).includes('placeholder') && !String(k).includes('roof'));
      const buildings = this.buildings || [];
      this.blockLife = window.BlockLife.createWorld({
        guildId: layoutMeta.guildId || 'local',
        guildName: layoutMeta.guildName || 'Discord',
        sheetKeys: sheets,
        buildingCount: Math.max(1, buildings.length || 3),
        roomKeys,
      });

      // Day/night overlay (full camera)
      this._nightOverlay = this.add.rectangle(W / 2, H / 2, W * 4, H * 4, 0x0b1220, 0)
        .setScrollFactor(0)
        .setDepth(90)
        .setOrigin(0.5);

      this.lifeSprites = new Map(); // residentId -> { sprite, tag, actor }
      this.spawnBlockResidents();
      this.bindHouseholdPets();
      this.applyDayNightVisuals();

      this._lifeTick = this.time.addEvent({
        delay: 500,
        loop: true,
        callback: () => this.tickBlockLife(0.5),
      });
      this.time.delayedCall(400, () => this.tickBlockLife(0.5));
    }

    spawnBlockResidents() {
      return; // fake cast disabled
      if (!this.blockLife) return;
      const gy = this.groundY;
      const buildings = this.buildings || [];
      const depth = 36;

      this.blockLife.residents.forEach((r, i) => {
        if (!r.alive || !r.sheet || !this.textures.exists(r.sheet)) return;
        const b = buildings[r.homeBuilding % Math.max(1, buildings.length)];
        const homeX = b
          ? (b.left + b.right) / 2 + ((i % 5) - 2) * 18
          : 160 + i * 40;
        // Prefer a floor in their home building if we can find one
        let spawnY = gy;
        let roomKey = r.homeRoom;
        if (b) {
          const floors = [...(this.floors?.values?.() || [])].filter((f) => (
            f.floorY != null && f.minX >= b.left - 20 && f.maxX <= b.right + 20 && !f.isRoof
          ));
          if (floors.length) {
            const fl = floors[i % floors.length];
            spawnY = fl.floorY;
            roomKey = fl.roomKey || fl.id || roomKey;
            r.homeRoom = roomKey;
          }
        }
        r.x = homeX;
        r.y = spawnY;

        // Children only slightly smaller; adults full size (SCALE=2)
        const scaleMul = r.stage === 'child' ? 0.88 : (r.stage === 'elder' ? 0.97 : 1);
        const sp = this.add.sprite(homeX, spawnY, r.sheet, 0)
          .setScale(SCALE * scaleMul)
          .setOrigin(0.5, NPC_FOOT_ORIGIN_Y)
          .setDepth(depth);
        this.playSheetPose(sp, r.sheet, 'idle');

        const tag = this.add.text(homeX, spawnY - 36, r.name, {
          fontFamily: 'Segoe UI, system-ui, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: r.stage === 'child' ? '#7c3aed' : (r.partnerId ? '#be185d' : '#0f766e'),
          padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 1).setDepth(depth + 1).setResolution(2);

        const jobTag = this.add.text(homeX, spawnY - 48, r.jobLabel, {
          fontFamily: 'Segoe UI, system-ui, sans-serif',
          fontSize: '8px',
          color: '#cbd5e1',
          backgroundColor: '#0f172acc',
          padding: { x: 3, y: 1 },
        }).setOrigin(0.5, 1).setDepth(depth + 1).setResolution(2).setAlpha(0.85);

        const actor = this.registerAmbient(sp, r.sheet, {
          roomKey: roomKey || null,
          mode: 'life',
          homeX,
          homeY: spawnY,
          floorY: spawnY,
          depth,
        });
        actor.residentId = r.id;

        this.lifeSprites.set(r.id, { sprite: sp, tag, jobTag, actor, resident: r });
      });
      console.info(`[map] block life: ${this.lifeSprites.size} residents day=${this.blockLife.day} hour=${this.blockLife.hour}`);

      // Force everyone to try a seat shortly after spawn so sit/lie is visible
      this.time.delayedCall(1200, () => this.forceResidentsUseFurniture());
      this.time.delayedCall(5000, () => this.forceResidentsUseFurniture());
      // Demo: send a few hungry neighbors to real food plates
      this.time.delayedCall(2800, () => this.forceResidentsEatFood());
      this.time.delayedCall(12000, () => this.forceResidentsEatFood());
    }

    /** Send free residents to actual Pixel Platter food sprites. */
    forceResidentsEatFood() {
      if (!this.lifeSprites || !(this.foods || []).length) {
        console.info('[map] no food sprites for residents to eat');
        return;
      }
      let n = 0;
      const list = [...this.lifeSprites.values()].filter((e) => (
        e.actor?.sprite?.active && e.resident?.alive
        && !e.actor.seated && e.actor.state !== 'walk' && !e.actor._navQueue?.length
        && this.time.now >= (e.actor.busyUntil || 0)
      ));
      // Up to 4 at a time so the block feels like mealtime
      for (const entry of list.slice(0, 4)) {
        const food = this.nearestFoodFor(entry.actor);
        if (!food) continue;
        entry.resident.activity = 'eat';
        this.actorEatFood(entry.actor, food, () => {
          if (entry.resident) {
            entry.resident.needs.hunger = Math.max(0, entry.resident.needs.hunger - 0.5);
          }
        });
        n += 1;
      }
      console.info(`[map] sent ${n} residents to eat real food (${this.foods.length} plates)`);
    }

    /** Sit/lie residents on nearest valid furniture (debug + UX). */
    forceResidentsUseFurniture() {
      if (!this.lifeSprites) return;
      let seated = 0;
      this.lifeSprites.forEach((entry) => {
        const actor = entry.actor;
        const r = entry.resident;
        if (!actor?.sprite?.active || !r?.alive || actor.seated) return;
        if (actor.state === 'walk' || actor._navQueue?.length) return;
        // Same floor only — never Y-teleport onto furniture from another story
        const candidates = (this.seats || []).filter((s) => {
          const yOk = Math.abs((s.floorY || 0) - (actor.floorY || 0)) <= 14;
          const idOk = !s.floorId || !actor.roomKey || s.floorId === actor.roomKey;
          return yOk && idOk;
        }).sort((a, b) => Math.abs(a.x - actor.sprite.x) - Math.abs(b.x - actor.sprite.x));
        const seat = candidates[0];
        if (!seat) return;
        if (Math.abs(seat.x - actor.sprite.x) < 8) {
          this.actorSitOn(actor, seat);
          seated += 1;
        } else if (Math.abs(seat.x - actor.sprite.x) < 120) {
          this.actorWalkTo(actor, seat.x, () => {
            this.actorSitOn(actor, seat);
          }, 20);
          seated += 1;
        }
      });
      console.info(`[map] force seat attempts ~${seated}`);
    }

    bindHouseholdPets() {
      // Ambient street pets removed; companions attach via presence.
    }

    applyDayNightVisuals() {
      if (!this.blockLife || !this._nightOverlay) return;
      const dl = window.BlockLife.daylight(this.blockLife.hour);
      // night alpha 0 at full day, ~0.55 at night
      const nightA = Math.max(0, Math.min(0.58, 1 - dl));
      this._nightOverlay.setFillStyle(0x0b1220, nightA);
      if (this._clockText) {
        const h = this.blockLife.hour;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = ((h + 11) % 12) + 1;
        const phase = window.BlockLife.isNight(h) ? '🌙' : (h < 9 || h >= 17 ? '🌤' : '☀️');
        this._clockText.setText(`Day ${this.blockLife.day} · ${h12}:00 ${ampm} ${phase}`);
      }
    }

    pushLifeEvent(text) {
      if (!this._eventLogText) return;
      const line = String(text || '').slice(0, 72);
      this._eventLogText.setText(line);
      this._eventLogText.setAlpha(1);
      if (this._eventLogBg) this._eventLogBg.setVisible(line.length > 0);
      this._eventLogText.setVisible(line.length > 0);
      this.tweens.add({
        targets: this._eventLogText,
        alpha: 0.55,
        delay: 4000,
        duration: 800,
      });
    }

    tickBlockLife(dtSec) {
      if (!this.blockLife || typeof window.BlockLife === 'undefined') return;

      // Nearby pairs for social graph
      const nearby = [];
      const list = [...this.lifeSprites.values()].filter((e) => e.sprite?.active && e.resident?.alive);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i];
          const b = list[j];
          if (Math.abs(a.sprite.x - b.sprite.x) < 55 && Math.abs(a.sprite.y - b.sprite.y) < 40) {
            nearby.push([a.resident.id, b.resident.id]);
          }
        }
      }

      window.BlockLife.tick(this.blockLife, dtSec, {
        nearbyPairs: nearby,
        onEvent: (e) => this.pushLifeEvent(e),
      });
      this.applyDayNightVisuals();
      this.driveResidents();

      // HUD stays Discord-centric (blocks · rooms) — do not overwrite with fake neighbors.
      this.refreshHudNeeds();
    }

    driveResidents() {
      if (!this.blockLife) return;
      const gy = this.groundY;
      const buildings = this.buildings || [];
      const hour = this.blockLife.hour;

      this.lifeSprites.forEach((entry, id) => {
        const r = this.blockLife.residents.find((x) => x.id === id);
        if (!r || !entry.sprite?.active) return;

        if (!r.alive) {
          // Death: lie down and fade
          this.playSheetPose(entry.sprite, r.sheet, 'lieIdle');
          entry.sprite.setAlpha(0.45);
          entry.tag?.setText(`${r.name} †`);
          entry.jobTag?.setText('remembered');
          return;
        }

        const act = r.activity || window.BlockLife.getActivity(r, hour);
        // Activity is shown via status icons, not a second text line (looked "wired")
        if (entry.jobTag) {
          entry.jobTag.setVisible(false);
          entry.jobTag.setText('');
        }
        void act;

        // Normalize scale (kids slightly smaller only)
        const wantScale = SCALE * (r.stage === 'child' ? 0.88 : (r.stage === 'elder' ? 0.97 : 1));
        if (Math.abs(entry.sprite.scaleX - wantScale) > 0.02) entry.sprite.setScale(wantScale);

        // Needs-driven community overrides (still no work)
        let goal = act;
        if (r.needs.hunger > 0.75) goal = 'eat';
        else if (r.needs.energy < 0.25) goal = 'sleep';
        else if (r.needs.social > 0.75) goal = 'social';
        else if (r.needs.fun > 0.8) goal = 'play';

        const actor = entry.actor;
        // Lock seated NPCs to the cushion so bounce/path never lifts them
        if (actor?.seated && actor.seatedY != null) {
          actor.sprite.x = actor.seat?.x ?? actor.sprite.x;
          actor.sprite.y = actor.seatedY;
        }
        // Name only, slightly closer to head (no activity line above)
        entry.tag?.setPosition(entry.sprite.x, entry.sprite.y - 32);
        r.x = entry.sprite.x;
        r.y = entry.sprite.y;
        // Pixel Spaces need icon over head (hunger/energy/mood)
        this.syncResidentChrome(entry);

        // Don't interrupt mid-walk / mid-nav / mid-pose / seated
        if (!actor || this.time.now < (actor.busyUntil || 0) || actor.state === 'walk'
          || actor.seated || actor._navQueue?.length) {
          return;
        }

        // Target by community activity — never a workplace grind
        let targetX = actor.homeX;
        let targetY = actor.homeY || actor.floorY || gy;
        let targetFloorId = null;
        const b = buildings[r.homeBuilding % Math.max(1, buildings.length)];
        const pickFloorInBuilding = (building, salt = 0) => {
          if (!building) return null;
          const floors = [...(this.floors?.values?.() || [])].filter((f) => (
            f.floorY != null && f.minX >= building.left - 20 && f.maxX <= building.right + 20 && !f.isRoof
          ));
          if (!floors.length) return null;
          return floors[(hashSeed(r.id) + salt) % floors.length];
        };

        if (goal === 'eat') {
          // Always go to a real food sprite on a table — not empty air
          const food = this.nearestFoodFor(actor);
          if (food) {
            entry._nextPathAt = this.time.now + 6000 + (hashSeed(r.id) % 2000);
            this.actorEatFood(actor, food, () => {
              r.needs.hunger = Math.max(0, r.needs.hunger - 0.45);
              this.residentArrive(entry, r, 'hang');
            });
            return;
          }
          // Fallback if map has no plates yet
          if (b) {
            const fl = pickFloorInBuilding(b, 1);
            if (fl) {
              targetX = this.clampToFloor((fl.minX + fl.maxX) / 2, fl);
              targetY = fl.floorY;
              targetFloorId = fl.id;
            }
          }
        } else if (goal === 'sleep' || goal === 'home' || goal === 'chill') {
          targetX = actor.homeX;
          targetY = actor.homeY || actor.floorY || gy;
          if (r.homeRoom) targetFloorId = r.homeRoom;
          else {
            const hf = this.findFloorAt(targetX, targetY);
            if (hf) targetFloorId = hf.id;
          }
        } else if (goal === 'stroll') {
          // Leisure walk along the street
          targetX = 120 + (hashSeed(r.id + String(hour)) % Math.max(80, (this.mapWidth || W) - 240));
          targetY = gy;
          targetFloorId = null;
        } else if (goal === 'visit') {
          // Drop in on another building / neighbor
          const otherB = buildings.length
            ? buildings[(r.homeBuilding + 1 + (hashSeed(r.id + 'v') % Math.max(1, buildings.length - 1))) % buildings.length]
            : b;
          const fl = pickFloorInBuilding(otherB || b, hour);
          if (fl) {
            targetX = this.clampToFloor(fl.minX + 24 + (hashSeed(r.id) % 40), fl);
            targetY = fl.floorY;
            targetFloorId = fl.id;
          } else {
            targetX = (this.mapWidth || W) * 0.4 + (hashSeed(r.id) % 100);
            targetY = gy;
          }
        } else if (goal === 'hang' || goal === 'social' || goal === 'play') {
          // Community hang spots: street plaza or a shared room
          if ((hashSeed(r.id + String(hour)) % 100) < 45 && b) {
            const fl = pickFloorInBuilding(b, hour + 3);
            if (fl) {
              targetX = this.clampToFloor((fl.minX + fl.maxX) / 2 + ((hashSeed(r.id) % 30) - 15), fl);
              targetY = fl.floorY;
              targetFloorId = fl.id;
            }
          } else {
            // Outdoor hang strip
            targetX = (this.mapWidth || W) * 0.28 + (hashSeed(r.id + String(Math.floor(hour / 2))) % 160);
            targetY = gy;
            targetFloorId = null;
          }
        } else if (goal === 'follow' && r.parentIds?.length) {
          const parent = this.lifeSprites.get(r.parentIds[0]);
          if (parent?.sprite) {
            targetX = parent.sprite.x - 14;
            targetY = parent.actor?.floorY ?? parent.sprite.y;
            targetFloorId = parent.actor?.roomKey || null;
          }
        }

        // Throttle: only re-path every few seconds per resident
        if (entry._nextPathAt && this.time.now < entry._nextPathAt) return;
        entry._nextPathAt = this.time.now + 4500 + (hashSeed(r.id) % 2000);

        const distX = Math.abs(entry.sprite.x - targetX);
        const distY = Math.abs((actor.floorY ?? entry.sprite.y) - targetY);
        const needsMove = distX > 16 || distY > 12;
        if (needsMove && goal !== 'sleep') {
          // Door/stair/passage path — never free-slide Y in open air
          this.actorNavigateTo(actor, targetX, targetY, () => {
            this.residentArrive(entry, r, goal);
          }, 22, targetFloorId);
        } else if (needsMove && goal === 'sleep') {
          // Go home via doors, then lie down
          this.actorNavigateTo(actor, targetX, targetY, () => {
            this.residentArrive(entry, r, goal);
          }, 20, targetFloorId);
        } else {
          this.residentArrive(entry, r, goal);
        }
      });
    }

    residentArrive(entry, r, goal) {
      const actor = entry.actor;
      if (!actor?.sprite?.active) return;
      // Prefer real furniture on this floor
      const sameFloorSeat = (kind) => (this.seats || []).find((s) => {
        if (kind && s.kind !== kind) return false;
        const yOk = Math.abs((s.floorY || 0) - (actor.floorY || 0)) <= 16;
        const idOk = !s.floorId || !actor.roomKey || s.floorId === actor.roomKey;
        const near = Math.abs(s.x - actor.sprite.x) < 90;
        return yOk && idOk && near;
      });

      if (goal === 'sleep') {
        const bed = sameFloorSeat('bed')
          || (this.seats || []).find((s) => (
            s.kind === 'bed'
            && Math.abs(s.x - actor.homeX) < 100
            && Math.abs((s.floorY || 0) - (actor.floorY || 0)) <= 16
          ));
        if (bed) {
          // Same-floor walk only — never Y-snap onto a bed
          if (Math.abs(bed.x - actor.sprite.x) > 10) {
            this.actorWalkTo(actor, bed.x, () => this.actorSitOn(actor, bed), 20);
          } else {
            this.actorSitOn(actor, bed);
          }
        } else {
          // Floor nap — stay on floorY, play lie, lock seatedY
          this.setActorBounce(actor, false);
          const sitY = (actor.floorY || actor.sprite.y);
          actor.seated = true;
          actor.seatedY = sitY;
          actor.sprite.y = sitY;
          this.playSheetPose(actor.sprite, actor.sheet, 'lie', {
            onDone: () => {
              if (!actor.seated) return;
              actor.sprite.y = sitY;
              this.playSheetPose(actor.sprite, actor.sheet, 'lieIdle');
            },
          });
          actor.busyUntil = this.time.now + 10000;
        }
        r.needs.energy = Math.min(1, r.needs.energy + 0.15);
        return;
      }
      if (goal === 'eat') {
        const food = this.nearestFoodFor(actor)
          || (this.foods || []).find((f) => Math.abs(f.x - actor.sprite.x) < 50);
        if (food) {
          this.actorEatFood(actor, food, () => {
            r.needs.hunger = Math.max(0, r.needs.hunger - 0.45);
          });
        } else {
          // No plate found — still play eat so it isn't silent
          this.playSheetPose(actor.sprite, actor.sheet, 'eat', {
            onDone: () => this.playSheetPose(actor.sprite, actor.sheet, 'idle'),
          });
          actor.busyUntil = this.time.now + poseDurationMs('eat') + 200;
          r.needs.hunger = Math.max(0, r.needs.hunger - 0.25);
        }
        return;
      }
      // Community hang / visit / chill / stroll — sit, wave, snack vibes
      if (goal === 'hang' || goal === 'visit' || goal === 'chill' || goal === 'stroll'
        || goal === 'social' || goal === 'play' || goal === 'home') {
        const seat = sameFloorSeat('seat');
        const wantSit = seat && (goal === 'chill' || goal === 'home' || Math.random() < 0.55);
        if (wantSit) {
          this.actorSitOn(actor, seat);
        } else {
          const pose = goal === 'play'
            ? 'jump'
            : (['wave', 'snicker', 'shrug'][Math.floor(Math.random() * 3)]);
          this.playSheetPose(actor.sprite, actor.sheet, pose, {
            onDone: () => this.playSheetPose(actor.sprite, actor.sheet, 'idle'),
          });
          actor.busyUntil = this.time.now + 1800 + Math.random() * 1200;
        }
        if (r.partnerId && (goal === 'social' || goal === 'hang')) {
          const p = this.lifeSprites.get(r.partnerId);
          if (p?.sprite && Math.abs(p.sprite.x - actor.sprite.x) < 70) {
            if (seat && !actor.seated) this.actorSitOn(actor, seat);
            r.needs.social = Math.max(0, r.needs.social - 0.1);
          }
        }
        r.needs.fun = Math.max(0, (r.needs.fun || 0.5) - 0.05);
        r.needs.social = Math.max(0, r.needs.social - 0.04);
        return;
      }
      // Fallback community idle
      if (goal === 'idle' || goal === 'follow') {
        this.playSheetPose(actor.sprite, actor.sheet, Math.random() < 0.5 ? 'wave' : 'idle', {
          onDone: () => this.playSheetPose(actor.sprite, actor.sheet, 'idle'),
        });
        actor.busyUntil = this.time.now + 1600;
        if (r.partnerId) {
          const p = this.lifeSprites.get(r.partnerId);
          if (p?.sprite && Math.abs(p.sprite.x - actor.sprite.x) < 70) {
            const seat = sameFloorSeat('seat');
            if (seat) this.actorSitOn(actor, seat);
          }
        }
        return;
      }
      if (goal === 'home') {
        const seat = sameFloorSeat('seat') || sameFloorSeat('bed');
        if (seat) this.actorSitOn(actor, seat);
        else {
          this.playSheetPose(actor.sprite, actor.sheet, 'idle');
          actor.busyUntil = this.time.now + 4000;
          actor.state = 'idle';
        }
      }
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
          const res = await fetch(PRESENCE_URL, presenceFetchInit());
          if (!res.ok) {
            if (res.status === 403) {
              let msg = 'team code required';
              try {
                const errBody = await res.json();
                if (errBody?.code === 'SETUP_REQUIRED') msg = 'owner must ,teamlink';
                else if (errBody?.message) msg = String(errBody.message).slice(0, 48);
              } catch (_) { /* ignore */ }
              throw new Error(msg);
            }
            throw new Error(`HTTP ${res.status}`);
          }
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
      const rooms = Array.isArray(data.rooms) ? data.rooms : [];
      // Recover from demo/empty bootstrap once real Discord rooms arrive.
      if (this._layoutFromDemo && rooms.length) {
        this._layoutFromDemo = false;
        try {
          if (!sessionStorage.getItem('denizen-layout-recovered')) {
            sessionStorage.setItem('denizen-layout-recovered', '1');
            location.reload();
            return;
          }
        } catch (_) {
          location.reload();
          return;
        }
      }
      // Voice-room sizes scale with occupancy (drawVoiceBuilding), so the
      // layout fingerprint includes a coarse occupancy BUCKET per voice room:
      // crossing 0 → 1-2 → 3-5 → 6+ triggers the same guarded soft-reload as
      // a channel rename, growing/shrinking the room. Buckets (not raw
      // counts) keep single join/leaves from thrashing reloads.
      const occBucket = (r) => {
        if (r.type !== 'voice' && r.type !== 'stage') return '';
        const n = Number(r.occupantCount) || 0;
        return `:o${n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0}`;
      };
      const fp = rooms
        .map((r) => `${r.id}:${r.name}:${r.type}:${r.categoryId || ''}${occBucket(r)}`)
        .sort()
        .join('|');
      if (fp && this._layoutFp && fp !== this._layoutFp && rooms.length) {
        // Channel layout drifted (create/rename/delete) — soft reload once.
        this._layoutFp = fp;
        try {
          if (!sessionStorage.getItem(`denizen-layout-fp-${fp.slice(0, 24)}`)) {
            sessionStorage.setItem(`denizen-layout-fp-${fp.slice(0, 24)}`, '1');
            location.reload();
            return;
          }
        } catch (_) { /* continue with people sync */ }
      } else if (fp && !this._layoutFp) {
        this._layoutFp = fp;
      }

      const want = new Map();
      for (const p of data.people || []) {
        const roomKey = this.resolveRoomKey(p);
        if (!roomKey) continue;
        want.set(String(p.userId), {
          userId: String(p.userId),
          displayName: String(p.displayName || 'member').slice(0, 16),
          roomKey,
          soft: !!p.soft || (p.channelType !== 'voice' && p.channelType !== 'stage'),
          muted: !!p.muted,
          deafened: !!p.deafened,
          live: !!p.live,
          textSnippet: p.textSnippet ? String(p.textSnippet).slice(0, 40) : null,
          boosted: !!p.boosted || !!p.premium,
          streaming: !!p.streaming,
          video: !!p.video,
          sheetUrl: p.avatar?.sheetUrl || p.sheetUrl || null,
          avatarRev: p.avatar?.rev || p.avatarRev || 1,
          avatar: p.avatar || null,
          pet: p.pet?.kind ? { kind: p.pet.kind } : null,
          action: p.action && p.action.ts ? {
            kind: String(p.action.kind || ''),
            pose: p.action.pose ? String(p.action.pose) : undefined,
            food: p.action.food ? String(p.action.food) : undefined,
            ts: Number(p.action.ts),
          } : null,
        });
      }

      // Despawn people who left
      for (const [userId, live] of [...this.livePeople.entries()]) {
        if (!want.has(userId)) {
          this.releaseLiveHospitalBed(live);
          this.releaseSlot(live.roomKey, userId);
          this.destroyLiveChrome(live);
          this.dropAmbient(live.sprite);
          live.sprite?.destroy();
          live.tag?.destroy();
          this.livePeople.delete(userId);
        }
      }

      // Spawn / walk / refresh
      for (const [userId, person] of want) {
        const existing = this.livePeople.get(userId);
        if (existing && existing.roomKey !== person.roomKey) {
          // Pop into the new room (no mid-air float across floors)
          this.releaseLiveHospitalBed(existing);
          this.releaseSlot(existing.roomKey, userId);
          const slot = this.claimSlot(person.roomKey, userId);
          this.walkLivePerson(existing, person, slot);
          continue;
        }
        if (!this.livePeople.has(userId)) {
          this.spawnLivePerson(person);
        } else {
          const live = this.livePeople.get(userId);
          const isMe = ME_DISCORD_ID && String(person.userId) === ME_DISCORD_ID;
          if (live.tag) {
            const wantName = isMe ? `${person.displayName} (you)` : person.displayName;
            if (live.tag.text !== wantName) live.tag.setText(wantName);
            live.tag.setBackgroundColor(isMe ? '#16a34a' : (person.soft ? '#334155' : '#5865f2'));
          }
          live.soft = person.soft;
          this.applyGhostFloat(live, person);
          live.sprite.setAlpha(person.soft ? 0.72 : (live.isGhost ? 0.88 : 1));
          this.maybeUpgradeLiveSheet(live, person);
          this.syncLiveChrome(live, person);
        }
      }
      this.updatePlaqueStars();
      this.syncCompanionPets([...want.values()]);
    }

    destroyLiveChrome(live) {
      if (!live) return;
      for (const k of ['statusIcon', 'pointer', 'bubble', 'bubbleShadow', 'bubbleText', 'boostIcon', 'heldFood']) {
        try { live[k]?.destroy?.(); } catch (_) { /* ignore */ }
        live[k] = null;
      }
    }

    /** Stable pack chat-bubble color per Discord user. */
    bubbleKeyForUser(userId) {
      const keys = CHAT_BUBBLE_KEYS.filter((k) => this.textures.exists(k));
      if (!keys.length) return 'uiBubbleWhite';
      const h = hashSeed(String(userId || '0'));
      return keys[h % keys.length];
    }

    /**
     * Soft-text chat bubbles only — no permanent status faces / mic pointer / boost badge.
     * Emotes + held food are ephemeral (showEmote / playPresenceAction).
     */
    syncLiveChrome(live, person) {
      if (!live?.sprite?.active) return;
      const depth = (live.sprite.depth || 30) + 2;
      const sx = live.sprite.x;
      const sy = live.sprite.y;

      // Tear down legacy permanent chrome if still present
      if (live.statusIcon) {
        try { live.statusIcon.destroy(); } catch (_) { /* ignore */ }
        live.statusIcon = null;
      }
      if (live.pointer) {
        try { this.tweens.killTweensOf(live.pointer); live.pointer.destroy(); } catch (_) { /* ignore */ }
        live.pointer = null;
      }
      if (live.boostIcon) {
        try { live.boostIcon.destroy(); } catch (_) { /* ignore */ }
        live.boostIcon = null;
      }

      // Soft text → pack chat bubble behind caption (stable color per user)
      if (person.soft && person.textSnippet) {
        const snip = person.textSnippet;
        const bubbleKey = this.bubbleKeyForUser(person.userId);
        if (this.textures.exists(bubbleKey) || this.textures.exists('uiBubbleWhite')) {
          const key = this.textures.exists(bubbleKey) ? bubbleKey : 'uiBubbleWhite';
          const depthB = depth + 1;
          if (!live.bubble || !live.bubble.active) {
            if (this.textures.exists('uiBubbleShadow')) {
              live.bubbleShadow = this.add.image(sx + 2, sy - 52, 'uiBubbleShadow')
                .setScale(SCALE * 1.35).setDepth(depthB - 1).setOrigin(0.5, 1).setAlpha(0.4);
            }
            live.bubble = this.add.image(sx, sy - 54, key)
              .setScale(SCALE * 1.45).setDepth(depthB).setOrigin(0.5, 1);
            live.bubbleText = this.add.text(sx, sy - 64, snip, {
              fontFamily: 'Segoe UI, system-ui, sans-serif',
              fontSize: '9px', color: '#1e293b', wordWrap: { width: 78 },
            }).setOrigin(0.5, 1).setDepth(depthB + 1).setResolution(2);
            live._bubbleSnippet = snip;
          } else {
            if (live.bubble.texture?.key !== key) live.bubble.setTexture(key);
            live.bubble.setPosition(sx, sy - 54).setVisible(true);
            if (live.bubbleShadow?.active) {
              live.bubbleShadow.setPosition(sx + 2, sy - 52).setVisible(true);
            }
            if (live.bubbleText) {
              live.bubbleText.setText(snip).setPosition(sx, sy - 64).setVisible(true);
            }
            // Pop when snippet changes
            if (snip !== live._bubbleSnippet) {
              live._bubbleSnippet = snip;
              live.bubble.setScale(SCALE * 1.2);
              this.tweens.add({
                targets: live.bubble,
                scaleX: SCALE * 1.45,
                scaleY: SCALE * 1.45,
                duration: 160,
                ease: 'Back.easeOut',
              });
            }
          }
        }
      } else {
        if (live.bubble) live.bubble.setVisible(false);
        if (live.bubbleShadow) live.bubbleShadow.setVisible(false);
        if (live.bubbleText) live.bubbleText.setVisible(false);
      }

      if (live.heldFood?.active) {
        live.heldFood.setPosition(sx + 10, sy - 18).setDepth(depth + 3);
      }

      this.playPresenceAction(live, person);
    }

    layoutLiveChrome(live) {
      if (!live?.sprite?.active) return;
      const sx = live.sprite.x;
      const sy = live.sprite.y;
      if (live.bubble?.active && live.bubble.visible) {
        live.bubble.setPosition(sx, sy - 54);
        if (live.bubbleShadow?.active) live.bubbleShadow.setPosition(sx + 2, sy - 52);
        if (live.bubbleText) live.bubbleText.setPosition(sx, sy - 64);
      }
      if (live.heldFood?.active) {
        live.heldFood.setPosition(sx + 10, sy - 18);
      }
      if (live.tag?.active) live.tag.setPosition(sx, sy - 40);
    }

    /** Play Discord-driven emote/eat once per action timestamp. */
    playPresenceAction(live, person) {
      const action = person?.action;
      if (!action?.ts || !live?.sprite?.active) return;
      const ts = Number(action.ts);
      if (!Number.isFinite(ts) || ts === live.lastActionTs) return;
      live.lastActionTs = ts;

      const kind = String(action.kind || '');
      if (kind === 'emote') {
        const pose = String(action.pose || 'wave');
        if (live.actor) this.playAmbientPose(live.actor, pose, { force: true });
        else if (live.sheet) {
          this.playSheetPose(live.sprite, live.sheet, pose);
          this.showEmote(live.sprite, pose);
        }
        return;
      }

      if (kind === 'eat') {
        const foodKey = this.resolveFoodTextureKey(action.food);
        this.spawnHeldFood(live, foodKey);
        const pose = live.actor?.seated ? 'eatSit' : 'eat';
        const clearMs = poseDurationMs(pose) + 80;
        if (live.actor) {
          const match = (this.foods || []).find((f) => (
            f.key === foodKey
            && !f.eaten
            && Math.abs((f.floorY || 0) - (live.actor.floorY || live.sprite.y)) <= 20
            && Math.abs(f.x - live.sprite.x) < 120
          ));
          if (match) {
            this.actorEatFood(live.actor, match, () => this.clearHeldFood(live));
          } else {
            this.playAmbientPose(live.actor, pose, { force: true });
            this.time.delayedCall(clearMs, () => this.clearHeldFood(live));
          }
        } else if (live.sheet) {
          this.playSheetPose(live.sprite, live.sheet, pose, {
            onDone: () => this.clearHeldFood(live),
          });
          this.showEmote(live.sprite, 'eat');
        }
      }
    }

    resolveFoodTextureKey(raw) {
      const s = String(raw || '').trim();
      if (s && this.textures.exists(s)) return s;
      const aliases = {
        burger: 'foodBurger', pizza: 'foodPizza', fries: 'foodFries',
        hotdog: 'foodHotdog', cake: 'foodCake', tiramisu: 'foodTiramisu',
        pie: 'foodPie', macarons: 'foodMacarons', icecream: 'foodIceCream',
        soda: 'foodSoda', creme: 'foodCreme', apple: 'foodApple',
        banana: 'foodBanana', strawberry: 'foodStrawberry', cherry: 'foodCherry',
        grapes: 'foodGrapes', kiwi: 'foodKiwi', lemon: 'foodLemon',
        orange: 'foodOrange', pear: 'foodPear', raspberry: 'foodRaspberry',
      };
      const key = aliases[s.toLowerCase()] || (
        s && !s.startsWith('food')
          ? `food${s.charAt(0).toUpperCase()}${s.slice(1)}`
          : s
      );
      if (key && this.textures.exists(key)) return key;
      return this.textures.exists('foodBurger')
        ? 'foodBurger'
        : (FOOD_KEYS.find((k) => this.textures.exists(k)) || 'foodBurger');
    }

    spawnHeldFood(live, foodKey) {
      this.clearHeldFood(live);
      if (!live?.sprite?.active || !this.textures.exists(foodKey)) return;
      const depth = (live.sprite.depth || 30) + 3;
      live.heldFood = this.add.image(live.sprite.x + 10, live.sprite.y - 18, foodKey)
        .setScale(FOOD_SCALE * 0.85)
        .setDepth(depth)
        .setOrigin(0.5, 1);
    }

    clearHeldFood(live) {
      if (!live) return;
      try { live.heldFood?.destroy?.(); } catch (_) { /* ignore */ }
      live.heldFood = null;
    }

    /**
     * Room change: fade out, snap to the new slot, fade in, then idle-float there.
     * (Never tween X/Y across floors — that reads as floating through the air.)
     */
    walkLivePerson(live, person, slot) {
      const sprite = live.sprite;
      const tag = live.tag;
      const sheet = live.sheet || this.npcSheetFor(String(person.userId));
      const voiceRoom = person.roomKey && person.roomKey.startsWith('ch_') && person.soft === false;
      const depth = voiceRoom ? 34 : 30;
      const targetAlpha = person.soft ? 0.72 : 1;

      live.roomKey = person.roomKey;
      live.soft = person.soft;
      live.sheet = sheet;
      live.userId = person.userId;
      if (live.actor) {
        live.actor.roomKey = person.roomKey;
        live.actor.staySeated = false;
        live.actor.seated = false;
        live.actor.seat = null;
        live.actor.homeX = slot.x;
        live.actor.homeY = slot.y;
        live.actor.floorY = slot.y;
        live.actor.depth = depth;
        this.setActorBounce(live.actor, false);
      }
      this.maybeUpgradeLiveSheet(live, person);

      try {
        this.tweens.killTweensOf(sprite);
        if (tag) this.tweens.killTweensOf(tag);
      } catch (_) { /* ignore */ }

      const finishArrive = () => {
        if (!sprite?.active) return;
        sprite.setDepth(depth);
        if (tag) tag.setDepth(depth + 1);

        // Hospital channel: claim a bed and lie instead of standing in a walk slot
        if (this.assignLiveHospitalPatient(live, person)) {
          if (live.actor) {
            live.actor.homeX = live.hospitalBed.x;
            live.actor.floorY = live.hospitalBed.floorY;
          }
          this.syncLiveChrome(live, person);
          return;
        }

        sprite.setPosition(slot.x, slot.y);
        if (tag) tag.setPosition(slot.x, slot.y - 40);
        const useSheet = live.sheet || sheet;
        this.playSheetPose(sprite, useSheet, 'idle');
        this.tweens.add({
          targets: sprite, y: slot.y - 1.5,
          duration: 700 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          onUpdate: () => this.layoutLiveChrome(live),
        });
        if (tag) {
          this.tweens.add({
            targets: tag, y: slot.y - 41.5,
            duration: 700 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
        }
        if (live.actor) this.playAmbientPose(live.actor, 'wave');
        this.syncLiveChrome(live, person);
      };

      // Brief fade-out at the old spot, then pop at the new floor and fade in
      this.tweens.add({
        targets: [sprite, tag].filter(Boolean),
        alpha: 0,
        duration: 140,
        ease: 'Sine.easeIn',
        onComplete: () => {
          if (!sprite?.active) return;
          sprite.setPosition(slot.x, slot.y);
          sprite.setDepth(depth);
          this.playSheetPose(sprite, sheet, 'idle');
          if (tag) {
            tag.setPosition(slot.x, slot.y - 40);
            tag.setDepth(depth + 1);
          }
          this.layoutLiveChrome(live);
          this.tweens.add({
            targets: [sprite, tag].filter(Boolean),
            alpha: targetAlpha,
            duration: 220,
            ease: 'Sine.easeOut',
            onComplete: finishArrive,
          });
        },
      });
      this.syncLiveChrome(live, person);
    }

    spawnLivePerson(person) {
      const slot = this.claimSlot(person.roomKey, person.userId);
      const isMe = ME_DISCORD_ID && String(person.userId) === ME_DISCORD_ID;
      // Each real Discord user gets a distinct-but-stable avatar from the 30 sheets.
      // Custom closet sheetUrl (if any) upgrades asynchronously after spawn.
      const sheet = isMe ? this.playerSheet : this.npcSheetFor(String(person.userId));
      const voiceRoom = person.roomKey && person.roomKey.startsWith('ch_') && person.soft === false;
      const depth = voiceRoom ? 34 : 30;
      const label = isMe ? `${person.displayName} (you)` : person.displayName;

      const sprite = this.add.sprite(slot.x, slot.y, sheet, 0)
        .setScale(SCALE)
        .setOrigin(0.5, NPC_FOOT_ORIGIN_Y)
        .setDepth(depth)
        .setAlpha(0);
      this.playSheetPose(sprite, sheet, 'idle');

      const tag = this.add.text(slot.x, slot.y - 40, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: isMe ? '#16a34a' : (person.soft ? '#334155' : '#5865f2'),
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5, 1).setDepth(depth + 1).setResolution(3).setAlpha(0);

      const isGhost = person?.avatar?.premade === 'ghost';
      this.tweens.add({
        targets: [sprite, tag],
        alpha: person.soft ? 0.72 : (isGhost ? 0.88 : 1),
        duration: 280,
        ease: 'Sine.easeOut',
      });

      const actor = this.registerAmbient(sprite, sheet, {
        roomKey: person.roomKey,
        mode: 'life',
        homeX: slot.x,
        homeY: slot.y,
        floorY: slot.y,
        depth,
      });
      // Keep nameplate + status icons glued while they bounce / walk
      this.time.addEvent({
        delay: 50,
        loop: true,
        callback: () => {
          const live = this.livePeople.get(String(person.userId));
          if (!live?.sprite?.active) return;
          this.tickGhostFloat(live);
          this.layoutLiveChrome(live);
        },
      });
      // Wave at others already in the room (join greeting).
      const others = [...this.livePeople.values()].filter((p) => (
        p.roomKey === person.roomKey && p.sprite?.active
      ));
      if (others.length && actor) {
        const other = others[0];
        sprite.setFlipX(sprite.x > other.sprite.x);
        other.sprite.setFlipX(other.sprite.x > sprite.x);
        this.time.delayedCall(200, () => this.playAmbientPose(actor, 'wave', { force: true }));
        if (other.actor) {
          this.time.delayedCall(450, () => this.playAmbientPose(other.actor, 'wave', { force: true }));
        } else if (other.sheet) {
          this.time.delayedCall(450, () => this.playSheetPose(other.sprite, other.sheet, 'wave'));
        }
      }

      const live = {
        sprite,
        tag,
        sheet,
        roomKey: person.roomKey,
        soft: person.soft,
        actor,
        userId: person.userId,
        lastActionTs: null,
        heldFood: null,
      };
      this.livePeople.set(person.userId, live);
      this.maybeUpgradeLiveSheet(live, person);
      this.applyGhostFloat(live, person);
      this.syncLiveChrome(live, person);

      // Hospital channel members claim empty beds and lie; otherwise wander
      const bed = this.assignLiveHospitalPatient(live, person);
      if (bed && actor) {
        actor.homeX = bed.x;
        actor.floorY = bed.floorY;
      } else {
        this.time.delayedCall(900 + Math.random() * 800, () => {
          if (actor?.sprite?.active && !actor.staySeated) this.actorPickWander(actor);
        });
      }
    }

    /** Anonymous sidewalk roamers + curb strollers (no BlockLife names). */
    spawnDecorNpcs() {
      const mw = this.mapWidth || W;
      const gy = this.groundY;
      const avail = NPC_SHEETS.filter((n) => this.textures.exists(n.key) && n.key !== this.playerSheet);
      if (!avail.length) return;

      // Light cast so presence-heavy servers don’t feel crowded (3 life + 2 strollers).
      const lifeSpots = [
        80, mw * 0.45, mw - 120,
      ].filter((x) => x > 20 && x < mw - 20);

      lifeSpots.forEach((x, i) => {
        const sheet = avail[(hashSeed(`life${i}${Math.round(x)}`) % avail.length)].key;
        const sp = this.spawnChar(x, gy, sheet, `${sheet}_idle`, null, 40, { mode: 'life' });
        if (i % 2 === 0) sp.setFlipX(true);
        // Stagger first actions so the street "wakes up" gently
        this.time.delayedCall(800 + i * 550, () => {
          const actor = this.ambientActors.find((a) => a.sprite === sp);
          if (!actor) return;
          actor.busyUntil = this.time.now + 400;
          if (i % 3 === 0) this.playAmbientPose(actor, 'wave', { force: true });
          else if (i % 3 === 1) this.actorPickWander(actor);
          // else stay idle a bit longer
        });
      });

      // Strollers — slow casual pace along the curb
      const strollers = mw > 400
        ? [
          [mw * 0.15, mw * 0.38, 11000],
          [mw * 0.55, mw * 0.82, 12000],
        ]
        : [[40, Math.max(80, mw - 40), 10000]];
      strollers.forEach(([x0, x1, dur], i) => {
        const sheet = avail[(hashSeed(`walk${i}`) % avail.length)].key;
        const walker = this.spawnChar(x0, gy, sheet, `${sheet}_walk`, null, 40, { mode: 'stroll' });
        this.tweens.add({
          targets: walker,
          x: x1,
          duration: dur,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          onYoyo: () => {
            walker.setFlipX(true);
            if (Math.random() < 0.25) {
              this.playSheetPose(walker, sheet, 'wave');
              this.time.delayedCall(poseDurationMs('wave'), () => {
                if (walker.active) this.playSheetPose(walker, sheet, 'walk');
              });
            }
          },
          onRepeat: () => {
            walker.setFlipX(false);
            if (Math.random() < 0.2) {
              this.playSheetPose(walker, sheet, 'snicker');
              this.time.delayedCall(poseDurationMs('snicker'), () => {
                if (walker.active) this.playSheetPose(walker, sheet, 'walk');
              });
            }
          },
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
        kind: def.kind || 'door',
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
      const radius = def.radius || 18;
      this.passages.push({
        x: def.x,
        fromFloorId: def.fromFloorId,
        toFloorId: def.toFloorId,
        radius,
      });
      // Walkable bounds stop short of the shared wall — extend both rooms so
      // the doorway trigger is reachable. Don't assume from=left / to=right.
      const a = this.floors.get(def.fromFloorId);
      const b = this.floors.get(def.toFloorId);
      if (a && b) {
        const leftFloor = (a.minX + a.maxX) <= (b.minX + b.maxX) ? a : b;
        const rightFloor = leftFloor === a ? b : a;
        leftFloor.maxX = Math.max(leftFloor.maxX, def.x + radius + 10);
        rightFloor.minX = Math.min(rightFloor.minX, def.x - radius - 10);
      } else {
        if (a) a.maxX = Math.max(a.maxX, def.x + radius + 10);
        if (b) b.minX = Math.min(b.minX, def.x - radius - 10);
      }
      const floorY = a?.floorY ?? b?.floorY;
      if (floorY != null) {
        this.markPassageDoorway(def.x, floorY, def.roomH || 82, def.doorKind || 'wood');
      }
    }

    /**
     * Smooth floor change: open climb door → fade player → move → camera follow.
     * Used for stairs/roof so it feels like walking through a door.
     */
    transitionToFloor(floorId, { viaClimb = true } = {}) {
      const floor = this.floors.get(floorId);
      if (!floor || !this.indoors || !this.player) return;
      const fromId = this.indoors.floorId;
      if (fromId === floorId) return;

      // Cancel any in-flight floor tween
      try { this.tweens.killTweensOf(this.player); } catch (_) { /* ignore */ }
      this.player.setAlpha(1);
      this._floorTween = true;
      this.standUp();
      if (viaClimb) this.animateElevatorAt(this.player.x, fromId);
      this.playEnterStep();

      const destX = Phaser.Math.Clamp(this.player.x, floor.minX, floor.maxX);
      const cam = this.cameras.main;
      // Brief walk-in feel
      this.tweens.add({
        targets: this.player,
        alpha: 0.12,
        duration: 110,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.indoors.floorId = floorId;
          this.player.setPosition(destX, floor.floorY);
          this.player.setDepth(floor.isRoof ? 46 : 44);
          this.refreshCameraBounds();
          cam.centerOn(this.player.x, this.player.y);
          this.tweens.add({
            targets: this.player,
            alpha: 1,
            duration: 150,
            ease: 'Sine.easeOut',
            onComplete: () => {
              this._floorTween = false;
              if (floor.isRoof) {
                this.setEnterHint(IS_TOUCH ? 'Rooftop · ▼ go down' : 'Rooftop · ↓ climb down');
              } else {
                this.setEnterHint(defaultIndoorHint());
              }
            },
          });
        },
      });
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

    /**
     * Climb / roof stairs near the player.
     * @param {'up'|'down'|null} preferDir - when both exist at the same shaft
     *   (top room: down to lower floor AND up to roof), return the matching dir.
     *   Previously the first registered stair won and blocked roof access.
     */
    nearbyStairs(preferDir = null) {
      if (!this.indoors) return null;
      const px = this.player.x;
      const cur = this.indoors.floorId;
      let up = null;
      let down = null;
      for (const s of this.stairs || []) {
        const reach = (s.radius || 28) + 8; // slightly generous so climb doors are easy to hit
        if (Math.abs(px - s.x) > reach) continue;
        if (s.fromFloorId === cur && !up) {
          up = { ...s, targetFloorId: s.toFloorId, dir: 'up' };
        }
        if (s.toFloorId === cur && !down) {
          down = { ...s, targetFloorId: s.fromFloorId, dir: 'down' };
        }
      }
      if (preferDir === 'up') return up;
      if (preferDir === 'down') return down;
      // Default: prefer up (roof / higher floors) when both available
      return up || down;
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

    /**
     * Cross a left↔right doorway only when walking toward the other room.
     * The old "any velocity past the seam" check ping-ponged floorIds every
     * frame and felt like getting stuck in the door.
     */
    tryCrossPassage(vx) {
      if (!this.indoors || !this.player || this._floorTween) return false;
      if (this.time.now < (this._passageCoolUntil || 0)) return false;
      const curId = this.indoors.floorId;
      const px = this.player.x;
      for (const p of this.passages || []) {
        if (curId !== p.fromFloorId && curId !== p.toFloorId) continue;
        if (Math.abs(px - p.x) > p.radius) continue;

        const fromF = this.floors.get(p.fromFloorId);
        const toF = this.floors.get(p.toFloorId);
        if (!fromF || !toF) continue;
        const fromIsLeft = (fromF.minX + fromF.maxX) <= (toF.minX + toF.maxX);
        const leftId = fromIsLeft ? p.fromFloorId : p.toFloorId;
        const rightId = fromIsLeft ? p.toFloorId : p.fromFloorId;
        const leftF = fromIsLeft ? fromF : toF;
        const rightF = fromIsLeft ? toF : fromF;

        let nextId = null;
        if (vx > 0 && curId === leftId && px >= p.x - 6) nextId = rightId;
        if (vx < 0 && curId === rightId && px <= p.x + 6) nextId = leftId;
        if (!nextId) continue;

        const next = nextId === rightId ? rightF : leftF;
        this.indoors.floorId = nextId;
        this.player.y = next.floorY;
        this.player.x = p.x + (vx > 0 ? 14 : -14);
        this.player.x = Phaser.Math.Clamp(this.player.x, next.minX, next.maxX);
        this.player.setDepth(next.isRoof ? 46 : 44);
        this._passageCoolUntil = this.time.now + 220;
        this.playEnterStep?.();
        return true;
      }
      return false;
    }

    /** Brief open pulse on nearby climb/street doors when changing floors. */
    animateElevatorAt(x, floorId = null) {
      for (const d of this.autoDoors || []) {
        if (d.mode !== 'swing' || !d.leaf) continue;
        if (Math.abs(d.x - x) > 18) continue;
        if (floorId != null && d.indoor && d.floorId && d.floorId !== floorId) continue;
        this.setSwingDoorOpen(d, true);
        this.time.delayedCall(380, () => {
          if (!this.player || !d.leaf) return;
          const far = Math.abs(this.player.x - d.x) > (d.closeRadius || 28);
          const leftFloor = d.indoor && !(this.indoors && this.indoors.floorId === d.floorId);
          const wentInside = !d.indoor && !!this.indoors;
          if (far || leftFloor || wentInside) this.setSwingDoorOpen(d, false);
        });
      }
      for (const e of this.elevatorDoors || []) {
        if (!e?.img?.active) continue;
        if (Math.abs(e.x - x) > 22) continue;
        if (floorId != null && e.floorId && e.floorId !== floorId) continue;
        e.isOpen = true;
        const openKey = e.openKey || 'elevOpen';
        if (this.textures.exists(openKey)) {
          try { e.img.setTexture(openKey); } catch (_) { /* ignore */ }
        }
        this.time.delayedCall(420, () => {
          if (!e.img?.active) return;
          const far = !this.player || Math.abs(this.player.x - e.x) > (e.closeRadius || 36);
          const leftFloor = !(this.indoors && this.indoors.floorId === e.floorId);
          if (far || leftFloor) {
            e.isOpen = false;
            const ck = e.closedKey || 'elevClosed';
            if (this.textures.exists(ck)) {
              try { e.img.setTexture(ck); } catch (_) { /* ignore */ }
            }
          }
        });
      }
    }

    /** Short jump pose when stepping through a door / elevator. */
    playEnterStep() {
      if (!this.player?.active) return;
      try { this.playerPose('jump'); } catch (_) { /* ignore */ }
      const baseY = this.player.y;
      this.tweens.add({
        targets: this.player,
        y: baseY - 6,
        duration: 90,
        yoyo: true,
        ease: 'Sine.easeOut',
        onComplete: () => {
          if (!this.player?.active) return;
          if (this.indoors) {
            const fl = this.floors.get(this.indoors.floorId);
            if (fl) this.player.y = fl.floorY;
          } else {
            this.player.y = this.groundY - 1;
          }
        },
      });
    }

    enterFloor(floorId, fromOutdoorX = null, viaElev = false) {
      this.standUp();
      const floor = this.floors.get(floorId);
      if (!floor) return;
      const outdoorX = fromOutdoorX != null ? fromOutdoorX : this.player.x;
      if (viaElev) this.animateElevatorAt(outdoorX);
      this.playEnterStep();
      this.indoors = { floorId, outdoorX };
      const spawnX = Phaser.Math.Clamp(this.player.x, floor.minX, floor.maxX);
      // Fade in through the street door
      this.player.setAlpha(0.2);
      this.player.setPosition(spawnX, floor.floorY);
      this.player.setDepth(44);
      this.playerTag.setDepth(45);
      this.cameras.main.setZoom(this.indoorZoom);
      this.layoutHud?.();
      this.cameras.main.setDeadzone(36, 18);
      this.refreshCameraBounds();
      this.cameras.main.centerOn(this.player.x, this.player.y);
      this.tweens.add({ targets: this.player, alpha: 1, duration: 180, ease: 'Sine.easeOut' });
      this.setEnterHint(defaultIndoorHint());
    }

    leaveBuilding() {
      if (!this.indoors) return;
      this.standUp();
      const outX = this.indoors.outdoorX;
      this.indoors = null;
      this.playEnterStep();
      this.player.setAlpha(0.25);
      this.player.setPosition(outX, this.groundY - 1);
      this.player.setDepth(45);
      this.playerTag.setDepth(46);
      this.cameras.main.setZoom(this.outdoorZoom);
      this.layoutHud?.();
      const narrow = window.innerWidth < 640;
      this.cameras.main.setDeadzone(narrow ? 40 : 70, narrow ? 24 : 36);
      this.refreshCameraBounds();
      this.cameras.main.centerOn(this.player.x, this.player.y);
      this.tweens.add({ targets: this.player, alpha: 1, duration: 160, ease: 'Sine.easeOut' });
      this.setEnterHint(defaultOutdoorHint());
    }

    goToFloor(floorId, viaElev = true) {
      // Prefer the animated door transition (esp. roof).
      this.transitionToFloor(floorId, { viaClimb: viaElev });
    }

    nearbySeat() {
      if (this.seated || !this.player) return null;
      const px = this.player.x;
      const py = this.player.y;
      const cur = this.indoors?.floorId || null;
      const floor = cur ? this.floors.get(cur) : null;
      const playerFloorY = floor?.floorY ?? this.groundY - 1;
      let best = null;
      let bestD = 999;
      for (const s of this.seats || []) {
        // Same room (by floor id / roomKey) OR same floor line (Y match)
        if (this.indoors) {
          const sameId = s.floorId && (s.floorId === cur || s.floorId === floor?.roomKey);
          const sameY = Math.abs((s.floorY || 0) - playerFloorY) <= 14;
          if (s.floorId && !sameId && !sameY) continue;
          if (!s.floorId && !sameY) continue;
        } else {
          // Outside: only outdoor seats (benches) near street ground
          if (s.floorId) continue;
          if (Math.abs((s.floorY || 0) - (this.groundY)) > 14) continue;
        }
        const dist = Math.abs(px - s.x);
        const r = s.radius || 22;
        if (dist <= r && dist < bestD) {
          best = s;
          bestD = dist;
        }
      }
      return best;
    }

    nearbyFood() {
      if (!this.indoors) return null;
      const px = this.player.x;
      const cur = this.indoors.floorId;
      const floor = this.floors.get(cur);
      let best = null;
      let bestD = 999;
      for (const f of this.foods || []) {
        if (f.eaten) continue;
        if (f.floorId && f.floorId !== cur) continue;
        if (!f.floorId && floor && Math.abs((f.floorY || 0) - floor.floorY) > 24) continue;
        const dist = Math.abs(px - f.x);
        if (dist <= (f.radius || 20) && dist < bestD) {
          best = f;
          bestD = dist;
        }
      }
      return best;
    }

    /**
     * F9 — full animation gallery: a demo NPC cycles every sheet pose so you
     * can audit walk/idle/sit/lie/eat/wave/etc. without hunting furniture.
     */
    toggleAnimGallery() {
      if (this._gallery) {
        try {
          this._gallery.timer?.remove?.(false);
          this._gallery.sprite?.destroy?.();
          this._gallery.label?.destroy?.();
          this._gallery.panel?.destroy?.();
        } catch (_) { /* ignore */ }
        this._gallery = null;
        this.setEnterHint('anim gallery off');
        return;
      }
      const sheet = this.playerSheet || this.npcSheetFor('gallery');
      const poses = Object.keys(NPC_POSE_DEFS);
      const cam = this.cameras.main;
      const panel = this.add.rectangle(0, 0, 200, 72, 0x0f172a, 0.82)
        .setScrollFactor(0).setDepth(600).setOrigin(0, 0);
      panel.setPosition(12, (cam.height || H) - 84);
      const label = this.add.text(24, (cam.height || H) - 72, '', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '12px',
        color: '#f8fafc',
        wordWrap: { width: 170 },
      }).setScrollFactor(0).setDepth(601).setResolution(2);
      const sprite = this.add.sprite(100, (cam.height || H) - 16, sheet, 0)
        .setScale(SCALE * 1.4)
        .setOrigin(0.5, 1)
        .setScrollFactor(0)
        .setDepth(602);
      let idx = 0;
      const playNext = () => {
        const pose = poses[idx % poses.length];
        idx += 1;
        label.setText(`F9 gallery · ${pose}\n${idx}/${poses.length} · press F9 to close`);
        this.playSheetPose(sprite, sheet, pose, {
          onDone: () => {
            if (!this._gallery) return;
            // brief hold on loop poses
            this.time.delayedCall(NPC_POSE_DEFS[pose]?.loop ? 900 : 120, playNext);
          },
        });
        // loop poses need manual advance
        if (NPC_POSE_DEFS[pose]?.loop) {
          this.time.delayedCall(1100, () => {
            if (this._gallery) playNext();
          });
        }
      };
      this._gallery = { sprite, label, panel, timer: null };
      playNext();
      this.setEnterHint('anim gallery ON · F9 close');
    }

    /** Player one-shot emote (hotkeys + ambient demo). */
    playerPose(pose) {
      if (!this.player || !this.playerSheet) return false;
      // Sitting variants
      let p = pose;
      if (this.seated) {
        if (pose === 'eat') p = 'eatSit';
        if (pose === 'sit' || pose === 'lie') return false;
      }
      this.showEmote(this.player, p);
      return this.playSheetPose(this.player, this.playerSheet, p, {
        onDone: () => {
          if (!this.player?.active) return;
          if (this.seated) {
            const idle = this.seated.seat.kind === 'bed' ? 'lieIdle' : 'sitIdle';
            this.playSheetPose(this.player, this.playerSheet, idle);
          } else {
            this.playSheetPose(this.player, this.playerSheet, 'idle');
          }
        },
      });
    }

    tryEat(food) {
      if (!food || !this.player || !this.playerSheet) return;
      if (this.time.now < (this._poseHoldUntil || 0)) return;
      if (food.eaten) return;
      const pose = this.seated ? 'eatSit' : 'eat';
      // Face the plate and chew while it shrinks bite by bite.
      this.player.setFlipX(food.x < this.player.x);
      this.eatFoodBites(food, 3, 600);
      this.playerPose(pose);
      this.setEnterHint(IS_TOUCH ? 'nom nom…' : 'eating…');
    }

    sitOn(seat) {
      if (!seat || !this.player || this.seated) return;
      const isBed = seat.kind === 'bed';
      const sitY = seatContactY(seat);
      const fromY = this.player.y;
      this.seated = { seat, prevDepth: this.player.depth, seatedY: sitY };
      this.player.setVelocityX(0);
      this.player.x = seat.x;
      this.player.setDepth(44);
      const start = isBed ? 'lie' : 'sit';
      const idle = isBed ? 'lieIdle' : 'sitIdle';
      this._poseHoldUntil = 0;
      // Ease onto the cushion while sit frames play (fixes float / pop)
      try { this.tweens.killTweensOf(this.player); } catch (_) { /* ignore */ }
      this.player.y = fromY;
      this.tweens.add({
        targets: this.player,
        y: sitY,
        duration: Math.max(280, poseDurationMs(start) - 40),
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          if (this.player?.active) this.player.x = seat.x;
        },
      });
      const ok = this.playSheetPose(this.player, this.playerSheet, start, {
        onDone: () => {
          if (!this.seated || !this.player?.active) return;
          this.player.x = seat.x;
          this.player.y = sitY;
          this.seated.seatedY = sitY;
          this.playSheetPose(this.player, this.playerSheet, idle);
        },
      });
      if (!ok) {
        this.player.y = sitY;
        this.playSheetPose(this.player, this.playerSheet, 'idle');
      }
      const tag = isBed ? 'lying down' : 'sitting';
      this.setEnterHint(IS_TOUCH ? `${tag} · ▼ stand` : `${tag} · ↓ / E stand`);
    }

    standUp() {
      if (!this.seated) return;
      const isBed = this.seated.seat.kind === 'bed';
      const floor = this.indoors ? this.floors.get(this.indoors.floorId) : null;
      const targetY = floor ? floor.floorY : (this.groundY - 1);
      if (this.seated.prevDepth != null) this.player.setDepth(this.seated.prevDepth);
      this.seated = null;
      const fin = isBed ? 'lieFinish' : 'sitFinish';
      try { this.tweens.killTweensOf(this.player); } catch (_) { /* ignore */ }
      this.tweens.add({
        targets: this.player,
        y: targetY,
        duration: Math.max(260, poseDurationMs(fin) - 40),
        ease: 'Sine.easeOut',
      });
      this.playSheetPose(this.player, this.playerSheet, fin, {
        onDone: () => {
          if (!this.player?.active) return;
          this.player.y = targetY;
          this.playSheetPose(this.player, this.playerSheet, 'idle');
        },
      });
    }

    tryEnterExit() {
      if (this.enterCooldown > 0) return;
      const touch = touchInput();
      const ePressed = this.keyE && Phaser.Input.Keyboard.JustDown(this.keyE);
      const up = Phaser.Input.Keyboard.JustDown(this.cursors.up)
        || Phaser.Input.Keyboard.JustDown(this.wasd.up)
        || (touch && touch.consumeEnter());
      const down = Phaser.Input.Keyboard.JustDown(this.cursors.down)
        || Phaser.Input.Keyboard.JustDown(this.wasd.down)
        || (touch && touch.consumeExit());

      // Seated: E near food = eat; down/up = stand
      if (this.seated) {
        if (ePressed) {
          const food = this.nearbyFood();
          if (food) {
            this.tryEat(food);
            this.enterCooldown = 400;
            return;
          }
        }
        if (down || ePressed || up) {
          this.standUp();
          this.enterCooldown = 180;
          return;
        }
      }

      if (!this.indoors) {
        // Outdoor bench sit
        if ((ePressed || up) && this.nearbySeat()) {
          this.sitOn(this.nearbySeat());
          this.enterCooldown = 220;
          return;
        }
        if (up) {
          const door = this.nearbyDoor();
          if (door) {
            // Pulse the street door open as you enter.
            this.enterFloor(door.floorId, door.outdoorX, true);
            this.enterCooldown = 280;
          }
        }
        return;
      }

      // Prefer climb door / stairs over sit when standing on the climb lane.
      // Pass preferDir so top-floor rooms can both go DOWN (lower) and UP (roof).
      const stairsUp = this.nearbyStairs('up');
      const stairsDown = this.nearbyStairs('down');
      if (up && stairsUp) {
        this.goToFloor(stairsUp.targetFloorId, true);
        this.enterCooldown = 280;
        return;
      }
      if (down && stairsDown) {
        this.goToFloor(stairsDown.targetFloorId, true);
        this.enterCooldown = 280;
        return;
      }

      // Sit / lie, or eat food on tables (↑ prefers seat; E prefers closer interactable)
      // Don't steal ↑ when a climb-up is available a few px away
      if ((ePressed || up) && !stairsUp) {
        const seat = this.nearbySeat();
        const food = this.nearbyFood();
        if (up && seat) {
          this.sitOn(seat);
          this.enterCooldown = 220;
          return;
        }
        if (ePressed && food && (!seat || Math.abs(food.x - this.player.x) < Math.abs(seat.x - this.player.x) - 2)) {
          this.tryEat(food);
          this.enterCooldown = 400;
          return;
        }
        if (seat) {
          this.sitOn(seat);
          this.enterCooldown = 220;
          return;
        }
        if (ePressed && food) {
          this.tryEat(food);
          this.enterCooldown = 400;
          return;
        }
      }

      if (down) {
        // From roof or ground floor leave; mid floors without stairs: leave if near entrance x
        const floor = this.floors.get(this.indoors.floorId);
        if (floor?.isRoof) {
          // only down via stairs — already handled
          return;
        }
        this.leaveBuilding();
        this.enterCooldown = 220;
      }
    }

    updateElevatorProximity() {
      if (!this.player) return;
      const px = this.player.x;
      const curFloor = this.indoors?.floorId || null;
      for (const e of this.elevatorDoors || []) {
        if (!e?.img?.active) continue;
        const onFloor = !!curFloor && curFloor === e.floorId;
        const dist = Math.min(
          Math.abs(px - e.x),
          e.interactX != null ? Math.abs(px - e.interactX) : 999,
        );
        let wantOpen = e.isOpen;
        if (!onFloor) wantOpen = false;
        else if (dist < (e.openRadius || 26)) wantOpen = true;
        else if (dist > (e.closeRadius || 38)) wantOpen = false;
        if (wantOpen === e.isOpen) continue;
        e.isOpen = wantOpen;
        const key = wantOpen
          ? (e.openKey || 'elevOpen')
          : (e.closedKey || 'elevClosed');
        if (this.textures.exists(key)) {
          try { e.img.setTexture(key); } catch (_) { /* ignore */ }
        }
      }
    }

    /**
     * Front door: pack doubles texture-swap to opened; climb doors scaleX swing.
     */
    setSwingDoorOpen(d, open) {
      if (!d?.leaf || d.isOpen === open) return;
      d.isOpen = open;
      const base = d.baseScale != null ? d.baseScale : SCALE;
      try { this.tweens.killTweensOf(d.leaf); } catch (_) { /* ignore */ }
      d.animating = true;

      if (d.swapTexture && d.closedKey && d.openKey) {
        const key = open ? d.openKey : d.closedKey;
        if (this.textures.exists(key)) {
          try { d.leaf.setTexture(key); } catch (_) { /* ignore */ }
        }
        // Keep scale full — opened leaf is already narrower pack art
        this.tweens.add({
          targets: d.leaf,
          scaleX: base,
          scaleY: base,
          duration: open ? 120 : 140,
          ease: open ? 'Cubic.easeOut' : 'Cubic.easeIn',
          onComplete: () => { d.animating = false; },
        });
        return;
      }

      const openSx = d.openScaleX != null ? d.openScaleX : base * 0.18;
      const targetSx = open ? openSx : base;
      this.tweens.add({
        targets: d.leaf,
        scaleX: targetSx,
        duration: open ? 140 : 160,
        ease: open ? 'Cubic.easeOut' : 'Cubic.easeIn',
        onComplete: () => { d.animating = false; },
      });
    }

    updateAutoDoors() {
      if (!this.player) return;
      const px = this.player.x;
      const outside = !this.indoors;
      const curFloor = this.indoors?.floorId || null;
      for (const d of this.autoDoors || []) {
        if (d.mode !== 'swing') continue;
        // Indoor doors sit on the left wall; climb lane may be a few px right —
        // treat either the door center or interactX as "near".
        const distDoor = Math.abs(px - d.x);
        const distLane = d.interactX != null ? Math.abs(px - d.interactX) : distDoor;
        const dist = Math.min(distDoor, distLane);
        const openR = d.openRadius != null ? d.openRadius : 24;
        const closeR = d.closeRadius != null ? d.closeRadius : 34;
        let wantOpen = d.isOpen;

        if (d.indoor) {
          // Indoor climb door: only react on its floor
          const onFloor = !!curFloor && curFloor === d.floorId;
          if (!onFloor) wantOpen = false;
          else if (dist < openR) wantOpen = true;
          else if (dist > closeR) wantOpen = false;
        } else {
          // Street door: open outdoors when near; shut when inside
          if (!outside) wantOpen = false;
          else if (dist < openR) wantOpen = true;
          else if (dist > closeR) wantOpen = false;
        }

        if (wantOpen !== d.isOpen) this.setSwingDoorOpen(d, wantOpen);
      }
    }

    update() {
      if (!this.player?.body) return;
      if (this.enterCooldown > 0) this.enterCooldown -= this.game.loop.delta;

      // Emote hotkeys (checked here so JustDown is reliable)
      if (this.emoteKeys) {
        const ek = this.emoteKeys;
        const JD = Phaser.Input.Keyboard.JustDown;
        if (JD(ek.jump)) this.playerPose('jump');
        else if (JD(ek.wave)) this.playerPose('wave');
        else if (JD(ek.shrug)) this.playerPose('shrug');
        else if (JD(ek.snicker)) this.playerPose('snicker');
        else if (JD(ek.eat)) this.playerPose('eat');
        else if (JD(ek.hurt)) this.playerPose('hurt');
        else if (JD(ek.cycle)) {
          const order = ['jump', 'wave', 'shrug', 'snicker', 'eat', 'hurt', 'sit', 'lie'];
          const pose = order[this._emoteCycle % order.length];
          this._emoteCycle += 1;
          this.playerPose(pose);
          this.setEnterHint(`anim: ${pose}  (F8 next · keys 1-6 · F9 gallery)`);
        } else if (ek.gallery && JD(ek.gallery)) {
          this.toggleAnimGallery();
        }
      }

      this.tryEnterExit();
      this.updateElevatorProximity();
      this.updateAutoDoors();

      // Keep paid companion pets glued to their owners between presence polls
      if (this.companionPets?.size) {
        for (const [userId, entry] of this.companionPets) {
          const owner = this.livePeople?.get(userId);
          if (owner) this.followCompanionPet(entry, owner);
        }
      }

      let vx = 0;
      const touch = touchInput();
      if (!this.seated) {
        if (this.cursors.left.isDown || this.wasd.left.isDown || touch?.left) vx = -1;
        if (this.cursors.right.isDown || this.wasd.right.isDown || touch?.right) vx = 1;
      }
      this.player.setVelocityX(vx * 110);

      if (this.seated) {
        this.player.setVelocityX(0);
        this.player.x = this.seated.seat.x;
        this.player.y = this.seated.seatedY != null
          ? this.seated.seatedY
          : this.seated.seat.floorY - (this.seated.seat.surfaceH || 8);
        // Animation is owned by sitOn() (sit/lie intro → seated idle loop).
      } else if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        if (floor && !this._floorTween) {
          this.player.y = floor.floorY;
          // Horizontal room-to-room — direction-aware so we don't bounce in the door
          this.tryCrossPassage(vx);
          const cur = this.floors.get(this.indoors.floorId);
          if (cur) {
            this.player.x = Phaser.Math.Clamp(this.player.x, cur.minX, cur.maxX);
          }
        }
      } else {
        this.player.y = this.groundY - 1;
      }

      // Only drive walk/idle when not mid one-shot pose (wave/eat/jump/…)
      if (!this.seated && this.time.now >= (this._poseHoldUntil || 0)) {
        if (vx) {
          this.player.setFlipX(vx < 0);
          const cur = this.player.anims.currentAnim?.key;
          if (cur !== `${this.playerSheet}_walk`) {
            this.playSheetPose(this.player, this.playerSheet, 'walk');
            // walk is looping — don't hold forever
            this._poseHoldUntil = 0;
            this._playerPose = 'walk';
          }
        } else {
          const cur = this.player.anims.currentAnim?.key;
          if (cur !== `${this.playerSheet}_idle`) {
            this.playSheetPose(this.player, this.playerSheet, 'idle');
            this._poseHoldUntil = 0;
            this._playerPose = 'idle';
          }
        }
      }
      // Keep "you" close to head; pointer floats higher so they don't stack
      this.playerTag.setPosition(this.player.x, this.player.y - 28);
      this.updatePlayerUiChrome();

      // Zone label + contextual hints
      let zone = 'lobby';
      if (this.seated) {
        zone = this.seated.seat.kind === 'bed' ? 'lying down' : 'sitting';
        const food = this.nearbyFood();
        this.setEnterHint(food
          ? (IS_TOUCH ? 'E eat · ▼ stand' : 'E eat · ↓ stand up')
          : (IS_TOUCH ? '▼ stand up' : '↓ / E stand up'));
      } else if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        zone = floor?.isRoof ? 'Rooftop' : (floor?.label || this.indoors.floorId);
        const n = [...this.livePeople.values()].filter((p) => p.roomKey === floor?.roomKey).length;
        if (n) zone = `${zone} (${n})`;
        const doorHint = this.nearbyStairs();
        const seat = this.nearbySeat();
        const food = this.nearbyFood();
        const passage = this.nearbyPassage();
        if (doorHint?.dir === 'up') {
          const dest = this.floors.get(doorHint.targetFloorId);
          if (dest?.isRoof) {
            this.setEnterHint(IS_TOUCH ? '▲ rooftop' : '↑ climb to rooftop');
          } else {
            this.setEnterHint(IS_TOUCH ? '▲ floor up' : '↑ climb up');
          }
        } else if (doorHint?.dir === 'down') {
          this.setEnterHint(IS_TOUCH
            ? (floor?.isRoof ? '▼ go inside' : '▼ floor down')
            : (floor?.isRoof ? '↓ climb inside' : '↓ climb down · or leave'));
        } else if (passage) {
          this.setEnterHint(IS_TOUCH ? '◀ ▶ next room' : '← → walk through doorway');
        } else if (food && (!seat || Math.abs(food.x - this.player.x) <= Math.abs(seat.x - this.player.x))) {
          this.setEnterHint(IS_TOUCH ? 'E eat' : 'E eat snack');
        } else if (seat) {
          this.setEnterHint(IS_TOUCH
            ? (seat.kind === 'bed' ? '▲ lie down' : '▲ sit')
            : (seat.kind === 'bed' ? 'E / ↑ lie on bed' : 'E / ↑ sit'));
        } else {
          this.setEnterHint(defaultIndoorHint());
        }
      } else {
        const x = this.player.x;
        const door = this.nearbyDoor();
        if (door) {
          const b = (this.buildings || []).find((bd) => x >= bd.left - 10 && x <= bd.right + 10);
          const names = b
            ? (b.channels || []).slice(0, 2).map((c) => channelLabel(c)).join(' · ')
            : '';
          zone = names || b?.label || b?.kind || 'door';
          this.setEnterHint(IS_TOUCH ? '▲ enter' : '↑ / W enter');
        } else {
          const b = (this.buildings || []).find((bd) => x >= bd.left - 10 && x <= bd.right + 10);
          if (b) {
            const names = (b.channels || []).slice(0, 2).map((c) => channelLabel(c)).join(' · ');
            zone = names || b.label || b.kind;
            this.setEnterHint('');
          } else if (x > (this.mapWidth || W) - 120) {
            zone = 'AFK · park';
            this.setEnterHint('');
          } else {
            this.setEnterHint(defaultOutdoorHint());
          }
        }
      }
      if (this.roomEl) this.roomEl.textContent = zone;
      this.syncInRoomChannelTooltip();
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
    window.__DenizenMapGame = game;

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

  // Double-rAF lets the flex layout settle before measuring #game-host, but
  // rAF never fires in occluded/backgrounded tabs — fall back to a timer so
  // the game still boots there.
  let booted = false;
  const bootOnce = () => {
    if (booted) return;
    booted = true;
    bootPhaser();
  };
  requestAnimationFrame(() => requestAnimationFrame(bootOnce));
  setTimeout(bootOnce, 400);
})();
