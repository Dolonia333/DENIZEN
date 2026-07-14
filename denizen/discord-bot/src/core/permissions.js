'use strict';

/**
 * Discord native perms + Bleed-style fake permissions.
 */

const FAKE_FLAGS = new Set([
  'administrator',
  'ban_members',
  'kick_members',
  'moderate_members',
  'manage_messages',
  'manage_nicknames',
  'manage_roles',
  'manage_channels',
  'mention_everyone',
  'view_audit_log',
  'manage_guild',
]);

function normalizeFlag(flag) {
  return String(flag || '').toLowerCase().replace(/\s+/g, '_');
}

function memberFakeFlags(config, member) {
  const map = config?.security?.fakePermissions?.roles || {};
  const flags = new Set();
  if (!member?.roles?.cache) return flags;
  for (const roleId of member.roles.cache.keys()) {
    const list = map[roleId] || [];
    for (const f of list) flags.add(normalizeFlag(f));
  }
  return flags;
}

function hasFakePerm(config, member, flag) {
  if (!flag) return true;
  const want = normalizeFlag(flag);
  const flags = memberFakeFlags(config, member);
  if (flags.has('administrator')) return true;
  return flags.has(want);
}

function isGuildOwner(guild, userId) {
  return guild?.ownerId === userId;
}

function isWhitelisted(list, userId) {
  return Array.isArray(list) && list.includes(String(userId));
}

/**
 * Gate a command: owner bypass; else require fakePerm if set, else Discord permission.
 */
function canRunCommand(ctx, cmd) {
  const { guild, member, user, config } = ctx;
  if (!guild || !user) return { ok: false, reason: 'guild_only' };
  if (cmd.ownerOnly && !isGuildOwner(guild, user.id)) {
    return { ok: false, reason: 'owner_only' };
  }
  if (isGuildOwner(guild, user.id)) return { ok: true };

  const cfg = typeof config?.get === 'function'
    ? config.get(guild.id)
    : config;
  if (cmd.fakePerm) {
    if (hasFakePerm(cfg, member, cmd.fakePerm)) return { ok: true };
    // Fallback: Discord Administrator still allowed for bootstrap
    if (member?.permissions?.has?.('Administrator')) return { ok: true };
    return { ok: false, reason: `missing_fake_perm:${cmd.fakePerm}` };
  }
  if (cmd.permission) {
    if (member?.permissions?.has?.(cmd.permission)) return { ok: true };
    return { ok: false, reason: `missing_perm:${cmd.permission}` };
  }
  return { ok: true };
}

function addFakePerm(configStore, guildId, roleId, flag) {
  const f = normalizeFlag(flag);
  if (!FAKE_FLAGS.has(f) && f !== 'administrator') {
    return { ok: false, reason: 'unknown_flag' };
  }
  configStore.update(guildId, (cfg) => {
    cfg.security.fakePermissions.roles[roleId] = cfg.security.fakePermissions.roles[roleId] || [];
    if (!cfg.security.fakePermissions.roles[roleId].includes(f)) {
      cfg.security.fakePermissions.roles[roleId].push(f);
    }
    return cfg;
  });
  return { ok: true };
}

function removeFakePerm(configStore, guildId, roleId, flag) {
  const f = normalizeFlag(flag);
  configStore.update(guildId, (cfg) => {
    const list = cfg.security.fakePermissions.roles[roleId] || [];
    cfg.security.fakePermissions.roles[roleId] = list.filter((x) => x !== f);
    return cfg;
  });
  return { ok: true };
}

async function runSecurityDoctor(guild, client) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const issues = [];
  if (!me) {
    issues.push('Cannot fetch bot member.');
    return { ok: false, issues };
  }
  if (!me.permissions.has('ViewAuditLog')) issues.push('Missing View Audit Log');
  if (!me.permissions.has('BanMembers')) issues.push('Missing Ban Members (needed for antinuke punish)');
  if (!me.permissions.has('KickMembers')) issues.push('Missing Kick Members');
  if (!me.permissions.has('ManageChannels')) issues.push('Missing Manage Channels (raid lock)');
  if (!me.permissions.has('ManageRoles')) issues.push('Missing Manage Roles (stripstaff / mute)');
  const highest = me.roles.highest;
  const dangerous = guild.roles.cache.filter((r) =>
    r.permissions.has('Administrator') || r.permissions.has('BanMembers') || r.permissions.has('ManageGuild'),
  );
  for (const role of dangerous.values()) {
    if (role.managed) continue;
    if (role.position >= highest.position && role.id !== highest.id) {
      issues.push(`Role @${role.name} is above or equal to bot — move Denizen higher`);
    }
  }
  return { ok: issues.length === 0, issues, botRole: highest?.name || null };
}

module.exports = {
  FAKE_FLAGS,
  normalizeFlag,
  memberFakeFlags,
  hasFakePerm,
  isGuildOwner,
  isWhitelisted,
  canRunCommand,
  addFakePerm,
  removeFakePerm,
  runSecurityDoctor,
};
