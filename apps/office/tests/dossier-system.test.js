'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const dossier = require('../src/pipelines/dossier-system');

const CITED_RESEARCH = dossier.normalizeRecipientResearch({
  query: 'RM Cyber',
  citations: [{
    index: 1,
    title: 'RM Cyber',
    url: 'https://rmcyber.com/',
    snippet: 'Cybersecurity services for government clients.',
  }],
});

describe('dossier-system honesty gate — citation traceability', () => {
  it('blocks research summary without URL citations', () => {
    const facts = dossier.loadFactsForSubject('1921');
    const research = dossier.normalizeRecipientResearch({
      summary: 'RM Cyber dominates OT/ICS for utilities.',
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
  });

  it('blocks uncited recipient prose injected into fit block', () => {
    const facts = dossier.loadFactsForSubject('1921');
    let html = dossier.buildDraftHtml({
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: dossier.loadSkin('1921'),
      facts,
      recipientResearch: CITED_RESEARCH,
      sectionManifest: dossier.selectSections('partnership-dossier', 'partner'),
    });
    html = html.replace('</ul>', '</ul><p>RM Cyber leads OT/ICS statewide.</p>');
    const r = dossier.runHonestyPass({ html, facts, recipient: 'RM Cyber', recipientResearch: CITED_RESEARCH });
    assert.equal(r.ok, false);
    assert.ok(r.flags.some((f) => f.rule === 'recipient_claim_uncited'));
  });

  it('passes citation-backed fit claims', () => {
    const facts = dossier.loadFactsForSubject('1921');
    const html = dossier.buildDraftHtml({
      type: 'partnership-dossier',
      reader: 'partner',
      recipient: 'RM Cyber',
      subject: '1921',
      skin: dossier.loadSkin('1921'),
      facts,
      recipientResearch: CITED_RESEARCH,
      sectionManifest: dossier.selectSections('partnership-dossier', 'partner'),
    });
    const r = dossier.runHonestyPass({ html, facts, recipient: 'RM Cyber', recipientResearch: CITED_RESEARCH });
    assert.equal(r.ok, true);
  });

  it('normalizeRecipientResearch parses [n] title — url lines', () => {
    const norm = dossier.normalizeRecipientResearch({
      summary: '[1] Example Co — https://example.com/\n    Does things.',
    });
    assert.equal(norm.citations.length, 1);
    assert.equal(norm.citations[0].url, 'https://example.com/');
  });
});

describe('dossier-system commit pin', () => {
  it('bindTechnicalFactsToCommit adds repo_pin when git available', async () => {
    if (!(await dossier.isGitRepository())) return;
    let facts = dossier.loadFactsForSubject('denizen');
    facts = await dossier.bindTechnicalFactsToCommit(facts, { facts_ref: 'HEAD' });
    assert.ok(facts.repo_pin.commit);
    assert.ok(facts._allowedValues.has(facts.repo_pin.short));
  });
});

describe('dossier proposal persistence', () => {
  it('runDossierTask persists proposal to data store', async () => {
    const npc = `TEST_${Date.now()}`;
    const before = dossier.getProposals().length;
    const research = dossier.normalizeRecipientResearch({
      citations: [{ index: 1, title: 'T', url: 'https://example.com/', snippet: 'Test claim.' }],
    });
    const result = await dossier.runDossierTask({
      npc,
      params: {
        type: 'partnership-dossier',
        reader: 'partner',
        recipient: 'Test Partner',
        subject: '1921',
        recipient_citations: research.citations,
      },
      deps: {},
      broadcast: () => {},
    });
    assert.equal(result.ok, true, result.error || JSON.stringify(result.flags));
    assert.ok(dossier.getProposals().length >= before + 1);
    dossier.rejectProposal(result.proposalId);
  });
});
