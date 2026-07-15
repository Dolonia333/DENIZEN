/* Pixel Spaces side-view — Discord channel map, generated live from the
 * connected guild's real categories/channels.
 *
 * Each Discord category becomes one themed building; channels inside it
 * become floors/rooms (roomKey === the real Discord channel id, so
 * presence maps 1:1 with no name-guessing). Theme is picked by keyword
 * match against the category name, falling back to a round-robin over
 * the theme kit so every server still looks varied. Voice-only categories
 * always get the voice lounge theme. Categories that read as "winter" or
 * "archaeology/dig" get a special static outdoor zone instead of a
 * building shell.
 */
(() => {
  const PACK = './PixelSpaces Free Pack';
  const FULL = './PixelSpaces Full Pack';
  const W = 980;
  const H = 420;
  const SCALE = 2;
  const WORLD_MAX = 6000; // background/ground drawn once at this width
  const MAX_ROOMS_PER_BUILDING = 2;
  const GAP = 60;

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
    return 'http://127.0.0.1:5180/presence';
  })();
  const PRESENCE_POLL_MS = 1500;

  const IA = `${FULL}/Individual Assets`;
  const EXP = `${FULL}/Expansions`;

  const ASSETS = {
    male: `${PACK}/Pre-made NPCs/Male.png`,
    female: `${PACK}/Pre-made NPCs/Female.png`,
    cloud: `${PACK}/Backgrounds/Cloud_1.png`,
    cloudSm: `${PACK}/Backgrounds/Cloud_small_3.png`,
    mountainL: `${PACK}/Backgrounds/Mountain_large_1.png`,
    mountainM: `${PACK}/Backgrounds/Mountain_medium_1.png`,
    mountainS: `${PACK}/Backgrounds/Mountain_small_1.png`,
    tree: `${PACK}/Backgrounds/Tree_medium.png`,
    houseRed: `${PACK}/Backgrounds/House_largel_red.png`,
    houseBeige: `${PACK}/Backgrounds/House_small_beige.png`,
    door: `${PACK}/Furniture/Door_opened.png`,
    doorClosed: `${PACK}/Furniture/Door_closed.png`,
    elevClosed: `${PACK}/Furniture/Elevator_closed.png`,
    elevOpen: `${PACK}/Furniture/Elevator_opened.png`,
    stairs: `${PACK}/Furniture/Stairs.png`,
    light1: `${PACK}/Furniture/Light_1.png`,
    light2: `${PACK}/Furniture/Light_2.png`,
    couchBlue: `${PACK}/Furniture/Living Room/Couch_large_2_blue.png`,
    couchGreen: `${PACK}/Furniture/Living Room/Couch_large_2_green.png`,
    couchRed: `${PACK}/Furniture/Living Room/Couch_large_2_red.png`,
    couchSmall: `${PACK}/Furniture/Living Room/Couch_small_2_blue.png`,
    couchSmallG: `${PACK}/Furniture/Living Room/Couch_small_2_green.png`,
    table: `${PACK}/Furniture/Living Room/Table_medium.png`,
    tableLong: `${PACK}/Furniture/Living Room/Table_long.png`,
    bookshelf: `${PACK}/Furniture/Living Room/Bookshelf_1.png`,
    bookshelfSm: `${PACK}/Furniture/Living Room/Bookshelf_small.png`,
    coffee: `${PACK}/Furniture/Living Room/Coffee_table_1.png`,
    windowSq: `${PACK}/Furniture/Living Room/Window_square.png`,
    curtain: `${PACK}/Furniture/Living Room/Curtain_medium_green.png`,
    curtainR: `${PACK}/Furniture/Living Room/Curtain_medium_red.png`,
    bed: `${PACK}/Furniture/Bedroom/Bed_red.png`,
    lamp: `${PACK}/Furniture/Bedroom/Lamp_stand_1.png`,
    laptop: `${PACK}/Furniture/Bedroom/Laptop.png`,
    drawer: `${PACK}/Furniture/Bedroom/Drawer_medium_1_c.png`,
    fridge: `${PACK}/Furniture/Kitchen/Refrigerator_large_white.png`,
    sink: `${PACK}/Furniture/Kitchen/Sink.png`,
    counter: `${PACK}/Furniture/Kitchen/Countertop.png`,
    counterEnd: `${PACK}/Furniture/Kitchen/Countertop_end.png`,
    box: `${PACK}/Objects/Bedroom/Box_blue_large.png`,
    boxSm: `${PACK}/Objects/Bedroom/Box_blue_small.png`,
    package: `${PACK}/Objects/Bedroom/Moving_package_small.png`,
    flora: `${PACK}/Objects/Living Room/Flora_poppy.png`,
    pot: `${PACK}/Objects/Living Room/Flowerpot_medium_green.png`,
    books: `${PACK}/Objects/Living Room/Books_outside_1.png`,

    // ---- Full pack: shared ----
    stool: `${IA}/Furniture/Living Room/Stool_red.png`,
    stoolB: `${IA}/Furniture/Living Room/Stool_blue.png`,
    tableMed2: `${IA}/Furniture/Living Room/Table_medium_2.png`,
    shelfMed: `${IA}/Furniture/Living Room/Shelf_medium.png`,
    officechair: `${IA}/Furniture/Living Room/Officechair_grey.png`,
    monitor: `${IA}/Objects/Bedroom/Monitor.png`,
    pc: `${IA}/Objects/Bedroom/PC.png`,
    gameConsole: `${IA}/Objects/Bedroom/Game_console.png`,
    trophy: `${IA}/Objects/Bedroom/Trophy.png`,
    trashcan: `${IA}/Objects/Living Room/Trashcan.png`,
    aquarium: `${IA}/Objects/Living Room/Aquarium.png`,
    floraFern: `${IA}/Objects/Living Room/Flora_fern.png`,
    floraBonsai: `${IA}/Objects/Living Room/Flora_bonsai.png`,
    mug: `${IA}/Objects/Kitchen/Mug.png`,
    glassJuice: `${IA}/Objects/Kitchen/Glass_juice.png`,
    benchWood: `${IA}/Backgrounds/Bench_wooden.png`,
    bush: `${IA}/Backgrounds/Bush.png`,
    treeWinterSnow: `${IA}/Backgrounds/Tree_winter_large_snow.png`,
    treeWinterMed: `${IA}/Backgrounds/Tree_winter_medium_snow.png`,
    mtnSnowL: `${IA}/Backgrounds/Mountain_large_snowy_1.png`,
    mtnSnowM: `${IA}/Backgrounds/Mountain_medium_snowy_1.png`,
    rockMed: `${IA}/Backgrounds/Rock_medium_1.png`,
    rockSm: `${IA}/Backgrounds/Rock_small_1.png`,
    signWood: `${IA}/Backgrounds/Sign_wooden.png`,
    bunkBottom: `${IA}/Furniture/Bedroom/Bunkbed_bottom_front_red.png`,
    bunkTop: `${IA}/Furniture/Bedroom/Bunkbed_top_front_red.png`,
    cabinet: `${IA}/Furniture/Bedroom/Cabinet_1.png`,

    // ---- Cafe ----
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
    npcBarista: `${EXP}/Cafe/Pre-made NPCs/female_npc_barista_1.png`,

    // ---- Gamer Room ----
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

    // ---- Hospital ----
    hospSign: `${EXP}/Hospital/Individual Assets/Hospital_sign_large.png`,
    hospLogo: `${EXP}/Hospital/Individual Assets/Hospital_logo.png`,
    bedHosp: `${EXP}/Hospital/Individual Assets/Bed_hospital_front.png`,
    ctScanner: `${EXP}/Hospital/Individual Assets/CT_scanner.png`,
    salineStand: `${EXP}/Hospital/Individual Assets/Saline_stand.png`,
    tableSurgery: `${EXP}/Hospital/Individual Assets/Table_surgery.png`,
    lightSurgery: `${EXP}/Hospital/Individual Assets/Light_surgery_white.png`,
    storageMed: `${EXP}/Hospital/Individual Assets/Storage_medical_white.png`,
    computerMed: `${EXP}/Hospital/Individual Assets/Computer_medical_white.png`,
    monitorMedWall: `${EXP}/Hospital/Individual Assets/Monitor_medical_mounted_white.png`,
    posterMed: `${EXP}/Hospital/Individual Assets/Poster_medical.png`,
    npcNurse: `${EXP}/Hospital/NPCs/npc_nurse_blue_female_1.png`,
    npcSurgeon: `${EXP}/Hospital/NPCs/npc_surgeon_male_1.png`,

    // ---- Museum ----
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

    // ---- Police Station ----
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
    clipboardWall: `${EXP}/Police Station/Individual Assets/Clipboard_wall_small.png`,
    npcCop: `${EXP}/Police Station/NPCs/Male/npc_cop_male_1.png`,

    // ---- Fire Station ----
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
    npcFirefighter: `${EXP}/Fire Station/NPCs/Male/npc_firefighter_male_1.png`,

    // ---- Halloween ----
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
    npcWitch: `${EXP}/Halloween/NPCs/npc_witch_1.png`,
    npcMummy: `${EXP}/Halloween/NPCs/npc_mummy_1.png`,
    npcSkeletonHW: `${EXP}/Halloween/NPCs/npc_skeleton.png`,

    // ---- Winter ----
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
    npcSanta: `${EXP}/Winter 2023/NPCs/npc_male_santa_1.png`,
    npcSweater: `${EXP}/Winter 2023/NPCs/npc_female_sweater_1.png`,

    // ---- Archaeology ----
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
    npcArch: `${EXP}/Archaeology/NPCs/npc_archaeologist_male_1.png`,
    npcArchF: `${EXP}/Archaeology/NPCs/npc_archaeologist_female_1.png`,
  };

  const NPC_SHEETS = [
    'npcBarista', 'npcNurse', 'npcSurgeon', 'npcCop', 'npcFirefighter',
    'npcWitch', 'npcMummy', 'npcSkeletonHW', 'npcSanta', 'npcSweater',
    'npcArch', 'npcArchF',
  ];

  // =========================================================================
  // Theme kit — each theme is a building shell (colors + optional sign) plus
  // 2 alternating room "recipes" (furniture layout). buildGenericBuilding()
  // cycles recipes when a category has more than one channel.
  // =========================================================================
  const THEME_KITS = {
    voice: {
      wall: 0x5865f2, side: 0x3c45c0, outline: 0x1a1f4a, roof: 0x7289da, band: 0x2b3190,
      title: { color: '#eef0ff', bg: '#3c45c0' },
      stripStyle: { color: '#eef0ff', bg: '#2b3190' },
      recipes: [
        () => ({
          h: 70, fill: 0xd8dff8, slots: [42, 70, 144, 176, 220],
          items: [
            ['w', 'curtain', 4, 3, 0.9], ['w', 'curtainR', 238, 3, 0.9],
            ['f', 'couchBlue', 56, 1, 0], ['f', 'coffee', 56, 1, 0],
            ['f', 'lamp', 102, 1, 0], ['f', 'couchSmall', 140, 1, 0],
            ['f', 'couchSmallG', 178, 1, 0], ['f', 'flora', 210, 1, 0],
            ['f', 'bookshelfSm', 240, 1, 0],
          ],
        }),
        () => ({
          h: 88, fill: 0xe8ecff, slots: [40, 64, 108, 130, 152, 198, 228],
          items: [
            ['glow', 0xa8b4ff, 0.14],
            ['w', 'light1', 121, 2],
            ['f', 'couchGreen', 52, 1, 0], ['f', 'coffee', 52, 1, 0],
            ['f', 'tableLong', 128, 1, 0], ['f', 'couchSmall', 106, 1, 0],
            ['f', 'couchSmallG', 150, 1, 0], ['f', 'couchRed', 206, 1, 0],
            ['f', 'lamp', 242, 1, 0], ['f', 'flora', 24, 1, 0], ['f', 'pot', 224, 1, 0],
          ],
        }),
      ],
    },
    hq: {
      wall: 0x45b866, side: 0x2f8f4a, outline: 0x12301a, roof: 0x359a52, band: 0x1e4a2a,
      title: { color: '#102818', bg: '#b8f0c8' },
      stripStyle: { color: '#e8ffe8', bg: '#1e4a2a' },
      recipes: [
        () => ({
          h: 74, fill: 0xead9b8, slots: [64, 90],
          items: [
            ['f', 'bookshelfSm', 18, 1, 0], ['f', 'box', 42, 1, 0], ['f', 'boxSm', 42, 1, 11],
            ['f', 'package', 62, 1, 0], ['f', 'box', 82, 1, 0], ['f', 'drawer', 104, 1, 0],
          ],
        }),
        () => ({
          h: 80, fill: 0xf0e0c0, slots: [64, 92, 40],
          items: [
            ['glow', 0xffe6a0, 0.1],
            ['w', 'curtainR', 3, 3, 0.8],
            ['f', 'couchGreen', 32, 1, 0], ['f', 'coffee', 32, 1, 0],
            ['f', 'tableLong', 78, 1, 0], ['f', 'couchSmall', 62, 1, 0],
            ['f', 'couchSmallG', 94, 1, 0], ['f', 'flora', 78, 1, 7],
          ],
        }),
      ],
    },
    cafe: {
      wall: 0xd88a5a, side: 0xb06a40, outline: 0x4a2410, roof: 0xc07048, band: 0x8a4e2c,
      signKey: 'cafeSign', signScale: SCALE,
      stripStyle: { color: '#ffe8d0', bg: '#6a3a1a' },
      recipes: [
        () => ({
          h: 70, fill: 0xf4e0c8, slots: [50, 90, 150, 200],
          items: [
            ['w', 'plantHang', 20, 2], ['w', 'posterDonut1', 70, 6], ['w', 'posterDonut2', 190, 6],
            ['f', 'tableMed2', 70, 1, 0], ['f', 'mug', 70, 1, 22],
            ['f', 'stool', 46, 1, 0], ['f', 'stool', 94, 1, 0],
            ['f', 'tableMed2', 175, 1, 0], ['f', 'glassJuice', 175, 1, 22],
            ['f', 'stoolB', 151, 1, 0], ['f', 'stoolB', 199, 1, 0], ['f', 'floraBonsai', 240, 1, 0],
          ],
        }),
        () => ({
          h: 88, fill: 0xf8ead2, slots: [120, 150, 185, 220],
          items: [
            ['glow', 0xffd8a0, 0.08],
            ['w', 'plantHang', 240, 2], ['w', 'cafeSignBoard', 150, 8],
            ['f', 'fridge', 18, 1, 0], ['f', 'counter', 52, 1, 0], ['f', 'counter', 68, 1, 0],
            ['f', 'counter', 84, 1, 0], ['f', 'counterEnd', 100, 1, 0],
            ['f', 'pastryPink', 54, 1, 26], ['f', 'pastryBlue', 74, 1, 26], ['f', 'pastryYellow', 94, 1, 26],
            ['npc', 'npcBarista', 36],
            ['f', 'tableLong', 180, 1, 0], ['f', 'stool', 156, 1, 0], ['f', 'stool', 205, 1, 0],
            ['f', 'plantLarge', 245, 1, 0],
          ],
        }),
      ],
      outside(scene, left, bw, groundY) {
        scene.furn('umbrellaRed', left - 34, groundY, 19);
        scene.furn('benchWood', left - 34, groundY, 20);
        scene.furn('umbrellaGreen', left + bw + 36, groundY, 19);
        scene.furn('benchWood', left + bw + 36, groundY, 20);
      },
    },
    gamer: {
      wall: 0x2a2a3e, side: 0x1c1c2c, outline: 0x0c0c16, roof: 0x3c3c58, band: 0x14142a,
      title: { color: '#c8f8ff', bg: '#1c1c2c' },
      stripStyle: { color: '#c8f8ff', bg: '#14142a' },
      recipes: [
        () => ({
          h: 70, fill: 0x3a3a54, slots: [70, 120, 190],
          items: [
            ['glow', 0x8a6aff, 0.1],
            ['w', 'gLight1', 30, 4], ['w', 'poster10', 95, 4], ['w', 'gLight2', 160, 4], ['w', 'poster11', 225, 4],
            ['f', 'deskOfficeLong', 60, 1, 0], ['f', 'monitor', 48, 1, 14], ['f', 'micDesk', 72, 1, 14],
            ['f', 'throneRed', 96, 1, 0], ['f', 'pc', 20, 1, 0],
            ['f', 'shelfMed', 170, 1, 0], ['f', 'headsetBlue', 170, 1, 26], ['f', 'trophy', 182, 1, 26],
            ['f', 'throneBlue', 215, 1, 0], ['f', 'tvGame', 236, 1, 30],
          ],
        }),
        () => ({
          h: 88, fill: 0x2e2e46, slots: [95, 130, 200, 235],
          items: [
            ['glow', 0x5a8aff, 0.12],
            ['w', 'gLight3', 60, 4], ['w', 'gLight1', 130, 4], ['w', 'gLight2', 200, 4],
            ['f', 'arcadeBlue', 24, 1, 0], ['f', 'arcadeRed', 56, 1, 0], ['f', 'arcadeGreen', 88, 1, 0],
            ['f', 'arcadeYellow', 120, 1, 0], ['f', 'vendingBlue', 165, 1, 0], ['f', 'vendingRed', 197, 1, 0],
            ['f', 'gameConsole', 232, 1, 0], ['f', 'trashcan', 250, 1, 0],
          ],
        }),
      ],
    },
    hospital: {
      wall: 0xe8ecf2, side: 0xc0c8d4, outline: 0x2a3444, roof: 0xd8e0ea, band: 0x9aa8ba,
      signKey: 'hospSign', signScale: SCALE * 0.9,
      stripStyle: { color: '#ffffff', bg: '#c0392b' },
      recipes: [
        () => ({
          h: 70, fill: 0xdaf0ea, slots: [60, 180],
          items: [
            ['w', 'lightSurgery', 105, 2], ['w', 'monitorMedWall', 165, 6], ['w', 'posterMed', 235, 6],
            ['f', 'tableSurgery', 105, 1, 0], ['f', 'storageMed', 25, 1, 0], ['f', 'salineStand', 135, 1, 0],
            ['npc', 'npcSurgeon', 80], ['f', 'computerMed', 210, 1, 0],
          ],
        }),
        () => ({
          h: 88, fill: 0xe8f4f0, slots: [130, 165, 225],
          items: [
            ['glow', 0xc8f0e0, 0.08],
            ['w', 'hospLogo', 145, 6], ['w', 'posterMed', 55, 8],
            ['f', 'bedHosp', 35, 1, 0], ['f', 'salineStand', 62, 1, 0], ['f', 'bedHosp', 95, 1, 0],
            ['npc', 'npcNurse', 140], ['f', 'computerMed', 185, 1, 0], ['f', 'storageMed', 225, 1, 0],
            ['f', 'floraFern', 250, 1, 0],
          ],
        }),
      ],
    },
    museum: {
      bw: 340,
      wall: 0xd8c8a8, side: 0xb8a888, outline: 0x3a2e1c, roof: 0xc8b896, band: 0x8a7a5a,
      title: { color: '#3a2e1c', bg: '#f0e4c8' },
      stripStyle: { color: '#f8f0d8', bg: '#5a4a30' },
      recipes: [
        () => ({
          h: 74, fill: 0x2a2848, slots: [70, 140, 230],
          items: [
            ['glow', 0x4a4a9a, 0.1],
            ['w', 'sun', 30, 6], ['w', 'earth', 75, 18], ['w', 'mars', 105, 10], ['w', 'jupiter', 145, 16],
            ['w', 'saturn', 195, 8], ['w', 'neptune', 240, 20], ['w', 'spaceship', 275, 10],
            ['f', 'itemDisplayM', 60, 1, 0], ['f', 'meteorite1', 60, 1, 15],
            ['f', 'itemDisplayL', 165, 1, 0], ['f', 'guardRail', 165, 1, 0],
          ],
        }),
        () => ({
          h: 96, fill: 0xf0e8d0, slots: [40, 90, 220, 260],
          items: [
            ['w', 'lightFixture', 150, 2], ['w', 'monaPixa', 40, 12], ['w', 'paintingNight', 260, 12],
            ['f', 'pillarMuseum', 12, 1, 0], ['f', 'pillarMuseum', 296, 1, 0],
            ['f', 'platformMuseum', 150, 1, 0], ['f', 'triceratops', 150, 1, 6],
            ['f', 'guardRail', 110, 1, 0], ['f', 'guardRail', 190, 1, 0],
            ['f', 'statueF', 55, 1, 0], ['f', 'statueM', 245, 1, 0],
            ['f', 'itemDisplayM', 80, 1, 0], ['f', 'megalodonJaw', 80, 1, 15],
          ],
        }),
      ],
    },
    police: {
      wall: 0x5a7a9a, side: 0x42607e, outline: 0x14202e, roof: 0x4a6a8a, band: 0x2a4058,
      signKey: 'policeSign', signScale: SCALE * 0.9,
      stripStyle: { color: '#d8e8f8', bg: '#1a2a3a' },
      recipes: [
        () => ({
          h: 70, fill: 0xb8c0c8, slots: [40, 210],
          items: [
            ['w', 'clipboardWall', 130, 6], ['w', 'portraitOfficer', 165, 6],
            ['f', 'deskOffice', 150, 1, 0], ['f', 'paperStack', 143, 1, 14],
            ['f', 'waitChairSolo', 185, 1, 0], ['f', 'filecabinet', 236, 1, 0],
          ],
          bars: true,
        }),
        () => ({
          h: 88, fill: 0xd0d8e0, slots: [60, 100, 180],
          items: [
            ['w', 'posterWanted', 30, 8], ['w', 'posterWanted2', 60, 8], ['w', 'policeLogo', 135, 6],
            ['f', 'policeDesk', 135, 1, 0], ['npc', 'npcCop', 135],
            ['f', 'waitChairs', 215, 1, 0], ['f', 'filecabinet', 25, 1, 0], ['f', 'floraFern', 250, 1, 0],
          ],
        }),
      ],
    },
    fire: {
      wall: 0xc84a3a, side: 0xa03828, outline: 0x3a0e08, roof: 0xb04030, band: 0x701e14,
      signKey: 'fireSign', signScale: SCALE * 0.85,
      stripStyle: { color: '#ffe0d0', bg: '#701e14' },
      doorKind: 'elev',
      recipes: [
        () => ({
          h: 70, fill: 0xf0dcc8, slots: [110, 170],
          items: [
            ['w', 'framedCert', 60, 6], ['w', 'portraitFF', 130, 6], ['w', 'fireAlarm', 200, 6],
            ['f', 'bunkBottom', 30, 1, 0], ['f', 'bunkTop', 30, 1, 22], ['f', 'cabinet', 75, 1, 0],
            ['f', 'boxEmergency', 145, 1, 0], ['f', 'bunkBottom', 220, 1, 0], ['f', 'bunkTop', 220, 1, 22],
          ],
        }),
        () => ({
          h: 88, fill: 0xe0d4c4, slots: [95, 150, 210],
          items: [
            ['glow', 0xffb090, 0.07],
            ['w', 'hoseWall', 100, 6], ['w', 'uniformHang', 150, 10], ['w', 'uniformHang2', 175, 10],
            ['w', 'fireLogo', 230, 6],
            ['f', 'locker', 20, 1, 0], ['f', 'locker', 50, 1, 0], ['f', 'rackEquip', 80, 1, 0],
            ['npc', 'npcFirefighter', 120], ['f', 'fireExt', 200, 1, 0], ['f', 'boxEmergency', 235, 1, 0],
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
      recipes: [
        () => ({
          h: 70, fill: 0x584668, slots: [80, 150, 220],
          items: [
            ['glow', 0x8a5aff, 0.08],
            ['w', 'cobwebRoom', 12, 2], ['w', 'lanternHang', 100, 2], ['w', 'cobwebRoom2', 245, 2],
            ['f', 'coffin', 40, 1, 0], ['f', 'candleTable', 75, 1, 0],
            ['npc', 'npcMummy', 125], ['f', 'lampGhost', 185, 1, 0], ['npc', 'npcSkeletonHW', 225],
          ],
        }),
        () => ({
          h: 88, fill: 0x6a5478, slots: [70, 130, 200],
          items: [
            ['glow', 0xff8a30, 0.06],
            ['w', 'chandelier', 130, 2], ['w', 'portraitDracula', 65, 8], ['w', 'cobwebRoom', 250, 2],
            ['f', 'bookshelfDark', 22, 1, 0], ['f', 'candelabra', 48, 1, 0], ['f', 'chairHalloween', 95, 1, 0],
            ['npc', 'npcWitch', 150], ['f', 'jack1', 180, 1, 0], ['f', 'jack2', 200, 1, 0],
            ['f', 'pumpkinBasket', 230, 1, 0], ['f', 'candleTable', 250, 1, 0],
          ],
        }),
      ],
      outside(scene, left, bw, groundY) {
        scene.furn('treeDeadL', left - 36, groundY, 18);
        scene.furn('treeDeadM', left + bw + 34, groundY, 18);
        scene.furn('lampPostHW', left + bw + 60, groundY, 19);
        scene.furn('billboardPumpkin', left - 62, groundY, 18);
        scene.trackObj(scene.add.image(left + bw / 2, 60, 'moonHW').setScale(SCALE).setDepth(-60));
        const ghost = scene.trackObj(scene.add.image(left - 20, groundY - 60, 'ghost1').setScale(SCALE).setDepth(19).setAlpha(0.8));
        scene.tweens.add({ targets: ghost, y: groundY - 80, x: left + 30, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const bat = scene.trackObj(scene.add.image(left + bw + 20, groundY - 120, 'bat1').setScale(SCALE).setDepth(19));
        scene.tweens.add({ targets: bat, x: left + bw + 90, y: groundY - 150, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      },
    },
  };
  const THEME_ROTATION = ['hq', 'cafe', 'gamer', 'hospital', 'museum', 'police', 'fire', 'halloween'];

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
      // Queue everything at once — hidden/background tabs can stall the
      // loader's batch refill, and the browser throttles connections anyway.
      this.load.maxParallelDownloads = Object.keys(ASSETS).length + 8;
      Object.entries(ASSETS).forEach(([k, p]) => {
        if (NPC_SHEETS.includes(k)) return;
        this.load.image(k, p);
      });
      this.load.spritesheet('maleSheet', ASSETS.male, { frameWidth: 16, frameHeight: 16 });
      this.load.spritesheet('femaleSheet', ASSETS.female, { frameWidth: 16, frameHeight: 16 });
      NPC_SHEETS.forEach((k) => {
        this.load.spritesheet(k, ASSETS[k], { frameWidth: 16, frameHeight: 16 });
      });
    }

    create() {
      this.groundY = 318;

      this.livePeople = new Map();
      this.roomSlots = new Map();
      this.floors = new Map();
      this.doors = [];
      this.stairs = [];
      this.passages = [];
      this.zones = [];
      this.travelPoints = [];
      this.decorNpcQueue = [];
      this.districtWidth = 1200;
      this._districtSignature = null;
      this.presenceEl = document.getElementById('presence-status');
      this.hintEl = document.getElementById('enter-hint');

      Object.keys(this.textures.list).forEach((key) => {
        if (key === '__DEFAULT' || key === '__MISSING') return;
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      });

      this.districtGroup = this.add.group();

      this.buildSky();
      this.buildFarMountains();
      this.buildDistantSkyline();
      this.drawGround();

      this.makeAnims();
      this.startPresenceLoop();

      this.player = this.physics.add.sprite(160, this.groundY - 1, 'maleSheet', 0)
        .setScale(SCALE)
        .setOrigin(0.5, 1)
        .setDepth(45)
        .setCollideWorldBounds(true);
      this.player.body.setSize(10, 6).setOffset(3, 10);
      this.physics.world.setBounds(0, 0, this.districtWidth, H);
      this.cameras.main.setBounds(0, 0, this.districtWidth, H);
      this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
      this.cameras.main.setZoom(1.0);
      this.cameras.main.setDeadzone(90, 50);

      this.playerTag = this.add.text(0, 0, 'you', {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 5, y: 2 },
      }).setOrigin(0.5, 1).setDepth(46).setResolution(3);

      const floor = this.add.rectangle(WORLD_MAX / 2, this.groundY + 24, WORLD_MAX + 120, 48, 0x000000, 0);
      this.physics.add.existing(floor, true);
      this.physics.add.collider(this.player, floor);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
      });
      this.shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

      const travelKeys = [
        Phaser.Input.Keyboard.KeyCodes.ONE, Phaser.Input.Keyboard.KeyCodes.TWO,
        Phaser.Input.Keyboard.KeyCodes.THREE, Phaser.Input.Keyboard.KeyCodes.FOUR,
        Phaser.Input.Keyboard.KeyCodes.FIVE, Phaser.Input.Keyboard.KeyCodes.SIX,
        Phaser.Input.Keyboard.KeyCodes.SEVEN, Phaser.Input.Keyboard.KeyCodes.EIGHT,
        Phaser.Input.Keyboard.KeyCodes.NINE, Phaser.Input.Keyboard.KeyCodes.ZERO,
        Phaser.Input.Keyboard.KeyCodes.MINUS,
      ];
      travelKeys.forEach((code, i) => {
        this.input.keyboard.addKey(code).on('down', () => {
          const tp = this.travelPoints[i];
          if (!tp) return;
          if (this.indoors) this.leaveBuilding();
          this.player.setPosition(tp[0], this.groundY - 1);
          this.cameras.main.flash(180, 255, 255, 255, false);
        });
      });

      this.roomEl = document.getElementById('room-label');
      if (this.roomEl) this.roomEl.textContent = 'connecting…';
      this.setEnterHint('waiting for the Discord bot to connect…');

      this.cameras.main.fadeIn(500, 126, 200, 232);
    }

    buildSky() {
      this.cameras.main.setBackgroundColor('#6eb8de');

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

      this.add.rectangle(W / 2, this.groundY - 28, W * 3, 56, 0xe8f6fc, 0.35)
        .setScrollFactor(0.15)
        .setDepth(-170);

      const sunX = 110;
      const sunY = 58;
      this.add.circle(sunX, sunY, 22, 0xfff3c0, 0.55).setScrollFactor(0.08).setDepth(-165);
      this.add.circle(sunX, sunY, 14, 0xffe08a, 0.9).setScrollFactor(0.08).setDepth(-164);

      const sprinkle = (x, y, key, sc, drift, scroll = 0.2) => {
        const shadow = this.add.image(x, y + 2, key)
          .setTint(0xffffff).setAlpha(0.22).setScale(sc * 1.05).setDepth(-126).setScrollFactor(scroll);
        const c = this.add.image(x, y, key)
          .setScale(sc).setAlpha(0.95).setDepth(-125).setScrollFactor(scroll);
        this.tweens.add({
          targets: [shadow, c], x: `+=${drift}`,
          duration: 16000 + Math.random() * 10000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      };
      for (let cx = 60; cx < WORLD_MAX; cx += 150) {
        const alt = (cx / 150) % 2 === 0;
        sprinkle(cx, 24 + ((cx / 150) % 3) * 14, alt ? 'cloud' : 'cloudSm', 2 + ((cx / 150) % 3) * 0.4, alt ? 38 : -30, 0.12 + ((cx / 150) % 4) * 0.02);
      }
    }

    buildFarMountains() {
      const farSpan = 0.28 * (WORLD_MAX - W) + W + 100;
      for (let x = 40, i = 0; x < farSpan; x += 120, i += 1) {
        const key = i % 3 === 0 ? 'mountainL' : (i % 3 === 1 ? 'mountainM' : 'mountainS');
        this.add.image(x, this.groundY - 6, key)
          .setScale(0.95 + (i % 4) * 0.14).setOrigin(0.5, 1)
          .setTint(0xb8c4d8).setAlpha(0.55).setDepth(-100).setScrollFactor(0.28);
      }

      const midSpan = 0.4 * (WORLD_MAX - W) + W + 100;
      for (let x = -20, i = 0; x < midSpan; x += 115, i += 1) {
        const snowy = x > midSpan * 0.72;
        const key = snowy
          ? (i % 2 === 0 ? 'mtnSnowL' : 'mtnSnowM')
          : (i % 3 === 0 ? 'mountainL' : (i % 3 === 1 ? 'mountainM' : 'mountainS'));
        this.add.image(x, this.groundY - 4, key)
          .setScale(1.1 + (i % 3) * 0.15).setOrigin(0.5, 1)
          .setAlpha(0.82 + (i % 3) * 0.04).setDepth(-90 - (i % 2)).setScrollFactor(0.4);
      }

      const hills = this.add.graphics().setDepth(-84).setScrollFactor(0.52);
      const hillSpan = 0.52 * (WORLD_MAX - W) + W + 100;
      for (let x = 150, i = 0; x < hillSpan; x += 160, i += 1) {
        hills.fillStyle(i % 2 ? 0x5e7e62 : 0x6a8a6e, 0.5 - (i % 3) * 0.05);
        hills.fillEllipse(x, this.groundY + 8, 120 + (i % 3) * 30, 40 + (i % 2) * 8);
      }
    }

    buildDistantSkyline() {
      const g = this.add.graphics().setDepth(-95).setScrollFactor(0.32).setAlpha(0.4);
      const base = this.groundY - 8;
      const span = 0.32 * (WORLD_MAX - W) + W + 60;
      for (let x = 8, i = 0; x < span; x += 90 + (i % 3) * 60, i += 1) {
        const h = 36 + (i % 5) * 10;
        g.fillStyle(i % 2 ? 0x8a6a78 : 0x9a8070, 1);
        g.fillRect(x, base - h, 18, h);
        g.fillStyle(0xffe6a0, 0.25);
        for (let wy = base - h + 6; wy < base - 8; wy += 10) {
          g.fillRect(x + 4, wy, 3, 3);
          g.fillRect(x + 10, wy, 3, 3);
        }
      }
    }

    /** Continuous earth strip under the walk line, drawn once at WORLD_MAX. */
    drawGround() {
      const g = this.add.graphics().setDepth(8);
      const top = this.groundY;
      const width = WORLD_MAX + 160;

      g.fillStyle(0x6e6578, 1);
      g.fillRect(-50, top - 2, width, 22);
      g.fillStyle(0x8a8294, 1);
      g.fillRect(-50, top - 2, width, 5);
      g.fillStyle(0x4a4254, 1);
      g.fillRect(-50, top + 16, width, 4);

      g.lineStyle(1, 0x3a3444, 0.45);
      for (let tx = -40; tx < WORLD_MAX + 60; tx += 28) {
        g.lineBetween(tx, top - 1, tx, top + 18);
      }

      g.fillStyle(0x4fa85a, 1);
      g.fillRect(-50, top - 7, width, 6);
      g.fillStyle(0x6bc86e, 1);
      g.fillRect(-50, top - 7, width, 2);

      const layers = [
        [0x5a4058, 24], [0x4a344a, 28], [0x3a283a, 34], [0x2a1c2c, 44], [0x1c121e, 140],
      ];
      let y = top + 20;
      layers.forEach(([c, h]) => {
        g.fillStyle(c, 1);
        g.fillRect(-50, y, width, h);
        y += h;
      });

      g.lineStyle(2, 0x120a12, 0.28);
      for (let ly = top + 40; ly < top + 210; ly += 16) {
        g.lineBetween(-40, ly, WORLD_MAX + 80, ly + 2);
      }

      g.fillStyle(0x7a6080, 0.25);
      for (let i = 0; i < 260; i += 1) {
        g.fillRect(-10 + (i * 41) % (WORLD_MAX + 20), top + 28 + (i * 17) % 150, 2 + (i % 3), 2);
      }

      const grass = this.add.graphics().setDepth(11);
      grass.fillStyle(0x5ed86a, 1);
      for (let gx = 10; gx < WORLD_MAX; gx += 13) {
        const h = 4 + (gx % 5);
        grass.fillRect(gx, top - 7 - h, 2, h);
        grass.fillRect(gx + 3, top - 9 - h, 2, h + 2);
      }
    }

    /** Track a dynamically-created game object so rebuildDistrict() can tear it down. */
    trackObj(obj) {
      if (obj && this.districtGroup) this.districtGroup.add(obj);
      return obj;
    }

    channelBadge(x, y, label, depth = 27) {
      return this.trackObj(this.add.text(x, y, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#0b0f14',
        backgroundColor: '#ffffff',
        padding: { x: 6, y: 4 },
      }).setOrigin(0, 0).setDepth(depth).setResolution(Math.max(2, window.devicePixelRatio || 2)));
    }

    buildingTitle(x, y, label, { color = '#ffffff', bg = '#222222', depth = 28 } = {}) {
      return this.trackObj(this.add.text(x, y, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color,
        backgroundColor: bg,
        padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setDepth(depth).setResolution(Math.max(2, window.devicePixelRatio || 2)));
    }

    stripLabel(x, y, label, { color = '#ffffff', bg = '#222222cc', depth = 28 } = {}) {
      return this.trackObj(this.add.text(x, y, label, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color,
        backgroundColor: bg,
        padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 0).setDepth(depth).setResolution(Math.max(2, window.devicePixelRatio || 2)));
    }

    // =====================================================================
    // Generic themed building: shell + stacked cutaway floors + doors.
    // Each entry in cfg.rooms becomes one Discord channel room.
    // =====================================================================
    drawThemeBuilding(cfg) {
      const g = this.trackObj(this.add.graphics().setDepth(20));
      const left = cfg.left;
      const bw = cfg.bw || 290;
      const doorStrip = 54;
      const bandH = 8;
      const roomsH = cfg.rooms.reduce((s, r) => s + r.h, 0);
      const bh = 18 + roomsH + bandH * (cfg.rooms.length - 1) + doorStrip;
      const top = this.groundY - bh;
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
        this.trackObj(this.add.image(left + bw / 2, top - 12, cfg.signKey)
          .setScale(cfg.signScale || SCALE).setOrigin(0.5, 1).setDepth(28));
      }
      if (cfg.title) {
        this.buildingTitle(left + bw / 2, top - (cfg.signKey ? 0 : 22), cfg.title.text, {
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
        this.channelBadge(padX + 4, y0 + 4, room.label);
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
        this.registerStairs({
          x: padX + roomW * (0.35 + 0.3 * (i % 2)),
          fromFloorId: floorDefs[i].id,
          toFloorId: floorDefs[i - 1].id,
          radius: 22,
        });
      }

      if (cfg.strip) {
        this.stripLabel(left + bw / 2, this.groundY - doorStrip + 6, cfg.strip.text, {
          color: cfg.strip.color, bg: cfg.strip.bg,
        });
      }

      const channelIds = cfg.rooms.map((r) => r.roomKey);
      this.zones.push({ minX: left - 20, maxX: left + bw + 20, label: cfg.zoneLabel || cfg.title?.text || '', channelIds });
      this.travelPoints.push([left + bw / 2, cfg.zoneLabel || '']);

      return { left, bw, top, bh, padX, roomW, floorDefs };
    }

    /**
     * Room item placement.
     * ['f', key, dx, scale?, dy?]        floor object, bottom-anchored
     * ['w', key, dx, dyFromTop, scale?]  wall/hanging object, top-anchored
     * ['npc', sheetKey, dx]              idle decor NPC
     * ['glow', color, alpha]             breathing room glow
     */
    placeRoomItems(room, x0, y0, floorY, roomW) {
      (room.items || []).forEach((it) => {
        const kind = it[0];
        if (kind === 'f') {
          const [, key, dx, sc, dy] = it;
          this.furn(key, x0 + dx, floorY - (dy || 0), 23, (sc || 1) * SCALE);
        } else if (kind === 'w') {
          const [, key, dx, dyTop, sc] = it;
          if (!this.textures.exists(key)) return;
          this.trackObj(this.add.image(x0 + dx, y0 + dyTop, key)
            .setScale((sc || 1) * SCALE).setOrigin(0.5, 0).setDepth(22));
        } else if (kind === 'npc') {
          const [, key, dx] = it;
          this.decorNpcQueue.push([key, x0 + dx, floorY]);
        } else if (kind === 'glow') {
          const [, color, alpha] = it;
          const glow = this.trackObj(this.add.rectangle(x0 + roomW / 2, y0 + room.h / 2, roomW - 16, room.h - 12, color, alpha).setDepth(21));
          this.tweens.add({ targets: glow, alpha: alpha + 0.08, duration: 1700, yoyo: true, repeat: -1 });
        }
      });
    }

    /**
     * Build one themed building for `channels` (max MAX_ROOMS_PER_BUILDING).
     * Each channel becomes one room, cycling the theme's recipe list.
     */
    buildGenericBuilding(theme, left, categoryLabel, channels) {
      const kit = THEME_KITS[theme];
      const rooms = channels.map((ch, i) => {
        const recipe = kit.recipes[i % kit.recipes.length]();
        return {
          id: `ch-${ch.id}`,
          roomKey: String(ch.id),
          label: this.channelLabel(ch),
          h: recipe.h,
          fill: recipe.fill,
          slots: recipe.slots,
          items: recipe.items,
          bars: recipe.bars,
        };
      });
      const b = this.drawThemeBuilding({
        left,
        bw: kit.bw,
        wall: kit.wall, side: kit.side, outline: kit.outline, roof: kit.roof, band: kit.band,
        signKey: kit.signKey, signScale: kit.signScale,
        title: kit.signKey ? undefined : { text: categoryLabel, color: kit.title.color, bg: kit.title.bg },
        zoneLabel: categoryLabel,
        strip: { text: `${categoryLabel} · ↑ enter`, color: kit.stripStyle.color, bg: kit.stripStyle.bg },
        doorKind: kit.doorKind,
        rooms,
      });

      // Police holding-cell bars overlay, when this building has a 'cells' recipe room.
      const barsRoomIdx = rooms.findIndex((r) => r.bars);
      if (barsRoomIdx !== -1) {
        const cellsTop = b.top + 12;
        for (let i = 0; i < 9; i += 1) {
          this.trackObj(this.add.image(b.padX + 14 + i * 7, cellsTop + rooms[barsRoomIdx].h - 2, 'prisonDoor')
            .setScale(SCALE).setOrigin(0.5, 1).setDepth(24));
        }
      }

      if (typeof kit.outside === 'function') kit.outside(this, b.left, b.bw, this.groundY);
      return b;
    }

    channelLabel(ch) {
      const prefix = (ch.type === 'voice' || ch.type === 'stage') ? '🔊 ' : '#';
      return `${prefix}${ch.name}`;
    }

    /**
     * Recessed doorway flush with ground — door/elev sit inside a carved frame
     * so they don't float over cutaway glass.
     */
    placeEntrance(g, cx, groundY, kind = 'door', lintelColor = 0x2a5534, depth = 26) {
      const key = kind === 'elev' ? 'elevClosed' : 'door';
      const scale = SCALE;
      const dw = (kind === 'elev' ? 26 : 13) * scale;
      const dh = 23 * scale;
      const frameW = Math.ceil(dw + 8);
      const frameH = Math.ceil(dh + 5);
      const fx = Math.round(cx - frameW / 2);
      const fy = Math.round(groundY - frameH);

      g.fillStyle(lintelColor, 1);
      g.fillRect(fx - 2, fy - 5, frameW + 4, 6);
      g.lineStyle(2, 0x0a0806, 1);
      g.strokeRect(fx - 2, fy - 5, frameW + 4, 6);

      g.fillStyle(0x0c0a08, 1);
      g.fillRect(fx, fy, frameW, frameH);

      g.fillStyle(0x3a2e22, 1);
      g.fillRect(fx, fy, 2, frameH);
      g.fillRect(fx + frameW - 2, fy, 2, frameH);

      g.fillStyle(0x1a1510, 1);
      g.fillRect(fx + 2, fy + 2, frameW - 4, frameH - 2);

      g.fillStyle(0x2c2118, 1);
      g.fillRect(fx - 1, groundY - 2, frameW + 2, 3);
      g.fillStyle(0x000000, 0.22);
      g.fillRect(fx, groundY, frameW, 2);

      g.lineStyle(2, 0x0a0806, 1);
      g.strokeRect(fx, fy, frameW, frameH);

      this.trackObj(this.add.image(cx, groundY - 1, key).setScale(scale).setOrigin(0.5, 1).setDepth(depth));

      return { fx, fy, frameW, frameH, dw, dh };
    }

    /** Place furniture sitting on a floor line (origin bottom-center). */
    furn(key, x, floorY, depth = 23, scale = SCALE) {
      if (!this.textures.exists(key)) return null;
      return this.trackObj(this.add.image(x, floorY, key).setScale(scale).setOrigin(0.5, 1).setDepth(depth));
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
      g.fillStyle(0xffffff, 0.1);
      g.fillRect(x + 3, y + 3, 8, h - 12);
      if (decorate) decorate();
    }

    /** Outdoor winter park — no building shell, an open themed zone. */
    drawWinterPark(left, groundY, cat) {
      const g = this.trackObj(this.add.graphics().setDepth(9));
      g.fillStyle(0xf0f6fc, 0.9);
      g.fillEllipse(left + 220, groundY - 2, 500, 18);

      this.furn('lampPostW', left - 10, groundY, 19);
      this.furn('xmasTree', left + 60, groundY, 20);
      this.furn('presentRedL', left + 92, groundY, 21);
      this.furn('presentGreenL', left + 108, groundY, 21);
      this.furn('presentBlueS', left + 122, groundY, 21);
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

      this.decorNpcQueue.push(['npcSanta', left + 345, groundY]);
      this.decorNpcQueue.push(['npcSweater', left + 180, groundY]);

      const points = [
        [left + 140, groundY - 1], [left + 220, groundY - 1],
        [left + 260, groundY - 1], [left + 310, groundY - 1],
      ];
      const channelIds = cat.channels.map((ch) => String(ch.id));
      channelIds.forEach((id) => this.addRoomSlots(id, points));
      this.zones.push({ minX: left - 60, maxX: left + 480, label: `⛄ ${cat.name}`, channelIds });
      this.travelPoints.push([left + 220, `⛄ ${cat.name}`]);

      for (let i = 0; i < 40; i += 1) {
        const fx = left - 40 + Math.random() * 540;
        const fy = 40 + Math.random() * 240;
        const flake = this.trackObj(this.add.circle(fx, fy, 1 + Math.random(), 0xffffff, 0.8).setDepth(30));
        this.tweens.add({
          targets: flake, y: groundY - 4, x: fx + (Math.random() * 40 - 20),
          duration: 5000 + Math.random() * 6000, repeat: -1, delay: Math.random() * 4000,
          onRepeat: () => flake.setY(30 + Math.random() * 60),
        });
      }
    }

    /** Outdoor archaeology dig — open zone, no building shell. */
    drawDigSite(left, groundY, cat) {
      const g = this.trackObj(this.add.graphics().setDepth(9));
      g.fillStyle(0xc8a878, 0.9);
      g.fillEllipse(left + 220, groundY - 2, 520, 18);
      g.fillStyle(0x8a6a44, 1);
      g.fillRect(left + 130, groundY - 4, 180, 14);
      g.lineStyle(2, 0x5a4428, 1);
      g.strokeRect(left + 130, groundY - 4, 180, 14);

      this.furn('signWood', left - 20, groundY, 19);
      this.furn('tentDig', left + 50, groundY, 18);
      this.furn('dirtPile', left + 120, groundY, 20);
      this.trackObj(this.add.image(left + 220, groundY + 8, 'dinoWhole').setScale(SCALE).setOrigin(0.5, 1).setDepth(21));
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
      this.furn('rockMed', left + 530, groundY, 19);
      this.furn('rockSm', left + 100, groundY, 19);

      this.decorNpcQueue.push(['npcArch', left + 195, groundY]);
      this.decorNpcQueue.push(['npcArchF', left + 305, groundY]);

      const points = [
        [left + 160, groundY - 1], [left + 240, groundY - 1],
        [left + 280, groundY - 1], [left + 350, groundY - 1],
      ];
      const channelIds = cat.channels.map((ch) => String(ch.id));
      channelIds.forEach((id) => this.addRoomSlots(id, points));
      this.zones.push({ minX: left - 40, maxX: left + 560, label: `⛏️ ${cat.name}`, channelIds });
      this.travelPoints.push([left + 240, `⛏️ ${cat.name}`]);
    }

    /** Decide a building theme (or special outdoor zone) for one category. */
    pickTheme(cat) {
      const name = String(cat.name || '').toLowerCase();
      const channels = cat.channels;
      const allVoice = channels.length > 0 && channels.every((c) => c.type === 'voice' || c.type === 'stage');
      if (allVoice || /voice|\bvc\b|\btalk\b/i.test(name)) return { kind: 'building', theme: 'voice' };
      for (const [re, theme] of SPECIAL_ZONE_THEMES) {
        if (re.test(name)) return { kind: 'zone', theme };
      }
      for (const [re, theme] of KEYWORD_THEMES) {
        if (re.test(name)) return { kind: 'building', theme };
      }
      const theme = THEME_ROTATION[this._rrIndex % THEME_ROTATION.length];
      this._rrIndex += 1;
      return { kind: 'building', theme };
    }

    /** Tear down the current district and regenerate it from live guild data. */
    rebuildDistrict(data) {
      if (this.indoors) this.leaveBuilding();
      if (this.districtGroup) this.districtGroup.clear(true, true);
      this.floors = new Map();
      this.doors = [];
      this.stairs = [];
      this.passages = [];
      this.zones = [];
      this.travelPoints = [];
      this.roomSlots = new Map();
      this.decorNpcQueue = [];
      this._rrIndex = 0;

      const rooms = (data.rooms || []).filter((r) => r.type !== 'category' && r.type !== 'other');
      const categoriesMeta = new Map((data.categories || []).map((c) => [c.id, c]));
      const byCat = new Map();
      for (const r of rooms) {
        const cid = r.categoryId || '__uncat__';
        if (!byCat.has(cid)) byCat.set(cid, []);
        byCat.get(cid).push(r);
      }

      const catList = [];
      for (const [cid, chans] of byCat) {
        const meta = cid === '__uncat__'
          ? { id: '__uncat__', name: data.guildName || 'general', position: -1 }
          : (categoriesMeta.get(cid) || { id: cid, name: chans[0]?.categoryName || 'channels', position: 0 });
        catList.push({ ...meta, channels: chans });
      }
      catList.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      let cursorX = 40;
      for (const cat of catList) {
        const decision = this.pickTheme(cat);
        if (decision.kind === 'zone') {
          if (decision.theme === 'winterzone') {
            this.drawWinterPark(cursorX, this.groundY, cat);
            cursorX += 480 + GAP;
          } else {
            this.drawDigSite(cursorX, this.groundY, cat);
            cursorX += 560 + GAP;
          }
          continue;
        }
        const totalChunks = Math.ceil(cat.channels.length / MAX_ROOMS_PER_BUILDING);
        for (let i = 0; i < cat.channels.length; i += MAX_ROOMS_PER_BUILDING) {
          const chunk = cat.channels.slice(i, i + MAX_ROOMS_PER_BUILDING);
          const chunkIdx = Math.floor(i / MAX_ROOMS_PER_BUILDING);
          const label = totalChunks > 1 ? `${cat.name} ${chunkIdx + 1}` : (cat.name || 'channels');
          const b = this.buildGenericBuilding(decision.theme, cursorX, label, chunk);
          cursorX += b.bw + GAP;
        }
      }

      this.districtWidth = Math.max(cursorX, 600);
      this.physics.world.setBounds(0, 0, this.districtWidth, H);
      this.cameras.main.setBounds(0, 0, this.districtWidth, H);
      if (this.player) {
        this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.districtWidth - 20);
      }
      this.flushDecorNpcQueue();
      if (this.roomEl) this.roomEl.textContent = 'street';
      this.setEnterHint('Walk to a door · ↑ / W enter · ↓ / S leave · 1-0 fast travel');
    }

    /** Spawn every queued decor NPC (pushed by placeRoomItems/outdoor zones) as a tracked sprite. */
    flushDecorNpcQueue() {
      for (const [key, x, floorY] of this.decorNpcQueue) {
        this.spawnChar(x, floorY, key, null, null, 31);
      }
      this.decorNpcQueue = [];
    }

    makeAnims() {
      if (this.anims.exists('idle_m')) return;
      this.anims.create({ key: 'idle_m', frames: [{ key: 'maleSheet', frame: 0 }] });
      this.anims.create({
        key: 'walk_m',
        frames: this.anims.generateFrameNumbers('maleSheet', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({ key: 'idle_f', frames: [{ key: 'femaleSheet', frame: 0 }] });
      this.anims.create({
        key: 'walk_f',
        frames: this.anims.generateFrameNumbers('femaleSheet', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }

    spawnChar(x, y, sheet, idle, label, depth = 30) {
      const sp = this.trackObj(this.add.sprite(x, y, sheet, 0).setScale(SCALE).setOrigin(0.5, 1).setDepth(depth));
      if (idle) sp.anims.play(idle);
      this.tweens.add({
        targets: sp, y: y - 1.5, duration: 700 + Math.random() * 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      if (label) {
        this.trackObj(this.add.text(x, y - 22, label, {
          fontFamily: 'Segoe UI, Tahoma, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#000000',
          padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 1).setDepth(depth + 1).setResolution(3));
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

    /** Live data maps roomKey directly to the real Discord channel id. */
    resolveRoomKey(person) {
      return person.channelId != null ? String(person.channelId) : null;
    }

    claimSlot(roomKey, userId) {
      const slots = this.roomSlots.get(roomKey) || [];
      let slot = slots.find((s) => s.takenBy === userId);
      if (slot) return slot;
      slot = slots.find((s) => !s.takenBy);
      if (!slot) {
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

    signatureOf(data) {
      const cats = (data.categories || []).map((c) => [c.id, c.position]);
      const chans = (data.rooms || [])
        .filter((r) => r.type !== 'category' && r.type !== 'other')
        .map((r) => [r.id, r.type, r.categoryId]);
      return JSON.stringify([cats, chans]);
    }

    startPresenceLoop() {
      const tick = async () => {
        try {
          const res = await fetch(PRESENCE_URL, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          const realRooms = (data.rooms || []).filter((r) => r.type !== 'category' && r.type !== 'other');
          if (realRooms.length > 0) {
            const sig = this.signatureOf(data);
            if (sig !== this._districtSignature) {
              this._districtSignature = sig;
              this.rebuildDistrict(data);
            }
          }

          this.applyPresence(data);
          const voiceN = (data.people || []).filter((p) => p.channelType === 'voice' || p.channelType === 'stage').length;
          const textN = (data.people || []).length - voiceN;
          this.setPresenceStatus(`live · ${data.guildName || data.guildId || 'guild'} · ${voiceN} in VC · ${textN} text`, true);
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
        if (!roomKey || !this.roomSlots.has(roomKey)) continue;
        want.set(String(p.userId), {
          userId: String(p.userId),
          displayName: String(p.displayName || 'member').slice(0, 16),
          roomKey,
          soft: !!p.soft,
        });
      }

      for (const [userId, live] of [...this.livePeople.entries()]) {
        if (!want.has(userId)) {
          this.releaseSlot(live.roomKey, userId);
          live.sprite?.destroy();
          live.tag?.destroy();
          this.livePeople.delete(userId);
        }
      }

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
          if (live.tag && live.tag.text !== person.displayName) {
            live.tag.setText(person.displayName);
          }
          live.sprite.setAlpha(person.soft ? 0.72 : 1);
        }
      }
    }

    spawnLivePerson(person) {
      const slot = this.claimSlot(person.roomKey, person.userId);
      const sheet = (Number(person.userId.slice(-1)) % 2 === 0) ? 'femaleSheet' : 'maleSheet';
      const idle = sheet === 'femaleSheet' ? 'idle_f' : 'idle_m';
      const depth = person.soft ? 30 : 32;

      const sprite = this.add.sprite(slot.x, slot.y, sheet, 0)
        .setScale(SCALE).setOrigin(0.5, 1).setDepth(depth).setAlpha(0);
      sprite.anims.play(idle);

      const tag = this.add.text(slot.x, slot.y - 22, person.displayName, {
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: person.soft ? '#334155' : '#5865f2',
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5, 1).setDepth(depth + 1).setResolution(3).setAlpha(0);

      this.tweens.add({ targets: [sprite, tag], alpha: person.soft ? 0.72 : 1, duration: 280, ease: 'Sine.easeOut' });
      this.tweens.add({
        targets: sprite, y: slot.y - 1.5, duration: 700 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      this.tweens.add({
        targets: tag, y: slot.y - 23.5, duration: 700 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });

      this.livePeople.set(person.userId, { sprite, tag, roomKey: person.roomKey, soft: person.soft });
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
      this.passages.push({
        x: def.x,
        fromFloorId: def.fromFloorId,
        toFloorId: def.toFloorId,
        radius: def.radius || 12,
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

    enterFloor(floorId, fromOutdoorX = null) {
      const floor = this.floors.get(floorId);
      if (!floor) return;
      const outdoorX = fromOutdoorX != null ? fromOutdoorX : this.player.x;
      this.indoors = { floorId, outdoorX };
      const spawnX = Phaser.Math.Clamp(this.player.x, floor.minX, floor.maxX);
      this.player.setPosition(spawnX, floor.floorY);
      this.player.setDepth(44);
      this.playerTag.setDepth(45);
      this.cameras.main.setZoom(1.55);
      this.setEnterHint('↓ / S leave · ↑ stairs · walk sideways');
    }

    leaveBuilding() {
      if (!this.indoors) return;
      const outX = this.indoors.outdoorX;
      this.indoors = null;
      this.player.setPosition(outX, this.groundY - 1);
      this.player.setDepth(45);
      this.playerTag.setDepth(46);
      this.cameras.main.setZoom(1.0);
      this.setEnterHint('Walk to a door · ↑ / W enter · ↓ / S leave · 1-0 fast travel');
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
      const up = Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.wasd.up);
      const down = Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.wasd.down);

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
      this.enterCooldown = (this.enterCooldown || 0) - this.game.loop.delta;

      this.tryEnterExit();

      let vx = 0;
      if (this.cursors.left.isDown || this.wasd.left.isDown) vx = -1;
      if (this.cursors.right.isDown || this.wasd.right.isDown) vx = 1;
      const speed = this.shiftKey?.isDown ? 200 : 110;
      this.player.setVelocityX(vx * speed);

      if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        if (floor) {
          this.player.y = floor.floorY;
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
        } else {
          // Floor vanished under us (district rebuilt) — bail outside.
          this.indoors = null;
          this.player.y = this.groundY - 1;
          this.cameras.main.setZoom(1.0);
        }
      } else {
        this.player.y = this.groundY - 1;
      }

      if (vx) {
        this.player.anims.play('walk_m', true);
        this.player.setFlipX(vx < 0);
      } else {
        this.player.anims.play('idle_m', true);
      }
      this.playerTag.setPosition(this.player.x, this.player.y - 22);

      let zone = 'street';
      if (this.indoors) {
        const floor = this.floors.get(this.indoors.floorId);
        zone = floor?.label || this.indoors.floorId;
        if (floor?.roomKey) {
          const n = [...this.livePeople.values()].filter((p) => p.roomKey === floor.roomKey).length;
          if (n) zone = `${zone} (${n})`;
        }
        const doorHint = this.nearbyStairs();
        if (doorHint?.dir === 'up') this.setEnterHint('↑ climb upstairs');
        else if (doorHint?.dir === 'down') this.setEnterHint('↓ go downstairs · or leave');
        else this.setEnterHint('↓ / S leave · ↑ stairs · A/D walk');
      } else {
        const x = this.player.x;
        const z = this.zones.find((zz) => x >= zz.minX && x <= zz.maxX);
        if (z) {
          zone = z.label;
          if (z.channelIds?.length) {
            const n = [...this.livePeople.values()].filter((p) => z.channelIds.includes(p.roomKey)).length;
            if (n) zone = `${zone} (${n})`;
          }
        }
        if (this.nearbyDoor()) this.setEnterHint('↑ / W enter building');
        else this.setEnterHint('A/D walk · Shift run · 1-0 fast travel');
      }
      if (this.roomEl) this.roomEl.textContent = zone;
    }
  }

  window.__pixelMapGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: document.getElementById('game-host'),
    width: W,
    height: H,
    backgroundColor: '#7ec8e8',
    pixelArt: false,
    antialias: true,
    roundPixels: true,
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: W,
      height: H,
    },
    scene: ExampleMapScene,
  });
})();
