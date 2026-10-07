'use strict';

/**
 * Business Studio evidence ledger — boring, deterministic, auditable.
 *
 * Rule: Task completed ≠ business progress.
 *       Qualifying evidence meeting a requirement = business progress.
 *
 * Every downstream counter must ask: "What qualifying evidence exists?"
 * Never trust experiment.completedCount, metric.current, or manual overrides
 * as independent sources of truth.
 */

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Active = not revoked / deleted. */
function isActiveEvidence(e) {
  if (!e || typeof e !== 'object') return false;
  if (e.revoked === true || e.deleted === true) return false;
  const st = String(e.status || '').toLowerCase();
  if (st === 'revoked' || st === 'deleted' || st === 'void') return false;
  return true;
}

/**
 * Stable fingerprint for dedupe.
 * Prefer CRM contact + type + requirement; fall back to title/experiment.
 */
function evidenceFingerprint(e) {
  if (!e) return '';
  if (e.fingerprint) return String(e.fingerprint);
  const type = String(e.type || 'manual').toLowerCase();
  const req = String(e.requirementKey || '').toLowerCase();
  const funding = String(e.fundingKey || (e.linkedFundingKeys || [])[0] || '').toLowerCase();
  const exp = String(e.experimentId || (e.linkedExperimentIds || [])[0] || '').toLowerCase();
  const contact = String(e.contactId || '').trim().toLowerCase();
  const title = normalizeTitle(e.title);
  if (contact) {
    return ['contact', type, req || funding, contact].join('|');
  }
  return ['title', type, req || funding, exp, title].join('|');
}

