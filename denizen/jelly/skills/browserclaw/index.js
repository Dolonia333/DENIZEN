'use strict';

module.exports = {
  meta: {
    name: 'browserclaw',
    description: 'Multi-step browser automation via BrowserClaw server',
    mode: 'visible',
  },
  async run({ npcName, params, deps, config }) {
    const pcActivity = deps.pcActivity;
    const bcUrl = (config?.browser?.browserclawUrl || process.env.BROWSERCLAW_URL || 'http://127.0.0.1:18792').replace(/\/$/, '');
    const task = params?.task || params?.query || params?.q || '';
    const url = params?.url || null;
    const bcStart = Date.now();
    const activity = pcActivity.record({
      npc: npcName, kind: 'browserclaw',
      task: String(task || url || 'browser task').slice(0, 120),
      mode: params?.mode === 'background' ? 'background' : 'visible',
      status: 'started',
    });

    try {
      const res = await fetch(`${bcUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task || `Open ${url}`, url: url || undefined }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      const output = (data.result || data.error || text).slice(0, 800);
      const ok = res.ok && data.ok !== false;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'browserclaw', task: activity.task,
        mode: activity.mode, status: ok ? 'done' : 'failed',
        durationMs: Date.now() - bcStart, detail: output.slice(0, 240),
      });
      return { ok, output, skill: 'browserclaw' };
    } catch (err) {
      const output = `BrowserClaw unavailable (${bcUrl}): ${err.message}. Start: node denizen/jelly/services/browserclaw/server.mjs`;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'browserclaw', task: activity.task,
        mode: activity.mode, status: 'failed',
        durationMs: Date.now() - bcStart, detail: output.slice(0, 240),
      });
      return { ok: false, output, skill: 'browserclaw' };
    }
  },
};
