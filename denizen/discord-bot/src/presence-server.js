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

function createPresenceServer({
  tracker,
  guildId = '',
  port = 5180,
  applicationId = '',
  config = null,
} = {}) {
  let avatarApi = null;
  try {
    avatarApi = require(path.join(__dirname, '../../src/discord-avatar'));
  } catch (err) {
    console.warn('[presence] avatar module unavailable:', err.message || err);
  }

  let guildPlans = null;
  try {
    guildPlans = require(path.join(__dirname, '../../src/denizen-guild-plans.js'));
  } catch (_) { guildPlans = null; }

  let guildPets = null;
  try {
    guildPets = require(path.join(__dirname, '../../src/denizen-guild-pets.js'));
  } catch (_) { guildPets = null; }

  function warmGuildPets(gid) {
    if (!gid || !guildPets?.warmGuildPets) return;
    guildPets.warmGuildPets(gid);
  }

  function userAllowsCompanion(gid, userId, entitledSet) {
    if (!gid || !userId) return false;
    if (entitledSet?.has(String(userId))) return true;
    if (guildPets?.peekPetEntitlement?.(gid, userId)) return true;
    if (avatarApi?.isPaidPlan?.(process.env.DENIZEN_SPACES_PLAN)
      && /^(1|true|yes|on)$/i.test(String(process.env.DENIZEN_SPACES_ALL_PETS || ''))) {
      return true;
    }
    return false;
  }

  function spacesBranding(forGuildId) {
    const envPlan = String(process.env.DENIZEN_SPACES_PLAN || 'free').toLowerCase();
    const envRemove = /^(1|true|yes|on)$/i.test(String(process.env.DENIZEN_SPACES_REMOVE_BRANDING || ''));
    let plan = envPlan;
    let removeBranding = envRemove;
    if (config && forGuildId) {
      try {
        const sp = config.get(forGuildId)?.spaces || {};
        if (sp.plan) plan = String(sp.plan).toLowerCase();
        if (sp.removeBranding != null) removeBranding = !!sp.removeBranding;
      } catch (_) { /* ignore */ }
    }
    if (plan === 'community' || plan === 'pro' || plan === 'paid') removeBranding = true;
    return {
      plan: plan || 'free',
      removeBranding: !!removeBranding,
      watermark: !removeBranding,
      productName: 'Denizen Spaces',
      upgradeHint: removeBranding
        ? null
        : 'Community plan removes branding — set DENIZEN_SPACES_REMOVE_BRANDING=1 or guild spaces.plan',
    };
  }

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

    if (url.pathname === '/membership') {
      const userId = String(url.searchParams.get('userId') || '').trim();
      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'userId required' }));
        return;
      }
      const guildIds = typeof tracker.memberGuildIds === 'function'
        ? tracker.memberGuildIds(userId)
        : [];
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ok: true, userId, guildIds }));
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
      (async () => {
        try {
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
          const gidEarly = snap?.guildId || qGuild || null;
          let entitledSet = new Set();
          if (guildPets?.listEntitlements && gidEarly) {
            try {
              const list = await guildPets.listEntitlements(gidEarly);
              entitledSet = new Set(list.map((r) => String(r.user_id)));
            } catch (_) { /* fail closed for pets */ }
          }
          const people = [];
          for (const room of rooms) {
            for (const userId of room.occupants || []) {
              const m = memberById.get(userId);
              let avatar = null;
              let rawAv = null;
              if (store) {
                try {
                  rawAv = store.get(userId);
                  avatar = avatarApi.clientAvatar(rawAv, userId);
                  // Only advertise a custom sheet when one actually exists on
                  // disk — store.get() manufactures in-memory defaults, and
                  // the PNG route 404s for those, so an unconditional
                  // sheetUrl made every default-look occupant a guaranteed
                  // failing fetch on each map poll.
                  if (store.hasCustom(userId)) {
                    avatar.sheetUrl = `/api/discord/avatar/${encodeURIComponent(userId)}.png?v=${rawAv.rev || 1}`;
                    avatar.rev = rawAv.rev || 1;
                  }
                } catch (_) { /* ignore */ }
              }
              const soft = room.type === 'text' || room.type === 'forum';
              const muted = !!(m?.muted);
              const deafened = !!(m?.deafened);
              const live = !soft && !muted && !deafened && !m?.suppressed;
              let boosted = !!(m?.boosted);
              if (!boosted && avatar?.unlocks?.includes?.('role:booster')) boosted = true;
              if (!boosted && avatar?.hat?.source === 'role:booster') boosted = true;
              let pet = null;
              if (userAllowsCompanion(gidEarly, userId, entitledSet)) {
                const p = avatar?.pet || rawAv?.pet;
                if (p?.enabled && (p.kind === 'cat' || p.kind === 'dog')) {
                  pet = { kind: p.kind };
                }
              }
              people.push({
                userId,
                displayName: m?.displayName || userId.slice(0, 8),
                channelId: room.id,
                channelName: room.name,
                channelType: room.type,
                soft,
                muted,
                deafened,
                streaming: !!(m?.streaming),
                video: !!(m?.video),
                suppressed: !!(m?.suppressed),
                boosted,
                premium: boosted,
                live: soft ? false : live,
                textSnippet: soft ? (m?.textSnippet || null) : null,
                lastTextAt: m?.lastTextAt || null,
                hangoutMs: m?.hangoutMs || 0,
                pet,
                avatar,
                action: m?.action || null,
              });
            }
          }

          const gid = gidEarly;
          const hangoutBoard = gid && typeof tracker.hangoutLeaderboard === 'function'
            ? tracker.hangoutLeaderboard(gid, { limit: 5 })
            : { week: null, rows: [] };
          const hangoutTop = (hangoutBoard.rows || []).map((r) => ({
            userId: r.userId,
            displayName: r.displayName,
            minutes: r.minutes,
            ms: r.ms,
          }));
          const brand = spacesBranding(gid);
          let roomOverrides = {};
          let categoryOverrides = {};
          if (config && gid) {
            try {
              const sp = config.get(gid)?.spaces || {};
              roomOverrides = sp.rooms && typeof sp.rooms === 'object' ? sp.rooms : {};
              categoryOverrides = sp.categories && typeof sp.categories === 'object' ? sp.categories : {};
            } catch (_) { /* ignore */ }
          }
          const roomsWithMap = (rooms || []).map((r) => {
            const ov = roomOverrides[String(r.id)] || null;
            return ov ? { ...r, map: ov } : r;
          });
          const publicBase = String(
            process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || '',
          ).replace(/\/$/, '');
          // Team-code gated maps — share the connect URL (not an ungated public view).
          const sharePath = gid
            ? `/discord-map/?guildId=${encodeURIComponent(gid)}`
            : '/discord-map/';
          const body = {
            ok: true,
            ts: Date.now(),
            guildId: gid,
            guildName: snap?.name || null,
            categories: snap?.categories || [],
            rooms: roomsWithMap,
            roomOverrides,
            categoryOverrides,
            people,
            members: snap?.members || [],
            hangoutTop,
            hangoutWeek: hangoutBoard.week || null,
            events: avatarApi ? avatarApi.getActiveEvents() : [],
            branding: brand,
            share: {
              path: sharePath,
              url: publicBase ? `${publicBase}${sharePath}` : sharePath,
              requiresTeamCode: true,
            },
          };

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify(body));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
        }
      })();
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
    const plan = avatarApi.resolvePlan(url.searchParams.get('plan') || process.env.DENIZEN_SPACES_PLAN);
    const unlocks = avatarApi.resolveUnlocks({});
    const cat = avatarApi.publicCatalogForPlan(plan, unlocks, {});
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, plan, ...cat }));
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
      if (!store.hasCustom(userId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'custom avatar not found' }));
        return;
      }
      // Bake on demand from a stored custom config.
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

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
}

module.exports = { createPresenceServer };
