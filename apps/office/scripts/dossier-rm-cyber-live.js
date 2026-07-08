'use strict';

/**
 * Live RM Cyber cited research + operator checklist (no PDF unless --render).
 * Run: node apps/office/scripts/dossier-rm-cyber-live.js [--render]
 */

const dossier = require('../src/pipelines/dossier-system');

const KNOWN = [
  'Cybersecurity and infrastructure depth for government modernization',
  'Active dialogue on OMES EV00000919 teaming (agreement not yet signed)',
  'Joint pursuits — not passive capital',
];

function printChecklist(research) {
  console.log('\n=== BOB RESEARCH — READ LINE BY LINE ===\n');
  console.log(`Query: ${research.query || '(none)'}\n`);
  for (const c of research.citations || []) {
    console.log(`[${c.index}] ${c.title}`);
    console.log(`    URL: ${c.url}`);
    console.log(`    Claim: ${c.snippet || c.title}`);
    console.log('    □ Verify against Ben / business-model.json');
    console.log('    □ Reject plausible-but-wrong claims even if URL exists\n');
  }
  console.log('Known-good (canon — do not require Bob to invent):');
  for (const line of KNOWN) console.log(`  • ${line}`);
}

async function main() {
  const render = process.argv.includes('--render');
  const query = 'RM Cyber Benjamin Ballard cybersecurity government Oklahoma teaming partner';

  let research;
  try {
    const cited = require('../src/visitors/visitor-cited-research');
    console.log('Running live cited research (Brave key required)…');
    research = dossier.normalizeRecipientResearch(await cited.runCitedResearch(query, { count: 5, read: 0 }));
    if (research.error && !research.citations.length) {
      throw new Error(research.error);
    }
  } catch (err) {
    console.warn(`Live research unavailable (${err.message}) — using mock citations for gate demo.`);
    research = dossier.normalizeRecipientResearch({
      query,
      citations: [{
        index: 1,
        title: 'RM Cyber',
        url: 'https://rmcyber.com/',
        snippet: 'Cybersecurity and infrastructure for government clients.',
      }],
    });
  }

  printChecklist(research);

  const rawCount = (research.citations || []).length;
  const filtered = dossier.filterRecipientCitations(research.citations, 'RM Cyber');
  research = dossier.normalizeRecipientResearch({
    query: research.query,
    summary: research.summary,
    citations: filtered.map((c, i) => ({ ...c, index: i + 1 })),
  });
  if (filtered.length !== rawCount) {
    console.log(`\nFit block uses ${research.citations.length}/${rawCount} recipient-relevant citation(s).`);
  }

  const html = dossier.buildDraftHtml({
    type: 'partnership-dossier',
    reader: 'partner',
    recipient: 'RM Cyber',
    subject: '1921',
    skin: dossier.loadSkin('1921'),
    facts: dossier.loadFactsForSubject('1921'),
    recipientResearch: research,
    sectionManifest: dossier.selectSections('partnership-dossier', 'partner'),
  });

  const honesty = dossier.runHonestyPass({
    html,
    facts: dossier.loadFactsForSubject('1921'),
    recipient: 'RM Cyber',
    recipientResearch: research,
  });

  console.log(`\nHonesty gate: ${honesty.ok ? 'PASS' : 'BLOCKED'}`);
  if (!honesty.ok) {
    console.log(JSON.stringify(honesty.flags, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!render) {
    console.log('\nHTML draft ready (gate passed). Re-run with --render to write PDF via pdf-dossier skill path.');
    return;
  }

  const result = await dossier.runDossierTask({
    npc: 'Sarah',
    params: {
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: '1921',
      recipient_citations: research.citations,
      recipient_research: research.summary,
    },
    deps: {},
    broadcast: () => {},
  });

  if (!result.ok) {
    console.error('Render failed:', result.error);
    process.exitCode = 1;
    return;
  }
  console.log('\nPDF:', result.pdfPath);
  console.log('Approve via GET /api/dossier-proposals then POST .../approve');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
