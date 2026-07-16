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
        categoryId: r.categoryId || null,
        categoryName: r.categoryName || null,
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
        categories: snap?.categories || [],
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

  function freePortIfBusy(p) {
    // Best-effort: on Windows a previous crashed sidecar can leave :5180
    // LISTENING under a dead-ish node. Kill only LISTENING holders of this port.
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        const out = execSync(`netstat -ano | findstr :${p}`, { encoding: 'utf8', timeout: 3000 });
        const pids = new Set();
        for (const line of out.split(/\r?\n/)) {
          if (!/LISTENING/i.test(line)) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid) && pid !== '0' && Number(pid) !== process.pid) pids.add(pid);
        }
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', timeout: 3000 });
            console.warn(`[discord-bot] freed presence port ${p} (killed PID ${pid})`);
          } catch (_) { /* ignore */ }
        }
      } else {
        try {
          const out = execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: 'utf8', timeout: 3000 });
          for (const pid of out.split(/\s+/).filter(Boolean)) {
            if (Number(pid) === process.pid) continue;
            try {
              process.kill(Number(pid), 'SIGTERM');
              console.warn(`[discord-bot] freed presence port ${p} (killed PID ${pid})`);
            } catch (_) { /* ignore */ }
          }
        } catch (_) { /* no listeners */ }
      }
    } catch (_) { /* ignore */ }
  }

  return {
    /**
     * Bind the presence HTTP server. Retries on EADDRINUSE (common after a
     * crashed previous bot left the port held). Without this, the Discord
     * map shows "Bot offline — Failed to fetch" forever even though the
     * bot itself is online in guilds.
     */
    listen({ retries = 5, retryMs = 700 } = {}) {
      let attempt = 0;
      return new Promise((resolve, reject) => {
        const tryListen = () => {
          attempt += 1;
          const onError = (err) => {
            server.removeListener('listening', onListening);
            const code = err?.code || '';
            if ((code === 'EADDRINUSE' || code === 'EACCES') && attempt <= retries) {
              console.warn(
                `[discord-bot] presence port ${port} busy (${code}) — retry ${attempt}/${retries}…`,
              );
              if (code === 'EADDRINUSE') freePortIfBusy(port);
              setTimeout(tryListen, retryMs * attempt);
              return;
            }
            reject(err);
          };
          const onListening = () => {
            server.removeListener('error', onError);
            console.log(`[discord-bot] presence API http://127.0.0.1:${port}/presence`);
            resolve(server);
          };
          server.once('error', onError);
          server.once('listening', onListening);
          try {
            server.listen(port, '127.0.0.1');
          } catch (err) {
            onError(err);
          }
        };
        tryListen();
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    server,
  };
}

module.exports = { createPresenceServer };
