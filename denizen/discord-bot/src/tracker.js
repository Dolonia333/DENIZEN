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
    /** @type {import('./hangout-store').HangoutStore|null} */
    this.hangoutStore = opts.hangoutStore || null;
    /** @type {Map<string, { channels: Map, members: Map, name: string }>} */
    this.guilds = new Map();
    this._hangoutFlushAt = 0;
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
        // Voice UI flags (no true speaking stream without joining VC)
        muted: false,
        deafened: false,
        streaming: false,
        video: false,
        suppressed: false,
        boosted: false,
        // Soft social
        lastTextAt: null,
        textSnippet: null,
        // Hangout stats (ms in VC this ISO week)
        voiceJoinedAt: null,
        hangoutMs: 0,
        hangoutWeek: isoWeekKey(),
      };
      g.members.set(userId, m);
      if (this.hangoutStore) this.hangoutStore.hydrateMember(guildId, userId, m);
    } else if (displayName) {
      m.displayName = displayName;
    }
    // Migrate older in-memory rows
    if (m.hangoutMs == null) m.hangoutMs = 0;
    if (!m.hangoutWeek) m.hangoutWeek = isoWeekKey();
    if (m.boosted == null) m.boosted = false;
    return m;
  }

  _persistHangout(guildId, userId, member) {
    if (!this.hangoutStore || !member) return;
    this.hangoutStore.record(guildId, userId, {
      hangoutMs: member.hangoutMs || 0,
      displayName: member.displayName,
      hangoutWeek: member.hangoutWeek || isoWeekKey(),
    });
  }

  /**
   * Upsert a channel/category into the live layout (gateway channel CRUD).
   */
  upsertChannel(guildId, channel) {
    if (!guildId || !channel?.id) return null;
    const t = typeof channel.type === 'string'
      ? channel.type
      : roomTypeFromDiscord(channel.type);
    if (t === 'category') {
      const g = this._guild(guildId);
      g.categories.set(channel.id, {
        id: channel.id,
        name: channel.name || channel.id,
        position: typeof channel.position === 'number' ? channel.position : 0,
      });
      return g.categories.get(channel.id);
    }
    if (t === 'other') return null;
    return this._ensureChannel(guildId, {
      id: channel.id,
      name: channel.name || channel.id,
      type: t,
      categoryId: channel.categoryId ?? channel.parentId ?? null,
      categoryName: channel.categoryName || null,
    });
  }

  removeChannel(guildId, channelId) {
    const g = this.guilds.get(guildId);
    if (!g || !channelId) return;
    g.categories.delete(channelId);
    const room = g.channels.get(channelId);
    if (room) {
      for (const userId of room.occupants) {
        const m = g.members.get(userId);
        if (m?.voiceChannelId === channelId) {
          this._creditVoiceTime(m);
          m.voiceChannelId = null;
          m.voiceJoinedAt = null;
          this._persistHangout(guildId, userId, m);
        }
        if (m?.textChannelId === channelId) {
          m.textChannelId = null;
          m.textUntil = null;
        }
      }
      g.channels.delete(channelId);
    }
  }

  setBoosted(guildId, userId, boosted, displayName) {
    const m = this._ensureMember(guildId, userId, displayName);
    m.boosted = !!boosted;
    return m;
  }

  _rollHangoutWeek(member, now = Date.now()) {
    const wk = isoWeekKey(new Date(now));
    if (member.hangoutWeek !== wk) {
      member.hangoutWeek = wk;
      member.hangoutMs = 0;
    }
  }

  _creditVoiceTime(member, now = Date.now()) {
    if (!member?.voiceJoinedAt) return;
    this._rollHangoutWeek(member, now);
    const delta = Math.max(0, now - member.voiceJoinedAt);
    member.hangoutMs = (member.hangoutMs || 0) + delta;
    member.voiceJoinedAt = member.voiceChannelId ? now : null;
  }

  /**
   * Mute/deaf/stream/video without channel change (same VC).
   */
  applyVoiceFlags(evt) {
    const {
      guildId,
      userId,
      displayName,
      muted,
      deafened,
      streaming,
      video,
      suppressed,
      channelId,
    } = evt;
    if (!guildId || !userId) return { ok: false };
    const member = this._ensureMember(guildId, userId, displayName);
    if (channelId && !member.voiceChannelId) {
      // flags without occupancy — ignore
    }
    if (muted != null) member.muted = !!muted;
    if (deafened != null) member.deafened = !!deafened;
    if (streaming != null) member.streaming = !!streaming;
    if (video != null) member.video = !!video;
    if (suppressed != null) member.suppressed = !!suppressed;
    return { ok: true };
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
      const boosted = !!(member?.premiumSince || member?.premium_since);
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
        muted: !!(vs.selfMute || vs.serverMute),
        deafened: !!(vs.selfDeaf || vs.serverDeaf),
        streaming: !!vs.streaming,
        video: !!vs.selfVideo,
        suppressed: !!vs.suppress,
        boosted,
      });
    }

    // Hydrate hangout totals for members who aren't currently in VC
    if (this.hangoutStore) {
      const data = this.hangoutStore.load(guild.id);
      for (const [userId, row] of Object.entries(data.users || {})) {
        const m = this._ensureMember(guild.id, userId, row.displayName);
        this.hangoutStore.hydrateMember(guild.id, userId, m);
      }
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

    const now = evt.now || Date.now();
    this._rollHangoutWeek(member, now);

    // Leaving or moving: bank time on the previous channel
    if (fromRoom && member.voiceChannelId) {
      this._creditVoiceTime(member, now);
      this._persistHangout(guildId, userId, member);
    }

    if (fromRoom) fromRoom.occupants.delete(userId);
    if (toRoom) toRoom.occupants.add(userId);

    member.voiceChannelId = toChannelId || null;

    if (toRoom) {
      member.voiceJoinedAt = now;
    } else {
      member.voiceJoinedAt = null;
      member.muted = false;
      member.deafened = false;
      member.streaming = false;
      member.video = false;
      member.suppressed = false;
      this._persistHangout(guildId, userId, member);
    }

    // Optional flags on join/move
    if (evt.muted != null) member.muted = !!evt.muted;
    if (evt.deafened != null) member.deafened = !!evt.deafened;
    if (evt.streaming != null) member.streaming = !!evt.streaming;
    if (evt.video != null) member.video = !!evt.video;
    if (evt.suppressed != null) member.suppressed = !!evt.suppressed;
    if (evt.boosted != null) member.boosted = !!evt.boosted;

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
    member.lastTextAt = now;
    if (evt.snippet != null) {
      member.textSnippet = String(evt.snippet).replace(/\s+/g, ' ').trim().slice(0, 48) || null;
    } else if (evt.source === 'typing') {
      member.textSnippet = member.textSnippet || '…';
    }

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
   * Also banks in-progress VC time for hangout stats.
   */
  tick(now = Date.now()) {
    for (const [guildId, g] of this.guilds) {
      for (const [userId, member] of g.members) {
        // Keep hangout clock accurate while sitting in VC
        if (member.voiceChannelId && member.voiceJoinedAt) {
          this._creditVoiceTime(member, now);
          member.voiceJoinedAt = now;
          this._persistHangout(guildId, userId, member);
        }

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
        // Keep last snippet briefly for UI, then clear
        if (member.lastTextAt && now - member.lastTextAt > this.textWindowMs) {
          member.textSnippet = null;
        }
      }
    }
    // Flush dirty hangout files every ~30s
    if (this.hangoutStore && now - this._hangoutFlushAt > 30_000) {
      this._hangoutFlushAt = now;
      try { this.hangoutStore.flushDirty(); } catch (err) {
        console.warn('[tracker] hangout flush:', err.message || err);
      }
    }
  }

  /**
   * Weekly hangout leaderboard for a guild (top voice minutes this ISO week).
   * @returns {{ week: string, rows: { userId, displayName, ms, minutes }[] }}
   */
  hangoutLeaderboard(guildId, { limit = 10 } = {}) {
    const g = this.guilds.get(guildId);
    const week = isoWeekKey();
    if (!g) return { week, rows: [] };
    const rows = [];
    for (const [userId, m] of g.members) {
      this._rollHangoutWeek(m);
      // Include live session so open VCs count
      let ms = m.hangoutMs || 0;
      if (m.voiceChannelId && m.voiceJoinedAt) {
        ms += Math.max(0, Date.now() - m.voiceJoinedAt);
      }
      if (ms < 30_000) continue; // ignore <30s blips
      rows.push({
        userId,
        displayName: m.displayName || userId,
        ms,
        minutes: Math.round(ms / 60_000),
      });
    }
    rows.sort((a, b) => b.ms - a.ms);
    return { week, rows: rows.slice(0, limit) };
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
   * True if the member is currently on the map (VC hard presence or soft text window).
   */
  isOnMap(guildId, userId) {
    if (!guildId || !userId) return false;
    const g = this.guilds.get(guildId);
    const m = g?.members?.get(userId);
    if (!m) return false;
    if (m.voiceChannelId) return true;
    if (m.textChannelId && m.textUntil && m.textUntil > Date.now()) return true;
    return false;
  }

  /**
   * Ephemeral map emote/eat action (TTL ~5s) broadcast via presence people[].action.
   * @param {string} guildId
   * @param {string} userId
   * @param {{ kind: string, pose?: string, food?: string, ts?: number }} action
   * @param {number} [ttlMs=5000]
   */
  setMapAction(guildId, userId, action, ttlMs = 5000) {
    if (!guildId || !userId || !action?.kind) return null;
    const member = this._ensureMember(guildId, userId);
    const now = Date.now();
    const ts = Number(action.ts) || now;
    member.mapAction = {
      kind: String(action.kind),
      pose: action.pose ? String(action.pose) : undefined,
      food: action.food ? String(action.food) : undefined,
      ts,
      until: now + Math.max(500, Number(ttlMs) || 5000),
    };
    return member.mapAction;
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
    const now = Date.now();
    for (const [userId, m] of g.members) {
      const live = !!(m.voiceChannelId && !m.muted && !m.deafened && !m.suppressed);
      let action = null;
      if (m.mapAction?.until && m.mapAction.until > now) {
        action = {
          kind: m.mapAction.kind,
          pose: m.mapAction.pose || undefined,
          food: m.mapAction.food || undefined,
          ts: m.mapAction.ts,
        };
      }
      members.push({
        userId,
        displayName: m.displayName,
        voiceChannelId: m.voiceChannelId,
        textChannelId: m.textChannelId,
        textUntil: m.textUntil,
        muted: !!m.muted,
        deafened: !!m.deafened,
        streaming: !!m.streaming,
        video: !!m.video,
        suppressed: !!m.suppressed,
        live,
        boosted: !!m.boosted,
        lastTextAt: m.lastTextAt || null,
        textSnippet: m.textSnippet || null,
        hangoutMs: m.hangoutMs || 0,
        hangoutWeek: m.hangoutWeek || isoWeekKey(),
        action,
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

/** ISO week key YYYY-Www (UTC). */
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

module.exports = {
  TrackerEngine,
  roomTypeFromDiscord,
  DEFAULT_TEXT_WINDOW_MS,
  isoWeekKey,
};
