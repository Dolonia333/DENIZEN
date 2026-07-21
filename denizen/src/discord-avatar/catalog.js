'use strict';

/**
 * Discord Spaces avatar catalog — premades, layer options, unlocks, events.
 */

const BODIES = [
  { id: 'light', label: 'Light', unlock: null },
  { id: 'white', label: 'Fair', unlock: null },
  { id: 'lightdark', label: 'Tan', unlock: null },
  { id: 'dark', label: 'Deep', unlock: null },
  { id: 'skeleton', label: 'Skeleton', unlock: 'event:halloween' },
  { id: 'gingerbread', label: 'Gingerbread', unlock: 'event:winter' },
];

const HAIR_SETS = [
  { id: 'none', label: 'None', count: 0 },
  { id: 'short', label: 'Short', count: 300, file: 'hair_short.png' }, // 50x6 variants
  { id: 'long', label: 'Long', count: 300, file: 'hair_long.png' }, // 50x6 variants
  { id: 'unique', label: 'Unique', count: 50, file: 'unique_hairstyles.png' },
];

const OUTFIT_SETS = [
  { id: 'outfits', label: 'Outfits', count: 650, file: 'outfits.png' }, // 50x13 variants
  { id: 'shirt', label: 'Shirts', count: 350, file: 'shirt.png' }, // 50x7 variants
  { id: 'jackets', label: 'Jackets', count: 50, file: 'jackets.png' },
  { id: 'apron', label: 'Aprons', count: 50, file: 'apron.png' },
];

const HAT_SETS = [
  { id: 'none', label: 'None', count: 0 },
  { id: 'hats', label: 'Hats', count: 400, file: 'hats.png' }, // 50x8 variants
  // Server boosters only — rendered with gold tint (see role-cosmetics / bake tint.hat)
  {
    id: 'headsets',
    label: 'Golden headset (Booster)',
    count: 350, // 50x7 variants
    file: 'headsets.png',
    unlock: 'role:booster',
  },
];

/** Hex used when baking booster golden headsets */
const BOOSTER_HEADSET_GOLD = '#f0c14a';

const TINTS = [
  { id: null, label: 'Natural' },
  { id: '#e8c4a8', label: 'Warm' },
  { id: '#a8c4e8', label: 'Cool' },
  { id: '#e8a8c4', label: 'Pink' },
  { id: '#a8e8b4', label: 'Mint' },
  { id: '#e8e0a8', label: 'Gold' },
  { id: '#c4a8e8', label: 'Violet' },
  { id: '#f0c14a', label: 'Booster gold', unlock: 'role:booster' },
  { id: '#ff6b4a', label: 'Ember', unlock: 'event:halloween' },
  { id: '#7ec8ff', label: 'Frost', unlock: 'event:winter' },
];

const PREMADES = [];
for (let i = 1; i <= 15; i += 1) {
  PREMADES.push({ id: `npc_m${i}`, label: `Male ${i}`, gender: 'm', index: i });
  PREMADES.push({ id: `npc_f${i}`, label: `Female ${i}`, gender: 'f', index: i });
}
// Special premades — render a non-standard spritesheet directly as the whole
// character (no hair/outfit layers), so they stay one consistent figure
// across every pose.
// - special:'body'  → a sheet in Body/ (standard 8×14 anim grid)
// - special:'hosp'  → a 5×3 MOVE/IDLE/JUMP sheet (Halloween/hospital packs),
//   expanded to the standard grid at bake time; file is relative to
//   discord-map/.
PREMADES.push({
  id: 'ghost',
  label: 'Ghost (Halloween)',
  special: 'hosp',
  file: 'PixelSpacesFull/Expansions/Halloween/NPCs/npc_ghost_2.png',
});
PREMADES.push({ id: 'skeleton', label: 'Skeleton', special: 'body', body: 'skeleton' });

