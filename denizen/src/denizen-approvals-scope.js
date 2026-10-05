'use strict';

/**
 * Holding-company dossier branding allowlist.
 * Prefer DENIZEN_HOLDING_EMAILS=a@x,b@y — do not ship personal emails as product defaults.
 */
function holdingEmailsFromEnv() {
  const raw = String(process.env.DENIZEN_HOLDING_EMAILS || process.env.DENIZEN_ANGELA_HOLDING_EMAILS || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** @deprecated use holdingEmailsFromEnv(); kept for tests that inspect the export */
const ANGELA_HOLDING_EMAILS = holdingEmailsFromEnv();

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAngelaHoldingPrincipal(profile = {}) {
  const email = String(profile.email || '').trim().toLowerCase();
  const allow = holdingEmailsFromEnv();
  if (email && allow.has(email)) return true;
  // Name match only when an allowlist is configured (operator deploy).
  if (!allow.size) return false;
  const name = normalizeName(
    profile.display_name || profile.displayName || profile.username || profile.name || '',
  );
  return name.includes('angela') && name.includes('van zandt');
}

function isSystemOperatorReviewer({ isCeo = false, canApproveSkills = false } = {}) {
  return !!(isCeo || canApproveSkills);
}

function canUseApprovalsApp({ sessionId, identityId } = {}) {
  return !!(sessionId && identityId);
}

/**
 * Everyone gets plain white PDFs except Angela (1920 Holding).
 * Operators requesting on behalf of the system still use branded skins via params.
 */
function resolveDossierSkinForOwner(ownerProfile, { requestedSkin, defaultSkin } = {}) {
  if (isAngelaHoldingPrincipal(ownerProfile)) {
    const skin = String(requestedSkin || defaultSkin || '1921').trim();
    return skin || '1921';
  }
  return 'white';
}

function proposalOwnerId(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;
  return proposal.owner_identity_id
    || proposal.raw?.owner_identity_id
    || null;
}

function proposalOwnedByIdentity(proposal, identityId) {
  if (!identityId) return false;
  const owner = proposalOwnerId(proposal);
  if (!owner) return false;
  return owner === identityId;
}

function proposalVisibleToViewer(proposal, { identityId, operator } = {}) {
  if (operator) return true;
  return proposalOwnedByIdentity(proposal, identityId);
}

function filterMergedProposals(items, { identityId, operator } = {}) {
  if (operator) return items;
  return (items || []).filter((p) => {
    if (p?.kind !== 'dossier') return false;
    return proposalOwnedByIdentity(p, identityId);
  });
}

function canDecideDossierProposal(proposal, { identityId, operator } = {}) {
  if (!proposal) return false;
  if (operator) return true;
  return proposalOwnedByIdentity(proposal, identityId);
}

module.exports = {
  ANGELA_HOLDING_EMAILS,
  isAngelaHoldingPrincipal,
  isSystemOperatorReviewer,
  canUseApprovalsApp,
  resolveDossierSkinForOwner,
  proposalOwnerId,
  proposalOwnedByIdentity,
  proposalVisibleToViewer,
  filterMergedProposals,
  canDecideDossierProposal,
};
