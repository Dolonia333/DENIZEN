'use strict';

const {
  canRunCommand,
  addFakePerm,
  removeFakePerm,
  runSecurityDoctor,
  FAKE_FLAGS,
  stripDangerousFromRole,
  stripAllFakePermRoles,
  restoreRolePerms,
  isGuildOwner,
} = require('../../core/permissions');
const { securityDashboardEmbed, successEmbed, dangerEmbed, infoEmbed } = require('../../core/ui-kit');

/**
 * Bleed-style fake permissions + security suite control.
 * forceBotMod: strip Discord danger perms from staff roles; mod only via bot.
 */
function createFakePerms(deps) {
  const { config } = deps;

  function register(registry) {
    registry.register({
      name: 'fakepermissions',
      description: 'Fake perms + strip Discord danger perms (Bleed force bot-mod)',
      aliases: ['fakeperms', 'fp'],
      module: 'security',
      ownerOnly: true,
      options: [
        { name: 'action', description: 'add|remove|list|reset|strip|restore|force|harden|template', type: 3, required: true },
        { name: 'role', description: 'Target role', type: 8, required: false },
        { name: 'permission', description: 'Fake permission flag', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { ownerOnly: true }).ok) return ctx.reply('Owner only.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'list').toLowerCase();
        const role = ctx.interaction?.options?.getRole?.('role')
          || ctx.message?.mentions?.roles?.first?.()
          || null;
        const perm = ctx.getString?.('permission') || ctx.args?.[2] || ctx.args?.[1];

        if (action === 'list') {
          const fp = config.get(ctx.guild.id).security.fakePermissions;
          const map = fp.roles || {};
          const lines = Object.entries(map).map(([rid, flags]) => `<@&${rid}>: ${flags.join(', ') || '(none)'}`);
          return ctx.reply([
            `**forceBotMod:** ${fp.forceBotMod ? 'ON' : 'OFF'}`,
            lines.length ? lines.join('\n') : 'No fake permissions set.',
            `_Flags: ${[...FAKE_FLAGS].join(', ')}_`,
          ].join('\n'));
        }

        if (action === 'reset') {
          config.update(ctx.guild.id, (c) => {
            c.security.fakePermissions.roles = {};
            c.security.fakePermissions.forceBotMod = false;
            return c;
          });
          return ctx.reply('Fake permissions reset.');
        }

        if (action === 'force' || action === 'forcebotmod') {
          const on = !/^(off|0|false|no)$/i.test(String(perm || ctx.args?.[1] || 'on'));
          config.update(ctx.guild.id, (c) => {
            c.security.fakePermissions.forceBotMod = on;
            return c;
          });
          return ctx.reply(
            on
              ? '**forceBotMod ON** — mod commands require fakeperms (Discord Admin no longer bypasses). Run `,fp strip` next.'
              : '**forceBotMod OFF** — Discord Administrator can run mod cmds again.',
          );
        }

        if (action === 'strip') {
          if (role) {
            const r = await stripDangerousFromRole(role).catch((e) => ({ ok: false, reason: e.message }));
            if (!r.ok) return ctx.reply(`Strip failed: ${r.reason}`);
            config.update(ctx.guild.id, (c) => {
              c.security.fakePermissions.roleBackups = c.security.fakePermissions.roleBackups || {};
              c.security.fakePermissions.roleBackups[role.id] = r.previous;
              return c;
            });
            return ctx.reply(`Stripped dangerous Discord perms from ${role}. Backup saved (restore with \`,fp restore\`).`);
          }
          const results = await stripAllFakePermRoles(ctx.guild, config);
          const ok = results.filter((x) => x.ok).length;
          return ctx.reply(`Stripped **${ok}/${results.length}** fakeperm roles. Use \`,fp list\` to review.`);
        }

        if (action === 'restore') {
          if (!role) return ctx.reply('Usage: ,fp restore @role');
          const r = await restoreRolePerms(ctx.guild, config, role.id);
          if (!r.ok) return ctx.reply(`Restore failed: ${r.reason}`);
          return ctx.reply(`Restored Discord permissions on ${role}.`);
        }

        if (action === 'harden' || action === 'template') {
          // Full Bleed-style setup for a staff role: all mod fakeperms + strip + force
          if (!role) return ctx.reply('Usage: ,fp harden @ModRole');
          const flags = [
            'ban_members', 'kick_members', 'moderate_members', 'manage_messages',
            'manage_nicknames', 'view_audit_log',
          ];
          for (const f of flags) addFakePerm(config, ctx.guild.id, role.id, f);
          config.update(ctx.guild.id, (c) => {
            c.security.fakePermissions.forceBotMod = true;
            c.security.staffRoleIds = [...new Set([...(c.security.staffRoleIds || []), role.id])];
            c.security.enabled = true;
            return c;
          });
          const strip = await stripDangerousFromRole(role).catch((e) => ({ ok: false, reason: e.message }));
          if (strip.ok) {
            config.update(ctx.guild.id, (c) => {
              c.security.fakePermissions.roleBackups = c.security.fakePermissions.roleBackups || {};
              c.security.fakePermissions.roleBackups[role.id] = strip.previous;
              return c;
            });
          }
          return ctx.reply([
            `**Hardened** ${role} for Bleed-style bot-only moderation:`,
            `• Fakeperms: ${flags.join(', ')}`,
            `• forceBotMod: ON`,
            `• Discord danger perms: ${strip.ok ? 'stripped' : `failed (${strip.reason})`}`,
            `• Staff role registered for antinuke stripstaff`,
            `_Give mods this role only — do not give them Ban Members in Discord._`,
          ].join('\n'));
        }

        if (!role && (action === 'add' || action === 'remove')) {
          return ctx.reply('Specify a role.');
        }
        if (action === 'add') {
          if (!perm || FAKE_FLAGS.has(normalizeMaybe(perm)) === false && !FAKE_FLAGS.has(String(perm).toLowerCase())) {
            if (!perm) return ctx.reply(`Permission required. Flags: ${[...FAKE_FLAGS].join(', ')}`);
          }
          const r = addFakePerm(config, ctx.guild.id, role.id, perm);
          if (!r.ok) return ctx.reply(`Failed: ${r.reason}`);
          return ctx.reply(`Added \`${perm}\` to ${role}.`);
        }
        if (action === 'remove') {
          if (!perm) return ctx.reply('Permission required.');
          removeFakePerm(config, ctx.guild.id, role.id, perm);
          return ctx.reply(`Removed \`${perm}\` from ${role}.`);
        }
        return ctx.reply(
          'Actions: add|remove|list|reset|force on|off|strip [@role]|restore @role|harden @role',
        );
      },
    });

    registry.register({
      name: 'security',
      description: 'Enable security suite / doctor / status',
      module: 'security',
      ownerOnly: true,
      options: [
        { name: 'action', description: 'enable|disable|doctor|status|full', type: 3, required: true },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { ownerOnly: true }).ok) return ctx.reply('Owner only.');
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        if (action === 'enable' || action === 'on') {
          config.update(ctx.guild.id, (c) => { c.security.enabled = true; return c; });
          return ctx.reply('Security suite **enabled** (turn on antinuke/antiraid separately).');
        }
        if (action === 'disable' || action === 'off') {
          config.update(ctx.guild.id, (c) => { c.security.enabled = false; return c; });
          return ctx.reply('Security suite **disabled**.');
        }
        if (action === 'full') {
          config.update(ctx.guild.id, (c) => {
            c.security.enabled = true;
            c.security.antinuke.enabled = true;
            c.security.antiraid.enabled = true;
            c.security.antiraid.massjoin.enabled = true;
            for (const k of Object.keys(c.security.antinuke.modules || {})) {
              c.security.antinuke.modules[k] = true;
            }
            return c;
          });
          const report = await runSecurityDoctor(ctx.guild, ctx.client);
          return ctx.reply([
            '**Full security stack enabled** (antinuke + antiraid + all modules).',
            report.ok ? `Doctor: OK (bot role ${report.botRole})` : `Doctor:\n• ${report.issues.join('\n• ')}`,
            'Next: `,fp harden @Mod` then `,setup`',
          ].join('\n'));
        }
        if (action === 'doctor') {
          const report = await runSecurityDoctor(ctx.guild, ctx.client);
          if (report.ok) {
            return ctx.reply({
              embeds: [successEmbed('Security doctor', `OK · bot role **${report.botRole}**`)],
            });
          }
          return ctx.reply({
            embeds: [dangerEmbed('Security doctor', report.issues.map((i) => `• ${i}`).join('\n'))],
          });
        }
        const s = config.get(ctx.guild.id).security;
        return ctx.reply({ embeds: [securityDashboardEmbed(s)] });
      },
    });
  }

  return { register };
}

function normalizeMaybe(p) {
  return String(p || '').toLowerCase().replace(/\s+/g, '_');
}

module.exports = { createFakePerms };