/** Active world events → unlock ids. */
function getActiveEvents(now = new Date()) {
  const month = now.getUTCMonth() + 1; // 1-12
  const day = now.getUTCDate();
  const events = [];
  // Halloween season: Oct 1 – Nov 2
  if (month === 10 || (month === 11 && day <= 2)) {
    events.push({ id: 'halloween', label: 'Halloween', unlocks: ['event:halloween'] });
  }
  // Winter / holiday: Dec 1 – Jan 6
  if (month === 12 || (month === 1 && day <= 6)) {
    events.push({ id: 'winter', label: 'Winter', unlocks: ['event:winter'] });
  }
  return events;
}

function baseUnlocks() {
  return ['base'];
}

/**
 * @param {{ isMod?: boolean, isBooster?: boolean, extra?: string[] }} [opts]
 */
function resolveUnlocks(opts = {}) {
  const set = new Set([...baseUnlocks(), ...(opts.extra || [])]);
  for (const ev of getActiveEvents()) {
    for (const u of ev.unlocks) set.add(u);
  }
  if (opts.isMod) set.add('role:mod');
  // Discord server boost → golden headsets unlock
  if (opts.isBooster) set.add('role:booster');
  return [...set];
}

function isUnlocked(unlockId, unlocks) {
  if (!unlockId) return true;
  return (unlocks || []).includes(unlockId);
}

function filterByUnlock(items, unlocks) {
  return items.filter((it) => isUnlocked(it.unlock, unlocks));
}

