'use strict';

/**
 * World-state broadcast fan-out for horizontal WS scaling.
 * Primary publishes coalesced frames; followers relay to local clients only.
 *
 * Drivers: memory (no-op, default) | redis (requires `npm install redis`)
 */

const CHANNEL_DEFAULT = 'denizen:world:broadcast';

function resolveDriver(env = process.env) {
  return String(env.DENIZEN_WORLD_PUBSUB || 'memory').trim().toLowerCase();
}

function resolveRedisUrl(env = process.env) {
  return String(
    env.DENIZEN_REDIS_URL
    || env.REDIS_URL
    || env.DENIZEN_WORLD_PUBSUB_URL
    || '',
  ).trim() || null;
}

function resolveChannel(env = process.env) {
  return String(env.DENIZEN_WORLD_PUBSUB_CHANNEL || CHANNEL_DEFAULT).trim();
}

function resolveRole(env = process.env) {
  const role = String(env.DENIZEN_SERVER_ROLE || 'primary').trim().toLowerCase();
  if (role === 'follower' || role === 'standby') return role;
  return 'primary';
}

function loadRedisClient() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require('redis');
  } catch (_) {
    return null;
  }
}

function createMemoryPubsub() {
  const subs = new Set();
  return {
    driver: 'memory',
    enabled: false,
    role: resolveRole(),
    channel: resolveChannel(),
    async publish(_frame) {},
    async subscribe(handler) {
      if (typeof handler !== 'function') return () => {};
      subs.add(handler);
      return () => subs.delete(handler);
    },
    buildStatus() {
      return { driver: 'memory', enabled: false, role: resolveRole() };
    },
    async close() {},
  };
}

function createRedisPubsub(opts = {}) {
  const env = opts.env || process.env;
  const redis = loadRedisClient();
  const url = resolveRedisUrl(env);
  const channel = resolveChannel(env);
  const role = resolveRole(env);

  if (!redis || !url) {
    const reason = !redis ? 'redis package not installed' : 'DENIZEN_REDIS_URL not set';
    console.warn(`[world-pubsub] Redis requested but unavailable (${reason}) — using memory`);
    return createMemoryPubsub();
  }

  let publisher = null;
  let subscriber = null;
  let connected = false;
  let lastError = null;
  const metrics = {
    published: 0,
    received: 0,
    lastPublishAt: null,
    lastReceiveAt: null,
    lastLagMs: null,
  };

  async function ensureClients() {
    if (publisher && subscriber) return;
    publisher = redis.createClient({ url });
    subscriber = publisher.duplicate();
    publisher.on('error', (err) => { lastError = err?.message || String(err); });
    subscriber.on('error', (err) => { lastError = err?.message || String(err); });
    await publisher.connect();
    await subscriber.connect();
    connected = true;
  }

  return {
    driver: 'redis',
    enabled: true,
    role,
    channel,
    async publish(frame) {
      if (role !== 'primary') return;
      try {
        await ensureClients();
        const payload = typeof frame === 'string' ? frame : JSON.stringify(frame);
        await publisher.publish(channel, payload);
        metrics.published += 1;
        metrics.lastPublishAt = Date.now();
      } catch (err) {
        lastError = err?.message || String(err);
        console.warn('[world-pubsub] publish failed:', lastError);
      }
    },
    async subscribe(handler) {
      if (typeof handler !== 'function') return () => {};
      try {
        await ensureClients();
        const onMessage = (raw) => {
          try {
            const parsed = JSON.parse(raw);
            metrics.received += 1;
            metrics.lastReceiveAt = Date.now();
            if (parsed && typeof parsed.ts === 'number') {
              metrics.lastLagMs = Math.max(0, metrics.lastReceiveAt - parsed.ts);
            }
            handler(parsed);
          } catch (err) {
            console.warn('[world-pubsub] bad frame:', err?.message || err);
          }
        };
        await subscriber.subscribe(channel, onMessage);
        return async () => {
          try {
            await subscriber.unsubscribe(channel);
          } catch (_) {}
        };
      } catch (err) {
        lastError = err?.message || String(err);
        console.warn('[world-pubsub] subscribe failed:', lastError);
        return () => {};
      }
    },
    buildStatus() {
      return {
        driver: 'redis',
        enabled: true,
        role,
        channel,
        connected,
        error: lastError,
        metrics: { ...metrics },
      };
    },
    async close() {
      try { await subscriber?.quit(); } catch (_) {}
      try { await publisher?.quit(); } catch (_) {}
      publisher = null;
      subscriber = null;
      connected = false;
    },
  };
}

function createWorldPubsub(opts = {}) {
  const env = opts.env || process.env;
  const driver = resolveDriver(env);
  if (driver === 'redis') return createRedisPubsub(opts);
  return createMemoryPubsub();
}

module.exports = {
  CHANNEL_DEFAULT,
  resolveDriver,
  resolveRedisUrl,
  resolveChannel,
  resolveRole,
  createWorldPubsub,
};
