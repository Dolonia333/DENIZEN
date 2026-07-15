'use strict';

/**
 * TrackerEngine — per-guild channel layout + hard voice / soft text occupancy.
 *
 * Voice: in channel = occupant until leave/move.
 * Text: soft window (default 90s) refreshed by message/typing; expires via tick().
 */

const logger = require('./logger');

const DEFAULT_TEXT_WINDOW_MS = 90_000;

function roomTypeFromDiscord(type) {
  // discord.js ChannelType enums
  if (type === 2) return 'voice';       // GuildVoice
  if (type === 13) return 'stage';      // GuildStageVoice
  if (type === 0 || type === 5) return 'text'; // GuildText / GuildAnnouncement
  if (type === 15) return 'forum';
  if (type === 4) return 'category';    // GuildCategory
  return 'other';
}

class TrackerEngine {
  /**
   * @param {{ textWindowMs?: number, log?: typeof logger }} [opts]
   */
  constructor(opts = {}) {
    this.textWindowMs = opts.textWindowMs ?? DEFAULT_TEXT_WINDOW_MS;
    this.log = opts.log || logger;
    /** @type {Map<string, { channels: Map, members: Map, name: string }>} */
    this.guilds = new Map();
  }

  _guild(guildId) {
    let g = this.guilds.get(guildId);
    if (!g) {
      g = {
        name: guildId,
        channels: new Map(),
        members: new Map(),
        categories: new Map(),
      };
      this.guilds.set(guildId, g);
    }
    return g;
  }

  _ensureChannel(guildId, channel) {
    const g = this._guild(guildId);
    if (!channel?.id) return null;
    let room = g.channels.get(channel.id);
    if (!room) {
      room = {
        id: channel.id,
        name: channel.name || channel.id,
        type: typeof channel.type === 'string'
          ? channel.type
          : roomTypeFromDiscord(channel.type),
        categoryId: channel.categoryId || null,
        categoryName: channel.categoryName || null,
        occupants: new Set(),
      };
      g.channels.set(channel.id, room);
    } else {
      if (channel.name) room.name = channel.name;
      if (channel.categoryId !== undefined && channel.categoryId !== null) room.categoryId = channel.categoryId;
      if (channel.categoryName !== undefined && channel.categoryName !== null) room.categoryName = channel.categoryName;
    }
    return room;
  }

  _ensureMember(guildId, userId, displayName) {
    const g = this._guild(guildId);
    let m = g.members.get(userId);
    if (!m) {
      m = {
        displayName: displayName || userId,
        voiceChannelId: null,
        textChannelId: null,
        textUntil: null,
      };
      g.members.set(userId, m);
    } else if (displayName) {
      m.displayName = displayName;
    }
    return m;
  }

  _count(room) {
    return room ? room.occupants.size : 0;
  }

