'use strict';

/**
 * Merge mesh bouncer_patrol job results into worldState.bouncerPatrol.
 */

function applyMeshPatrolResult(worldState, nodeId, patrol = {}) {
  if (!worldState || !nodeId) return null;
  const id = String(nodeId).trim();
  if (!id) return null;

  const nodes = { ...(worldState.bouncerPatrol?.nodes || {}) };
  nodes[id] = {
    ts: Date.now(),
    ok: patrol.ok !== false,
    summary: patrol.summary || '',
    openPorts: patrol.openPorts || [],
    elapsed: patrol.elapsed || 0,
    health: patrol.health || null,
  };

  const entries = Object.entries(nodes);
  const healthy = entries.filter(([, v]) => v.ok).length;
  const summaries = entries
    .map(([nid, v]) => `${nid}: ${v.ok ? 'UP' : 'DOWN'}${v.summary ? ` — ${v.summary}` : ''}`)
    .slice(0, 8);

  const aggregate = {
    ts: Date.now(),
    nodes,
    totalNodes: entries.length,
    healthyNodes: healthy,
    unhealthyNodes: entries.length - healthy,
    summary: [
      `Mesh patrol (${entries.length} node${entries.length === 1 ? '' : 's'})`,
      ...summaries,
    ].join('\n'),
    openPorts: entries.flatMap(([, v]) => v.openPorts || []),
    elapsed: patrol.elapsed || 0,
    mesh: true,
  };

  worldState.bouncerPatrol = aggregate;
  return aggregate;
}

module.exports = { applyMeshPatrolResult };
