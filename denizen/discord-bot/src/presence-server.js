'use strict';

/**
 * Tiny presence HTTP API for the Discord pixel map.
 * GET /presence — tracker snapshot (cors open for local canvas)
 * GET /health
 * GET /avatar/:userId[.png] — custom look for map sprites
 * GET /avatar/catalog — closet options
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

function createPresenceServer({ tracker, guildId = '', port = 5180, applicationId = '' }) {
  let avatarApi = null;
  try {
    avatarApi = require(path.join(__dirname, '../../../src/discord-avatar'));
  } catch (err) {
    console.warn('[presence] avatar module unavailable:', err.message || err);
  }

  const invitePermissions = 68608; // View Channels + Send Messages + Read Message History
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Avatar PNG / JSON
    if (avatarApi && url.pathname.startsWith('/avatar')) {
      handleAvatar(req, res, url, avatarApi).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      });
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'denizen-discord-presence' }));
      return;
    }

    if (url.pathname === '/guilds') {
      const all = tracker.snapshot();
      const guilds = (Array.isArray(all?.guilds) ? all.guilds : []).map((g) => {
        const rooms = g.rooms || [];
        const voiceLive = rooms
          .filter((r) => r.type === 'voice')
          .reduce((n, r) => n + (r.occupantCount || 0), 0);
        return {
          guildId: g.guildId,
          name: g.name || g.guildId,
          channelCount: rooms.length,
          voiceLive,
          textCount: rooms.filter((r) => r.type === 'text' || r.type === 'forum').length,
          voiceCount: rooms.filter((r) => r.type === 'voice').length,
        };
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ok: true, ts: Date.now(), guilds }));
      return;
    }

    if (url.pathname === '/invite') {
      const clientId = String(
        applicationId || process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID || '',
      ).trim();
      if (!clientId) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'bot application id unavailable' }));
        return;
      }
      const params = new URLSearchParams({
        client_id: clientId,
        permissions: String(invitePermissions),
        scope: 'bot applications.commands',
      });
      const urlOut = `https://discord.com/oauth2/authorize?${params.toString()}`;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      });
      res.end(JSON.stringify({
        ok: true,
        url: urlOut,
        clientId,
        permissions: invitePermissions,
        scopes: ['bot', 'applications.commands'],
      }));
      return;
    }

    if (url.pathname === '/presence' || url.pathname === '/') {
      const qGuild = String(url.searchParams.get('guildId') || guildId || '').trim();
      let snap;
      if (qGuild) {
        snap = tracker.snapshot(qGuild);
      } else {
        const all = tracker.snapshot();
        snap = Array.isArray(all?.guilds) && all.guilds.length
          ? all.guilds[0]
          : all;
      }

      const rooms = (snap?.rooms || []).map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        categoryId: r.categoryId || null,
        categoryName: r.categoryName || null,
        occupantCount: r.occupantCount,
        occupants: r.occupants || [],
      }));

      const memberById = new Map((snap?.members || []).map((m) => [m.userId, m]));
      const store = avatarApi ? avatarApi.getAvatarStore() : null;
      const people = [];
      for (const room of rooms) {
        for (const userId of room.occupants || []) {
          const m = memberById.get(userId);
          let avatar = null;
          if (store) {
            try {
              const av = store.get(userId);
              avatar = avatarApi.clientAvatar(av, userId);
              // Prefer local presence URL for baked PNG when custom file exists
              // Relative URL so browser hits Denizen (or local presence) same-origin
              avatar.sheetUrl = `/api/discord/avatar/${encodeURIComponent(userId)}.png?v=${av.rev || 1}`;
              avatar.rev = av.rev || 1;
            } catch (_) { /* ignore */ }
          }
          people.push({
            userId,
            displayName: m?.displayName || userId.slice(0, 8),
            channelId: room.id,
            channelName: room.name,
            channelType: room.type,
            soft: room.type === 'text' || room.type === 'forum',
            avatar,
          });
        }
      }

      const body = {
        ok: true,
        ts: Date.now(),
        guildId: snap?.guildId || qGuild || null,
        guildName: snap?.name || null,
        categories: snap?.categories || [],
        rooms,
        people,
        members: snap?.members || [],
        events: avatarApi ? avatarApi.getActiveEvents() : [],
      };

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          console.log(`[discord-bot] presence API http://127.0.0.1:${port}/presence`);
          resolve(server);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    server,
  };
}

async function handleAvatar(req, res, url, avatarApi) {
  const store = avatarApi.getAvatarStore();
  const parts = url.pathname.split('/').filter(Boolean); // avatar | catalog | :id

  if (parts[0] === 'avatar' && parts[1] === 'catalog' && req.method === 'GET') {
    const unlocks = avatarApi.resolveUnlocks({});
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...avatarApi.publicCatalog(unlocks) }));
    return;
  }

  if (parts[0] === 'avatar' && parts[1] === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, events: avatarApi.getActiveEvents() }));
    return;
  }

  // /avatar/:userId.json or /avatar/:userId or /avatar/:userId.png
  let userId = parts[1] || '';
  let asPng = false;
  if (userId.endsWith('.png')) {
    asPng = true;
    userId = userId.slice(0, -4);
  } else if (userId.endsWith('.json')) {
    userId = userId.slice(0, -5);
  }
  userId = userId.replace(/[^0-9]/g, '');
  if (!userId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'userId required' }));
    return;
  }

  if (req.method === 'GET' && asPng) {
    let buf = store.readPng(userId);
    if (!buf) {
      // Bake on demand from stored/default config
      const av = store.get(userId);
      buf = await avatarApi.bakeSheet(av);
      try { store.writePng(userId, buf); } catch (_) { /* ignore */ }
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60',
    });
    res.end(buf);
    return;
  }

  if (req.method === 'GET') {
    const av = store.get(userId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      userId,
      avatar: avatarApi.clientAvatar(av, userId),
      raw: av,
    }));
    return;
  }

  if (req.method === 'PUT') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
      return;
    }
    const av = await avatarApi.ensureBaked(store, userId, body.avatar || body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      userId,
      avatar: avatarApi.clientAvatar(av, userId),
    }));
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
}

module.exports = { createPresenceServer };
