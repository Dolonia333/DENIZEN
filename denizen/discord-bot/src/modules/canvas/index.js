'use strict';

/**
 * Bridge security / raid / room events onto tracker snapshots for Discord canvas.
 * Prefer enriching /presence payloads over console spam.
 */

function createCanvasBridge(deps) {
  const { tracker, hub } = deps;

  function attach() {
    hub.on('*', (evt) => {
      if (!tracker._canvasEvents) tracker._canvasEvents = [];
      tracker._canvasEvents.push({ type: evt.type, payload: evt.payload, ts: evt.ts });
      if (tracker._canvasEvents.length > 100) tracker._canvasEvents.shift();
    });
  }

  function register(registry) {
    registry.register({
      name: 'canvasevents',
      description: 'Show recent security/canvas events',
      aliases: ['cevents'],
      module: 'canvas',
      async run(ctx) {
        const events = tracker._canvasEvents || [];
        if (!events.length) return ctx.reply('No canvas events yet.');
        const lines = events.slice(-15).map((e) => `• ${e.type} @ ${new Date(e.ts).toISOString()}`);
        return ctx.reply(lines.join('\n'));
      },
    });

    registry.register({
      name: 'roomsnapshot',
      description: 'Dump tracker room snapshot for this guild',
      module: 'canvas',
      async run(ctx) {
        const snap = tracker.snapshot(ctx.guild.id);
        const rooms = (snap.rooms || [])
          .filter((r) => r.occupantCount > 0)
          .map((r) => `${r.type === 'voice' ? r.name : '#' + r.name}: ${r.occupantCount}`)
          .join('\n');
        const sec = (tracker._canvasEvents || []).filter((e) => e.type.startsWith('security')).slice(-5);
        return ctx.reply(
          `**Rooms**\n${rooms || '(empty)'}\n**Recent security**\n${sec.map((e) => e.type).join(', ') || '(none)'}`,
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