function sortByCreatedAsc(a, b) {
  const ta = Date.parse(a.createdAt || a.created_at || 0) || 0;
  const tb = Date.parse(b.createdAt || b.created_at || 0) || 0;
  if (ta !== tb) return ta - tb;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

/**
 * Dedupe active evidence: oldest qualifying record wins per fingerprint.
 * Returns { unique, duplicates } where duplicates are skipped copies.
 */
function dedupeEvidence(list) {
  const active = (Array.isArray(list) ? list : []).filter(isActiveEvidence);
  const seen = new Map();
  const unique = [];
  const duplicates = [];
  const ordered = [...active].sort(sortByCreatedAsc);
  for (const e of ordered) {
    const fp = evidenceFingerprint(e);
    if (!fp) {
      unique.push(e);
      continue;
    }
    if (seen.has(fp)) {
      duplicates.push({ evidence: e, duplicateOf: seen.get(fp) });
      continue;
    }
    seen.set(fp, e.id);
    unique.push(e);
  }
  return { unique, duplicates, fingerprints: seen };
}

/**
 * Query: what qualifying evidence exists?
 */
function qualifyingEvidence(state, query = {}) {
  const dedupe = query.dedupe !== false;
  let list = (Array.isArray(state?.evidence) ? state.evidence : []).filter(isActiveEvidence);

  list = list.filter((e) => {
    if (e.type !== 'interview' && e.kind !== 'discovery_interview') return true;
    return e.qualifying !== false;
  });

  if (query.type) {
    list = list.filter((e) => e.type === query.type);
  }

  if (query.experimentId) {
    const id = query.experimentId;
    list = list.filter((e) =>
      e.experimentId === id
      || (Array.isArray(e.linkedExperimentIds) && e.linkedExperimentIds.includes(id))
    );
  }

  if (query.requirementKey || query.requirementId || query.requirement) {
    const req = query.requirement || null;
    const key = query.requirementKey || req?.key || null;
    const rid = query.requirementId || req?.id || null;
    const assumptionKey = req?.linkedAssumptionKey || null;
    const evidenceType = req?.evidenceType || null;
    list = list.filter((e) => {
      if (rid && Array.isArray(e.linkedRequirementIds) && e.linkedRequirementIds.includes(rid)) return true;
      if (key && e.requirementKey === key) return true;
      if (assumptionKey && Array.isArray(e.linkedAssumptionKeys)
        && e.linkedAssumptionKeys.includes(assumptionKey)) {
        if (evidenceType && e.type && e.type !== evidenceType && evidenceType !== 'document') {
          return false;
        }
        return true;
      }
      return false;
    });
    if (evidenceType && evidenceType !== 'document') {
      list = list.filter((e) => !e.type || e.type === evidenceType);
    }
  }

  if (query.fundingKey || query.fundingItem) {
    const item = query.fundingItem || null;
    const key = query.fundingKey || item?.key || null;
    list = list.filter((e) => {
      if (!key) return false;
      if (Array.isArray(e.linkedFundingKeys) && e.linkedFundingKeys.includes(key)) return true;
      if (e.fundingKey === key) return true;
      if (item?.evidenceTypes && item.evidenceTypes.includes(e.type)
        && (e.fundingKey === key || (Array.isArray(e.tags) && e.tags.includes(key)))) {
        return true;
      }
      return false;
    });
  }

  if (query.assumptionKey) {
    const key = query.assumptionKey;
    list = list.filter((e) =>
      Array.isArray(e.linkedAssumptionKeys) && e.linkedAssumptionKeys.includes(key)
    );
  }

  if (!dedupe) {
    return {
      evidence: list,
      count: list.length,
      evidenceIds: list.map((e) => e.id),
      duplicates: [],
    };
  }

  const { unique, duplicates } = dedupeEvidence(list);
  return {
    evidence: unique,
    count: unique.length,
    evidenceIds: unique.map((e) => e.id),
    duplicates,
  };
}

function findEvidenceById(state, evidenceId) {
  return (state.evidence || []).find((e) => e && e.id === evidenceId) || null;
}

function findDuplicate(state, candidate) {
  const fp = evidenceFingerprint(candidate);
  if (!fp) return null;
  const { unique } = dedupeEvidence(state.evidence || []);
  return unique.find((e) => evidenceFingerprint(e) === fp) || null;
}

/**
 * Soft-revoke evidence. Downstream counts must drop on next derive.
 */
function revokeEvidence(state, evidenceId, opts = {}) {
  const ev = findEvidenceById(state, evidenceId);
  if (!ev) return { ok: false, error: 'evidence_not_found' };
  ev.revoked = true;
  ev.status = 'revoked';
  ev.revokedAt = new Date().toISOString();
  ev.revokeReason = opts.reason || opts.revokeReason || 'revoked';
  return { ok: true, evidence: ev };
}

/**
 * Derive assumption stance from linked evidence — never auto-validates.
 * Program completion (enough interviews) ≠ business validation (hypothesis proved).
 */
function assumptionStance(state, assumption) {
  const key = assumption?.key;
  if (!key) {
    return {
      status: assumption?.status || 'unknown',
      confidence: assumption?.confidence || 'insufficient',
      supports: 0,
      contradicts: 0,
      neutral: 0,
      validated: false,
      why: 'No assumption key.',
    };
  }
  const { evidence } = qualifyingEvidence(state, { assumptionKey: key });
  let supports = 0;
  let contradicts = 0;
  let neutral = 0;
  for (const e of evidence) {
    const stance = String(e.stance || e.hypothesisStance || 'neutral').toLowerCase();
    if (stance === 'supports' || stance === 'support' || stance === 'confirm') supports += 1;
    else if (stance === 'contradicts' || stance === 'contradict' || stance === 'refute') contradicts += 1;
    else neutral += 1;
  }
  const founderValidated = assumption.status === 'validated';
  let confidence = 'insufficient';
  if (contradicts > supports) confidence = 'contradicted';
  else if (supports + contradicts + neutral >= 10 && supports > contradicts) confidence = 'sufficient_to_decide';
  else if (supports + contradicts + neutral > 0) confidence = 'insufficient';

  const status = founderValidated
    ? 'validated'
    : (confidence === 'contradicted' ? 'challenged' : (assumption.status === 'challenged' ? 'challenged' : 'testing'));

  return {
    key,
    title: assumption.title,
    status: founderValidated ? 'validated' : status,
    confidence: founderValidated ? (assumption.confidence || 'validated') : confidence,
    supports,
    contradicts,
    neutral,
    evidenceCount: evidence.length,
    validated: founderValidated,
    why: founderValidated
      ? 'Founder marked this assumption validated.'
      : contradicts > supports
        ? `${contradicts} contradicting vs ${supports} supporting evidence — thesis challenged, not validated.`
        : evidence.length
          ? `${evidence.length} linked evidence item(s); hypothesis not auto-validated.`
          : 'No linked evidence yet.',
  };
}

module.exports = {
  uid,
  normalizeTitle,
  isActiveEvidence,
  evidenceFingerprint,
  dedupeEvidence,
  qualifyingEvidence,
  findEvidenceById,
  findDuplicate,
  revokeEvidence,
  assumptionStance,
};
