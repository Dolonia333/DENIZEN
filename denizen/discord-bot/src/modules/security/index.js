'use strict';

const {
  canRunCommand,
  addFakePerm,
  removeFakePerm,
  runSecurityDoctor,
  FAKE_FLAGS,
} = require('../../core/permissions');

function createFakePerms(deps) {
  const { config } = deps;

  function register(registry) {
    registry.register({
      name: 'fakepermissions',
      description: 'Grant/revoke fake moderation permissions on a role',
      aliases: ['fakeperms', 'fp'],
      module: 'security',
      ownerOnly: true,
      options: [
        { name: 'action', description: 'add|remove|list|reset', type: 3, required: true },
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
          const map = config.get(ctx.guild.id).security.fakePermissions.roles;
          const lines = Object.entries(map).map(([rid, flags]) => `<@&${rid}>: ${flags.join(', ') || '(none)'}`);
          return ctx.reply(lines.length ? lines.join('\n') : 'No fake permissions set.');
        }
        if (action === 'reset') {
          config.update(ctx.guild.id, (c) => { c.security.fakePermissions.roles = {}; return c; });
          return ctx.reply('Fake permissions reset.');
        }
        if (!role) return ctx.reply('Specify a role.');
        if (action === 'add') {
          if (!perm) return ctx.reply(`Permission required. Flags: ${[...FAKE_FLAGS].join(', ')}`);
          const r = addFakePerm(config, ctx.guild.id, role.id, perm);
          if (!r.ok) return ctx.reply(`Failed: ${r.reason}`);
          return ctx.reply(`Added \`${perm}\` to ${role}.`);
        }
        if (action === 'remove') {
          if (!perm) return ctx.reply('Permission required.');
          removeFakePerm(config, ctx.guild.id, role.id, perm);
          return ctx.reply(`Removed \`${perm}\` from ${role}.`);
        }
        return ctx.reply('Actions: add|remove|list|reset');
      },
    });

    registry.register({
      name: 'security',
      description: 'Enable security suite / run doctor',
      module: 'security',
      ownerOnly: true,
      options: [
        { name: 'action', description: 'enable|disable|doctor|status', type: 3, required: true },
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
        if (action === 'doctor') {
          const report = await runSecurityDoctor(ctx.guild, ctx.client);
          if (report.ok) return ctx.reply(`✅ Security doctor OK (bot role: ${report.botRole}).`);
          return ctx.reply(`⚠️ Issues:\n• ${report.issues.join('\n• ')}`);
        }
        const s = config.get(ctx.guild.id).security;
        return ctx.reply(
          `security=${s.enabled} antinuke=${s.antinuke.enabled} antiraid=${s.antiraid.enabled} raidState=${s.antiraid.raidState}`,
        );
      },
    });
  }

  return { register };
}

module.exports = { createFakePerms };
