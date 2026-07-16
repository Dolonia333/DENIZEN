'use strict';

/**
 * Gateway Node — discord.js client + normalized room + security events.
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  Events,
} = require('discord.js');

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageTyping,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.GuildMember, Partials.Channel, Partials.Message, Partials.Reaction],
  });
}

function channelMeta(channel) {
  if (!channel) return null;
  let type = 'other';
  if (channel.type === ChannelType.GuildVoice) type = 'voice';
  else if (channel.type === ChannelType.GuildStageVoice) type = 'stage';
  else if (
    channel.type === ChannelType.GuildText
    || channel.type === ChannelType.GuildAnnouncement
  ) type = 'text';
  else if (channel.type === ChannelType.GuildForum) type = 'forum';
  else if (channel.type === ChannelType.GuildCategory) type = 'category';
  return {
    id: channel.id,
    name: channel.name || channel.id,
    type,
    categoryId: channel.parentId || null,
    categoryName: channel.parent?.name || null,
  };
}

function displayNameFrom(member, user, userId) {
  return (member?.displayName || user?.username || `discord-${userId}`).slice(0, 48);
}

/**
 * @param {import('discord.js').Client} client
 * @param {object} handlers
 */
function attachGateway(client, handlers = {}) {
  const guildFilter = String(handlers.guildFilter || '').trim();

  const allowGuild = (guildId) => {
    if (!guildFilter) return true;
    return guildId === guildFilter;
  };

  const runAll = async (list, ...args) => {
    if (!list?.length) return;
    for (const fn of list) {
      try { await fn(...args); } catch (err) {
        console.error('[gateway] hook error:', err.message || err);
      }
    }
  };

  const onReady = () => {
    if (typeof handlers.onReady === 'function') handlers.onReady(client);
    for (const guild of client.guilds.cache.values()) {
      if (!allowGuild(guild.id)) continue;
      if (typeof handlers.onGuildSeed === 'function') handlers.onGuildSeed(guild);
    }
  };

  client.once(Events.ClientReady, onReady);

  client.on(Events.GuildCreate, (guild) => {
    if (!allowGuild(guild.id)) return;
    if (typeof handlers.onGuildSeed === 'function') handlers.onGuildSeed(guild);
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    try {
      const guildId = newState.guild?.id || oldState.guild?.id;
      if (!guildId || !allowGuild(guildId)) return;

      runAll(handlers.hooks?.onVoiceStateUpdate, oldState, newState);

      const fromChannelId = oldState.channelId || null;
      const toChannelId = newState.channelId || null;
      const member = newState.member || oldState.member;
      const userId = newState.id || oldState.id;
      const displayName = displayNameFrom(member, member?.user, userId);

      const voiceFlags = {
        muted: !!(newState.selfMute || newState.serverMute),
        deafened: !!(newState.selfDeaf || newState.serverDeaf),
        streaming: !!newState.streaming,
        video: !!newState.selfVideo,
        suppressed: !!newState.suppress,
      };

      // Same channel: still update mute/deaf/stream/camera for map "live" indicators
      if (fromChannelId === toChannelId) {
        if (toChannelId && typeof handlers.onVoiceFlags === 'function') {
          handlers.onVoiceFlags({
            guildId,
            userId,
            displayName,
            channelId: toChannelId,
            ...voiceFlags,
          });
        }
        return;
      }

      const joined = !fromChannelId && !!toChannelId;
      const left = !!fromChannelId && !toChannelId;
      const moved = !!fromChannelId && !!toChannelId;
      const kind = joined ? 'join' : left ? 'leave' : moved ? 'move' : null;
      if (!kind) return;

      const toCh = newState.channel;
      const fromCh = oldState.channel;
      if (toCh && toCh.type !== ChannelType.GuildVoice && toCh.type !== ChannelType.GuildStageVoice) {
        return;
      }
      if (!toCh && fromCh
        && fromCh.type !== ChannelType.GuildVoice
        && fromCh.type !== ChannelType.GuildStageVoice) {
        return;
      }

      if (typeof handlers.onVoice === 'function') {
        handlers.onVoice({
          kind,
          guildId,
          userId,
          displayName,
          fromChannelId,
          toChannelId,
          fromChannel: channelMeta(fromCh),
          toChannel: channelMeta(toCh),
          ...voiceFlags,
        });
      }
    } catch (err) {
      console.error('[gateway] voiceStateUpdate error:', err.message || err);
    }
  });

  client.on('messageCreate', (message) => {
    try {
      if (typeof handlers.onMessage === 'function') handlers.onMessage(message);
      runAll(handlers.hooks?.onMessage, message);

      if (!message.guild || message.author?.bot) return;
      if (!allowGuild(message.guild.id)) return;
      if (!message.channelId) return;

      const member = message.member;
      const displayName = displayNameFrom(member, message.author, message.author.id);
      if (typeof handlers.onTextActivity === 'function') {
        handlers.onTextActivity({
          kind: 'text_activity',
          source: 'message',
          guildId: message.guild.id,
          userId: message.author.id,
          displayName,
          channelId: message.channelId,
          channel: channelMeta(message.channel),
          snippet: String(message.content || '').slice(0, 80),
        });
      }
    } catch (err) {
      console.error('[gateway] messageCreate error:', err.message || err);
    }
  });

  client.on('messageDelete', (message) => {
    runAll(handlers.hooks?.onMessageDelete, message);
  });

  client.on('messageUpdate', (oldMsg, newMsg) => {
    runAll(handlers.hooks?.onMessageUpdate, oldMsg, newMsg);
  });

  client.on('typingStart', (typing) => {
    try {
      const guild = typing.guild;
      if (!guild) return;
      if (!allowGuild(guild.id)) return;
      const user = typing.user;
      if (!user || user.bot) return;
      const channelId = typing.channel?.id || typing.channelId;
      if (!channelId) return;
      if (typeof handlers.onTextActivity === 'function') {
        handlers.onTextActivity({
          kind: 'text_activity',
          source: 'typing',
          guildId: guild.id,
          userId: user.id,
          displayName: displayNameFrom(typing.member, user, user.id),
          channelId,
          channel: channelMeta(typing.channel),
        });
      }
    } catch (err) {
      console.error('[gateway] typingStart error:', err.message || err);
    }
  });

  client.on('guildMemberAdd', (member) => {
    if (!allowGuild(member.guild.id)) return;
    runAll(handlers.hooks?.onMemberAdd, member);
  });

  client.on('guildMemberRemove', (member) => {
    if (!allowGuild(member.guild.id)) return;
    runAll(handlers.hooks?.onMemberRemove, member);
  });

  client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (!allowGuild(newMember.guild.id)) return;
    runAll(handlers.hooks?.onGuildMemberUpdate, oldMember, newMember);
  });

  client.on('messageReactionAdd', (reaction, user) => {
    runAll(handlers.hooks?.onReactionAdd, reaction, user);
  });

  client.on('messageReactionRemove', (reaction, user) => {
    runAll(handlers.hooks?.onReactionRemove, reaction, user);
  });

  client.on('interactionCreate', async (interaction) => {
    if (typeof handlers.onInteraction === 'function') {
      await handlers.onInteraction(interaction);
    }
    for (const fn of handlers.hooks?.onInteraction || []) {
      try {
        const handled = await fn(interaction);
        if (handled) return;
      } catch (err) {
        console.error('[gateway] interaction hook:', err.message || err);
      }
    }
  });

  return client;
}

module.exports = {
  createClient,
  attachGateway,
  channelMeta,
};
