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
      'Funding Readiness, Lean Canvas, living PAVE workbook',
      'Sales-cycle workshop diagram and mentor recommendations',
      'Assumptions never auto-validate',
    ],
    does_not: [
      'Invent market size, traction, or checklist checks',
      'Treat CRM deals as delivery tasks',
    ],
    start_tools: [
      'business_studio_working_set',
      'business_studio_brief',
      'business_studio_explain',
      'business_studio_chain_status',
      'business_studio_funding_readiness',
    ],
    write_scope: 'crm_write',
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
  return {
    ok: true,
    product: 'Denizen',
    pitch: 'The office for your AI agents — floor you can watch, workbench you can drop into, CRM + delivery + founder OS as tools.',
    surfaces: SURFACES,
    playbook: [
      'Call the matching *_working_set (or agency_working_set) before inventing ids or stages.',
      'ChatGPT Custom GPT: same tools via runNpcSkill with kebab names (studio-board-working-set, business-studio-brief, …).',
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
    'Always orient with crm_working_set / studio_board_working_set / business_studio_working_set / agency_working_set (or business_studio_explain) before creating records.',
    'Never invent pipeline data, board people, or funding evidence. Empty boards are valid.',
    'Read resource docs://product-map for the full surface guide. Writes require crm_write (Full access).',
  ].join(' ');
}

function chatgptProductInstructions({ npcLabel = 'the connected Denizen assistant' } = {}) {
  return [
    `You ARE ${npcLabel} in Denizen — an AI that works the office tools, not a generic chatbot.`,
    'Product map: Meridian CRM = sales pipeline (contacts/deals/tasks). Studio Board = agency delivery (tasks/people/calendar/My Day). Business Studio / Founder OS = evidence-gated progress (PAVE, Lean Canvas, Funding Readiness — tasks are not progress; evidence is). Agency tools link CRM deals ↔ Studio Board tasks.',
    'ChatGPT Actions path: runNpcSkill with kebab skill names — studio-board-working-set, studio-board-brief, studio-board-upsert-task, business-studio-working-set, business-studio-brief, business-studio-add-evidence (same as MCP snake_case tools, hyphens instead of underscores).',
    'Before mutating: call the matching working_set or brief. Prefer agency_working_set when sales and delivery collide.',
    'In Business Studio never invent traction, TAM, or checklist ticks — use business-studio-add-evidence and business-studio-chain-status (or business_studio_* MCP tools).',
    'If scope_denied, tell the human to mint a Connect AI token with Full access (crm_write).',
    'Also use getTeamStandup / listNpcSkills for office skills when the Custom GPT Actions path is active.',
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
];

function productResourcesList() {
  return PRODUCT_RESOURCES.slice();
}

function readProductResource(uri) {
  const u = String(uri || '');
  if (u === 'docs://product-map') return JSON.stringify(productMapJson(), null, 2);
  if (u === 'docs://product-map.md') return productMapMarkdown();
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
