'use strict';

/**
 * User work position — free-text job title + resolved role profile for NPC context.
 * Stored on denizen_user_identities.metadata.position
 */

const http = require('http');
const https = require('https');
const denizenDb = require('./denizen-db.js');

const POSITION_SUGGESTIONS = [
  'CEO',
  'Founder',
  'Chief Executive Officer',
  'Chief Technology Officer',
  'Chief Operating Officer',
  'Chief Financial Officer',
  'Product Manager',
  'Project Manager',
  'Program Manager',
  'Engineering Manager',
  'Software Engineer',
  'Senior Developer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'DevOps Engineer',
  'Data Engineer',
  'Data Analyst',
  'UI/UX Designer',
  'Product Designer',
  'Marketing Manager',
  'Content Strategist',
  'Sales Manager',
  'Account Executive',
  'Business Development',
  'Customer Success Manager',
  'Operations Manager',
  'Office Manager',
  'Executive Assistant',
  'Administrative Assistant',
  'Personal Assistant',
  'Intern',
  'Research Analyst',
  'Consultant',
  'HR Manager',
  'Recruiter',
  'Legal Counsel',
  'Finance Manager',
  'Accountant',
];

const ROLE_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    canonical_role: { type: 'string' },
    summary: { type: 'string' },
    responsibilities: { type: 'array', items: { type: 'string' } },
    works_with: { type: 'array', items: { type: 'string' } },
    decision_scope: { type: 'string' },
    how_to_help: { type: 'string' },
  },
  required: ['title', 'summary', 'responsibilities', 'how_to_help'],
};

function normalizeTitle(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function getPositionFromIdentity(identity) {
  if (!identity) return null;
  const meta = identity.metadata && typeof identity.metadata === 'object'
    ? identity.metadata
    : {};
  const pos = meta.position && typeof meta.position === 'object' ? meta.position : null;
  if (!pos?.title) return null;
  return sanitizePositionProfile(pos);
}

function sanitizePositionProfile(raw = {}) {
  const title = normalizeTitle(raw.title);
  if (!title) return null;
  const responsibilities = Array.isArray(raw.responsibilities)
    ? raw.responsibilities.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
    : [];
  const worksWith = Array.isArray(raw.works_with)
    ? raw.works_with.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    title,
    canonical_role: String(raw.canonical_role || slugifyRole(title)).slice(0, 80),
    summary: String(raw.summary || '').trim().slice(0, 500),
    responsibilities,
    works_with: worksWith,
    decision_scope: String(raw.decision_scope || '').trim().slice(0, 400),
    how_to_help: String(raw.how_to_help || '').trim().slice(0, 500),
    resolved_at: raw.resolved_at || null,
    source: raw.source === 'llm' ? 'llm' : 'fallback',
  };
}

