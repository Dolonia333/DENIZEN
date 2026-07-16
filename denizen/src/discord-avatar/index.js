'use strict';

const catalog = require('./catalog');
const { getAvatarStore, AvatarStore } = require('./store');
const bake = require('./bake');
const roleCosmetics = require('./role-cosmetics');

module.exports = {
  ...catalog,
  getAvatarStore,
  AvatarStore,
  bakeSheet: bake.bakeSheet,
  bakePreview: bake.bakePreview,
  ensureBaked: bake.ensureBaked,
  premadePath: bake.premadePath,
  detectRoles: roleCosmetics.detectRoles,
  applyBoosterGoldenHeadset: roleCosmetics.applyBoosterGoldenHeadset,
  applyRoleCosmetics: roleCosmetics.applyRoleCosmetics,
  BOOSTER_GOLD: roleCosmetics.BOOSTER_GOLD,
};