  /**
   * Seed layout + current voice occupants from a discord.js Guild.
   */
  seedGuild(guild) {
    if (!guild?.id) return;
    const g = this._guild(guild.id);
    g.name = guild.name || guild.id;

    // Categories first so channels can resolve their categoryName below.
    for (const ch of guild.channels.cache.values()) {
      if (roomTypeFromDiscord(ch.type) !== 'category') continue;
      g.categories.set(ch.id, {
        id: ch.id,
        name: ch.name || ch.id,
        position: typeof ch.rawPosition === 'number' ? ch.rawPosition : (ch.position ?? 0),
      });
    }

    for (const ch of guild.channels.cache.values()) {
      const t = roomTypeFromDiscord(ch.type);
      if (t === 'other' || t === 'category') continue;
      const categoryId = ch.parentId || null;
      const categoryName = categoryId ? (g.categories.get(categoryId)?.name || null) : null;
      this._ensureChannel(guild.id, {
        id: ch.id, name: ch.name, type: t, categoryId, categoryName,
      });
    }

    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId) continue;
      const member = vs.member;
      const displayName = (member?.displayName || member?.user?.username || vs.id).slice(0, 48);
      this.applyVoice({
        guildId: guild.id,
        userId: vs.id,
        displayName,
        fromChannelId: null,
        toChannelId: vs.channelId,
        fromChannel: null,
        toChannel: vs.channel
          ? { id: vs.channel.id, name: vs.channel.name, type: roomTypeFromDiscord(vs.channel.type) }
          : { id: vs.channelId, name: vs.channelId, type: 'voice' },
        kind: 'join',
        silent: true,
      });
    }
  }

  /**
   * Apply a normalized voice event from the gateway.
   * @returns {{ ok: boolean, count?: number }}
   */
  applyVoice(evt) {
    const {
      guildId,
      userId,
      displayName,
      fromChannelId,
      toChannelId,
      fromChannel,
      toChannel,
      kind,
      silent,
    } = evt;
    if (!guildId || !userId) return { ok: false };

    const member = this._ensureMember(guildId, userId, displayName);
    const fromRoom = fromChannelId
      ? this._ensureChannel(guildId, fromChannel || { id: fromChannelId, type: 'voice' })
      : null;
    const toRoom = toChannelId
      ? this._ensureChannel(guildId, toChannel || { id: toChannelId, type: 'voice' })
      : null;

    if (fromRoom) fromRoom.occupants.delete(userId);
    if (toRoom) toRoom.occupants.add(userId);

    member.voiceChannelId = toChannelId || null;

    // Voice presence supersedes soft text in the same mental model for canvas:
    // still track text separately; counts are per-room occupants sets.
    if (!silent) {
      if (kind === 'join' && toRoom) {
        this.log.join({ displayName: member.displayName, toRoom, count: this._count(toRoom) });
      } else if (kind === 'leave' && fromRoom) {
        this.log.leave({ displayName: member.displayName, fromRoom, count: this._count(fromRoom) });
      } else if (kind === 'move' && fromRoom && toRoom) {
        this.log.move({
          displayName: member.displayName,
          fromRoom,
          toRoom,
          count: this._count(toRoom),
        });
      }
    }

    return { ok: true, count: this._count(toRoom || fromRoom) };
  }

  /**
   * Soft text / typing activity — refresh window in a text room.
   */
  applyTextActivity(evt) {
    const { guildId, userId, displayName, channelId, channel, now = Date.now() } = evt;
    if (!guildId || !userId || !channelId) return { ok: false };

    const room = this._ensureChannel(
      guildId,
      channel || { id: channelId, name: channelId, type: 'text' },
    );
    if (!room || (room.type !== 'text' && room.type !== 'forum' && room.type !== 'other')) {
      // Ignore pure voice channels for soft text pulses
      if (room?.type === 'voice' || room?.type === 'stage') return { ok: false, reason: 'not_text' };
    }

    const member = this._ensureMember(guildId, userId, displayName);
    const prevTextId = member.textChannelId;

    if (prevTextId && prevTextId !== channelId) {
      const prev = this._guild(guildId).channels.get(prevTextId);
      if (prev) {
        // Only remove from prev if they are not still "hard" there somehow
        prev.occupants.delete(userId);
      }
    }

    room.occupants.add(userId);
    member.textChannelId = channelId;
    member.textUntil = now + this.textWindowMs;

    this.log.text({
      displayName: member.displayName,
      room,
      count: this._count(room),
    });

    return { ok: true, count: this._count(room) };
  }

  /**
   * Expire soft text presence whose window elapsed.
   * Call periodically from the boot loop.
   */
  tick(now = Date.now()) {
    for (const [guildId, g] of this.guilds) {
      for (const [userId, member] of g.members) {
        if (!member.textChannelId || !member.textUntil) continue;
        if (member.textUntil > now) continue;

        const room = g.channels.get(member.textChannelId);
        if (room) {
          // Keep voice hard occupancy if same channel somehow; text rooms rarely overlap voice ids.
          room.occupants.delete(userId);
          this.log.expire({
            displayName: member.displayName,
            room,
            count: this._count(room),
          });
        }
        member.textChannelId = null;
        member.textUntil = null;
      }
    }
  }

  getRoom(guildId, channelId) {
    const g = this.guilds.get(guildId);
    if (!g) return null;
    const room = g.channels.get(channelId);
    if (!room) return null;
    return {
      id: room.id,
      name: room.name,
      type: room.type,
      occupantCount: room.occupants.size,
      occupants: [...room.occupants],
    };
  }

  getOccupantCount(guildId, channelId) {
    const room = this.getRoom(guildId, channelId);
    return room ? room.occupantCount : 0;
  }

  /**
   * JSON-ready snapshot for Module 4 canvas pipeline.
   */
  snapshot(guildId) {
    if (guildId) {
      const g = this.guilds.get(guildId);
      if (!g) return { guildId, name: null, rooms: [], members: [], categories: [] };
      return this._snapshotGuild(guildId, g);
    }
    const out = [];
    for (const [id, g] of this.guilds) {
      out.push(this._snapshotGuild(id, g));
    }
    return { guilds: out };
  }

  _snapshotGuild(guildId, g) {
    const rooms = [];
    for (const room of g.channels.values()) {
      rooms.push({
        id: room.id,
        name: room.name,
        type: room.type,
        categoryId: room.categoryId || null,
        categoryName: room.categoryName || null,
        occupantCount: room.occupants.size,
        occupants: [...room.occupants],
      });
    }
    const members = [];
    for (const [userId, m] of g.members) {
      members.push({
        userId,
        displayName: m.displayName,
        voiceChannelId: m.voiceChannelId,
        textChannelId: m.textChannelId,
        textUntil: m.textUntil,
      });
    }
    const categories = [...(g.categories?.values() || [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return {
      guildId,
      name: g.name,
      rooms,
      members,
      categories,
      ts: Date.now(),
    };
  }
}

module.exports = {
  TrackerEngine,
  roomTypeFromDiscord,
  DEFAULT_TEXT_WINDOW_MS,
};
