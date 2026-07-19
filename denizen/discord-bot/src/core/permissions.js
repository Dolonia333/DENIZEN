'use strict';

/**
 * Discord native perms + Bleed-style fake permissions.
 * forceBotMod: staff must use bot commands; Discord danger perms stripped from staff roles.
 */

const { PermissionFlagsBits } = require('discord.js');

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
  'manage_webhooks',
  'manage_expressions',
]);

/** Discord permissions that fake-perms staff should not hold on the role itself */
const DANGEROUS_DISCORD = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
];

const FAKE_TO_DISCORD = {
  ban_members: PermissionFlagsBits.BanMembers,
  kick_members: PermissionFlagsBits.KickMembers,
  moderate_members: PermissionFlagsBits.ModerateMembers,
  manage_messages: PermissionFlagsBits.ManageMessages,
  manage_nicknames: PermissionFlagsBits.ManageNicknames,
  manage_roles: PermissionFlagsBits.ManageRoles,
  manage_channels: PermissionFlagsBits.ManageChannels,
  mention_everyone: PermissionFlagsBits.MentionEveryone,
  view_audit_log: PermissionFlagsBits.ViewAuditLog,
  manage_guild: PermissionFlagsBits.ManageGuild,
  manage_webhooks: PermissionFlagsBits.ManageWebhooks,
  administrator: PermissionFlagsBits.Administrator,
};

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

function forceBotModEnabled(cfg) {
  return !!(cfg?.security?.fakePermissions?.forceBotMod);
}

/**
 * Gate a command: owner bypass; fakePerm when set; optional forceBotMod strips Discord Admin fallback.
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
    // When forceBotMod is on, Discord Administrator is NOT enough for mod cmds
    // (prevents staff from using both Discord native ban and bypassing thresholds).
    if (!forceBotModEnabled(cfg) && member?.permissions?.has?.('Administrator')) {
      return { ok: true };
    }
    // Still allow true Discord Administrator only if they also have fake admin
    // or forceBotMod is off (handled above).
    if (forceBotModEnabled(cfg)) {
      return { ok: false, reason: `force_bot_mod: need fakeperm ${cmd.fakePerm}` };
    }
    return { ok: false, reason: `missing_fake_perm:${cmd.fakePerm}` };
  }
  if (cmd.permission) {
    if (member?.permissions?.has?.(cmd.permission)) return { ok: true };
    // Fake admin / matching fake flag can substitute
    const mapped = {
      Administrator: 'administrator',
      BanMembers: 'ban_members',
      KickMembers: 'kick_members',
      ManageGuild: 'manage_guild',
      ManageChannels: 'manage_channels',
      ManageRoles: 'manage_roles',
      ManageMessages: 'manage_messages',
      ModerateMembers: 'moderate_members',
      ManageWebhooks: 'manage_webhooks',
      ManageNicknames: 'manage_nicknames',
      ViewAuditLog: 'view_audit_log',
    };
    const fake = mapped[cmd.permission] || mapped[String(cmd.permission)];
    if (fake && hasFakePerm(cfg, member, fake)) return { ok: true };
    return { ok: false, reason: `missing_perm:${cmd.permission}` };
  }
  return { ok: true };
}

function addFakePerm(configStore, guildId, roleId, flag) {
  const f = normalizeFlag(flag);
  if (!FAKE_FLAGS.has(f)) {
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

/**
 * Strip dangerous Discord permissions from a role; keep cosmetic + view/chat.
 * Returns previous bitfield for restore.
 */
async function stripDangerousFromRole(role) {
  if (!role || role.managed) return { ok: false, reason: 'managed_or_missing' };
  const prev = role.permissions.bitfield;
  // Remove dangerous bits, keep the rest
  let next = role.permissions;
  for (const bit of DANGEROUS_DISCORD) {
    if (next.has(bit)) next = next.remove(bit);
  }
  await role.setPermissions(next, 'Denizen fakeperms strip — force bot mod');
  return { ok: true, previous: prev.toString() };
}

/**
 * Apply strip to all roles that have fake permissions configured.
 */
async function stripAllFakePermRoles(guild, configStore) {
  const map = configStore.get(guild.id).security.fakePermissions.roles || {};
  const results = [];
  const backups = configStore.get(guild.id).security.fakePermissions.roleBackups || {};
  for (const roleId of Object.keys(map)) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      results.push({ roleId, ok: false, reason: 'not_found' });
      continue;
    }
    const r = await stripDangerousFromRole(role).catch((err) => ({ ok: false, reason: err.message }));
    if (r.ok && r.previous) backups[roleId] = r.previous;
    results.push({ roleId, name: role.name, ...r });
  }
  configStore.update(guild.id, (c) => {
    c.security.fakePermissions.roleBackups = backups;
    return c;
  });
  return results;
}

async function restoreRolePerms(guild, configStore, roleId) {
  const backups = configStore.get(guild.id).security.fakePermissions.roleBackups || {};
  const prev = backups[roleId];
  if (!prev) return { ok: false, reason: 'no_backup' };
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return { ok: false, reason: 'not_found' };
  await role.setPermissions(BigInt(prev), 'Denizen fakeperms restore');
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
  if (!me.permissions.has('ManageChannels')) issues.push('Missing Manage Channels (raid lock / restore)');
  if (!me.permissions.has('ManageRoles')) issues.push('Missing Manage Roles (stripstaff / mute / fakeperms)');
  const highest = me.roles.highest;
  const dangerous = guild.roles.cache.filter((r) =>
    r.permissions.has('Administrator') || r.permissions.has('BanMembers') || r.permissions.has('ManageGuild'),
  );
  for (const role of dangerous.values()) {
    if (role.managed) continue;
    if (role.id === guild.id) continue;
    if (role.position >= highest.position && role.id !== highest.id) {
      issues.push(`Role @${role.name} is above or equal to bot — move Denizen higher`);
    }
  }
  return { ok: issues.length === 0, issues, botRole: highest?.name || null };
}

module.exports = {
  FAKE_FLAGS,
  DANGEROUS_DISCORD,
  FAKE_TO_DISCORD,
  normalizeFlag,
  memberFakeFlags,
  hasFakePerm,
  isGuildOwner,
  isWhitelisted,
  forceBotModEnabled,
  canRunCommand,
  addFakePerm,
  removeFakePerm,
  stripDangerousFromRole,
  stripAllFakePermRoles,
  restoreRolePerms,
  runSecurityDoctor,
};
