#!/usr/bin/env node
'use strict';

/** CLI wrapper — one-shot or loop. Production uses in-process start from server.js. */
const loop = require('../src/npc-mcp-cloud-patrol-loop.js');
const npcGateway = require('../src/denizen-npc-mcp-gateway.js');
const denizenDb = require('../src/denizen-db');

const ONCE = process.argv.includes('--once');

(async () => {
  await denizenDb.init();
  const tokens = await loop.ensureTokens(denizenDb.orgId, npcGateway.createMcpToken);
  if (ONCE) {
    await loop.runCycle(tokens);
    process.exit(0);
  }
  const r = await loop.startNpcMcpCloudPatrol({
    orgId: denizenDb.orgId,
    createMcpToken: npcGateway.createMcpToken,
  });
  if (!r.ok) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
