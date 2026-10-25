'use strict';

/**
 * Product map for MCP connectors (ChatGPT, Claude, Cursor).
 * Explains CRM · Studio Board · Business Studio · Agency so tools aren't a mystery menu.
 */

const SURFACES = [
  {
    id: 'crm',
    name: 'Meridian CRM',
    url: '/crm/',
    role: 'Sales pipeline and relationships',
    does: [
      'Contacts, companies, deals, tasks, notes, meetings',
      'Pipeline stages, drafts, watchlist / park for research',
      'Team activity (who is working what)',
    ],
    does_not: [
      'Delivery production work (use Studio Board)',
      'Founder evidence / PAVE / funding (use Business Studio)',
    ],
    start_tools: ['crm_working_set', 'crm_pipeline_brief', 'business_context_brief'],
    write_scope: 'crm_write',
  },
  {
    id: 'studio_board',
    name: 'Studio Board',
    url: '/studio-board/',
    role: 'Agency delivery tracker',
    does: [
      'Tasks, people, calendar, My Day, timeline, automations',
      'Pipeline columns for client delivery work',
      'Standups and teammate notes',
    ],
    does_not: [
      'Sales pipeline $ (use CRM)',
      'Evidence-gated founder progress (use Business Studio)',
    ],
    start_tools: ['studio_board_working_set', 'studio_board_brief', 'studio_board_my_day'],
    write_scope: 'crm_write',
  },
  {
    id: 'business_studio',
    name: 'Business Studio (Founder OS)',
    url: '/business-studio/',
    role: 'Evidence-gated founder workbook',
    does: [
      'Tasks ≠ progress — qualifying evidence moves the chain',
      'Every menu app: Funding Readiness, Lean Canvas, PAVE, Strategy, Roadmap, Goals, Tasks, Evidence, Experiments, Discovery Lab, Market Sizing, Moat, Capital Pathway, Data Room, Investor Stress-Test, Mentors',
      'Sales-cycle workshop diagram (inside PAVE) and mentor recommendations',
      'Assumptions never auto-validate',
      'Templates, Financials, Diagrams, Documents, and Reports save personal records with business_studio_upsert_section — no invented figures',
    ],
    does_not: [
      'Invent market size, traction, or checklist checks',
      'Treat CRM deals as delivery tasks',
    ],
    start_tools: [
      'business_studio_catalog',
      'business_studio_section',
      'business_studio_working_set',
      'business_studio_brief',
      'business_studio_explain',
      'business_studio_chain_status',
      'business_studio_funding_readiness',
    ],
    write_scope: 'crm_write',
    sections_resource: 'docs://business-studio-sections',
  },
  {
    id: 'agency',
    name: 'Agency bridge',
    url: null,
    role: 'CRM ↔ Studio Board link layer',
    does: [
      'Link deals to delivery tasks both ways',
      'Handoff Closed Won → create Studio Board delivery work',
      'Joint sales+delivery brief (agency_working_set)',
    ],
    does_not: ['Replace CRM or Board — it coordinates them'],
    start_tools: ['agency_working_set', 'agency_link_deal_task', 'agency_handoff_won_deal'],
    write_scope: 'crm_write',
  },
];

function productMapJson() {
  const sections = (() => {
    try {
      return require('./denizen-business-studio-sections').catalogForAgent();
    } catch (_) {
      return null;
    }
  })();
  return {
    ok: true,
    product: 'Denizen',
    pitch: 'The office for your AI agents — floor you can watch, workbench you can drop into, CRM + delivery + founder OS as tools.',
    surfaces: SURFACES,
    business_studio_sections: sections?.sections || null,
    playbook: [
      'Call the matching *_working_set (or agency_working_set) before inventing ids or stages.',
      'Business Studio apps: call business_studio_catalog or business_studio_section with the menu name (Lean Canvas, Moat Builder, …) so you know what it is and which tools read/update it.',
      'ChatGPT Custom GPT: same tools via runNpcSkill with kebab names (business-studio-section, business-studio-get-lean-canvas, studio-board-working-set, …).',
      'Empty workspaces are OK — do not fabricate contacts, deals, tasks, or evidence.',
      'CRM = sell. Studio Board = deliver. Business Studio = prove (evidence). Agency = link sell→deliver.',
      'Mutations need crm_write scope (Full access token). Read tools work with Standard/read.',
      'Prefer business_studio_explain / business-studio-explain if you are unsure which Founder OS surface to use.',
    ],
  };
}

function productMapMarkdown() {
  const map = productMapJson();
  const lines = [
    '# Denizen product map (MCP)',
    '',
    map.pitch,
    '',
    '## Surfaces',
    '',
  ];
  for (const s of SURFACES) {
    lines.push(`### ${s.name}`);
    lines.push(`**Role:** ${s.role}`);
    if (s.url) lines.push(`**UI:** \`${s.url}\``);
    lines.push('**Does:**');
    for (const d of s.does) lines.push(`- ${d}`);
    lines.push('**Does not:**');
    for (const d of s.does_not) lines.push(`- ${d}`);
    lines.push(`**Start with:** \`${s.start_tools.join('`, `')}\``);
    lines.push('');
  }
  lines.push('## Playbook');
  for (const p of map.playbook) lines.push(`- ${p}`);
  lines.push('');
  return lines.join('\n');
}

