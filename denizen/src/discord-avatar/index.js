'use strict';

const catalog = require('./catalog');
const { getAvatarStore, AvatarStore } = require('./store');
const bake = require('./bake');

module.exports = {
  ...catalog,
  getAvatarStore,
  AvatarStore,
  bakeSheet: bake.bakeSheet,
  bakePreview: bake.bakePreview,
  ensureBaked: bake.ensureBaked,
  premadePath: bake.premadePath,
};