function defaultAvatar(userId = '') {
  // Stable premade from user id hash (matches old map behavior).
  // Specials (ghost/skeleton) are opt-in only — never a random default.
  let h = 0;
  const s = String(userId || 'guest');
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  const standard = PREMADES.filter((p) => !p.special);
  const premade = standard[h % standard.length];
  return {
    v: 1,
    mode: 'premade',
    premade: premade.id,
    body: 'light',
    hair: { set: 'short', index: h % 12 },
    face: h % 10,
    eyes: h % 8,
    outfit: { set: 'outfits', index: h % 16 },
    pants: { index: h % 12 },
    hat: { set: 'none', index: 0, source: null },
    tint: { hair: null, clothes: null, hat: null, source: null },
    pet: { kind: null, enabled: false },
    unlocks: [],
    rev: 1,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePet(raw) {
  const kind = raw?.kind === 'cat' || raw?.kind === 'dog' ? raw.kind : null;
  const enabled = !!(raw?.enabled && kind);
  return { kind: enabled ? kind : (kind || null), enabled };
}

function normalizeAvatar(raw, userId = '') {
  const base = defaultAvatar(userId);
  if (!raw || typeof raw !== 'object') return base;
  const mode = raw.mode === 'layers' ? 'layers' : 'premade';
  let premade = String(raw.premade || base.premade);
  if (!PREMADES.some((p) => p.id === premade)) premade = base.premade;

  const bodyIds = new Set(BODIES.map((b) => b.id));
  const body = bodyIds.has(raw.body) ? raw.body : base.body;

  const hairSet = HAIR_SETS.find((h) => h.id === raw.hair?.set) || HAIR_SETS[1];
  const hairIndex = clampInt(raw.hair?.index, 0, Math.max(0, hairSet.count - 1));

  const outfitSet = OUTFIT_SETS.find((o) => o.id === raw.outfit?.set) || OUTFIT_SETS[0];
  const outfitIndex = clampInt(raw.outfit?.index, 0, Math.max(0, outfitSet.count - 1));

  const hatSet = HAT_SETS.find((h) => h.id === raw.hat?.set) || HAT_SETS[0];
  const hatIndex = clampInt(raw.hat?.index, 0, Math.max(0, hatSet.count - 1));
  const hatSource = ['manual', 'role', 'auto', 'role:booster'].includes(raw.hat?.source)
    ? raw.hat.source
    : null;

  const tintHair = normalizeTint(raw.tint?.hair);
  const tintClothes = normalizeTint(raw.tint?.clothes);
  const tintHat = normalizeTint(raw.tint?.hat);
  const tintSource = ['manual', 'discord', 'role', 'auto'].includes(raw.tint?.source)
    ? raw.tint.source
    : null;

  const pet = normalizePet(raw.pet);

  return {
    v: 1,
    mode,
    premade,
    body,
    hair: { set: hairSet.id, index: hairIndex },
    face: clampInt(raw.face ?? base.face, 0, 149), // faces.png 50x3
    eyes: clampInt(raw.eyes ?? base.eyes, 0, 99), // eyes.png 50x2
    outfit: { set: outfitSet.id, index: outfitIndex },
    pants: { index: clampInt(raw.pants?.index ?? base.pants.index, 0, 349) }, // pants.png 50x7
    hat: { set: hatSet.id, index: hatIndex, source: hatSource },
    tint: { hair: tintHair, clothes: tintClothes, hat: tintHat, source: tintSource },
    pet,
    unlocks: Array.isArray(raw.unlocks) ? raw.unlocks.map(String) : [],
    rev: clampInt(raw.rev ?? 1, 1, 1e9),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

function normalizeTint(t) {
  if (t == null || t === '' || t === 'null' || t === 'none') return null;
  const s = String(t).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]; const g = s[2]; const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function randomAvatar(userId, unlocks = resolveUnlocks()) {
  const bodies = filterByUnlock(BODIES, unlocks);
  const body = bodies[Math.floor(Math.random() * bodies.length)] || BODIES[0];
  const hairSets = HAIR_SETS.filter((h) => h.id !== 'none');
  const hair = hairSets[Math.floor(Math.random() * hairSets.length)];
  const outfit = OUTFIT_SETS[Math.floor(Math.random() * OUTFIT_SETS.length)];
  const hatPool = filterByUnlock(HAT_SETS, unlocks);
  const hat = hatPool[Math.floor(Math.random() * hatPool.length)] || HAT_SETS[0];
  const tintPool = filterByUnlock(TINTS, unlocks);
  const tintPick = tintPool[Math.floor(Math.random() * tintPool.length)];
  const standardPremades = PREMADES.filter((p) => !p.special);
  const premade = standardPremades[Math.floor(Math.random() * standardPremades.length)];
  const useLayers = Math.random() > 0.35;
  return normalizeAvatar({
    mode: useLayers ? 'layers' : 'premade',
    premade: premade.id,
    body: body.id,
    hair: { set: hair.id, index: Math.floor(Math.random() * Math.max(1, hair.count)) },
    face: Math.floor(Math.random() * 20),
    eyes: Math.floor(Math.random() * 12),
    outfit: { set: outfit.id, index: Math.floor(Math.random() * outfit.count) },
    pants: { index: Math.floor(Math.random() * 20) },
    hat: { set: hat.id, index: Math.floor(Math.random() * Math.max(1, hat.count || 1)) },
    tint: {
      hair: Math.random() > 0.6 ? tintPick.id : null,
      clothes: Math.random() > 0.7 ? tintPick.id : null,
    },
    unlocks,
    rev: 1,
  }, userId);
}

function publicCatalog(unlocks = resolveUnlocks()) {
  return {
    bodies: filterByUnlock(BODIES, unlocks),
    hairSets: HAIR_SETS,
    outfitSets: OUTFIT_SETS,
    hatSets: filterByUnlock(HAT_SETS, unlocks),
    tints: filterByUnlock(TINTS, unlocks),
    premades: PREMADES,
    events: getActiveEvents(),
    unlocks,
  };
}

function clientAvatar(avatar, userId) {
  const a = normalizeAvatar(avatar, userId);
  return {
    mode: a.mode,
    premade: a.premade,
    body: a.body,
    hair: a.hair,
    face: a.face,
    eyes: a.eyes,
    outfit: a.outfit,
    pants: a.pants,
    hat: a.hat,
    tint: a.tint,
    pet: a.pet,
    rev: a.rev,
    sheetUrl: `/api/discord/avatar/${encodeURIComponent(userId)}.png?v=${a.rev}`,
  };
}

module.exports = {
  BOOSTER_HEADSET_GOLD,
  BODIES,
  HAIR_SETS,
  OUTFIT_SETS,
  HAT_SETS,
  TINTS,
  PREMADES,
  getActiveEvents,
  baseUnlocks,
  resolveUnlocks,
  isUnlocked,
  filterByUnlock,
  defaultAvatar,
  normalizeAvatar,
  normalizePet,
  randomAvatar,
  publicCatalog,
  clientAvatar,
};