function slugifyRole(title) {
  return normalizeTitle(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'teammate';
}

function matchRoleTemplate(title) {
  const t = normalizeTitle(title).toLowerCase();
  const rules = [
    {
      re: /\b(ceo|chief executive|founder|co-founder|cofounder|president|owner)\b/,
      profile: {
        canonical_role: 'executive',
        summary: 'Executive leadership — sets direction, approves major bets, and unblocks the company.',
        responsibilities: [
          'Set company vision and priorities',
          'Approve budget, hires, and major commitments',
          'Represent the organization to clients and partners',
          'Remove blockers for the leadership team',
        ],
        works_with: ['COO', 'CTO', 'CFO', 'Product', 'Sales'],
        decision_scope: 'Final call on strategy, spend, and org-wide commitments.',
        how_to_help: 'Bring concise options with tradeoffs, flag risks early, and draft decisions they can sign off on.',
      },
    },
    {
      re: /\b(product manager|product owner|pm\b|head of product|vp.? product)\b/,
      profile: {
        canonical_role: 'product_manager',
        summary: 'Owns what gets built and why — balances user needs, business goals, and delivery constraints.',
        responsibilities: [
          'Define roadmap and prioritize features',
          'Write specs and acceptance criteria',
          'Coordinate engineering, design, and stakeholders',
          'Track outcomes after launch',
        ],
        works_with: ['Engineering', 'Design', 'Sales', 'Support'],
        decision_scope: 'Scope and priority within product areas; escalates budget and staffing.',
        how_to_help: 'Summarize user feedback, draft specs, prep sprint reviews, and surface delivery risks.',
      },
    },
    {
      re: /\b(project manager|program manager|scrum master|delivery lead)\b/,
      profile: {
        canonical_role: 'project_manager',
        summary: 'Keeps work moving — timelines, dependencies, and cross-team coordination.',
        responsibilities: [
          'Plan milestones and track progress',
          'Facilitate standups and status updates',
          'Manage risks, blockers, and dependencies',
          'Communicate timeline changes clearly',
        ],
        works_with: ['Engineering', 'Product', 'Operations'],
        decision_scope: 'Schedule and process within agreed scope; escalates scope changes.',
        how_to_help: 'Draft status reports, chase blockers, build timelines, and prep meeting notes.',
      },
    },
    {
      re: /\b(engineer|developer|programmer|software|devops|sre|data engineer)\b/,
      profile: {
        canonical_role: 'engineer',
        summary: 'Builds and maintains systems — turns requirements into reliable software and infrastructure.',
        responsibilities: [
          'Implement features and fix defects',
          'Review code and improve reliability',
          'Estimate effort and flag technical risk',
          'Document systems and runbooks',
        ],
        works_with: ['Product', 'Design', 'QA', 'DevOps'],
        decision_scope: 'Technical approach within tickets; escalates architecture and security.',
        how_to_help: 'Draft tickets, summarize bugs, research libraries, and prep PR or deployment checklists.',
      },
    },
    {
      re: /\b(designer|ux|ui\/ux|creative director|brand)\b/,
      profile: {
        canonical_role: 'designer',
        summary: 'Shapes how products look and feel — usability, visuals, and coherent user journeys.',
        responsibilities: [
          'Create wireframes and visual designs',
          'Run usability reviews and iterate',
          'Maintain design system consistency',
          'Partner with product and engineering on feasibility',
        ],
        works_with: ['Product', 'Engineering', 'Marketing'],
        decision_scope: 'Design choices within brand and product guidelines.',
        how_to_help: 'Gather references, draft copy for layouts, schedule reviews, and summarize feedback.',
      },
    },
    {
      re: /\b(marketing|growth|content|social media|seo)\b/,
      profile: {
        canonical_role: 'marketing',
        summary: 'Drives awareness and demand — messaging, campaigns, and audience growth.',
        responsibilities: [
          'Plan campaigns and content calendars',
          'Draft messaging and creative briefs',
          'Track funnel and campaign performance',
          'Coordinate launches with product and sales',
        ],
        works_with: ['Sales', 'Product', 'Design'],
        decision_scope: 'Campaign tactics within budget; escalates spend and brand shifts.',
        how_to_help: 'Draft posts, summarize analytics, research competitors, and prep launch assets.',
      },
    },
    {
      re: /\b(sales|account executive|business development|bd\b|ae\b)\b/,
      profile: {
        canonical_role: 'sales',
        summary: 'Owns pipeline and revenue — discovery, proposals, and closing customer deals.',
        responsibilities: [
          'Prospect and qualify opportunities',
          'Run demos and handle objections',
          'Draft proposals and follow-up sequences',
          'Keep CRM stages accurate',
        ],
        works_with: ['Marketing', 'Customer Success', 'Product'],
        decision_scope: 'Deal tactics and pricing within approved bands.',
        how_to_help: 'Research accounts, draft outreach, prep call briefs, and update CRM notes.',
      },
    },
    {
      re: /\b(assistant|executive assistant|administrative|office manager|coordinator)\b/,
      profile: {
        canonical_role: 'assistant',
        summary: 'Keeps leaders and teams organized — calendar, communications, and follow-through.',
        responsibilities: [
          'Manage schedules and meeting prep',
          'Track action items and reminders',
          'Draft emails and coordinate logistics',
          'Shield focus time and prioritize inbound',
        ],
        works_with: ['Executives', 'Operations', 'HR'],
        decision_scope: 'Scheduling and communications within delegated authority.',
        how_to_help: 'Draft agendas, summarize threads, book meetings, and chase open tasks politely.',
      },
    },
    {
      re: /\b(intern|trainee|apprentice)\b/,
      profile: {
        canonical_role: 'intern',
        summary: 'Learning contributor — supports projects while building skills under guidance.',
        responsibilities: [
          'Execute scoped tasks with clear instructions',
          'Ask questions early when blocked',
          'Document learnings and deliverables',
          'Support team rituals and research',
        ],
        works_with: ['Mentors', 'Project leads', 'Peers'],
        decision_scope: 'Task-level work; escalates anything affecting customers or commitments.',
        how_to_help: 'Break work into checklists, explain context, pair on drafts, and give fast feedback.',
      },
    },
    {
      re: /\b(analyst|research|strategy|consultant)\b/,
      profile: {
        canonical_role: 'analyst',
        summary: 'Turns data and research into recommendations — clarity for decisions.',
        responsibilities: [
          'Gather and synthesize information',
          'Build models, reports, or briefs',
          'Present findings with clear recommendations',
          'Monitor metrics relevant to their domain',
        ],
        works_with: ['Leadership', 'Product', 'Finance'],
        decision_scope: 'Analysis and recommendations; others decide implementation.',
        how_to_help: 'Pull sources, structure findings, draft slides or memos, and highlight assumptions.',
      },
    },
    {
      re: /\b(hr|human resources|recruiter|people ops|talent)\b/,
      profile: {
        canonical_role: 'people_ops',
        summary: 'Owns hiring, onboarding, and people processes for a healthy team.',
        responsibilities: [
          'Run recruiting pipelines and interviews',
          'Onboard new teammates',
          'Maintain policies and employee records',
          'Support performance and culture programs',
        ],
        works_with: ['Managers', 'Finance', 'Operations'],
        decision_scope: 'Process and candidate experience within policy.',
        how_to_help: 'Draft job posts, schedule interviews, summarize candidates, and track onboarding tasks.',
      },
    },
    {
      re: /\b(finance|cfo|accountant|controller)\b/,
      profile: {
        canonical_role: 'finance',
        summary: 'Stewards money — budgets, reporting, and financial discipline.',
        responsibilities: [
          'Track budgets and forecasts',
          'Prepare financial reports',
          'Support invoicing and vendor payments',
          'Flag variances and cash risks early',
        ],
        works_with: ['Leadership', 'Operations', 'Sales'],
        decision_scope: 'Reporting and process; leadership approves major spend.',
        how_to_help: 'Summarize expenses, draft forecasts, chase receipts, and prep board-ready numbers.',
      },
    },
    {
      re: /\b(customer success|support|csm|help desk)\b/,
      profile: {
        canonical_role: 'customer_success',
        summary: 'Keeps customers successful — onboarding, support, and retention.',
        responsibilities: [
          'Onboard new accounts',
          'Answer questions and troubleshoot issues',
          'Escalate product bugs with context',
          'Identify expansion and churn risks',
        ],
        works_with: ['Sales', 'Product', 'Engineering'],
        decision_scope: 'Account tactics within policy; escalates refunds and commitments.',
        how_to_help: 'Draft replies, summarize tickets, prep QBR notes, and track follow-ups.',
      },
    },
  ];

  for (const rule of rules) {
    if (rule.re.test(t)) return rule.profile;
  }
  return null;
}

function fallbackResolvePosition(title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;
  const template = matchRoleTemplate(normalized);
  const base = template || {
    canonical_role: slugifyRole(normalized),
    summary: `${normalized} — contributes to team goals in their domain. Treat their title literally when prioritizing work.`,
    responsibilities: [
      'Own outcomes in their stated domain',
      'Collaborate with teammates across functions',
      'Communicate blockers and decisions clearly',
    ],
    works_with: ['Teammates', 'Leadership'],
    decision_scope: 'Day-to-day work in their lane; escalates cross-team or budget decisions.',
    how_to_help: 'Ask what they are trying to accomplish, mirror their title, and offer drafts they can edit quickly.',
  };
  return sanitizePositionProfile({
    title: normalized,
    ...base,
    resolved_at: new Date().toISOString(),
    source: 'fallback',
  });
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (_) {}
    }
  }
  return null;
}

