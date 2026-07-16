/* Pixel Spaces side-view — polished closer to itch example */
(() => {
  const PACK = './PixelSpaces';
  const FULL = './PixelSpacesFull';
  const IA = `${FULL}/Individual Assets`;
  const EXP = `${FULL}/Expansions`;
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
    // Prefer the Denizen server proxy (works even when the bot presence
    // sidecar on :5180 is down / EADDRINUSE). Bot direct URL is a fallback.
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
    'bed', 'bedBlue', 'bedGreen', 'bedHosp', 'bunkBottom',
  ]);
  const BED_KEYS = new Set(['bed', 'bedBlue', 'bedGreen', 'bedHosp', 'bunkBottom', 'bunkTop']);

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
    // Pack "closed" doors are edge-on 5px slivers (read as open/side). We keep
    // the open swing sprite from the pack and generate a real front-facing
    // closed door texture at runtime (see ensureFrontDoorTextures).
    door: `${INF}/Door_wood_opened.png`,
    doorClosed: `${INF}/Door_wood_closed.png`,
    doorOpen: `${INF}/Door_wood_opened.png`,
    doorGlass: `${INF}/Door_glass_closed.png`,
    doorGlassOpen: `${INF}/Door_glass_opened.png`,
    elevClosed: `${INF}/Elevator_closed.png`,
    elevOpen: `${INF}/Elevator_opened.png`,
    elevSlightly: `${INF}/Elevator_slightlyOpened.png`,
    roofVents1: `${INF}/Roof_vents_1.png`,
    roofVents2: `${INF}/Roof_vents_2.png`,
    treeRoof1: `${BG}/Tree_rooftop_1.png`,
    treeRoof2: `${BG}/Tree_rooftop_2.png`,
    craneRoof: `${BG}/Crane_rooftop.png`,
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
    lightSurgery: `${EXP}/Hospital/Individual Assets/Light_surgery_white.png`,
    storageMed: `${EXP}/Hospital/Individual Assets/Storage_medical_white.png`,
    computerMed: `${EXP}/Hospital/Individual Assets/Computer_medical_white.png`,
    monitorMedWall: `${EXP}/Hospital/Individual Assets/Monitor_medical_mounted_white.png`,
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
  // ——— Interactable furniture ———
  // Any placed sprite whose ASSETS key appears here becomes a live
  // interactable: SEAT_INFO → press E (or ▲ on touch) to sit, BED_INFO →
  // lie down. The value is the pixel height of the seating/lying surface
  // above the floor line (screen px at SCALE 2), used to park the player
  // sprite on top of the furniture. Registration happens automatically in
  // furn(), so every couch/stool/bed across every kit and theme works.
  const SEAT_INFO = {
    couchBlue: 10, couchGreen: 10, couchRed: 10, couchGrey: 10, couchYellow: 10, couchDark: 10,
    couchSmall: 10, couchSmallG: 10, couchSmallR: 10, couchSmallY: 10, couchSmallGr: 10,
    stoolBlue: 12, stoolRed: 12, stoolYellow: 12, stoolGreen: 12, stool: 12, stoolB: 12,
    officechairBlue: 12, officechairRed: 12, officechairPurple: 12, officechairOrange: 12,
    throneRed: 12, throneBlue: 12, throneGreen: 12, thronePurple: 12, throneYellow: 12,
    waitChairSolo: 12, waitChairSoloRed: 12, waitChairs: 12, waitChairsRed: 12,
    chairHalloween: 12, benchWood: 10,
  };
  const BED_INFO = {
    bed: 12, bedBlue: 12, bedGreen: 12,
    bedHosp: 12, bunkBottom: 12, tableSurgery: 14, coffin: 12,
  };

  /** Floor hosts that surface props (laptop etc.) can sit on — height = top above floor. */
  const SURFACE_HOSTS = {
    desk: 14, desk2: 14, coffee: 10, counter: 14, counterEnd: 14,
    tableLong: 14, deskOffice: 14, policeDesk: 14, filecabinet: 0,
  };
  /** Props that must sit ON a surface host (not float mid-air). */
  const SURFACE_PROPS = new Set(['laptop', 'books', 'books2', 'radio', 'paperStack', 'paperStack2']);

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
  // Layout rule: stairs/elev use the LEFT clear lane (~0.12–0.22).
  // Furniture lives in the mid/right band so the ladder never blocks the room.
  // Kits use layout "slots" left→right after the climb door band (~0.22+).
  // Groups stay together (desk+laptop+chair). Sparse > cluttered.
  const KITS = {
    lounge: [
      { key: ['couchBlue', 'couchGreen', 'couchRed', 'couchYellow'], xf: 0.42, depth: 23, sit: true },
      { key: 'coffee', xf: 0.58, depth: 24, near: 'couch' },
      { key: ['lamp', 'lamp2', 'lamp3'], xf: 0.72, depth: 22 },
      { key: ['floraFern', 'floraSnake', 'floraAloe'], xf: 0.88, depth: 24 },
    ],
    library: [
      { key: 'bookshelf', xf: 0.36, depth: 22 },
      { key: 'bookshelf2', xf: 0.52, depth: 22 },
      { key: ['couchSmall', 'couchSmallGr'], xf: 0.72, depth: 23, sit: true },
      { key: ['floraBonsai', 'floraSucculent'], xf: 0.9, depth: 24 },
    ],
    office: [
      { key: ['desk', 'desk2'], xf: 0.42, depth: 22 },
      { key: 'laptop', xf: 0.42, depth: 24, onSurface: true },
      { key: ['officechairBlue', 'officechairRed', 'officechairPurple', 'officechairOrange'], xf: 0.58, depth: 23, sit: true },
      { key: 'shelfMedium', xf: 0.8, depth: 22 },
      { key: ['floraSucculent', 'flora'], xf: 0.92, depth: 24 },
    ],
    cafe: [
      { key: 'counter', xf: 0.38, depth: 22 },
      { key: 'counterEnd', xf: 0.52, depth: 22 },
      { key: ['stoolRed', 'stoolYellow', 'stoolBlue', 'stoolGreen'], xf: 0.66, depth: 23, sit: true },
      { key: ['potRed', 'potYellow'], xf: 0.88, depth: 24 },
    ],
    kitchen: [
      { key: 'fridge', xf: 0.34, depth: 22 },
      { key: 'counter', xf: 0.52, depth: 22 },
      { key: 'oven', xf: 0.68, depth: 22 },
      { key: 'sink', xf: 0.84, depth: 22 },
    ],
    reception: [
      { key: 'tableLong', xf: 0.44, depth: 22 },
      { key: 'clipboard', xf: 0.62, depth: 24, wall: true },
      { key: ['couchSmall', 'couchSmallY'], xf: 0.8, depth: 23, sit: true },
      { key: ['floraRose', 'floraFern'], xf: 0.92, depth: 24 },
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
      // Elevator lane left (shaft at 36). Layout logic: supply storage sits
      // by the lane, the operating table + light are the room's centerpiece
      // with the saline drip at its head, records computer against the far
      // wall; the ward runs bed → drip → bed with the nurse making rounds.
      stairsDx: 36,
      recipes: [
        () => ({
          h: 84, fill: 0xdaf0ea, slots: [90, 185],
          items: [
            ['w', 'lightSurgery', 130, 2],
            ['w', ['monitorMedWall', 'monitorMedWallBlack'], 185, 6], ['w', 'posterMed', 240, 6],
            ['f', ['storageMed', 'storageMedBlack'], 70, 1, 0],
            ['f', ['tableSurgery', 'ctScanner'], 130, 1, 0], ['f', 'salineStand', 160, 1, 0],
            ['npc', 'hospital-surgeon', 102], ['f', ['computerMed', 'computerMedBlack'], 215, 1, 0],
          ],
        }),
        () => ({
          h: 102, fill: 0xe8f4f0, slots: [110, 170, 232],
          items: [
            ['glow', 0xc8f0e0, 0.08],
            ['w', 'hospLogo', 160, 6], ['w', 'posterMed', 82, 8],
            ['f', 'bedHosp', 78, 1, 0], ['f', 'salineStand', 105, 1, 0], ['f', 'bedHosp', 138, 1, 0],
            ['npc', 'hospital-nurse', 172],
            ['f', ['computerMed', 'computerMedBlack'], 205, 1, 0],
            ['f', ['storageMed', 'storageMedBlack'], 238, 1, 0],
            ['f', 'floraFernFull', 118, 1, 0],
          ],
        }),
      ],
    },
    museum: {
      bw: 340,
      wall: 0xd8c8a8, side: 0xb8a888, outline: 0x3a2e1c, roof: 0xc8b896, band: 0x8a7a5a,
      title: { color: '#3a2e1c', bg: '#f0e4c8' },
      stripStyle: { color: '#f8f0d8', bg: '#5a4a30' },
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
      ],
    },
    police: {
      wall: 0x5a7a9a, side: 0x42607e, outline: 0x14202e, roof: 0x4a6a8a, band: 0x2a4058,
      signKey: 'policeSign', signScale: SCALE * 0.9,
      stripStyle: { color: '#d8e8f8', bg: '#1a2a3a' },
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
      ],
    },
    fire: {
      wall: 0xc84a3a, side: 0xa03828, outline: 0x3a0e08, roof: 0xb04030, band: 0x701e14,
      signKey: 'fireSign', signScale: SCALE * 0.85,
      stripStyle: { color: '#ffe0d0', bg: '#701e14' },
      doorKind: 'door',
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
      ],
      outside(scene, left) {
        scene.furn('fireHydrant', left - 30, scene.groundY, 19);
      },
    },
    halloween: {
      wall: 0x4a3458, side: 0x362442, outline: 0x140a1c, roof: 0x3a2848, band: 0x241432,
      title: { color: '#ffb858', bg: '#241432' },
      stripStyle: { color: '#ffb858', bg: '#140a1c' },
      // Elevator lane left (shaft at 36; the cobweb stays in the top-left
      // corner above it). Layout logic: attic = coffin flanked by a grave
      // candle, then mummy / ghost-lamp / skeleton spaced down the room;
      // parlor = reading corner (dark bookshelf + candelabra + cursed
      // chair) then witch tending her jack-o-lantern patch on the right.
      stairsDx: 36,
      recipes: [
        () => ({
          h: 84, fill: 0x584668, slots: [110, 165, 235],
          items: [
            ['glow', 0x8a5aff, 0.08],
            ['w', ['cobwebRoom', 'cobwebRoom2'], 12, 2],
            ['w', ['lanternHang', 'lanternHang2'], 130, 2],
            ['w', ['cobwebRoom2', 'cobwebRoom'], 245, 2],
            ['f', 'coffin', 80, 1, 0],
            ['f', ['candleTable', 'candleTable2', 'candleTable3'], 115, 1, 0],
            ['npc', 'halloween-mummy', 152], ['f', 'lampGhost', 192, 1, 0], ['npc', 'halloween-skeleton', 228],
          ],
        }),
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
      ],
      outside(scene, left, bw, groundY) {
        const seed = hashSeed(`hw${left}`);
        scene.furn('treeDeadL', left - 36, groundY, 18);
        scene.furn('treeDeadM', left + bw + 34, groundY, 18);
        scene.furn('lampPostHW', left + bw + 60, groundY, 19);
        scene.furn(seededPick(seed, ['billboardPumpkin', 'billboardGhosts', 'billboardScary'], 1), left - 62, groundY, 18);
        scene.add.image(left + bw / 2, 60, 'moonHW').setScale(SCALE).setDepth(-60);
        const ghost = scene.add.image(left - 20, groundY - 60, seededPick(seed, ['ghost1', 'ghost2'], 2)).setScale(SCALE).setDepth(19).setAlpha(0.8);
        scene.tweens.add({ targets: ghost, y: groundY - 80, x: left + 30, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const bat = scene.add.image(left + bw + 20, groundY - 120, seededPick(seed, ['bat1', 'bat2'], 3)).setScale(SCALE).setDepth(19);
        scene.tweens.add({ targets: bat, x: left + bw + 90, y: groundY - 150, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
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
      this.decorNpcQueue = []; // [sheetKey, x, floorY] queued by themed rooms, flushed after layout
      this._themeRR = 0; // round-robin index for THEME_ROTATION_POOL
      this._missingAssets = new Set();
      this.seats = []; // interactable seats/beds, auto-registered by furn()
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

      this.bootstrapLayout().then(() => {
        this.flushDecorNpcQueue();
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
      this.cameras.main.startFollow(this.player, true, 0.18, 0.22);
      const narrow = window.innerWidth < 640;
      this.outdoorZoom = IS_TOUCH && narrow ? 0.98 : 1.1;
      this.indoorZoom = IS_TOUCH && narrow ? 1.38 : 1.55;
      this.cameras.main.setZoom(this.outdoorZoom);
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
        tryUrls.push('http://127.0.0.1:5180/presence');
      }
      for (const url of tryUrls) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (res.ok) {
            data = await res.json();
            break;
          }
        } catch (_) { /* try next */ }
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
        this.drawDemoLayout(x, this.groundY, guildName);
        x += 620;
        this.mapWidth = Math.max(W, x + 100);
        this.drawGround();
        this.add.image(this.mapWidth - 70, this.groundY - 1, 'tree').setScale(2.8).setOrigin(0.5, 1).setDepth(18);
        this.add.image(this.mapWidth - 30, this.groundY - 1, 'pot').setScale(SCALE).setOrigin(0.5, 1).setDepth(18);
        return;
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
      for (const cat of catList) {
        const voiceChans = cat.channels.filter((c) => c.type === 'voice' || c.type === 'stage');
        const decision = this.pickTheme(cat);

        if (decision.kind === 'voice') {
          if (!voiceChans.length) continue;
          const bw = 290;
          this.drawVoiceBuilding(x, this.groundY, voiceChans, cat.name);
          this.buildings.push({ left: x, right: x + bw, kind: 'voice', channels: voiceChans, label: cat.name });
          x += bw + 36;
          continue;
        }

        if (decision.kind === 'zone') {
          if (decision.theme === 'winterzone') {
            this.drawWinterPark(x, this.groundY, cat);
            x += 480 + 60;
          } else {
            this.drawDigSite(x, this.groundY, cat);
            x += 640 + 60;
          }
          continue;
        }

        if (decision.kind === 'themed') {
          const MAX_ROOMS = 2;
          const total = cat.channels.length;
          for (let i = 0; i < total; i += MAX_ROOMS) {
            const chunk = cat.channels.slice(i, i + MAX_ROOMS);
            const suffix = total > MAX_ROOMS ? ` ${Math.floor(i / MAX_ROOMS) + 1}` : '';
            const b = this.buildGenericBuilding(decision.theme, x, `${cat.name}${suffix}`, chunk);
            this.buildings.push({ left: x, right: x + b.bw, kind: decision.theme, channels: chunk, label: cat.name });
            x += b.bw + 20;
          }
          continue;
        }

        // Plain: the original per-channel office-park building, chunked at 4.
        const perBuilding = 4;
        const textPalettes = [0, 1, 2];
        for (let i = 0; i < cat.channels.length; i += perBuilding) {
          const chunk = cat.channels.slice(i, i + perBuilding);
          const bw = 290;
          const suffix = cat.channels.length > perBuilding ? ` · pt ${Math.floor(i / perBuilding) + 1}` : '';
          const title = `${cat.name}${suffix}`;
          this.drawTextBuilding(x, this.groundY, title, chunk, textPalettes[plainIdx % textPalettes.length]);
          plainIdx += 1;
          this.buildings.push({ left: x, right: x + bw, kind: 'text', channels: chunk, label: title });
          x += bw + 20;
        }
      }

      this.mapWidth = Math.max(W, x + 100);
      this.drawGround();
      this.add.image(this.mapWidth - 70, this.groundY - 1, 'tree').setScale(2.8).setOrigin(0.5, 1).setDepth(18);
      this.add.image(this.mapWidth - 30, this.groundY - 1, 'pot').setScale(SCALE).setOrigin(0.5, 1).setDepth(18);
    }

    /** Decide a building theme (or special outdoor zone) for one category. */
    pickTheme(cat) {
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

      g.fillStyle(cfg.roof, 1);
      g.fillRect(left - 6, top - 10, bw + 12, 12);
      g.lineStyle(3, cfg.outline, 1);
      g.strokeRect(left - 6, top - 10, bw + 12, 12);

      if (cfg.signKey) {
        this.add.image(left + bw / 2, top - 12, cfg.signKey)
          .setScale(cfg.signScale || SCALE).setOrigin(0.5, 1).setDepth(28);
      }
      if (cfg.title) {
        this.buildingTitle(left + bw / 2, top - (cfg.signKey ? 0 : 22), shortLabel(cfg.title.text, 22), {
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
        this.channelBadge(padX + 4, y0 + 4, shortLabel(room.label, 16));
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
      const doorX2 = left + bw - 48;
      this.placeEntrance(g, doorX, this.groundY, cfg.doorKind || 'door', cfg.side, 26);
      this.placeEntrance(g, doorX2, this.groundY, cfg.doorKind2 || 'door', cfg.side, 26);
      this.registerDoor({ x: doorX, floorId: lowest.id, radius: 18 });
      this.registerDoor({ x: doorX2, floorId: lowest.id, radius: 18 });

      for (let i = floorDefs.length - 1; i > 0; i -= 1) {
        // Prefer theme stairsDx; fall back to left climb lane (not room center).
        // Compact climb DOORS — mounted on the left wall of the cutaway.
        const prefer = cfg.stairsDx != null
          ? padX + cfg.stairsDx
          : padX + Math.max(22, roomW * 0.18);
        const sx = this.markClimbDoor(prefer, floorDefs[i].id) || prefer;
        this.markClimbDoor(prefer, floorDefs[i - 1].id);
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
        let sx = prefer;
        if (floorDefs.length === 1) sx = this.markClimbDoor(prefer, topFloor.id) || prefer;
        this.markClimbDoor(prefer, roofId);
        this.registerStairs({
          x: sx,
          fromFloorId: topFloor.id,
          toFloorId: roofId,
          radius: 36,
        });
        this.furn('roofVents1', padX + roomW * 0.45, roofY, 22);
        this.furn('treeRoof2', padX + roomW * 0.72, roofY, 22);
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
      // Theme stairs lane — skip floor items that land inside it
      const clearX = x0 + (room.stairsDx != null ? room.stairsDx : roomW * 0.14);
      const clearR = 26;
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
        if (Math.abs(x - clearX) < clearR) return;
        if (x < x0 + 10 + hw || x > x0 + roomW - 10 - hw) return;
        // Nudge right then left to clear overlaps
        let placedOk = false;
        for (let t = 0; t < 8; t += 1) {
          if (!collides(x, hw) && Math.abs(x - clearX) >= clearR) {
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

      (room.items || []).forEach((it, idx) => {
        const kind = it[0];
        if (kind === 'w') {
          const [, key, dx, dyTop, sc] = it;
          this.wallDecor(pick(key, idx), x0 + dx, y0 + dyTop, 22, (sc || 1) * SCALE);
        } else if (kind === 'npc') {
          const [, key, dx] = it;
          const x = x0 + dx;
          if (Math.abs(x - clearX) < clearR) return;
          this.decorNpcQueue.push([key, x, floorY]);
        } else if (kind === 'glow') {
          const [, color, alpha] = it;
          const glow = this.add.rectangle(x0 + roomW / 2, y0 + room.h / 2, roomW - 16, room.h - 12, color, alpha).setDepth(21);
          this.tweens.add({ targets: glow, alpha: alpha + 0.08, duration: 1700, yoyo: true, repeat: -1 });
        }
      });
    }

    /** Build one themed building for `channels` (already chunked to <= 2). */
    buildGenericBuilding(theme, left, categoryLabel, channels) {
      const kit = THEME_KITS[theme];
      const rooms = channels.map((ch, i) => {
        const recipe = kit.recipes[i % kit.recipes.length]();
        return {
          id: chKey(ch.id),
          roomKey: chKey(ch.id),
          label: channelLabel(ch),
          h: recipe.h,
          fill: recipe.fill,
          slots: recipe.slots,
          items: recipe.items,
          bars: recipe.bars,
          stairsDx: kit.stairsDx,
        };
      });
      const b = this.drawThemeBuilding({
        left,
        bw: kit.bw,
        wall: kit.wall, side: kit.side, outline: kit.outline, roof: kit.roof, band: kit.band,
        signKey: kit.signKey, signScale: kit.signScale,
        title: kit.signKey ? undefined : { text: categoryLabel, color: kit.title.color, bg: kit.title.bg },
        strip: { text: `${categoryLabel} · ↑ enter`, color: kit.stripStyle.color, bg: kit.stripStyle.bg },
        doorKind: kit.doorKind,
        stairsDx: kit.stairsDx,
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
     * Spawn every queued themed-room "staff member" using the same full-body
     * 30-character NPC_SHEETS cast as the player and street crowd (proper
     * walk/idle anims, no mismatched art style). Each queue entry carries a
     * seed string (not a sprite key) so the same room always gets the same
     * character across reloads, while different rooms get different faces.
     */
    flushDecorNpcQueue() {
      for (const [seed, x, floorY] of this.decorNpcQueue) {
        const sheet = this.npcSheetFor(seed);
        this.spawnChar(x, floorY, sheet, `${sheet}_idle`, null, 31);
      }
      this.decorNpcQueue = [];
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
            this.decorateRoom(channels[idx], x0, y0, roomW, h, floor, {
              clearXf: 0.14,
              roomKey: isPlaceholder ? undefined : chKey(channels[idx].id),
            });
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
          this.decorateRoom(ch, slot.x, slot.y, slot.w, slot.h, floor, {
            clearXf: 0.14,
            roomKey,
          });
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

      // Two street DOORS (not elevators) — half-width rooms can't fit elev shafts.
      const firstKey = channels[0] ? chKey(channels[0].id) : null;
      const doorX = left + 40;
      const doorX2 = left + bw - 44;
      if (firstKey) {
        this.placeEntrance(g, doorX, groundY, 'door', pal.lintel, 26);
        this.registerDoor({ x: doorX, floorId: firstKey, radius: 18, kind: 'door' });
      }
      if (channels[1]) {
        this.placeEntrance(g, doorX2, groundY, 'door', pal.lintel, 26);
        this.registerDoor({ x: doorX2, floorId: chKey(channels[1].id), radius: 18, kind: 'door' });
      }
      // Climb DOORS in each stack's clear left strip + walkable rooftop.
      let leftClimbX = padX + Math.max(20, roomW * 0.2);
      let rightClimbX = padX + roomW + gap + Math.max(20, roomW * 0.2);
      if (channels[0] && channels[2]) {
        leftClimbX = this.markClimbDoor(leftClimbX, chKey(channels[0].id)) || leftClimbX;
        this.markClimbDoor(leftClimbX, chKey(channels[2].id));
        this.registerStairs({
          x: leftClimbX,
          fromFloorId: chKey(channels[2].id),
          toFloorId: chKey(channels[0].id),
          radius: 28,
        });
      }
      if (channels[1] && channels[3]) {
        rightClimbX = this.markClimbDoor(rightClimbX, chKey(channels[1].id)) || rightClimbX;
        this.markClimbDoor(rightClimbX, chKey(channels[3].id));
        this.registerStairs({
          x: rightClimbX,
          fromFloorId: chKey(channels[3].id),
          toFloorId: chKey(channels[1].id),
          radius: 28,
        });
      }
      // Rooftop access from top-left room (channel 0) — ↑ at climb door.
      if (channels[0]) {
        const topKey = chKey(channels[0].id);
        const roofId = `roof_${left}`;
        const roofY = top + 8;
        const roofMin = padX + 10;
        const roofMax = padX + roomW * 2 + gap - 10;
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
        // Ensure top room has a climb door if it wasn't part of a 0↔2 pair.
        if (!channels[2]) {
          leftClimbX = this.markClimbDoor(leftClimbX, topKey) || leftClimbX;
        }
        this.markClimbDoor(leftClimbX, roofId);
        this.registerStairs({
          x: leftClimbX,
          fromFloorId: topKey,
          toFloorId: roofId,
          radius: 36,
        });
        this.furn('roofVents1', padX + roomW * 0.55, roofY, 22);
        this.furn('treeRoof1', padX + roomW * 1.2, roofY, 22);
        this.furn('roofVents2', padX + roomW * 1.7, roofY, 22);
        this._sceneMinY = Math.min(this._sceneMinY ?? 0, roofY - 100);
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

    placeEntrance(g, cx, groundY, kind = 'door', lintelColor = 0x2a5534, depth = 26) {
      // Integer SCALE=2 on a 14×22 leaf → 28×44. With a 3px lintel + frame
      // pad the whole assembly is ≤50px and stays inside the 54px door-strip
      // under the first-floor cutaway (no overlap into rooms above).
      this.ensureFrontDoorTextures();
      const scale = SCALE; // 2 — keep pixel-art crisp
      const srcW = 14;
      const srcH = 22;
      const leafW = srcW * scale;
      const leafH = srcH * scale;
      const jamb = 2;
      const lintelH = 3;
      const frameW = leafW + jamb * 2;
      const frameH = leafH + 2;
      const fx = Math.round(cx - frameW / 2);
      const fy = Math.round(groundY - frameH);

      // Lintel
      g.fillStyle(lintelColor, 1);
      g.fillRect(fx - 1, fy - lintelH, frameW + 2, lintelH);
      g.lineStyle(1, 0x0a0806, 1);
      g.strokeRect(fx - 1, fy - lintelH, frameW + 2, lintelH);

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
      g.fillRect(fx - 1, groundY - 2, frameW + 2, 2);
      g.fillStyle(0x000000, 0.22);
      g.fillRect(fx, groundY, frameW, 1);

      g.lineStyle(1, 0x0a0806, 1);
      g.strokeRect(fx, fy, frameW, frameH);

      // Leaf — left hinge, sits on ground
      const hingeX = fx + jamb;
      const leaf = this.add.image(hingeX, groundY - 1, 'doorFrontClosed')
        .setOrigin(0, 1)
        .setScale(scale, scale)
        .setDepth(depth);
      this.autoDoors.push({
        x: cx,
        kind: 'door',
        mode: 'swing',
        indoor: false,
        leaf,
        baseScale: scale,
        openScaleX: scale * 0.18,
        openRadius: 24,
        closeRadius: 34,
        isOpen: false,
        animating: false,
      });
      return {
        fx, fy, frameW, frameH, dw: leafW, dh: leafH,
        sprite: leaf, kind: 'door',
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
          x, floorY, floorId, surfaceH: SEAT_INFO[key], kind: 'seat', key, radius: 16,
        });
      } else if (BED_INFO[key] != null) {
        this.seats.push({
          x, floorY, floorId, surfaceH: BED_INFO[key], kind: 'bed', key, radius: 22,
        });
      }
      return this.add.image(x, floorY, key)
        .setScale(scale)
        .setOrigin(0.5, 1)
        .setDepth(depth);
    }

    /**
     * Inter-floor climb door — leaf only, no frame.
     * Sits in the climb lane on the room's floor plank (same baseline as
     * furniture), not jammed into the left border or floating mid-wall.
     * @returns {number} door center x (use for stairs / interaction)
     */
    markClimbDoor(preferredX, floorId) {
      const floor = this.floors.get(floorId);
      if (!floor) return preferredX;
      this.ensureFrontDoorTextures();

      // Door art is 14×22; scale 2 = 28×44 — fits short cutaway rooms.
      const sc = SCALE;
      const leafW = 14 * sc;

      // Prefer the climb-lane x (empty left strip). Only nudge if it would
      // clip the walkable bounds.
      let cx = preferredX;
      if (floor.minX != null) cx = Math.max(cx, floor.minX + leafW / 2);
      if (floor.maxX != null) cx = Math.min(cx, floor.maxX - leafW / 2);

      // Same baseline as furniture: origin bottom on floor.floorY.
      // Tiny lift (2px) so the leaf rests on the wood plank, not sunk into it.
      const doorBottomY = floor.floorY - 2;
      // Left hinge so the swing opens into the room (to the right).
      const hingeX = Math.round(cx - leafW / 2);
      const leaf = this.add.image(hingeX, doorBottomY, 'doorFrontClosed')
        .setOrigin(0, 1)
        .setScale(sc, sc)
        .setDepth(21.5);

      this.autoDoors.push({
        x: cx,
        interactX: preferredX,
        kind: 'door',
        mode: 'swing',
        indoor: true,
        floorId,
        leaf,
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

    /** Wall color for a room, deterministic per channel id. */
    roomWallColor(roomKey) {
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
      const kitName = kitForChannel(ch.name, ch.type, seed);
      let kit = KITS[kitName] || KITS.lounge;
      // Tiny rooms: drop the last 1–2 props so nothing crams.
      if (slotW < 110) kit = kit.slice(0, Math.min(3, kit.length));
      else if (slotW < 140) kit = kit.slice(0, Math.min(4, kit.length));

      const clearLeft = slotX + Math.max(28, slotW * 0.22); // climb door zone
      const leftBound = clearLeft + 6;
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
      kit.forEach((item, idx) => {
        const key = Array.isArray(item.key) ? seededPick(seed, item.key, idx * 7 + 1) : item.key;
        if (item.wall) wallItems.push({ item, key });
        else if (item.onSurface || SURFACE_PROPS.has(key) || item.offY) surfaceItems.push({ item, key });
        else floorItems.push({ item, key });
      });

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

      wallItems.forEach(({ item, key }) => {
        const x = Phaser.Math.Clamp(
          slotX + Math.max(0.35, item.xf) * slotW,
          leftBound + 8,
          rightBound - 8,
        );
        this.wallDecor(key, x, slotY + 8, item.depth || 21, SCALE * (item.scaleMul || 1));
      });

      // One piece of wall decor max — window OR curtain, never both
      if (slotH >= 72 && usable > 50) {
        const wallTop = slotY + 8;
        const wallX = leftBound + usable * 0.55;
        if (seed % 2 === 0) {
          const winKey = seededPick(seed, ['windowSq', 'windowCircle', 'windowGlass', 'windowSmall'], 11);
          this.wallDecor(winKey, wallX, wallTop, 21);
        } else {
          this.wallDecor('clipboard', wallX, wallTop + 2, 21);
        }
      }
    }

    /** Visual doorway gap between side-by-side rooms (horizontal passage). */
    markPassageDoorway(x, floorY, roomH) {
      const g = this.add.graphics().setDepth(20.8);
      const doorH = Math.min(40, roomH - 12);
      const doorW = 10;
      const top = floorY - doorH;
      // Dark opening in the shared wall
      g.fillStyle(0x0c0a08, 0.85);
      g.fillRect(x - doorW / 2, top, doorW, doorH);
      // Thin jambs
      g.fillStyle(0x2a2218, 1);
      g.fillRect(x - doorW / 2 - 2, top, 2, doorH);
      g.fillRect(x + doorW / 2, top, 2, doorH);
      g.fillStyle(0x3a2e22, 1);
      g.fillRect(x - doorW / 2 - 1, top - 3, doorW + 2, 3);
    }

    /** Rooftop floor strip + rail so the roof reads as a walkable place. */
    markRooftopDeck(minX, maxX, floorY) {
      const g = this.add.graphics().setDepth(19);
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
      // Small "ROOF" tag near left climb
      this.add.text(minX + 18, floorY - 28, 'ROOF', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#f8fafc',
        backgroundColor: '#0f172a',
        padding: { x: 4, y: 1 },
      }).setOrigin(0, 1).setDepth(28).setResolution(2).setAlpha(0.85);
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
        // Interaction poses — the sheets ship full SIT/LIE rows we now use:
        // row 3 SIT (3f, sink into the seat), row 4 SIT IDLE (3f loop),
        // row 5 SIT FINISH (3f, stand back up), row 6 LIE DOWN (6f),
        // row 7 LIE FINISH (6f, get back up). frame = row * NPC_COLS + col.
        const row = (r) => r * NPC_COLS;
        this.anims.create({
          key: `${n.key}_sit`,
          frames: this.anims.generateFrameNumbers(n.key, { start: row(3), end: row(3) + 2 }),
          frameRate: 10,
        });
        this.anims.create({
          key: `${n.key}_sitIdle`,
          frames: this.anims.generateFrameNumbers(n.key, { start: row(4), end: row(4) + 2 }),
          frameRate: 2,
          repeat: -1,
        });
        this.anims.create({
          key: `${n.key}_sitFinish`,
          frames: this.anims.generateFrameNumbers(n.key, { start: row(5), end: row(5) + 2 }),
          frameRate: 12,
        });
        this.anims.create({
          key: `${n.key}_lie`,
          frames: this.anims.generateFrameNumbers(n.key, { start: row(6), end: row(6) + 5 }),
          frameRate: 10,
        });
        this.anims.create({
          key: `${n.key}_lieIdle`,
          frames: [{ key: n.key, frame: row(6) + 5 }],
          frameRate: 1,
          repeat: -1,
        });
        this.anims.create({
          key: `${n.key}_lieFinish`,
          frames: this.anims.generateFrameNumbers(n.key, { start: row(7), end: row(7) + 5 }),
          frameRate: 12,
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
      const radius = def.radius || 14;
      this.passages.push({
        x: def.x,
        fromFloorId: def.fromFloorId,
        toFloorId: def.toFloorId,
        radius,
      });
      // Each room's walkable minX/maxX stops a few px short of the shared
      // wall, so the passage trigger point (sitting in that gap) was never
      // actually reachable — extend each room's bound toward the passage.
      const from = this.floors.get(def.fromFloorId);
      const to = this.floors.get(def.toFloorId);
      if (from) from.maxX = Math.max(from.maxX, def.x + radius + 4);
      if (to) to.minX = Math.min(to.minX, def.x - radius - 4);
      // Draw a doorway so the horizontal transition is obvious
      const floorY = from?.floorY || to?.floorY;
      if (floorY != null) {
        // Approximate room height from floorY spacing is unknown; use 48px opening.
        this.markPassageDoorway(def.x, floorY, 52);
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
    }

    enterFloor(floorId, fromOutdoorX = null, viaElev = false) {
      this.standUp();
      const floor = this.floors.get(floorId);
      if (!floor) return;
      const outdoorX = fromOutdoorX != null ? fromOutdoorX : this.player.x;
      if (viaElev) this.animateElevatorAt(outdoorX);
      this.indoors = { floorId, outdoorX };
      const spawnX = Phaser.Math.Clamp(this.player.x, floor.minX, floor.maxX);
      // Fade in through the street door
      this.player.setAlpha(0.2);
      this.player.setPosition(spawnX, floor.floorY);
      this.player.setDepth(44);
      this.playerTag.setDepth(45);
      this.cameras.main.setZoom(this.indoorZoom);
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
      this.player.setAlpha(0.25);
      this.player.setPosition(outX, this.groundY - 1);
      this.player.setDepth(45);
      this.playerTag.setDepth(46);
      this.cameras.main.setZoom(this.outdoorZoom);
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
      if (!this.indoors || this.seated) return null;
      const px = this.player.x;
      const cur = this.indoors.floorId;
      let best = null;
      let bestD = 999;
      for (const s of this.seats || []) {
        if (s.floorId && s.floorId !== cur) continue;
        // If no floorId, match by floorY
        const floor = this.floors.get(cur);
        if (!s.floorId && floor && Math.abs((s.floorY || 0) - floor.floorY) > 8) continue;
        const dist = Math.abs(px - s.x);
        const r = s.radius || 16;
        if (dist <= r && dist < bestD) {
          best = s;
          bestD = dist;
        }
      }
      return best;
    }

    sitOn(seat) {
      if (!seat || !this.player || this.seated) return;
      this.seated = { seat, prevDepth: this.player.depth };
      this.player.setVelocityX(0);
      this.player.x = seat.x;
      this.player.y = seat.floorY - (seat.surfaceH || 10);
      this.player.setDepth(44);
      // Play the sheet's real SIT (row 3) / LIE DOWN (row 6) animation, then
      // settle into the matching idle loop (SIT IDLE row 4 / held lie frame).
      const isBed = seat.kind === 'bed';
      const startKey = `${this.playerSheet}_${isBed ? 'lie' : 'sit'}`;
      const idleKey = `${this.playerSheet}_${isBed ? 'lieIdle' : 'sitIdle'}`;
      if (this.anims.exists(startKey)) {
        this.player.anims.play(startKey, true);
        this.player.once(`animationcomplete-${startKey}`, () => {
          if (this.seated && this.anims.exists(idleKey)) this.player.anims.play(idleKey, true);
        });
      } else {
        this.player.anims.play(`${this.playerSheet}_idle`, true);
      }
      const tag = isBed ? 'lying down' : 'sitting';
      this.setEnterHint(IS_TOUCH ? `${tag} · ▼ stand` : `${tag} · ↓ / E stand`);
    }

    standUp() {
      if (!this.seated) return;
      const isBed = this.seated.seat.kind === 'bed';
      const floor = this.indoors ? this.floors.get(this.indoors.floorId) : null;
      if (floor) this.player.y = floor.floorY;
      else this.player.y = this.groundY - 1;
      if (this.seated.prevDepth != null) this.player.setDepth(this.seated.prevDepth);
      this.seated = null;
      // SIT FINISH (row 5) / LIE FINISH (row 7) — briefly hold off the
      // walk/idle animation switcher in update() so the get-up plays out.
      const finKey = `${this.playerSheet}_${isBed ? 'lieFinish' : 'sitFinish'}`;
      if (this.anims.exists(finKey)) {
        this.player.anims.play(finKey, true);
        this._poseHoldUntil = this.time.now + (isBed ? 480 : 260);
      }
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

      // Stand from sit/lie
      if (this.seated && (down || ePressed || up)) {
        this.standUp();
        this.enterCooldown = 180;
        return;
      }

      if (!this.indoors) {
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

      // Prefer climb door / stairs over sit when standing on the climb lane
      const stairs = this.nearbyStairs();
      if (up && stairs && stairs.dir === 'up') {
        this.goToFloor(stairs.targetFloorId, true);
        this.enterCooldown = 280;
        return;
      }
      if (down && stairs && stairs.dir === 'down') {
        this.goToFloor(stairs.targetFloorId, true);
        this.enterCooldown = 280;
        return;
      }

      // Sit / lie on nearby furniture
      if ((ePressed || up) && !stairs) {
        const seat = this.nearbySeat();
        if (seat) {
          this.sitOn(seat);
          this.enterCooldown = 220;
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
      // Climb doors are swing-mode autoDoors — handled in updateAutoDoors.
    }

    /**
     * Front door leaf swings on a left hinge (scaleX). Same art open/closed.
     */
    setSwingDoorOpen(d, open) {
      if (!d?.leaf || d.isOpen === open) return;
      d.isOpen = open;
      const base = d.baseScale != null ? d.baseScale : SCALE;
      const openSx = d.openScaleX != null ? d.openScaleX : base * 0.18;
      const targetSx = open ? openSx : base;
      try { this.tweens.killTweensOf(d.leaf); } catch (_) { /* ignore */ }
      d.animating = true;
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

      this.tryEnterExit();
      this.updateElevatorProximity();
      this.updateAutoDoors();

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
        this.player.y = this.seated.seat.floorY - (this.seated.seat.surfaceH || 10);
        // Animation is owned by sitOn() (sit/lie intro → seated idle loop).
      } else if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        if (floor && !this._floorTween) {
          this.player.y = floor.floorY;
          // Horizontal room-to-room: walk into the doorway gap
          const passage = this.nearbyPassage();
          if (passage && ((vx > 0 && this.player.x > passage.x - 3) || (vx < 0 && this.player.x < passage.x + 3))) {
            const next = this.floors.get(passage.targetFloorId);
            if (next && next.floorY != null) {
              // Soft handoff into the neighbor room
              this.indoors.floorId = passage.targetFloorId;
              this.player.y = next.floorY;
              // Nudge past the door so you don't immediately bounce back
              this.player.x = passage.x + (vx > 0 ? 10 : -10);
              this.player.x = Phaser.Math.Clamp(this.player.x, next.minX, next.maxX);
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

      if (!this.seated && this.time.now >= (this._poseHoldUntil || 0)) {
        if (vx) {
          this.player.anims.play(`${this.playerSheet}_walk`, true);
          this.player.setFlipX(vx < 0);
        } else {
          this.player.anims.play(`${this.playerSheet}_idle`, true);
        }
      }
      this.playerTag.setPosition(this.player.x, this.player.y - 34);

      // Zone label + contextual hints
      let zone = 'lobby';
      if (this.seated) {
        zone = this.seated.seat.kind === 'bed' ? 'lying down' : 'sitting';
        this.setEnterHint(IS_TOUCH ? '▼ stand up' : '↓ / E stand up');
      } else if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        zone = floor?.isRoof ? 'Rooftop' : (floor?.label || this.indoors.floorId);
        const n = [...this.livePeople.values()].filter((p) => p.roomKey === floor?.roomKey).length;
        if (n) zone = `${zone} (${n})`;
        const doorHint = this.nearbyStairs();
        const seat = this.nearbySeat();
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
        } else if (seat) {
          this.setEnterHint(IS_TOUCH
            ? (seat.kind === 'bed' ? '▲ lie down' : '▲ sit')
            : (seat.kind === 'bed' ? 'E / ↑ lie on bed' : 'E / ↑ sit'));
        } else {
          this.setEnterHint(defaultIndoorHint());
        }
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

  requestAnimationFrame(() => requestAnimationFrame(bootPhaser));
})();
