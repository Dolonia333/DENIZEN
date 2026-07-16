'use strict';

/**
 * Bleed-style variable substitution for welcome/tickets/messages.
 * {user} {user.name} {user.tag} {user.id} {server} {server.name}
 * {memberCount} {channel} {reason}
 */

function renderTemplate(template, ctx = {}) {
  let s = String(template || '');
  const user = ctx.user || ctx.member?.user;
  const guild = ctx.guild || ctx.member?.guild;
  const map = {
    '{user}': user ? `<@${user.id}>` : '',
    '{user.mention}': user ? `<@${user.id}>` : '',
    '{user.name}': user?.username || '',
    '{user.tag}': user?.tag || user?.username || '',
    '{user.id}': user?.id || '',
    '{server}': guild?.name || '',
    '{server.name}': guild?.name || '',
    '{server.id}': guild?.id || '',
    '{memberCount}': String(guild?.memberCount ?? ''),
    '{channel}': ctx.channel ? `<#${ctx.channel.id}>` : '',
    '{reason}': ctx.reason || '',
    '{mod}': ctx.mod ? `<@${ctx.mod.id}>` : '',
  };
  for (const [k, v] of Object.entries(map)) {
    s = s.split(k).join(v);
  }
  return s.slice(0, 2000);
}

module.exports = { renderTemplate };
