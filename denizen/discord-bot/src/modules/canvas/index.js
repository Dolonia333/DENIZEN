'use strict';

/**
 * Bridge security / raid / room events onto tracker snapshots for Discord canvas.
 */

function createCanvasBridge(deps) {
  const { tracker, hub } = deps;

  function attach() {
    hub.on('security.antinuke', (evt) => {
      console.log('[canvas] antinuke', evt.payload);
    });
    hub.on('security.raid', (evt) => {
      console.log('[canvas] raid', evt.payload);
    });
    hub.on('security.antiraid', (evt) => {
      console.log('[canvas] antiraid', evt.payload);
    });
    hub.on('*', (evt) => {
      // Keep last events discoverable via tracker helper
      if (!tracker._canvasEvents) tracker._canvasEvents = [];
      tracker._canvasEvents.push({ type: evt.type, payload: evt.payload, ts: evt.ts });
      if (tracker._canvasEvents.length > 100) tracker._canvasEvents.shift();
    });
  }

  function register(registry) {
    registry.register({
      name: 'canvasevents',
      description: 'Recent security/map pipeline events',
      aliases: ['cevents'],
      module: 'canvas',
      async run(ctx) {
        const events = tracker._canvasEvents || [];
        if (!events.length) return ctx.reply('No canvas events yet — map is still quiet.');
        const lines = events.slice(-15).map((e) => `• ${e.type} @ ${new Date(e.ts).toISOString()}`);
        return ctx.reply(lines.join('\n'));
      },
    });

    registry.register({
      name: 'roomsnapshot',
      description: 'Who is in which voice/text room right now (map occupancy)',
      module: 'canvas',
      aliases: ['rooms', 'occupancy'],
      async run(ctx) {
        const helpCopy = require('../../help-copy');
        const snap = tracker.snapshot(ctx.guild.id);
        const rooms = (snap.rooms || [])
          .filter((r) => r.occupantCount > 0)
          .map((r) => {
            const label = r.type === 'voice' || r.type === 'stage' ? r.name : `#${r.name}`;
            return `• **${label}** — ${r.occupantCount}`;
          })
          .join('\n');
        const live = (snap.members || []).filter((m) => m.live).length;
        const map = helpCopy.mapUrl(ctx.guild.id);
        return ctx.reply(
          [
            `**Live occupancy** · ${snap.name || ctx.guild.name}`,
            rooms || '_Nobody on the map yet — join a voice channel!_',
            live ? `\nOpen mic: **${live}**` : '',
            '',
            `🗺️ ${map}`,
            '_Pixel status icons on the map: happy = open mic, chat bubble = recent text._',
          ].filter(Boolean).join('\n'),
        );
      },
    });
  }

  // Enrich snapshot API
  const origSnapshot = tracker.snapshot.bind(tracker);
  tracker.snapshot = (guildId) => {
    const base = origSnapshot(guildId);
    const events = (tracker._canvasEvents || []).filter(
      (e) => !guildId || e.payload?.guildId === guildId,
    ).slice(-20);
    if (guildId) return { ...base, canvasEvents: events };
    return { ...base, canvasEvents: events };
  };

  return { register, attach };
}

module.exports = { createCanvasBridge };
