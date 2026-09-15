'use strict';

/**
 * Studio Board ACL — owner/admin vs member (CRM-style).
 * MCP stays org-wide; this gates the human UI/API for settings mutations.
 */

function normalizeId(v) {
  return String(v || '').trim();
}

function ensureAcl(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  if (!cfg.acl || typeof cfg.acl !== 'object') {
    cfg.acl = { owners: [], admins: [] };
  }
  cfg.acl.owners = Array.isArray(cfg.acl.owners) ? cfg.acl.owners.map(normalizeId).filter(Boolean) : [];
  cfg.acl.admins = Array.isArray(cfg.acl.admins) ? cfg.acl.admins.map(normalizeId).filter(Boolean) : [];
  return cfg;
}

function actorKeys(actor = {}) {
  const keys = [];
  for (const v of [
    actor.identityId,
    actor.identity_id,
    actor.personId,
    actor.person_id,
    actor.id,
    actor.email,
  ]) {
    const n = normalizeId(v);
    if (n) keys.push(n.toLowerCase());
  }
  return keys;
}

function isAdmin(config, actor = {}) {
  const cfg = ensureAcl(config);
  const keys = actorKeys(actor);
  if (!keys.length) return false;
  const owners = new Set((cfg.acl.owners || []).map((x) => String(x).toLowerCase()));
  const admins = new Set((cfg.acl.admins || []).map((x) => String(x).toLowerCase()));
  return keys.some((k) => owners.has(k) || admins.has(k));
}

function isOwner(config, actor = {}) {
  const cfg = ensureAcl(config);
  const keys = actorKeys(actor);
  const owners = new Set((cfg.acl.owners || []).map((x) => String(x).toLowerCase()));
  return keys.some((k) => owners.has(k));
}

/** Seed first owner when board has none (session creator / linked identity). */
function seedOwnerIfEmpty(config, actor = {}) {
  const cfg = ensureAcl(config);
  if (cfg.acl.owners.length) return cfg;
  const seed = normalizeId(actor.identityId || actor.identity_id || actor.personId || actor.person_id || actor.email);
  if (seed) cfg.acl.owners = [seed];
  return cfg;
}

/** Admin-only operations: stages/columns/automations/people delete/templates reset. */
function requireAdmin(config, actor = {}) {
  if (isAdmin(config, actor)) return null;
  const err = new Error('Studio Board admin required for this action');
  err.code = 'FORBIDDEN';
  return err;
}

module.exports = {
  ensureAcl,
  isAdmin,
  isOwner,
  seedOwnerIfEmpty,
  requireAdmin,
  actorKeys,
};
