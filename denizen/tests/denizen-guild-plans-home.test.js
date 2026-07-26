'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const HOME = '1494164569440915496';
const OTHER = '1111111111111111111';

describe('denizen-guild-plans home guild', () => {
  const prevIds = process.env.DISCORD_HOME_GUILD_IDS;
  const prevId = process.env.DISCORD_HOME_GUILD_ID;

  afterEach(() => {
    if (prevIds === undefined) delete process.env.DISCORD_HOME_GUILD_IDS;
    else process.env.DISCORD_HOME_GUILD_IDS = prevIds;
    if (prevId === undefined) delete process.env.DISCORD_HOME_GUILD_ID;
    else process.env.DISCORD_HOME_GUILD_ID = prevId;
    // re-require fresh module state isn't needed — homeGuildIds() reads env each call
  });

  it('default home guild gets security for free; others do not', async () => {
    delete process.env.DISCORD_HOME_GUILD_IDS;
    delete process.env.DISCORD_HOME_GUILD_ID;
    const plans = require('../src/denizen-guild-plans.js');
    assert.equal(plans.isHomeGuild(HOME), true);
    assert.equal(plans.isHomeGuild(OTHER), false);
    assert.equal(await plans.isModuleAllowed(HOME, 'security'), true);
    assert.equal(await plans.isModuleAllowed(OTHER, 'security'), false);
    const homePlan = await plans.getGuildPlan(HOME);
    assert.equal(homePlan.active, true);
    assert.equal(homePlan.home, true);
  });

  it('DISCORD_HOME_GUILD_IDS=none disables the freebie', async () => {
    process.env.DISCORD_HOME_GUILD_IDS = 'none';
    const plans = require('../src/denizen-guild-plans.js');
    assert.equal(plans.isHomeGuild(HOME), false);
    assert.equal(await plans.isModuleAllowed(HOME, 'security'), false);
  });
});
