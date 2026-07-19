'use strict';

/**
 * Monetization gates for Discord Spaces avatars.
 *
 * FREE
 *   - Premade NPCs only (30 characters — natural range of skin tones / looks)
 *   - Free skin tones: light, fair, tan, deep (body pick stored for paid upgrade)
 *
 * PAID (community | pro | paid)
 *   - Hair style + hair color (tint)
 *   - Clothes / outfits
 *   - Masks / faces
 *   - Hats
 *   - Headsets
 *
 * Companion pets are per-user entitlements (buy / gift / Pro grant), not a guild plan flag.
 *
 * Exception: server boosters still get golden headset on free (Discord boost perk).
 */

const catalog = require('./catalog');

const PAID_PLANS = new Set(['community', 'pro', 'paid', 'premium']);
const PET_KINDS = new Set(['cat', 'dog']);

/** Free skin tones only (no seasonal bodies). */
const FREE_SKIN_TONES = ['light', 'white', 'lightdark', 'dark'];

/**
 * Resolve plan string from env / guild config / request.
 * @param {string|object|null} planOrOpts
 */
function resolvePlan(planOrOpts = null) {
  if (planOrOpts && typeof planOrOpts === 'object') {
    const fromGuild = planOrOpts.plan || planOrOpts.spaces?.plan;
    if (fromGuild) return String(fromGuild).toLowerCase();
  }
  if (typeof planOrOpts === 'string' && planOrOpts.trim()) {
    return planOrOpts.trim().toLowerCase();
  }
  return String(process.env.DENIZEN_SPACES_PLAN || 'free').toLowerCase();
}

function isPaidPlan(plan) {
  return PAID_PLANS.has(resolvePlan(plan));
}

/**
 * Feature flags for a plan (+ optional booster).
 */
function planFeatures(plan, { isBooster = false } = {}) {
  const paid = isPaidPlan(plan);
  return {
    plan: resolvePlan(plan),
    paid,
    free: !paid,
    // Free
    premade: true,
    freeSkinTones: true,
    // Paid cosmetics
    hairStyle: paid,
    hairColor: paid,
    clothes: paid,
    masks: paid, // face layer
    hats: paid,
    headsets: paid || isBooster, // boosters always
    layersMode: paid, // full custom layers
    premiumTints: paid,
    // Pets: use denizen-guild-pets entitlements, not guild plan
    companionPet: false,
    upgradeHint: paid
      ? null
      : 'Upgrade for hair, clothes, masks, hats & headsets. Pets are bought per member (`/pet buy`) or granted by Pro staff.',
  };
}

/**
 * Strip paid cosmetics so free users stay on premade + free skin tone.
 * Booster golden headset still applied after this by role-cosmetics if eligible.
 *
 * @param {object} avatar
 * @param {string} userId
 * @param {{ plan?: string, isBooster?: boolean }} [opts]
 */
function enforceAvatarPlan(avatar, userId = '', opts = {}) {
  const plan = resolvePlan(opts.plan);
  const features = planFeatures(plan, { isBooster: !!opts.isBooster });
  let av = catalog.normalizeAvatar(avatar, userId);
  const locked = [];

  // Free skin tone only (no skeleton/gingerbread on free unless seasonal unlock handled elsewhere)
  if (features.free && !FREE_SKIN_TONES.includes(av.body)) {
    av.body = 'light';
    locked.push('seasonal_body');
  }

  if (!features.layersMode) {
    // Free: premade only — ignore hair/clothes/mask/hat choices for bake identity
    if (av.mode === 'layers') {
      av.mode = 'premade';
      locked.push('layers');
    }
    // Clear paid cosmetics so re-open on free doesn’t re-apply
    av.hair = { set: 'short', index: 0 };
    av.outfit = { set: 'outfits', index: 0 };
    av.pants = { index: 0 };
    av.face = 0;
    av.eyes = 0;
    if (!features.headsets) {
      av.hat = { set: 'none', index: 0, source: null };
      av.tint = { hair: null, clothes: null, hat: null, source: null };
    } else {
      // Booster may keep headset; strip other tints
      av.tint = {
        hair: null,
        clothes: null,
        hat: av.hat?.set === 'headsets' ? (av.tint?.hat || catalog.BOOSTER_HEADSET_GOLD) : null,
        source: av.hat?.set === 'headsets' ? 'role' : null,
      };
      if (av.hat?.set !== 'headsets') {
        av.hat = { set: 'none', index: 0, source: null };
      }
    }
    locked.push('hair', 'clothes', 'masks', 'hats');
  } else {
    // Paid: full layers allowed
    if (!features.hairColor && av.tint) {
      av.tint.hair = null;
    }
    if (!features.clothes && av.tint) {
      av.tint.clothes = null;
    }
    if (!features.headsets && av.hat?.set === 'headsets' && !opts.isBooster) {
      av.hat = { set: 'none', index: 0, source: null };
      if (av.tint) av.tint.hat = null;
      locked.push('headset');
    }
  }

  // Companion pet: keep equipped look in avatar JSON; entitlement is enforced
  // at command + presence time (per guild user), not via guild Pro.
  {
    const kind = PET_KINDS.has(av.pet?.kind) ? av.pet.kind : null;
    av.pet = { kind, enabled: !!(av.pet?.enabled && kind) };
  }

  av = catalog.normalizeAvatar(av, userId);
  return {
    avatar: av,
    features,
    locked: [...new Set(locked)],
    upgraded: features.paid,
  };
}

/**
 * Catalog options filtered for free vs paid (for closet UI).
 */
function publicCatalogForPlan(plan, unlocks = [], { isBooster = false } = {}) {
  const features = planFeatures(plan, { isBooster });
  const base = catalog.publicCatalog(unlocks);

  if (features.paid) {
    return {
      ...base,
      features,
      freeSkinTones: FREE_SKIN_TONES,
      monetization: {
        free: ['premade', 'skin_tones'],
        paid: ['hair', 'hair_color', 'clothes', 'masks', 'hats', 'headsets', 'companion_pet'],
      },
      pets: ['cat', 'dog'],
    };
  }

  // Free: only premades + free skin tones (bodies)
  return {
    ...base,
    features,
    bodies: base.bodies.filter((b) => FREE_SKIN_TONES.includes(b.id)),
    hairSets: [], // locked
    outfitSets: [],
    hatSets: features.headsets
      ? base.hatSets.filter((h) => h.id === 'none' || h.id === 'headsets')
      : base.hatSets.filter((h) => h.id === 'none'),
    tints: base.tints.filter((t) => t.id == null), // natural only
    freeSkinTones: FREE_SKIN_TONES,
    pets: [], // locked
    monetization: {
      free: ['premade', 'skin_tones'],
      paid: ['hair', 'hair_color', 'clothes', 'masks', 'hats', 'headsets', 'companion_pet'],
      upgradeHint: features.upgradeHint,
    },
  };
}

/**
 * Human-readable gate message for bot/API.
 */
function upgradeMessage(features) {
  if (features.paid) return null;
  return [
    '**Free plan:** choose a **premade** character (many skin tones in the cast).',
    '**Paid plan unlocks:** a **pet that follows you** on the map, plus hair, clothes, masks, hats & headsets.',
    features.upgradeHint || '',
    '_Server boosters still get a **golden headset** on free._',
  ].filter(Boolean).join('\n');
}

module.exports = {
  PAID_PLANS,
  PET_KINDS,
  FREE_SKIN_TONES,
  resolvePlan,
  isPaidPlan,
  planFeatures,
  enforceAvatarPlan,
  publicCatalogForPlan,
  upgradeMessage,
};
