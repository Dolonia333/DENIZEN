'use strict';

const catalog = require('./catalog');
const { getAvatarStore, AvatarStore } = require('./store');
const bake = require('./bake');
const roleCosmetics = require('./role-cosmetics');
const planGates = require('./plan-gates');

/**
 * Save + bake with plan enforcement (free = premade only).
 */
async function ensureBaked(store, userId, avatar, opts = {}) {
  const plan = planGates.resolvePlan(opts.plan);
  const isBooster = !!opts.isBooster;
  let { avatar: gated } = planGates.enforceAvatarPlan(avatar, userId, { plan, isBooster });
  if (opts.member) {
    const role = roleCosmetics.applyRoleCosmetics(gated, opts.member);
    gated = role.avatar;
    // Re-enforce so free users can't keep paid drip after role pass
    gated = planGates.enforceAvatarPlan(gated, userId, {
      plan,
      isBooster: isBooster || role.roles?.isBooster,
    }).avatar;
    if (role.roles?.isBooster) {
      const boost = roleCosmetics.applyBoosterGoldenHeadset(gated, { isBooster: true });
      gated = boost.avatar;
    }
  } else if (isBooster) {
    gated = roleCosmetics.applyBoosterGoldenHeadset(gated, { isBooster: true }).avatar;
  }
  return bake.ensureBaked(store, userId, gated);
}

module.exports = {
  ...catalog,
  getAvatarStore,
  AvatarStore,
  bakeSheet: bake.bakeSheet,
  bakePreview: bake.bakePreview,
  ensureBaked,
  premadePath: bake.premadePath,
  detectRoles: roleCosmetics.detectRoles,
  applyBoosterGoldenHeadset: roleCosmetics.applyBoosterGoldenHeadset,
  applyRoleCosmetics: roleCosmetics.applyRoleCosmetics,
  BOOSTER_GOLD: roleCosmetics.BOOSTER_GOLD,
  ...planGates,
};
