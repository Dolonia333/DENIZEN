'use strict';

/** Angela Van Zandt — 1920 Holding parent company; branded dossier PDFs like operator. */
const ANGELA_HOLDING_EMAILS = new Set(['vzion253@gmail.com']);

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAngelaHoldingPrincipal(profile = {}) {
  const email = String(profile.email || '').trim().toLowerCase();
  if (email && ANGELA_HOLDING_EMAILS.has(email)) return true;
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
