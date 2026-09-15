'use strict';

/**
 * MCP token scopes — tool access governance (Phase 4).
 *
 * Scopes: read, skills, crm_write, handoff, delegate
 * Missing scopes on a token = full access (backward compatible).
 */

const ALL_SCOPES = Object.freeze(['read', 'skills', 'crm_write', 'handoff', 'delegate', 'compute']);

const SCOPE_PRESETS = Object.freeze({
  read: ['read'],
  standard: ['read', 'skills', 'handoff'],
  full: [...ALL_SCOPES],
});

const TOOL_SCOPE = Object.freeze({
  update_memory: 'read',
  get_status: 'read',
  log_activity: 'read',
  list_skills: 'read',
  list_team: 'read',
  list_pending_handoffs: 'read',
  team_standup: 'read',
  crm_pipeline_brief: 'read',
  crm_working_set: 'read',
  business_context_brief: 'read',
  crm_list_tasks: 'read',
  studio_board_working_set: 'read',
  studio_board_brief: 'read',
  studio_board_list_tasks: 'read',
  studio_board_get_task: 'read',
  studio_board_list_people: 'read',
  studio_board_list_events: 'read',
  studio_board_list_notes: 'read',
  studio_board_get_config: 'read',
  studio_board_standup: 'read',
  studio_board_my_day: 'read',
  get_market_quote: 'read',
  get_market_portfolio: 'read',
  market_watch: 'read',
  list_trade_suggestions: 'read',
  get_watchlist: 'read',
  team_status: 'read',
  list_directives: 'read',
  list_jobs: 'read',
  record_outcome: 'read',
  run_skill: 'skills',
  crm_draft_email: 'crm_write',
  send_draft: 'crm_write',
  mail_policy_status: 'read',
  crm_park_deal: 'crm_write',
  studio_board_upsert_task: 'crm_write',
  studio_board_advance_task: 'crm_write',
  studio_board_assign_task: 'crm_write',
  studio_board_add_comment: 'crm_write',
  studio_board_upsert_person: 'crm_write',
  studio_board_delete_task: 'crm_write',
  studio_board_delete_person: 'crm_write',
  studio_board_upsert_event: 'crm_write',
  studio_board_delete_event: 'crm_write',
  studio_board_add_subtask: 'crm_write',
  studio_board_toggle_subtask: 'crm_write',
  studio_board_delete_subtask: 'crm_write',
  studio_board_send_note: 'crm_write',
  studio_board_update_config: 'crm_write',
  send_handoff: 'handoff',
  acknowledge_handoff: 'handoff',
  delegate_task: 'delegate',
  assign_task: 'delegate',
  announce_in_office: 'delegate',
  broadcast_task: 'delegate',
  clear_directive: 'delegate',
  complete_directive: 'delegate',
  schedule_job: 'delegate',
  run_as_npc: 'skills',
  enqueue_compute_job: 'compute',
  get_job_status: 'read',
  get_inference_nodes: 'read',
  get_skill_job: 'read',
  enqueue_cursor_work: 'delegate',
  list_cursor_work: 'read',
  claim_cursor_work: 'skills',
  complete_cursor_work: 'skills',
  mentor_list_pending: 'read',
  mentor_get_session: 'read',
  mentor_peer_reply: 'skills',
  mentor_finalize: 'delegate',
});

function normalizeScopes(input) {
  if (input == null || input === '') return [...ALL_SCOPES];
  if (typeof input === 'string') {
    const preset = SCOPE_PRESETS[String(input).toLowerCase().trim()];
    if (preset) return [...preset];
    return normalizeScopes(input.split(/[,\s]+/).filter(Boolean));
  }
  if (!Array.isArray(input)) return [...ALL_SCOPES];
  const out = [];
  for (const raw of input) {
    const s = String(raw || '').toLowerCase().trim();
    if (ALL_SCOPES.includes(s) && !out.includes(s)) out.push(s);
  }
  return out.length ? out : [...ALL_SCOPES];
}

function scopesFromTokenScope(scope) {
  if (!scope) return [...ALL_SCOPES];
  if (Array.isArray(scope.scopes) && scope.scopes.length) {
    return normalizeScopes(scope.scopes);
  }
  return [...ALL_SCOPES];
}

function requiredScope(toolName) {
  return TOOL_SCOPE[String(toolName || '').trim()] || 'skills';
}

function hasScope(scope, needed) {
  const granted = scopesFromTokenScope(scope);
  return granted.includes(needed);
}

function toolAllowed(scope, toolName) {
  const name = String(toolName || '').trim();
  if (!name) return false;
  const needed = requiredScope(name);
  return hasScope(scope, needed);
}

function filterTools(scope, tools) {
  const list = Array.isArray(tools) ? tools : [];
  return list.filter((t) => toolAllowed(scope, t?.name || t));
}

module.exports = {
  ALL_SCOPES,
  SCOPE_PRESETS,
  TOOL_SCOPE,
  normalizeScopes,
  scopesFromTokenScope,
  requiredScope,
  hasScope,
  toolAllowed,
  filterTools,
};
