/**
 * BlockLife — named neighbors with homes, needs, relationships, and community life.
 * No jobs/workday — they hang out, visit, eat, rest, and bond. Phaser only renders.
 * Attaches to window.BlockLife.
 */
(() => {
  const FIRST = [
    'Mira', 'Ken', 'Ava', 'Leo', 'Nia', 'Sam', 'Rio', 'Jun',
    'Pax', 'Ivy', 'Omar', 'Zoe', 'Ren', 'Bea', 'Kai', 'Noa',
  ];
  // Soft community vibes (not jobs) — shown as flavor, never "working"
  const VIBES = [
    { id: 'neighbor', label: 'neighbor' },
    { id: 'regular', label: 'regular' },
    { id: 'host', label: 'host' },
    { id: 'wanderer', label: 'wanderer' },
    { id: 'chill', label: 'chill' },
    { id: 'storyteller', label: 'storyteller' },
    { id: 'caretaker', label: 'caretaker' },
    { id: 'musician', label: 'musician' },
  ];
  const TRAITS = ['friendly', 'shy', 'curious', 'grumpy', 'playful', 'loyal', 'dramatic'];

  /** Friendly activity labels for UI tags. */
  const ACT_LABELS = {
    sleep: 'sleeping',
    eat: 'eating',
    home: 'at home',
    hang: 'hanging out',
    visit: 'visiting',
    stroll: 'strolling',
    social: 'chatting',
    play: 'playing',
    chill: 'chilling',
    follow: 'with family',
    idle: 'around',
    dead: 'remembered',
  };

  function hash(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function pick(seed, arr, salt = 0) {
    if (!arr?.length) return null;
    return arr[(seed + salt) % arr.length];
  }

  function clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }

  /**
   * Create a block world for a guild map.
   * @param {{ guildId?: string, guildName?: string, sheetKeys: string[], buildingCount: number, roomKeys?: string[] }} opts
   */
  function createWorld(opts = {}) {
    const guildId = opts.guildId || 'local';
    const seed = hash(guildId + (opts.guildName || ''));
    const sheets = opts.sheetKeys?.length ? opts.sheetKeys : [];
    const buildingCount = Math.max(1, opts.buildingCount || 4);
    const roomKeys = opts.roomKeys || [];
    const count = Math.min(14, Math.max(8, 6 + Math.floor(buildingCount * 1.2)));

    const residents = [];
    for (let i = 0; i < count; i += 1) {
      const s = seed + i * 9973;
      const name = pick(s, FIRST, i * 3) + (i > 12 ? ` ${i}` : '');
      const vibe = pick(s, VIBES, i * 5);
      const sheet = sheets.length ? pick(s, sheets, i * 7) : null;
      const homeBuilding = i % buildingCount;
      const homeRoom = roomKeys.length ? pick(s, roomKeys, i * 11) : null;
      const stageRoll = (s % 100);
      let stage = 'adult';
      let age = 20 + (s % 25);
      if (stageRoll < 12) { stage = 'child'; age = 6 + (s % 8); }
      else if (stageRoll > 88) { stage = 'elder'; age = 60 + (s % 20); }

      residents.push({
        id: `r_${guildId}_${i}`,
        name,
        sheet,
        age,
        stage, // child | adult | elder
        alive: true,
        homeBuilding,
        homeRoom,
        // legacy fields kept for older callers; no work roles
        jobId: vibe.id,
        jobLabel: vibe.label,
        vibeId: vibe.id,
        vibeLabel: vibe.label,
        traits: [pick(s, TRAITS, 1), pick(s, TRAITS, 2)].filter((t, idx, a) => a.indexOf(t) === idx),
        needs: {
          hunger: 0.3 + ((s % 40) / 100),
          energy: 0.5 + ((s % 30) / 100),
          social: 0.4 + ((s % 35) / 100),
          fun: 0.45 + ((s % 25) / 100),
        },
        mood: 0.55,
        // partner / family
        partnerId: null,
        parentIds: [],
        childIds: [],
        // soft community day rhythm (block clock 0–23) — no work shifts
        schedule: {
          wake: 7 + (s % 2),
          brunch: 11,
          lunch: 13,
          evening: 18 + (s % 2),
          home: 20,
          sleep: 22 + (s % 2),
        },
        // runtime
        x: 0,
        y: 0,
        activity: 'hang',
        targetX: null,
        busyUntil: 0,
      });
    }

    // Seed relationships (friends / rivals / crushes)
    const rel = {}; // `${a}|${b}` -> { score, type }
    const keyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < residents.length; i += 1) {
      for (let j = i + 1; j < residents.length; j += 1) {
        const a = residents[i];
        const b = residents[j];
        if (a.stage === 'child' || b.stage === 'child') continue;
        const s = hash(a.id + b.id);
        if (s % 100 < 35) {
          const score = ((s % 80) / 100) - 0.15; // -0.15..0.65
          let type = 'acquaintance';
          if (score > 0.45) type = 'friend';
          else if (score < 0) type = 'rival';
          else if (score > 0.3 && s % 7 === 0) type = 'crush';
          rel[keyOf(a.id, b.id)] = { score, type, a: a.id, b: b.id };
        }
      }
    }

    // Pair some adults as partners
    const adults = residents.filter((r) => r.stage === 'adult' && r.alive);
    for (let i = 0; i + 1 < adults.length; i += 2) {
      if (hash(adults[i].id) % 100 < 40) {
        adults[i].partnerId = adults[i + 1].id;
        adults[i + 1].partnerId = adults[i].id;
        const k = keyOf(adults[i].id, adults[i + 1].id);
        rel[k] = { score: 0.85, type: 'partner', a: adults[i].id, b: adults[i + 1].id };
      }
    }

    // Children linked to a parent pair or single adult
    const kids = residents.filter((r) => r.stage === 'child');
    kids.forEach((kid, ki) => {
      const parent = adults[ki % Math.max(1, adults.length)];
      if (!parent) return;
      kid.parentIds = [parent.id];
      if (parent.partnerId) kid.parentIds.push(parent.partnerId);
      parent.childIds.push(kid.id);
      const partner = residents.find((r) => r.id === parent.partnerId);
      if (partner) partner.childIds.push(kid.id);
    });

    // Household pets (logical — scene binds sprites)
    const pets = [];
    adults.slice(0, Math.min(4, adults.length)).forEach((owner, i) => {
      pets.push({
        id: `pet_${i}`,
        kind: i % 2 === 0 ? 'dog' : 'cat',
        ownerId: owner.id,
        name: i % 2 === 0 ? pick(seed + i, ['Rex', 'Bean', 'Mochi', 'Scout'], i) : pick(seed + i, ['Luna', 'Miso', 'Pepper', 'Nori'], i),
      });
    });

    return {
      guildId,
      guildName: opts.guildName || 'Block',
      seed,
      hour: 10 + (seed % 6), // start mid-morning-ish
      day: 1,
      residents,
      relationships: rel,
      pets,
      events: [], // { t, text }
      memorials: [], // dead legends
      _accum: 0,
    };
  }

  function getRel(world, idA, idB) {
    if (!idA || !idB || idA === idB) return null;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return world.relationships[k] || null;
  }

  function bumpRel(world, idA, idB, delta, preferType) {
    if (!idA || !idB || idA === idB) return;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    let r = world.relationships[k];
    if (!r) {
      r = { score: 0.1, type: 'acquaintance', a: idA, b: idB };
      world.relationships[k] = r;
    }
    r.score = clamp01(r.score + delta);
    if (preferType) r.type = preferType;
    else if (r.score > 0.75 && r.type !== 'partner') r.type = 'friend';
    else if (r.score < 0.15 && r.score >= 0) r.type = 'acquaintance';
    else if (r.score < 0) r.type = 'rival';
    return r;
  }

  function pushEvent(world, text) {
    world.events.unshift({ t: world.day * 24 + world.hour, text: String(text).slice(0, 64) });
    if (world.events.length > 12) world.events.length = 12;
  }

  /** Desired community activity at current block hour (no workday). */
  function getActivity(resident, hour) {
    if (!resident.alive) return 'dead';
    const sc = resident.schedule || {};
    const wake = sc.wake ?? 7;
    const brunch = sc.brunch ?? 11;
    const lunch = sc.lunch ?? 13;
    const evening = sc.evening ?? 18;
    const home = sc.home ?? 20;
    const sleep = sc.sleep ?? 22;
    const seed = hash(resident.id + String(hour));

    if (resident.stage === 'child') {
      if (hour >= sleep || hour < wake) return 'sleep';
      if (hour >= lunch && hour < lunch + 1) return 'eat';
      if (hour >= 15 && hour < 18) return 'play';
      return 'follow';
    }

    if (hour >= sleep || hour < wake) return 'sleep';
    // Meals last longer so you actually see them go to plates
    if (hour >= brunch && hour < brunch + 2) return 'eat';
    if (hour >= lunch && hour < lunch + 2) return 'eat';
    // Occasional snack mid-afternoon
    if (hour === 16 && seed % 3 === 0) return 'eat';
    if (hour >= home && hour < sleep) return 'home';
    if (hour >= evening && hour < home) {
      // Evening block hangouts
      return seed % 3 === 0 ? 'social' : 'hang';
    }
    // Daytime: live on the block — stroll, visit friends, chill at home, hang out
    const dayActs = ['hang', 'stroll', 'visit', 'chill', 'social', 'hang'];
    return dayActs[seed % dayActs.length];
  }

  function activityLabel(act) {
    return ACT_LABELS[act] || act || 'around';
  }

  /**
   * Advance simulation.
   * @param world
   * @param dtSec real seconds
   * @param opts {{ nearbyPairs?: Array<[string,string]>, onEvent?: fn }}
   * Block time: 45 real seconds ≈ 1 block hour
   */
  function tick(world, dtSec, opts = {}) {
    if (!world) return [];
    const events = [];
    const hourLen = 45; // real seconds per block hour
    world._accum = (world._accum || 0) + dtSec;
    while (world._accum >= hourLen) {
      world._accum -= hourLen;
      world.hour += 1;
      if (world.hour >= 24) {
        world.hour = 0;
        world.day += 1;
        events.push(...dayRoll(world));
      }
      events.push(...hourRoll(world));
    }

    // Continuous need decay (per real second)
    const decay = dtSec * 0.004;
    world.residents.forEach((r) => {
      if (!r.alive) return;
      r.needs.hunger = clamp01(r.needs.hunger + decay * 1.1);
      r.needs.energy = clamp01(r.needs.energy + decay * (r.activity === 'sleep' ? -0.8 : 0.35));
      r.needs.social = clamp01(r.needs.social + decay * 0.5);
      r.needs.fun = clamp01(r.needs.fun + decay * 0.4);
      // mood from needs
      const pressure = (r.needs.hunger + (1 - r.needs.energy) + r.needs.social) / 3;
      r.mood = clamp01(0.75 - pressure * 0.5 + (r.partnerId ? 0.08 : 0));
      r.activity = getActivity(r, world.hour);
    });

    // Nearby social ticks from scene
    (opts.nearbyPairs || []).forEach(([a, b]) => {
      const ra = world.residents.find((r) => r.id === a);
      const rb = world.residents.find((r) => r.id === b);
      if (!ra?.alive || !rb?.alive) return;
      ra.needs.social = clamp01(ra.needs.social - 0.02);
      rb.needs.social = clamp01(rb.needs.social - 0.02);
      const r = bumpRel(world, a, b, 0.008);
      if (r && r.score > 0.7 && r.type === 'friend' && Math.random() < 0.02) {
        const msg = `${ra.name} & ${rb.name} are good friends`;
        pushEvent(world, msg);
        events.push(msg);
      }
      if (r && r.type === 'crush' && r.score > 0.65 && !ra.partnerId && !rb.partnerId && Math.random() < 0.01) {
        ra.partnerId = rb.id;
        rb.partnerId = ra.id;
        r.type = 'partner';
        r.score = 0.9;
        const msg = `${ra.name} & ${rb.name} fell in love`;
        pushEvent(world, msg);
        events.push(msg);
      }
      if (r && r.type === 'rival' && Math.random() < 0.015) {
        const msg = `${ra.name} argued with ${rb.name}`;
        pushEvent(world, msg);
        events.push(msg);
        bumpRel(world, a, b, -0.02, 'rival');
      }
    });

    events.forEach((e) => {
      if (typeof opts.onEvent === 'function') opts.onEvent(e);
    });
    return events;
  }

  function hourRoll(world) {
    const out = [];
    if (world.hour === 11) {
      pushEvent(world, 'Brunch vibes on the block');
      out.push('Brunch vibes on the block');
      world.residents.forEach((r) => {
        if (r.alive) r.needs.hunger = clamp01(r.needs.hunger - 0.25);
      });
    }
    if (world.hour === 13) {
      pushEvent(world, 'Neighbors share a meal');
      out.push('Neighbors share a meal');
      world.residents.forEach((r) => {
        if (r.alive) r.needs.hunger = clamp01(r.needs.hunger - 0.3);
      });
    }
    if (world.hour === 18) {
      pushEvent(world, 'Evening hang — doors open');
      out.push('Evening hang — doors open');
    }
    if (world.hour === 22) {
      pushEvent(world, 'Night falls — neighbors head home');
      out.push('Night falls — neighbors head home');
    }
    if (world.hour === 8) {
      pushEvent(world, 'Morning — the block wakes up');
      out.push('Morning — the block wakes up');
    }
    return out;
  }

  function dayRoll(world) {
    const out = [];
    // Rare death (elder, low mood)
    const elders = world.residents.filter((r) => r.alive && r.stage === 'elder' && r.mood < 0.25);
    if (elders.length && Math.random() < 0.12) {
      const r = elders[Math.floor(Math.random() * elders.length)];
      r.alive = false;
      r.activity = 'dead';
      world.memorials.push({ name: r.name, day: world.day, vibe: r.vibeLabel || r.jobLabel });
      // free partner
      if (r.partnerId) {
        const p = world.residents.find((x) => x.id === r.partnerId);
        if (p) p.partnerId = null;
      }
      const msg = `${r.name} passed away — remembered on the block`;
      pushEvent(world, msg);
      out.push(msg);
    }
    // Possible new child if happy partners and room
    const pairs = world.residents.filter((r) => r.alive && r.partnerId && r.stage === 'adult' && r.childIds.length < 2 && r.mood > 0.65);
    if (pairs.length >= 2 && world.residents.filter((r) => r.alive).length < 16 && Math.random() < 0.08) {
      const parent = pairs[0];
      const partner = world.residents.find((r) => r.id === parent.partnerId);
      const sheets = world.residents.map((r) => r.sheet).filter(Boolean);
      const kid = {
        id: `r_${world.guildId}_kid_${world.day}_${parent.id}`,
        name: pick(hash(parent.id + world.day), FIRST, world.day),
        sheet: pick(hash(parent.id), sheets, 3) || parent.sheet,
        age: 5,
        stage: 'child',
        alive: true,
        homeBuilding: parent.homeBuilding,
        homeRoom: parent.homeRoom,
        jobId: 'kid',
        jobLabel: 'kid',
        vibeId: 'kid',
        vibeLabel: 'kid',
        traits: ['playful'],
        needs: { hunger: 0.3, energy: 0.8, social: 0.2, fun: 0.2 },
        mood: 0.8,
        partnerId: null,
        parentIds: partner ? [parent.id, partner.id] : [parent.id],
        childIds: [],
        schedule: parent.schedule,
        activity: 'follow',
        x: parent.x,
        y: parent.y,
        targetX: null,
        busyUntil: 0,
      };
      world.residents.push(kid);
      parent.childIds.push(kid.id);
      if (partner) partner.childIds.push(kid.id);
      const msg = `${parent.name}${partner ? ` & ${partner.name}` : ''} welcomed ${kid.name}`;
      pushEvent(world, msg);
      out.push(msg);
    }
    return out;
  }

  /** Daylight 0 (midnight) … 1 (noon) for lighting. */
  function daylight(hour) {
    // 0–5 night, 6–8 dawn, 9–17 day, 18–20 dusk, 21–23 night
    if (hour >= 9 && hour < 17) return 1;
    if (hour >= 6 && hour < 9) return 0.45 + ((hour - 6) / 3) * 0.55;
    if (hour >= 17 && hour < 21) return 1 - ((hour - 17) / 4) * 0.75;
    return 0.18;
  }

  function isNight(hour) {
    return hour < 6 || hour >= 21;
  }

  window.BlockLife = {
    createWorld,
    tick,
    getActivity,
    activityLabel,
    getRel,
    bumpRel,
    daylight,
    isNight,
    pushEvent,
  };
})();
