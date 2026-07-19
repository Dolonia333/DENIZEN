'use strict';

/**
 * Minimal Lavalink v4 client for Discord.js bots.
 * @see https://github.com/lavalink-devs/Lavalink
 * @see https://lavalink.dev/api/
 *
 * Env:
 *   LAVALINK_HOST (default 127.0.0.1)
 *   LAVALINK_PORT (default 2333)
 *   LAVALINK_PASSWORD (default youshallnotpass)
 *   LAVALINK_URL  (optional full http base, e.g. http://192.168.1.237:2333)
 *   LAVALINK_SECURE=1 for wss/https
 *   LAVALINK_DISABLE=1 to skip music node auto-connect
 */

const WebSocket = require('ws');

class LavalinkClient {
  /**
   * @param {{ userId: string, clientName?: string }} opts
   */
  constructor(opts = {}) {
    this.userId = String(opts.userId || '');
    this.clientName = opts.clientName || 'denizen-discord-bot/0.3';
    this.password = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
    this.secure = /^(1|true|yes)$/i.test(String(process.env.LAVALINK_SECURE || ''));

    if (process.env.LAVALINK_URL) {
      const u = new URL(process.env.LAVALINK_URL);
      this.host = u.hostname;
      this.port = u.port || (u.protocol === 'https:' ? '443' : '80');
      this.httpBase = process.env.LAVALINK_URL.replace(/\/$/, '');
      this.secure = u.protocol === 'https:';
    } else {
      this.host = process.env.LAVALINK_HOST || '127.0.0.1';
      this.port = process.env.LAVALINK_PORT || '2333';
      this.httpBase = `http${this.secure ? 's' : ''}://${this.host}:${this.port}`;
    }

    this.sessionId = null;
    this.ws = null;
    this.ready = false;
    this._reconnectTimer = null;
    this._handlers = new Set();
    /** guildId -> last voice update payload */
    this._voice = new Map();
  }

  /** True unless LAVALINK_DISABLE — defaults target 127.0.0.1:2333. */
  static isConfigured() {
    if (/^(1|true|yes)$/i.test(String(process.env.LAVALINK_DISABLE || ''))) return false;
    return true;
  }

