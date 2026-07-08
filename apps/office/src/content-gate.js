'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const PITCH_REJECT = /\b(?:VERDICT|PITCH|STATUS)\s*:\s*REJECTED\b/i;
const PITCH_APPROVE = /\b(?:VERDICT|PITCH|STATUS)\s*:\s*APPROVED\b/i;
const COPY_REVISE = /\b(?:VERDICT|COPY|STATUS)\s*:\s*REVISE\b/i;
const COPY_PASS = /\b(?:VERDICT|COPY|STATUS)\s*:\s*(?:PASSED|APPROVED|CLEAR)\b/i;
const BRAND_BLOCK = /\b(?:VERDICT|BRAND|SAFETY|STATUS)\s*:\s*BLOCKED\b/i;
const BRAND_CLEAR = /\b(?:VERDICT|BRAND|SAFETY|STATUS)\s*:\s*CLEAR\b/i;

const RISK_PATTERNS = [
  { re: /\b(defamation|libel|slander)\b/i, reason: 'potential defamation language' },
  { re: /\b(guaranteed returns?|get rich quick)\b/i, reason: 'misleading financial claim' },
  { re: /\b(nigger|faggot|kike)\b/i, reason: 'hate speech' },
  { re: /©\s*\d{4}.*(?:reproduced|republished)/i, reason: 'possible copyright issue' },
  { re: /\b(?:lawsuit|sue us|illegal activity)\b/i, reason: 'legal risk phrasing' },
];

function readArtifactText(artifactPath) {
  if (!artifactPath) return '';
  const rel = String(artifactPath).replace(/^\/+/, '');
  const full = path.join(PROJECT_ROOT, rel);
  if (!full.startsWith(PROJECT_ROOT)) return '';
  try {
    return fs.readFileSync(full, 'utf8');
  } catch (_) {
    return '';
  }
}

function scanBrandRisks(text) {
  const body = String(text || '');
  const hits = [];
  for (const { re, reason } of RISK_PATTERNS) {
    if (re.test(body)) hits.push(reason);
  }
  return hits;
}

/**
 * @param {'pitch'|'copy'|'brand'} gateType
 * @param {{ artifactPath?: string, outcome?: string, save?: string }} ctx
 * @returns {{ verdict: string, action: 'advance'|'reject'|'revise'|'block', reasons?: string[] }}
 */
function evaluateGate(gateType, ctx = {}) {
  const text = [
    readArtifactText(ctx.artifactPath),
    ctx.save || '',
    ctx.outcome || '',
  ].join('\n');

  if (gateType === 'pitch') {
    if (PITCH_REJECT.test(text) || String(ctx.outcome || '').toLowerCase() === 'rejected') {
      return { verdict: 'REJECTED', action: 'reject', reasons: ['pitch rejected by gatekeeper'] };
    }
    if (PITCH_APPROVE.test(text) || String(ctx.outcome || '').toLowerCase() === 'approved') {
      return { verdict: 'APPROVED', action: 'advance' };
    }
    return { verdict: 'PENDING', action: 'advance', reasons: ['no explicit pitch verdict — defaulting to advance'] };
  }

  if (gateType === 'copy') {
    if (COPY_REVISE.test(text) || ['revise', 'revision', 'needs_edits'].includes(String(ctx.outcome || '').toLowerCase())) {
      return { verdict: 'REVISE', action: 'revise', reasons: ['copy edits required'] };
    }
    if (COPY_PASS.test(text) || ['passed', 'approved', 'ok', 'success'].includes(String(ctx.outcome || '').toLowerCase())) {
      return { verdict: 'PASSED', action: 'advance' };
    }
    return { verdict: 'PASSED', action: 'advance', reasons: ['no explicit copy verdict — defaulting to advance'] };
  }

  if (gateType === 'brand') {
    const risks = scanBrandRisks(text);
    if (BRAND_BLOCK.test(text) || String(ctx.outcome || '').toLowerCase() === 'blocked' || risks.length > 0) {
      return {
        verdict: 'BLOCKED',
        action: 'block',
        reasons: risks.length ? risks : ['brand safety block'],
      };
    }
    if (BRAND_CLEAR.test(text) || String(ctx.outcome || '').toLowerCase() === 'clear') {
      return { verdict: 'CLEAR', action: 'advance' };
    }
    return { verdict: 'CLEAR', action: 'advance', reasons: ['no explicit brand verdict — defaulting to clear'] };
  }

  return { verdict: 'UNKNOWN', action: 'advance' };
}

module.exports = {
  evaluateGate,
  readArtifactText,
  scanBrandRisks,
};