function lmStudioBaseUrl() {
  return String(
    process.env.LM_STUDIO_URL
    || process.env.LM_STUDIO_BASE_URL
    || 'http://127.0.0.1:1234',
  ).replace(/\/+$/, '');
}

function lmStudioModel() {
  return process.env.LM_STUDIO_MODEL || process.env.LM_STUDIO_FAST_MODEL || 'local-model';
}

function callLmStudioJson({ systemPrompt, userPrompt, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const base = lmStudioBaseUrl();
    const url = new URL('/v1/chat/completions', `${base}/`);
    const body = JSON.stringify({
      model: lmStudioModel(),
      max_tokens: 700,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'work_position',
          schema: ROLE_PROFILE_SCHEMA,
          strict: false,
        },
      },
      enable_thinking: false,
    });
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${process.env.LM_STUDIO_API_KEY || 'lm-studio'}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'LM Studio error'));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Bad JSON from LM Studio: ${String(data).slice(0, 160)}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => req.destroy(new Error('LM Studio timeout')));
    req.write(body);
    req.end();
  });
}

async function resolvePositionProfile(title, { useLlm = true } = {}) {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  if (useLlm) {
    try {
      const systemPrompt = [
        'You interpret job titles for an AI office assistant product.',
        'Given a user-typed position title, infer how that person typically works.',
        'Be practical and concise. Output JSON only.',
      ].join('\n');
      const userPrompt = `Position title: "${normalized}"`;
      const response = await callLmStudioJson({ systemPrompt, userPrompt });
      const content = response?.choices?.[0]?.message?.content || '';
      const parsed = parseJsonFromText(content);
      const profile = sanitizePositionProfile({
        ...parsed,
        title: parsed?.title || normalized,
        resolved_at: new Date().toISOString(),
        source: 'llm',
      });
      if (profile?.summary && profile.responsibilities?.length) return profile;
    } catch (err) {
      console.warn('[user-position] LLM resolve failed, using fallback:', err?.message || err);
    }
  }

  return fallbackResolvePosition(normalized);
}

