'use strict';

const { EmbedBuilder, Colors } = require('discord.js');
const { canRunCommand } = require('../../core/permissions');

const EVENT_KEYS = [
  'messageDelete', 'messageEdit', 'memberJoin', 'memberLeave',
  'memberBan', 'voice', 'roles', 'channels', 'mod',
];

/**
 * Server event logging with embeds + per-event toggles + ignore lists.
 */
function createLogging(deps) {
  const { config } = deps;

  function logCfg(guildId) {
    return config.get(guildId).logging || {};
  }

  function events(guildId) {
    return logCfg(guildId).events || {};
  }

  function ignored(guildId, channelId, userId) {
    const L = logCfg(guildId);
    if (channelId && (L.ignoreChannels || []).includes(channelId)) return true;
    if (userId && (L.ignoreUsers || []).includes(userId)) return true;
    return false;
  }

  async function sendLog(guild, { title, description, color, fields } = {}) {
    const L = logCfg(guild.id);
    if (!L.enabled && !config.get(guild.id).security.logChannelId) return;
    const id = (L.enabled && L.channelId) || config.get(guild.id).security.logChannelId;
    if (!id) return;
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (!ch?.isTextBased?.()) return;

    if (L.embeds === false) {
      const text = `**${title || 'Log'}**\n${description || ''}`.slice(0, 1900);
      await ch.send({ content: text }).catch(() => {});
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(color || Colors.Blurple)
      .setTitle(title || 'Server log')
      .setDescription((description || '').slice(0, 4000) || null)
      .setTimestamp(new Date());
    if (fields?.length) {
      embed.addFields(fields.slice(0, 10).map((f) => ({
        name: String(f.name).slice(0, 256),
        value: String(f.value).slice(0, 1024),
        inline: !!f.inline,
      })));
    }
    await ch.send({ embeds: [embed] }).catch(() => {});
  }

  async function onMessageDelete(message) {
    if (!message.guild || message.author?.bot) return;
    if (!events(message.guild.id).messageDelete) return;
    if (ignored(message.guild.id, message.channel?.id, message.author?.id)) return;
    await sendLog(message.guild, {
      title: 'Message deleted',
      color: Colors.Red,
      description: (message.content || '[embed/attachment]').slice(0, 1000),
      fields: [
        { name: 'Author', value: `${message.author?.tag || '?'} (\`${message.author?.id}\`)`, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      ],
    });
  }

  async function onMessageUpdate(oldMsg, newMsg) {
    if (!newMsg.guild || newMsg.author?.bot) return;
    if (!events(newMsg.guild.id).messageEdit) return;
    if (oldMsg.content === newMsg.content) return;
    if (ignored(newMsg.guild.id, newMsg.channel?.id, newMsg.author?.id)) return;
    await sendLog(newMsg.guild, {
      title: 'Message edited',
      color: Colors.Orange,
      fields: [
        { name: 'Author', value: `${newMsg.author?.tag}`, inline: true },
        { name: 'Channel', value: `<#${newMsg.channel.id}>`, inline: true },
        { name: 'Before', value: (oldMsg.content || '—').slice(0, 500) || '—' },
        { name: 'After', value: (newMsg.content || '—').slice(0, 500) || '—' },
        { name: 'Jump', value: newMsg.url || '—' },
      ],
    });
  }

  async function onMemberAdd(member) {
    if (!events(member.guild.id).memberJoin) return;
    await sendLog(member.guild, {
      title: 'Member joined',
      color: Colors.Green,
      description: `${member.user.tag} (\`${member.id}\`)`,
      fields: [
        { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Members', value: String(member.guild.memberCount), inline: true },
      ],
    });
  }

  async function onMemberRemove(member) {
    if (!events(member.guild.id).memberLeave) return;
    await sendLog(member.guild, {
      title: 'Member left',
      color: Colors.DarkGrey,
      description: `${member.user?.tag || member.id}`,
    });
  }

  async function onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild || !events(guild.id).voice) return;
    if (oldState.channelId === newState.channelId) return;
    const user = newState.member?.user || oldState.member?.user;
    if (!user || user.bot) return;
    let desc = '';
    if (!oldState.channelId && newState.channelId) desc = `joined <#${newState.channelId}>`;
    else if (oldState.channelId && !newState.channelId) desc = `left <#${oldState.channelId}>`;
    else desc = `<#${oldState.channelId}> → <#${newState.channelId}>`;
    await sendLog(guild, {
      title: 'Voice update',
      color: Colors.Blue,
      description: `**${user.tag}** ${desc}`,
    });
  }

  async function onAudit(evt) {
    if (!evt.guild) return;
    const ev = events(evt.guildId);
    if (evt.kind === 'ban' && ev.memberBan) {
      await sendLog(evt.guild, {
        title: 'Member banned',
        color: Colors.DarkRed,
        description: `Target \`${evt.targetId}\` by <@${evt.executorId}>`,
      });
    }
    if ((evt.kind === 'roleDelete' || evt.kind === 'roleCreate') && ev.roles) {
      await sendLog(evt.guild, {
        title: `Role ${evt.kind === 'roleDelete' ? 'deleted' : 'created'}`,
        color: Colors.Purple,
        description: `by <@${evt.executorId}> target=\`${evt.targetId}\``,
      });
    }
    if ((evt.kind === 'channelDelete' || evt.kind === 'channelCreate') && ev.channels) {
      await sendLog(evt.guild, {
        title: `Channel ${evt.kind === 'channelDelete' ? 'deleted' : 'created'}`,
        color: Colors.Aqua,
        description: `by <@${evt.executorId}> target=\`${evt.targetId}\``,
      });
    }
  }

  function register(registry) {
    registry.register({
      name: 'log',
      description: 'Configure server event logging (embeds + toggles)',
      aliases: ['logging'],
      module: 'logging',
      permission: 'ManageGuild',
      options: [
        { name: 'action', description: 'on|off|status|event|ignore|embeds', type: 3, required: true },
        { name: 'value', description: 'event name or on/off', type: 3, required: false },
      ],
      async run(ctx) {
        if (!canRunCommand(ctx, { permission: 'ManageGuild' }).ok) {
          return ctx.reply('Need Manage Guild.');
        }
        const action = (ctx.getString?.('action') || ctx.args?.[0] || 'status').toLowerCase();
        const value = (ctx.getString?.('value') || ctx.args?.[1] || '').toLowerCase();

        if (action === 'on') {
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => {
            c.logging.enabled = true;
            c.logging.channelId = ch.id;
            c.logging.embeds = c.logging.embeds !== false;
            c.security.logChannelId = c.security.logChannelId || ch.id;
            return c;
          });
          return ctx.reply(`Logging **on** → ${ch} (embeds on). Toggle events with \`,log event messageDelete off\`.`);
        }
        if (action === 'off') {
          config.update(ctx.guild.id, (c) => { c.logging.enabled = false; return c; });
          return ctx.reply('Logging off.');
        }
        if (action === 'embeds') {
          const on = value !== 'off';
          config.update(ctx.guild.id, (c) => { c.logging.embeds = on; return c; });
          return ctx.reply(`Log embeds → **${on ? 'on' : 'off'}**.`);
        }
        if (action === 'event') {
          const key = value || ctx.args?.[1];
          const state = (ctx.args?.[2] || 'on').toLowerCase();
          if (!EVENT_KEYS.includes(key)) {
            return ctx.reply(`Events: ${EVENT_KEYS.join(', ')}`);
          }
          config.update(ctx.guild.id, (c) => {
            c.logging.events = c.logging.events || {};
            c.logging.events[key] = state !== 'off';
            return c;
          });
          return ctx.reply(`Event \`${key}\` → **${state !== 'off' ? 'on' : 'off'}**.`);
        }
        if (action === 'ignore') {
          const ch = ctx.message?.mentions?.channels?.first?.() || ctx.channel;
          config.update(ctx.guild.id, (c) => {
            c.logging.ignoreChannels = c.logging.ignoreChannels || [];
            const id = ch.id;
            if (c.logging.ignoreChannels.includes(id)) {
              c.logging.ignoreChannels = c.logging.ignoreChannels.filter((x) => x !== id);
            } else {
              c.logging.ignoreChannels.push(id);
            }
            return c;
          });
          const list = config.get(ctx.guild.id).logging.ignoreChannels || [];
          return ctx.reply(`Toggled ignore for ${ch}. Ignoring: ${list.map((id) => `<#${id}>`).join(', ') || '(none)'}`);
        }
        const L = logCfg(ctx.guild.id);
        const ev = Object.entries(L.events || {}).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(', ');
        return ctx.reply([
          `**Logging** ${L.enabled ? 'ON' : 'OFF'} channel=${L.channelId || '—'} embeds=${L.embeds !== false}`,
          `events: ${ev || '(defaults)'}`,
          `ignore: ${(L.ignoreChannels || []).length} channels`,
        ].join('\n'));
      },
    });
  }

  return {
    register,
    onMessageDelete,
    onMessageUpdate,
    onMemberAdd,
    onMemberRemove,
    onVoiceStateUpdate,
    onAudit,
    sendLog,
  };
}

module.exports = { createLogging, EVENT_KEYS };
