'use strict';

/**
 * End-to-end dossier smoke (local, no NAS). Mock Bob research + optional PDF render.
 * Run: node apps/office/scripts/dossier-smoke.js
 */

const dossier = require('../src/pipelines/dossier-system');

const MOCK_BOB = dossier.normalizeRecipientResearch({
  query: 'RM Cyber partnership research',
  citations: [{
    index: 1,
    title: 'RM Cyber',
    url: 'https://rmcyber.com/',
    snippet: 'Cybersecurity and infrastructure for government clients.',
  }],
});

async function main() {
  console.log('=== dossier-smoke (partnership + technical) ===\n');

  const partnership = await dossier.runDossierTask({
    npc: 'Sarah',
    params: {
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: '1921',
      recipient_citations: MOCK_BOB.citations,
      recipient_research: MOCK_BOB.summary,
    },
    deps: {},
    broadcast: () => {},
  });

  if (!partnership.ok) {
    console.error('Partnership dossier FAILED:', partnership.error);
    console.error(JSON.stringify(partnership.flags, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log('Partnership OK:', partnership.pdfPath);
  console.log('  proposalId:', partnership.proposalId);

  if (!(await dossier.isGitRepository())) {
    console.log('\nSkipping technical dossier — not a git repo');
    return;
  }

  const technical = await dossier.runDossierTask({
    npc: 'Grok',
    params: {
      type: 'technical-dossier',
      subject: 'denizen',
      facts_ref: 'HEAD',
    },
    deps: {},
    broadcast: () => {},
  });

  if (!technical.ok) {
    console.error('Technical dossier FAILED:', technical.error);
    process.exitCode = 1;
    return;
  }
  console.log('\nTechnical OK:', technical.pdfPath);
  console.log('  repo_pin:', technical.repo_pin);

  const stored = dossier.getProposals();
  console.log(`\nStored proposals: ${stored.length} (persisted to data/dossier-proposals.json)`);
  console.log('\n=== smoke passed ===');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
