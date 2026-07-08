'use strict';

const path = require('node:path');
const dossierSystem = require('../../../src/pipelines/dossier-system');
const citedResearch = require('../../../src/visitors/visitor-cited-research');

module.exports = {
  meta: {
    name: 'pdf-dossier',
    description: 'Branded PDF dossiers — canon docs/BRANDED_DOSSIER_SYSTEM.md',
    mode: 'background',
    aliases: ['dossier', 'branded-dossier'],
  },

  async run({ npcName, params, deps, skill }) {
    const broadcast = deps.broadcast || (() => {});
    broadcast({
      type: 'npc_skill_start',
      npcName,
      skill: 'pdf-dossier',
      skillParams: params,
      ts: Date.now(),
    });

    const result = await dossierSystem.runDossierTask({
      npc: npcName,
      params,
      deps: {
        runResearch: deps.runResearch || deps.runWebSearch,
        runCitedResearch: deps.runCitedResearch
          || ((q, o) => citedResearch.runCitedResearch(q, o)),
        ownerIdentityId: deps.ownerIdentityId || deps.identityId || null,
        ownerProfile: deps.ownerProfile || null,
      },
      broadcast,
    });

    const output = result.output
      || result.error
      || JSON.stringify({ proposalId: result.proposalId, pdfPath: result.pdfPath }, null, 2);

    return {
      ok: result.ok,
      output: String(output).slice(0, 4000),
      skill,
      report: result,
    };
  },
};