async function getPositionForIdentityId(identityId) {
  if (!denizenDb.enabled || !identityId) return null;
  const rows = await denizenDb._getSoft(
    `denizen_user_identities?select=id,metadata&id=eq.${encodeURIComponent(identityId)}&limit=1`,
  ).catch(() => []);
  return getPositionFromIdentity(rows?.[0] || null);
}

async function saveIdentityPosition(identityId, { title, profile = null, resolve = true } = {}) {
  if (!denizenDb.enabled || !identityId) {
    throw new Error('identity required');
  }
  const normalized = normalizeTitle(title);
  if (!normalized) throw new Error('position title required');

  let nextProfile = profile ? sanitizePositionProfile(profile) : null;
  if (!nextProfile && resolve) {
    nextProfile = await resolvePositionProfile(normalized);
  }
  if (!nextProfile) {
    nextProfile = fallbackResolvePosition(normalized);
  }

  const rows = await denizenDb._getSoft(
    `denizen_user_identities?select=id,metadata&id=eq.${encodeURIComponent(identityId)}&limit=1`,
  );
  const existing = rows?.[0];
  if (!existing?.id) throw new Error('profile not found');

  const meta = existing.metadata && typeof existing.metadata === 'object'
    ? { ...existing.metadata }
    : {};
  meta.position = nextProfile;

  await denizenDb._patchSoft(
    `denizen_user_identities?id=eq.${encodeURIComponent(identityId)}`,
    { metadata: meta, updated_at: new Date().toISOString() },
    { prefer: 'return=minimal' },
  );

  return nextProfile;
}

function formatPositionPromptBlock(position) {
  const pos = sanitizePositionProfile(position);
  if (!pos) return '';
  const lines = [
    '## Teammate work position',
    `Title: ${pos.title}`,
    `Summary: ${pos.summary}`,
  ];
  if (pos.responsibilities?.length) {
    lines.push('Typical responsibilities:');
    pos.responsibilities.forEach((r) => lines.push(`- ${r}`));
  }
  if (pos.works_with?.length) {
    lines.push(`Works with: ${pos.works_with.join(', ')}`);
  }
  if (pos.decision_scope) lines.push(`Decision scope: ${pos.decision_scope}`);
  if (pos.how_to_help) lines.push(`How NPCs should help: ${pos.how_to_help}`);
  return lines.join('\n');
}

function toClientPosition(position) {
  const pos = sanitizePositionProfile(position);
  if (!pos) return null;
  return {
    title: pos.title,
    canonical_role: pos.canonical_role,
    summary: pos.summary,
    responsibilities: pos.responsibilities,
    works_with: pos.works_with,
    decision_scope: pos.decision_scope,
    how_to_help: pos.how_to_help,
    resolved_at: pos.resolved_at,
    source: pos.source,
  };
}

module.exports = {
  POSITION_SUGGESTIONS,
  normalizeTitle,
  getPositionFromIdentity,
  sanitizePositionProfile,
  fallbackResolvePosition,
  resolvePositionProfile,
  getPositionForIdentityId,
  saveIdentityPosition,
  formatPositionPromptBlock,
  toClientPosition,
};