  on(fn) {
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  _emit(type, payload) {
    for (const fn of this._handlers) {
      try { fn({ type, payload }); } catch (_) {}
    }
  }

  connect() {
    if (!this.userId) throw new Error('LavalinkClient requires Discord bot userId');
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = this.secure ? 'wss' : 'ws';
    const url = `${proto}://${this.host}:${this.port}/v4/websocket`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: this.password,
        'User-Id': this.userId,
        'Client-Name': this.clientName,
      },
    });

    this.ws.on('open', () => {
      console.log(`[lavalink] connected ${url}`);
    });

    this.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.op === 'ready') {
        this.sessionId = msg.sessionId;
        this.ready = true;
        console.log(`[lavalink] ready session=${this.sessionId} resumed=${!!msg.resumed}`);
        this._emit('ready', msg);
      } else if (msg.op === 'event') {
        this._emit('event', msg);
      } else if (msg.op === 'playerUpdate') {
        this._emit('playerUpdate', msg);
      } else if (msg.op === 'stats') {
        this._emit('stats', msg);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.ready = false;
      this.sessionId = null;
      console.warn(`[lavalink] closed ${code} ${reason || ''}`);
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.warn('[lavalink] ws error:', err.message || err);
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      try { this.connect(); } catch (err) {
        console.warn('[lavalink] reconnect failed:', err.message);
        this._scheduleReconnect();
      }
    }, 5000);
    this._reconnectTimer.unref?.();
  }

  async _rest(method, path, body) {
    const res = await fetch(`${this.httpBase}${path}`, {
      method,
      headers: {
        Authorization: this.password,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error(`Lavalink ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /**
   * Load tracks (search ytsearch:query or plain URL).
   * @returns {{ tracks: object[], loadType: string, playlist?: object }}
   */
  async loadTracks(identifier) {
    const id = String(identifier || '').trim();
    if (!id) throw new Error('empty identifier');
    // Prefer YouTube search for bare queries
    const q = /^https?:\/\//i.test(id) || id.includes(':') ? id : `ytsearch:${id}`;
    const path = `/v4/loadtracks?identifier=${encodeURIComponent(q)}`;
    const data = await this._rest('GET', path);
    // v4 shape: { loadType, data: Track|Playlist|Track[]|… }
    const loadType = data?.loadType || data?.load_type || 'empty';
    let tracks = [];
    let playlist = null;
    if (loadType === 'track' && data.data) {
      tracks = [data.data];
    } else if (loadType === 'search' && Array.isArray(data.data)) {
      tracks = data.data;
    } else if (loadType === 'playlist' && data.data?.tracks) {
      tracks = data.data.tracks;
      playlist = data.data.info || null;
    } else if (Array.isArray(data?.tracks)) {
      tracks = data.tracks;
    }
    return { loadType, tracks, playlist, raw: data };
  }

  /**
   * Update voice state for a guild (call from Discord voiceServerUpdate + voiceStateUpdate).
   */
  async updateVoice(guildId, { token, endpoint, sessionId }) {
    const prev = this._voice.get(guildId) || {};
    const next = {
      token: token ?? prev.token,
      endpoint: endpoint ?? prev.endpoint,
      sessionId: sessionId ?? prev.sessionId,
    };
    this._voice.set(guildId, next);
    if (!this.sessionId || !next.token || !next.endpoint || !next.sessionId) return null;
    return this._rest('PATCH', `/v4/sessions/${this.sessionId}/players/${guildId}?noReplace=false`, {
      voice: {
        token: next.token,
        endpoint: next.endpoint,
        sessionId: next.sessionId,
      },
    });
  }

  /**
   * Play encoded track in a guild voice channel (voice must be updated first or with this call).
   */
  async play(guildId, {
    encodedTrack,
    volume = 80,
    endTime,
    position = 0,
    paused = false,
    filters,
  } = {}) {
    if (!this.sessionId) throw new Error('Lavalink session not ready');
    if (!encodedTrack) throw new Error('encodedTrack required');
    const body = {
      encodedTrack,
      volume: Math.max(0, Math.min(1000, Math.round(Number(volume) || 80))),
      position,
      paused: !!paused,
    };
    if (endTime != null) body.endTime = endTime;
    if (filters) body.filters = filters;
    const voice = this._voice.get(guildId);
    if (voice?.token && voice?.endpoint && voice?.sessionId) {
      body.voice = {
        token: voice.token,
        endpoint: voice.endpoint,
        sessionId: voice.sessionId,
      };
    }
    return this._rest('PATCH', `/v4/sessions/${this.sessionId}/players/${guildId}?noReplace=false`, body);
  }

  async stop(guildId) {
    if (!this.sessionId) return null;
    return this._rest('PATCH', `/v4/sessions/${this.sessionId}/players/${guildId}?noReplace=false`, {
      encodedTrack: null,
    });
  }

  async pause(guildId, paused = true) {
    if (!this.sessionId) return null;
    return this._rest('PATCH', `/v4/sessions/${this.sessionId}/players/${guildId}?noReplace=false`, {
      paused: !!paused,
    });
  }

  async setVolume(guildId, volume) {
    if (!this.sessionId) return null;
    return this._rest('PATCH', `/v4/sessions/${this.sessionId}/players/${guildId}?noReplace=false`, {
      volume: Math.max(0, Math.min(1000, Math.round(Number(volume) || 80))),
    });
  }

  async setFilters(guildId, filters) {
    if (!this.sessionId) return null;
    return this._rest('PATCH', `/v4/sessions/${this.sessionId}/players/${guildId}?noReplace=false`, {
      filters: filters || {},
    });
  }

  async destroy(guildId) {
    if (!this.sessionId) return null;
    this._voice.delete(guildId);
    return this._rest('DELETE', `/v4/sessions/${this.sessionId}/players/${guildId}`);
  }

  async listPlayers() {
    if (!this.sessionId) return [];
    try {
      const data = await this._rest('GET', `/v4/sessions/${this.sessionId}/players`);
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  async destroyAllPlayers() {
    const players = await this.listPlayers();
    for (const p of players) {
      const gid = p.guildId || p.guild_id;
      if (gid) {
        try { await this.destroy(gid); } catch (_) {}
      }
    }
    return players.length;
  }

  async stats() {
    return this._rest('GET', '/v4/stats');
  }

  close() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    try { this.ws?.close(); } catch (_) {}
  }
}

/** Map simple filter names → Lavalink v4 filter objects */
function filterPreset(name) {
  const n = String(name || 'none').toLowerCase();
  if (n === 'none' || n === 'off') return {};
  if (n === 'bassboost') {
    return { equalizer: [{ band: 0, gain: 0.6 }, { band: 1, gain: 0.4 }, { band: 2, gain: 0.2 }] };
  }
  if (n === 'nightcore') {
    return { timescale: { speed: 1.2, pitch: 1.2, rate: 1 } };
  }
  if (n === 'vaporwave') {
    return { timescale: { speed: 0.8, pitch: 0.8, rate: 1 } };
  }
  if (n === 'soft') {
    return { lowPass: { smoothing: 20 } };
  }
  if (n === '8d') {
    return { rotation: { rotationHz: 0.2 } };
  }
  return {};
}

module.exports = { LavalinkClient, filterPreset };