/** MCP initialize `instructions` — what ChatGPT/Claude see on connect. */
function mcpInitializeInstructions({ mode = 'team' } = {}) {
  const who = mode === 'team'
    ? 'You are connected to the Denizen team MCP — the whole office from one connection.'
    : 'You are connected as a Denizen office NPC via MCP.';
  return [
    who,
    'Denizen is not a mystery chat: CRM sells, Studio Board delivers client work, Business Studio proves founder progress with evidence, Agency links CRM deals to Board tasks.',
    'CRM cleanup is crm_operate or run_skill crm-operate. Actions: list-records, update-contact, delete-contact, upsert-company, link, update-task, close-task, upsert-package, sync-business-context. Use the contact_id from list-records when updating email or phone.',
    'Always orient with crm_working_set / studio_board_working_set / business_studio_working_set / agency_working_set (or business_studio_explain) before creating records.',
    'On the floor, call office_look before office_act or office_place_furniture. office_look shows who is standing where. office_act uses walkTo, speak, goToRoom, and the other office verbs.',
    'Business Studio menu apps: call business_studio_catalog or business_studio_section (Lean Canvas, PAVE, Moat, Capital Pathway, …) so you know what each app is and which tools read/update it.',
    'Never invent pipeline data, board people, or funding evidence. Empty boards are valid.',
    'Read resource docs://product-map (and docs://business-studio-sections) for the full surface guide. Writes require crm_write (Full access).',
  ].join(' ');
}

function chatgptProductInstructions({ npcLabel = 'the connected Denizen assistant' } = {}) {
  return [
    `You ARE ${npcLabel} in Denizen — an AI that works the office tools, not a generic chatbot.`,
    'Product map: Meridian CRM = sales pipeline (contacts/deals/tasks). Studio Board = agency delivery (tasks/people/calendar/My Day). Business Studio / Founder OS = evidence-gated progress (every menu app: Funding Readiness, Lean Canvas, PAVE, Strategy, Roadmap, Goals, Tasks, Evidence, Experiments, Discovery Lab, Market Sizing, Moat, Capital Pathway, Data Room, Investor Stress-Test, Mentors — plus Phase 2 coming soon). Agency tools link CRM deals ↔ Studio Board tasks.',
    'When the founder names a Business Studio app, call business-studio-section (or business-studio-catalog) first so you know what it is, what it is for, and which tools to use. Pass section= into business-studio-working-set when you know which screen they are on.',
    'ChatGPT Actions path: runNpcSkill with kebab skill names — business-studio-section, business-studio-get-lean-canvas, business-studio-upsert-lean-canvas, business-studio-get-pave, business-studio-funding-readiness, studio-board-working-set, … (same as MCP snake_case tools).',
    'Before mutating: call the matching working_set or brief. Prefer agency_working_set when sales and delivery collide.',
    'In Business Studio never invent traction, TAM, or checklist ticks — use business-studio-add-evidence and business-studio-chain-status (or business_studio_* MCP tools).',
    'If scope_denied, tell the human to mint a Connect AI token with Full access (crm_write).',
    'Also use getTeamStandup / listNpcSkills for office skills when the Custom GPT Actions path is active.',
    'Browser eyes (default, no API keys): browserBegin → describe ONLY the screenshot → browserStep → describe the AFTER screenshot. Never claim success without the AFTER frame. Prefer over computer-use; local LM vision is optional backup only.',
  ].join(' ');
}

const PRODUCT_RESOURCES = [
  {
    uri: 'docs://product-map',
    name: 'product_map',
    description:
      'What CRM, Studio Board, Business Studio, and Agency are — roles, start tools, and playbook for ChatGPT/Claude.',
    mimeType: 'application/json',
  },
  {
    uri: 'docs://product-map.md',
    name: 'product_map_markdown',
    description: 'Same Denizen product map as readable Markdown.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'docs://business-studio-sections',
    name: 'business_studio_sections',
    description:
      'Every Business Studio menu app (Funding Readiness through Phase 2 stubs) — what it is, used for, read/write tools.',
    mimeType: 'application/json',
  },
];

function productResourcesList() {
  return PRODUCT_RESOURCES.slice();
}

function readProductResource(uri) {
  const u = String(uri || '');
  if (u === 'docs://product-map') return JSON.stringify(productMapJson(), null, 2);
  if (u === 'docs://product-map.md') return productMapMarkdown();
  if (u === 'docs://business-studio-sections') {
    try {
      return JSON.stringify(require('./denizen-business-studio-sections').catalogForAgent(), null, 2);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function isProductResource(uri) {
  return readProductResource(uri) != null;
}

module.exports = {
  SURFACES,
  productMapJson,
  productMapMarkdown,
  mcpInitializeInstructions,
  chatgptProductInstructions,
  productResourcesList,
  readProductResource,
  isProductResource,
  PRODUCT_RESOURCES,
};
