'use strict';

/**
 * Local adversarial probe — dossier honesty gate (no NAS, no send).
 * Run: node denizen/scripts/dossier-adversarial-probe.js
 *
 * Tag: DENIZEN / dossier-system / honesty-gate-researcher-laundering
 */

const assert = require('node:assert/strict');
const dossier = require('../src/dossier-system');

const RM_KNOWN = {
  partner: 'RM Cyber',
  contact: 'Benjamin Ballard',
  realContext: [
    'Cybersecurity and infrastructure depth for government modernization',
    'Active dialogue on OMES EV00000919 teaming (agreement not yet signed)',
    'Joint pursuits — not passive capital',
  ],
  poisonExamples: [
    'OT/ICS security for water utilities',
    '$50M annual revenue',
    'ISO 27001 certified since 2010',
  ],
};

function bobResearchFixture({ poison = false } = {}) {
  if (poison) {
    return dossier.normalizeRecipientResearch({
      query: 'RM Cyber partnership research',
      summary: [
        'Research: "RM Cyber"',
        'RM Cyber specializes in OT/ICS security for water utilities [1].',
        '[1] RM Cyber Capabilities — https://example.com/fake-rm-profile',
      ].join('\n'),
      citations: [{
        index: 1,
        title: 'RM Cyber Capabilities',
        url: 'https://example.com/fake-rm-profile',
        snippet: poison ? 'OT/ICS security for water utilities' : 'Government cyber modernization services',
      }],
    });
  }
  return dossier.normalizeRecipientResearch({
    query: 'RM Cyber partnership research',
    summary: [
      'Research: "RM Cyber"',
      '[1] RM Cyber — https://rmcyber.com/',
      '    Cybersecurity and infrastructure for government clients.',
    ].join('\n'),
    citations: [{
      index: 1,
      title: 'RM Cyber',
      url: 'https://rmcyber.com/',
      snippet: 'Cybersecurity and infrastructure for government clients.',
    }],
  });
}

function printBobChecklist(research) {
  console.log('\n=== BOB RESEARCH — OPERATOR READ LINE BY LINE ===');
  console.log(`Query: ${research.query || '(none)'}`);
  for (const c of research.citations || []) {
    console.log(`\n[${c.index}] ${c.title}`);
    console.log(`    URL: ${c.url}`);
    console.log(`    Claim: ${c.snippet || c.title}`);
    console.log('    □ Verify against what you know from Ben / business-model.json');
    console.log('    □ Flag if claim is plausible but wrong (laundering survives URL gate — you catch it here)');
  }
  console.log('\nKnown-good context (do not require Bob to invent):');
  for (const line of RM_KNOWN.realContext) console.log(`  • ${line}`);
  console.log('\nPoison examples the gate should block or you must reject manually:');
  for (const line of RM_KNOWN.poisonExamples) console.log(`  ✗ ${line}`);
}

async function runProbe(name, fn) {
  process.stdout.write(`\n▶ ${name} … `);
  try {
    await fn();
    console.log('PASS');
    return { name, ok: true };
  } catch (err) {
    console.log('FAIL');
    console.error(`  ${err.message}`);
    return { name, ok: false, error: err.message };
  }
}

