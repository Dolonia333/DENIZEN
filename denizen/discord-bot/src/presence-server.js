'use strict';

/**
 * Tiny presence HTTP API for the Discord pixel map.
 * GET /presence — tracker snapshot (cors open for local canvas)
 * GET /health
 */

const http = require('http');

function createPresenceServer({ tracker, guildId = '', port = 5180, applicationId = '' }) {
  const invitePermissions = 68608; // View Channels + Send Messages + Read Message History
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
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
        occupantCount: r.occupantCount,
        occupants: r.occupants || [],
      }));

      const memberById = new Map((snap?.members || []).map((m) => [m.userId, m]));
      const people = [];
      for (const room of rooms) {
        for (const userId of room.occupants || []) {
          const m = memberById.get(userId);
          people.push({
            userId,
            displayName: m?.displayName || userId.slice(0, 8),
            channelId: room.id,
            channelName: room.name,
            channelType: room.type,
            soft: room.type === 'text' || room.type === 'forum',
          });
        }
      }

      const body = {
        ok: true,
        ts: Date.now(),
        guildId: snap?.guildId || qGuild || null,
        guildName: snap?.name || null,
        rooms,
        people,
        members: snap?.members || [],
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

module.exports = { createPresenceServer };
