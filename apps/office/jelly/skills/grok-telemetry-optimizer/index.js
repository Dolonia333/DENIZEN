'use strict';

/**
 * grok-telemetry-optimizer
 * 
 * On-demand tool that scans recent LLM telemetry and produces insights.
 * The output is designed to be fed to the real Grok in the CLI (or via consult-grok skill)
 * so that Grok can analyze and inject optimizations back into local NPCs.
 * 
 * This hooks the jelly skill runtime directly to the "Grok makes local models smarter" loop.
 * NPCs can run this skill when they want Grok to review their performance data.
 */

const fs = require('fs');
const path = require('path');

const TELEMETRY = path.join(__dirname, '../../../data/llm-telemetry.jsonl');

module.exports = {
  meta: {
    name: 'grok-telemetry-optimizer',
    description: 'Scan local LLM telemetry and prepare analysis for real Grok (CLI). Helps local models learn from their own performance data.',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    let entries = [];
    try {
      // Safe snapshot read (avoids write lock on live append-only file from concurrent NPCs)
      const tmp = TELEMETRY + '.snapshot';
      fs.copyFileSync(TELEMETRY, tmp);
      const lines = fs.readFileSync(tmp, 'utf8').trim().split('\n').slice(-500);
      entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      fs.unlinkSync(tmp);
    } catch (e) {
      return { ok: false, output: 'No telemetry data available yet.' };
    }

    const byNpc = {};
    entries.forEach(e => {
      const n = e.npc || 'unknown';
      if (!byNpc[n]) byNpc[n] = { count: 0, lats: [], tokens: 0 };
      byNpc[n].count++;
      if (e.latencyMs) byNpc[n].lats.push(e.latencyMs);
      byNpc[n].tokens += (e.tokensIn || 0) + (e.tokensOut || 0);
    });

    let facts = [];
    Object.entries(byNpc).sort((a,b) => b[1].count - a[1].count).slice(0,5).forEach(([n, d]) => {
      const avg = d.lats.length ? (d.lats.reduce((a,b)=>a+b,0)/d.lats.length).toFixed(0) : 'n/a';
      const avgTok = d.tokens / d.count;
      facts.push(`[FACT:high_activity_${n.toLowerCase()}] ${n}: ${d.count} events, avg latency ${avg}ms, avg tokens ${avgTok.toFixed(0)}`);
      if (avg > 4000) facts.push(`[FACT:latency_bottleneck_${n.toLowerCase()}] High latency on ${n} — trigger lean memory flush if history > 2500 tokens`);
    });

    // Dense, machine-readable output only (no prose to avoid context bloat in local Qwen)
    const denseFacts = facts.join('\n') || '[FACT:no_issues] Telemetry clean in sample window.';

    const output = `NPC ${npcName} ran grok-telemetry-optimizer.\n${denseFacts}\n\n[INJECT VIA MCP AS DENSE FACTS ONLY] Use consult-grok or direct memory update with above [FACT:*] lines.`;

    broadcast({ type: 'npc_report_to_ceo', npcName, text: 'Ran grok-telemetry-optimizer. Dense facts ready for real Grok injection.' });

    return {
      ok: true,
      output: output,
      skill: 'grok-telemetry-optimizer',
      broadcastResult: true,
      inject: true,
      facts: facts,  // structured for downstream compression
    };
  },
};