async function main() {
  console.log('DENIZEN dossier adversarial probe (local)\n');

  const results = [];

  results.push(await runProbe('Poison: unsourced revenue figure', async () => {
    const facts = dossier.loadFactsForSubject('1921');
    const html = '<p>Revenue hit $50000000 last year [IN-PROGRESS]</p>';
    const r = dossier.runHonestyPass({ html, facts, recipient: null, recipientResearch: null });
    assert.equal(r.ok, false, 'expected block');
    assert.ok(r.flags.some((f) => f.rule === 'no_unsourced_numbers'));
  }));

  results.push(await runProbe('Poison: Bob summary only — no URLs (old gate path)', async () => {
    const facts = dossier.loadFactsForSubject('1921');
    const research = dossier.normalizeRecipientResearch({
      summary: 'RM Cyber leads OT/ICS for water utilities and SCADA hardening.',
      citations: [],
    });
    const html = dossier.buildDraftHtml({
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: dossier.loadSkin('1921'),
      facts,
      recipientResearch: research,
      sectionManifest: dossier.selectSections('partnership-dossier', 'partner'),
    });
    const r = dossier.runHonestyPass({ html, facts, recipient: 'RM Cyber', recipientResearch: research });
    assert.equal(r.ok, false);
    assert.ok(r.flags.some((f) => f.rule === 'recipient_citations_required'));
  }));

  results.push(await runProbe('Poison: cited research but freeform Fit prose (laundering)', async () => {
    const facts = dossier.loadFactsForSubject('1921');
    const research = bobResearchFixture({ poison: true });
    let html = dossier.buildDraftHtml({
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: dossier.loadSkin('1921'),
      facts,
      recipientResearch: research,
      sectionManifest: dossier.selectSections('partnership-dossier', 'partner'),
    });
    html = html.replace(
      '</div>\n      <h3>1921 joint',
      '<p>RM Cyber is the dominant OT/ICS vendor for water utilities statewide.</p></div>\n      <h3>1921 joint',
    );
    const r = dossier.runHonestyPass({ html, facts, recipient: 'RM Cyber', recipientResearch: research });
    assert.equal(r.ok, false);
    assert.ok(r.flags.some((f) => f.rule === 'recipient_claim_uncited'));
  }));

  results.push(await runProbe('Clean: citation-backed Fit claims pass gate', async () => {
    const facts = dossier.loadFactsForSubject('1921');
    const research = bobResearchFixture({ poison: false });
    const html = dossier.buildDraftHtml({
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: dossier.loadSkin('1921'),
      facts,
      recipientResearch: research,
      sectionManifest: dossier.selectSections('partnership-dossier', 'partner'),
    });
    const r = dossier.runHonestyPass({ html, facts, recipient: 'RM Cyber', recipientResearch: research });
    assert.equal(r.ok, true, JSON.stringify(r.flags, null, 2));
  }));

  results.push(await runProbe('RM Cyber draft (HTML only, mocked Bob) — operator checklist', async () => {
    const research = bobResearchFixture({ poison: false });
    printBobChecklist(research);
    const facts = dossier.loadFactsForSubject('1921');
    const html = dossier.buildDraftHtml({
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: dossier.loadSkin('1921'),
      facts,
      recipientResearch: research,
      sectionManifest: dossier.selectSections('partnership-dossier', 'partner'),
    });
    const r = dossier.runHonestyPass({ html, facts, recipient: 'RM Cyber', recipientResearch: research });
    assert.equal(r.ok, true);
    console.log('\n  Fit block renders citation-backed claims only (no summary dump).');
  }));

  if (await dossier.isGitRepository()) {
    results.push(await runProbe('Technical dossier: facts pinned to HEAD commit', async () => {
      let facts = dossier.loadFactsForSubject('denizen');
      facts = await dossier.bindTechnicalFactsToCommit(facts, { facts_ref: 'HEAD' });
      assert.ok(facts.repo_pin?.commit);
      assert.ok(facts.repo_pin.test_files >= 0);
      assert.match(facts.evidence_provenance, /read from commit/);
      console.log(`  commit ${facts.repo_pin.short} · ${facts.repo_pin.test_files} test files`);
    }));

    results.push(await runProbe('Technical dossier: test count at commit allowed, random count blocked', async () => {
      let facts = dossier.loadFactsForSubject('denizen');
      facts = await dossier.bindTechnicalFactsToCommit(facts, { facts_ref: 'HEAD' });
      const allowedHtml = `<p>${facts.repo_pin.test_files} test files at commit ${facts.repo_pin.short} [DONE]</p>`;
      const ok = dossier.runHonestyPass({ html: allowedHtml, facts, recipient: null, recipientResearch: null });
      assert.equal(ok.ok, true);
      const badHtml = '<p>646 tests pass at commit deadbeef [DONE]</p>';
      const bad = dossier.runHonestyPass({ html: badHtml, facts, recipient: null, recipientResearch: null });
      assert.equal(bad.ok, false);
    }));
  } else {
    console.log('\n⚠ Skipping commit-pin probes — not a git repo');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} probes passed ===`);
  if (failed.length) {
    process.exitCode = 1;
    return;
  }
  console.log('\nNext: run live Bob research locally (Brave key), read citations against Ben knowledge, then deploy.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
