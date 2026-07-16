'use strict';

/**
 * Role-based cosmetics for Discord Spaces avatars.
 *
 * Boosters (server boost / premiumSince / “boost” role name):
 *   → golden headsets (headsets.png + gold tint)
 *
 * Mods (Manage Guild / Admin / Moderate Members):
 *   → role:mod unlock (future cosmetics); no headset by default
 */

const catalog = require('./catalog');

const BOOSTER_GOLD = catalog.BOOSTER_HEADSET_GOLD || '#f0c14a';

/**
 * @param {object|null} member discord.js GuildMember-like
 */
function detectRoles(member) {
  let isMod = false;
  let isBooster = false;

  if (!member) {
    return {
      isMod: false,
      isBooster: false,
      unlocks: catalog.resolveUnlocks({}),
      labels: [],
    };
  }

  try {
    const perms = member.permissions;
    if (perms && typeof perms.has === 'function') {
      isMod = perms.has('Administrator')
        || perms.has('ManageGuild')
        || perms.has('ModerateMembers')
        || perms.has('KickMembers')
        || perms.has('BanMembers');
    }
  } catch (_) { /* ignore */ }

  if (member.premiumSince || member.premium_since) {
    isBooster = true;
  }

  try {
    const roles = member.roles?.cache
      ? [...member.roles.cache.values()]
      : (Array.isArray(member.roles) ? member.roles : []);
    for (const r of roles) {
      const name = String(r?.name || '').toLowerCase();
      if (/\b(boost|nitro)\b/.test(name)) isBooster = true;
    }
  } catch (_) { /* ignore */ }

  const labels = [];
  if (isBooster) labels.push('Booster');
  if (isMod) labels.push('Mod');

  return {
    isMod,
    isBooster,
    unlocks: catalog.resolveUnlocks({ isMod, isBooster }),
    labels,
  };
}

function hatIsManual(avatar) {
  return avatar?.hat?.source === 'manual';
}

/**
 * Equip golden headset for boosters when hat is not manually locked.
 *
 * @param {object} avatar
 * @param {{ isBooster?: boolean }} roles
 * @param {{ force?: boolean }} [opts]
 */
function applyBoosterGoldenHeadset(avatar, roles = {}, opts = {}) {
  const av = catalog.normalizeAvatar(avatar);
  if (!roles.isBooster) {
    return { avatar: av, applied: false, note: null };
  }

  const unlocks = [...new Set([...(av.unlocks || []), 'role:booster'])];

  if (!opts.force && hatIsManual(av) && av.hat?.set !== 'headsets') {
    // User chose a different hat manually — keep unlock, don't force headset
    return {
      avatar: catalog.normalizeAvatar({ ...av, unlocks }),
      applied: false,
      note: 'booster unlock only (hat is manual)',
    };
  }

  const next = {
    ...av,
    // Headsets only composite in layered mode
    mode: 'layers',
    hat: {
      set: 'headsets',
      index: Number.isFinite(av.hat?.index) ? av.hat.index : 0,
      source: 'role:booster',
    },
    tint: {
      hair: av.tint?.hair ?? null,
      clothes: av.tint?.clothes ?? null,
      hat: BOOSTER_GOLD,
      source: av.tint?.source === 'manual' ? 'manual' : 'role',
    },
    unlocks,
  };

  return {
    avatar: catalog.normalizeAvatar(next),
    applied: true,
    note: 'golden headset (booster)',
  };
}

/**
 * Apply all role cosmetics to an avatar from a guild member.
 */
function applyRoleCosmetics(avatar, member, opts = {}) {
  const roles = detectRoles(member);
  let av = catalog.normalizeAvatar({
    ...avatar,
    unlocks: [...new Set([...(avatar?.unlocks || []), ...roles.unlocks])],
  });

  // Drop auto booster headset if they stopped boosting
  if (
    !roles.isBooster
    && av.hat?.set === 'headsets'
    && (av.hat?.source === 'role:booster' || av.hat?.source === 'role')
  ) {
    av = catalog.normalizeAvatar({
      ...av,
      hat: { set: 'none', index: 0, source: null },
      tint: { ...av.tint, hat: null },
      unlocks: (av.unlocks || []).filter((u) => u !== 'role:booster'),
    });
  }

  const booster = applyBoosterGoldenHeadset(av, roles, opts);
  av = booster.avatar;

  return {
    avatar: av,
    roles,
    applied: booster.applied,
    notes: [booster.note].filter(Boolean),
    summary: [
      roles.labels.length ? roles.labels.join(' · ') : null,
      ...([booster.note].filter(Boolean)),
    ].filter(Boolean).join(' · ') || 'no role cosmetics',
  };
}

module.exports = {
  BOOSTER_GOLD,
  detectRoles,
  applyBoosterGoldenHeadset,
  applyRoleCosmetics,
  hatIsManual,
};
